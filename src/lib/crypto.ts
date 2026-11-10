import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

/** 32 random bytes, url-safe: the token that lives in the customer cookie. */
export function newSessionToken() {
  return randomBytes(32).toString('base64url');
}

/** Long random table code printed on the NFC tag / QR (never the table number). */
export function newTableCode() {
  return randomBytes(9).toString('base64url').replace(/[-_]/g, 'x');
}

export function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

export function safeEqual(a: string, b: string) {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export function hmac(value: string, secret: string) {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

export function signPayload(payload: object, secret: string) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${hmac(body, secret)}`;
}

export function verifyPayload<T>(token: string, secret: string): T | null {
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  if (!safeEqual(sig, hmac(body, secret))) return null;
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString()) as T;
  } catch {
    return null;
  }
}

/**
 * AES-256-GCM for short-lived secrets that must be read back later (a password a
 * staff member asked for, until an admin approves it). The key is derived from the
 * server secret and a purpose label; `aad` ties the ciphertext to one database row,
 * so a blob copied onto another row cannot be decrypted.
 */
function secretKey(secret: string, purpose: string) {
  return createHmac('sha256', secret).update(`enc:${purpose}`).digest();
}

export function encryptSecret(plain: string, secret: string, purpose: string, aad: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', secretKey(secret, purpose), iv);
  cipher.setAAD(Buffer.from(aad));
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv, tag, body].map((part) => (typeof part === 'string' ? part : part.toString('base64url'))).join('.');
}

/** Returns null for anything that is not an intact ciphertext made with the same secret, purpose and aad. */
export function decryptSecret(token: string, secret: string, purpose: string, aad: string): string | null {
  try {
    const [version, iv, tag, body] = token.split('.');
    if (version !== 'v1' || !iv || !tag || !body) return null;
    const decipher = createDecipheriv('aes-256-gcm', secretKey(secret, purpose), Buffer.from(iv, 'base64url'));
    decipher.setAAD(Buffer.from(aad));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}
