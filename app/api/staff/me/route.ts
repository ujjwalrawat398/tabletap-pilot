import 'server-only';
import { NextResponse } from 'next/server';
import { getStaffUser } from '@/server/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await getStaffUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });
  return NextResponse.json({ ok: true, data: { user } });
}
