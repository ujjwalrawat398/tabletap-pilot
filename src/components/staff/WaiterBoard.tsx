'use client';

import * as React from 'react';
import { api } from '@/lib/api-client';
import { useToast } from '@/components/ui/toast';
import { StaffShell } from '@/components/staff/StaffShell';
import { useStaffFeed } from '@/components/staff/useStaffFeed';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/input';
import { cn, money, timeAgo } from '@/lib/utils';
import type { OrderView, StaffUser, TableCard, WaiterCall } from '@/types';
import {
  BellRing,
  Check,
  ChefHat,
  Clock,
  Flame,
  LayoutGrid,
  Receipt,
  RefreshCw,
  ReceiptText,
  X,
} from 'lucide-react';

export type StaffOtpCard = {
  id: string;
  table_id: string;
  table_number: number;
  table_label: string | null;
  code: string;
  created_at: string;
  expires_at: string;
  attempts: number;
  max_attempts: number;
  state: 'live' | 'locked' | 'expired';
  seconds_left: number;
  seconds_since_request: number;
  table_state: 'free' | 'open';
  session_id: string | null;
  open_minutes: number;
  phones: number;
  joined_phones: number;
  session_items: number;
  session_total: number;
  overdue: boolean;
  admin_alert: boolean;
};

type BoardData = {
  tables: TableCard[];
  pending: OrderView[];
  calls: WaiterCall[];
  kitchen: OrderView[];
  otps?: StaffOtpCard[];
};

type TableDetail = {
  table: { id: string; number: number; label: string | null; zone: string | null; table_code: string };
  session: { id: string; created_at: string; expires_at: string } | null;
  fullOrders: {
    id: string;
    batch_no: number;
    status: string;
    total: number;
    created_at: string;
    notes: string | null;
    rejected_reason: string | null;
    session_started_at?: string | null;
    session_devices?: number;
    items: { name_snapshot: string; qty: number; notes: string | null; unit_price: number; added_by_guest: number }[];
  }[];
  calls: WaiterCall[];
};

function tableTone(table: TableCard) {
  if (table.bill_requests > 0) return 'bg-fuchsia-600 text-white border-fuchsia-700';
  if (table.open_calls > 0) return 'bg-orange-500 text-white border-orange-600';
  if (table.pending_orders > 0) return 'bg-amber-400 text-black border-amber-500';
  if (table.status === 'occupied') return 'bg-blue-600 text-white border-blue-700';
  return 'bg-card text-foreground border-border';
}

/** big, unambiguous digits: a waiter reads these out loud across a noisy room */
function CodeChip({
  code,
  tone,
  state,
  tableNumber,
}: {
  code: string;
  tone: 'live' | 'warn' | 'dead';
  state: string;
  tableNumber: number;
}) {
  return (
    <span
      data-code-state={state}
      data-table-number={tableNumber}
      className={cn(
        'select-all rounded-lg px-2 py-1 font-mono text-2xl font-black tracking-[0.35em]',
        tone === 'live' && 'bg-emerald-600 text-white',
        tone === 'warn' && 'bg-red-600 text-white',
        tone === 'dead' && 'bg-muted text-muted-foreground line-through',
      )}
      aria-label={`code ${code.split('').join(' ')}`}
    >
      {code}
    </span>
  );
}

function tableLabel(table: TableCard) {
  if (table.bill_requests > 0) return 'Bill';
  if (table.open_calls > 0) return 'Called';
  if (table.pending_orders > 0) return 'Order';
  if (table.status === 'occupied') return 'Seated';
  return 'Free';
}

export function WaiterBoard({
  user,
  initial,
  sounds,
}: {
  user: StaffUser;
  initial: BoardData;
  sounds: Record<string, string>;
}) {
  const { push } = useToast();
  const [data, setData] = React.useState<BoardData>(initial);
  const [now, setNow] = React.useState(Date.now());
  const [selected, setSelected] = React.useState<TableCard | null>(null);
  const [detail, setDetail] = React.useState<TableDetail | null>(null);
  const [detailLoading, setDetailLoading] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [rejecting, setRejecting] = React.useState<OrderView | null>(null);
  const [reason, setReason] = React.useState('');
  const openRequest = React.useRef(0); // id of the newest table-detail request

  const loadBoard = React.useCallback(async () => {
    try {
      const res = await api.get<BoardData>('/api/waiter/board');
      setData({
        tables: res.tables,
        pending: res.pending,
        calls: res.calls,
        kitchen: res.kitchen,
        otps: res.otps ?? [],
      });
    } catch (err) {
      if (err instanceof Error && /sign in/i.test(err.message)) {
        window.location.href = '/staff/login';
      }
    }
  }, []);

  const fetchFingerprint = React.useCallback(async () => {
    const res = await api.get<{ fingerprint: string }>('/api/staff/events');
    return res.fingerprint;
  }, []);

  useStaffFeed({
    restaurantId: user.restaurant_id,
    sounds: {
      new_order: sounds.new_order ?? 'chime',
      waiter_call: sounds.waiter_call ?? 'bell',
      bill_request: sounds.bill_request ?? 'cash',
      order_ready: sounds.order_ready ?? 'ding',
      otp_request: sounds.otp_request ?? 'otp',
    },
    onEvent: () => {
      void loadBoard();
    },
    fetchFingerprint,
    pollMs: 5000,
  });

  React.useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  // refresh every 15s even in realtime mode (safety net)
  React.useEffect(() => {
    const timer = setInterval(loadBoard, 15000);
    return () => clearInterval(timer);
  }, [loadBoard]);

  async function openTable(table: TableCard) {
    const requestId = ++openRequest.current;
    setSelected(table);
    setDetail(null);
    setDetailLoading(true);
    try {
      const res = await api.get<TableDetail>(`/api/waiter/table?id=${table.id}`);
      // a newer tap happened while this was loading: its answer is the one to show
      if (requestId !== openRequest.current || res.table.id !== table.id) return;
      setDetail(res);
    } catch (err) {
      if (requestId === openRequest.current) {
        push(err instanceof Error ? err.message : 'Could not open the table', 'error');
      }
    } finally {
      if (requestId === openRequest.current) setDetailLoading(false);
    }
  }

  async function decide(order: OrderView, action: 'confirm' | 'reject', why?: string) {
    setBusy(order.id + action);
    try {
      await api.post('/api/waiter/order', { orderId: order.id, action, reason: why });
      push(action === 'confirm' ? `Table ${order.table_number} confirmed` : 'Order rejected', 'success');
      await loadBoard();
      if (selected) await openTable(selected);
      setRejecting(null);
      setReason('');
    } catch (err) {
      push(err instanceof Error ? err.message : 'Could not update the order', 'error');
    } finally {
      setBusy(null);
    }
  }

  async function handleCall(callId: string) {
    setBusy(callId);
    try {
      await api.post('/api/waiter/call', { callId });
      await loadBoard();
      if (selected) await openTable(selected);
    } catch (err) {
      push(err instanceof Error ? err.message : 'Could not clear the call', 'error');
    } finally {
      setBusy(null);
    }
  }

  async function dismissCode(otpId: string) {
    setBusy('otp' + otpId);
    try {
      await api.post('/api/waiter/otp-dismiss', { otpId });
      await loadBoard();
    } catch (err) {
      push(err instanceof Error ? err.message : 'Could not dismiss the code', 'error');
    } finally {
      setBusy(null);
    }
  }

  async function newCode(tableId: string) {
    setBusy('raise' + tableId);
    try {
      await api.post('/api/waiter/otp-raise', { tableId });
      push('New code ready — read it out to the guests', 'success');
      await loadBoard();
    } catch (err) {
      push(err instanceof Error ? err.message : 'Could not create a new code', 'error');
    } finally {
      setBusy(null);
    }
  }

  async function newParty(tableId: string) {
    setBusy('party' + tableId);
    try {
      // waiters cannot call the admin API — this endpoint exists for both roles
      await api.post('/api/waiter/new-party', { tableId });
      push('Session closed. Next code entry starts a fresh visit.', 'success');
      await loadBoard();
    } catch (err) {
      push(err instanceof Error ? err.message : 'Could not start a new party', 'error');
    } finally {
      setBusy(null);
    }
  }

  async function closeTableSession(sessionId: string) {
    setBusy('close');
    try {
      await api.post('/api/waiter/close-session', { sessionId, reason: 'closed by waiter' });
      push('Table session closed — the QR is now invalid for that visit', 'success');
      setSelected(null);
      await loadBoard();
    } catch (err) {
      push(err instanceof Error ? err.message : 'Could not close the session', 'error');
    } finally {
      setBusy(null);
    }
  }

  const readyOrders = data.kitchen.filter((o) => o.status === 'ready');

  return (
    <StaffShell user={user} nav={[{ href: '/waiter', label: 'Tables', icon: LayoutGrid }]}>
      <main className="space-y-4 p-3 pb-24">
        {/* summary */}
        <div className="grid grid-cols-4 gap-2">
          {[
            { label: 'Pending', value: data.pending.length, tone: 'bg-amber-400 text-black' },
            { label: 'Calls', value: data.calls.filter((c) => c.type === 'call').length, tone: 'bg-orange-500 text-white' },
            { label: 'Bill', value: data.calls.filter((c) => c.type === 'bill').length, tone: 'bg-fuchsia-600 text-white' },
            { label: 'Ready', value: readyOrders.length, tone: 'bg-emerald-600 text-white' },
          ].map((s) => (
            <div key={s.label} className={cn('rounded-xl p-2 text-center', s.tone)}>
              <p className="text-xl font-black leading-none">{s.value}</p>
              <p className="text-[10px] font-semibold uppercase tracking-wide opacity-90">{s.label}</p>
            </div>
          ))}
        </div>

        {/* table codes (OTP) — the waiter reads these out to guests at the table */}
        <section>
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold">Table codes</h2>
            {(data.otps?.length ?? 0) > 0 && (
              <Badge variant="outline">{data.otps!.length} waiting</Badge>
            )}
          </div>

          {(data.otps?.length ?? 0) === 0 ? (
            <p className="mt-2 rounded-xl border border-dashed border-border p-3 text-center text-xs text-muted-foreground">
              No code requests. When a guest taps the sticker, the code appears here.
            </p>
          ) : (
            <div className="mt-2 space-y-2">
              {data.otps!.map((otp) => (
                <article
                  key={otp.id}
                  className={cn(
                    'rounded-2xl border-2 bg-card p-3 shadow-soft',
                    // a dead code is not actionable: keep it grey, not green
                    otp.state !== 'live'
                      ? 'border-border bg-muted/40'
                      : otp.admin_alert
                        ? 'border-red-600'
                        : otp.overdue
                          ? 'border-red-400'
                          : 'border-emerald-500',
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-base font-black">Table {otp.table_number}</p>
                      <p className="text-[11px] text-muted-foreground">
                        asked {timeAgo(otp.created_at, now)} ago
                        {otp.table_state === 'open' &&
                          ` · open ${otp.open_minutes} min · ${otp.phones} ${
                            otp.phones === 1 ? 'phone' : 'phones'
                          }`}
                      </p>
                    </div>
                    <CodeChip
                      code={otp.code}
                      state={otp.state}
                      tableNumber={otp.table_number}
                      tone={otp.state === 'live' ? (otp.overdue ? 'warn' : 'live') : 'dead'}
                    />
                  </div>

                  <div className="mt-2 flex items-center gap-2 text-[11px]">
                    <Clock className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                    {otp.state === 'live' ? (
                      <span className="text-muted-foreground">
                        {Math.floor(otp.seconds_left / 60)}:
                        {String(otp.seconds_left % 60).padStart(2, '0')} left
                        {otp.attempts > 0 && ` · ${otp.max_attempts - otp.attempts} tries left`}
                      </span>
                    ) : otp.state === 'locked' ? (
                      <span className="font-semibold text-red-600">
                        Locked after {otp.max_attempts} wrong tries
                      </span>
                    ) : (
                      <span className="text-muted-foreground">Expired</span>
                    )}
                    {otp.joined_phones > 0 && (
                      <span className="ml-auto rounded-full bg-blue-600 px-2 py-0.5 font-semibold text-white">
                        {otp.joined_phones} joined
                      </span>
                    )}
                  </div>

                  {otp.table_state === 'open' && (
                    <p className="mt-2 rounded-lg bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-900">
                      A visit is still open on this table
                      {otp.session_items > 0 && ` · ${otp.session_items} item(s) ordered`}. Same party
                      keeps it; New party ends it.
                    </p>
                  )}

                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => dismissCode(otp.id)}
                      loading={busy === 'otp' + otp.id}
                    >
                      Dismiss
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => newCode(otp.table_id)}
                      loading={busy === 'raise' + otp.table_id}
                    >
                      <RefreshCw className="h-4 w-4" /> New code
                    </Button>
                    {otp.table_state === 'open' ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="col-span-2 border-red-300 text-red-700"
                        onClick={() => newParty(otp.table_id)}
                        loading={busy === 'party' + otp.table_id}
                      >
                        New party (close the open visit)
                      </Button>
                    ) : (
                      <p className="col-span-2 text-center text-[11px] text-muted-foreground">
                        Table is free — the code starts a new visit.
                      </p>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        {/* pending orders */}
        <section>
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold">Orders waiting for you</h2>
            <Button variant="ghost" size="sm" onClick={loadBoard}>
              <RefreshCw className="h-4 w-4" /> Refresh
            </Button>
          </div>

          {data.pending.length === 0 ? (
            <p className="mt-2 rounded-xl border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
              No new orders. Guests&apos; orders appear here instantly with a sound.
            </p>
          ) : (
            <div className="mt-2 space-y-2">
              {data.pending.map((order) => (
                <article key={order.id} className="rounded-2xl border-2 border-amber-400 bg-card p-3 shadow-soft">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-base font-black">Table {order.table_number}</p>
                      <p className="text-[11px] text-muted-foreground">
                        Batch #{order.batch_no} · {timeAgo(order.created_at, now)} ago ·{' '}
                        {money(order.total)}
                      </p>
                      <p className="mt-0.5 text-[10px] text-muted-foreground">
                        table open {timeAgo(order.session_started_at ?? order.created_at, now)} ·{' '}
                        {order.session_devices ?? 0}{' '}
                        {(order.session_devices ?? 0) === 1 ? 'phone' : 'phones'}
                      </p>
                    </div>
                    <Badge variant="warning">pending</Badge>
                  </div>

                  <ul className="mt-2 space-y-0.5 text-sm">
                    {order.items.map((item) => (
                      <li key={item.id} className="flex items-baseline gap-2">
                        <span className="font-bold">{item.qty}×</span>
                        <span className="flex-1">{item.name_snapshot}</span>
                        {item.notes && <span className="text-[11px] text-amber-700 dark:text-amber-400">“{item.notes}”</span>}
                        <span className="text-[11px] text-muted-foreground">G{item.added_by_guest}</span>
                      </li>
                    ))}
                  </ul>
                  {order.notes && (
                    <p className="mt-1 rounded-lg bg-secondary p-2 text-xs">Note: {order.notes}</p>
                  )}

                  <div className="mt-3 flex gap-2">
                    <Button
                      className="flex-1"
                      onClick={() => decide(order, 'confirm')}
                      loading={busy === order.id + 'confirm'}
                    >
                      <Check className="h-5 w-5" /> Confirm
                    </Button>
                    <Button
                      variant="outline"
                      className="flex-1 border-destructive/40 text-destructive"
                      onClick={() => setRejecting(order)}
                      disabled={busy !== null}
                    >
                      <X className="h-5 w-5" /> Reject
                    </Button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        {/* calls */}
        <section>
          <h2 className="text-sm font-bold">Live calls</h2>
          {data.calls.length === 0 ? (
            <p className="mt-2 rounded-xl border border-dashed border-border p-3 text-center text-xs text-muted-foreground">
              No waiter calls or bill requests.
            </p>
          ) : (
            <div className="mt-2 space-y-2">
              {data.calls.map((call) => (
                <div
                  key={call.id}
                  className={cn(
                    'flex items-center gap-2 rounded-xl p-3 text-white',
                    call.type === 'bill' ? 'bg-fuchsia-600' : 'bg-orange-500',
                  )}
                >
                  {call.type === 'bill' ? <Receipt className="h-5 w-5" /> : <BellRing className="h-5 w-5" />}
                  <div className="flex-1">
                    <p className="text-sm font-bold">
                      Table {call.table_number} · {call.type === 'bill' ? 'wants the bill' : 'is calling'}
                    </p>
                    <p className="text-[11px] opacity-90">{timeAgo(call.created_at, now)} ago</p>
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => handleCall(call.id)}
                    loading={busy === call.id}
                  >
                    Done
                  </Button>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* table grid */}
        <section>
          <h2 className="text-sm font-bold">Tables</h2>
          <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
            {data.tables.map((table) => (
              <button
                key={table.id}
                type="button"
                onClick={() => openTable(table)}
                className={cn(
                  'flex min-h-[84px] flex-col items-start justify-between rounded-2xl border-2 p-2.5 text-left transition active:scale-[.98]',
                  tableTone(table),
                )}
                aria-label={`Table ${table.number}, ${tableLabel(table)}`}
              >
                <span className="text-lg font-black leading-none">{table.number}</span>
                <span className="text-[10px] font-bold uppercase tracking-wide">{tableLabel(table)}</span>
                {table.session_id && (
                  <span className="text-[9px] opacity-80">{money(table.revenue)}</span>
                )}
              </button>
            ))}
          </div>
        </section>

        {/* ready to serve */}
        {readyOrders.length > 0 && (
          <section>
            <h2 className="text-sm font-bold">Ready to serve</h2>
            <div className="mt-2 space-y-2">
              {readyOrders.map((order) => (
                <div
                  key={order.id}
                  className="flex items-center gap-2 rounded-xl border-2 border-emerald-600 bg-emerald-50 p-3 dark:bg-emerald-500/10"
                >
                  <ChefHat className="h-5 w-5 text-emerald-700 dark:text-emerald-400" />
                  <div className="flex-1">
                    <p className="text-sm font-bold">Table {order.table_number}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {order.items.map((i) => `${i.qty}× ${i.name_snapshot}`).join(', ')}
                    </p>
                  </div>
                  <Badge variant="success">ready</Badge>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>

      {/* reject dialog */}
      <Dialog open={Boolean(rejecting)} onOpenChange={(o) => !o && setRejecting(null)}>
        <DialogContent title="Reject this order?" description="The guest will see your reason.">
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Paneer tikka is sold out, sorry"
            maxLength={200}
          />
          <div className="mt-3 flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setRejecting(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              className="flex-1"
              disabled={reason.trim().length < 3}
              onClick={() => rejecting && decide(rejecting, 'reject', reason)}
            >
              Reject order
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* table detail */}
      <Dialog open={Boolean(selected)} onOpenChange={(o) => !o && setSelected(null)}>
        {selected && (
          <DialogContent
            title={`Table ${selected.number}${selected.label ? ` · ${selected.label}` : ''}`}
            description={
              detail?.session
                ? `Session started ${timeAgo(detail.session.created_at, now)} ago`
                : 'No active session on this table'
            }
          >
            {detailLoading || !detail ? (
              <div className="space-y-2 py-4">
                <div className="skeleton h-16 w-full" />
                <div className="skeleton h-16 w-full" />
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  {detail.calls
                    .filter((c) => c.status === 'open')
                    .map((call) => (
                      <Button key={call.id} size="sm" onClick={() => handleCall(call.id)}>
                        {call.type === 'bill' ? <ReceiptText className="h-4 w-4" /> : <BellRing className="h-4 w-4" />}
                        Mark {call.type === 'bill' ? 'bill handled' : 'call handled'}
                      </Button>
                    ))}
                  {detail.session && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-destructive/40 text-destructive"
                      onClick={() => closeTableSession(detail.session!.id)}
                      loading={busy === 'close'}
                    >
                      Close session
                    </Button>
                  )}
                </div>

                {detail.fullOrders.length === 0 ? (
                  <p className="rounded-xl bg-secondary p-3 text-center text-xs text-muted-foreground">
                    No orders yet in this session.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {detail.fullOrders.map((order) => (
                      <li key={order.id} className="rounded-xl border border-border p-2.5">
                        <div className="flex items-center justify-between">
                          <p className="text-xs font-bold">
                            #{order.batch_no} · {timeAgo(order.created_at, now)} ago
                          </p>
                          <Badge
                            variant={
                              order.status === 'pending'
                                ? 'warning'
                                : order.status === 'rejected'
                                  ? 'destructive'
                                  : order.status === 'ready'
                                    ? 'success'
                                    : order.status === 'confirmed' || order.status === 'preparing'
                                      ? 'destructive' // in the kitchen: not ready until the chef taps Done
                                      : 'secondary'
                            }
                          >
                            {order.status === 'confirmed' || order.status === 'preparing'
                              ? 'ready ✗'
                              : order.status === 'ready'
                                ? 'ready ✓'
                                : order.status}
                          </Badge>
                        </div>
                        <ul className="mt-1 space-y-0.5 text-xs">
                          {order.items.map((i, idx) => (
                            <li key={idx} className="flex justify-between gap-2">
                              <span>
                                {i.qty}× {i.name_snapshot}
                                {i.notes ? ` (${i.notes})` : ''}
                              </span>
                              <span className="text-muted-foreground">{money(i.unit_price * i.qty)}</span>
                            </li>
                          ))}
                        </ul>
                        {order.rejected_reason && (
                          <p className="mt-1 text-[11px] text-destructive">{order.rejected_reason}</p>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </DialogContent>
        )}
      </Dialog>
    </StaffShell>
  );
}
