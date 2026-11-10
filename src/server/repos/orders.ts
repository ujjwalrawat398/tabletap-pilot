import 'server-only';
import { db, transaction } from '@/server/db';
import { ORDER_RATE_LIMIT } from '@/lib/constants';
import { rateLimit } from '@/server/auth';
import { sanitizeText } from '@/lib/sanitize';
import type { TableSession } from '@/server/session';

export type OrderStatus = 'pending' | 'confirmed' | 'rejected' | 'preparing' | 'ready' | 'served' | 'cancelled';

export type OrderItemView = {
  id: string;
  name_snapshot: string;
  qty: number;
  unit_price: number;
  base_price: number;
  offer_applied: boolean;
  notes: string | null;
  added_by_guest: number;
};

export type OrderView = {
  id: string;
  batch_no: number;
  status: OrderStatus;
  subtotal: number;
  tax: number;
  service_charge: number;
  total: number;
  notes: string | null;
  table_id: string;
  table_number?: number;
  session_id: string;
  created_at: string;
  confirmed_at: string | null;
  preparing_at: string | null;
  ready_at: string | null;
  rejected_reason: string | null;
  /** Pending queue only: when the table's visit started, and how many phones joined. */
  session_started_at?: string | null;
  session_devices?: number;
  items: OrderItemView[];
};

export class OrderError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

/**
 * Converts the shared cart into an order batch.
 * Prices are ALWAYS recalculated from the database (spec §5, §14) — the client
 * never sends money values.
 */
export async function sendOrder(session: TableSession, guestNo: number, notes?: string) {
  const limit = await rateLimit(`order:${session.id}`, ORDER_RATE_LIMIT.perSession, ORDER_RATE_LIMIT.windowSeconds);
  if (!limit.ok) throw new OrderError(`Please wait ${limit.retryAfter}s before sending another order.`, 429);

  const orderId = await transaction(async (tx) => {
    const cart = await tx.one<{ id: string }>(`select id from carts where session_id = $1`, [session.id]);
    if (!cart) throw new OrderError('Your cart is empty.');

    const lines = await tx.query<any>(
      `select ci.menu_item_id, ci.qty, ci.notes, ci.added_by_guest,
              mi.name, mi.price, mi.effective_price, mi.offer_active, mi.is_available
         from cart_items ci
         join menu_items_public mi on mi.id = ci.menu_item_id
        where ci.cart_id = $1
        order by ci.created_at`,
      [cart.id],
    );
    if (lines.length === 0) throw new OrderError('Your cart is empty.');
    const soldOut = lines.filter((l) => !l.is_available);
    if (soldOut.length) {
      throw new OrderError(
        `${soldOut.map((l) => l.name).join(', ')} just sold out. Please remove it from the cart.`,
      );
    }

    const restaurant = await tx.one<{
      tax_percent: number;
      service_charge_percent: number;
      auto_confirm_orders: boolean;
    }>(
      `select tax_percent, service_charge_percent, auto_confirm_orders
         from restaurants where id = $1`,
      [session.restaurant_id],
    );
    // J4: with auto-confirm ON the waiter already verified the table in person, so a
    // verified order goes straight to the kitchen. Default OFF keeps the confirm tap.
    const initialStatus = restaurant?.auto_confirm_orders ? 'confirmed' : 'pending';

    const subtotal = lines.reduce((s, l) => s + Number(l.effective_price) * l.qty, 0);
    const tax = Math.round(subtotal * (Number(restaurant?.tax_percent ?? 0) / 100) * 100) / 100;
    const service = Math.round(subtotal * (Number(restaurant?.service_charge_percent ?? 0) / 100) * 100) / 100;
    const total = Math.round((subtotal + tax + service) * 100) / 100;

    // Two tablets can send an order in the same millisecond; unique(session_id, batch_no)
    // makes the loser retry with the next number instead of creating a duplicate batch.
    const nextBatch = async () =>
      (
        await tx.one<{ next: number }>(
          `select coalesce(max(batch_no), 0) + 1 as next from orders where session_id = $1`,
          [session.id],
        )
      )?.next ?? 1;

    const insertOrder = (batchNo: number) =>
      tx.one<{ id: string }>(
        `insert into orders (restaurant_id, session_id, table_id, batch_no, status, subtotal, tax,
                             service_charge, total, notes, placed_by_guest, confirmed_at)
         values ($1,$2,$3,$4,$5::order_status,$6,$7,$8,$9,$10,$11,
                 case when $5::text = 'confirmed' then now() else null end) returning id`,
        [
          session.restaurant_id,
          session.id,
          session.table_id,
          batchNo,
          initialStatus,
          subtotal,
          tax,
          service,
          total,
          notes ? sanitizeText(notes, 300) : null,
          guestNo,
        ],
      );

    let order: { id: string } | null = null;
    for (let attempt = 0; attempt < 5 && !order; attempt++) {
      try {
        order = await insertOrder(await nextBatch());
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (!/unique|duplicate key/i.test(message) || attempt === 4) throw err;
      }
    }
    if (!order) throw new OrderError('Could not place the order. Please try again.', 500);

    for (const l of lines) {
      await tx.query(
        `insert into order_items (restaurant_id, order_id, menu_item_id, name_snapshot, qty,
                                  base_price, unit_price, offer_applied, notes, added_by_guest)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          session.restaurant_id,
          order.id,
          l.menu_item_id,
          l.name,
          l.qty,
          l.price,
          l.effective_price,
          Boolean(l.offer_active),
          l.notes,
          l.added_by_guest,
        ],
      );
    }

    await tx.query(`delete from cart_items where cart_id = $1`, [cart.id]);
    return order.id;
  });

  return orderId;
}

async function attachItems(orders: any[]) {
  if (orders.length === 0) return [] as OrderView[];
  const ids = orders.map((o) => o.id);
  const items = await db.query<any>(
    `select * from order_items where order_id = any($1::uuid[]) order by created_at`,
    [ids],
  );
  const grouped = new Map<string, OrderItemView[]>();
  for (const i of items) {
    const list = grouped.get(i.order_id) ?? [];
    list.push({
      id: i.id,
      name_snapshot: i.name_snapshot,
      qty: i.qty,
      unit_price: Number(i.unit_price),
      base_price: Number(i.base_price),
      offer_applied: i.offer_applied,
      notes: i.notes,
      added_by_guest: i.added_by_guest,
    });
    grouped.set(i.order_id, list);
  }
  return orders.map(
    (o): OrderView => ({
      id: o.id,
      batch_no: o.batch_no,
      status: o.status,
      subtotal: Number(o.subtotal),
      tax: Number(o.tax),
      service_charge: Number(o.service_charge),
      total: Number(o.total),
      notes: o.notes,
      table_id: o.table_id,
      table_number: o.table_number !== undefined ? o.table_number : undefined,
      session_id: o.session_id,
      created_at: o.created_at,
      confirmed_at: o.confirmed_at,
      preparing_at: o.preparing_at,
      ready_at: o.ready_at,
      rejected_reason: o.rejected_reason,
      session_started_at: o.session_started_at ?? null,
      session_devices: o.session_devices !== undefined ? Number(o.session_devices) : undefined,
      items: grouped.get(o.id) ?? [],
    }),
  );
}

/** Orders for one table session (customer live status view). */
export async function getSessionOrders(sessionId: string): Promise<OrderView[]> {
  const rows = await db.query<any>(
    `select * from orders where session_id = $1 and status <> 'cancelled' order by batch_no`,
    [sessionId],
  );
  return attachItems(rows);
}

/** Waiter queue: everything pending for the restaurant, oldest first. */
export async function getPendingOrders(restaurantId: string): Promise<OrderView[]> {
  // `session_started_at` lets the waiter spot a table that was opened minutes ago
  // by someone who scanned a photographed QR: an order from a table nobody was
  // seated at is the tell, and orders stay pending until a human confirms.
  const rows = await db.query<any>(
    `select o.*, t.number as table_number, s.created_at as session_started_at,
            (select count(*)::int from table_session_devices d where d.session_id = o.session_id)
              as session_devices
       from orders o
       join tables t on t.id = o.table_id
       left join table_sessions s on s.id = o.session_id
      where o.restaurant_id = $1 and o.status = 'pending'
      order by o.created_at`,
    [restaurantId],
  );
  return attachItems(rows);
}

/** Kitchen queue: confirmed + preparing + ready, newest first. */
export async function getKitchenOrders(restaurantId: string): Promise<OrderView[]> {
  const rows = await db.query<any>(
    `select o.*, t.number as table_number
       from orders o join tables t on t.id = o.table_id
      where o.restaurant_id = $1 and o.status in ('confirmed','preparing','ready')
      order by o.confirmed_at desc nulls last, o.created_at desc
      limit 100`,
    [restaurantId],
  );
  return attachItems(rows);
}

export async function getOrderById(restaurantId: string, orderId: string) {
  const row = await db.one<any>(
    `select o.*, t.number as table_number from orders o join tables t on t.id = o.table_id
      where o.id = $1 and o.restaurant_id = $2`,
    [orderId, restaurantId],
  );
  if (!row) return null;
  const [view] = await attachItems([row]);
  return view;
}

const TRANSITIONS: Record<string, { from: OrderStatus[]; to: OrderStatus }> = {
  confirm: { from: ['pending'], to: 'confirmed' },
  reject: { from: ['pending'], to: 'rejected' },
  preparing: { from: ['confirmed'], to: 'preparing' },
  // the kitchen has one button (Done): a confirmed order may go straight to ready
  ready: { from: ['confirmed', 'preparing'], to: 'ready' },
  served: { from: ['ready'], to: 'served' },
};

/** Waiter/kitchen order state machine. Role checks happen in the route layer. */
export async function updateOrderStatus(input: {
  restaurantId: string;
  orderId: string;
  action: keyof typeof TRANSITIONS;
  staffUserId: string;
  reason?: string;
}) {
  const rule = TRANSITIONS[input.action];
  if (!rule) throw new OrderError('Unknown action.', 400);

  const current = await db.one<{ status: OrderStatus }>(
    `select status from orders where id = $1 and restaurant_id = $2`,
    [input.orderId, input.restaurantId],
  );
  if (!current) throw new OrderError('Order not found.', 404);
  if (!rule.from.includes(current.status)) {
    throw new OrderError(`Cannot mark a ${current.status} order as ${rule.to}.`, 409);
  }

  // Build the statement with only the parameters actually used: the extended
  // query protocol cannot infer a type for an unused placeholder.
  let sql: string;
  let params: unknown[];

  // The UPDATE re-checks the status it started from (`and status = any(...)`), so two
  // staff members pressing Confirm/Reject at the same instant cannot both win: the
  // second one matches no row and gets a 409 instead of silently overwriting.
  // The array travels as a Postgres literal (`{pending}`), which both drivers accept.
  const fromLiteral = `{${rule.from.join(',')}}`;
  switch (input.action) {
    case 'confirm':
      sql = `update orders set status = $2::order_status, confirmed_at = now(), confirmed_by = $3::uuid
              where id = $1::uuid and restaurant_id = $4::uuid and status = any($5::order_status[])`;
      params = [input.orderId, rule.to, input.staffUserId, input.restaurantId, fromLiteral];
      break;
    case 'reject':
      sql = `update orders set status = $2::order_status, rejected_reason = $3::text,
                    confirmed_by = $4::uuid, confirmed_at = now()
              where id = $1::uuid and restaurant_id = $5::uuid and status = any($6::order_status[])`;
      params = [
        input.orderId,
        rule.to,
        input.reason ?? '',
        input.staffUserId,
        input.restaurantId,
        fromLiteral,
      ];
      break;
    case 'preparing':
      sql = `update orders set status = $2::order_status, preparing_at = now()
              where id = $1::uuid and restaurant_id = $3::uuid and status = any($4::order_status[])`;
      params = [input.orderId, rule.to, input.restaurantId, fromLiteral];
      break;
    case 'ready':
      sql = `update orders set status = $2::order_status, ready_at = now()
              where id = $1::uuid and restaurant_id = $3::uuid and status = any($4::order_status[])`;
      params = [input.orderId, rule.to, input.restaurantId, fromLiteral];
      break;
    default:
      sql = `update orders set status = $2::order_status, served_at = now()
              where id = $1::uuid and restaurant_id = $3::uuid and status = any($4::order_status[])`;
      params = [input.orderId, rule.to, input.restaurantId, fromLiteral];
  }

  const changed = await db.query<{ id: string }>(`${sql} returning id`, params);
  if (changed.length === 0) {
    throw new OrderError(
      'Another staff member already updated this order. Refresh to see its current status.',
      409,
    );
  }

  return { status: rule.to };
}

export async function rejectOrder(restaurantId: string, orderId: string, staffUserId: string, reason: string) {
  await updateOrderStatus({ restaurantId, orderId, action: 'reject', staffUserId, reason: sanitizeText(reason, 200) });
}

/** Customer-side confirm/reject is impossible: no such endpoint exists. */
export async function countOpenOrders(sessionId: string) {
  const row = await db.one<{ c: number }>(
    `select count(*)::int as c from orders where session_id = $1 and status in ('pending','confirmed','preparing')`,
    [sessionId],
  );
  return row?.c ?? 0;
}
