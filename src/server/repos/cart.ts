import 'server-only';
import { db, transaction } from '@/server/db';
import { sanitizeText } from '@/lib/sanitize';

export type CartLine = {
  id: string;
  menu_item_id: string;
  name: string;
  image_url: string | null;
  is_veg: boolean;
  qty: number;
  notes: string | null;
  added_by_guest: number;
  base_price: number;
  unit_price: number;
  offer_active: boolean;
  is_available: boolean;
  line_total: number;
};

export type Cart = {
  id: string;
  lines: CartLine[];
  subtotal: number;
  itemCount: number;
};

async function ensureCart(sessionId: string, restaurantId: string) {
  const existing = await db.one<{ id: string }>(`select id from carts where session_id = $1`, [sessionId]);
  if (existing) return existing.id;
  const created = await db.one<{ id: string }>(
    `insert into carts (restaurant_id, session_id) values ($1,$2)
     on conflict (session_id) do update set updated_at = now() returning id`,
    [restaurantId, sessionId],
  );
  return created!.id;
}

export async function getCart(sessionId: string, restaurantId: string): Promise<Cart> {
  const cartId = await ensureCart(sessionId, restaurantId);
  const rows = await db.query<any>(
    `select ci.id, ci.menu_item_id, ci.qty, ci.notes, ci.added_by_guest,
            mi.name, mi.image_url, mi.is_veg, mi.is_available,
            mi.price as base_price, mi.effective_price, mi.offer_active
       from cart_items ci
       join menu_items_public mi on mi.id = ci.menu_item_id
      where ci.cart_id = $1
      order by ci.created_at`,
    [cartId],
  );

  const lines: CartLine[] = rows.map((r) => {
    const unit = Number(r.effective_price);
    return {
      id: r.id,
      menu_item_id: r.menu_item_id,
      name: r.name,
      image_url: r.image_url,
      is_veg: r.is_veg,
      qty: r.qty,
      notes: r.notes,
      added_by_guest: r.added_by_guest,
      base_price: Number(r.base_price),
      unit_price: unit,
      offer_active: Boolean(r.offer_active),
      is_available: r.is_available,
      line_total: unit * r.qty,
    };
  });

  return {
    id: cartId,
    lines,
    subtotal: Math.round(lines.reduce((s, l) => s + l.line_total, 0) * 100) / 100,
    itemCount: lines.reduce((s, l) => s + l.qty, 0),
  };
}

export async function addToCart(
  sessionId: string,
  restaurantId: string,
  input: { menuItemId: string; qty: number; notes?: string },
  guestNo: number,
) {
  const item = await db.one<{ id: string; is_available: boolean; name: string }>(
    `select id, is_available, name from menu_items
      where id = $1 and restaurant_id = $2`,
    [input.menuItemId, restaurantId],
  );
  if (!item) throw new CartError('That item is no longer on the menu.');
  if (!item.is_available) throw new CartError(`${item.name} is sold out right now.`);

  const cartId = await ensureCart(sessionId, restaurantId);
  const notes = input.notes ? sanitizeText(input.notes, 200) : null;

  // merge identical item+notes+guest lines to keep the shared cart tidy
  const existing = await db.one<{ id: string; qty: number }>(
    `select id, qty from cart_items
      where cart_id = $1 and menu_item_id = $2 and added_by_guest = $3
        and coalesce(notes,'') = coalesce($4,'')
      limit 1`,
    [cartId, input.menuItemId, guestNo, notes],
  );
  if (existing) {
    await db.query(`update cart_items set qty = least(qty + $2, 50) where id = $1`, [
      existing.id,
      input.qty,
    ]);
  } else {
    await db.query(
      `insert into cart_items (restaurant_id, cart_id, menu_item_id, qty, notes, added_by_guest)
       values ($1,$2,$3,$4,$5,$6)`,
      [restaurantId, cartId, input.menuItemId, input.qty, notes, guestNo],
    );
  }
  await db.query(`update carts set updated_at = now() where id = $1`, [cartId]);
  return getCart(sessionId, restaurantId);
}

export async function updateCartQty(sessionId: string, cartItemId: string, qty: number) {
  // qty 0 means "remove" in the UI (the minus button at 1), so it must be a DELETE.
  // The old code updated to 0 first and then deleted: cart_items_qty_check (qty >= 1)
  // rejected the update, and the guest's stepper failed with a 500.
  if (qty === 0) return removeCartItem(sessionId, cartItemId);
  const row = await db.one<{ restaurant_id: string }>(
    `update cart_items ci set qty = $3
       from carts c
      where ci.id = $1 and ci.cart_id = c.id and c.session_id = $2
      returning ci.restaurant_id`,
    [cartItemId, sessionId, qty],
  );
  if (!row) throw new CartError('Cart item not found.');
  return getCart(sessionId, row.restaurant_id);
}

export async function removeCartItem(sessionId: string, cartItemId: string) {
  const row = await db.one<{ restaurant_id: string }>(
    `delete from cart_items ci
       using carts c
      where ci.id = $1 and ci.cart_id = c.id and c.session_id = $2
      returning ci.restaurant_id`,
    [cartItemId, sessionId],
  );
  if (!row) throw new CartError('Cart item not found.');
  return getCart(sessionId, row.restaurant_id);
}

export async function clearCart(sessionId: string, restaurantId: string) {
  await db.query(
    `delete from cart_items ci using carts c where ci.cart_id = c.id and c.session_id = $1`,
    [sessionId],
  );
  return getCart(sessionId, restaurantId);
}

export class CartError extends Error {}
