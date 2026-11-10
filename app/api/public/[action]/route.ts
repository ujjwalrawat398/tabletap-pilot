import 'server-only';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/server/db';
import { getCustomerState, getPublicSettings } from '@/server/customer-state';
import { assertSameOrigin, clientIp, handleApiError, parseBody } from '@/server/api';
import { rateLimit } from '@/server/auth';
import { findTableByCode, getGuestNo, requireSession, SessionError } from '@/server/session';
import { getMenu } from '@/server/repos/menu';
import { addToCart, getCart, removeCartItem, updateCartQty } from '@/server/repos/cart';
import { getSessionOrders, sendOrder } from '@/server/repos/orders';
import { createFeedback, createReview, getReviewForSession, raiseWaiterCall } from '@/server/repos/service';
import { broadcast } from '@/server/repos/events';
import { sendPushToStaff } from '@/server/repos/events';
import {
  cartAddSchema,
  cartRemoveSchema,
  cartUpdateSchema,
  feedbackSchema,
  reviewSchema,
  sendOrderSchema,
  verifyOtpSchema,
  waiterCallSchema,
} from '@/lib/validation';
import { OTP_VERIFY_RATE_LIMIT, SCAN_RATE_LIMIT, SESSION_TTL_HOURS } from '@/lib/constants';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Customer API. Customers have no database access at all — every read/write
 * goes through these validated endpoints authenticated by the session cookie
 * (spec §14). POST + GET split by action so one file covers the whole surface.
 */

const ctxSchema = z.object({ table_code: z.string().min(6).max(64) });
type Ctx = z.infer<typeof ctxSchema>;

function badTable() {
  return NextResponse.json(
    { ok: false, error: 'This table link is not valid. Please ask a waiter to help.', code: 'TABLE_INVALID' },
    { status: 404 },
  );
}

// ----------------------------------------------------------------- GET
export async function GET(req: Request, props: { params: Promise<{ action: string }> }) {
  const { params } = props;
  const { action } = await params;
  const url = new URL(req.url);
  const tableCode = url.searchParams.get('t') ?? '';

  try {
    switch (action) {
      case 'menu': {
        const parsed = ctxSchema.safeParse({ table_code: tableCode });
        if (!parsed.success) return badTable();
        const table = await findTableByCode(parsed.data.table_code);
        if (!table) return badTable();
        // reading the menu needs no code (D2); ordering does
        const menu = await getMenu(table.restaurant_id);
        return NextResponse.json({ ok: true, data: { menu } });
      }

      case 'state': {
        if (!ctxSchema.safeParse({ table_code: tableCode }).success) return badTable();
        const { getCustomerStateSafe } = await import('@/server/customer-state');
        const state = await getCustomerStateSafe(tableCode);
        if (!state) return badTable();
        // needs_code:true means "no session yet" — the client shows the code screen.
        return NextResponse.json({ ok: true, data: state });
      }

      case 'home': {
        if (!ctxSchema.safeParse({ table_code: tableCode }).success) return badTable();
        const table = await findTableByCode(tableCode);
        if (!table) return badTable();
        const settings = await getPublicSettings(table.restaurant_id);
        return NextResponse.json({
          ok: true,
          data: {
            table: { number: table.number, label: table.label, code: table.table_code },
            settings,
          },
        });
      }

      default:
        return NextResponse.json({ ok: false, error: 'Unknown action' }, { status: 404 });
    }
  } catch (err) {
    return handleApiError(err);
  }
}

// ----------------------------------------------------------------- POST
const startSchema = z.object({ table_code: z.string().min(6).max(64), create: z.boolean().optional() });

export async function POST(req: Request, props: { params: Promise<{ action: string }> }) {
  const { params } = props;
  const { action } = await params;

  try {
    assertSameOrigin(req);

    switch (action) {
      /** Called by /t/[code] bootstrap: create a fresh session for this device. */
      case 'session': {
        const body = await parseBody(req, startSchema);
        // Scanning only raises a code now; it never grants a session. Still rate
        // limited per IP — all guests on the restaurant Wi-Fi share one IP, so the
        // window is deliberately generous (120 / 10 min).
        const limited = await rateLimit(
          `scan:${clientIp(req)}`,
          SCAN_RATE_LIMIT.attempts,
          SCAN_RATE_LIMIT.windowSeconds,
        );
        if (!limited.ok) {
          return NextResponse.json(
            { ok: false, error: 'Too many requests. Please wait a moment and try again.' },
            { status: 429, headers: { 'retry-after': String(limited.retryAfter) } },
          );
        }
        const { ensureSessionForScan } = await import('@/server/session-scan');
        const result = await ensureSessionForScan(body.table_code, { ip: clientIp(req) });
        if (!result) return badTable();
        // The scan response never contains the code, the Wi-Fi password or any
        // private setting (F4).
        return NextResponse.json({ ok: true, data: result });
      }

      case 'verify-otp': {
        const body = await parseBody(req, verifyOtpSchema);
        const limited = await rateLimit(
          `otp:${clientIp(req)}`,
          OTP_VERIFY_RATE_LIMIT.attempts,
          OTP_VERIFY_RATE_LIMIT.windowSeconds,
        );
        if (!limited.ok) {
          return NextResponse.json(
            { ok: false, error: 'Too many attempts. Please wait a few minutes.' },
            { status: 429, headers: { 'retry-after': String(limited.retryAfter) } },
          );
        }
        const { verifyTableCode } = await import('@/server/session-scan');
        const outcome = await verifyTableCode(body.table_code, body.code, { ip: clientIp(req) });
        if (outcome.ok) {
          const state = await getCustomerState(body.table_code);
          return NextResponse.json({
            ok: true,
            data: { verified: true, guest_no: outcome.guestNo, joined: outcome.joined, state },
          });
        }
        // A wrong code is a 200 with a machine-readable reason: the guest screen
        // needs to show the attempt counter, not a generic error page.
        const status = outcome.reason === 'DEVICE_CAP' ? 409 : 200;
        return NextResponse.json(
          {
            ok: false,
            error: outcome.message,
            code: outcome.reason,
            attemptsLeft: outcome.attemptsLeft,
            canAskAgain: outcome.canAskAgain,
          },
          { status },
        );
      }

      case 'wifi': {
        // The password is only returned to a device that holds a live session.
        const body = await parseBody(req, startSchema);
        const { getWifiCard } = await import('@/server/session-scan');
        const card = await getWifiCard(body.table_code);
        if (!card) return NextResponse.json({ ok: false, error: 'No session' }, { status: 401 });
        return NextResponse.json({ ok: true, data: card });
      }

      case 'cart': {
        const body = await parseBody(
          req,
          z.object({
            table_code: z.string().min(6).max(64),
            op: z.enum(['add', 'qty', 'remove', 'clear']),
            payload: z.unknown(),
          }),
        );
        const session = await requireSession(body.table_code);

        if (body.op === 'add') {
          const input = cartAddSchema.parse(body.payload);
          const guestNo = await getGuestNo(body.table_code);
          const cart = await addToCart(session.id, session.restaurant_id, input, guestNo);
          await notifyCartChanged(session, guestNo);
          return NextResponse.json({ ok: true, data: { cart } });
        }
        if (body.op === 'qty') {
          const input = cartUpdateSchema.parse(body.payload);
          const cart = await updateCartQty(session.id, input.cartItemId, input.qty);
          return NextResponse.json({ ok: true, data: { cart } });
        }
        if (body.op === 'remove') {
          const input = cartRemoveSchema.parse(body.payload);
          const cart = await removeCartItem(session.id, input.cartItemId);
          return NextResponse.json({ ok: true, data: { cart } });
        }
        const { clearCart } = await import('@/server/repos/cart');
        const cart = await clearCart(session.id, session.restaurant_id);
        return NextResponse.json({ ok: true, data: { cart } });
      }

      case 'order': {
        const body = await parseBody(
          req,
          z.object({ table_code: z.string().min(6).max(64), payload: sendOrderSchema }),
        );
        const session = await requireSession(body.table_code);
        const guestNo = await getGuestNo(body.table_code);
        const orderId = await sendOrder(session, guestNo, body.payload.notes);
        const orders = await getSessionOrders(session.id);

        // staff devices hear this immediately
        await broadcast(session.restaurant_id, {
          type: 'new_order',
          tableNumber: session.table_number,
          orderId,
        });
        await sendPushToStaff(session.restaurant_id, {
          event: 'new_order',
          title: `New order · Table ${session.table_number}`,
          body: 'Tap to confirm the order.',
          url: '/waiter',
          tag: `order-${orderId}`,
        });

        return NextResponse.json({ ok: true, data: { orderId, orders } });
      }

      case 'call': {
        const body = await parseBody(
          req,
          z.object({ table_code: z.string().min(6).max(64), payload: waiterCallSchema }),
        );
        const session = await requireSession(body.table_code);
        const callId = await raiseWaiterCall({
          restaurantId: session.restaurant_id,
          tableId: session.table_id,
          sessionId: session.id,
          type: body.payload.type,
        });
        const isBill = body.payload.type === 'bill';
        await broadcast(session.restaurant_id, {
          type: isBill ? 'bill_request' : 'waiter_call',
          tableNumber: session.table_number,
        });
        await sendPushToStaff(session.restaurant_id, {
          event: isBill ? 'bill_request' : 'waiter_call',
          title: isBill ? `Bill requested · Table ${session.table_number}` : `Calling waiter · Table ${session.table_number}`,
          body: isBill ? 'A guest asked for the bill.' : 'A guest needs help.',
          url: '/waiter',
          tag: `call-${callId}`,
        });
        return NextResponse.json({ ok: true, data: { callId } });
      }

      case 'review': {
        const body = await parseBody(
          req,
          z.object({ table_code: z.string().min(6).max(64), payload: reviewSchema }),
        );
        const session = await requireSession(body.table_code);
        await createReview({
          restaurantId: session.restaurant_id,
          sessionId: session.id,
          tableId: session.table_id,
          rating: body.payload.rating,
          routedTo: body.payload.routedTo,
        });
        return NextResponse.json({ ok: true, data: { saved: true } });
      }

      case 'feedback': {
        const body = await parseBody(
          req,
          z.object({ table_code: z.string().min(6).max(64), payload: feedbackSchema }),
        );
        const session = await requireSession(body.table_code);
        const id = await createFeedback({
          restaurantId: session.restaurant_id,
          sessionId: session.id,
          tableId: session.table_id,
          rating: body.payload.rating,
          message: body.payload.message,
          contact: body.payload.contact,
        });
        await broadcast(session.restaurant_id, {
          type: 'order_status',
          tableNumber: session.table_number,
          payload: { feedback: true },
        });
        return NextResponse.json({ ok: true, data: { id } });
      }

      default:
        return NextResponse.json({ ok: false, error: 'Unknown action' }, { status: 404 });
    }
  } catch (err) {
    if (err instanceof SessionError) return handleApiError(err);
    return handleApiError(err);
  }
}

/** Guests see each other's cart live: ping staff-free realtime channel list. */
async function notifyCartChanged(session: { restaurant_id: string; table_number: number }, guestNo: number) {
  await broadcast(session.restaurant_id, {
    type: 'order_status',
    tableNumber: session.table_number,
    payload: { cart: true, guest: guestNo },
  });
}
