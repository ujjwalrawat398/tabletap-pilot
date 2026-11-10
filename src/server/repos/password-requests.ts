import 'server-only';
import { db } from '@/server/db';
import { getSessionSecret } from '@/lib/env';
import { decryptSecret, encryptSecret } from '@/lib/crypto';
import { AuthError, auditLog, passwordProblem, resetStaffPassword } from '@/server/auth';

/**
 * Staff password changes that need an admin's approval.
 *
 * A waiter or kitchen account proves it knows its current password, picks a new one,
 * and the request waits here. The new password is stored encrypted (never plain, never
 * returned by any query below) and is wiped as soon as an admin decides.
 */
const PURPOSE = 'staff-password-request-v1';
const aadFor = (requestId: string, staffId: string) => `${requestId}:${staffId}`;

export type PasswordRequestSummary = {
  id: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled' | 'expired';
  requested_at: string;
  expires_at: string;
  decided_at: string | null;
  decision_note: string | null;
};

/** File a request. Any older pending request of the same person is replaced. */
export async function createPasswordRequest(input: {
  restaurantId: string;
  staffId: string;
  newPassword: string;
  ip?: string | null;
}) {
  const problem = passwordProblem(input.newPassword);
  if (problem) throw new AuthError(problem, 400);

  const id = crypto.randomUUID();
  const enc = encryptSecret(input.newPassword, getSessionSecret(), PURPOSE, aadFor(id, input.staffId));

  await db.query(
    `update staff_password_requests
        set status = 'cancelled', new_password_enc = null, decided_at = now(),
            decision_note = 'Replaced by a newer request'
      where staff_id = $1 and status = 'pending'`,
    [input.staffId],
  );
  const row = await db.one<PasswordRequestSummary>(
    `insert into staff_password_requests (id, restaurant_id, staff_id, new_password_enc, requested_from_ip)
     values ($1,$2,$3,$4,$5)
     returning id, status, requested_at, expires_at, decided_at, decision_note`,
    [id, input.restaurantId, input.staffId, enc, input.ip ?? null],
  );
  return row!;
}

/** The person's most recent request, so their screen can say "waiting / approved / rejected". */
export async function getMyLatestRequest(staffId: string): Promise<PasswordRequestSummary | null> {
  const row = await db.one<PasswordRequestSummary>(
    `select id, status, requested_at, expires_at, decided_at, decision_note
       from staff_password_requests
      where staff_id = $1
      order by requested_at desc
      limit 1`,
    [staffId],
  );
  if (row && row.status === 'pending' && new Date(row.expires_at).getTime() <= Date.now()) {
    return { ...row, status: 'expired' };
  }
  return row;
}

export async function cancelMyRequest(staffId: string) {
  const rows = await db.query(
    `update staff_password_requests
        set status = 'cancelled', new_password_enc = null, decided_at = now()
      where staff_id = $1 and status = 'pending'
      returning id`,
    [staffId],
  );
  return rows.length > 0;
}

/** Open requests for the admin screen. The encrypted password is deliberately not selected. */
export async function listPendingRequests(restaurantId: string) {
  return db.query<{
    id: string;
    staff_id: string;
    full_name: string;
    email: string;
    role: string;
    requested_at: string;
    expires_at: string;
  }>(
    `select r.id, r.staff_id, p.full_name, p.email, p.role, r.requested_at, r.expires_at
       from staff_password_requests r
       join staff_profiles p on p.id = r.staff_id
      where r.restaurant_id = $1 and r.status = 'pending' and r.expires_at > now()
      order by r.requested_at`,
    [restaurantId],
  );
}

/**
 * Approve or reject. The row is claimed atomically first (`where status = 'pending'`),
 * so two admins pressing the button at once get one success and one 409.
 */
export async function decidePasswordRequest(input: {
  restaurantId: string;
  requestId: string;
  approve: boolean;
  note?: string;
  admin: { id: string; user_id: string; email: string };
}) {
  const claimed = await db.one<{ staff_id: string; new_password_enc: string | null; expires_at: string }>(
    `update staff_password_requests
        set status = $3, decided_at = now(), decided_by = $4, decision_note = $5
      where id = $1 and restaurant_id = $2 and status = 'pending'
      returning staff_id, new_password_enc, expires_at`,
    [
      input.requestId,
      input.restaurantId,
      input.approve ? 'approved' : 'rejected',
      input.admin.id,
      input.note?.trim() || null,
    ],
  );
  if (!claimed) throw new AuthError('That request is no longer open.', 409);

  const wipe = () =>
    db.query(`update staff_password_requests set new_password_enc = null where id = $1`, [input.requestId]);

  if (!input.approve) {
    await wipe();
    await auditLog({
      restaurantId: input.restaurantId,
      actorId: input.admin.user_id,
      actorEmail: input.admin.email,
      action: 'staff.password.reject',
      entity: 'staff_profiles',
      entityId: claimed.staff_id,
    });
    return { staffId: claimed.staff_id, approved: false };
  }

  // put the row back to "pending" (nothing was changed) or close it as rejected with a reason
  const reopen = () =>
    db.query(
      `update staff_password_requests
          set status = 'pending', decided_at = null, decided_by = null, decision_note = null
        where id = $1`,
      [input.requestId],
    );
  const rejectWith = (note: string) =>
    db.query(`update staff_password_requests set status = 'rejected', decision_note = $2 where id = $1`, [
      input.requestId,
      note,
    ]);

  if (new Date(claimed.expires_at).getTime() <= Date.now()) {
    await rejectWith('Expired before it was approved');
    await wipe();
    throw new AuthError('That request has expired. Ask them to send a new one.', 410);
  }

  const password = claimed.new_password_enc
    ? decryptSecret(claimed.new_password_enc, getSessionSecret(), PURPOSE, aadFor(input.requestId, claimed.staff_id))
    : null;
  if (!password) {
    await rejectWith('Could not be read — send a new request');
    await wipe();
    throw new AuthError('That request could not be read. Ask them to send a new one.', 409);
  }

  try {
    await resetStaffPassword(claimed.staff_id, input.restaurantId, password, { mustReset: false });
  } catch (err) {
    await reopen(); // nothing changed — leave it open so the admin can retry
    throw err;
  }

  await wipe();
  await auditLog({
    restaurantId: input.restaurantId,
    actorId: input.admin.user_id,
    actorEmail: input.admin.email,
    action: 'staff.password.approve',
    entity: 'staff_profiles',
    entityId: claimed.staff_id,
  });
  return { staffId: claimed.staff_id, approved: true };
}
