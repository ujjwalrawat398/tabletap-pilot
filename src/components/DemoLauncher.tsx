'use client';

import * as React from 'react';
import Link from 'next/link';
import { api } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';
import { ArrowRight, Copy, Loader2, PlayCircle, ShieldCheck } from 'lucide-react';

type DemoInfo = {
  demoAllowed: boolean;
  mode: string;
  staffCount: number;
  demoTable: { code: string; number: number } | null;
};

type SeedResult = {
  restaurant: string;
  created: string[];
  refreshed: string[];
  demoTable: { code: string; number: number } | null;
  password: string;
};

export function DemoLauncher({ dbOk, dbMode }: { dbOk: boolean; dbMode: string }) {
  const { push } = useToast();
  const [info, setInfo] = React.useState<DemoInfo | null>(null);
  const [result, setResult] = React.useState<SeedResult | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    try {
      setInfo(await api.get<DemoInfo>('/api/demo/seed'));
      setError(null);
    } catch {
      setError('Database not reachable yet.');
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function start() {
    setBusy(true);
    try {
      const res = await api.post<SeedResult>('/api/demo/seed');
      setResult(res);
      await load();
      push(
        res.created.length ? `Demo ready — ${res.created.length} staff logins created` : 'Demo already set up',
        'success',
      );
    } catch (err) {
      push(err instanceof Error ? err.message : 'Could not prepare the demo', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      push('Link copied', 'success');
    } catch {
      push('Copy failed', 'error');
    }
  }

  if (error || !dbOk) {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm">
        <p className="font-semibold text-destructive">The database is not ready</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Start the app with <code className="rounded bg-secondary px-1">npm run dev</code> and reload.
          Migrations and the demo data are created on first boot.
        </p>
        <Button size="sm" variant="outline" className="mt-3" onClick={load}>
          Retry
        </Button>
      </div>
    );
  }

  const table = result?.demoTable ?? info?.demoTable ?? null;
  const ready = (info?.staffCount ?? 0) > 0 || Boolean(result);

  return (
    <div className="space-y-3">
      <Button size="lg" className="w-full" onClick={start} loading={busy}>
        <PlayCircle className="h-5 w-5" />
        {ready ? 'Reset the demo accounts' : 'Start the demo'}
      </Button>

      {result && (
        <div className="rounded-xl border border-[hsl(var(--success))]/30 bg-[hsl(var(--success))]/5 p-3 text-xs">
          <p className="flex items-center gap-1.5 font-semibold">
            <ShieldCheck className="h-4 w-4 text-[hsl(var(--success))]" />
            {result.restaurant} is ready
          </p>
          <p className="mt-1 text-muted-foreground">
            {result.created.length ? `Created: ${result.created.join(', ')}` : 'Accounts already existed'}
            {result.refreshed.length ? ` · password reset: ${result.refreshed.join(', ')}` : ''}
          </p>
          <p className="mt-1 text-muted-foreground">
            Password for all demo accounts:{' '}
            <code className="rounded bg-secondary px-1 font-semibold">{result.password}</code>
          </p>
        </div>
      )}

      {!result && info && !info.demoAllowed && (
        <p className="text-xs text-muted-foreground">
          Demo reset is off on this deployment. Sign in with the credentials from{' '}
          <code className="rounded bg-secondary px-1">npm run seed:staff</code>.
        </p>
      )}

      <div className="space-y-2">
        {table && (
          <div className="flex items-center gap-2 rounded-xl border border-border bg-card p-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold">Guest view · Table {table.number}</p>
              <p className="truncate font-mono text-[11px] text-muted-foreground">
                {typeof window !== 'undefined' ? window.location.origin : ''}/t/{table.code}
              </p>
            </div>
            <button
              type="button"
              onClick={() => copy(`${window.location.origin}/t/${table.code}`)}
              className="tap rounded-lg text-muted-foreground hover:bg-secondary"
              aria-label="Copy guest link"
            >
              <Copy className="h-4 w-4" />
            </button>
            <Button asChild size="sm">
              <Link href={`/t/${table.code}`}>
                Open <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
          </div>
        )}

        <div className="grid grid-cols-3 gap-2">
          {[
            { href: '/staff/login', label: 'Waiter', email: 'waiter@spiceroute.test' },
            { href: '/staff/login', label: 'Kitchen', email: 'kitchen@spiceroute.test' },
            { href: '/staff/login', label: 'Admin', email: 'admin@spiceroute.test' },
          ].map((item) => (
            <Link
              key={item.email}
              href={item.href}
              className="flex min-h-[72px] flex-col justify-center rounded-xl border border-border bg-card p-2 text-center"
            >
              <span className="text-xs font-bold">{item.label}</span>
              <span className="mt-0.5 break-all text-[9px] leading-tight text-muted-foreground">
                {item.email}
              </span>
            </Link>
          ))}
        </div>

        <div className="flex items-center justify-between rounded-xl bg-secondary p-3 text-xs">
          <span className="text-muted-foreground">Database</span>
          <Badge variant="secondary">{dbMode === 'pglite' ? 'embedded (demo)' : 'PostgreSQL'}</Badge>
        </div>
      </div>
    </div>
  );
}
