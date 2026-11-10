/**
 * Runs once when the Next.js server starts. A misconfigured production
 * deployment (no DATABASE_URL) must not boot at all, the same way a weak
 * SESSION_SECRET is refused.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  // `next build` evaluates the app without serving it; only guard a real server.
  if (process.env.NEXT_PHASE === 'phase-production-build') return;
  const { assertProductionConfig } = await import('./src/lib/env');
  assertProductionConfig();
}
