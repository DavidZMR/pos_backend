import { z } from 'zod';

export const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i, 'ID inválido');

export const idParamsSchema = z.object({ id: objectIdSchema });

/** Texto opcional: recorta espacios y convierte "" en undefined. */
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Máximo ${max} caracteres`)
    .optional()
    .transform((value) => (value === '' ? undefined : value));
