/**
 * Single source of truth for configuration.
 * Two supported modes:
 *  1. Supabase mode (production): DATABASE_URL or SUPABASE_* vars present.
 *  2. Local mode (dev / demo): PGlite database embedded in the app process.
 */
export const env = {
  NODE_ENV: process.env.NODE_ENV ?? 'development',
  APP_URL: process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000',
  DATABASE_URL: process.env.DATABASE_URL,
  SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  RESEND_API_KEY: process.env.RESEND_API_KEY,
  PUSH_PUBLIC_KEY: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
  PUSH_PRIVATE_KEY: process.env.VAPID_PRIVATE_KEY,
  PUSH_SUBJECT: process.env.VAPID_SUBJECT ?? 'mailto:owner@example.com',
} as const;

export const isProd = env.NODE_ENV === 'production';

/**
 * HMAC key for the staff session cookie.
 *
 * Deliberately a function, not a constant: `next build` evaluates modules, so a
 * throw at import time would break the build instead of the request. In
 * production a missing, short or placeholder secret is a hard error — otherwise
 * a forgotten env var silently ships a forgeable staff cookie.
 */
export const DEV_SESSION_SECRET = 'dev-only-insecure-secret-change-me';

export function getSessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  const weak =
    !secret || secret.length < 32 || secret.includes('change-me') || secret === DEV_SESSION_SECRET;
  if (weak) {
    if (isProd) {
      throw new Error(
        'SESSION_SECRET is missing or too weak for production: set a random value of at least ' +
          '32 characters (e.g. `openssl rand -base64 48`) and redeploy.',
      );
    }
    return DEV_SESSION_SECRET;
  }
  return secret;
}
/**
 * Production must run on a real Postgres. The embedded database lives in the
 * process, so a forgotten DATABASE_URL would silently serve a restaurant from
 * memory (and lose every order on restart). The only way past this is the
 * explicit DEMO_MODE=on, e.g. a local production demo.
 * Called when the server boots (instrumentation.ts) and again before the
 * embedded database is created.
 */
export function assertProductionConfig(): void {
  if (process.env.NODE_ENV !== 'production') return;
  if (process.env.DATABASE_URL) return;
  const demo = process.env.DEMO_MODE?.toLowerCase();
  if (demo === 'on' || demo === 'true') return;
  throw new Error(
    'DATABASE_URL is required in production: set it to your Supabase/Postgres connection string ' +
      'and redeploy. (For a throwaway local demo only, set DEMO_MODE=on.)',
  );
}

export const isSupabaseMode = Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);
export const isLocalMode = !isSupabaseMode;
