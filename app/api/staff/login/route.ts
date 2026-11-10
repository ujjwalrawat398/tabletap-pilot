import 'server-only';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin, clientIp, handleApiError, jsonError, parseBody } from '@/server/api';
import { loginStaff } from '@/server/auth';
import { STAFF_HOME } from '@/lib/constants';
import { loginSchema } from '@/lib/validation';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    const body = await parseBody(req, loginSchema);
    const result = await loginStaff(body.email, body.password, clientIp(req));
    if (!result.ok) return jsonError(result.error, result.status ?? 401);

    // pass Supabase tokens to the browser so the staff client can open a
    // realtime socket under RLS (see StaffRealtime). Absent in local mode.
    if (result.session) {
      const res = NextResponse.json({
        ok: true,
        data: { role: result.user.role, redirect: STAFF_HOME[result.user.role], user: result.user },
      });
      res.cookies.set('tt_sb_access', result.session.access_token, {
        httpOnly: false,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
        maxAge: 3600,
      });
      res.cookies.set('tt_sb_refresh', result.session.refresh_token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
        maxAge: 60 * 60 * 24 * 7,
      });
      return res;
    }

    return NextResponse.json({
      ok: true,
      data: { role: result.user.role, redirect: STAFF_HOME[result.user.role], user: result.user },
    });
  } catch (err) {
    return handleApiError(err);
  }
}
