'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { AdminShell } from '@/components/staff/AdminShell';
import { HourBars } from '@/components/admin/HourBars';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { money } from '@/lib/utils';
import { toCsv } from '@/lib/sanitize';
import type { StaffUser } from '@/types';
import { Download, IndianRupee, Receipt, TrendingUp, Users } from 'lucide-react';

type Report = {
  from: string;
  to: string;
  totalOrders: number;
  totalRevenue: number;
  rejectedOrders: number;
  averageOrderValue: number;
  topItems: { name: string; qty: number; revenue: number }[];
  byHour: { hour: number; orders: number; revenue: number }[];
  byDay: { date: string; orders: number; revenue: number }[];
  byTable: { table_number: number; orders: number; revenue: number }[];
};

function downloadCsv(filename: string, rows: (string | number)[][]) {
  const blob = new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function AdminReports({ user, report }: { user: StaffUser; report: Report }) {
  const router = useRouter();
  const [from, setFrom] = React.useState(report.from);
  const [to, setTo] = React.useState(report.to);


  function apply(next?: { from?: string; to?: string }) {
    const f = next?.from ?? from;
    const t = next?.to ?? to;
    router.push(`/admin/reports?from=${f}&to=${t}`);
  }

  function quickRange(days: number) {
    const end = new Date();
    const start = new Date(Date.now() - (days - 1) * 86400_000);
    setFrom(start.toISOString().slice(0, 10));
    setTo(end.toISOString().slice(0, 10));
    apply({ from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) });
  }

  return (
    <AdminShell user={user}>
      <div className="space-y-4">
        <section className="rounded-2xl border border-border bg-card p-3">
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <Label htmlFor="from" className="text-xs">
                From
              </Label>
              <Input id="from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="mt-1 h-10" />
            </div>
            <div>
              <Label htmlFor="to" className="text-xs">
                To
              </Label>
              <Input id="to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="mt-1 h-10" />
            </div>
            <Button onClick={() => apply()} className="h-10">
              Apply
            </Button>
            <div className="ml-auto flex gap-1">
              <Button variant="outline" size="sm" onClick={() => quickRange(1)}>
                Today
              </Button>
              <Button variant="outline" size="sm" onClick={() => quickRange(7)}>
                7 days
              </Button>
              <Button variant="outline" size="sm" onClick={() => quickRange(30)}>
                30 days
              </Button>
            </div>
          </div>
        </section>

        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          {[
            { label: 'Revenue', value: money(report.totalRevenue), icon: IndianRupee, tone: 'bg-emerald-600 text-white' },
            { label: 'Orders', value: String(report.totalOrders), icon: Receipt, tone: 'bg-primary text-primary-foreground' },
            { label: 'Avg order', value: money(report.averageOrderValue), icon: TrendingUp, tone: 'bg-blue-600 text-white' },
            { label: 'Rejected', value: String(report.rejectedOrders), icon: Users, tone: 'bg-secondary text-foreground' },
          ].map((c) => (
            <div key={c.label} className={`rounded-2xl p-3 ${c.tone}`}>
              <c.icon className="h-4 w-4 opacity-80" />
              <p className="mt-1.5 text-xl font-black leading-none">{c.value}</p>
              <p className="text-[10px] font-semibold uppercase tracking-wide opacity-90">{c.label}</p>
            </div>
          ))}
        </div>

        <section className="rounded-2xl border border-border bg-card p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold">Orders by hour</h2>
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                downloadCsv(`hourly-${report.from}_${report.to}.csv`, [
                  ['Hour', 'Orders', 'Revenue'],
                  ...report.byHour.map((h) => [`${h.hour}:00`, h.orders, h.revenue]),
                ])
              }
            >
              <Download className="h-3.5 w-3.5" /> CSV
            </Button>
          </div>
          {report.byHour.length === 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">No sales in this range.</p>
          ) : (
            <HourBars rows={report.byHour} className="mt-3" tickEvery={4} />
          )}
        </section>

        <section className="rounded-2xl border border-border bg-card p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold">Top items</h2>
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                downloadCsv(`top-items-${report.from}_${report.to}.csv`, [
                  ['Item', 'Quantity', 'Revenue'],
                  ...report.topItems.map((i) => [i.name, i.qty, i.revenue]),
                ])
              }
            >
              <Download className="h-3.5 w-3.5" /> CSV
            </Button>
          </div>
          <table className="mt-2 w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="pb-1 font-semibold">Item</th>
                <th className="pb-1 text-right font-semibold">Qty</th>
                <th className="pb-1 text-right font-semibold">Revenue</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {report.topItems.map((item) => (
                <tr key={item.name}>
                  <td className="py-1.5">{item.name}</td>
                  <td className="py-1.5 text-right">{item.qty}</td>
                  <td className="py-1.5 text-right font-semibold">{money(item.revenue)}</td>
                </tr>
              ))}
              {report.topItems.length === 0 && (
                <tr>
                  <td colSpan={3} className="py-3 text-center text-xs text-muted-foreground">
                    Nothing sold in this range
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>

        <div className="grid gap-3 lg:grid-cols-2">
          <section className="rounded-2xl border border-border bg-card p-4">
            <h2 className="text-sm font-bold">Daily totals</h2>
            <table className="mt-2 w-full text-sm">
              <tbody className="divide-y divide-border">
                {report.byDay.map((d) => (
                  <tr key={d.date}>
                    <td className="py-1.5">{d.date}</td>
                    <td className="py-1.5 text-right text-xs text-muted-foreground">{d.orders} orders</td>
                    <td className="py-1.5 text-right font-semibold">{money(d.revenue)}</td>
                  </tr>
                ))}
                {report.byDay.length === 0 && (
                  <tr>
                    <td className="py-3 text-center text-xs text-muted-foreground">No data</td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>

          <section className="rounded-2xl border border-border bg-card p-4">
            <h2 className="text-sm font-bold">Top tables</h2>
            <table className="mt-2 w-full text-sm">
              <tbody className="divide-y divide-border">
                {report.byTable.map((t) => (
                  <tr key={t.table_number}>
                    <td className="py-1.5">Table {t.table_number}</td>
                    <td className="py-1.5 text-right text-xs text-muted-foreground">{t.orders} orders</td>
                    <td className="py-1.5 text-right font-semibold">{money(t.revenue)}</td>
                  </tr>
                ))}
                {report.byTable.length === 0 && (
                  <tr>
                    <td className="py-3 text-center text-xs text-muted-foreground">No data</td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>
        </div>

        <Button
          variant="outline"
          className="w-full"
          onClick={() =>
            downloadCsv(`sales-${report.from}_${report.to}.csv`, [
              ['Table', 'Orders', 'Revenue'],
              ...report.byTable.map((t) => [t.table_number, t.orders, t.revenue]),
              [],
              ['Date', 'Orders', 'Revenue'],
              ...report.byDay.map((d) => [d.date, d.orders, d.revenue]),
            ])
          }
        >
          <Download className="h-4 w-4" /> Export full report (CSV)
        </Button>
      </div>
    </AdminShell>
  );
}
