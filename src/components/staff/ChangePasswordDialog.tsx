'use client';

import * as React from 'react';
import { api } from '@/lib/api-client';
import { useToast } from '@/components/ui/toast';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Clock, ShieldCheck } from 'lucide-react';

type RequestState = {
  status: 'pending' | 'approved' | 'rejected' | 'cancelled' | 'expired';
  requested_at: string;
  decided_at: string | null;
  decision_note: string | null;
} | null;

type Info = { needsApproval: boolean; request: RequestState };

/**
 * "Change password" for any signed-in staff member.
 *  - admin: applied immediately (the current password is still required)
 *  - waiter / kitchen: becomes a request that an admin approves under Admin → Staff
 */
export function ChangePasswordDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { push } = useToast();
  const [info, setInfo] = React.useState<Info | null>(null);
  const [current, setCurrent] = React.useState('');
  const [next, setNext] = React.useState('');
  const [confirm, setConfirm] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    try {
      setInfo(await api.get<Info>('/api/staff/password'));
    } catch {
      setInfo(null);
    }
  }, []);

  React.useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const reset = () => {
    setCurrent('');
    setNext('');
    setConfirm('');
  };

  const mismatch = confirm.length > 0 && confirm !== next;
  const weak = next.length > 0 && (next.length < 8 || !/[A-Za-z]/.test(next) || !/[0-9]/.test(next));
  const ready = current.length > 0 && next.length >= 8 && !weak && confirm === next;
  const needsApproval = info?.needsApproval ?? true;
  const pending = info?.request?.status === 'pending';

  async function submit() {
    setBusy(true);
    try {
      const res = await api.post<{ applied: boolean; pending: boolean }>('/api/staff/password', {
        currentPassword: current,
        newPassword: next,
      });
      reset();
      if (res.applied) {
        push('Password changed. Use it the next time you sign in.', 'success');
        onClose();
      } else {
        push('Request sent. An admin has to approve it.', 'success');
        await load();
      }
    } catch (err) {
      push(err instanceof Error ? err.message : 'Could not change the password', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function withdraw() {
    setBusy(true);
    try {
      await api.del('/api/staff/password');
      await load();
      push('Request withdrawn', 'success');
    } catch (err) {
      push(err instanceof Error ? err.message : 'Could not withdraw the request', 'error');
    } finally {
      setBusy(false);
    }
  }

  const last = info?.request;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          reset();
          onClose();
        }
      }}
    >
      <DialogContent
        title="Change password"
        description={
          needsApproval
            ? 'Your new password only starts working after an admin approves it.'
            : 'Takes effect immediately. Use it the next time you sign in.'
        }
      >
        <div className="space-y-3">
          {pending && (
            <div className="flex items-start gap-2 rounded-xl bg-[hsl(var(--warning))]/15 p-3 text-xs">
              <Clock className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="flex-1">
                <p className="font-semibold">Waiting for admin approval</p>
                <p className="text-muted-foreground">
                  Sent {new Date(last!.requested_at).toLocaleString()}. Your old password keeps working until then.
                  Sending a new request replaces this one.
                </p>
                <button type="button" onClick={withdraw} disabled={busy} className="mt-1 font-semibold underline">
                  Withdraw request
                </button>
              </div>
            </div>
          )}
          {!pending && last?.status === 'approved' && (
            <p className="rounded-xl bg-[hsl(var(--success))]/12 p-3 text-xs font-semibold text-[hsl(var(--success))]">
              <ShieldCheck className="mr-1 inline h-4 w-4" />
              Your last request was approved. Sign in with the new password next time.
            </p>
          )}
          {!pending && last?.status === 'rejected' && (
            <p className="rounded-xl bg-destructive/10 p-3 text-xs text-destructive">
              Your last request was rejected{last.decision_note ? `: ${last.decision_note}` : '.'} Ask the admin, or
              send a new one.
            </p>
          )}
          {!pending && last?.status === 'expired' && (
            <p className="rounded-xl bg-secondary p-3 text-xs text-muted-foreground">
              Your last request expired without an answer. Send a new one.
            </p>
          )}

          <div>
            <Label htmlFor="pw-current">Current password</Label>
            <Input
              id="pw-current"
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="pw-new">New password</Label>
            <Input
              id="pw-new"
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              className="mt-1"
            />
            <p className={`mt-1 text-[11px] ${weak ? 'text-destructive' : 'text-muted-foreground'}`}>
              At least 8 characters with letters and numbers.
            </p>
          </div>
          <div>
            <Label htmlFor="pw-confirm">Repeat new password</Label>
            <Input
              id="pw-confirm"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="mt-1"
            />
            {mismatch && <p className="mt-1 text-[11px] text-destructive">The two passwords do not match.</p>}
          </div>

          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={onClose}>
              Close
            </Button>
            <Button className="flex-1" onClick={submit} loading={busy} disabled={!ready}>
              {needsApproval ? 'Send for approval' : 'Change password'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
