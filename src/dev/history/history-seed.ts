/**
 * Historial ficticio para probar reportes (solo `npm run dev:memory -- --history`; nunca Atlas).
 * Sobre la demo de El Atlántico agrega productos, cajeros y ~14 meses de ventas, compras,
 * producción, mermas, cambios de precio, cancelaciones y cortes; más un segundo negocio
 * (Abarrotes La Esquina) para la comparativa del superadmin. Reproducible con la misma semilla.
 */
import type { Types } from 'mongoose';
import { addDays, calendarDateInZone, startOfDayInZone } from '../../common/utils/dates.js';
import { normalizeText } from '../../common/utils/text.js';
import { hashPassword } from '../../modules/auth/password.js';
import { Business } from '../../modules/businesses/business.model.js';
import { CashSession } from '../../modules/cash-sessions/cash-session.model.js';
import { Category } from '../../modules/categories/category.model.js';
import { Counter } from '../../modules/counters/counter.model.js';
import { InventoryMovement as Movement } from '../../modules/inventory/movement.model.js';
import { PriceHistory } from '../../modules/products/price-history.model.js';
import { Product } from '../../modules/products/product.model.js';
import { createProduct } from '../../modules/products/product.service.js';
import { Purchase } from '../../modules/purchases/purchase.model.js';
import { Sale } from '../../modules/sales/sale.model.js';
import { Supplier } from '../../modules/suppliers/supplier.model.js';
import { User } from '../../modules/users/user.model.js';
import { DEMO_PASSWORD } from '../demo-seed.js';
import {
  ATLANTICO_EXTRA,
  ATLANTICO_PROFILES,
  type DemandProfile,
  ESQUINA_PRODUCTS,
  ESQUINA_PROFILES,
  type ExtraProduct,
  type SupplierKey,
} from './catalog.js';
import { createRng } from './random.js';
import { type Person, type SimOutput, type SimProduct, simulateHistory } from './simulate.js';

export interface HistoryOptions {
  months?: number;
  seed?: number;
  now?: Date;
}

export interface HistoryStats {
  business: string;
  from: string;
  sales: number;
  cancelled: number;
  purchases: number;
  sessions: number;
  movements: number;
  products: number;
}

const FALLBACK_PROFILE: DemandProfile = {
  weight: 1,
  qtyMin: 1,
  qtyMax: 2,
  step: 1,
  supplier: 'bahia',
};

export async function seedHistory(options: HistoryOptions = {}): Promise<HistoryStats[]> {
  const months = options.months ?? 14;
  const now = options.now ?? new Date();
  const rng = createRng(options.seed ?? 20_261_122);
  const passwordHash = await hashPassword(DEMO_PASSWORD);

  // ---- El Atlántico ----------------------------------------------------------------------
  const atlantico = await Business.findOne({ name: 'El Atlántico' });
  const admin = await User.findOne({ username: 'demo.admin' });
  const caja = await User.findOne({ username: 'demo.caja' });
  if (!atlantico || !admin || !caja) throw new Error('Primero corre la demo (--seed)');

  const extraCashiers = await User.create([
    {
      name: 'Lupita Ortega',
      username: 'demo.caja2',
      passwordHash,
      role: 'employee',
      businessId: atlantico._id,
    },
    {
      name: 'Jorge Salas',
      username: 'demo.caja3',
      passwordHash,
      role: 'employee',
      businessId: atlantico._id,
    },
  ]);
  await Category.create({
    businessId: atlantico._id,
    name: 'Congelados',
    searchName: 'congelados',
  });
  await Supplier.create([
    { businessId: atlantico._id, name: 'Congeladora del Pacífico', contactName: 'Ing. Rivas' },
    { businessId: atlantico._id, name: 'Verduras Doña Chela', contactName: 'Doña Chela' },
  ]);
  const atlanticoStats = await simulateBusiness({
    businessId: atlantico._id,
    timezone: atlantico.timezone,
    actor: admin,
    extraProducts: ATLANTICO_EXTRA,
    profiles: ATLANTICO_PROFILES,
    supplierNames: {
      puerto: 'Pescadería del Puerto',
      bahia: 'Distribuidora Bahía',
      congeladora: 'Congeladora del Pacífico',
      verduras: 'Verduras Doña Chela',
    },
    cashiers: [caja, ...extraCashiers],
    ticketsPerDay: 34,
    shifts: [
      { open: 9 * 60, close: 15 * 60 },
      { open: 15 * 60, close: 21 * 60 },
    ],
    months,
    now,
    rng,
  });

  // ---- Abarrotes La Esquina (para comparar negocios) --------------------------------------
  const esquina = await Business.findOne({ name: 'Abarrotes La Esquina' });
  if (!esquina) throw new Error('Falta el negocio Abarrotes La Esquina de la demo');
  const rosa = await User.create({
    name: 'Rosa Medina',
    username: 'demo.esquina',
    passwordHash,
    role: 'admin',
    businessId: esquina._id,
  });
  const categories = [...new Set(ESQUINA_PRODUCTS.map((p) => p[2]))];
  await Category.insertMany(
    categories.map((name) => ({ businessId: esquina._id, name, searchName: normalizeText(name) })),
  );
  await Supplier.create({ businessId: esquina._id, name: 'Abastos Central', contactName: 'Toño' });
  const esquinaStats = await simulateBusiness({
    businessId: esquina._id,
    timezone: esquina.timezone,
    actor: rosa,
    extraProducts: ESQUINA_PRODUCTS,
    profiles: ESQUINA_PROFILES,
    supplierNames: { esquina: 'Abastos Central' },
    cashiers: [rosa],
    ticketsPerDay: 18,
    shifts: [{ open: 8 * 60, close: 21 * 60 }],
    months,
    now,
    rng,
  });

  return [
    { business: 'El Atlántico', ...atlanticoStats },
    { business: 'Abarrotes La Esquina', ...esquinaStats },
  ];
}

interface BusinessPlan {
  businessId: Types.ObjectId;
  timezone: string;
  actor: { _id: Types.ObjectId; name: string };
  extraProducts: ExtraProduct[];
  profiles: Record<string, DemandProfile>;
  supplierNames: Partial<Record<SupplierKey, string>>;
  cashiers: { _id: Types.ObjectId; name: string }[];
  ticketsPerDay: number;
  shifts: { open: number; close: number }[];
  months: number;
  now: Date;
  rng: ReturnType<typeof createRng>;
}

async function simulateBusiness(plan: BusinessPlan): Promise<Omit<HistoryStats, 'business'>> {
  const { businessId, timezone } = plan;
  const actor = { id: String(plan.actor._id), name: plan.actor.name };

  // Productos extra con existencia inicial (kárdex "inicial" y precio de alta, como en la app).
  const categories = await Category.find({ businessId });
  for (const [
    code,
    name,
    category,
    unit,
    price,
    cost,
    stock,
    min,
    taxRateBp,
  ] of plan.extraProducts) {
    await createProduct(String(businessId), actor, {
      code,
      name,
      unit,
      categoryId: categories.find((c) => c.name === category)?.id,
      salePriceCents: price,
      costCents: cost,
      initialStock: Math.round(stock),
      minStock: Math.round(min),
      taxRateBp,
    });
  }

  // Todo lo dado de alta "hoy" se fecha al inicio del historial.
  const startDate = addDays(
    calendarDateInZone(plan.now, timezone),
    -Math.round(plan.months * 30.44),
  );
  const start = startOfDayInZone(startDate, timezone);
  await Product.collection.updateMany(
    { businessId },
    { $set: { createdAt: start, updatedAt: start } },
  );
  await Movement.collection.updateMany(
    { businessId, type: 'initial' },
    { $set: { createdAt: start } },
  );
  await PriceHistory.collection.updateMany(
    { businessId, source: 'create' },
    { $set: { createdAt: start } },
  );

  const suppliers: Partial<Record<SupplierKey, Person>> = {};
  for (const [key, name] of Object.entries(plan.supplierNames) as [SupplierKey, string][]) {
    const supplier = await Supplier.findOne({ businessId, name });
    if (!supplier) throw new Error(`Falta el proveedor ${name}`);
    suppliers[key] = { id: supplier._id, name: supplier.name };
  }

  const products = await Product.find({ businessId }).lean();
  const simProducts: SimProduct[] = products.map((p) => ({
    id: p._id,
    code: p.code,
    name: p.name,
    unit: p.unit,
    categoryId: p.categoryId ?? null,
    taxRateBp: p.taxRateBp,
    priceCents: p.salePriceCents,
    costCents: p.costCents,
    stock: p.stock,
    baseCostCents: p.costCents,
    profile: plan.profiles[p.code] ?? FALLBACK_PROFILE,
  }));

  const result = simulateHistory({
    businessId,
    timezone,
    startDate,
    now: plan.now,
    products: simProducts,
    cashiers: plan.cashiers.map((c) => ({ id: c._id, name: c.name })),
    admin: { id: plan.actor._id, name: plan.actor.name },
    suppliers,
    ticketsPerDay: plan.ticketsPerDay,
    shifts: plan.shifts,
    rng: plan.rng,
    folios: { sale: 0, purchase: 0, session: 0 },
  });
  await persist(businessId, result, plan.now);

  return {
    from: startDate,
    sales: result.sales.length,
    cancelled: result.sales.filter((s) => s.status === 'cancelled').length,
    purchases: result.purchases.length,
    sessions: result.sessions.length,
    movements: result.movements.length,
    products: result.products.length,
  };
}

async function persist(businessId: Types.ObjectId, result: SimOutput, now: Date): Promise<void> {
  const insert = async (
    collection: { insertMany(docs: object[]): Promise<unknown> },
    docs: object[],
  ) => {
    for (let i = 0; i < docs.length; i += 5000)
      await collection.insertMany(docs.slice(i, i + 5000));
  };
  await insert(Sale.collection, result.sales);
  await insert(Movement.collection, result.movements);
  await insert(Purchase.collection, result.purchases);
  await insert(PriceHistory.collection, result.priceHistory);
  await insert(CashSession.collection, result.sessions);

  await Product.bulkWrite(
    result.products.map((p) => ({
      updateOne: {
        filter: { _id: p.id },
        update: {
          $set: {
            stock: p.stock,
            costCents: p.costCents,
            salePriceCents: p.priceCents,
            updatedAt: now,
          },
        },
        timestamps: false,
      },
    })),
  );
  for (const [key, seq] of [
    ['sale', result.folios.sale],
    ['purchase', result.folios.purchase],
    ['cash-session', result.folios.session],
  ] as const) {
    await Counter.updateOne({ businessId, key }, { $set: { seq } }, { upsert: true });
  }
}
