import { z } from 'zod';

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export interface PageMeta {
  total: number;
  page: number;
  limit: number;
  pages: number;
}

export function skipFor({ page, limit }: PaginationQuery): number {
  return (page - 1) * limit;
}

export function pageMeta(total: number, { page, limit }: PaginationQuery): PageMeta {
  return { total, page, limit, pages: Math.max(1, Math.ceil(total / limit)) };
}

/** Booleanos en query string: "true"/"false"/"1"/"0". */
export const booleanQuery = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1');
