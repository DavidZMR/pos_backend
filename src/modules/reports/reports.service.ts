/**
 * Reportes. TODO sale de los snapshots guardados en cada venta y compra (precio, costo, IVA y
 * categoría del momento), nunca del precio actual del producto: un cambio de precio no altera
 * los reportes de fechas pasadas. Solo cuentan ventas `completed` (las canceladas se informan
 * aparte) y compras `active`. Los días se cortan en la zona horaria del negocio.
 */
import { type PipelineStage, Types } from 'mongoose';
import { dayRange, instantInZone } from '../../common/utils/dates.js';
import { type Unit, unitScale } from '../../common/utils/qty.js';
import { Business, DEFAULT_TIMEZONE } from '../businesses/business.model.js';
import { PAYMENT_METHODS, type PaymentMethod } from '../cash-sessions/cash-session.model.js';
import { Category } from '../categories/category.model.js';
import { Product } from '../products/product.model.js';
import { Purchase } from '../purchases/purchase.model.js';
import { Sale } from '../sales/sale.model.js';
import { autoGranularity, enumeratePeriods, type Granularity, previousRange } from './periods.js';
import type {
  BusinessesReportQuery,
  PurchasesReportQuery,
  ReportQuery,
  SummaryQuery,
  TopProductsQuery,
} from './reports.schemas.js';

/** Negocio del reporte (null = todos, solo superadmin) y zona horaria para cortar los días. */
export interface ReportScope {
  businessId: Types.ObjectId | null;
  timezone: string;
}

export async function resolveScope(businessId: string | undefined): Promise<ReportScope> {
  if (!businessId) return { businessId: null, timezone: DEFAULT_TIMEZONE };
  const business = await Business.findById(businessId).select('timezone');
  return {
    businessId: new Types.ObjectId(businessId),
    timezone: business?.timezone ?? DEFAULT_TIMEZONE,
  };
}

const oid = (id: string) => new Types.ObjectId(id);
const ratioBp = (part: number, whole: number) => (whole ? Math.round((part * 10_000) / whole) : 0);
const average = (total: number, count: number) => (count ? Math.round(total / count) : 0);

type LineFilters = Pick<ReportQuery, 'categoryId' | 'productId'> & { unit?: Unit };

/** Filtros de renglón (categoría/producto/unidad) con o sin el prefijo `items.`. */
function lineFilter(q: LineFilters, prefix: '' | 'items.'): Record<string, unknown> {
  const filter: Record<string, unknown> = {};
  if (q.categoryId) filter[`${prefix}categoryId`] = oid(q.categoryId);
  if (q.productId) filter[`${prefix}productId`] = oid(q.productId);
  if (q.unit) filter[`${prefix}unit`] = q.unit;
  return filter;
}

/** Días [from, to] en la zona; con `until` (minutos) el último día termina a esa hora local. */
function dateRange(timezone: string, from: string, to: string, until?: number) {
  const range = dayRange(timezone, from, to) ?? {};
  if (until !== undefined) range.$lt = instantInZone(to, until, timezone);
  return range;
}

/** "18:30" → 1110 minutos desde la medianoche. */
function minutesOf(time: string | undefined): number | undefined {
  if (!time) return undefined;
  const [hours = 0, minutes = 0] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

function saleMatch(
  scope: ReportScope,
  q: Partial<ReportQuery> & LineFilters,
  from: string,
  to: string,
  status: 'completed' | 'cancelled' = 'completed',
  until?: number,
): Record<string, unknown> {
  const match: Record<string, unknown> = {
    status,
    createdAt: dateRange(scope.timezone, from, to, until),
  };
  if (scope.businessId) match.businessId = scope.businessId;
  if (q.cashierId) match.cashierId = oid(q.cashierId);
  if (q.method) match['payments.method'] = q.method;
  const elem = lineFilter(q, '');
  if (Object.keys(elem).length) match.items = { $elemMatch: elem };
  return match;
}

/** Inicio del periodo (YYYY-MM-DD) de una fecha, igual que periods.ts (semana desde lunes). */
function periodExpr(field: string, granularity: Granularity, timezone: string) {
  return {
    $dateToString: {
      format: '%Y-%m-%d',
      timezone,
      date: { $dateTrunc: { date: field, unit: granularity, timezone, startOfWeek: 'monday' } },
    },
  };
}

/** Ventas por renglón agrupadas primero por ticket (para contar tickets) y luego por `key`. */
function lineStages(q: LineFilters, ticketKey: Record<string, unknown> = {}): PipelineStage[] {
  const filter = lineFilter(q, 'items.');
  return [
    { $unwind: '$items' },
    ...(Object.keys(filter).length ? [{ $match: filter }] : []),
    {
      $group: {
        _id: { sale: '$_id', ...ticketKey },
        sales: { $sum: '$items.lineTotalCents' },
        cost: { $sum: '$items.lineCostCents' },
        tax: { $sum: '$items.taxCents' },
        lines: { $sum: 1 },
      },
    },
  ];
}

export interface Totals {
  salesCents: number;
  costCents: number;
  profitCents: number;
  marginBp: number;
  taxCents: number;
  tickets: number;
  avgTicketCents: number;
  lines: number;
  cancelledCount: number;
  cancelledCents: number;
  purchasesCents: number;
}

async function totals(
  scope: ReportScope,
  q: ReportQuery,
  from: string,
  to: string,
  until?: number,
): Promise<Totals> {
  const sum = (status: 'completed' | 'cancelled') =>
    Sale.aggregate<{ sales: number; cost: number; tax: number; lines: number; tickets: number }>([
      { $match: saleMatch(scope, q, from, to, status, until) },
      ...lineStages(q),
      {
        $group: {
          _id: null,
          sales: { $sum: '$sales' },
          cost: { $sum: '$cost' },
          tax: { $sum: '$tax' },
          lines: { $sum: '$lines' },
          tickets: { $sum: 1 },
        },
      },
    ]);
  const [[done], [cancelled], purchasesCents] = await Promise.all([
    sum('completed'),
    sum('cancelled'),
    purchasesTotal(scope, q, from, to, until),
  ]);
  const salesCents = done?.sales ?? 0;
  const costCents = done?.cost ?? 0;
  const tickets = done?.tickets ?? 0;
  return {
    salesCents,
    costCents,
    profitCents: salesCents - costCents,
    marginBp: ratioBp(salesCents - costCents, salesCents),
    taxCents: done?.tax ?? 0,
    tickets,
    avgTicketCents: average(salesCents, tickets),
    lines: done?.lines ?? 0,
    cancelledCount: cancelled?.tickets ?? 0,
    cancelledCents: cancelled?.sales ?? 0,
    purchasesCents,
  };
}

/** Productos de una categoría (las compras no guardan categoría: se filtra por producto). */
async function productIdsOf(scope: ReportScope, categoryId: string): Promise<Types.ObjectId[]> {
  return Product.find({
    categoryId: oid(categoryId),
    ...(scope.businessId && { businessId: scope.businessId }),
  }).distinct('_id');
}

async function purchasesTotal(
  scope: ReportScope,
  q: Pick<ReportQuery, 'categoryId' | 'productId'>,
  from: string,
  to: string,
  until?: number,
): Promise<number> {
  const productIds = q.productId
    ? [oid(q.productId)]
    : q.categoryId
      ? await productIdsOf(scope, q.categoryId)
      : null;
  const [row] = await Purchase.aggregate<{ total: number }>([
    { $match: purchaseMatch(scope, from, to, until) },
    ...(productIds
      ? [{ $unwind: '$items' }, { $match: { 'items.productId': { $in: productIds } } }]
      : []),
    {
      $group: {
        _id: null,
        total: { $sum: productIds ? '$items.lineTotalCents' : '$totalCents' },
      },
    },
  ]);
  return row?.total ?? 0;
}

function purchaseMatch(
  scope: ReportScope,
  from: string,
  to: string,
  until?: number,
): Record<string, unknown> {
  return {
    status: 'active',
    purchasedAt: dateRange(scope.timezone, from, to, until),
    ...(scope.businessId && { businessId: scope.businessId }),
  };
}

/**
 * KPIs del rango y del periodo con que se compara (para mostrar "↑ 12 %"): el anterior del mismo
 * largo, o `compareFrom`–`compareTo`. Con `until`, el último día de ambos termina a esa hora.
 */
export async function summary(scope: ReportScope, q: SummaryQuery) {
  const previous =
    q.compareFrom && q.compareTo
      ? { from: q.compareFrom, to: q.compareTo }
      : previousRange(q.from, q.to);
  const until = minutesOf(q.until);
  const [current, before] = await Promise.all([
    totals(scope, q, q.from, q.to, until),
    totals(scope, q, previous.from, previous.to, until),
  ]);
  return {
    from: q.from,
    to: q.to,
    until: q.until ?? null,
    previous: { ...previous, totals: before },
    totals: current,
  };
}

/** Ventas, costo, ganancia y tickets por día/semana/mes/año, sin huecos. */
export async function salesSeries(scope: ReportScope, q: ReportQuery) {
  const granularity = q.granularity ?? autoGranularity(q.from, q.to);
  const rows = await Sale.aggregate<{ _id: string; sales: number; cost: number; tickets: number }>([
    { $match: saleMatch(scope, q, q.from, q.to) },
    ...lineStages(q, { period: periodExpr('$createdAt', granularity, scope.timezone) }),
    {
      $group: {
        _id: '$_id.period',
        sales: { $sum: '$sales' },
        cost: { $sum: '$cost' },
        tickets: { $sum: 1 },
      },
    },
  ]);
  const byPeriod = new Map(rows.map((r) => [r._id, r]));
  return {
    granularity,
    points: enumeratePeriods(q.from, q.to, granularity).map((period) => {
      const row = byPeriod.get(period);
      const salesCents = row?.sales ?? 0;
      const costCents = row?.cost ?? 0;
      const tickets = row?.tickets ?? 0;
      return {
        period,
        salesCents,
        costCents,
        profitCents: salesCents - costCents,
        tickets,
        avgTicketCents: average(salesCents, tickets),
      };
    }),
  };
}

const TOP_SORT_FIELD = {
  amount: 'salesCents',
  profit: 'profitCents',
  qty: 'qtyBase',
  tickets: 'tickets',
} as const;

/** Lo más vendido (por importe, ganancia, cantidad dentro de una unidad o número de tickets). */
export async function topProducts(scope: ReportScope, q: TopProductsQuery) {
  const field = TOP_SORT_FIELD[q.sort];
  const filter = lineFilter(q, 'items.');
  const [rows, [whole]] = await Promise.all([
    Sale.aggregate<{
      _id: Types.ObjectId;
      code: string;
      name: string;
      unit: Unit;
      qtyBase: number;
      salesCents: number;
      costCents: number;
      profitCents: number;
      tickets: number;
    }>([
      { $match: saleMatch(scope, q, q.from, q.to) },
      { $sort: { createdAt: 1 } }, // el último nombre usado gana ($last)
      { $unwind: '$items' },
      ...(Object.keys(filter).length ? [{ $match: filter }] : []),
      {
        $group: {
          _id: '$items.productId',
          code: { $last: '$items.code' },
          name: { $last: '$items.name' },
          unit: { $last: '$items.unit' },
          qtyBase: { $sum: '$items.qtyBase' },
          salesCents: { $sum: '$items.lineTotalCents' },
          costCents: { $sum: '$items.lineCostCents' },
          tickets: { $sum: 1 },
        },
      },
      { $addFields: { profitCents: { $subtract: ['$salesCents', '$costCents'] } } },
      { $sort: { [field]: -1, _id: 1 } },
      { $limit: q.limit },
    ]),
    Sale.aggregate<{ sales: number }>([
      { $match: saleMatch(scope, q, q.from, q.to) },
      { $unwind: '$items' },
      ...(Object.keys(filter).length ? [{ $match: filter }] : []),
      { $group: { _id: null, sales: { $sum: '$items.lineTotalCents' } } },
    ]),
  ]);
  const totalSales = whole?.sales ?? 0;
  return {
    sort: q.sort,
    totalSalesCents: totalSales,
    items: rows.map((r, index) => ({
      rank: index + 1,
      productId: String(r._id),
      code: r.code,
      name: r.name,
      unit: r.unit,
      qtyBase: r.qtyBase,
      salesCents: r.salesCents,
      costCents: r.costCents,
      profitCents: r.profitCents,
      marginBp: ratioBp(r.profitCents, r.salesCents),
      tickets: r.tickets,
      shareBp: ratioBp(r.salesCents, totalSales),
    })),
  };
}

/** Ventas y ganancia por categoría (la del momento de la venta). */
export async function byCategory(scope: ReportScope, q: ReportQuery) {
  const rows = await Sale.aggregate<{
    _id: Types.ObjectId | null;
    sales: number;
    cost: number;
    tickets: number;
  }>([
    { $match: saleMatch(scope, q, q.from, q.to) },
    ...lineStages(q, { category: '$items.categoryId' }),
    {
      $group: {
        _id: '$_id.category',
        sales: { $sum: '$sales' },
        cost: { $sum: '$cost' },
        tickets: { $sum: 1 },
      },
    },
    { $sort: { sales: -1 } },
  ]);
  const names = new Map(
    (
      await Category.find({ _id: { $in: rows.map((r) => r._id).filter(Boolean) } }).select('name')
    ).map((c) => [String(c._id), c.name]),
  );
  const total = rows.reduce((sum, r) => sum + r.sales, 0);
  return {
    totalSalesCents: total,
    items: rows.map((r) => ({
      categoryId: r._id ? String(r._id) : null,
      name: (r._id && names.get(String(r._id))) || 'Sin categoría',
      salesCents: r.sales,
      costCents: r.cost,
      profitCents: r.sales - r.cost,
      marginBp: ratioBp(r.sales - r.cost, r.sales),
      tickets: r.tickets,
      shareBp: ratioBp(r.sales, total),
    })),
  };
}

/**
 * Formas de pago, cajeros y horas pico. Con filtro de categoría o producto cuenta SOLO el importe
 * de los renglones que coinciden (asignado a la forma de pago, cajero y hora de su ticket), así
 * que la suma de formas de pago es igual a las ventas del resumen con los mismos filtros.
 */
export async function payments(scope: ReportScope, q: ReportQuery) {
  const match = saleMatch(scope, q, q.from, q.to);
  const filter = lineFilter(q, 'items.');
  // Por ticket: importe que cuenta (los renglones filtrados, o el ticket completo).
  const perSale: PipelineStage[] = Object.keys(filter).length
    ? [
        { $match: match },
        { $unwind: '$items' },
        { $match: filter },
        {
          $group: {
            _id: '$_id',
            matched: { $sum: '$items.lineTotalCents' },
            total: { $first: '$totalCents' },
            payments: { $first: '$payments' },
            cashierId: { $first: '$cashierId' },
            cashierName: { $first: '$cashierName' },
            createdAt: { $first: '$createdAt' },
          },
        },
      ]
    : [{ $match: match }, { $addFields: { matched: '$totalCents', total: '$totalCents' } }];

  const [methods, cashiers, hours] = await Promise.all([
    Sale.aggregate<{ _id: PaymentMethod; amount: number; tickets: number }>([
      ...perSale,
      // Reparte el importe del ticket entre sus pagos con redondeo ACUMULADO: cada pago recibe
      // round(importe·acumulado/total) − lo ya repartido, así la suma da exacto el importe (un solo
      // pago = su importe completo).
      {
        $set: {
          payments: {
            $getField: {
              field: 'out',
              input: {
                $reduce: {
                  input: '$payments',
                  initialValue: { cum: 0, given: 0, out: [] },
                  in: {
                    $let: {
                      vars: { cum: { $add: ['$$value.cum', '$$this.amountCents'] } },
                      in: {
                        $let: {
                          vars: {
                            upTo: {
                              $cond: [
                                { $gt: ['$total', 0] },
                                {
                                  $floor: {
                                    $add: [
                                      { $divide: [{ $multiply: ['$matched', '$$cum'] }, '$total'] },
                                      0.5,
                                    ],
                                  },
                                },
                                0,
                              ],
                            },
                          },
                          in: {
                            cum: '$$cum',
                            given: '$$upTo',
                            out: {
                              $concatArrays: [
                                '$$value.out',
                                [
                                  {
                                    method: '$$this.method',
                                    amountCents: { $subtract: ['$$upTo', '$$value.given'] },
                                  },
                                ],
                              ],
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      { $unwind: '$payments' },
      ...(q.method ? [{ $match: { 'payments.method': q.method } }] : []),
      {
        $group: {
          _id: '$payments.method',
          amount: { $sum: '$payments.amountCents' },
          tickets: { $sum: 1 },
        },
      },
    ]),
    Sale.aggregate<{ _id: Types.ObjectId; name: string; sales: number; tickets: number }>([
      ...perSale,
      { $sort: { createdAt: 1 } },
      {
        $group: {
          _id: '$cashierId',
          name: { $last: '$cashierName' },
          sales: { $sum: '$matched' },
          tickets: { $sum: 1 },
        },
      },
      { $sort: { sales: -1, _id: 1 } },
    ]),
    Sale.aggregate<{ _id: { weekday: number; hour: number }; sales: number; tickets: number }>([
      ...perSale,
      {
        $group: {
          _id: {
            weekday: { $isoDayOfWeek: { date: '$createdAt', timezone: scope.timezone } },
            hour: { $hour: { date: '$createdAt', timezone: scope.timezone } },
          },
          sales: { $sum: '$matched' },
          tickets: { $sum: 1 },
        },
      },
    ]),
  ]);
  const total = methods.reduce((sum, m) => sum + m.amount, 0);
  return {
    totalCents: total,
    byMethod: PAYMENT_METHODS.map((method) => {
      const row = methods.find((m) => m._id === method);
      return {
        method,
        amountCents: row?.amount ?? 0,
        tickets: row?.tickets ?? 0,
        shareBp: ratioBp(row?.amount ?? 0, total),
      };
    }),
    byCashier: cashiers.map((c) => ({
      cashierId: String(c._id),
      name: c.name,
      salesCents: c.sales,
      tickets: c.tickets,
      avgTicketCents: average(c.sales, c.tickets),
    })),
    /** weekday ISO: 1 = lunes … 7 = domingo; hour 0–23 (hora local del negocio). */
    hours: hours
      .map((h) => ({
        weekday: h._id.weekday,
        hour: h._id.hour,
        salesCents: h.sales,
        tickets: h.tickets,
      }))
      .sort((a, b) => a.weekday - b.weekday || a.hour - b.hour),
  };
}

/**
 * Compras (entradas de mercancía) por periodo, proveedor y producto. Con producto o categoría
 * cuenta solo esos renglones (el producto manda sobre la categoría, igual que en el resumen).
 */
export async function purchasesReport(scope: ReportScope, q: PurchasesReportQuery) {
  const granularity = q.granularity ?? autoGranularity(q.from, q.to);
  const match: Record<string, unknown> = purchaseMatch(scope, q.from, q.to);
  if (q.supplierId) match.supplierId = oid(q.supplierId);
  const productIds = q.productId
    ? [oid(q.productId)]
    : q.categoryId
      ? await productIdsOf(scope, q.categoryId)
      : null;
  const itemMatch = productIds && { 'items.productId': { $in: productIds } };
  if (itemMatch) Object.assign(match, itemMatch);
  const productStage: PipelineStage[] = itemMatch
    ? [{ $unwind: '$items' }, { $match: itemMatch }]
    : [];
  const amount = itemMatch ? '$items.lineTotalCents' : '$totalCents';

  const [series, suppliers, products] = await Promise.all([
    Purchase.aggregate<{ _id: string; total: number; ids: Types.ObjectId[] }>([
      { $match: match },
      ...productStage,
      {
        $group: {
          _id: periodExpr('$purchasedAt', granularity, scope.timezone),
          total: { $sum: amount },
          ids: { $addToSet: '$_id' },
        },
      },
    ]),
    Purchase.aggregate<{
      _id: Types.ObjectId | null;
      name: string;
      total: number;
      ids: Types.ObjectId[];
    }>([
      { $match: match },
      { $sort: { purchasedAt: 1 } },
      ...productStage,
      {
        $group: {
          _id: '$supplierId',
          name: { $last: '$supplierName' },
          total: { $sum: amount },
          ids: { $addToSet: '$_id' },
        },
      },
      { $sort: { total: -1 } },
    ]),
    Purchase.aggregate<{
      _id: Types.ObjectId;
      code: string;
      name: string;
      unit: Unit;
      qty: number;
      total: number;
    }>([
      { $match: match },
      { $sort: { purchasedAt: 1 } },
      { $unwind: '$items' },
      ...(itemMatch ? [{ $match: itemMatch }] : []),
      {
        $group: {
          _id: '$items.productId',
          code: { $last: '$items.code' },
          name: { $last: '$items.name' },
          unit: { $last: '$items.unit' },
          qty: { $sum: '$items.qtyBase' },
          total: { $sum: '$items.lineTotalCents' },
        },
      },
      { $sort: { total: -1, _id: 1 } },
      { $limit: 50 },
    ]),
  ]);

  const byPeriod = new Map(series.map((s) => [s._id, s]));
  const totalCents = series.reduce((sum, s) => sum + s.total, 0);
  return {
    granularity,
    totalCents,
    count: new Set(series.flatMap((s) => s.ids.map(String))).size,
    points: enumeratePeriods(q.from, q.to, granularity).map((period) => ({
      period,
      totalCents: byPeriod.get(period)?.total ?? 0,
      count: byPeriod.get(period)?.ids.length ?? 0,
    })),
    bySupplier: suppliers.map((s) => ({
      supplierId: s._id ? String(s._id) : null,
      name: s.name || 'Sin proveedor',
      totalCents: s.total,
      count: s.ids.length,
      shareBp: ratioBp(s.total, totalCents),
    })),
    byProduct: products.map((p) => ({
      productId: String(p._id),
      code: p.code,
      name: p.name,
      unit: p.unit,
      qtyBase: p.qty,
      totalCents: p.total,
      /** Costo promedio pagado por unidad de venta (por kg, pieza o litro). */
      avgUnitCostCents: p.qty ? Math.round((p.total * unitScale(p.unit)) / p.qty) : 0,
    })),
  };
}

/** Comparativa entre negocios (superadmin). Los días se cortan en la zona de México. */
export async function businessesReport(q: BusinessesReportQuery) {
  const scope: ReportScope = { businessId: null, timezone: DEFAULT_TIMEZONE };
  const [businesses, sales, purchases] = await Promise.all([
    Business.find().select('name active').sort({ name: 1 }),
    Sale.aggregate<{ _id: Types.ObjectId; sales: number; cost: number; tickets: number }>([
      { $match: saleMatch(scope, {}, q.from, q.to) },
      {
        $group: {
          _id: '$businessId',
          sales: { $sum: '$totalCents' },
          cost: { $sum: '$costCents' },
          tickets: { $sum: 1 },
        },
      },
    ]),
    Purchase.aggregate<{ _id: Types.ObjectId; total: number }>([
      { $match: purchaseMatch(scope, q.from, q.to) },
      { $group: { _id: '$businessId', total: { $sum: '$totalCents' } } },
    ]),
  ]);
  const total = sales.reduce((sum, s) => sum + s.sales, 0);
  return {
    totalSalesCents: total,
    items: businesses
      .map((b) => {
        const s = sales.find((row) => String(row._id) === String(b._id));
        const salesCents = s?.sales ?? 0;
        const costCents = s?.cost ?? 0;
        return {
          businessId: String(b._id),
          name: b.name,
          active: b.active,
          salesCents,
          costCents,
          profitCents: salesCents - costCents,
          marginBp: ratioBp(salesCents - costCents, salesCents),
          tickets: s?.tickets ?? 0,
          avgTicketCents: average(salesCents, s?.tickets ?? 0),
          purchasesCents: purchases.find((row) => String(row._id) === String(b._id))?.total ?? 0,
          shareBp: ratioBp(salesCents, total),
        };
      })
      .sort((a, b) => b.salesCents - a.salesCents || a.name.localeCompare(b.name)),
  };
}
