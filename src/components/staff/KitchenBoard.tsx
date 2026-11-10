'use client';

import * as React from 'react';
import { api } from '@/lib/api-client';
import { useToast } from '@/components/ui/toast';
import { StaffShell } from '@/components/staff/StaffShell';
import { useStaffFeed } from '@/components/staff/useStaffFeed';
import { Button } from '@/components/ui/button';
import { cn, timeAgo } from '@/lib/utils';
import type { OrderView, StaffUser } from '@/types';
import { ChefHat, CheckCircle2, Timer, Utensils } from 'lucide-react';

const WARN_MS = 12 * 60_000; // 12 minutes
const LATE_MS = 20 * 60_000; // 20 minutes

/**
 * Kitchen screen: large high-contrast cards, newest confirmed on top, one Done button
 * per order (it tells the waiter the food is ready), colour warning when an order waits too long.
 * No status stages or filters for the kitchen to manage.
 */
export function KitchenBoard({
  user,
  initial,
  sounds,
}: {
  user: StaffUser;
  initial: { orders: OrderView[] };
  sounds: Record<string, string>;
}) {
  const { push } = useToast();
  const [orders, setOrders] = React.useState<OrderView[]>(initial.orders);
  const [now, setNow] = React.useState(Date.now());
  const [busy, setBusy] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    try {
      const res = await api.get<{ orders: OrderView[] }>('/api/kitchen/board');
      setOrders(res.orders);
    } catch (err) {
      if (err instanceof Error && /sign in/i.test(err.message)) window.location.href = '/staff/login';
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
    },
    onEvent: () => void load(),
    fetchFingerprint,
    pollMs: 5000,
  });

  React.useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  /** Done: the food is made. The order leaves this screen and shows as Ready to the waiter. */
  async function markDone(order: OrderView) {
    const action = 'ready' as const;
    setBusy(order.id + action);
    // optimistic
    setOrders((prev) => prev.map((o) => (o.id === order.id ? { ...o, status: 'ready' } : o)));
    try {
      await api.post('/api/kitchen/order', { orderId: order.id, action });
      push(`Table ${order.table_number} notified`, 'success');
    } catch (err) {
      push(err instanceof Error ? err.message : 'Could not update', 'error');
      await load();
    } finally {
      setBusy(null);
    }
  }

  // only food still to be made; a finished order is the waiter's now
  const visible = orders.filter((o) => o.status === 'confirmed' || o.status === 'preparing');
  const sorted = [...visible].sort(
    (a, b) =>
      new Date(b.confirmed_at ?? b.created_at).getTime() - new Date(a.confirmed_at ?? a.created_at).getTime(),
  );

  return (
    <StaffShell user={user} nav={[{ href: '/kitchen', label: 'Kitchen', icon: ChefHat }]}>
      <main className="p-3 pb-24">
        {sorted.length === 0 ? (
          <div className="mt-16 text-center">
            <Utensils className="mx-auto h-12 w-12 text-muted-foreground/40" />
            <p className="mt-3 text-lg font-bold">Nothing on the pass</p>
            <p className="text-sm text-muted-foreground">
              Confirmed orders land here automatically with a sound.
            </p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {sorted.map((order) => {
              const since = new Date(order.confirmed_at ?? order.created_at).getTime();
              const waited = now - since;
              const late = waited > LATE_MS;
              const warn = waited > WARN_MS && !late;

              return (
                <article
                  key={order.id}
                  className={cn(
                    'rounded-2xl border-4 bg-card p-4 shadow-card',
                    late ? 'border-red-600' : warn ? 'border-amber-500' : 'border-border',
                  )}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-3xl font-black leading-none">T{order.table_number}</p>
                      <p className="mt-1 text-xs font-semibold text-muted-foreground">#{order.batch_no}</p>
                    </div>
                    <div className="text-right">
                      <p
                        className={cn(
                          'flex items-center justify-end gap-1 text-sm font-bold tabular-nums',
                          late ? 'text-red-600' : warn ? 'text-amber-600' : 'text-muted-foreground',
                        )}
                      >
                        <Timer className="h-4 w-4" /> {timeAgo(since, now)}
                      </p>
                    </div>
                  </div>

                  <ul className="mt-3 space-y-1.5">
                    {order.items.map((item) => (
                      <li key={item.id} className="flex items-baseline gap-2 text-lg font-semibold leading-tight">
                        <span className="font-black text-primary">{item.qty}×</span>
                        <span className="flex-1">{item.name_snapshot}</span>
                      </li>
                    ))}
                  </ul>

                  {(order.notes || order.items.some((i) => i.notes)) && (
                    <div className="mt-2 space-y-1">
                      {order.notes && (
                        <p className="rounded-lg bg-amber-100 p-2 text-sm font-semibold text-amber-900 dark:bg-amber-500/15 dark:text-amber-200">
                          Note: {order.notes}
                        </p>
                      )}
                      {order.items
                        .filter((i) => i.notes)
                        .map((i) => (
                          <p
                            key={i.id}
                            className="rounded-lg bg-amber-50 p-2 text-sm font-semibold text-amber-900 dark:bg-amber-500/10 dark:text-amber-200"
                          >
                            {i.name_snapshot}: {i.notes}
                          </p>
                        ))}
                    </div>
                  )}

                  <div className="mt-3">
                    <Button
                      size="xl"
                      variant="success"
                      className="w-full"
                      onClick={() => markDone(order)}
                      loading={busy === order.id + 'ready'}
                    >
                      <CheckCircle2 className="h-5 w-5" /> Done
                    </Button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </main>
    </StaffShell>
  );
}
