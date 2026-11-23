import bcrypt from 'bcryptjs';

const ROUNDS = process.env.NODE_ENV === 'test' ? 4 : 10;

/** Hash fijo para comparar cuando el usuario no existe y no revelar por tiempo de respuesta si existe. */
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', ROUNDS);

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, ROUNDS);
}

export function verifyPassword(plain: string, hash: string | undefined | null): Promise<boolean> {
  return bcrypt.compare(plain, hash ?? DUMMY_HASH).then((ok) => ok && Boolean(hash));
}
