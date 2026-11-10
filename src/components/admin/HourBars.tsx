'use client';

import { cn, money } from '@/lib/utils';

/**
 * 24-hour revenue histogram.
 *
 * Bars are laid out with `justify-end` inside a fixed-height row and sized by
 * flex-grow ratios rather than percentage heights — a percentage height only
 * resolves against a definite parent height, which HMR/min-h parent chains in
 * production did not always provide (bars collapsed to nothing).
 */
export function HourBars({
  rows,
  tickEvery = 6,
  className,
}: {
  rows: { hour: number; orders?: number; revenue: number }[];
  tickEvery?: number;
  className?: string;
}) {
  const byHour = new Map<number, { orders?: number; revenue: number }>();
  for (const r of rows) byHour.set(r.hour, r);
  const max = Math.max(1, ...rows.map((r) => r.revenue));

  return (
    <div className={cn('flex items-stretch gap-1', className)}>
      {Array.from({ length: 24 }).map((_, hour) => {
        const row = byHour.get(hour);
        const grow = row ? Math.max(0.06, row.revenue / max) : 0.02;
        return (
          <div
            key={hour}
            className="flex min-w-0 flex-1 flex-col items-center justify-end"
            title={`${hour}:00 · ${money(row?.revenue ?? 0)}${
              row?.orders !== undefined ? ` · ${row.orders} orders` : ''
            }`}
          >
            <div className="flex h-24 w-full items-end">
              <div
                className={cn('w-full rounded-t', row ? 'bg-primary' : 'bg-secondary')}
                style={{ height: `${Math.max(grow * 100, row ? 6 : 2)}%` }}
              />
            </div>
            <span className="mt-1 text-[8px] leading-none text-muted-foreground">
              {hour % tickEvery === 0 ? hour : '\u00a0'}
            </span>
          </div>
        );
      })}
    </div>
  );
}
