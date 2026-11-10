import 'server-only';
import { db } from '@/server/db';
import { WAITER_CALL_COOLDOWN_SECONDS } from '@/lib/constants';
import { cooldownRemaining, rateLimit } from '@/server/auth';
import { newTableCode } from '@/lib/crypto';
import { sanitizeText } from '@/lib/sanitize';
import type { Queryable } from '@/server/db';

export class ServiceError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

// ------------------------------------------------------------------ calls
export async function raiseWaiterCall(input: {
  restaurantId: string;
  tableId: string;
  sessionId: string;
  type: 'call' | 'bill';
}) {
  const key = `waiter-call:${input.sessionId}:${input.type}`;
  const remaining = await cooldownRemaining(key, WAITER_CALL_COOLDOWN_SECONDS);
  if (remaining > 0) {
    throw new ServiceError(`Already sent. A waiter is on the way (${remaining}s).`, 429);
  }
  await rateLimit(key, 1, WAITER_CALL_COOLDOWN_SECONDS);

  const open = await db.one<{ id: string }>(
    `select id from waiter_calls
      where session_id = $1 and type = $2 and status = 'open' limit 1`,
    [input.sessionId, input.type],
  );
  if (open) throw new ServiceError('A waiter has already been called for this table.', 409);

  const row = await db.one<{ id: string }>(
    `insert into waiter_calls (restaurant_id, table_id, session_id, type)
     values ($1,$2,$3,$4) returning id`,
    [input.restaurantId, input.tableId, input.sessionId, input.type],
  );
  return row!.id;
}

export async function getOpenCalls(restaurantId: string) {
  return db.query<any>(
    `select wc.id, wc.type, wc.created_at, wc.table_id, wc.session_id, t.number as table_number
       from waiter_calls wc join tables t on t.id = wc.table_id
      where wc.restaurant_id = $1 and wc.status = 'open'
      order by wc.created_at`,
    [restaurantId],
  );
}

export async function handleCall(restaurantId: string, callId: string, staffUserId: string) {
  const row = await db.one(
    `update waiter_calls set status='handled', handled_by=$3, handled_at=now()
      where id=$1 and restaurant_id=$2 and status='open' returning id`,
    [callId, restaurantId, staffUserId],
  );
  if (!row) throw new ServiceError('That call was already handled.', 409);
  return true;
}

// ------------------------------------------------------------------ tables
export type TableCard = {
  id: string;
  number: number;
  label: string | null;
  zone: string | null;
  seats: number;
  status: 'free' | 'occupied';
  table_code: string;
  session_id: string | null;
  session_expires_at: string | null;
  session_started_at: string | null;
  pending_orders: number;
  open_calls: number;
  bill_requests: number;
  active_orders: number;
  revenue: number;
};

export async function getTableGrid(restaurantId: string) {
  const rows = await db.query<any>(
    `select t.id, t.number, t.label, t.zone, t.seats, t.status, t.table_code, t.is_active,
            s.id as session_id, s.expires_at as session_expires_at, s.created_at as session_started_at,
            coalesce(o.pending_orders, 0)::int as pending_orders,
            coalesce(o.active_orders, 0)::int as active_orders,
            coalesce(o.revenue, 0)::numeric as revenue,
            coalesce(c.open_calls, 0)::int as open_calls,
            coalesce(c.bill_requests, 0)::int as bill_requests
       from tables t
       left join lateral (
         select id, expires_at, created_at from table_sessions
          where table_id = t.id and closed_at is null and expires_at > now()
          order by created_at desc limit 1
       ) s on true
       left join lateral (
         select
           count(*) filter (where status = 'pending') as pending_orders,
           count(*) filter (where status in ('confirmed','preparing','ready')) as active_orders,
           coalesce(sum(total) filter (where status <> 'rejected'), 0) as revenue
         from orders where table_id = t.id and (s.id is null or session_id = s.id)
       ) o on true
       left join lateral (
         select
           count(*) filter (where type = 'call') as open_calls,
           count(*) filter (where type = 'bill') as bill_requests
         from waiter_calls where table_id = t.id and status = 'open'
       ) c on true
      where t.restaurant_id = $1 and t.is_active
      order by t.number`,
    [restaurantId],
  );
  return rows as TableCard[];
}

export async function getTableDetail(restaurantId: string, tableId: string) {
  const table = await db.one<any>(
    `select id, number, label, zone, seats, status, table_code from tables
      where id = $1 and restaurant_id = $2`,
    [tableId, restaurantId],
  );
  if (!table) throw new ServiceError('Table not found.', 404);

  const session = await db.one<any>(
    `select id, created_at, expires_at, closed_at, closed_reason from table_sessions
      where table_id = $1 and closed_at is null and expires_at > now()
      order by created_at desc limit 1`,
    [tableId],
  );

  const orders = session
    ? await db.query<any>(
        `select id, batch_no, status, total, created_at, notes, rejected_reason
           from orders where session_id = $1 order by batch_no desc`,
        [session.id],
      )
    : [];

  const calls = await db.query<any>(
    `select id, type, status, created_at from waiter_calls
      where table_id = $1 and status = 'open' order by created_at`,
    [tableId],
  );

  return { table, session, orders, calls };
}

export async function createTable(
  restaurantId: string,
  input: { number: number; label?: string | null; seats: number; zone?: string | null; isActive: boolean },
) {
  const exists = await db.one(`select 1 from tables where restaurant_id = $1 and number = $2`, [
    restaurantId,
    input.number,
  ]);
  if (exists) throw new ServiceError(`Table ${input.number} already exists.`, 409);

  const row = await db.one<{ id: string }>(
    `insert into tables (restaurant_id, number, label, seats, zone, table_code, is_active)
     values ($1,$2,$3,$4,$5,$6,$7) returning id`,
    [
      restaurantId,
      input.number,
      input.label ? sanitizeText(input.label, 60) : null,
      input.seats,
      input.zone ? sanitizeText(input.zone, 40) : null,
      newTableCode(),
      input.isActive,
    ],
  );
  return row!.id;
}

export async function updateTable(
  restaurantId: string,
  tableId: string,
  input: { number?: number; label?: string | null; seats?: number; zone?: string | null; isActive?: boolean },
) {
  await db.query(
    `update tables set
       number = coalesce($3, number),
       label = $4,
       seats = coalesce($5, seats),
       zone = $6,
       is_active = coalesce($7, is_active)
     where id = $1 and restaurant_id = $2`,
    [
      tableId,
      restaurantId,
      input.number ?? null,
      input.label ? sanitizeText(input.label, 60) : null,
      input.seats ?? null,
      input.zone ? sanitizeText(input.zone, 40) : null,
      input.isActive ?? null,
    ],
  );
}

/** Rotates the public code: old QR/NFC stickers stop working immediately. */
export async function regenerateTableCode(restaurantId: string, tableId: string) {
  const row = await db.one<{ table_code: string }>(
    `update tables set table_code = $3 where id = $1 and restaurant_id = $2 returning table_code`,
    [tableId, restaurantId, newTableCode()],
  );
  if (!row) throw new ServiceError('Table not found.', 404);
  // kill live sessions for that table
  await db.query(
    `update table_sessions set closed_at = now(), closed_reason = 'table code regenerated'
      where table_id = $1 and closed_at is null`,
    [tableId],
  );
  return row.table_code;
}

export async function deleteTable(restaurantId: string, tableId: string) {
  const row = await db.one(
    `update tables set is_active = false where id = $1 and restaurant_id = $2 returning id`,
    [tableId, restaurantId],
  );
  return Boolean(row);
}

export async function getTablesWithCodes(restaurantId: string) {
  return db.query<any>(
    `select id, number, label, zone, table_code from tables
      where restaurant_id = $1 and is_active order by number`,
    [restaurantId],
  );
}

// ------------------------------------------------------------------ reviews
export async function createReview(input: {
  restaurantId: string;
  sessionId: string;
  tableId: string;
  rating: number;
  routedTo: 'google' | 'private';
}) {
  const existing = await db.one(`select 1 from reviews where session_id = $1`, [input.sessionId]);
  if (existing) throw new ServiceError('You have already left a review for this visit.', 409);
  await db.query(
    `insert into reviews (restaurant_id, session_id, table_id, rating, routed_to)
     values ($1,$2,$3,$4,$5)`,
    [input.restaurantId, input.sessionId, input.tableId, input.rating, input.routedTo],
  );
  return true;
}

export async function getReviewForSession(sessionId: string) {
  return db.one<any>(`select * from reviews where session_id = $1`, [sessionId]);
}

export async function createFeedback(input: {
  restaurantId: string;
  sessionId: string | null;
  tableId: string | null;
  rating?: number;
  message: string;
  contact?: string;
}) {
  const row = await db.one<{ id: string }>(
    `insert into feedback (restaurant_id, session_id, table_id, rating, message, contact)
     values ($1,$2,$3,$4,$5,$6) returning id`,
    [
      input.restaurantId,
      input.sessionId,
      input.tableId,
      input.rating ?? null,
      sanitizeText(input.message, 1000),
      input.contact ? sanitizeText(input.contact, 120) : null,
    ],
  );
  return row!.id;
}

export async function getFeedback(restaurantId: string) {
  return db.query<any>(
    `select f.*, t.number as table_number from feedback f
       left join tables t on t.id = f.table_id
      where f.restaurant_id = $1 order by f.created_at desc limit 200`,
    [restaurantId],
  );
}

export async function updateFeedbackStatus(restaurantId: string, id: string, status: 'new' | 'read' | 'resolved') {
  await db.query(`update feedback set status = $3 where id = $1 and restaurant_id = $2`, [
    id,
    restaurantId,
    status,
  ]);
}

// ------------------------------------------------------------------ settings
export async function getSettings(restaurantId: string) {
  const rows = await db.query<any>(`select key, value from settings where restaurant_id = $1`, [
    restaurantId,
  ]);
  const map: Record<string, any> = {};
  for (const r of rows) map[r.key] = r.value;
  return map;
}

export async function setSetting(restaurantId: string, key: string, value: unknown, tx: Queryable = db) {
  await tx.query(
    `insert into settings (restaurant_id, key, value) values ($1,$2,$3)
     on conflict (restaurant_id, key) do update set value = excluded.value, updated_at = now()`,
    [restaurantId, key, JSON.stringify(value)],
  );
}

export async function getRestaurant(restaurantId: string) {
  return db.one<any>(`select * from restaurants where id = $1`, [restaurantId]);
}

export async function getRestaurantBySlug(slug: string) {
  return db.one<any>(`select * from restaurants where slug = $1 and is_active`, [slug]);
}

export async function updateRestaurant(restaurantId: string, patch: Record<string, unknown>) {
  const allowed = [
    'name',
    'logo_url',
    'accent_color',
    'wifi_ssid',
    'wifi_password',
    'google_review_url',
    'instagram_url',
    'facebook_url',
    'website_url',
    'phone',
    'address',
    'tax_percent',
    'service_charge_percent',
  ];
  // A partial save (e.g. only the code settings) must not blank the other columns:
  // keep only keys that were actually provided.
  const keys = Object.keys(patch).filter((k) => allowed.includes(k) && patch[k] !== undefined);
  if (keys.length === 0) return;
  const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
  await db.query(
    `update restaurants set ${sets}, updated_at = now() where id = $1`,
    [restaurantId, ...keys.map((k) => patch[k])],
  );
}
