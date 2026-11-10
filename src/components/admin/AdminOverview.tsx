'use client';

import Link from 'next/link';
import { AdminShell } from '@/components/staff/AdminShell';
import { HourBars } from '@/components/admin/HourBars';
import { Badge } from '@/components/ui/badge';
import { cn, money, timeAgo } from '@/lib/utils';
import type { StaffUser, TableCard } from '@/types';
import {
  BellRing,
  ChefHat,
  IndianRupee,
  MessageSquareHeart,
  Star,
  TrendingUp,
  Users,
} from 'lucide-react';

type Stats = {
  pendingOrders: number;
  kitchenOrders: number;
  openCalls: number;
  occupiedTables: number;
  totalTables: number;
  todayRevenue: number;
  todayOrders: number;
  newFeedback: number;
  avgRating: number | null;
};

type Report = {
  topItems: { name: string; qty: number; revenue: number }[];
  byHour: { hour: number; orders: number; revenue: number }[];
  averageOrderValue: number;
};

export function AdminOverview({
  user,
  stats,
  tables,
  report,
}: {
  user: StaffUser;
  stats: Stats;
  tables: TableCard[];
  report: Report;
}) {
  const cards = [
    {
      label: "Today's revenue",
      value: money(stats.todayRevenue),
      hint: `${stats.todayOrders} orders · avg ${money(report.averageOrderValue)}`,
      icon: IndianRupee,
      tone: 'bg-emerald-600 text-white',
    },
    {
      label: 'Tables occupied',
      value: `${stats.occupiedTables}/${stats.totalTables}`,
      hint: `${stats.totalTables - stats.occupiedTables} free right now`,
      icon: Users,
      tone: 'bg-blue-600 text-white',
    },
    {
      label: 'Orders in progress',
      value: String(stats.pendingOrders + stats.kitchenOrders),
      hint: `${stats.pendingOrders} awaiting confirmation`,
      icon: ChefHat,
      tone: 'bg-amber-500 text-black',
    },
    {
      label: 'Open calls',
      value: String(stats.openCalls),
      hint: stats.openCalls ? 'Needs a waiter now' : 'All clear',
      icon: BellRing,
      tone: stats.openCalls ? 'bg-fuchsia-600 text-white' : 'bg-secondary text-foreground',
    },
  ];


  return (
    <AdminShell user={user}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          {cards.map((c) => (
            <div key={c.label} className={cn('rounded-2xl p-3', c.tone)}>
              <c.icon className="h-5 w-5 opacity-80" />
              <p className="mt-2 text-2xl font-black leading-none">{c.value}</p>
              <p className="mt-1 text-[11px] font-semibold uppercase tracking-wide opacity-90">
                {c.label}
              </p>
              <p className="text-[10px] opacity-75">{c.hint}</p>
            </div>
          ))}
        </div>

        <div className="grid gap-3 lg:grid-cols-2">
          <section className="rounded-2xl border border-border bg-card p-4">
            <h2 className="flex items-center gap-2 text-sm font-bold">
              <TrendingUp className="h-4 w-4" /> Revenue by hour (today)
            </h2>
            {report.byHour.length === 0 ? (
              <p className="mt-3 text-xs text-muted-foreground">No sales yet today.</p>
            ) : (
              <HourBars rows={report.byHour} className="mt-3" tickEvery={6} />
            )}
          </section>

          <section className="rounded-2xl border border-border bg-card p-4">
            <h2 className="text-sm font-bold">Top items today</h2>
            {report.topItems.length === 0 ? (
              <p className="mt-3 text-xs text-muted-foreground">Nothing sold yet.</p>
            ) : (
              <ol className="mt-2 space-y-1.5">
                {report.topItems.slice(0, 5).map((item, i) => (
                  <li key={item.name} className="flex items-center gap-2 text-sm">
                    <span className="w-4 text-xs font-bold text-muted-foreground">{i + 1}</span>
                    <span className="flex-1 truncate">{item.name}</span>
                    <span className="text-xs text-muted-foreground">×{item.qty}</span>
                    <span className="font-semibold">{money(item.revenue)}</span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>

        <section className="rounded-2xl border border-border bg-card p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold">Floor status</h2>
            <Link href="/waiter" className="text-xs font-semibold text-primary underline">
              Open waiter board →
            </Link>
          </div>
          <div className="mt-2 grid grid-cols-4 gap-1.5 sm:grid-cols-6 lg:grid-cols-10">
            {tables.map((t) => (
              <div
                key={t.id}
                className={cn(
                  'rounded-lg p-2 text-center text-xs font-bold',
                  t.bill_requests > 0
                    ? 'bg-fuchsia-600 text-white'
                    : t.open_calls > 0
                      ? 'bg-orange-500 text-white'
                      : t.pending_orders > 0
                        ? 'bg-amber-400 text-black'
                        : t.status === 'occupied'
                          ? 'bg-blue-600 text-white'
                          : 'bg-secondary text-muted-foreground',
                )}
                title={`Table ${t.number}`}
              >
                {t.number}
              </div>
            ))}
          </div>
        </section>

        <div className="grid gap-3 sm:grid-cols-2">
          <Link
            href="/admin/feedback"
            className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-accent-foreground">
              <MessageSquareHeart className="h-5 w-5" />
            </span>
            <div className="flex-1">
              <p className="text-sm font-bold">Private feedback</p>
              <p className="text-xs text-muted-foreground">{stats.newFeedback} unread</p>
            </div>
            <Badge variant={stats.newFeedback ? 'warning' : 'muted'}>{stats.newFeedback}</Badge>
          </Link>

          <div className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-accent-foreground">
              <Star className="h-5 w-5" />
            </span>
            <div className="flex-1">
              <p className="text-sm font-bold">Average rating</p>
              <p className="text-xs text-muted-foreground">All public-review prompts</p>
            </div>
            <span className="text-lg font-black">{stats.avgRating ?? '—'}</span>
          </div>
        </div>

        <p className="text-center text-[11px] text-muted-foreground">
          Signed in as {user.email} · refreshed {timeAgo(new Date())} ago
        </p>
      </div>
    </AdminShell>
  );
}
