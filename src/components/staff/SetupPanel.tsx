'use client';

import * as React from 'react';
import Link from 'next/link';
import { api } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, CircleAlert, Database, Download, Users } from 'lucide-react';

type Status = {
  mode: string;
  restaurant: { id: string; name: string; slug: string } | null;
  counts: { staff: number; tables: number; items: number; questions: number };
  demoPassword: string;
};

export function SetupPanel() {
  const { push } = useToast();
  const [status, setStatus] = React.useState<Status | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    try {
      setStatus(await api.get<Status>('/api/setup'));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Database not reachable');
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function seedStaff() {
    setBusy(true);
    try {
      const res = await api.post<{ created: string[]; skipped: string[]; password: string }>('/api/setup');
      push(`Staff ready: ${res.created.length} created, ${res.skipped.length} existing`, 'success');
      await load();
    } catch (err) {
      push(err instanceof Error ? err.message : 'Could not create demo staff', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <section className="rounded-2xl border border-border bg-card p-4">
        <h2 className="flex items-center gap-2 text-sm font-bold">
          <Database className="h-4 w-4" /> Database
        </h2>
        {error ? (
          <p className="mt-2 flex items-center gap-2 text-sm text-destructive">
            <CircleAlert className="h-4 w-4" /> {error}
          </p>
        ) : !status ? (
          <p className="mt-2 text-sm text-muted-foreground">Checking…</p>
        ) : (
          <div className="mt-2 space-y-1 text-sm">
            <p>
              Mode: <Badge variant="secondary">{status.mode === 'pglite' ? 'local (PGlite)' : 'PostgreSQL / Supabase'}</Badge>
            </p>
            <p>
              Restaurant: <strong>{status.restaurant?.name ?? '— none —'}</strong>
            </p>
            <ul className="mt-2 grid grid-cols-2 gap-1 text-xs text-muted-foreground">
              <li>Staff accounts: {status.counts.staff}</li>
              <li>Tables: {status.counts.tables}</li>
              <li>Menu items: {status.counts.items}</li>
              <li>Quiz questions: {status.counts.questions}</li>
            </ul>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-border bg-card p-4">
        <h2 className="flex items-center gap-2 text-sm font-bold">
          <Users className="h-4 w-4" /> Demo staff logins
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Creates admin@spiceroute.test, waiter@spiceroute.test and kitchen@spiceroute.test with the
          password below. Safe to run more than once.
        </p>
        {status && (
          <p className="mt-2 rounded-lg bg-secondary p-2 font-mono text-xs">
            password: {status.demoPassword}
          </p>
        )}
        <div className="mt-3 flex gap-2">
          <Button onClick={seedStaff} loading={busy}>
            Seed staff logins
          </Button>
          <Button asChild variant="outline">
            <Link href="/staff/login">Go to sign in</Link>
          </Button>
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-card p-4">
        <h2 className="text-sm font-bold">Table QR codes</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Generate a printable A4 sheet with one card per table (QR + NFC URL). Run once after
          creating your tables:
        </p>
        <pre className="mt-2 overflow-x-auto rounded-lg bg-secondary p-2 text-[11px]">
{`NEXT_PUBLIC_APP_URL=https://your-domain.com npm run qr:pdf`}
        </pre>
        <p className="mt-2 flex items-center gap-1 text-[11px] text-muted-foreground">
          <Download className="h-3 w-3" /> Output: <code>public/table-qr-codes.pdf</code> — signed in
          admins can also download it from Admin → Tables.
        </p>
      </section>

      <section className="rounded-2xl border border-dashed border-border p-4 text-xs text-muted-foreground">
        <p className="flex items-center gap-2 font-semibold text-foreground">
          <CheckCircle2 className="h-4 w-4 text-[hsl(var(--success))]" /> Next steps
        </p>
        <ol className="mt-2 list-decimal space-y-1 pl-4">
          <li>Sign in as admin and open Admin → Settings to add your logo, colours and Wi-Fi.</li>
          <li>Replace the demo menu with your dishes (Admin → Menu).</li>
          <li>Create your tables, then print the QR sheet.</li>
          <li>Install the waiter and kitchen apps on your staff phones (Add to Home Screen).</li>
        </ol>
      </section>
    </div>
  );
}
