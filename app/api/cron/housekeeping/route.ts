import 'server-only';
import { NextResponse } from 'next/server';
import { housekeeping } from '@/server/repos/events';
import { safeEqual } from '@/lib/crypto';
import { isProd } from '@/lib/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Expires stale table sessions, frees tables, closes abandoned calls and prunes
 * rate-limit buckets.
 *
 * Auth: a shared secret, nothing else. Send it as `Authorization: Bearer <key>`,
 * `x-cron-key: <key>` or `?key=<key>`.
 *
 *   Cloudflare Pages   → Cron Trigger hitting /api/cron/housekeeping  (scheduled worker)
 *   Vercel             → `crons` entry in vercel.json (Vercel sends the Bearer header)
 *   Supabase pg_cron   → net.http_post with the header
 *
 * There is deliberately no User-Agent bypass: any client can set a header, so
 * "looks like a cron runner" proves nothing. With no secret configured the route
 * does nothing on a live deployment (fails closed) — the correct behaviour is to
 * configure CRON_SECRET, not to leave an open endpoint.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const secret = process.env.CRON_SECRET;
  const authorization = req.headers.get('authorization') ?? '';
  const provided =
    (authorization.toLowerCase().startsWith('bearer ') ? authorization.slice(7) : '') ||
    req.headers.get('x-cron-key') ||
    url.searchParams.get('key') ||
    '';

  if (!secret) {
    // Demo / local mode keeps the scheduler usable; production fails closed.
    if (isProd) {
      return NextResponse.json(
        { ok: false, error: 'CRON_SECRET is not configured on this deployment.' },
        { status: 503 },
      );
    }
  } else if (!provided || !safeEqual(provided, secret)) {
    return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const result = await housekeeping();
    return NextResponse.json({ ok: true, data: { ranAt: new Date().toISOString(), ...result } });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
