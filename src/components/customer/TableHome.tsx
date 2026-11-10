'use client';

import Link from 'next/link';
import { useCustomer } from '@/components/customer/CustomerProvider';
import { useT } from '@/lib/i18n';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { UtensilsCrossed, Star, Wifi, Gamepad2, ChevronRight, Receipt, Languages } from 'lucide-react';
import { cn, money } from '@/lib/utils';
import { SessionGuard } from '@/components/customer/SessionGuard';
import { RestaurantGameBanner } from '@/components/customer/RestaurantGameBanner';

type Props = {
  tableNumber: number;
  tableLabel: string | null;
  restaurantName: string;
  logoUrl: string | null;
  accent: string;
};

export function TableHome({ tableNumber, tableLabel, restaurantName, logoUrl, accent }: Props) {
  const { t, locale, setLocale } = useT();
  const { tableCode, orders, cart, review } = useCustomer();

  const activeOrders = orders.filter((o) => ['pending', 'confirmed', 'preparing'].includes(o.status));
  const actionable = orders.filter((o) => ['confirmed', 'preparing', 'ready'].includes(o.status));

  const actions = [
    {
      href: `/t/${tableCode}/menu`,
      label: t.viewMenu,
      hint: cart?.itemCount ? `${cart.itemCount} in cart` : 'Browse dishes & order',
      icon: UtensilsCrossed,
      primary: true,
    },
    {
      href: `/t/${tableCode}/review`,
      label: t.leaveReview,
      hint: review ? 'Thanks for your feedback' : 'Tell us how it went',
      icon: Star,
      primary: false,
      done: Boolean(review),
    },
    {
      href: `/t/${tableCode}/wifi`,
      label: t.connectWifi,
      hint: 'One tap, no typing',
      icon: Wifi,
      primary: false,
    },
    {
      href: `/t/${tableCode}/games`,
      label: t.playGames,
      hint: 'Quiz with your table',
      icon: Gamepad2,
      primary: false,
    },
  ];

  return (
    <div className="min-h-dvh pb-10">
      <SessionGuard />
      {/* header */}
      <header className="relative overflow-hidden px-5 pb-8 pt-6 text-white" style={{ background: accent }}>
        <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/10" aria-hidden />
        <div className="absolute -bottom-16 -left-8 h-40 w-40 rounded-full bg-black/10" aria-hidden />
        <div className="relative flex items-center justify-between">
          <div className="flex items-center gap-3">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={logoUrl}
                alt=""
                className="h-12 w-12 rounded-xl bg-white object-cover p-1"
                width={48}
                height={48}
              />
            ) : (
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/20 text-lg font-bold">
                {restaurantName.slice(0, 1) || 'T'}
              </div>
            )}
            <div>
              <p className="text-sm/none font-medium text-white/80">{restaurantName}</p>
              <h1 className="text-xl font-bold">
                {t.table} {tableLabel ?? tableNumber}
              </h1>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              const next = locale === 'en' ? 'hi' : 'en';
              setLocale(next);
              document.documentElement.lang = next;
            }}
            className="tap gap-1.5 rounded-full bg-white/15 px-2.5 text-xs font-semibold backdrop-blur"
            aria-label={locale === 'en' ? 'हिंदी में देखें' : 'View in English'}
            title={locale === 'en' ? 'हिंदी में देखें' : 'View in English'}
          >
            <Languages className="h-4 w-4" aria-hidden />
            {locale === 'en' ? 'हिंदी' : 'English'}
          </button>
        </div>

        <p className="relative mt-6 text-sm text-white/85">
          Welcome! Order from your phone — no app, no waiting.
        </p>
      </header>

      {/* the restaurant game, when the admin has started one */}
      <div className="-mt-4">
        <RestaurantGameBanner />
      </div>

      {/* live status strip */}
      {(activeOrders.length > 0 || actionable.length > 0) && (
        <Link
          href={`/t/${tableCode}/status`}
          className="relative z-10 mx-4 -mt-4 flex items-center justify-between rounded-2xl border border-border bg-card p-4 shadow-card"
        >
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Receipt className="h-5 w-5" />
            </span>
            <div>
              <p className="text-sm font-semibold">{t.orderStatus}</p>
              <p className="text-xs text-muted-foreground">
                {orders.length} {orders.length === 1 ? 'order' : 'orders'}
              </p>
            </div>
          </div>
          <ChevronRight className="h-5 w-5 text-muted-foreground" />
        </Link>
      )}

      {/* four actions */}
      <div className="grid gap-3 p-4">
        {actions.map((action) => (
          <Link
            key={action.href}
            href={action.href}
            className={cn(
              'group flex items-center gap-4 rounded-2xl border p-4 shadow-soft transition-transform active:scale-[.99]',
              action.primary
                ? 'border-transparent text-primary-foreground'
                : 'border-border bg-card',
            )}
            style={action.primary ? { background: accent } : undefined}
            aria-label={action.label}
          >
            <span
              className={cn(
                'flex h-12 w-12 items-center justify-center rounded-xl',
                action.primary ? 'bg-white/20' : 'bg-accent text-accent-foreground',
              )}
            >
              <action.icon className="h-6 w-6" aria-hidden />
            </span>
            <span className="flex-1">
              <span className="flex items-center gap-2 text-base font-bold">
                {action.label}
                {action.done && (
                  <Badge variant="success" className="text-[10px]">
                    done
                  </Badge>
                )}
              </span>
              <span
                className={cn(
                  'block text-sm',
                  action.primary ? 'text-white/80' : 'text-muted-foreground',
                )}
              >
                {action.hint}
              </span>
            </span>
            <ChevronRight
              className={cn('h-5 w-5', action.primary ? 'text-white/80' : 'text-muted-foreground')}
            />
          </Link>
        ))}
      </div>

      {/* cart nudge */}
      {cart && cart.itemCount > 0 && (
        <div className="px-4">
          <Card className="flex items-center justify-between p-4">
            <div>
              <p className="text-sm font-semibold">{t.cart}</p>
              <p className="text-xs text-muted-foreground">
                {cart.itemCount} items · {money(cart.subtotal)}
              </p>
            </div>
            <Link
              href={`/t/${tableCode}/menu`}
              className="tap rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground"
            >
              {t.sendOrder}
            </Link>
          </Card>
        </div>
      )}

      <footer className="mt-10 px-6 text-center text-xs text-muted-foreground">
        <p>Powered by TableTap · U&amp;D Digital Studio</p>
      </footer>
    </div>
  );
}
