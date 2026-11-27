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
  try {
    assertProductionConfig();
  } catch (err) {
    // A throw from register() is logged by Next.js but the server keeps
    // serving pages with a dead database. Fail closed for real: exit.
    console.error(
      '[tabletap] Refusing to start:',
      err instanceof Error ? err.message : String(err),
    );
    process.exit(1);
  }
}
