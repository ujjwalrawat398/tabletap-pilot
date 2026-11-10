import 'server-only';
import { NextResponse } from 'next/server';
import { db, dbMode } from '@/server/db';
import { demoAllowed } from '@/server/demo-gate';
import { createStaffAccount } from '@/server/auth';
import { hashPassword } from '@/lib/password';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEMO = [
  { email: 'admin@spiceroute.test', role: 'admin' as const, name: 'Ananya (Owner)' },
  { email: 'waiter@spiceroute.test', role: 'waiter' as const, name: 'Ravi (Waiter)' },
  { email: 'kitchen@spiceroute.test', role: 'kitchen' as const, name: 'Chef Imran' },
];

/**
 * One-click demo state.
 *
 * The migrations + seed run automatically the first time the app touches the
 * database (see src/server/db.ts), so the menu and tables always come back —
 * the only thing that cannot be seeded in SQL is the hashed staff passwords.
 * This endpoint creates them, and it is what the landing page button calls.
 *
 * Disabled when DEMO_MODE=off, in production unless DEMO_MODE=on, and always on a
 * real Postgres database, so a live restaurant can never recreate demo logins.
 */

const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? 'Demo@1234';

export async function POST() {
  if (!demoAllowed()) {
    return NextResponse.json({ ok: false, error: 'Demo mode is disabled.' }, { status: 403 });
  }

  try {
    const restaurant = await db.one<{ id: string; name: string }>(
      `select id, name from restaurants order by created_at limit 1`,
    );
    if (!restaurant) {
      return NextResponse.json(
        { ok: false, error: 'No restaurant in the database. Restart the server to re-run the seed.' },
        { status: 500 },
      );
    }

    const created: string[] = [];
    const refreshed: string[] = [];

    for (const account of DEMO) {
      const existing = await db.one<{ id: string }>(
        `select id from staff_profiles where lower(email) = lower($1)`,
        [account.email],
      );

      if (existing) {
        // local mode only: make sure the demo password still works after a reset
        if (dbMode === 'pglite') {
          await db.query(
            `insert into staff_credentials (user_id, password_hash) values ($1,$2)
             on conflict (user_id) do update set password_hash = excluded.password_hash`,
            [existing.id, await hashPassword(DEMO_PASSWORD)],
          );
          refreshed.push(account.email);
        }
        continue;
      }

      try {
        await createStaffAccount({
          restaurantId: restaurant.id,
          email: account.email,
          password: DEMO_PASSWORD,
          fullName: account.name,
          role: account.role,
        });
        created.push(account.email);
      } catch (err) {
        // two visitors pressing the button at once: the other request wins
        if (err instanceof Error && /already exists|duplicate key/i.test(err.message)) continue;
        throw err;
      }
    }

    const table = await db.one<{ table_code: string; number: number }>(
      `select table_code, number from tables where restaurant_id = $1 and is_active order by number limit 1`,
      [restaurant.id],
    );

    return NextResponse.json({
      ok: true,
      data: {
        restaurant: restaurant.name,
        created,
        refreshed,
        demoTable: table ? { code: table.table_code, number: table.number } : null,
        password: DEMO_PASSWORD,
      },
    });
  } catch (err) {
    console.error('[demo] seed failed', err);
    return NextResponse.json({ ok: false, error: 'Could not prepare the demo.' }, { status: 500 });
  }
}

export async function GET() {
  // Closed gate = no information at all (no DB mode, no staff count, no table code).
  if (!demoAllowed()) {
    return NextResponse.json({
      ok: true,
      data: { demoAllowed: false, mode: 'hidden', staffCount: 0, demoTable: null },
    });
  }
  try {
    const staff = await db.one<{ c: number }>(`select count(*)::int as c from staff_profiles`);
    const table = await db.one<{ table_code: string; number: number }>(
      `select table_code, number from tables t
        where t.is_active and t.restaurant_id = (select id from restaurants order by created_at limit 1)
        order by t.number limit 1`,
    );
    return NextResponse.json({
      ok: true,
      data: {
        demoAllowed: demoAllowed(),
        mode: dbMode,
        staffCount: staff?.c ?? 0,
        demoTable: table ? { code: table.table_code, number: table.number } : null,
      },
    });
  } catch {
    return NextResponse.json({ ok: true, data: { demoAllowed: demoAllowed(), mode: dbMode, staffCount: 0, demoTable: null } });
  }
}
