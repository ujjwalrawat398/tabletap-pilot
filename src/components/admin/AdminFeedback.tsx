'use client';

import * as React from 'react';
import { AdminShell } from '@/components/staff/AdminShell';
import { api } from '@/lib/api-client';
import { useToast } from '@/components/ui/toast';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn, timeAgo } from '@/lib/utils';
import type { StaffUser } from '@/types';
import { MessageSquareHeart, Star, Mail, Phone } from 'lucide-react';

type FeedbackRow = {
  id: string;
  rating: number | null;
  message: string;
  contact: string | null;
  status: 'new' | 'read' | 'resolved';
  created_at: string;
  table_number: number | null;
};

const FILTERS = ['new', 'all', 'resolved'] as const;

export function AdminFeedback({ user, feedback: initial }: { user: StaffUser; feedback: FeedbackRow[] }) {
  const { push } = useToast();
  const [rows, setRows] = React.useState(initial);
  const [filter, setFilter] = React.useState<(typeof FILTERS)[number]>('new');

  async function setStatus(row: FeedbackRow, status: FeedbackRow['status']) {
    setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, status } : r)));
    try {
      await api.post('/api/admin/feedback-status', { id: row.id, status });
    } catch (err) {
      push(err instanceof Error ? err.message : 'Could not update', 'error');
    }
  }

  const visible = rows.filter((r) => (filter === 'all' ? true : filter === 'new' ? r.status === 'new' : r.status === 'resolved'));

  return (
    <AdminShell user={user}>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={cn(
                'min-h-[38px] rounded-lg px-3 text-xs font-semibold capitalize',
                filter === f ? 'bg-primary text-primary-foreground' : 'bg-secondary',
              )}
            >
              {f}
              <span className="ml-1 opacity-70">
                {f === 'all' ? rows.length : rows.filter((r) => (f === 'new' ? r.status === 'new' : r.status === 'resolved')).length}
              </span>
            </button>
          ))}
        </div>

        <p className="rounded-xl bg-secondary p-3 text-[11px] text-muted-foreground">
          <MessageSquareHeart className="mr-1 inline h-3 w-3" />
          These are private: guests who rated 1–3 stars write here instead of being sent to Google.
          Nobody outside your team sees them.
        </p>

        {visible.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border p-8 text-center">
            <MessageSquareHeart className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden />
            <p className="mt-2 text-sm font-semibold">Nothing here</p>
            <p className="text-xs text-muted-foreground">No {filter} feedback yet.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {visible.map((row) => (
              <article
                key={row.id}
                className={cn(
                  'rounded-2xl border bg-card p-3',
                  row.status === 'new' ? 'border-amber-400' : 'border-border',
                )}
              >
                <div className="flex items-center gap-2">
                  <span className="flex items-center gap-0.5">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Star
                        key={i}
                        className={cn(
                          'h-3.5 w-3.5',
                          row.rating && i < row.rating
                            ? 'fill-amber-400 text-amber-400'
                            : 'text-muted-foreground/30',
                        )}
                      />
                    ))}
                  </span>
                  {row.table_number && (
                    <Badge variant="secondary" className="text-[10px]">
                      Table {row.table_number}
                    </Badge>
                  )}
                  <span className="ml-auto text-[11px] text-muted-foreground">
                    {timeAgo(row.created_at)} ago
                  </span>
                </div>

                <p className="mt-2 whitespace-pre-wrap text-sm">{row.message}</p>

                {row.contact && (
                  <p className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
                    {row.contact.includes('@') ? <Mail className="h-3 w-3" /> : <Phone className="h-3 w-3" />}
                    {row.contact}
                  </p>
                )}

                <div className="mt-2 flex gap-1.5">
                  {row.status !== 'read' && (
                    <Button size="sm" variant="outline" onClick={() => setStatus(row, 'read')}>
                      Mark read
                    </Button>
                  )}
                  {row.status !== 'resolved' && (
                    <Button size="sm" variant="success" onClick={() => setStatus(row, 'resolved')}>
                      Resolved
                    </Button>
                  )}
                  {row.status !== 'new' && (
                    <Button size="sm" variant="ghost" onClick={() => setStatus(row, 'new')}>
                      Reopen
                    </Button>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </AdminShell>
  );
}
