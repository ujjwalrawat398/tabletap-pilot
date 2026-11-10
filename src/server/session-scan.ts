import 'server-only';
import { db } from '@/server/db';
import {
  createSession,
  DeviceCapError,
  findTableByCode,
  getSessionFromCookie,
  issueDeviceToken,
} from '@/server/session';
import { attachOtpToSession, getOtpSettings, raiseOtp, type StaffOtp } from '@/server/repos/otp';
import { broadcast } from '@/server/repos/events';
import { SESSION_TTL_HOURS } from '@/lib/constants';

/**
 * Scanning (NFC tap / QR) does NOT create a session any more — it only reports the
 * table and makes sure a code exists for the waiter to read out. The guest proves
 * they are at the table by typing that code; see `verifyTableCode` below.
 *
 * Nothing private goes into the scan response: no code, no Wi-Fi password.
 */
export type ScanResult = {
  needs_code: boolean;
  table: { number: number; label: string | null; code: string };
  /** true when this device already holds a live session (the page can go straight home) */
  verified: boolean;
  /** read-only menu preview may be browsed before the code is entered (setting) */
  menu_preview: boolean;
  code_length: number;
  /** seconds until "Ask again" is allowed (re-issue cooldown) */
  retry_after: number;
  /** true when no staff device has been seen recently → "please call a staff member" */
  staff_offline: boolean;
  /** the code has not admitted anyone yet — nobody has read it out */
  awaiting_waiter: boolean;
  contact_phone: string | null;
  settings: {
    restaurant_name: string;
    accent_color: string;
    currency: string;
    logo_url: string | null;
    wifi_ssid: string | null;
    google_review_url: string | null;
    instagram_url: string | null;
    facebook_url: string | null;
    website_url: string | null;
    phone: string | null;
    address: string | null;
    session_hours: number;
  } | null;
};

export async function loadScanSettings(restaurantId: string) {
  const r = await db.one<any>(
    `select name, accent_color, currency, logo_url, wifi_ssid, google_review_url,
            instagram_url, facebook_url, website_url, phone, address, session_max_hours
       from restaurants where id = $1`,
    [restaurantId],
  );
  if (!r) return null;
  return {
    restaurant_name: r.name,
    accent_color: r.accent_color,
    currency: r.currency,
    logo_url: r.logo_url,
    wifi_ssid: r.wifi_ssid,
    google_review_url: r.google_review_url,
    instagram_url: r.instagram_url,
    facebook_url: r.facebook_url,
    website_url: r.website_url,
    phone: r.phone,
    address: r.address,
    session_hours: r.session_max_hours ?? SESSION_TTL_HOURS,
  };
}

/**
 * Has any staff device polled recently? Used for test E8: if nobody is watching the
 * board, the guest is told to call a staff member instead of waiting forever.
 */
async function staffSeenRecently(restaurantId: string) {
  const row = await db.one<{ seen: number }>(
    `select count(*)::int as seen from staff_profiles
      where restaurant_id = $1 and is_active and last_seen_at > now() - interval '60 seconds'`,
    [restaurantId],
  );
  return (row?.seen ?? 0) > 0;
}

export async function ensureSessionForScan(
  tableCode: string,
  opts: { ip?: string } = {},
): Promise<ScanResult | null> {
  const table = await findTableByCode(tableCode);
  if (!table) return null;

  const [settings, otpSettings] = await Promise.all([
    loadScanSettings(table.restaurant_id),
    getOtpSettings(table.restaurant_id),
  ]);

  const base = {
    table: { number: table.number, label: table.label, code: table.table_code },
    menu_preview: otpSettings.menuPreview,
    code_length: otpSettings.length,
    retry_after: 0,
    staff_offline: false,
    contact_phone: settings?.phone ?? null,
    settings,
  };

  // 1. this device is already inside a live session for this table
  const existing = await getSessionFromCookie(tableCode);
  if (existing) {
    return { ...base, needs_code: false, verified: true, awaiting_waiter: false };
  }

  // 2. raise (or reuse) the code the waiter will read out
  let raised: StaffOtp | null = null;
  try {
    raised = await raiseOtp({
      restaurantId: table.restaurant_id,
      tableId: table.id,
      tableNumber: table.number,
      tableLabel: table.label,
      ip: opts.ip,
    });
  } catch (err) {
    // a concurrent scan can win the unique index; the live code is the same card
    const message = err instanceof Error ? err.message : String(err);
    if (!/unique|duplicate key/i.test(message)) throw err;
  }

  const offline = !(await staffSeenRecently(table.restaurant_id));

  // The card exists either way; the page uses `awaiting_waiter` to decide between
  // "wait for the code" and "type the code your waiter already gave you".
  return {
    ...base,
    needs_code: true,
    verified: false,
    awaiting_waiter: (raised?.joined_phones ?? 0) === 0,
    retry_after: raised?.cooldown_seconds_left ?? 0,
    staff_offline: offline,
  };
}

export type VerifyOutcome =
  | { ok: true; sessionId: string; guestNo: number; joined: boolean }
  | {
      ok: false;
      reason: string;
      message: string;
      attemptsLeft?: number;
      canAskAgain: boolean;
    };

/**
 * Turn a correct code into a session for this phone.
 *
 * The code check itself is atomic (see `consumeOtp`); this wrapper then joins the
 * table's open visit or starts a new one, attaches the device, and decides the
 * "two clocks": the idle window from the restaurant settings and the hard cap.
 */
export async function verifyTableCode(
  tableCode: string,
  code: string,
  opts: { ip?: string } = {},
): Promise<VerifyOutcome> {
  const table = await findTableByCode(tableCode);
  if (!table) {
    return {
      ok: false,
      reason: 'TABLE_INVALID',
      message: 'This table link is no longer valid. Please ask a staff member for help.',
      canAskAgain: false,
    };
  }

  const otpSettings = await getOtpSettings(table.restaurant_id);

  // already verified on this phone? treat a repeat submit as success (double tap, B6)
  const existing = await getSessionFromCookie(tableCode);
  if (existing) {
    return { ok: true, sessionId: existing.id, guestNo: existing.guest_no, joined: true };
  }

  const { consumeOtp } = await import('@/server/repos/otp');
  const checked = await consumeOtp({
    restaurantId: table.restaurant_id,
    tableId: table.id,
    code,
  });
  if (!checked.ok) {
    return {
      ok: false,
      reason: checked.reason,
      message: checked.message,
      attemptsLeft: checked.attemptsLeft,
      canAskAgain: checked.canAskAgain,
    };
  }

  try {
    // join the visit that is still open on this table, else start one
    const open = await db.one<{ id: string; expires_at: string }>(
      `select id, expires_at from table_sessions
        where table_id = $1 and closed_at is null
          and last_activity_at > now() - make_interval(mins => $2)
          and coalesce(hard_expires_at, created_at + interval '4 hours') > now()
        order by created_at desc limit 1`,
      [table.id, otpSettings.idleMinutes],
    );

    let sessionId: string;
    let guestNo: number;
    let joined: boolean;

    if (open) {
      guestNo = await issueDeviceToken(
        open.id,
        table.restaurant_id,
        new Date(open.expires_at),
        otpSettings.maxDevices,
      );
      await db.query(`update table_sessions set last_activity_at = now() where id = $1`, [open.id]);
      await db.query(
        `insert into carts (restaurant_id, session_id) values ($1,$2)
         on conflict (session_id) do nothing`,
        [table.restaurant_id, open.id],
      );
      sessionId = open.id;
      joined = true;
    } else {
      const created = await createSession(table.id, table.restaurant_id, {
        otpId: checked.otpId,
        maxHours: otpSettings.maxHours,
        maxDevices: otpSettings.maxDevices,
      });
      sessionId = created.sessionId;
      guestNo = created.guestNo;
      joined = false;
    }

    await attachOtpToSession(checked.otpId, sessionId);
    await broadcast(table.restaurant_id, {
      type: 'order_status',
      tableNumber: table.number,
      payload: { verified: true, sessionId },
    });

    return { ok: true, sessionId, guestNo, joined };
  } catch (err) {
    if (err instanceof DeviceCapError) {
      return {
        ok: false,
        reason: 'DEVICE_CAP',
        message: err.message,
        canAskAgain: false,
      };
    }
    throw err;
  }
}

/**
 * The Wi-Fi card's payload: only for a live device token on this table.
 */
export async function getWifiCard(tableCode: string) {
  const table = await findTableByCode(tableCode);
  if (!table) return null;
  const session = await getSessionFromCookie(tableCode);
  if (!session) return null;
  const r = await db.one<{ wifi_ssid: string | null; wifi_password: string | null }>(
    `select wifi_ssid, wifi_password from restaurants where id = $1`,
    [table.restaurant_id],
  );
  return { wifi_ssid: r?.wifi_ssid ?? null, wifi_password: r?.wifi_password ?? null };
}
