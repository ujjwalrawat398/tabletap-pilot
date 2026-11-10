import 'server-only';
import { NextResponse } from 'next/server';
import { db } from '@/server/db';
import { createStaffAccount } from '@/server/auth';
import { hashPassword } from '@/lib/password';
import { dbMode } from '@/server/db';
import { demoAllowed } from '@/server/demo-gate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEMO = [
  { email: 'admin@spiceroute.test', role: 'admin' as const, name: 'Ananya (Owner)' },
  { email: 'waiter@spiceroute.test', role: 'waiter' as const, name: 'Ravi (Waiter)' },
  { email: 'kitchen@spiceroute.test', role: 'kitchen' as const, name: 'Chef Imran' },
];
const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? 'Demo@1234';

/** This route hands out known-password logins, so it is demo-only and fails closed (see demo-gate.ts). */
function disabled() {
  return NextResponse.json(
    { ok: false, error: 'Setup is disabled on this deployment. Create staff from Admin → Staff.' },
    { status: 404 },
  );
}

/** GET — is the install ready to use? */
export async function GET() {
  if (!demoAllowed()) return disabled();
  try {
    const restaurant = await db.one<any>(
      `select id, name, slug, accent_color from restaurants order by created_at limit 1`,
    );
    const staff = await db.one<{ c: number }>(`select count(*)::int as c from staff_profiles`);
    const tables = await db.one<{ c: number }>(`select count(*)::int as c from tables`);
    const items = await db.one<{ c: number }>(`select count(*)::int as c from menu_items`);
    const questions = await db.one<{ c: number }>(`select count(*)::int as c from quiz_questions`);

    return NextResponse.json({
      ok: true,
      data: {
        mode: dbMode,
        restaurant,
        counts: {
          staff: staff?.c ?? 0,
          tables: tables?.c ?? 0,
          items: items?.c ?? 0,
          questions: questions?.c ?? 0,
        },
        demoPassword: DEMO_PASSWORD,
      },
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}

/**
 * POST — creates the demo staff logins. Idempotent.
 * Demo-only: closed unless demoAllowed() (embedded DB only; never in production unless DEMO_MODE=on).
 * Real accounts are created from Admin → Staff or `npm run seed:staff`.
 */
export async function POST() {
  if (!demoAllowed()) return disabled();
  try {
    const restaurant = await db.one<{ id: string }>(`select id from restaurants order by created_at limit 1`);
    if (!restaurant) {
      return NextResponse.json({ ok: false, error: 'No restaurant found. Run the seed first.' }, { status: 400 });
    }

    const created: string[] = [];
    const skipped: string[] = [];

    for (const account of DEMO) {
      const existing = await db.one<{ id: string }>(
        `select id from staff_profiles where lower(email) = lower($1)`,
        [account.email],
      );
      if (existing) {
        if (dbMode === 'pglite') {
          await db.query(
            `insert into staff_credentials (user_id, password_hash) values ($1,$2)
             on conflict (user_id) do update set password_hash = excluded.password_hash`,
            [existing.id, await hashPassword(DEMO_PASSWORD)],
          );
        }
        skipped.push(account.email);
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

    return NextResponse.json({ ok: true, data: { created, skipped, password: DEMO_PASSWORD } });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
