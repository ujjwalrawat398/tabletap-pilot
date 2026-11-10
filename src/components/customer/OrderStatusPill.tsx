'use client';

import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n';
import type { OrderStatus } from '@/types';
import { Check, Clock, ChefHat, PartyPopper, XCircle, Utensils } from 'lucide-react';

const STYLE: Record<OrderStatus, { className: string; icon: typeof Clock }> = {
  pending: { className: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300', icon: Clock },
  confirmed: { className: 'bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300', icon: Check },
  preparing: { className: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-500/15 dark:text-indigo-300', icon: ChefHat },
  ready: { className: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300', icon: PartyPopper },
  served: { className: 'bg-neutral-200 text-neutral-700 dark:bg-neutral-600/25 dark:text-neutral-300', icon: Utensils },
  rejected: { className: 'bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300', icon: XCircle },
  cancelled: { className: 'bg-neutral-200 text-neutral-600', icon: XCircle },
};

export function OrderStatusPill({
  status,
  compact = false,
}: {
  status: OrderStatus;
  compact?: boolean;
}) {
  const { t } = useT();
  const cfg = STYLE[status] ?? STYLE.pending;
  const Icon = cfg.icon;
  const label =
    status === 'pending'
      ? t.waitingWaiter
      : status === 'confirmed'
        ? t.confirmed
        : status === 'preparing'
          ? t.preparing
          : status === 'ready'
            ? t.ready
            : status === 'served'
              ? t.served
              : status === 'rejected'
                ? t.rejected
                : status;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full font-semibold',
        compact ? 'px-1.5 py-0.5 text-[10px]' : 'px-2.5 py-1 text-xs',
        cfg.className,
      )}
    >
      <Icon className={compact ? 'h-3 w-3' : 'h-3.5 w-3.5'} aria-hidden />
      {label}
    </span>
  );
}

/** Horizontal progress tracker for the customer status page. */
export function OrderProgress({ status }: { status: OrderStatus }) {
  const { t } = useT();
  const steps: { key: OrderStatus; label: string }[] = [
    { key: 'pending', label: t.waitingWaiter },
    { key: 'confirmed', label: t.confirmed },
    { key: 'preparing', label: t.preparing },
    { key: 'ready', label: t.ready },
  ];
  const currentIndex = steps.findIndex((s) => s.key === status);

  if (status === 'rejected') {
    return (
      <div className="flex items-center gap-2 rounded-xl bg-red-50 p-3 text-xs font-medium text-red-700 dark:bg-red-500/10 dark:text-red-300">
        <XCircle className="h-4 w-4" /> {t.rejected}
      </div>
    );
  }
  if (status === 'served') {
    return (
      <div className="flex items-center gap-2 rounded-xl bg-secondary p-3 text-xs font-medium text-muted-foreground">
        <Utensils className="h-4 w-4" /> {t.served}
      </div>
    );
  }

  return (
    <div>
      <ol className="flex items-center justify-between gap-1" aria-label={t.orderStatus}>
        {steps.map((step, i) => {
          const done = i <= currentIndex;
          const active = i === currentIndex;
          return (
            <li key={step.key} className="flex flex-1 flex-col items-center gap-1 text-center">
              <span
                className={cn(
                  'flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-bold',
                  done ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground',
                  active && 'animate-pulse-ring',
                )}
                aria-hidden
              >
                {done ? <Check className="h-4 w-4" /> : i + 1}
              </span>
              <span
                className={cn(
                  'text-[10px] leading-tight',
                  active ? 'font-bold text-foreground' : 'text-muted-foreground',
                )}
              >
                {step.label}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
