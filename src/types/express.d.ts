import type { Role } from '../modules/users/user.model.js';

export interface AuthUser {
  id: string;
  name: string;
  username: string;
  role: Role;
  businessId: string | null;
}

declare global {
  namespace Express {
    interface Request {
      /** Usuario autenticado (lo pone `authenticate`). */
      user?: AuthUser;
      /** Negocio sobre el que opera la petición (lo pone `resolveTenant`). */
      businessId?: string;
    }
  }
}
