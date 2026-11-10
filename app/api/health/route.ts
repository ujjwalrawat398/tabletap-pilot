import { NextResponse } from 'next/server';
import { dbHealth } from '@/server/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  const health = await dbHealth();
  return NextResponse.json(
    { ok: health.ok, mode: health.mode, time: new Date().toISOString() },
    { status: health.ok ? 200 : 503 },
  );
}
