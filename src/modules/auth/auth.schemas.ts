import { z } from 'zod';

/** bcrypt solo considera los primeros 72 bytes. */
export const passwordSchema = z
  .string()
  .min(8, 'La contraseña debe tener al menos 8 caracteres')
  .max(72, 'La contraseña debe tener máximo 72 caracteres');

export const loginSchema = z.object({
  username: z.string().trim().toLowerCase().min(1, 'Escribe tu usuario'),
  password: z.string().min(1, 'Escribe tu contraseña'),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Escribe tu contraseña actual'),
  newPassword: passwordSchema,
});

export type LoginInput = z.infer<typeof loginSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
