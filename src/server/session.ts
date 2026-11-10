import 'server-only';
import { cookies } from 'next/headers';
import { db } from '@/server/db';
import { newSessionToken, sha256 } from '@/lib/crypto';
import { HARD_CAP_HOURS, SESSION_TTL_HOURS } from '@/lib/constants';
import { isSupabaseMode } from '@/lib/env';

export const SESSION_COOKIE = 'tt_session';
const GUEST_COOKIE = 'tt_guest';

/**
 * Fallback phone cap. The real value is a per-restaurant setting
 * (`max_devices_per_session`, 4-20); scans are also rate limited, and this cap is
 * the hard guard: a flood can never displace a real guest's device token.
 */
export const MAX_DEVICES_PER_SESSION = 12;

/** Thrown when a table session already holds the maximum number of phones. */
export class DeviceCapError extends Error {
  constructor(max = MAX_DEVICES_PER_SESSION) {
    super(
      `This table already has ${max} phones connected. Ask a waiter to close the table ` +
        'session, then enter a new code.',
    );
    this.name = 'DeviceCapError';
  }
}

export type GuestIdentity = {
  guestNo: number;
  displayName: string;
};

export type TableSession = {
  id: string;
  restaurant_id: string;
  table_id: string;
  expires_at: string;
  closed_at: string | null;
  closed_reason: string | null;
  table_number: number;
  table_label: string | null;
  table_code: string;
  restaurant_name: string;
  restaurant_slug: string;
  accent_color: string;
  currency: string;
  logo_url: string | null;
  wifi_ssid: string | null;
  wifi_password: string | null;
  google_review_url: string | null;
  timezone: string;
  guest_no: number;
};

const cookieOptions = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: isSupabaseMode || process.env.NODE_ENV === 'production',
  path: '/',
};

/** Looks up the table by its long random public code. */
export async function findTableByCode(tableCode: string) {
  return db.one<{
    id: string;
    restaurant_id: string;
    table_code: string;
    number: number;
    label: string | null;
    status: string;
    is_active: boolean;
    restaurant_slug: string;
  }>(
    `select t.id, t.restaurant_id, t.table_code, t.number, t.label, t.status, t.is_active,
            r.slug as restaurant_slug
       from tables t join restaurants r on r.id = t.restaurant_id
      where t.table_code = $1 and t.is_active and r.is_active`,
    [tableCode],
  );
}

/**
 * Creates a new table session (invalidating earlier open sessions for that
 * table) and stores the raw token in an HttpOnly cookie. Only the SHA-256
 * hash of the token is persisted (spec §14).
 */
export async function createSession(
  tableId: string,
  restaurantId: string,
  opts: { otpId?: string; maxHours?: number; maxDevices?: number } = {},
) {
  const token = newSessionToken();
  const tokenHash = sha256(token);
  // The idle clock is the one that normally ends a visit; the hard cap is fixed at
  // creation and is never extended by activity.
  const idleExpiry = new Date(Date.now() + SESSION_TTL_HOURS * 3600_000);
  const hardExpiry = new Date(Date.now() + (opts.maxHours ?? HARD_CAP_HOURS) * 3600_000);

  await db.query(
    `update table_sessions
        set closed_at = now(), closed_reason = 'replaced by new visit'
      where table_id = $1 and closed_at is null`,
    [tableId],
  );

  const session = await db.one<{ id: string }>(
    `insert into table_sessions (restaurant_id, table_id, token_hash, expires_at,
                                hard_expires_at, last_activity_at, otp_id)
     values ($1, $2, $3, $4, $5, now(), $6) returning id`,
    [restaurantId, tableId, tokenHash, idleExpiry.toISOString(), hardExpiry.toISOString(), opts.otpId ?? null],
  );
  if (!session) throw new Error('could not create session');

  await db.query(
    `insert into carts (restaurant_id, session_id) values ($1, $2)
     on conflict (session_id) do nothing`,
    [restaurantId, session.id],
  );
  await db.query(`update tables set status = 'occupied' where id = $1`, [tableId]);

  const guestNo = await issueDeviceToken(session.id, restaurantId, idleExpiry, opts.maxDevices);
  return { sessionId: session.id, guestNo };
}

/**
 * Registers this device against a session and sets the cookie.
 * Each phone gets its own token + guest number so several guests can share one
 * table session without knocking each other out.
 */
export async function issueDeviceToken(
  sessionId: string,
  restaurantId: string,
  expiresAt: Date,
  maxDevices = MAX_DEVICES_PER_SESSION,
) {
  const token = newSessionToken();
  const used = await db.query<{ guest_no: number }>(
    `select guest_no from table_session_devices where session_id = $1 order by guest_no`,
    [sessionId],
  );
  if (used.length >= maxDevices) {
    throw new DeviceCapError(maxDevices);
  }

  const taken = new Set(used.map((r) => r.guest_no));
  let guestNo = 1;
  while (taken.has(guestNo)) guestNo++;

  // No ON CONFLICT here on purpose: two phones scanning in the same instant must
  // not silently take each other's row. A unique-violation means "pick the next
  // number", never "overwrite that guest's token".
  await db.query(
    `insert into table_session_devices (restaurant_id, session_id, token_hash, guest_no)
     values ($1,$2,$3,$4)`,
    [restaurantId, sessionId, sha256(token), guestNo],
  );

  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, { ...cookieOptions, expires: expiresAt });
  jar.set(GUEST_COOKIE, String(guestNo), { ...cookieOptions, expires: expiresAt });
  return guestNo;
}

/** Resolves the cookie token to a live session, or null. */
export async function getSessionFromCookie(tableCode?: string): Promise<TableSession | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const hash = sha256(token);
  // Liveness is decided by the DATABASE clock only (test I4): a session is over when
  // the waiter closed it, when it has been idle past `session_idle_minutes`, or when
  // the hard cap (`hard_expires_at`) has passed — activity never extends the cap.
  const row = await db.one<any>(
    `select * from (
        select s.id, s.restaurant_id, s.table_id, s.expires_at, s.hard_expires_at,
               s.closed_at, s.closed_reason,
               t.number as table_number, t.label as table_label, t.table_code,
               r.name as restaurant_name, r.slug as restaurant_slug, r.accent_color,
               r.currency, r.logo_url, r.wifi_ssid, r.wifi_password, r.google_review_url,
               r.timezone, d.guest_no,
               (s.closed_at is not null) as is_closed,
               (coalesce(s.hard_expires_at, s.created_at + interval '4 hours') <= now()) as over_cap,
               (s.last_activity_at < now() - make_interval(mins => r.session_idle_minutes)) as is_idle
          from table_session_devices d
          join table_sessions s on s.id = d.session_id
          join tables t on t.id = s.table_id
          join restaurants r on r.id = s.restaurant_id
         where d.token_hash = $1
        union all
        select s.id, s.restaurant_id, s.table_id, s.expires_at, s.hard_expires_at,
               s.closed_at, s.closed_reason,
               t.number as table_number, t.label as table_label, t.table_code,
               r.name as restaurant_name, r.slug as restaurant_slug, r.accent_color,
               r.currency, r.logo_url, r.wifi_ssid, r.wifi_password, r.google_review_url,
               r.timezone, 1 as guest_no,
               (s.closed_at is not null) as is_closed,
               (coalesce(s.hard_expires_at, s.created_at + interval '4 hours') <= now()) as over_cap,
               (s.last_activity_at < now() - make_interval(mins => r.session_idle_minutes)) as is_idle
          from table_sessions s
          join tables t on t.id = s.table_id
          join restaurants r on r.id = s.restaurant_id
         where s.token_hash = $1
     ) q
     limit 1`,
    [hash],
  );
  if (!row) return null;
  if (row.is_closed || row.over_cap || row.is_idle) {
    // Close it for real so the guest is told once, and reports stay honest.
    if (!row.is_closed) {
      await closeSession(row.id, row.over_cap ? 'hard cap reached' : 'idle timeout');
    }
    return null;
  }
  if (tableCode && row.table_code !== tableCode) return null;

  // Activity beacon, throttled to once a minute. Slides the idle timer; the hard
  // cap (hard_expires_at) is never touched here.
  await db.query(
    `update table_sessions
        set last_activity_at = now(), last_seen_at = now()
      where id = $1
        and (last_activity_at < now() - interval '1 minute' or last_seen_at < now() - interval '1 minute')`,
    [row.id],
  );
  await db.query(
    `update table_session_devices set last_seen_at = now()
      where token_hash = $1 and last_seen_at < now() - interval '1 minute'`,
    [hash],
  );

  return row as TableSession;
}

export async function requireSession(tableCode?: string) {
  const session = await getSessionFromCookie(tableCode);
  if (!session) {
    throw new SessionError('This table session has ended. Please scan the QR code again.');
  }
  return session;
}

export class SessionError extends Error {
  code = 'SESSION_INVALID' as const;
}

/**
 * Guest number for this device inside the session. Resolved from the device
 * token so it cannot be spoofed by editing a cookie value in the browser.
 */
export async function getGuestNo(tableCode?: string): Promise<number> {
  const session = await getSessionFromCookie(tableCode);
  return session?.guest_no ?? 1;
}

export async function closeSession(sessionId: string, reason: string) {
  await db.query(`delete from table_session_devices where session_id = $1`, [sessionId]);
  // D5/G5: anything not yet confirmed never reaches the kitchen.
  await db.query(
    `update orders
        set status = 'rejected', rejected_reason = 'table closed', confirmed_at = now()
      where session_id = $1 and status = 'pending'`,
    [sessionId],
  );
  const row = await db.one<{ table_id: string }>(
    `update table_sessions set closed_at = now(), closed_reason = $2
      where id = $1 and closed_at is null returning table_id`,
    [sessionId, reason],
  );
  if (row) {
    await db.query(
      `update tables set status = 'free'
        where id = $1 and not exists (
          select 1 from table_sessions where table_id = $1 and closed_at is null)`,
      [row.table_id],
    );
    await db.query(
      `update waiter_calls set status = 'handled', handled_at = now()
        where session_id = $1 and status = 'open'`,
      [sessionId],
    );
  }
}
