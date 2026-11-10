import 'server-only';
import { NextResponse } from 'next/server';
import { requireStaff } from '@/server/auth';
import { getOpenCalls } from '@/server/repos/service';
import { getPendingOrders } from '@/server/repos/orders';
import { db } from '@/server/db';
import { handleApiError } from '@/server/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Fallback signal endpoint for staff devices when Supabase Realtime is not
 * configured (local mode). Returns a compact fingerprint the client polls
 * every few seconds; a change triggers the same audio + refresh path.
 */
export async function GET() {
  try {
    const user = await requireStaff(['waiter', 'kitchen', 'admin'] as any);
    // heartbeat: the guest screen uses this to say "please call a staff member"
    await db.query(`update staff_profiles set last_seen_at = now() where id = $1`, [user.id]);
    // kitchen never receives codes (E6)
    const showCodes = user.role !== 'kitchen';
    const [orders, calls, latest, codes] = await Promise.all([
      getPendingOrders(user.restaurant_id),
      getOpenCalls(user.restaurant_id),
      db.one<{ last: string | null }>(
        `select max(updated_at)::text as last from orders where restaurant_id = $1`,
        [user.restaurant_id],
      ),
      showCodes
        ? db.one<{ n: number; newest: string | null }>(
            `select count(*)::int as n, max(created_at)::text as newest
               from table_otps
              where restaurant_id = $1 and invalidated_at is null and created_at > now() - interval '30 minutes'`,
            [user.restaurant_id],
          )
        : Promise.resolve({ n: 0, newest: null }),
    ]);
    return NextResponse.json({
      ok: true,
      data: {
        pending: orders.length,
        calls: calls.length,
        newestOrderId: orders.at(-1)?.id ?? null,
        codes: codes?.n ?? 0,
        fingerprint: `${orders.length}:${calls.length}:${latest?.last ?? ''}:${codes?.n ?? 0}:${
          codes?.newest ?? ''
        }`,
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}
