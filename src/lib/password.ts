import { scrypt as scryptCb, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

/**
 * Password hashing for local/self-hosted staff accounts.
 * On Supabase, credentials live in Supabase Auth instead (also hashed with
 * bcrypt server-side) — this module is never used there.
 */
export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

export async function verifyPassword(password: string, stored: string) {
  const [scheme, saltB64, keyB64] = stored.split('$');
  if (scheme !== 'scrypt' || !saltB64 || !keyB64) return false;
  const key = await scrypt(password, Buffer.from(saltB64, 'base64url'), 64);
  const expected = Buffer.from(keyB64, 'base64url');
  return key.length === expected.length && timingSafeEqual(key, expected);
}

export function passwordProblem(password: string): string | null {
  if (password.length < 8) return 'Password must be at least 8 characters.';
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password))
    return 'Password must contain letters and numbers.';
  return null;
}
