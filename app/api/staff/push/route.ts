import 'server-only';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin, handleApiError, parseBody } from '@/server/api';
import { requireStaff } from '@/server/auth';
import { removePushSubscription, savePushSubscription } from '@/server/repos/events';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const subscribeSchema = z.object({
  endpoint: z.string().url().max(600),
  keys: z.object({ p256dh: z.string().max(300), auth: z.string().max(300) }),
});

/** Registers this device for Web Push (spec §6: alerts while backgrounded). */
export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    const user = await requireStaff(['waiter', 'kitchen', 'admin']);
    const body = await parseBody(req, subscribeSchema);

    await savePushSubscription({
      restaurantId: user.restaurant_id,
      staffUserId: user.user_id,
      endpoint: body.endpoint,
      p256dh: body.keys.p256dh,
      auth: body.keys.auth,
      userAgent: req.headers.get('user-agent'),
    });
    return NextResponse.json({ ok: true, data: { subscribed: true } });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(req: Request) {
  try {
    assertSameOrigin(req);
    await requireStaff(['waiter', 'kitchen', 'admin']);
    const body = await parseBody(req, z.object({ endpoint: z.string().url().max(600) }));
    await removePushSubscription(body.endpoint);
    return NextResponse.json({ ok: true, data: { unsubscribed: true } });
  } catch (err) {
    return handleApiError(err);
  }
}

/** The public VAPID key the browser needs to subscribe. */
export async function GET() {
  try {
    await requireStaff(['waiter', 'kitchen', 'admin']);
    return NextResponse.json({
      ok: true,
      data: { publicKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? null },
    });
  } catch (err) {
    return handleApiError(err);
  }
}
