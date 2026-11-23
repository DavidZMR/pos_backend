/** Campos internos que nunca deben salir en las respuestas del API. */
const HIDDEN_FIELDS = ['_id', 'searchName', 'passwordHash'] as const;

/**
 * Serialización uniforme de documentos: `id` string en lugar de `_id`, sin `__v`
 * ni campos internos. Úsalo en `toJSON` de cada esquema.
 */
export const jsonOptions = {
  virtuals: true,
  versionKey: false,
  transform: (_doc: unknown, ret: Record<string, unknown>) => {
    ret.id = String(ret._id);
    for (const field of HIDDEN_FIELDS) delete ret[field];
    return ret;
  },
};
