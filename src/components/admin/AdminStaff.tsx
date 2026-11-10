'use client';

import * as React from 'react';
import { AdminShell } from '@/components/staff/AdminShell';
import { api } from '@/lib/api-client';
import { useToast } from '@/components/ui/toast';
import { Button } from '@/components/ui/button';
import { Input, Label, Select } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import type { StaffUser } from '@/types';
import { ChangePasswordDialog } from '@/components/staff/ChangePasswordDialog';
import { Check, KeyRound, Plus, ShieldCheck, UserX, X } from 'lucide-react';

type StaffRow = {
  id: string;
  email: string;
  full_name: string;
  role: 'admin' | 'waiter' | 'kitchen';
  is_active: boolean;
  created_at: string;
  last_login_at: string | null;
};

type PasswordRequest = {
  id: string;
  staff_id: string;
  full_name: string;
  email: string;
  role: string;
  requested_at: string;
  expires_at: string;
};

export function AdminStaff({
  user,
  staff: initial,
  requests: initialRequests = [],
}: {
  user: StaffUser;
  staff: StaffRow[];
  requests?: PasswordRequest[];
}) {
  const { push } = useToast();
  const [staff, setStaff] = React.useState(initial);
  const [requests, setRequests] = React.useState(initialRequests);
  const [creating, setCreating] = React.useState(false);
  const [resetting, setResetting] = React.useState<StaffRow | null>(null);
  const [changingOwn, setChangingOwn] = React.useState(false);
  const [deciding, setDeciding] = React.useState<string | null>(null);

  const reload = React.useCallback(async () => {
    const res = await api.get<{ staff: StaffRow[]; requests: PasswordRequest[] }>('/api/admin/staff');
    setStaff(res.staff);
    setRequests(res.requests ?? []);
  }, []);

  // a waiter can ask while this page is open
  React.useEffect(() => {
    const t = setInterval(() => {
      api
        .get<{ requests: PasswordRequest[] }>('/api/admin/password-requests')
        .then((r) => setRequests(r.requests))
        .catch(() => undefined);
    }, 20000);
    return () => clearInterval(t);
  }, []);

  async function decide(req: PasswordRequest, approve: boolean) {
    if (!approve && !confirm(`Reject ${req.full_name}'s password request?`)) return;
    setDeciding(req.id);
    try {
      await api.post(`/api/admin/password-request-${approve ? 'approve' : 'reject'}`, { id: req.id });
      push(approve ? `${req.full_name}'s new password is active` : 'Request rejected', 'success');
    } catch (err) {
      push(err instanceof Error ? err.message : 'Could not update the request', 'error');
    } finally {
      setDeciding(null);
      await reload().catch(() => undefined);
    }
  }

  async function toggleActive(row: StaffRow) {
    try {
      await api.post('/api/admin/staff-update', { id: row.id, isActive: !row.is_active });
      await reload();
      push(row.is_active ? 'Account disabled' : 'Account enabled', 'success');
    } catch (err) {
      push(err instanceof Error ? err.message : 'Could not update', 'error');
    }
  }

  async function changeRole(row: StaffRow, role: StaffRow['role']) {
    try {
      await api.post('/api/admin/staff-update', { id: row.id, role });
      await reload();
      push(`${row.full_name} is now ${role}`, 'success');
    } catch (err) {
      push(err instanceof Error ? err.message : 'Could not change role', 'error');
    }
  }

  async function remove(row: StaffRow) {
    if (!confirm(`Delete ${row.full_name}? They lose access immediately.`)) return;
    try {
      await api.post('/api/admin/staff-delete', { id: row.id });
      await reload();
      push('Account deleted', 'success');
    } catch (err) {
      push(err instanceof Error ? err.message : 'Could not delete', 'error');
    }
  }

  return (
    <AdminShell user={user}>
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            {staff.filter((s) => s.is_active).length} active of {staff.length} accounts
          </p>
          <Button onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> Add staff
          </Button>
        </div>

        {requests.length > 0 && (
          <section
            className="space-y-2 rounded-xl border border-[hsl(var(--warning))] bg-[hsl(var(--warning))]/10 p-3"
            aria-label="Password change requests"
          >
            <p className="flex items-center gap-1.5 text-sm font-bold">
              <KeyRound className="h-4 w-4" /> Password change requests ({requests.length})
            </p>
            {requests.map((req) => (
              <div key={req.id} className="flex items-center gap-2 rounded-lg bg-card p-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">
                    {req.full_name} <span className="text-[11px] font-normal text-muted-foreground">· {req.role}</span>
                  </p>
                  <p className="truncate text-[11px] text-muted-foreground" suppressHydrationWarning>
                    {req.email} · asked {new Date(req.requested_at).toLocaleString()}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={deciding === req.id}
                  onClick={() => decide(req, false)}
                  aria-label={`Reject ${req.full_name}`}
                >
                  <X className="h-4 w-4" /> Reject
                </Button>
                <Button
                  size="sm"
                  loading={deciding === req.id}
                  onClick={() => decide(req, true)}
                  aria-label={`Approve ${req.full_name}`}
                >
                  <Check className="h-4 w-4" /> Approve
                </Button>
              </div>
            ))}
            <p className="text-[11px] text-muted-foreground">
              Approving makes their chosen password work straight away. You never see it.
            </p>
          </section>
        )}

        <div className="space-y-2">
          {staff.map((row) => (
            <article key={row.id} className="rounded-xl border border-border bg-card p-3">
              <div className="flex items-start gap-2">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                  {row.full_name.slice(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 truncate text-sm font-bold">
                    {row.full_name}
                    {row.id === user.id && (
                      <Badge variant="secondary" className="text-[10px]">
                        you
                      </Badge>
                    )}
                  </p>
                  <p className="truncate text-[11px] text-muted-foreground">{row.email}</p>
                  <div className="mt-1.5 flex items-center gap-2">
                    <Select
                      value={row.role}
                      onChange={(e) => changeRole(row, e.target.value as StaffRow['role'])}
                      className="h-8 w-28 text-xs"
                      aria-label={`Role for ${row.full_name}`}
                    >
                      <option value="admin">Admin</option>
                      <option value="waiter">Waiter</option>
                      <option value="kitchen">Kitchen</option>
                    </Select>
                    <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                      <Switch
                        checked={row.is_active}
                        onCheckedChange={() => toggleActive(row)}
                        aria-label={`Active for ${row.full_name}`}
                      />
                      {row.is_active ? 'active' : 'disabled'}
                    </span>
                  </div>
                </div>
                <div className="flex flex-col gap-0.5">
                  <button
                    type="button"
                    onClick={() => (row.id === user.id ? setChangingOwn(true) : setResetting(row))}
                    className="tap rounded-lg text-muted-foreground hover:bg-secondary"
                    aria-label={
                      row.id === user.id ? 'Change your password' : `Reset password for ${row.full_name}`
                    }
                  >
                    <KeyRound className="h-4 w-4" />
                  </button>
                  {row.id !== user.id && (
                    <button
                      type="button"
                      onClick={() => remove(row)}
                      className="tap rounded-lg text-destructive hover:bg-destructive/10"
                      aria-label={`Delete ${row.full_name}`}
                    >
                      <UserX className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>

        <p className="rounded-xl bg-secondary p-3 text-[11px] text-muted-foreground">
          <ShieldCheck className="mr-1 inline h-3 w-3" />
          Waiter and kitchen accounts can never reach admin endpoints — the server checks the role on
          every request, and the database enforces it with Row Level Security.
        </p>
      </div>

      <CreateStaffDialog
        open={creating}
        onClose={() => setCreating(false)}
        onSaved={async () => {
          setCreating(false);
          await reload();
          push('Staff account created', 'success');
        }}
      />

      <ChangePasswordDialog open={changingOwn} onClose={() => setChangingOwn(false)} />

      <ResetPasswordDialog
        staff={resetting}
        onClose={() => setResetting(null)}
        onSaved={async () => {
          setResetting(null);
          push('Password reset — share it with them privately', 'success');
        }}
      />
    </AdminShell>
  );
}

function CreateStaffDialog({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { push } = useToast();
  const [busy, setBusy] = React.useState(false);
  const [form, setForm] = React.useState({
    fullName: '',
    email: '',
    role: 'waiter' as StaffRow['role'],
    password: '',
  });

  function generate() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
    let out = '';
    for (let i = 0; i < 12; i++) out += chars[Math.floor(Math.random() * chars.length)];
    setForm((f) => ({ ...f, password: `${out}7` }));
  }

  async function save() {
    setBusy(true);
    try {
      await api.post('/api/admin/staff', form);
      await onSaved();
      setForm({ fullName: '', email: '', role: 'waiter', password: '' });
    } catch (err) {
      push(err instanceof Error ? err.message : 'Could not create account', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Add staff account" description="They can sign in at /staff/login straight away.">
        <div className="space-y-3">
          <div>
            <Label htmlFor="s-name">Full name</Label>
            <Input
              id="s-name"
              value={form.fullName}
              onChange={(e) => setForm({ ...form, fullName: e.target.value })}
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="s-email">Email</Label>
            <Input
              id="s-email"
              type="email"
              inputMode="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="s-role">Role</Label>
            <Select
              id="s-role"
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value as StaffRow['role'] })}
              className="mt-1"
            >
              <option value="waiter">Waiter — confirm orders, answer calls</option>
              <option value="kitchen">Kitchen — preparing / ready</option>
              <option value="admin">Admin — full control</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="s-pass">Temporary password</Label>
            <div className="mt-1 flex gap-2">
              <Input
                id="s-pass"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                minLength={8}
              />
              <Button type="button" variant="outline" onClick={generate}>
                Generate
              </Button>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              At least 8 characters with letters and numbers.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={onClose}>
              Cancel
            </Button>
            <Button
              className="flex-1"
              onClick={save}
              loading={busy}
              disabled={!form.email || !form.fullName || form.password.length < 8}
            >
              Create account
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ResetPasswordDialog({
  staff,
  onClose,
  onSaved,
}: {
  staff: StaffRow | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { push } = useToast();
  const [password, setPassword] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  async function save() {
    if (!staff) return;
    setBusy(true);
    try {
      await api.post('/api/admin/staff-update', { id: staff.id, password });
      await onSaved();
      setPassword('');
    } catch (err) {
      push(err instanceof Error ? err.message : 'Could not reset password', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={Boolean(staff)} onOpenChange={(o) => !o && onClose()}>
      {staff && (
        <DialogContent
          title={`Reset password · ${staff.full_name}`}
          description="The new password takes effect immediately. Share it privately."
        >
          <Input
            type="text"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="New password (8+ chars, letters and numbers)"
          />
          <div className="mt-3 flex gap-2">
            <Button variant="outline" className="flex-1" onClick={onClose}>
              Cancel
            </Button>
            <Button className="flex-1" onClick={save} loading={busy} disabled={password.length < 8}>
              Reset password
            </Button>
          </div>
        </DialogContent>
      )}
    </Dialog>
  );
}
