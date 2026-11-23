import { type ClientSession, type QueryFilter, Types } from 'mongoose';
import { badRequest, fieldConflict, notFound } from '../../common/http/errors.js';
import { type PaginationQuery, pageMeta, skipFor } from '../../common/utils/pagination.js';
import { containsRegex, escapeRegex } from '../../common/utils/text.js';
import { withTransaction } from '../../db/transaction.js';
import type { AuthUser } from '../../types/express.js';
import { Category } from '../categories/category.model.js';
import { applyStockChange, InventoryMovement } from '../inventory/movement.model.js';
import { PriceHistory, type PriceSource } from './price-history.model.js';
import { Product, type ProductData, type ProductDocument } from './product.model.js';
import type {
  CreateProductInput,
  ListProductsQuery,
  UpdateProductInput,
} from './product.schemas.js';

type Actor = Pick<AuthUser, 'id' | 'name'>;

async function assertCodeAvailable(businessId: string, code: string, exceptId?: string) {
  const taken = await Product.exists({
    businessId,
    code,
    ...(exceptId && { _id: { $ne: exceptId } }),
  });
  if (taken) throw fieldConflict('code', `El código "${code}" ya está en uso`);
}

async function assertBarcodeAvailable(businessId: string, barcode: string, exceptId?: string) {
  const taken = await Product.exists({
    businessId,
    barcode,
    ...(exceptId && { _id: { $ne: exceptId } }),
  });
  if (taken) throw fieldConflict('barcode', `El código de barras "${barcode}" ya está en uso`);
}

async function assertCategory(businessId: string, categoryId: string | null | undefined) {
  if (!categoryId) return;
  if (!(await Category.exists({ _id: categoryId, businessId }))) {
    throw badRequest('La categoría no existe en este negocio', {
      fieldErrors: { categoryId: ['Categoría inválida'] },
    });
  }
}

/** Registra en la bitácora de precios si cambió el precio de venta o el costo. */
export async function recordPriceChange(
  product: ProductDocument,
  previous: { salePriceCents: number; costCents: number } | null,
  source: PriceSource,
  actor: Actor,
  session: ClientSession,
  ref?: { id: string; folio: string },
) {
  if (
    previous &&
    previous.salePriceCents === product.salePriceCents &&
    previous.costCents === product.costCents
  ) {
    return;
  }
  await PriceHistory.create(
    [
      {
        businessId: product.businessId,
        productId: product._id,
        salePriceCents: product.salePriceCents,
        costCents: product.costCents,
        previousSalePriceCents: previous?.salePriceCents ?? null,
        previousCostCents: previous?.costCents ?? null,
        source,
        refId: ref?.id ?? null,
        refFolio: ref?.folio ?? '',
        userId: actor.id,
        userName: actor.name,
      },
    ],
    { session },
  );
}

export async function listProducts(businessId: string, query: ListProductsQuery) {
  const filter: QueryFilter<ProductData> = { businessId };
  if (query.search) {
    const term = query.search.trim();
    filter.$or = [
      { code: new RegExp(`^${escapeRegex(term.toUpperCase())}`) },
      { barcode: term },
      { searchName: containsRegex(term) },
    ];
  }
  if (query.categoryId) filter.categoryId = query.categoryId;
  if (query.active !== undefined) filter.active = query.active;
  if (query.stock === 'out') filter.stock = { $lte: 0 };
  if (query.stock === 'low') {
    filter.minStock = { $gt: 0 };
    filter.$expr = { $lte: ['$stock', '$minStock'] };
  }

  const sortField = query.sort === 'name' ? 'searchName' : query.sort;
  const direction = query.order === 'asc' ? 1 : -1;
  const [items, total] = await Promise.all([
    Product.find(filter)
      .sort({ [sortField]: direction, _id: 1 })
      .skip(skipFor(query))
      .limit(query.limit),
    Product.countDocuments(filter),
  ]);
  return { items, meta: pageMeta(total, query) };
}

export async function getProduct(businessId: string, id: string) {
  const product = await Product.findOne({ _id: id, businessId });
  if (!product) throw notFound('Producto no encontrado');
  return product;
}

/** Búsqueda exacta por código corto o código de barras (lector / tecleo rápido). */
export async function lookupProduct(businessId: string, code: string) {
  const product = await Product.findOne({
    businessId,
    active: true,
    $or: [{ code: code.toUpperCase() }, { barcode: code }],
  });
  if (!product) throw notFound(`No hay un producto con el código "${code}"`);
  return product;
}

/** Siguiente código numérico libre (máximo código numérico + 1). */
export async function suggestNextCode(businessId: string): Promise<string> {
  const [top] = await Product.aggregate<{ n: number }>([
    { $match: { businessId: new Types.ObjectId(businessId), code: /^\d{1,9}$/ } },
    { $project: { n: { $toLong: '$code' } } },
    { $sort: { n: -1 } },
    { $limit: 1 },
  ]);
  return String((top?.n ?? 0) + 1);
}

export async function createProduct(businessId: string, actor: Actor, input: CreateProductInput) {
  await assertCodeAvailable(businessId, input.code);
  if (input.barcode) await assertBarcodeAvailable(businessId, input.barcode);
  await assertCategory(businessId, input.categoryId);

  const { initialStock, barcode, ...fields } = input;
  return withTransaction(async (session) => {
    const [product] = await Product.create(
      [{ ...fields, ...(barcode && { barcode }), businessId, stock: 0 }],
      { session },
    );
    if (!product) throw new Error('No se pudo crear el producto');
    await recordPriceChange(product, null, 'create', actor, session);
    if (initialStock > 0) {
      await applyStockChange({
        product,
        qtyDelta: initialStock,
        type: 'initial',
        actor,
        session,
        note: 'Existencia inicial',
      });
    }
    return product;
  });
}

export async function updateProduct(
  businessId: string,
  actor: Actor,
  id: string,
  input: UpdateProductInput,
) {
  const product = await getProduct(businessId, id);

  if (input.code && input.code !== product.code)
    await assertCodeAvailable(businessId, input.code, id);
  if (input.barcode && input.barcode !== product.barcode) {
    await assertBarcodeAvailable(businessId, input.barcode, id);
  }
  if (input.categoryId !== undefined) await assertCategory(businessId, input.categoryId);
  if (input.unit && input.unit !== product.unit) {
    if (await InventoryMovement.exists({ businessId, productId: id })) {
      throw fieldConflict(
        'unit',
        'No se puede cambiar la unidad de un producto que ya tiene movimientos',
      );
    }
  }

  const previous = { salePriceCents: product.salePriceCents, costCents: product.costCents };
  const { barcode, ...fields } = input;
  product.set(fields);
  if (barcode !== undefined) product.set('barcode', barcode === '' ? undefined : barcode);

  return withTransaction(async (session) => {
    await product.save({ session });
    await recordPriceChange(product, previous, 'manual', actor, session);
    return product;
  });
}

export async function listPriceHistory(
  businessId: string,
  productId: string,
  query: PaginationQuery,
) {
  await getProduct(businessId, productId);
  const filter = { businessId, productId };
  const [items, total] = await Promise.all([
    PriceHistory.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip(skipFor(query))
      .limit(query.limit),
    PriceHistory.countDocuments(filter),
  ]);
  return { items, meta: pageMeta(total, query) };
}
