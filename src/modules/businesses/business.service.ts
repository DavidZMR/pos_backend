import type { QueryFilter } from 'mongoose';
import { notFound } from '../../common/http/errors.js';
import { toDottedPaths } from '../../common/utils/flatten.js';
import { pageMeta, skipFor } from '../../common/utils/pagination.js';
import { containsRegex } from '../../common/utils/text.js';
import { Business, type BusinessData } from './business.model.js';
import type {
  CreateBusinessInput,
  ListBusinessesQuery,
  UpdateBusinessInput,
  UpdateCurrentBusinessInput,
} from './business.schemas.js';

export async function listBusinesses(query: ListBusinessesQuery) {
  const filter: QueryFilter<BusinessData> = {};
  if (query.search) filter.searchName = containsRegex(query.search);
  if (query.active !== undefined) filter.active = query.active;

  const [items, total] = await Promise.all([
    Business.find(filter).sort({ name: 1 }).skip(skipFor(query)).limit(query.limit),
    Business.countDocuments(filter),
  ]);
  return { items, meta: pageMeta(total, query) };
}

export async function getBusiness(id: string) {
  const business = await Business.findById(id);
  if (!business) throw notFound('Negocio no encontrado');
  return business;
}

export function createBusiness(input: CreateBusinessInput) {
  return Business.create(input);
}

/** Actualización parcial que respeta subdocumentos (ticket.header no borra ticket.footer). */
export async function updateBusiness(
  id: string,
  input: UpdateBusinessInput | UpdateCurrentBusinessInput,
) {
  const business = await getBusiness(id);
  business.set(toDottedPaths(input));
  await business.save();
  return business;
}

export async function deactivateBusiness(id: string) {
  return updateBusiness(id, { active: false });
}
