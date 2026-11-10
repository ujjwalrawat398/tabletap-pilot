import 'server-only';
import { NextResponse } from 'next/server';
import { assertSameOrigin, clientIp, handleApiError, parseBody } from '@/server/api';
import {
  AuthError,
  auditLog,
  checkCurrentPassword,
  passwordProblem,
  requireStaff,
  resetStaffPassword,
} from '@/server/auth';
import { changePasswordSchema } from '@/lib/validation';
import {
  cancelMyRequest,
  createPasswordRequest,
  getMyLatestRequest,
} from '@/server/repos/password-requests';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Changing your own staff password.
 *
 *   admin           -> changes it straight away (after proving the current password)
 *   waiter, kitchen -> files a request; an admin must approve it (Admin → Staff)
 */

/** GET — where does my latest request stand? */
export async function GET() {
  try {
    const user = await requireStaff();
    return NextResponse.json({
      ok: true,
      data: {
        needsApproval: user.role !== 'admin',
        request: user.role === 'admin' ? null : await getMyLatestRequest(user.id),
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}

/** POST — { currentPassword, newPassword } */
export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    const user = await requireStaff();
    const body = await parseBody(req, changePasswordSchema);

    const problem = passwordProblem(body.newPassword);
    if (problem) throw new AuthError(problem, 400);
    await checkCurrentPassword(user, body.currentPassword);
    if (body.newPassword === body.currentPassword) {
      throw new AuthError('Choose a password different from your current one.', 400);
    }

    if (user.role === 'admin') {
      await resetStaffPassword(user.id, user.restaurant_id, body.newPassword, { mustReset: false });
      await auditLog({
        restaurantId: user.restaurant_id,
        actorId: user.user_id,
        actorEmail: user.email,
        action: 'staff.password.change',
        entity: 'staff_profiles',
        entityId: user.id,
      });
      return NextResponse.json({ ok: true, data: { applied: true, pending: false } });
    }

    const request = await createPasswordRequest({
      restaurantId: user.restaurant_id,
      staffId: user.id,
      newPassword: body.newPassword,
      ip: clientIp(req),
    });
    await auditLog({
      restaurantId: user.restaurant_id,
      actorId: user.user_id,
      actorEmail: user.email,
      action: 'staff.password.request',
      entity: 'staff_profiles',
      entityId: user.id,
    });
    return NextResponse.json({ ok: true, data: { applied: false, pending: true, request } });
  } catch (err) {
    return handleApiError(err);
  }
}

/** DELETE — withdraw my pending request */
export async function DELETE(req: Request) {
  try {
    assertSameOrigin(req);
    const user = await requireStaff();
    const cancelled = await cancelMyRequest(user.id);
    return NextResponse.json({ ok: true, data: { cancelled } });
  } catch (err) {
    return handleApiError(err);
  }
}
