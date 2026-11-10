'use client';

import * as React from 'react';
import { AdminShell } from '@/components/staff/AdminShell';
import { api } from '@/lib/api-client';
import { useToast } from '@/components/ui/toast';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import type { StaffUser } from '@/types';
import { Copy, Download, ExternalLink, Plus, QrCode, RefreshCw, Trash2 } from 'lucide-react';

type TableRow = {
  id: string;
  number: number;
  label: string | null;
  zone: string | null;
  table_code: string;
};

export function AdminTables({
  user,
  tables: initial,
  appUrl,
}: {
  user: StaffUser;
  tables: TableRow[];
  appUrl: string;
}) {
  const { push } = useToast();
  const [tables, setTables] = React.useState(initial);
  const [editing, setEditing] = React.useState<TableRow | 'new' | null>(null);
  const [qrFor, setQrFor] = React.useState<TableRow | null>(null);
  const [qrImage, setQrImage] = React.useState<string | null>(null);
  const [origin, setOrigin] = React.useState(appUrl);

  React.useEffect(() => {
    if (!appUrl && typeof window !== 'undefined') setOrigin(window.location.origin);
  }, [appUrl]);

  const reload = React.useCallback(async () => {
    const res = await api.get<{ tables: TableRow[] }>('/api/admin/tables');
    setTables(res.tables);
  }, []);

  const tableUrl = (code: string) => `${origin || 'https://your-domain.com'}/t/${code}`;

  async function copy(value: string, label: string) {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(value);
      push(`${label} copied`, 'success');
    } catch {
      push('Copy blocked by the browser — select the link and copy manually', 'error');
    }
  }

  async function showQr(table: TableRow) {
    setQrFor(table);
    setQrImage(null);
    try {
      const QRCode = (await import('qrcode')).default;
      const url = await QRCode.toDataURL(tableUrl(table.table_code), {
        margin: 1,
        width: 512,
        errorCorrectionLevel: 'M',
      });
      setQrImage(url);
    } catch {
      push('Could not generate the QR image', 'error');
    }
  }

  async function regenerate(table: TableRow) {
    if (
      !confirm(
        `Regenerate the code for table ${table.number}?\n\nThe old QR sticker and NFC tag stop working immediately and any open session is closed.`,
      )
    )
      return;
    try {
      const res = await api.post<{ table_code: string }>('/api/admin/table-regenerate', { id: table.id });
      setTables((prev) => prev.map((t) => (t.id === table.id ? { ...t, table_code: res.table_code } : t)));
      push('New code generated — print the new QR sticker', 'success');
    } catch (err) {
      push(err instanceof Error ? err.message : 'Could not regenerate', 'error');
    }
  }

  async function remove(table: TableRow) {
    if (!confirm(`Remove table ${table.number}? Past orders are kept for reports.`)) return;
    await api.post('/api/admin/table-delete', { id: table.id });
    await reload();
    push('Table removed', 'success');
  }

  return (
    <AdminShell user={user}>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => setEditing('new')}>
            <Plus className="h-4 w-4" /> Add table
          </Button>
          <Button variant="outline" asChild>
            <a href="/api/admin/qr-pdf" target="_blank" rel="noopener noreferrer">
              <Download className="h-4 w-4" /> Download printable QR sheet (PDF)
            </a>
          </Button>
        </div>

        <p className="rounded-xl bg-secondary p-3 text-xs text-muted-foreground">
          Each table has a long random code — never the table number — so guests cannot guess a
          neighbouring table&apos;s link. Regenerate a code if a sticker is photographed and abused;
          open sessions close immediately.
        </p>

        <div className="space-y-2">
          {tables.map((table) => (
            <article
              key={table.id}
              className="rounded-xl border border-border bg-card p-3 shadow-soft transition hover:border-primary/40"
            >
              <div className="flex items-start gap-2">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-lg font-black text-primary">
                  {table.number}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold">
                    Table {table.number}
                    {table.label && table.label.trim() !== `Table ${table.number}`
                      ? ` · ${table.label}`
                      : ''}
                  </p>
                  <p className="truncate font-mono text-[11px] text-muted-foreground">
                    {tableUrl(table.table_code)}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    <Badge variant="secondary" className="text-[10px]">
                      {table.zone ?? 'no zone'}
                    </Badge>
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <button
                    type="button"
                    onClick={() => showQr(table)}
                    className="tap rounded-lg text-primary hover:bg-secondary"
                    aria-label={`Show QR for table ${table.number}`}
                  >
                    <QrCode className="h-5 w-5" />
                  </button>
                  <div className="flex gap-0.5">
                    <button
                      type="button"
                      onClick={() => copy(tableUrl(table.table_code), 'Link')}
                      className="tap rounded-lg text-muted-foreground hover:bg-secondary"
                      aria-label="Copy link"
                    >
                      <Copy className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => regenerate(table)}
                      className="tap rounded-lg text-muted-foreground hover:bg-secondary"
                      aria-label="Regenerate code"
                    >
                      <RefreshCw className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(table)}
                      className="tap rounded-lg text-destructive hover:bg-destructive/10"
                      aria-label="Delete table"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>

      <TableDialog
        open={editing !== null}
        table={editing}
        onClose={() => setEditing(null)}
        onSaved={async () => {
          setEditing(null);
          await reload();
          push('Table saved', 'success');
        }}
      />

      <Dialog open={Boolean(qrFor)} onOpenChange={(o) => !o && setQrFor(null)}>
        {qrFor && (
          <DialogContent
            title={`Table ${qrFor.number} QR code`}
            description="Print this and stick it on the table, or write the URL to an NFC tag."
          >
            <div className="space-y-3 text-center">
              {qrImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={qrImage} alt={`QR code for table ${qrFor.number}`} className="mx-auto h-64 w-64" />
              ) : (
                <div className="skeleton mx-auto h-64 w-64" />
              )}
              <code className="block break-all rounded-lg bg-secondary p-2 text-xs">
                {tableUrl(qrFor.table_code)}
              </code>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => copy(tableUrl(qrFor.table_code), 'Link')}>
                  <Copy className="h-4 w-4" /> Copy link
                </Button>
                {qrImage && (
                  <Button asChild className="flex-1">
                    <a href={qrImage} download={`table-${qrFor.number}-qr.png`}>
                      <Download className="h-4 w-4" /> Download PNG
                    </a>
                  </Button>
                )}
              </div>
              <a
                href={tableUrl(qrFor.table_code)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs font-medium text-primary underline"
              >
                Open as a guest <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </AdminShell>
  );
}

function TableDialog({
  open,
  table,
  onClose,
  onSaved,
}: {
  open: boolean;
  table: TableRow | 'new' | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { push } = useToast();
  const [busy, setBusy] = React.useState(false);
  const [form, setForm] = React.useState({ number: 1, label: '', seats: 4, zone: '', isActive: true });

  React.useEffect(() => {
    if (table === 'new') setForm({ number: 1, label: '', seats: 4, zone: '', isActive: true });
    else if (table)
      setForm({ number: table.number, label: table.label ?? '', seats: 4, zone: table.zone ?? '', isActive: true });
  }, [table]);

  async function save() {
    setBusy(true);
    try {
      await api.post('/api/admin/table', {
        id: table !== 'new' && table ? table.id : undefined,
        number: Number(form.number),
        label: form.label || null,
        seats: Number(form.seats),
        zone: form.zone || null,
        isActive: form.isActive,
      });
      await onSaved();
    } catch (err) {
      push(err instanceof Error ? err.message : 'Could not save', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={table === 'new' ? 'Add table' : 'Edit table'}>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor="t-number">Table number</Label>
              <Input
                id="t-number"
                type="number"
                min={1}
                value={form.number}
                onChange={(e) => setForm({ ...form, number: Number(e.target.value) })}
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="t-seats">Seats</Label>
              <Input
                id="t-seats"
                type="number"
                min={1}
                value={form.seats}
                onChange={(e) => setForm({ ...form, seats: Number(e.target.value) })}
                className="mt-1"
              />
            </div>
          </div>
          <div>
            <Label htmlFor="t-label">Label (optional)</Label>
            <Input
              id="t-label"
              value={form.label}
              onChange={(e) => setForm({ ...form, label: e.target.value })}
              placeholder="Window table, Terrace…"
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="t-zone">Zone (optional)</Label>
            <Input
              id="t-zone"
              value={form.zone}
              onChange={(e) => setForm({ ...form, zone: e.target.value })}
              placeholder="Indoor / Terrace / Rooftop"
              className="mt-1"
            />
          </div>
          <div className="flex items-center justify-between rounded-xl border border-border p-2">
            <span className="text-sm">Active</span>
            <Switch
              checked={form.isActive}
              onCheckedChange={(v) => setForm({ ...form, isActive: v })}
              aria-label="Active"
            />
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={onClose}>
              Cancel
            </Button>
            <Button className="flex-1" onClick={save} loading={busy}>
              Save table
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
