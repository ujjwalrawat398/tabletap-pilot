'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { AdminShell } from '@/components/staff/AdminShell';
import { api } from '@/lib/api-client';
import { useToast } from '@/components/ui/toast';
import { Button } from '@/components/ui/button';
import { Input, Label, Select, Textarea } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { cn, money } from '@/lib/utils';
import type { StaffUser } from '@/types';
import { Pencil, Plus, Search, Trash2, Tag, X } from 'lucide-react';

type Category = {
  id: string;
  name: string;
  description: string | null;
  emoji: string | null;
  sort_order: number;
  is_active: boolean;
};

type Item = {
  id: string;
  category_id: string;
  name: string;
  description: string | null;
  price: string | number;
  offer_price: string | number | null;
  offer_start: string | Date | null;
  offer_end: string | Date | null;
  effective_price: string | number;
  is_available: boolean;
  is_veg: boolean;
  image_url: string | null;
  spice_level: number;
  prep_minutes: number;
  sort_order: number;
};

/**
 * timestamptz columns reach the browser as a Date (server-rendered page) or an ISO string (API reload).
 * <input type="datetime-local"> wants local time as "YYYY-MM-DDTHH:mm"; saving does new Date(value),
 * which reads it as local time again, so the round trip is exact.
 */
function toLocalInput(value: string | Date | null): string {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const p2 = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}`;
}

export function AdminMenu({
  user,
  categories: initialCategories,
  items: initialItems,
}: {
  user: StaffUser;
  categories: Category[];
  items: Item[];
}) {
  const router = useRouter();
  const { push } = useToast();
  const [categories, setCategories] = React.useState(initialCategories);
  const [items, setItems] = React.useState(initialItems);
  const [query, setQuery] = React.useState('');
  const [activeCategory, setActiveCategory] = React.useState<string | 'all'>('all');
  const [editingItem, setEditingItem] = React.useState<Item | 'new' | null>(null);
  const [editingCategory, setEditingCategory] = React.useState<Category | 'new' | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);

  const reload = React.useCallback(async () => {
    const res = await api.get<{ categories: Category[]; items: Item[] }>('/api/admin/menu');
    setCategories(res.categories);
    setItems(res.items);
    router.refresh();
  }, [router]);

  async function toggleSoldOut(item: Item) {
    setBusy(item.id);
    setItems((prev) =>
      prev.map((i) => (i.id === item.id ? { ...i, is_available: !i.is_available } : i)),
    );
    try {
      await api.post('/api/admin/sold-out', { itemId: item.id, isAvailable: !item.is_available });
      push(`${item.name} ${item.is_available ? 'marked sold out' : 'back in stock'}`, 'success');
    } catch (err) {
      push(err instanceof Error ? err.message : 'Could not update', 'error');
      await reload();
    } finally {
      setBusy(null);
    }
  }

  async function deleteItem(item: Item) {
    if (!confirm(`Remove "${item.name}" from the menu? Past orders keep their records.`)) return;
    await api.post('/api/admin/menu-item-delete', { id: item.id });
    push('Item removed', 'success');
    await reload();
  }

  const filtered = items.filter((i) => {
    if (activeCategory !== 'all' && i.category_id !== activeCategory) return false;
    if (!query) return true;
    return i.name.toLowerCase().includes(query.toLowerCase());
  });

  const categoryName = (id: string) => categories.find((c) => c.id === id)?.name ?? '—';

  return (
    <AdminShell user={user}>
      <div className="space-y-3">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search menu items…"
              className="pl-9"
            />
          </div>
          <Button onClick={() => setEditingItem('new')}>
            <Plus className="h-4 w-4" /> Item
          </Button>
        </div>

        <div className="no-scrollbar flex items-center gap-1.5 overflow-x-auto pb-1">
          <button
            type="button"
            onClick={() => setActiveCategory('all')}
            className={cn(
              'min-h-[36px] shrink-0 rounded-lg px-3 text-xs font-semibold',
              activeCategory === 'all' ? 'bg-primary text-primary-foreground' : 'bg-secondary',
            )}
          >
            All ({items.length})
          </button>
          {categories.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setActiveCategory(c.id)}
              className={cn(
                'min-h-[36px] shrink-0 rounded-lg px-3 text-xs font-semibold',
                activeCategory === c.id ? 'bg-primary text-primary-foreground' : 'bg-secondary',
              )}
            >
              {c.name} ({items.filter((i) => i.category_id === c.id).length})
            </button>
          ))}
          <button
            type="button"
            onClick={() => setEditingCategory('new')}
            className="min-h-[36px] shrink-0 rounded-lg border border-dashed border-border px-3 text-xs font-semibold text-muted-foreground"
          >
            + Category
          </button>
        </div>

        <div className="space-y-2">
          {filtered.length === 0 && (
            <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              No items yet. Add your first dish.
            </p>
          )}

          {filtered.map((item) => {
            const hasOffer =
              item.offer_price !== null && Number(item.offer_price) < Number(item.price);
            return (
              <article
                key={item.id}
                className={cn(
                  'rounded-xl border border-border bg-card p-3',
                  !item.is_available && 'opacity-70',
                )}
              >
                <div className="flex items-start gap-2">
                  <span
                    className={cn(
                      'mt-1.5 h-3 w-3 shrink-0 rounded-[3px] border-2',
                      item.is_veg ? 'border-emerald-600' : 'border-red-600',
                    )}
                    aria-label={item.is_veg ? 'Veg' : 'Non-veg'}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold">{item.name}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {categoryName(item.category_id)} · {item.prep_minutes} min
                    </p>
                    <p className="mt-0.5 flex items-center gap-2 text-sm">
                      <span className="font-semibold">{money(Number(item.price))}</span>
                      {hasOffer && (
                        <>
                          <span className="text-xs font-semibold text-[hsl(var(--success))]">
                            → {money(Number(item.offer_price))}
                          </span>
                          <Badge variant="success" className="text-[10px]">
                            <Tag className="h-2.5 w-2.5" /> offer
                          </Badge>
                        </>
                      )}
                    </p>
                  </div>

                  <div className="flex flex-col items-end gap-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] font-semibold text-muted-foreground">
                        {item.is_available ? 'Available' : 'Sold out'}
                      </span>
                      <Switch
                        checked={item.is_available}
                        onCheckedChange={() => toggleSoldOut(item)}
                        disabled={busy === item.id}
                        aria-label={`Toggle availability for ${item.name}`}
                      />
                    </div>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => setEditingItem(item)}
                        className="tap rounded-lg text-muted-foreground hover:bg-secondary"
                        aria-label={`Edit ${item.name}`}
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteItem(item)}
                        className="tap rounded-lg text-destructive hover:bg-destructive/10"
                        aria-label={`Delete ${item.name}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </div>

        {categories.length > 0 && (
          <section className="rounded-xl border border-border bg-card p-3">
            <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
              Categories
            </h3>
            <ul className="mt-2 space-y-1">
              {categories.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-2 text-sm">
                  <span>
                    {c.name}
                    {!c.is_active && <span className="ml-2 text-[10px] text-muted-foreground">(hidden)</span>}
                  </span>
                  <button
                    type="button"
                    onClick={() => setEditingCategory(c)}
                    className="tap rounded-lg text-muted-foreground hover:bg-secondary"
                    aria-label={`Edit ${c.name}`}
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <ItemDialog
        open={editingItem !== null}
        item={editingItem}
        categories={categories}
        onClose={() => setEditingItem(null)}
        onSaved={async () => {
          setEditingItem(null);
          await reload();
          push('Menu saved', 'success');
        }}
      />

      <CategoryDialog
        open={editingCategory !== null}
        category={editingCategory}
        onClose={() => setEditingCategory(null)}
        onSaved={async () => {
          setEditingCategory(null);
          await reload();
          push('Category saved', 'success');
        }}
      />
    </AdminShell>
  );
}

function ItemDialog({
  open,
  item,
  categories,
  onClose,
  onSaved,
}: {
  open: boolean;
  item: Item | 'new' | null;
  categories: Category[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { push } = useToast();
  const [busy, setBusy] = React.useState(false);
  const blank = {
    categoryId: categories[0]?.id ?? '',
    name: '',
    description: '',
    price: '',
    offerPrice: '',
    offerStart: '',
    offerEnd: '',
    isVeg: true,
    isAvailable: true,
    imageUrl: '',
    spiceLevel: 0,
    prepMinutes: 10,
    sortOrder: 0,
  };
  const [form, setForm] = React.useState(blank);

  React.useEffect(() => {
    if (item === 'new') setForm(blank);
    else if (item) {
      setForm({
        categoryId: item.category_id,
        name: item.name,
        description: item.description ?? '',
        price: String(item.price),
        offerPrice: item.offer_price === null ? '' : String(item.offer_price),
        offerStart: toLocalInput(item.offer_start),
        offerEnd: toLocalInput(item.offer_end),
        isVeg: item.is_veg,
        isAvailable: item.is_available,
        imageUrl: item.image_url ?? '',
        spiceLevel: item.spice_level,
        prepMinutes: item.prep_minutes,
        sortOrder: item.sort_order,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item]);

  async function save() {
    setBusy(true);
    try {
      await api.post('/api/admin/menu-item', {
        id: item !== 'new' && item ? item.id : undefined,
        categoryId: form.categoryId,
        name: form.name,
        description: form.description || null,
        price: Number(form.price),
        offerPrice: form.offerPrice ? Number(form.offerPrice) : null,
        offerStart: form.offerStart ? new Date(form.offerStart).toISOString() : null,
        offerEnd: form.offerEnd ? new Date(form.offerEnd).toISOString() : null,
        isAvailable: form.isAvailable,
        isVeg: form.isVeg,
        imageUrl: form.imageUrl || null,
        spiceLevel: Number(form.spiceLevel),
        prepMinutes: Number(form.prepMinutes),
        sortOrder: Number(form.sortOrder),
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
      <DialogContent title={item === 'new' ? 'New menu item' : 'Edit menu item'}>
        <div className="space-y-3">
          <div>
            <Label htmlFor="item-name">Name</Label>
            <Input
              id="item-name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="mt-1"
            />
          </div>

          <div>
            <Label htmlFor="item-desc">Description</Label>
            <Textarea
              id="item-desc"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="mt-1"
              maxLength={400}
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor="item-cat">Category</Label>
              <Select
                id="item-cat"
                value={form.categoryId}
                onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
                className="mt-1"
              >
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="item-price">Price (₹)</Label>
              <Input
                id="item-price"
                type="number"
                inputMode="decimal"
                min={0}
                value={form.price}
                onChange={(e) => setForm({ ...form, price: e.target.value })}
                className="mt-1"
              />
            </div>
          </div>

          <fieldset className="rounded-xl border border-border p-3">
            <legend className="px-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">
              Offer (optional)
            </legend>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <Label htmlFor="offer-price" className="text-xs">
                  Offer price
                </Label>
                <Input
                  id="offer-price"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  value={form.offerPrice}
                  onChange={(e) => setForm({ ...form, offerPrice: e.target.value })}
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="offer-start" className="text-xs">
                  From
                </Label>
                <Input
                  id="offer-start"
                  type="datetime-local"
                  value={form.offerStart}
                  onChange={(e) => setForm({ ...form, offerStart: e.target.value })}
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="offer-end" className="text-xs">
                  Until
                </Label>
                <Input
                  id="offer-end"
                  type="datetime-local"
                  value={form.offerEnd}
                  onChange={(e) => setForm({ ...form, offerEnd: e.target.value })}
                  className="mt-1"
                />
              </div>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Leave the dates empty for an always-on offer. The guest sees the cut price automatically.
            </p>
          </fieldset>

          <div className="grid grid-cols-2 gap-2">
            <div className="flex items-center justify-between rounded-xl border border-border p-2">
              <span className="text-sm">Vegetarian</span>
              <Switch
                checked={form.isVeg}
                onCheckedChange={(v) => setForm({ ...form, isVeg: v })}
                aria-label="Vegetarian"
              />
            </div>
            <div className="flex items-center justify-between rounded-xl border border-border p-2">
              <span className="text-sm">Available</span>
              <Switch
                checked={form.isAvailable}
                onCheckedChange={(v) => setForm({ ...form, isAvailable: v })}
                aria-label="Available"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div>
              <Label htmlFor="spice" className="text-xs">
                Spice (0-3)
              </Label>
              <Input
                id="spice"
                type="number"
                min={0}
                max={3}
                value={form.spiceLevel}
                onChange={(e) => setForm({ ...form, spiceLevel: Number(e.target.value) })}
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="prep" className="text-xs">
                Prep mins
              </Label>
              <Input
                id="prep"
                type="number"
                min={1}
                value={form.prepMinutes}
                onChange={(e) => setForm({ ...form, prepMinutes: Number(e.target.value) })}
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="sort" className="text-xs">
                Sort
              </Label>
              <Input
                id="sort"
                type="number"
                value={form.sortOrder}
                onChange={(e) => setForm({ ...form, sortOrder: Number(e.target.value) })}
                className="mt-1"
              />
            </div>
          </div>

          <div>
            <Label htmlFor="image" className="text-xs">
              Image URL (optional)
            </Label>
            <Input
              id="image"
              value={form.imageUrl}
              onChange={(e) => setForm({ ...form, imageUrl: e.target.value })}
              placeholder="https://…/dish.webp"
              className="mt-1"
            />
          </div>

          <div className="flex gap-2 pt-1">
            <Button variant="outline" className="flex-1" onClick={onClose}>
              Cancel
            </Button>
            <Button
              className="flex-1"
              onClick={save}
              loading={busy}
              disabled={!form.name || !form.price || !form.categoryId}
            >
              Save item
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CategoryDialog({
  open,
  category,
  onClose,
  onSaved,
}: {
  open: boolean;
  category: Category | 'new' | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { push } = useToast();
  const [busy, setBusy] = React.useState(false);
  const [form, setForm] = React.useState({ name: '', emoji: '', description: '', sortOrder: 0, isActive: true });

  React.useEffect(() => {
    if (category === 'new') setForm({ name: '', emoji: '', description: '', sortOrder: 0, isActive: true });
    else if (category)
      setForm({
        name: category.name,
        emoji: category.emoji ?? '',
        description: category.description ?? '',
        sortOrder: category.sort_order,
        isActive: category.is_active,
      });
  }, [category]);

  async function save() {
    setBusy(true);
    try {
      await api.post('/api/admin/menu-category', {
        id: category !== 'new' && category ? category.id : undefined,
        name: form.name,
        emoji: form.emoji || null,
        description: form.description || null,
        sortOrder: Number(form.sortOrder),
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
      <DialogContent title={category === 'new' ? 'New category' : 'Edit category'}>
        <div className="space-y-3">
          <div className="grid grid-cols-[64px_1fr] gap-2">
            <div>
              <Label htmlFor="cat-emoji" className="text-xs">
                Icon
              </Label>
              <Input
                id="cat-emoji"
                value={form.emoji}
                onChange={(e) => setForm({ ...form, emoji: e.target.value })}
                className="mt-1 text-center"
                placeholder="🍛"
                maxLength={4}
              />
            </div>
            <div>
              <Label htmlFor="cat-name">Name</Label>
              <Input
                id="cat-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="mt-1"
              />
            </div>
          </div>
          <div>
            <Label htmlFor="cat-desc" className="text-xs">
              Short description
            </Label>
            <Input
              id="cat-desc"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="mt-1"
            />
          </div>
          <div className="flex items-center justify-between rounded-xl border border-border p-2">
            <span className="text-sm">Visible on the menu</span>
            <Switch
              checked={form.isActive}
              onCheckedChange={(v) => setForm({ ...form, isActive: v })}
              aria-label="Visible"
            />
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={onClose}>
              Cancel
            </Button>
            <Button className="flex-1" onClick={save} loading={busy} disabled={!form.name}>
              Save
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
