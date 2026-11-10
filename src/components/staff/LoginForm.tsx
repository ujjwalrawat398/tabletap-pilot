'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { AlertCircle, Eye, EyeOff } from 'lucide-react';

const DEMO = [
  { role: 'Admin', email: 'admin@spiceroute.test' },
  { role: 'Waiter', email: 'waiter@spiceroute.test' },
  { role: 'Kitchen', email: 'kitchen@spiceroute.test' },
];

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [show, setShow] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ redirect: string }>('/api/staff/login', { email, password });
      router.replace(res.redirect);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not sign in');
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          type="email"
          autoComplete="username"
          inputMode="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-1"
          placeholder="you@restaurant.com"
        />
      </div>

      <div>
        <Label htmlFor="password">Password</Label>
        <div className="relative mt-1">
          <Input
            id="password"
            type={show ? 'text' : 'password'}
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="pr-12"
          />
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            className="tap absolute right-0 top-0 text-muted-foreground"
            aria-label={show ? 'Hide password' : 'Show password'}
          >
            {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {error && (
        <p role="alert" className="flex items-start gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </p>
      )}

      <Button type="submit" size="lg" className="w-full" loading={busy}>
        Sign in
      </Button>

      <div className="rounded-xl border border-dashed border-border p-3">
        <p className="text-xs font-semibold text-muted-foreground">Demo accounts (password: Demo@1234)</p>
        <div className="mt-1 space-y-1">
          {DEMO.map((d) => (
            <button
              key={d.email}
              type="button"
              onClick={() => {
                setEmail(d.email);
                setPassword('Demo@1234');
              }}
              className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-xs hover:bg-secondary"
            >
              <span className="font-medium">{d.role}</span>
              <span className="font-mono text-muted-foreground">{d.email}</span>
            </button>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Run <code className="rounded bg-secondary px-1">npm run seed:staff</code> once to create them.
        </p>
      </div>
    </form>
  );
}
