'use client';

import * as React from 'react';
import Link from 'next/link';
import { useCustomer } from '@/components/customer/CustomerProvider';
import { useT } from '@/lib/i18n';
import type { MenuCategory, MenuItem } from '@/types';
import { cn, money } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import { SessionGuard } from '@/components/customer/SessionGuard';
import { RestaurantGameBanner } from '@/components/customer/RestaurantGameBanner';
import {
  ArrowLeft,
  BellRing,
  ChevronDown,
  Flame,
  Minus,
  Plus,
  Receipt,
  Salad,
  Drumstick,
  Search,
  ShoppingBag,
  Trash2,
  X,
  KeyRound,
} from 'lucide-react';

function VegMark({ isVeg }: { isVeg: boolean }) {
  return (
    <span
      aria-label={isVeg ? 'Vegetarian' : 'Non-vegetarian'}
      title={isVeg ? 'Vegetarian' : 'Non-vegetarian'}
      className={cn(
        'inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-[3px] border-2',
        isVeg ? 'border-emerald-600' : 'border-red-600',
      )}
    >
      <span
        className={cn('h-1.5 w-1.5 rounded-full', isVeg ? 'bg-emerald-600' : 'bg-red-600')}
        aria-hidden
      />
    </span>
  );
}

export function MenuScreen({ menu, tableNumber }: { menu: MenuCategory[]; tableNumber: number }) {
  const { t } = useT();
  const {
    tableCode,
    session,
    cart,
    addToCart,
    setQty,
    removeLine,
    sendOrder,
    callWaiter,
    orders,
    loading,
  } = useCustomer();
  const { push } = useToast();

  const [query, setQuery] = React.useState('');
  const [vegOnly, setVegOnly] = React.useState(false);
  const [activeCategory, setActiveCategory] = React.useState<string>(menu[0]?.id ?? '');
  const [cartOpen, setCartOpen] = React.useState(false);
  const [detail, setDetail] = React.useState<MenuItem | null>(null);
  const [detailQty, setDetailQty] = React.useState(1);
  const [detailNotes, setDetailNotes] = React.useState('');
  const [busy, setBusy] = React.useState<string | null>(null);

  const flat = React.useMemo(() => menu.flatMap((c) => c.items), [menu]);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return menu
      .map((c) => ({
        ...c,
        items: c.items.filter((i) => {
          if (vegOnly && !i.is_veg) return false;
          if (!q) return true;
          return (
            i.name.toLowerCase().includes(q) || (i.description ?? '').toLowerCase().includes(q)
          );
        }),
      }))
      .filter((c) => c.items.length > 0);
  }, [menu, vegOnly, query]);

  const cartQtyFor = (itemId: string) =>
    cart?.lines.filter((l) => l.menu_item_id === itemId).reduce((s, l) => s + l.qty, 0) ?? 0;

  const cartLinesFor = (itemId: string) => cart?.lines.filter((l) => l.menu_item_id === itemId) ?? [];

  const liveOrders = orders.filter((o) => o.status !== 'served' && o.status !== 'rejected');

  async function handleAdd(item: MenuItem, qty = 1, notes?: string) {
    // read-only preview: nothing may enter a cart before the code is entered (D2)
    if (!session?.id) {
      push(t.codeEnterToOrder, 'error');
      return;
    }
    setBusy(item.id);
    try {
      await addToCart(item.id, qty, notes);
      push(`${item.name} added`, 'success');
    } catch (err) {
      push(err instanceof Error ? err.message : 'Could not add item', 'error');
    } finally {
      setBusy(null);
    }
  }

  async function handleSend() {
    setBusy('order');
    try {
      await sendOrder();
      setCartOpen(false);
      push(t.orderSent, 'success');
      if (navigator.vibrate) navigator.vibrate(60);
    } catch (err) {
      push(err instanceof Error ? err.message : 'Could not send order', 'error');
    } finally {
      setBusy(null);
    }
  }

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
    <div className="min-h-dvh pb-40">
      <SessionGuard />

      <header className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur">
        <div className="flex items-center gap-3 p-3">
          <Link
            href={`/t/${tableCode}`}
            className="tap rounded-full hover:bg-secondary"
            aria-label="Back"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div className="flex-1">
            <h1 className="text-base font-bold leading-tight">{t.viewMenu}</h1>
            <p className="text-xs text-muted-foreground">
              {t.table} {tableNumber} · {flat.length} dishes
            </p>
          </div>
          <button
            type="button"
            onClick={() => setCartOpen(true)}
            className="tap relative rounded-full bg-secondary px-3"
            aria-label={`${t.cart}: ${cart?.itemCount ?? 0} items`}
          >
            <ShoppingBag className="h-5 w-5" />
            {cart && cart.itemCount > 0 && (
              <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[11px] font-bold text-primary-foreground">
                {cart.itemCount}
              </span>
            )}
          </button>
        </div>

        <div className="px-3 pb-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t.search}
              className="h-10 pl-9 pr-9"
              aria-label={t.search}
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted-foreground"
                aria-label="Clear search"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        <div className="no-scrollbar flex items-center gap-2 overflow-x-auto px-3 pb-3">
          <button
            type="button"
            onClick={() => setVegOnly((v) => !v)}
            aria-pressed={vegOnly}
            className={cn(
              'tap shrink-0 rounded-full border-2 px-3 text-xs font-semibold',
              vegOnly
                ? 'border-emerald-600 bg-emerald-50 text-emerald-700'
                : 'border-border bg-card text-muted-foreground',
            )}
          >
            {t.vegOnly}
          </button>
          {filtered.map((c) => (
            <a
              key={c.id}
              href={`#cat-${c.id}`}
              onClick={() => setActiveCategory(c.id)}
              className={cn(
                'tap shrink-0 rounded-full px-3 text-xs font-semibold',
                activeCategory === c.id
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-secondary text-secondary-foreground',
              )}
            >
              {c.name}
            </a>
          ))}
        </div>
      </header>

      <RestaurantGameBanner />

      {/* read-only preview banner: no code entered yet (D2) */}
      {!session?.id && (
        <Link
          href={`/t/${tableCode}`}
          className="mx-3 mb-1 mt-2 flex min-h-[44px] items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2"
        >
          <span className="flex items-center gap-2 text-xs font-semibold text-amber-900">
            <KeyRound className="h-4 w-4" aria-hidden />
            {t.codeEnterToOrder}
          </span>
          <span className="text-xs font-semibold text-amber-900 underline underline-offset-4">
            {t.codeLabel}
          </span>
        </Link>
      )}

      {/* live order strip */}
      {liveOrders.length > 0 && (
        <Link
          href={`/t/${tableCode}/status`}
          className="mx-3 mb-1 mt-2 flex min-h-[44px] items-center justify-between rounded-xl border border-border bg-card px-3 py-2 shadow-soft"
        >
          <span className="flex items-center gap-2 text-xs font-medium">
            <Receipt className="h-4 w-4 text-primary" />
            {t.orderStatus}
          </span>
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold text-muted-foreground">
              {liveOrders.length} {liveOrders.length === 1 ? 'order' : 'orders'}
            </span>
            <ChevronDown className="h-4 w-4 -rotate-90 text-muted-foreground" />
          </div>
        </Link>
      )}

      <main className="px-3 pt-1">
        {filtered.length === 0 && (
          <div className="mt-16 text-center text-sm text-muted-foreground">
            <p className="text-base font-semibold text-foreground">Nothing matches “{query}”</p>
            <p>Try another dish name, or clear the filters.</p>
          </div>
        )}

        {filtered.map((category) => (
          <section key={category.id} id={`cat-${category.id}`} className="scroll-mt-40 pt-4">
            <h2 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
              {category.name}
            </h2>
            <div className="mt-2 space-y-2">
              {category.items.map((item) => {
                const qty = cartQtyFor(item.id);
                return (
                  <article
                    key={item.id}
                    className={cn(
                      'flex gap-3 rounded-2xl border border-border bg-card p-3 shadow-soft',
                      !item.is_available && 'opacity-60',
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        if (!item.is_available) return;
                        setDetail(item);
                        setDetailQty(1);
                        setDetailNotes('');
                      }}
                      className="flex min-w-0 flex-1 items-start gap-3 text-left"
                      aria-label={`${item.name} details`}
                    >
                      {item.image_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={item.image_url}
                          alt=""
                          loading="lazy"
                          className="h-14 w-14 shrink-0 rounded-xl object-cover sm:h-20 sm:w-20"
                          width={80}
                          height={80}
                        />
                      ) : (
                        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-secondary sm:h-20 sm:w-20">
                          {item.is_veg ? (
                            <Salad className="h-8 w-8 text-emerald-600/70" aria-hidden />
                          ) : (
                            <Drumstick className="h-8 w-8 text-red-600/70" aria-hidden />
                          )}
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <VegMark isVeg={item.is_veg} />
                          <h3 className="min-w-0 break-words text-sm font-bold leading-snug">
                            {item.name}
                          </h3>
                          {item.spice_level > 0 && (
                            <span className="flex items-center text-red-500" aria-label="Spicy">
                              {Array.from({ length: item.spice_level }).map((_, i) => (
                                <Flame key={i} className="h-3 w-3" />
                              ))}
                            </span>
                          )}
                        </div>
                        {item.description && (
                          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                            {item.description}
                          </p>
                        )}
                        <div className="mt-1 flex items-baseline gap-2">
                          {item.offer_active ? (
                            <>
                              <span className="text-sm font-bold text-foreground">
                                {money(item.effective_price)}
                              </span>
                              <span className="text-xs text-muted-foreground line-through">
                                {money(item.price)}
                              </span>
                              <Badge variant="success" className="text-[10px]">
                                offer
                              </Badge>
                            </>
                          ) : (
                            <span className="text-sm font-bold">{money(item.price)}</span>
                          )}
                        </div>
                        {!item.is_available && (
                          <p className="mt-1 text-xs font-semibold text-destructive">{t.soldOut}</p>
                        )}
                      </div>
                    </button>

                    <div className="flex w-[92px] shrink-0 flex-col items-end justify-center gap-1 sm:w-24">
                      {!item.is_available ? (
                        <span className="rounded-lg bg-muted px-2 py-1 text-[11px] font-semibold text-muted-foreground">
                          {t.soldOut}
                        </span>
                      ) : qty === 0 ? (
                        <Button
                          size="sm"
                          onClick={() => handleAdd(item)}
                          loading={busy === item.id}
                          className="w-full"
                        >
                          {t.add}
                        </Button>
                      ) : (
                        <div className="flex w-full items-center justify-between rounded-xl border-2 border-primary bg-primary/5">
                          <button
                            type="button"
                            onClick={() => {
                              const line = cartLinesFor(item.id)[0];
                              if (line) setQty(line.id, line.qty - 1);
                            }}
                            className="tap rounded-lg text-primary"
                            aria-label={`Remove one ${item.name}`}
                          >
                            <Minus className="h-4 w-4" />
                          </button>
                          <span className="text-sm font-bold text-primary">{qty}</span>
                          <button
                            type="button"
                            onClick={() => handleAdd(item)}
                            className="tap rounded-lg text-primary"
                            aria-label={`Add one more ${item.name}`}
                          >
                            <Plus className="h-4 w-4" />
                          </button>
                        </div>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        ))}
      </main>

      {/* floating actions */}
      <div className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 p-3 backdrop-blur">
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => handleCall('call')}
            loading={busy === 'call'}
          >
            <BellRing className="h-4 w-4" /> {t.callWaiter}
          </Button>
          <Button
            variant="secondary"
            className="flex-1"
            onClick={() => handleCall('bill')}
            loading={busy === 'bill'}
          >
            <Receipt className="h-4 w-4" /> {t.requestBill}
          </Button>
        </div>
        {cart && cart.itemCount > 0 && (
          <Button size="lg" className="mt-2 w-full" onClick={() => setCartOpen(true)}>
            <ShoppingBag className="h-5 w-5" />
            {t.cart} · {cart.itemCount} · {money(cart.subtotal)}
          </Button>
        )}
      </div>

      {/* item detail sheet */}
      <Dialog open={Boolean(detail)} onOpenChange={(o) => !o && setDetail(null)}>
        {detail && (
          <DialogContent title={detail.name} description={detail.description ?? undefined}>
            <div className="space-y-4">
              <div className="flex items-center justify-between rounded-xl bg-secondary p-3">
                <span className="text-sm font-medium">{t.total}</span>
                <span className="text-lg font-bold">
                  {money(detail.effective_price * detailQty)}
                  {detail.offer_active && (
                    <span className="ml-2 text-xs font-normal text-muted-foreground line-through">
                      {money(detail.price * detailQty)}
                    </span>
                  )}
                </span>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium" htmlFor="detail-notes">
                  {t.notes}
                </label>
                <Textarea
                  id="detail-notes"
                  value={detailNotes}
                  onChange={(e) => setDetailNotes(e.target.value)}
                  placeholder="e.g. less spicy, no onions"
                  maxLength={200}
                />
              </div>

              <div className="flex items-center justify-between rounded-xl border-2 border-border p-2">
                <button
                  type="button"
                  onClick={() => setDetailQty((q) => Math.max(1, q - 1))}
                  className="tap rounded-lg bg-secondary px-3"
                  aria-label="Decrease quantity"
                >
                  <Minus className="h-4 w-4" />
                </button>
                <span className="text-lg font-bold" aria-live="polite">
                  {detailQty}
                </span>
                <button
                  type="button"
                  onClick={() => setDetailQty((q) => Math.min(20, q + 1))}
                  className="tap rounded-lg bg-secondary px-3"
                  aria-label="Increase quantity"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>

              <Button
                size="lg"
                className="w-full"
                loading={busy === detail.id}
                onClick={async () => {
                  await handleAdd(detail, detailQty, detailNotes || undefined);
                  setDetail(null);
                }}
              >
                {t.add} · {money(detail.effective_price * detailQty)}
              </Button>
            </div>
          </DialogContent>
        )}
      </Dialog>

      {/* shared cart sheet */}
      <Dialog open={cartOpen} onOpenChange={setCartOpen}>
        <DialogContent title={t.yourOrder} description={`Shared with everyone at table ${tableNumber}`}>
          {!cart || cart.lines.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{t.emptyCart}</p>
          ) : (
            <div className="space-y-3">
              <ul className="divide-y divide-border">
                {cart.lines.map((line) => (
                  <li key={line.id} className="flex items-start gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-1.5 text-sm font-semibold">
                        {line.name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {t.addedBy} {t.guest} {line.added_by_guest}
                        {line.notes ? ` · “${line.notes}”` : ''}
                      </p>
                      <p className="mt-0.5 text-xs">
                        {money(line.unit_price)} × {line.qty} ={' '}
                        <span className="font-semibold">{money(line.line_total)}</span>
                      </p>
                    </div>
                    <div className="flex items-center gap-1 rounded-lg border border-border">
                      <button
                        type="button"
                        onClick={() => setQty(line.id, line.qty - 1)}
                        className="tap"
                        aria-label={`Decrease ${line.name}`}
                      >
                        <Minus className="h-4 w-4" />
                      </button>
                      <span className="min-w-6 text-center text-sm font-semibold">{line.qty}</span>
                      <button
                        type="button"
                        onClick={() => setQty(line.id, line.qty + 1)}
                        className="tap"
                        aria-label={`Increase ${line.name}`}
                      >
                        <Plus className="h-4 w-4" />
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeLine(line.id)}
                      className="tap text-destructive"
                      aria-label={`Remove ${line.name}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>

              <div className="flex items-center justify-between border-t border-border pt-3 text-sm">
                <span>{t.subtotal}</span>
                <span className="font-bold">{money(cart.subtotal)}</span>
              </div>

              <Button size="lg" className="w-full" onClick={handleSend} loading={busy === 'order'}>
                {t.sendOrder} · {money(cart.subtotal)}
              </Button>
              <p className="text-center text-xs text-muted-foreground">
                A waiter confirms every order before it reaches the kitchen.
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
