import { z } from 'zod';

export const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i, 'ID inválido');

export const idParamsSchema = z.object({ id: objectIdSchema });

/**
 * Texto opcional recortado. "" se conserva para poder **borrar** el campo al editar
 * (omitir la propiedad = no cambiarla).
 */
export const optionalText = (max: number) =>
  z.string().trim().max(max, `Máximo ${max} caracteres`).optional();
