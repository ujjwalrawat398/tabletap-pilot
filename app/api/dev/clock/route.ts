import 'server-only';
import { NextResponse } from 'next/server';
import { db } from '@/server/db';
import { embeddedDemoAllowed } from '@/server/demo-gate';
import { SYNC_QUESTION_SECONDS } from '@/lib/constants';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Test-only clock control, for the edge-case suite.
 *
 * Some guarantees can only be tested by moving time: "an idle visit ends after
 * `session_idle_minutes`", "the 4-hour hard cap wins even while the table is
 * active", "a code that expires while the guest is typing". Sleeping for four
 * hours is not an option, and a second PGlite handle from another process sees a
 * different snapshot (PGlite is single-writer per process), so the move has to
 * happen from inside the app.
 *
 * Safety: like /api/demo/reset, this only ever runs on the embedded demo
 * database. A real deployment talks to Postgres, where `dbMode === 'pg'` and the
 * route answers 404. It touches nothing but timestamps on one session/code.
 */
function devAllowed() {
  return embeddedDemoAllowed();
}

function notFound() {
  return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 });
}

export async function POST(req: Request) {
  if (!devAllowed()) return notFound();

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
  }

  const op = String(body.op ?? '');
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId : '';

  try {
    switch (op) {
      case 'session': {
        // read one row back — used to assert closed_reason
        if (!sessionId) return NextResponse.json({ ok: false, error: 'sessionId required' }, { status: 422 });
        const row = await db.one(
          `select id, last_activity_at, hard_expires_at, expires_at, closed_at, closed_reason
             from table_sessions where id = $1`,
          [sessionId],
        );
        return NextResponse.json({ ok: true, data: row });
      }

      case 'age-session': {
        if (!sessionId) return NextResponse.json({ ok: false, error: 'sessionId required' }, { status: 422 });
        if (body.pastHardCap) {
          await db.query(
            `update table_sessions
                set hard_expires_at = now() - interval '1 minute', last_activity_at = now()
              where id = $1`,
            [sessionId],
          );
        }
        if (body.idleMinutes) {
          await db.query(
            `update table_sessions
                set last_activity_at = now() - make_interval(mins => $2)
              where id = $1`,
            [sessionId, Number(body.idleMinutes)],
          );
        }
        const row = await db.one(
          `select id, last_activity_at, hard_expires_at, closed_at, closed_reason
             from table_sessions where id = $1`,
          [sessionId],
        );
        return NextResponse.json({ ok: true, data: row });
      }

      case 'expire-code': {
        // expire the live code on one table, as if the guest dawdled
        const rows = await db.query<{ id: string; code: string }>(
          `update table_otps o
              set expires_at = now() - interval '1 second'
             from tables t
            where t.id = o.table_id and t.number = $1 and o.invalidated_at is null
            returning o.id, o.code`,
          [Number(body.tableNumber ?? 0)],
        );
        return NextResponse.json({ ok: true, data: rows });
      }

      case 'drop-guest': {
        // a phone leaves the table (browser closed) — frees a device slot
        if (!sessionId) return NextResponse.json({ ok: false, error: 'sessionId required' }, { status: 422 });
        const rows = await db.query<{ guest_no: number }>(
          `delete from table_session_devices
            where id = (select id from table_session_devices
                         where session_id = $1 order by guest_no desc limit 1)
           returning guest_no`,
          [sessionId],
        );
        return NextResponse.json({ ok: true, data: rows });
      }

      case 'round-at': {
        // Put a table / whole-restaurant game on its own timeline: `elapsedSeconds` after its first
        // question appeared (negative = still in the lobby). Lets a test walk through a 3-minute
        // game in milliseconds without touching any rule.
        const roundId = typeof body.roundId === 'string' ? body.roundId : '';
        if (!roundId) return NextResponse.json({ ok: false, error: 'roundId required' }, { status: 422 });
        const elapsed = Number(body.elapsedSeconds ?? 0);
        const before = await db.one<{ starts_at: string }>(`select starts_at from game_rounds where id = $1`, [roundId]);
        const row = await db.one<{ starts_at: string }>(
          `update game_rounds
              set starts_at = now() - make_interval(secs => $2::float8),
                  ends_at   = now() - make_interval(secs => $2::float8)
                              + make_interval(secs => (question_count * $3::int)::float8),
                  status    = case when $2::float8 < 0 then 'lobby'::game_round_status
                                   else 'active'::game_round_status end
            where id = $1
            returning id, status, starts_at, ends_at`,
          [roundId, elapsed, SYNC_QUESTION_SECONDS],
        );
        // time moves for the whole round: a player's "left at" travels with it
        if (before?.starts_at && row?.starts_at) {
          const deltaSeconds = (new Date(row.starts_at).getTime() - new Date(before.starts_at).getTime()) / 1000;
          await db.query(
            `update game_players set left_at = left_at + make_interval(secs => $2::float8)
              where round_id = $1 and left_at is not null`,
            [roundId, deltaSeconds],
          );
        }
        return NextResponse.json({ ok: true, data: row });
      }

      default:
        return NextResponse.json({ ok: false, error: `Unknown op "${op}"` }, { status: 400 });
    }
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
