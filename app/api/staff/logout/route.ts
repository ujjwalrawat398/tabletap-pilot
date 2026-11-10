import 'server-only';
import { NextResponse } from 'next/server';
import { clearStaffCookie } from '@/server/auth';

export const runtime = 'nodejs';

export async function POST() {
  await clearStaffCookie();
  const res = NextResponse.json({ ok: true, data: { loggedOut: true } });
  res.cookies.delete('tt_sb_access');
  res.cookies.delete('tt_sb_refresh');
  return res;
}
