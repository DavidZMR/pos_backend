import type { QueryFilter } from 'mongoose';
import { conflict, notFound } from '../../common/http/errors.js';
import { pageMeta, skipFor } from '../../common/utils/pagination.js';
import { containsRegex, normalizeText } from '../../common/utils/text.js';
import { Category, type CategoryData } from './category.model.js';
import type {
  CreateCategoryInput,
  ListCategoriesQuery,
  UpdateCategoryInput,
} from './category.schemas.js';

async function assertNameAvailable(businessId: string, name: string, exceptId?: string) {
  const taken = await Category.exists({
    businessId,
    searchName: normalizeText(name),
    ...(exceptId && { _id: { $ne: exceptId } }),
  });
  if (taken) throw conflict(`Ya existe la categoría "${name}"`);
}

export async function listCategories(businessId: string, query: ListCategoriesQuery) {
  const filter: QueryFilter<CategoryData> = { businessId };
  if (query.search) filter.searchName = containsRegex(query.search);
  if (query.active !== undefined) filter.active = query.active;

  const [items, total] = await Promise.all([
    Category.find(filter).sort({ searchName: 1 }).skip(skipFor(query)).limit(query.limit),
    Category.countDocuments(filter),
  ]);
  return { items, meta: pageMeta(total, query) };
}

export async function getCategory(businessId: string, id: string) {
  const category = await Category.findOne({ _id: id, businessId });
  if (!category) throw notFound('Categoría no encontrada');
  return category;
}

export async function createCategory(businessId: string, input: CreateCategoryInput) {
  await assertNameAvailable(businessId, input.name);
  return Category.create({ businessId, name: input.name });
}

export async function updateCategory(businessId: string, id: string, input: UpdateCategoryInput) {
  const category = await getCategory(businessId, id);
  if (input.name && input.name !== category.name) {
    await assertNameAvailable(businessId, input.name, id);
    category.name = input.name;
  }
  if (input.active !== undefined) category.active = input.active;
  await category.save();
  return category;
}
