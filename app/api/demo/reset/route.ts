import 'server-only';
import { NextResponse } from 'next/server';
import { db, dbMode } from '@/server/db';
import { embeddedDemoAllowed } from '@/server/demo-gate';
import { hashPassword } from '@/lib/password';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Reset the demo database back to seed state.
 *
 * Exists so the automated suites (`npm run test:smoke`, `npm run test:e2e`) are
 * repeatable: they create orders, reviews (one per session), rate-limit counters
 * and smoke-only staff rows that would otherwise collide with the next run.
 *
 * Safety: this is only ever available on the embedded demo database (PGlite) or
 * when DEMO_MODE=on is set explicitly. It refuses to touch a Postgres database,
 * so a live restaurant can never be wiped through this route.
 */
function resetAllowed() {
  return embeddedDemoAllowed();
}

/** Everything a visit creates. Seed data (menu, tables, settings, quiz) is kept. */
const WIPE = [
  'game_answers',
  'game_players',
  'game_rounds',
  'game_scores',
  'reviews',
  'feedback',
  'waiter_calls',
  'cart_items',
  'carts',
  'order_items',
  'orders',
  'audit_log',
  'rate_limits',
  'push_subscriptions',
  'table_session_devices',
  'table_sessions',
  'table_otps',
  'staff_password_requests',
];

export async function POST() {
  if (!resetAllowed()) {
    return NextResponse.json(
      { ok: false, error: 'Reset is only available on the embedded demo database.' },
      { status: dbMode === 'pglite' ? 403 : 404 },
    );
  }

  try {
    for (const table of WIPE) {
      // Tables appear in FK order above, so a plain delete cannot trip a constraint.
      await db.query(`delete from ${table}`);
    }

    // Smoke runs add an extra staff row per run; keep the three demo accounts.
    await db.query(
      `delete from staff_profiles where lower(email) not in
         ('admin@spiceroute.test', 'waiter@spiceroute.test', 'kitchen@spiceroute.test')`,
    );
    // ...and drop any table the suite added beyond the seeded 10.
    await db.query(
      `delete from tables t
        where t.number not in (select number from tables order by number limit 10)
          and not exists (select 1 from orders o where o.table_id = t.id)`,
    );

    // Make sure the demo logins exist and really use the demo password.
    const passwordHash = await hashPassword(process.env.DEMO_PASSWORD ?? 'Demo@1234');
    const accounts = [
      { email: 'admin@spiceroute.test', role: 'admin', name: 'Ananya (Owner)' },
      { email: 'waiter@spiceroute.test', role: 'waiter', name: 'Ravi (Waiter)' },
      { email: 'kitchen@spiceroute.test', role: 'kitchen', name: 'Chef Imran' },
    ];
    const restaurant = await db.one<{ id: string }>(`select id from restaurants order by created_at limit 1`);
    if (!restaurant) {
      return NextResponse.json(
        { ok: false, error: 'No restaurant in the database. Restart the server to re-run the seed.' },
        { status: 500 },
      );
    }

    const repaired: string[] = [];
    for (const account of accounts) {
      const existing = await db.one<{ id: string; password_hash: string | null; is_active: boolean }>(
        `select u.id, c.password_hash, u.is_active
           from staff_profiles u
           left join staff_credentials c on c.user_id = u.id
          where u.restaurant_id = $1 and lower(u.email) = lower($2)`,
        [restaurant.id, account.email],
      );

      if (!existing) {
        // staff_profiles.user_id is NOT NULL (it points at auth.users in
        // Supabase mode, and at nothing in local mode) — local mode makes its
        // own uuid, exactly like createStaffAccount() does.
        const inserted = await db.one<{ id: string }>(
          `insert into staff_profiles (restaurant_id, user_id, email, full_name, role, is_active)
           values ($1, $2, $3, $4, $5, true) returning id`,
          [restaurant.id, crypto.randomUUID(), account.email, account.name, account.role],
        );
        if (inserted) {
          await db.query(
            `insert into staff_credentials (user_id, password_hash) values ($1, $2)`,
            [inserted.id, passwordHash],
          );
          repaired.push(account.email);
        }
        continue;
      }

      // We only have the hash, so re-hashing the demo password cannot be compared;
      // just make sure a credential row exists and the account is usable.
      const hasCredential = Boolean(existing.password_hash);
      if (!hasCredential || !existing.is_active) {
        await db.query(
          `insert into staff_credentials (user_id, password_hash) values ($1, $2)
           on conflict (user_id) do update set password_hash = excluded.password_hash`,
          [existing.id, passwordHash],
        );
        await db.query(`update staff_profiles set is_active = true, role = $2 where id = $1`, [
          existing.id,
          account.role,
        ]);
        repaired.push(account.email);
      }
    }

    // Free any table that a previous run left occupied.
    await db.query(`update tables set status = 'free' where status <> 'free'`);

    return NextResponse.json({
      ok: true,
      data: { cleared: WIPE, accountsRepaired: repaired },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Reset failed';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
