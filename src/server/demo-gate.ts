import 'server-only';
import { dbMode } from '@/server/db';

/**
 * One gate for everything that exists only for demos and tests:
 * /api/setup, /api/demo/seed, /api/demo/reset, /api/dev/clock and the /setup page.
 *
 * Fails closed:
 *   - never on a real Postgres / Supabase database (dbMode === 'pg'), whatever DEMO_MODE says,
 *     so a live restaurant can never get known-password logins or be wiped;
 *   - DEMO_MODE=off | false  -> never
 *   - DEMO_MODE=on  | true   -> yes (explicit opt-in, e.g. a local production demo)
 *   - unset                  -> only outside production
 */
export function demoAllowed(): boolean {
  if (dbMode !== 'pglite') return false;
  const flag = process.env.DEMO_MODE?.toLowerCase();
  if (flag === 'off' || flag === 'false') return false;
  if (flag === 'on' || flag === 'true') return true;
  return process.env.NODE_ENV !== 'production';
}

/** Kept as a separate name for the routes that wipe or rewrite data; same rule as demoAllowed(). */
export function embeddedDemoAllowed(): boolean {
  return demoAllowed();
}
