import 'server-only';
import { db, transaction } from '@/server/db';
import { isSupabaseMode } from '@/lib/env';
import { env } from '@/lib/env';
import webpush from 'web-push';

/**
 * In-app realtime goes through Supabase Realtime (staff) and short-interval
 * polling (customers). Anything that must wake a closed tablet uses Web Push.
 */
export type PushEvent = 'new_order' | 'waiter_call' | 'bill_request' | 'order_ready' | 'otp_request';

/** Service-worker events that are not sound presets. */
export type BroadcastEvent = PushEvent | 'order_status' | 'otp_dismissed' | 'otp_locked';

const supabaseReady = isSupabaseMode && Boolean(env.SUPABASE_URL);

async function adminClient() {
  if (!supabaseReady) return null;
  const { createClient } = await import('@supabase/supabase-js');
  return createClient(env.SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Broadcasts over Supabase Realtime when configured. When it is not (local dev,
 * plain Postgres) the clients fall back to polling, so this is a no-op.
 */
export async function broadcast(restaurantId: string, event: {
  type: BroadcastEvent;
  tableNumber?: number;
  orderId?: string;
  payload?: Record<string, unknown>;
}) {
  const client = await adminClient();
  if (!client) return;
  try {
    const channel = client.channel(`restaurant-${restaurantId}`, { config: { broadcast: { self: false } } });
    await channel.send({ type: 'broadcast', event: 'staff-event', payload: { ...event, at: Date.now() } });
    await client.removeChannel(channel);
  } catch (err) {
    console.warn('[realtime] broadcast failed', err);
  }
}

// ---------------------------------------------------------------- web push
let vapidConfigured = false;
function configureVapid() {
  if (vapidConfigured) return true;
  if (!env.PUSH_PUBLIC_KEY || !env.PUSH_PRIVATE_KEY) return false;
  webpush.setVapidDetails(env.PUSH_SUBJECT, env.PUSH_PUBLIC_KEY, env.PUSH_PRIVATE_KEY);
  vapidConfigured = true;
  return true;
}

export async function savePushSubscription(input: {
  restaurantId: string;
  staffUserId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent?: string | null;
}) {
  await db.query(
    `insert into push_subscriptions (restaurant_id, staff_user_id, endpoint, p256dh, auth, user_agent)
     values ($1,$2,$3,$4,$5,$6)
     on conflict (endpoint) do update set
       restaurant_id = excluded.restaurant_id,
       staff_user_id = excluded.staff_user_id,
       p256dh = excluded.p256dh,
       auth = excluded.auth`,
    [input.restaurantId, input.staffUserId, input.endpoint, input.p256dh, input.auth, input.userAgent ?? null],
  );
}

export async function removePushSubscription(endpoint: string) {
  await db.query(`delete from push_subscriptions where endpoint = $1`, [endpoint]);
}

export async function sendPushToStaff(restaurantId: string, payload: {
  title: string;
  body: string;
  tag?: string;
  url?: string;
  event?: PushEvent;
}) {
  if (!configureVapid()) return { sent: 0, skipped: true };
  const subs = await db.query<{ endpoint: string; p256dh: string; auth: string }>(
    `select endpoint, p256dh, auth from push_subscriptions where restaurant_id = $1`,
    [restaurantId],
  );
  const body = JSON.stringify({
    title: payload.title,
    body: payload.body,
    tag: payload.tag ?? payload.event ?? 'tabletap',
    url: payload.url ?? '/waiter',
    event: payload.event,
  });

  let sent = 0;
  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          body,
        );
        sent++;
      } catch (err: any) {
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          await removePushSubscription(sub.endpoint);
        }
      }
    }),
  );
  return { sent, skipped: false };
}

// ---------------------------------------------------------------- cleanup
/** Housekeeping used by /api/cron/housekeeping (also safe to run manually). */
/**
 * Open password requests past their 48 h window are closed and their encrypted
 * password wiped; decided ones are dropped after 30 days. Kept outside the main
 * transaction and tolerant of a missing table, so a database that has not run
 * migration 0007 yet can never break the scheduler.
 */
async function pruneStaffPasswordRequests() {
  try {
    await db.query(
      `update staff_password_requests
          set status = 'cancelled', new_password_enc = null, decided_at = now(), decision_note = 'Expired'
        where status = 'pending' and expires_at <= now()`,
    );
    await db.query(
      `delete from staff_password_requests where status <> 'pending' and decided_at < now() - interval '30 days'`,
    );
  } catch (err) {
    console.warn('[housekeeping] password-request cleanup skipped', err instanceof Error ? err.message : err);
  }
}

export async function housekeeping() {
  await pruneStaffPasswordRequests();
  return transaction(async (tx) => {
    // close expired table sessions
    await tx.query(
      `update table_sessions set closed_at = now(), closed_reason = 'expired'
        where closed_at is null and expires_at <= now()`,
    );
    // free tables with no live session
    await tx.query(
      `update tables set status = 'free'
        where status = 'occupied'
          and not exists (select 1 from table_sessions s
                           where s.table_id = tables.id and s.closed_at is null and s.expires_at > now())`,
    );
    // auto-handle ancient open calls (2h)
    await tx.query(
      `update waiter_calls set status = 'handled', handled_at = now()
        where status = 'open' and created_at < now() - interval '2 hours'`,
    );
    // prune rate limit buckets
    const pruned = await tx.query<{ key: string }>(
      `delete from rate_limits where window_start < now() - interval '1 day' returning key`,
    );
    // table codes live 24 h at most (F9) — the waiter only needs them while serving
    const otps = await tx.query<{ id: string }>(
      `delete from table_otps where created_at < now() - interval '24 hours' returning id`,
    );
    // sessions past the hard cap or idle past the restaurant's window
    const stale = await tx.query<{ id: string; table_id: string }>(
      `update table_sessions s
          set closed_at = now(),
              closed_reason = case
                when coalesce(s.hard_expires_at, s.created_at + interval '4 hours') <= now()
                  then 'hard cap reached'
                else 'idle timeout' end
         from restaurants r
        where r.id = s.restaurant_id and s.closed_at is null
          and (coalesce(s.hard_expires_at, s.created_at + interval '4 hours') <= now()
               or s.last_activity_at < now() - make_interval(mins => r.session_idle_minutes))
        returning s.id, s.table_id`,
    );
    for (const row of stale) {
      await tx.query(`delete from table_session_devices where session_id = $1`, [row.id]);
      await tx.query(
        `update orders set status = 'rejected', rejected_reason = 'table closed'
          where session_id = $1 and status = 'pending'`,
        [row.id],
      );
      await tx.query(
        `update table_otps set invalidated_at = now(), invalidated_reason = 'session ended'
          where table_id = $1 and invalidated_at is null`,
        [row.table_id],
      );
    }
    // prune finished restaurca rounds older than a day is kept for reports; only lobby leftovers cleaned
    await tx.query(
      `delete from game_rounds
        where mode in ('solo','table') and status = 'lobby'
          and created_at < now() - interval '30 minutes'`,
    );
    return { prunedRateLimits: pruned.length, prunedCodes: otps.length, expiredSessions: stale.length };
  });
}
