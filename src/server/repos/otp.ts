import 'server-only';
import { randomInt } from 'node:crypto';
import { db, transaction } from '@/server/db';
import { auditLog } from '@/server/auth';
import { broadcast, sendPushToStaff } from '@/server/repos/events';

/**
 * Waiter-issued table code (OTP) — see migration 0006 and docs/architecture.md §1b.
 *
 * Two clocks live here:
 *   code    → `table_otps` row: 10 min window, 5 wrong guesses, one live per table
 *   session → created on the first successful verification, idle + hard cap
 *
 * Security shape of this file:
 *   * the code never leaves through a customer-facing function: every return value
 *     marked `StaffOtp` is consumed by waiter/admin routes only.
 *   * verification is ONE atomic statement that counts a wrong attempt and compares
 *     the code under a row lock, so 100 parallel guesses cannot beat 5 attempts.
 *   * expiry, attempt limits and cooldowns use database time only (never the
 *     client's or the app server's clock).
 */

export type OtpSettings = {
  length: number;
  windowMinutes: number;
  maxAttempts: number;
  cooldownSeconds: number;
  maxDevices: number;
  idleMinutes: number;
  maxHours: number;
  autoConfirm: boolean;
  menuPreview: boolean;
};

export type StaffOtp = {
  id: string;
  table_id: string;
  table_number: number;
  table_label: string | null;
  code: string;
  created_at: string;
  expires_at: string;
  attempts: number;
  max_attempts: number;
  /** 'live' | 'locked' | 'expired' */
  state: string;
  seconds_left: number;
  seconds_since_request: number;
  /** 'free' | 'open' — what the table looked like when the code was raised */
  table_state: 'free' | 'open';
  session_id: string | null;
  open_minutes: number;
  phones: number;
  joined_phones: number;
  session_items: number;
  session_total: number;
  /** true when a code was reused instead of a new one being raised */
  reused: boolean;
  cooldown_seconds_left: number;
  overdue: boolean;
  admin_alert: boolean;
};

export type VerifyResult =
  | { ok: true; otpId: string; sessionId: string; guestNo: number; joined: boolean; verifiedAt: string }
  | {
      ok: false;
      reason:
        | 'NO_CODE'
        | 'EXPIRED'
        | 'LOCKED'
        | 'WRONG'
        | 'TOO_MANY'
        | 'TABLE_INVALID'
        | 'DEVICE_CAP'
        | 'NO_OPEN_CODE';
      message: string;
      attemptsLeft?: number;
      /** ask the guest to press "Ask again" (or wait for the cooldown) */
      canAskAgain: boolean;
    };

// ----------------------------------------------------------------- helpers
export function generateCode(length: number): string {
  let out = '';
  for (let i = 0; i < length; i++) out += String(randomInt(0, 10));
  return out;
}

/** Settings row for a restaurant, with hard-coded safe defaults. */
export async function getOtpSettings(restaurantId: string): Promise<OtpSettings> {
  const r = await db.one<any>(
    `select otp_length, otp_window_minutes, otp_max_attempts, otp_reissue_cooldown_seconds,
            max_devices_per_session, session_idle_minutes, session_max_hours,
            auto_confirm_orders, menu_preview_before_code
       from restaurants where id = $1`,
    [restaurantId],
  );
  return {
    length: Number(r?.otp_length ?? 4),
    windowMinutes: Number(r?.otp_window_minutes ?? 10),
    maxAttempts: Number(r?.otp_max_attempts ?? 5),
    cooldownSeconds: Number(r?.otp_reissue_cooldown_seconds ?? 60),
    maxDevices: Number(r?.max_devices_per_session ?? 12),
    idleMinutes: Number(r?.session_idle_minutes ?? 90),
    maxHours: Number(r?.session_max_hours ?? 4),
    autoConfirm: Boolean(r?.auto_confirm_orders ?? false),
    menuPreview: Boolean(r?.menu_preview_before_code ?? true),
  };
}

/** Shape a live code row for staff screens (the only place `code` is exposed). */
function toStaffOtp(row: any, settings: OtpSettings, reused = false): StaffOtp {
  const secondsLeft = row.seconds_left !== undefined ? Number(row.seconds_left) : 0;
  const state =
    row.invalidated_at != null
      ? 'locked'
      : row.attempts >= settings.maxAttempts
        ? 'locked'
        : secondsLeft <= 0
          ? 'expired'
          : 'live';
  const sinceRequest = Number(row.seconds_since_request ?? 0);
  return {
    id: row.id,
    table_id: row.table_id,
    table_number: Number(row.table_number),
    table_label: row.table_label ?? null,
    code: String(row.code),
    created_at: row.created_at,
    expires_at: row.expires_at,
    attempts: Number(row.attempts ?? 0),
    max_attempts: settings.maxAttempts,
    state,
    seconds_left: state === 'live' ? secondsLeft : 0,
    seconds_since_request: sinceRequest,
    // the table's CURRENT visit (not the code's session: the code only learns its
    // session once a guest verifies, and it must show "open" for every later scan)
    table_state: row.live_session_id ? 'open' : 'free',
    session_id: row.live_session_id ?? row.session_id ?? null,
    open_minutes: row.live_started_at
      ? Math.max(0, Math.floor((Date.now() - new Date(row.live_started_at).getTime()) / 60000))
      : 0,
    phones: Number(row.live_phones ?? 0),
    joined_phones: Number(row.live_phones ?? 0),
    session_items: Number(row.live_items ?? 0),
    session_total: Number(row.live_total ?? 0),
    reused,
    cooldown_seconds_left: Number(row.cooldown_seconds_left ?? 0),
    // card turns red after 2 minutes, admin is alerted after 5
    overdue: state === 'live' && sinceRequest > 120,
    admin_alert: state === 'live' && sinceRequest > 300,
  };
}

const LIVE_SELECT = `
  select o.id, o.table_id, o.code, o.attempts, o.created_at, o.expires_at, o.invalidated_at,
         o.session_id, t.number as table_number, t.label as table_label,
         r.session_idle_minutes as idle_minutes,
         live.id as live_session_id, live.created_at as live_started_at,
         coalesce(live.phones, 0) as live_phones,
         coalesce(live.items, 0) as live_items,
         coalesce(live.total, 0) as live_total,
         greatest(0, ceil(extract(epoch from (o.expires_at - now()))))::int as seconds_left,
         greatest(0, floor(extract(epoch from (now() - o.created_at))))::int as seconds_since_request,
         s.created_at as session_started_at,
         coalesce(floor(extract(epoch from (now() - s.created_at)) / 60), 0)::int as open_minutes,
         coalesce((select count(*) from table_session_devices d where d.session_id = s.id), 0)::int as phones,
         coalesce((select count(*) from orders x where x.session_id = s.id and x.status <> 'rejected'), 0)::int as session_items,
         coalesce((select sum(x.total) from orders x where x.session_id = s.id and x.status <> 'rejected'), 0) as session_total,
         case when o.verified_at is null then 0
              else coalesce((select count(*) from table_session_devices d where d.session_id = o.session_id), 0)::int
         end as joined_phones,
         0 as cooldown_seconds_left
    from table_otps o
    join tables t on t.id = o.table_id
    join restaurants r on r.id = o.restaurant_id
    left join table_sessions s on s.id = o.session_id
    left join lateral (
      select ss.id, ss.created_at,
             (select count(*) from table_session_devices d where d.session_id = ss.id)::int as phones,
             (select count(*) from orders x where x.session_id = ss.id and x.status <> 'rejected')::int as items,
             (select coalesce(sum(x.total), 0) from orders x where x.session_id = ss.id and x.status <> 'rejected') as total
        from table_sessions ss
       where ss.table_id = o.table_id
         and ss.closed_at is null
         and ss.last_activity_at > now() - make_interval(mins => r.session_idle_minutes)
         and coalesce(ss.hard_expires_at, ss.created_at + interval '4 hours') > now()
       order by ss.created_at desc
       limit 1
    ) live on true
   where o.restaurant_id = $1`;

/**
 * Every live code for a restaurant, newest request first (staff board).
 * Codes that are expired/locked are still returned for a short while so the
 * waiter sees "locked" instead of the card silently disappearing.
 */
export async function listLiveOtps(restaurantId: string): Promise<StaffOtp[]> {
  const settings = await getOtpSettings(restaurantId);
  // One card per table: the newest code is the one a waiter can act on, so a dead
  // predecessor still inside its 5-minute grace window cannot double the card.
  const rows = await db.query<any>(
    `with candidates as (
       ${LIVE_SELECT}
         and o.created_at > now() - interval '30 minutes'
         and (
           o.invalidated_at is null
           -- a locked/expired code stays on the board for 5 min so the waiter sees
           -- why the guests are still waiting instead of watching it vanish
           or o.invalidated_at > now() - interval '5 minutes'
           or o.expires_at > now() - interval '5 minutes'
         )
     ),
     newest as (
       select distinct on (table_id) *
         from candidates
        order by table_id, created_at desc
     )
     select * from newest order by created_at`,
    [restaurantId],
  );
  return rows.map((r) => toStaffOtp(r, settings));
}

/** All codes for one table (used by the table sheet and the "new party" warning). */
export async function getOtpForTable(restaurantId: string, tableId: string): Promise<StaffOtp | null> {
  const settings = await getOtpSettings(restaurantId);
  const row = await db.one<any>(
    `${LIVE_SELECT}
       and o.table_id = $2
       and o.invalidated_at is null
       and o.created_at > now() - interval '30 minutes'
     order by o.created_at desc limit 1`,
    [restaurantId, tableId],
  );
  return row ? toStaffOtp(row, settings) : null;
}

export async function getOtpById(restaurantId: string, otpId: string): Promise<StaffOtp | null> {
  const settings = await getOtpSettings(restaurantId);
  const row = await db.one<any>(`${LIVE_SELECT} and o.id = $2`, [restaurantId, otpId]);
  return row ? toStaffOtp(row, settings) : null;
}

/**
 * Raise a code for a table — or reuse the live one.
 *
 * Called by `POST /api/public/session` (a scan) and by the waiter's "New code"
 * button (which ignores the cooldown because it is an explicit staff action).
 * One live code per table is enforced by a partial unique index, so two scans in
 * the same millisecond cannot produce two codes.
 */
export async function raiseOtp(input: {
  restaurantId: string;
  tableId: string;
  tableNumber: number;
  tableLabel: string | null;
  ip?: string;
  force?: boolean;
  actor?: { id: string; email: string };
}): Promise<StaffOtp> {
  const settings = await getOtpSettings(input.restaurantId);

  const existing = await db.one<any>(
    `${LIVE_SELECT}
       and o.table_id = $2
       and o.invalidated_at is null
     order by o.created_at desc limit 1`,
    [input.restaurantId, input.tableId],
  );

  if (existing && !input.force) {
    const live = toStaffOtp(existing, settings, true);
    const cooldownLeft = Math.max(
      0,
      settings.cooldownSeconds - Number(existing.seconds_since_request ?? 0),
    );
    // still usable → reuse, never raise a second code for the same table
    if (live.state === 'live') {
      return { ...live, cooldown_seconds_left: cooldownLeft };
    }
    // expired or locked → a new code is legitimate, but respect the cooldown so a
    // scan spam cannot page the waiter every second.
    if (cooldownLeft > 0) {
      return { ...live, cooldown_seconds_left: cooldownLeft };
    }
  }

  const code = generateCode(settings.length);

  // Invalidate anything still live for the table, then insert; the partial unique
  // index makes a concurrent insert fail rather than create a second live code.
  const row = await transaction(async (tx) => {
    await tx.query(
      `update table_otps set invalidated_at = now(), invalidated_reason = 'regenerated'
        where table_id = $1 and invalidated_at is null`,
      [input.tableId],
    );
    return tx.one<any>(
      `insert into table_otps (restaurant_id, table_id, code, expires_at, requested_from_ip)
       values ($1, $2, $3, now() + make_interval(mins => $4), $5)
       returning id`,
      [input.restaurantId, input.tableId, code, settings.windowMinutes, input.ip ?? null],
    );
  });

  if (!row) throw new Error('could not raise a table code');

  await auditLog({
    restaurantId: input.restaurantId,
    actorId: input.actor?.id ?? null,
    actorEmail: input.actor?.email ?? null,
    action: input.force ? 'otp.regenerate' : 'otp.issue',
    entity: 'table_otps',
    entityId: row.id,
    // never the code itself
    meta: { table: input.tableNumber, window_minutes: settings.windowMinutes },
  });

  const raised = await getOtpById(input.restaurantId, row.id);
  if (!raised) throw new Error('could not read back the table code');

  await broadcast(input.restaurantId, {
    type: 'otp_request',
    tableNumber: input.tableNumber,
    payload: { state: raised.table_state, phones: raised.phones },
  });
  // push is best-effort; the board also polls a fingerprint that includes codes
  await sendPushToStaff(input.restaurantId, {
    title: `Table ${input.tableNumber} needs a code`,
    body:
      raised.table_state === 'free'
        ? 'Give the code to the guests when they sit down.'
        : `Table open ${raised.open_minutes} min · ${raised.phones} phone(s).`,
    url: '/waiter',
    tag: `otp-${raised.id}`,
  }).catch(() => undefined);

  return raised;
}

export async function dismissOtp(input: {
  restaurantId: string;
  otpId: string;
  staffUserId: string;
  staffEmail: string;
  reason?: string;
}) {
  // "Not a real guest" must also work on a card that already died by itself
  // (locked after 5 tries, or out of time) — the waiter is clearing the screen.
  const row = await db.one<{ table_id: string; number: number }>(
    `update table_otps o
        set invalidated_at = now(), invalidated_reason = $3, dismissed_by = $4
       from tables t
      where o.id = $1 and o.restaurant_id = $2 and t.id = o.table_id
        and (o.invalidated_at is null or o.invalidated_at > now() - interval '5 minutes')
      returning o.table_id, t.number`,
    [input.otpId, input.restaurantId, input.reason ?? 'dismissed', input.staffUserId],
  );
  if (!row) return { dismissed: false };
  await auditLog({
    restaurantId: input.restaurantId,
    actorId: input.staffUserId,
    actorEmail: input.staffEmail,
    action: 'otp.dismiss',
    entity: 'table_otps',
    entityId: input.otpId,
    meta: { table: row.number, reason: input.reason ?? 'dismissed' },
  });
  await broadcast(input.restaurantId, { type: 'otp_dismissed', payload: { otpId: input.otpId } });
  return { dismissed: true };
}

/**
 * G2 — "New party": the guests in front of the waiter are new people.
 * Closes the open visit (orders stay in reports), kills its codes and frees the
 * table. The next code entry starts a fresh session with an empty cart.
 */
export async function startNewParty(
  restaurantId: string,
  tableId: string,
  actor: { id: string; email: string },
) {
  const { closeSession } = await import('@/server/session');
  const open = await db.query<{ id: string }>(
    `select id from table_sessions
      where table_id = $1 and closed_at is null
      order by created_at desc`,
    [tableId],
  );
  for (const s of open) {
    await closeSession(s.id, 'new party seated');
  }
  await invalidateOtpsForTable(tableId, 'new party seated');
  await db.query(`update tables set status = 'free' where id = $1`, [tableId]);

  const table = await db.one<{ number: number }>(`select number from tables where id = $1`, [tableId]);
  await auditLog({
    restaurantId,
    actorId: actor.id,
    actorEmail: actor.email,
    action: 'table.new_party',
    entity: 'tables',
    entityId: tableId,
    meta: { table: table?.number, sessions_closed: open.length },
  });
  await broadcast(restaurantId, { type: 'otp_dismissed', tableNumber: table?.number, payload: { newParty: true } });
  return { closedSessions: open.length, table: table?.number ?? null };
}

/**
 * J3 — the panic action: "End all sessions and codes".
 *
 * Every open visit closes (its orders stay in reports, its pending batches are
 * rejected as "table closed"), every live code dies, and every table returns to
 * Free. Guests must ask a waiter for a new code, so a leaked or shoulder-surfed
 * code can never outlive the tap.
 */
export async function endAllSessions(
  restaurantId: string,
  actor: { id: string; email: string },
) {
  const { closeSession } = await import('@/server/session');
  const open = await db.query<{ id: string }>(
    `select id from table_sessions where restaurant_id = $1 and closed_at is null`,
    [restaurantId],
  );
  for (const s of open) await closeSession(s.id, 'ended by admin');
  const dead = await db.query<{ id: string }>(
    `update table_otps set invalidated_at = now(), invalidated_reason = 'ended by admin'
      where restaurant_id = $1 and invalidated_at is null
      returning id`,
    [restaurantId],
  );
  await db.query(`update tables set status = 'free' where restaurant_id = $1`, [restaurantId]);

  await auditLog({
    restaurantId,
    actorId: actor.id,
    actorEmail: actor.email,
    action: 'otp.end_all',
    entity: 'table_sessions',
    meta: { sessions_closed: open.length, codes_cleared: dead.length },
  });
  await broadcast(restaurantId, { type: 'otp_dismissed', payload: { all: true } });
  return { sessionsClosed: open.length, codesCleared: dead.length };
}

/** Codes for a table die when the table is closed / the sticker is regenerated. */
export async function invalidateOtpsForTable(tableId: string, reason: string) {
  await db.query(
    `update table_otps set invalidated_at = now(), invalidated_reason = $2
      where table_id = $1 and invalidated_at is null`,
    [tableId, reason],
  );
}

// ------------------------------------------------------------- verification
/**
 * Check a guest's code. ONE statement:
 *
 *   * locks the live row for the table (`for update`)
 *   * refuses if expired, already invalidated, or out of attempts
 *   * counts a wrong attempt (correct entries are never counted)
 *   * invalidates the code on the 5th wrong attempt
 *
 * Returns the OTP row on success; the caller then joins or creates the session.
 */
export async function consumeOtp(input: {
  restaurantId: string;
  tableId: string;
  code: string;
}): Promise<VerifyResult> {
  const settings = await getOtpSettings(input.restaurantId);

  const res = await transaction(async (tx) => {
    const row = await tx.one<any>(
      `select id, code, attempts, invalidated_at, expires_at, session_id,
              (expires_at <= now()) as expired
         from table_otps
        where table_id = $1 and invalidated_at is null
        order by created_at desc
        limit 1
        for update`,
      [input.tableId],
    );

    if (!row) {
      return { kind: 'NO_CODE' as const };
    }
    if (row.expired) {
      return { kind: 'EXPIRED' as const, otpId: row.id };
    }
    if (Number(row.attempts) >= settings.maxAttempts) {
      return { kind: 'LOCKED' as const, otpId: row.id };
    }

    if (String(row.code) === input.code) {
      return { kind: 'OK' as const, otpId: row.id, attempts: Number(row.attempts) };
    }

    const next = Number(row.attempts) + 1;
    const lock = next >= settings.maxAttempts;
    await tx.query(
      `update table_otps
          set attempts = $2,
              invalidated_at = case when $3 then now() else invalidated_at end,
              invalidated_reason = case when $3 then 'too many attempts' else invalidated_reason end
        where id = $1`,
      [row.id, next, lock],
    );
    return {
      kind: lock ? ('LOCKED_NOW' as const) : ('WRONG' as const),
      otpId: row.id,
      attemptsLeft: Math.max(0, settings.maxAttempts - next),
    };
  });

  switch (res.kind) {
    case 'NO_CODE':
      return {
        ok: false,
        reason: 'NO_CODE',
        message: 'Ask your waiter for the table code.',
        canAskAgain: true,
      };
    case 'EXPIRED':
      return {
        ok: false,
        reason: 'EXPIRED',
        message: 'This code has expired. Ask your waiter for a new one.',
        canAskAgain: true,
      };
    case 'LOCKED':
      return {
        ok: false,
        reason: 'LOCKED',
        message: 'Too many wrong attempts. Ask your waiter for a new code.',
        canAskAgain: true,
      };
    case 'WRONG':
      return {
        ok: false,
        reason: 'WRONG',
        message: `That code is not right. ${res.attemptsLeft} attempt${
          res.attemptsLeft === 1 ? '' : 's'
        } left.`,
        attemptsLeft: res.attemptsLeft,
        canAskAgain: false,
      };
    case 'LOCKED_NOW':
      await auditLog({
        restaurantId: input.restaurantId,
        actorId: null,
        actorEmail: null,
        action: 'otp.locked',
        entity: 'table_otps',
        entityId: res.otpId,
        meta: { attempts: settings.maxAttempts },
      });
      await broadcast(input.restaurantId, { type: 'otp_locked', payload: { otpId: res.otpId } });
      return {
        ok: false,
        reason: 'LOCKED',
        message: 'Too many wrong attempts. Ask your waiter for a new code.',
        canAskAgain: true,
      };
    default: {
      // verified: the code stays usable for the rest of the group during its window
      await auditLog({
        restaurantId: input.restaurantId,
        actorId: null,
        actorEmail: null,
        action: 'otp.verified',
        entity: 'table_otps',
        entityId: res.otpId,
        meta: { attempts_before: res.attempts },
      });
      return {
        ok: true,
        otpId: res.otpId,
        sessionId: '',
        guestNo: 0,
        joined: false,
        verifiedAt: new Date().toISOString(),
      };
    }
  }
}

/** Mark a code as consumed by a session (so "New party" can find its visit). */
export async function attachOtpToSession(otpId: string, sessionId: string) {
  await db.query(
    `update table_otps
        set session_id = coalesce(session_id, $2),
            verified_at = coalesce(verified_at, now())
      where id = $1`,
    [otpId, sessionId],
  );
}

/** Cron: codes are useful for a waiter's "what happened" glance, then gone. */
export async function pruneOtps(): Promise<number> {
  const rows = await db.query<{ id: string }>(
    `delete from table_otps where created_at < now() - interval '24 hours' returning id`,
  );
  return rows.length;
}
