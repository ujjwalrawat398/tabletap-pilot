import 'server-only';
import { cookies } from 'next/headers';
import { db } from '@/server/db';
import { env, getSessionSecret, isSupabaseMode } from '@/lib/env';
import { signPayload, verifyPayload, safeEqual } from '@/lib/crypto';
import { createClient } from '@supabase/supabase-js';
import { timingSafeEqual } from 'node:crypto';
import { LOGIN_RATE_LIMIT } from '@/lib/constants';
import { hashPassword, passwordProblem, verifyPassword } from '@/lib/password';

export { hashPassword, passwordProblem, verifyPassword };

export const STAFF_COOKIE = 'tt_staff';

export type Role = 'admin' | 'waiter' | 'kitchen';

export type StaffUser = {
  id: string; // staff_profiles.id
  user_id: string; // auth.users.id (or profile id locally)
  restaurant_id: string;
  email: string;
  full_name: string;
  role: Role;
  restaurant_name: string;
  accent_color: string;
  currency: string;
};

type StaffCookiePayload = {
  sub: string; // staff_profiles.id
  uid: string; // auth user id
  rid: string; // restaurant id
  role: Role;
  email: string;
  name: string;
  exp: number;
};

const cookieOpts = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
};

// ---------------------------------------------------------------- passwords
// (implemented in @/lib/password so the seeding script can reuse them)

// ---------------------------------------------------------------- supabase
function supabaseAdmin() {
  if (!isSupabaseMode) return null;
  return createClient(env.SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function supabaseAuthClient() {
  if (!isSupabaseMode) return null;
  return createClient(env.SUPABASE_URL!, env.SUPABASE_ANON_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// ---------------------------------------------------------------- login
export type LoginResult =
  | { ok: true; user: StaffUser; session?: { access_token: string; refresh_token: string } }
  | { ok: false; error: string; status?: number };

export async function loginStaff(email: string, password: string, ip: string): Promise<LoginResult> {
  const normalizedEmail = email.trim().toLowerCase();
  const limited = await rateLimit(`login:${ip}:${normalizedEmail}`, LOGIN_RATE_LIMIT.attempts, LOGIN_RATE_LIMIT.windowSeconds);
  if (!limited.ok) return { ok: false, error: 'Too many attempts. Try again in a few minutes.', status: 429 };

  let authUserId: string | null = null;
  let sessionTokens: { access_token: string; refresh_token: string } | undefined;

  if (isSupabaseMode) {
    const client = supabaseAuthClient()!;
    const { data, error } = await client.auth.signInWithPassword({ email: normalizedEmail, password });
    if (error || !data.user) return { ok: false, error: 'Invalid email or password.', status: 401 };
    authUserId = data.user.id;
    if (data.session) {
      sessionTokens = {
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
      };
    }
  } else {
    const cred = await db.one<{ id: string; user_id: string; password_hash: string }>(
      `select p.id, p.user_id, c.password_hash
         from staff_profiles p join staff_credentials c on c.user_id = p.id
        where lower(p.email) = lower($1) and p.is_active`,
      [normalizedEmail],
    );
    if (!cred) return { ok: false, error: 'Invalid email or password.', status: 401 };
    const valid = await verifyPassword(password, cred.password_hash);
    if (!valid) return { ok: false, error: 'Invalid email or password.', status: 401 };
    authUserId = cred.user_id;
    await db.query(`update staff_credentials set last_login_at = now() where user_id = $1`, [cred.id]);
  }

  const profile = await db.one<any>(
    `select p.*, r.name as restaurant_name, r.accent_color, r.currency
       from staff_profiles p join restaurants r on r.id = p.restaurant_id
      where p.user_id = $1`,
    [authUserId],
  );
  if (!profile) return { ok: false, error: 'No staff profile found for this account.', status: 403 };
  if (!profile.is_active) return { ok: false, error: 'This account is disabled. Contact the owner.', status: 403 };

  const user: StaffUser = {
    id: profile.id,
    user_id: profile.user_id,
    restaurant_id: profile.restaurant_id,
    email: profile.email,
    full_name: profile.full_name,
    role: profile.role,
    restaurant_name: profile.restaurant_name,
    accent_color: profile.accent_color,
    currency: profile.currency,
  };

  await setStaffCookie(user);
  await auditLog({
    restaurantId: user.restaurant_id,
    actorId: user.user_id,
    actorEmail: user.email,
    action: 'staff.login',
    entity: 'staff_profiles',
    entityId: user.id,
  });

  return { ok: true, user, session: sessionTokens };
}

export async function setStaffCookie(user: StaffUser) {
  const payload: StaffCookiePayload = {
    sub: user.id,
    uid: user.user_id,
    rid: user.restaurant_id,
    role: user.role,
    email: user.email,
    name: user.full_name,
    exp: Date.now() + 12 * 3600_000, // 12h shift
  };
  const jar = await cookies();
  jar.set(STAFF_COOKIE, signPayload(payload, getSessionSecret()), {
    ...cookieOpts,
    expires: new Date(payload.exp),
  });
}

export async function clearStaffCookie() {
  const jar = await cookies();
  jar.delete(STAFF_COOKIE);
}

/** Reads + validates the staff cookie against the live database row. */
export async function getStaffUser(): Promise<StaffUser | null> {
  const jar = await cookies();
  const raw = jar.get(STAFF_COOKIE)?.value;
  if (!raw) return null;
  const payload = verifyPayload<StaffCookiePayload>(raw, getSessionSecret());
  if (!payload || payload.exp < Date.now()) return null;

  const profile = await db.one<any>(
    `select p.*, r.name as restaurant_name, r.accent_color, r.currency
       from staff_profiles p join restaurants r on r.id = p.restaurant_id
      where p.id = $1 and p.is_active`,
    [payload.sub],
  );
  if (!profile) return null;
  // role changes take effect immediately
  if (profile.role !== payload.role || profile.restaurant_id !== payload.rid) {
    const user: StaffUser = {
      id: profile.id,
      user_id: profile.user_id,
      restaurant_id: profile.restaurant_id,
      email: profile.email,
      full_name: profile.full_name,
      role: profile.role,
      restaurant_name: profile.restaurant_name,
      accent_color: profile.accent_color,
      currency: profile.currency,
    };
    await setStaffCookie(user);
    return user;
  }
  return {
    id: profile.id,
    user_id: profile.user_id,
    restaurant_id: profile.restaurant_id,
    email: profile.email,
    full_name: profile.full_name,
    role: profile.role,
    restaurant_name: profile.restaurant_name,
    accent_color: profile.accent_color,
    currency: profile.currency,
  };
}

export async function requireStaff(roles?: Role[]): Promise<StaffUser> {
  const user = await getStaffUser();
  if (!user) throw new AuthError('Please sign in again.', 401);
  if (roles && !roles.includes(user.role)) throw new AuthError('You do not have access to this action.', 403);
  return user;
}

export class AuthError extends Error {
  status: number;
  constructor(message: string, status = 401) {
    super(message);
    this.status = status;
  }
}

// ---------------------------------------------------------------- staff admin
export async function createStaffAccount(input: {
  restaurantId: string;
  email: string;
  password: string;
  fullName: string;
  role: Role;
}) {
  const problem = passwordProblem(input.password);
  if (problem) throw new AuthError(problem, 400);

  const normalizedEmail = input.email.trim().toLowerCase();
  const existing = await db.one(`select 1 from staff_profiles where lower(email) = lower($1)`, [
    normalizedEmail,
  ]);
  if (existing) throw new AuthError('A staff account with this email already exists.', 409);

  let userId: string;

  if (isSupabaseMode) {
    const admin = supabaseAdmin()!;
    const { data, error } = await admin.auth.admin.createUser({
      email: normalizedEmail,
      password: input.password,
      email_confirm: true,
    });
    if (error || !data.user) throw new AuthError(error?.message ?? 'Could not create login.', 400);
    userId = data.user.id;
  } else {
    userId = crypto.randomUUID();
  }

  const profile = await db.one<{ id: string }>(
    `insert into staff_profiles (restaurant_id, user_id, email, full_name, role)
     values ($1,$2,$3,$4,$5) returning id`,
    [input.restaurantId, userId, normalizedEmail, input.fullName, input.role],
  );

  if (!isSupabaseMode && profile) {
    await db.query(`insert into staff_credentials (user_id, password_hash) values ($1,$2)`, [
      profile.id,
      await hashPassword(input.password),
    ]);
  }
  return profile!.id;
}

/**
 * Sets a staff member's password. `mustReset` is true for an admin-chosen temporary
 * password and false when the person chose it themselves (self-change / approved request).
 */
export async function resetStaffPassword(
  profileId: string,
  restaurantId: string,
  newPassword: string,
  opts: { mustReset?: boolean } = {},
) {
  const mustReset = opts.mustReset ?? true;
  const problem = passwordProblem(newPassword);
  if (problem) throw new AuthError(problem, 400);

  const profile = await db.one<{ user_id: string; email: string }>(
    `select user_id, email from staff_profiles where id = $1 and restaurant_id = $2`,
    [profileId, restaurantId],
  );
  if (!profile) throw new AuthError('Staff member not found.', 404);

  if (isSupabaseMode) {
    const admin = supabaseAdmin()!;
    const { error } = await admin.auth.admin.updateUserById(profile.user_id, { password: newPassword });
    if (error) throw new AuthError(error.message, 400);
  } else {
    await db.query(
      `insert into staff_credentials (user_id, password_hash, must_reset)
       values ($1,$2,$3)
       on conflict (user_id) do update set password_hash = excluded.password_hash, must_reset = excluded.must_reset`,
      [profileId, await hashPassword(newPassword), mustReset],
    );
  }
  return profile;
}

/**
 * Confirms the signed-in person knows their current password before a change is
 * accepted (a stolen session cookie alone must not be enough to take over the login).
 * Rate limited per account, so it cannot be used to guess the password.
 */
export async function checkCurrentPassword(user: Pick<StaffUser, 'id' | 'email'>, password: string) {
  const limited = await rateLimit(`pwchange:${user.id}`, 5, 900);
  if (!limited.ok) throw new AuthError('Too many attempts. Try again in a few minutes.', 429);

  let ok = false;
  if (isSupabaseMode) {
    const client = supabaseAuthClient()!;
    const { data, error } = await client.auth.signInWithPassword({ email: user.email, password });
    ok = !error && Boolean(data.user);
  } else {
    const cred = await db.one<{ password_hash: string }>(
      `select password_hash from staff_credentials where user_id = $1`,
      [user.id],
    );
    ok = cred ? await verifyPassword(password, cred.password_hash) : false;
  }
  if (!ok) throw new AuthError('Current password is incorrect.', 400);
}

export async function deleteStaffAccount(profileId: string, restaurantId: string) {
  const profile = await db.one<{ user_id: string }>(
    `delete from staff_profiles where id = $1 and restaurant_id = $2 and role <> 'admin' returning user_id`,
    [profileId, restaurantId],
  );
  if (profile && isSupabaseMode) {
    const admin = supabaseAdmin()!;
    await admin.auth.admin.deleteUser(profile.user_id).catch(() => undefined);
  }
  return Boolean(profile);
}

// ---------------------------------------------------------------- rate limit
export type RateLimitOk = { ok: true; remaining: number } | { ok: false; retryAfter: number };

/**
 * Fixed-window counter in Postgres so it works across serverless instances.
 * Used for order sending, waiter calls, game answers and login attempts.
 */
export async function rateLimit(key: string, limit: number, windowSeconds: number): Promise<RateLimitOk> {
  const row = await db.one<{ hits: number; window_start: string }>(
    `insert into rate_limits (key, hits, window_start) values ($1, 1, now())
     on conflict (key) do update
       set hits = case when rate_limits.window_start < now() - make_interval(secs => $2)
                       then 1 else rate_limits.hits + 1 end,
           window_start = case when rate_limits.window_start < now() - make_interval(secs => $2)
                               then now() else rate_limits.window_start end
     returning hits, window_start`,
    [key, windowSeconds],
  );
  const hits = row?.hits ?? 1;
  const started = new Date(row?.window_start ?? Date.now()).getTime();
  if (hits > limit) {
    const retryAfter = Math.ceil((started + windowSeconds * 1000 - Date.now()) / 1000);
    return { ok: false, retryAfter: Math.max(1, retryAfter) };
  }
  return { ok: true, remaining: limit - hits };
}

/** Non-blocking cooldown check for waiter calls (returns seconds left). */
export async function cooldownRemaining(key: string, seconds: number): Promise<number> {
  const row = await db.one<{ window_start: string; hits: number }>(
    `select window_start, hits from rate_limits where key = $1`,
    [key],
  );
  if (!row) return 0;
  const elapsed = (Date.now() - new Date(row.window_start).getTime()) / 1000;
  return elapsed >= seconds ? 0 : Math.ceil(seconds - elapsed);
}

// ---------------------------------------------------------------- audit log
export async function auditLog(entry: {
  restaurantId: string;
  actorId?: string | null;
  actorEmail?: string | null;
  action: string;
  entity?: string;
  entityId?: string;
  meta?: Record<string, unknown>;
}) {
  try {
    await db.query(
      `insert into audit_log (restaurant_id, actor_id, actor_email, action, entity, entity_id, meta)
       values ($1,$2,$3,$4,$5,$6,$7)`,
      [
        entry.restaurantId,
        entry.actorId ?? null,
        entry.actorEmail ?? null,
        entry.action,
        entry.entity ?? null,
        entry.entityId ?? null,
        JSON.stringify(entry.meta ?? {}),
      ],
    );
  } catch (err) {
    console.error('[audit] failed', err);
  }
}

export { safeEqual };
