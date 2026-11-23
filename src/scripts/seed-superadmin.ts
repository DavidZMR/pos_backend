/**
 * Crea el primer superadmin.
 *   npm run seed:superadmin -- --username <usuario> --password <contraseña> --name "<Nombre>"
 */
import { parseArgs } from 'node:util';
import { env } from '../config/index.js';
import { connectDatabase, disconnectDatabase } from '../db/connection.js';
import { passwordSchema } from '../modules/auth/auth.schemas.js';
import { hashPassword } from '../modules/auth/password.js';
import { User } from '../modules/users/user.model.js';

const { values } = parseArgs({
  options: {
    username: { type: 'string' },
    password: { type: 'string' },
    name: { type: 'string', default: 'Super administrador' },
  },
});

async function main() {
  const username = values.username?.trim().toLowerCase();
  const password = values.password;
  if (!username || !password) {
    throw new Error('Uso: npm run seed:superadmin -- --username <usuario> --password <contraseña>');
  }
  passwordSchema.parse(password);

  await connectDatabase(env.MONGODB_URI, { retries: 1 });

  if (await User.exists({ username })) {
    console.log(`El usuario "${username}" ya existe; no se modificó.`);
    return;
  }

  await User.create({
    name: values.name,
    username,
    passwordHash: await hashPassword(password),
    role: 'superadmin',
    businessId: null,
  });
  console.log(`Superadmin "${username}" creado.`);
}

main()
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => disconnectDatabase());
