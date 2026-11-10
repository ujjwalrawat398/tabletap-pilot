import 'server-only';
import { NextResponse } from 'next/server';
import { assertSameOrigin, handleApiError, jsonError, parseBody } from '@/server/api';
import { requireStaff } from '@/server/auth';
import { orderDecisionSchema } from '@/lib/validation';
import { getKitchenOrders, updateOrderStatus } from '@/server/repos/orders';
import { broadcast, sendPushToStaff } from '@/server/repos/events';
import { db } from '@/server/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/kitchen/board — confirmed + preparing + ready orders. */
export async function GET(_req: Request, props: { params: Promise<{ action: string }> }) {
  const { action } = await props.params;
  try {
    const user = await requireStaff(['kitchen', 'admin']);
    if (action !== 'board') return jsonError('Unknown action', 404);

    const orders = await getKitchenOrders(user.restaurant_id);
    return NextResponse.json({
      ok: true,
      data: { orders, user, serverNow: Date.now() },
    });
  } catch (err) {
    return handleApiError(err);
  }
}

/** POST /api/kitchen/order — preparing / ready. */
export async function POST(req: Request, props: { params: Promise<{ action: string }> }) {
  const { action } = await props.params;
  try {
    assertSameOrigin(req);
    const user = await requireStaff(['kitchen', 'admin']);
    if (action !== 'order') return jsonError('Unknown action', 404);

    const body = await parseBody(req, orderDecisionSchema);
    if (body.action !== 'preparing' && body.action !== 'ready') {
      return jsonError('Kitchen can only mark orders preparing or ready.', 403);
    }

    const result = await updateOrderStatus({
      restaurantId: user.restaurant_id,
      orderId: body.orderId,
      action: body.action,
      staffUserId: user.user_id,
    });

    const table = await db.one<{ number: number }>(
      `select t.number from orders o join tables t on t.id = o.table_id where o.id = $1`,
      [body.orderId],
    );

    if (body.action === 'ready') {
      await broadcast(user.restaurant_id, {
        type: 'order_ready',
        tableNumber: table?.number,
        orderId: body.orderId,
        payload: { status: 'ready' },
      });
      await sendPushToStaff(user.restaurant_id, {
        event: 'order_ready',
        title: `Ready to serve · Table ${table?.number ?? ''}`,
        body: 'An order is ready for pickup.',
        url: '/waiter',
        tag: `ready-${body.orderId}`,
      });
    } else {
      await broadcast(user.restaurant_id, {
        type: 'order_status',
        tableNumber: table?.number,
        orderId: body.orderId,
        payload: { status: 'preparing' },
      });
    }

    return NextResponse.json({ ok: true, data: result });
  } catch (err) {
    return handleApiError(err);
  }
}
