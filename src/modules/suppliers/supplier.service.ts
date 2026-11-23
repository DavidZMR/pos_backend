import type { QueryFilter } from 'mongoose';
import { conflict, notFound } from '../../common/http/errors.js';
import { toDottedPaths } from '../../common/utils/flatten.js';
import { pageMeta, skipFor } from '../../common/utils/pagination.js';
import { containsRegex, normalizeText } from '../../common/utils/text.js';
import { Supplier, type SupplierData } from './supplier.model.js';
import type {
  CreateSupplierInput,
  ListSuppliersQuery,
  UpdateSupplierInput,
} from './supplier.schemas.js';

async function assertNameAvailable(businessId: string, name: string, exceptId?: string) {
  const taken = await Supplier.exists({
    businessId,
    searchName: normalizeText(name),
    ...(exceptId && { _id: { $ne: exceptId } }),
  });
  if (taken) throw conflict(`Ya existe el proveedor "${name}"`);
}

export async function listSuppliers(businessId: string, query: ListSuppliersQuery) {
  const filter: QueryFilter<SupplierData> = { businessId };
  if (query.search) filter.searchName = containsRegex(query.search);
  if (query.active !== undefined) filter.active = query.active;

  const [items, total] = await Promise.all([
    Supplier.find(filter).sort({ searchName: 1 }).skip(skipFor(query)).limit(query.limit),
    Supplier.countDocuments(filter),
  ]);
  return { items, meta: pageMeta(total, query) };
}

export async function getSupplier(businessId: string, id: string) {
  const supplier = await Supplier.findOne({ _id: id, businessId });
  if (!supplier) throw notFound('Proveedor no encontrado');
  return supplier;
}

export async function createSupplier(businessId: string, input: CreateSupplierInput) {
  await assertNameAvailable(businessId, input.name);
  return Supplier.create({ ...input, businessId });
}

export async function updateSupplier(businessId: string, id: string, input: UpdateSupplierInput) {
  const supplier = await getSupplier(businessId, id);
  if (input.name && input.name !== supplier.name) {
    await assertNameAvailable(businessId, input.name, id);
  }
  supplier.set(toDottedPaths(input));
  await supplier.save();
  return supplier;
}
