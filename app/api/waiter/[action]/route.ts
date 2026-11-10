import 'server-only';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin, handleApiError, jsonError, parseBody } from '@/server/api';
import { auditLog, requireStaff } from '@/server/auth';
import {
  closeSessionSchema,
  newPartySchema,
  orderDecisionSchema,
  otpDismissSchema,
  otpRaiseSchema,
  uuidSchema,
} from '@/lib/validation';
import { getKitchenOrders, getPendingOrders, updateOrderStatus } from '@/server/repos/orders';
import {
  getOpenCalls,
  getTableDetail,
  getTableGrid,
  handleCall,
} from '@/server/repos/service';
import { closeSession } from '@/server/session';
import {
  dismissOtp,
  invalidateOtpsForTable,
  listLiveOtps,
  raiseOtp,
  startNewParty,
} from '@/server/repos/otp';
import { broadcast } from '@/server/repos/events';
import { db } from '@/server/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/waiter/[action] — waiter dashboard data. */
export async function GET(req: Request, props: { params: Promise<{ action: string }> }) {
  const { action } = await props.params;
  try {
    const user = await requireStaff(['waiter', 'admin']);

    switch (action) {
      case 'board': {
        const [tables, pending, calls, kitchen, otps] = await Promise.all([
          getTableGrid(user.restaurant_id),
          getPendingOrders(user.restaurant_id),
          getOpenCalls(user.restaurant_id),
          getKitchenOrders(user.restaurant_id),
          listLiveOtps(user.restaurant_id),
        ]);
        return NextResponse.json({
          ok: true,
          data: { tables, pending, calls, kitchen, otps, user, serverNow: Date.now() },
        });
      }

      /** Codes for the board (polled / realtime refreshed). Staff only. */
      case 'codes': {
        return NextResponse.json({ ok: true, data: { otps: await listLiveOtps(user.restaurant_id) } });
      }

      case 'table': {
        const url = new URL(req.url);
        const tableId = uuidSchema.parse(url.searchParams.get('id'));
        const detail = await getTableDetail(user.restaurant_id, tableId);
        // Only the visit that is open right now. Without this, a table showed the orders of
        // every earlier party that had sat there (and nothing at all was "this session").
        const orders = detail.session
          ? await db.query<any>(
              `select o.*, 
                      (select coalesce(json_agg(json_build_object(
                         'name_snapshot', oi.name_snapshot, 'qty', oi.qty, 'notes', oi.notes,
                         'unit_price', oi.unit_price, 'added_by_guest', oi.added_by_guest)), '[]'::json)
                         from order_items oi where oi.order_id = o.id) as items
                 from orders o
                where o.restaurant_id = $1 and o.table_id = $2 and o.session_id = $3
                order by o.created_at desc limit 20`,
              [user.restaurant_id, tableId, detail.session.id],
            )
          : [];
        return NextResponse.json({ ok: true, data: { ...detail, fullOrders: orders } });
      }

      default:
        return jsonError('Unknown action', 404);
    }
  } catch (err) {
    return handleApiError(err);
  }
}

/** POST /api/waiter/[action] — confirm / reject / close session / handle call. */
export async function POST(req: Request, props: { params: Promise<{ action: string }> }) {
  const { action } = await props.params;
  try {
    assertSameOrigin(req);
    const user = await requireStaff(['waiter', 'admin']);

    switch (action) {
      case 'order': {
        const body = await parseBody(req, orderDecisionSchema);
        // waiters confirm/reject; kitchen transitions happen through /api/kitchen
        if (body.action !== 'confirm' && body.action !== 'reject') {
          return jsonError('Waiters can only confirm or reject orders.', 403);
        }
        if (body.action === 'reject' && !body.reason?.trim()) {
          return jsonError('Please give a reason for rejecting the order.', 422);
        }
        const result = await updateOrderStatus({
          restaurantId: user.restaurant_id,
          orderId: body.orderId,
          action: body.action,
          staffUserId: user.user_id,
          reason: body.reason,
        });

        const order = await db.one<{ table_id: string; session_id: string; total: number }>(
          `select table_id, session_id, total from orders where id = $1`,
          [body.orderId],
        );
        const table = order
          ? await db.one<{ number: number }>(`select number from tables where id = $1`, [order.table_id])
          : null;

        if (body.action === 'confirm') {
          await broadcast(user.restaurant_id, {
            type: 'order_status',
            tableNumber: table?.number,
            orderId: body.orderId,
            payload: { status: 'confirmed' },
          });
        } else {
          await auditLog({
            restaurantId: user.restaurant_id,
            actorId: user.user_id,
            actorEmail: user.email,
            action: 'order.reject',
            entity: 'orders',
            entityId: body.orderId,
            meta: { reason: body.reason, table: table?.number },
          });
          await broadcast(user.restaurant_id, {
            type: 'order_status',
            tableNumber: table?.number,
            orderId: body.orderId,
            payload: { status: 'rejected' },
          });
        }
        return NextResponse.json({ ok: true, data: result });
      }

      /**
       * G2 — "New party": the guests in front of the waiter are new people and the
       * old visit is still open. Closes it (orders stay in reports), kills its
       * codes and frees the table.
       *
       * This lives on the waiter API because waiters press the button; the admin
       * API keeps its own copy for the settings/tables screens.
       */
      case 'new-party': {
        const body = await parseBody(req, newPartySchema);
        const table = await db.one<{ id: string }>(
          `select id from tables where id = $1 and restaurant_id = $2`,
          [body.tableId, user.restaurant_id],
        );
        if (!table) return jsonError('Table not found.', 404);
        const result = await startNewParty(user.restaurant_id, body.tableId, {
          id: user.user_id,
          email: user.email,
        });
        return NextResponse.json({ ok: true, data: result });
      }

      /** "Not a real guest" — the code dies for every staff screen. */
      case 'otp-dismiss': {
        const body = await parseBody(req, otpDismissSchema);
        const result = await dismissOtp({
          restaurantId: user.restaurant_id,
          otpId: body.otpId,
          staffUserId: user.user_id,
          staffEmail: user.email,
          reason: body.reason,
        });
        if (!result.dismissed) return jsonError('That code is already closed.', 404);
        return NextResponse.json({ ok: true, data: result });
      }

      /** "New code" — explicitly staff-initiated, so the cooldown is ignored. */
      case 'otp-raise': {
        const body = await parseBody(req, otpRaiseSchema);
        const table = await db.one<{ id: string; number: number; label: string | null }>(
          `select id, number, label from tables where id = $1 and restaurant_id = $2 and is_active`,
          [body.tableId, user.restaurant_id],
        );
        if (!table) return jsonError('Table not found.', 404);
        const otp = await raiseOtp({
          restaurantId: user.restaurant_id,
          tableId: table.id,
          tableNumber: table.number,
          tableLabel: table.label,
          force: true,
          actor: { id: user.user_id, email: user.email },
        });
        return NextResponse.json({ ok: true, data: { otp } });
      }

      case 'call': {
        const body = await parseBody(req, z.object({ callId: uuidSchema }));
        await handleCall(user.restaurant_id, body.callId, user.user_id);
        return NextResponse.json({ ok: true, data: { handled: true } });
      }

      case 'close-session': {
        const body = await parseBody(req, closeSessionSchema);
        const row = await db.one<{ table_id: string }>(
          `select table_id from table_sessions where id = $1 and restaurant_id = $2`,
          [body.sessionId, user.restaurant_id],
        );
        if (!row) return jsonError('Session not found.', 404);
        await closeSession(body.sessionId, body.reason ?? `closed by ${user.full_name}`);
        // D5/G5: pending orders never reach the kitchen once the table is closed, and
        // the live code dies with the visit (E9).
        await invalidateOtpsForTable(row.table_id, 'table closed');
        await auditLog({
          restaurantId: user.restaurant_id,
          actorId: user.user_id,
          actorEmail: user.email,
          action: 'session.close',
          entity: 'table_sessions',
          entityId: body.sessionId,
          meta: { reason: body.reason },
        });
        await broadcast(user.restaurant_id, { type: 'order_status', payload: { sessionClosed: body.sessionId } });
        return NextResponse.json({ ok: true, data: { closed: true } });
      }

      default:
        return jsonError('Unknown action', 404);
    }
  } catch (err) {
    return handleApiError(err);
  }
}
