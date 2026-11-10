import { dbHealth } from '@/server/db';
import { DemoLauncher } from '@/components/DemoLauncher';

export const dynamic = 'force-dynamic';

/**
 * Landing page. Customers arrive by QR/NFC and staff by URL, so this is mostly
 * a demo/onboarding entry point: one button prepares the demo accounts and hands
 * you the guest link, the staff logins and the admin panel.
 */
export default async function LandingPage() {
  const health = await dbHealth();

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 p-6">
      <div>
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-2xl font-black text-primary-foreground">
          T
        </div>
        <h1 className="mt-4 text-3xl font-black tracking-tight">TableTap</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          NFC &amp; QR table ordering for restaurants and cafés. Guests order from their phone — no
          app, no login. Staff confirm, cook and serve from installable web apps.
        </p>
      </div>

      <DemoLauncher dbOk={health.ok} dbMode={health.mode} />

      <div className="rounded-xl border border-border bg-card p-4 text-xs text-muted-foreground">
        <p className="font-semibold text-foreground">How to use this build</p>
        <ol className="mt-1.5 list-decimal space-y-1 pl-4">
          <li>Press <strong>Start the demo</strong> — it creates the sample restaurant, menu and staff logins.</li>
          <li>Open the guest link (or scan the QR PDF) on your phone.</li>
          <li>Sign in as <strong>waiter</strong> to confirm the order, then <strong>kitchen</strong> to cook it.</li>
          <li>Sign in as <strong>admin</strong> for menu, tables, reports, games and settings.</li>
        </ol>
      </div>

      <p className="text-center text-[11px] text-muted-foreground">
        Built by U&amp;D Digital Studio · {health.mode === 'pglite' ? 'local demo database' : 'PostgreSQL'} ·{' '}
        {health.ok ? 'connected' : 'not connected'}
      </p>
    </main>
  );
}
