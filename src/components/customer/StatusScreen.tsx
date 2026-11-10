'use client';

import Link from 'next/link';
import { useCustomer } from '@/components/customer/CustomerProvider';
import { useT } from '@/lib/i18n';
import { OrderStatusPill } from '@/components/customer/OrderStatusPill';
import { money, timeAgo } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, BellRing, Receipt, UtensilsCrossed } from 'lucide-react';
import { useState } from 'react';
import { useToast } from '@/components/ui/toast';

export function StatusScreen() {
  const { t } = useT();
  const { tableCode, orders, callWaiter, cart, session } = useCustomer();
  const { push } = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  const newestFirst = [...orders].sort((a, b) => b.batch_no - a.batch_no);

  async function handleCall(type: 'call' | 'bill') {
    setBusy(type);
    try {
      await callWaiter(type);
      push(type === 'bill' ? t.billRequested : t.waiterOnWay, 'success');
    } catch (err) {
      push(err instanceof Error ? err.message : 'Could not reach the waiter', 'error');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="min-h-dvh pb-28">
      <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-border bg-background/95 p-3 backdrop-blur">
        <Link href={`/t/${tableCode}`} className="tap rounded-full hover:bg-secondary" aria-label="Back">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="flex-1">
          <h1 className="text-base font-bold leading-tight">{t.orderStatus}</h1>
          <p className="text-xs text-muted-foreground">
            {t.table} {session?.table_number} · {orders.length}{' '}
            {orders.length === 1 ? 'order' : 'orders'}
          </p>
        </div>
        <Link href={`/t/${tableCode}/menu`} className="tap rounded-full bg-secondary px-3 text-xs font-semibold">
          <UtensilsCrossed className="mr-1 h-4 w-4" /> Menu
        </Link>
      </header>

      <main className="space-y-3 p-4">
        {newestFirst.length === 0 && (
          <div className="mt-20 text-center">
            <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-secondary text-muted-foreground">
              <UtensilsCrossed className="h-8 w-8" aria-hidden />
            </span>
            <p className="mt-3 text-base font-semibold">{t.noOrders}</p>
            <p className="text-sm text-muted-foreground">Add a few dishes from the menu.</p>
            <Button asChild className="mt-4">
              <Link href={`/t/${tableCode}/menu`}>{t.viewMenu}</Link>
            </Button>
          </div>
        )}

        {newestFirst.map((order) => (
          <article key={order.id} className="rounded-2xl border border-border bg-card p-4 shadow-soft">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-sm font-bold">Batch #{order.batch_no}</p>
                <p className="text-xs text-muted-foreground">
                  placed {timeAgo(order.created_at)} ·{' '}
                  {order.items.reduce((s, i) => s + i.qty, 0)}{' '}
                  {order.items.reduce((s, i) => s + i.qty, 0) === 1 ? 'item' : 'items'}
                </p>
              </div>
              {/* no live status for guests; only a rejected order is flagged */}
              {order.status === 'rejected' && <OrderStatusPill status={order.status} />}
            </div>

            <ul className="mt-3 divide-y divide-border text-sm">
              {order.items.map((item) => (
                <li key={item.id} className="flex items-start justify-between gap-2 py-1.5">
                  <span className="min-w-0">
                    <span className="font-medium">
                      {item.qty} × {item.name_snapshot}
                    </span>
                    {item.notes && (
                      <span className="block text-xs text-muted-foreground">“{item.notes}”</span>
                    )}
                    <span className="block text-[11px] text-muted-foreground">
                      {t.addedBy} {t.guest} {item.added_by_guest}
                      {item.offer_applied && (
                        <Badge variant="success" className="ml-2 text-[10px]">
                          offer applied
                        </Badge>
                      )}
                    </span>
                  </span>
                  <span className="shrink-0 font-medium">{money(item.unit_price * item.qty)}</span>
                </li>
              ))}
            </ul>

            {order.status === 'rejected' && order.rejected_reason && (
              <p className="mt-2 rounded-lg bg-red-50 p-2 text-xs text-red-700 dark:bg-red-500/10 dark:text-red-300">
                Waiter: {order.rejected_reason}
              </p>
            )}

            <div className="mt-3 flex items-center justify-between border-t border-border pt-2 text-sm">
              <span className="text-muted-foreground">
                {t.subtotal} {money(order.subtotal)}
                {order.tax > 0 && ` · ${t.tax} ${money(order.tax)}`}
              </span>
              <span className="font-bold">{money(order.total)}</span>
            </div>
          </article>
        ))}

        {cart && cart.itemCount > 0 && (
          <div className="rounded-2xl border-2 border-dashed border-primary/40 bg-primary/5 p-4">
            <p className="text-sm font-semibold">Unsent items in the shared cart</p>
            <p className="text-xs text-muted-foreground">
              {cart.itemCount} {cart.itemCount === 1 ? 'item' : 'items'} · {money(cart.subtotal)}
            </p>
            <Button asChild size="sm" className="mt-2">
              <Link href={`/t/${tableCode}/menu`}>{t.sendOrder}</Link>
            </Button>
          </div>
        )}
      </main>

      <div className="safe-bottom fixed inset-x-0 bottom-0 z-20 flex gap-2 border-t border-border bg-background/95 p-3 backdrop-blur">
        <Button variant="outline" className="flex-1" onClick={() => handleCall('call')} loading={busy === 'call'}>
          <BellRing className="h-4 w-4" /> {t.callWaiter}
        </Button>
        <Button variant="secondary" className="flex-1" onClick={() => handleCall('bill')} loading={busy === 'bill'}>
          <Receipt className="h-4 w-4" /> {t.requestBill}
        </Button>
      </div>
    </div>
  );
}
