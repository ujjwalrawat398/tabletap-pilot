import 'server-only';
import { NextResponse } from 'next/server';
import { requireStaff } from '@/server/auth';
import { getRestaurant, getTablesWithCodes } from '@/server/repos/service';
import { handleApiError } from '@/server/api';
import { env } from '@/lib/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Admin download of the printable QR sheet (spec §9 tables, deliverable #4). */
export async function GET(req: Request) {
  try {
    const user = await requireStaff(['admin']);
    const [restaurant, tables] = await Promise.all([
      getRestaurant(user.restaurant_id),
      getTablesWithCodes(user.restaurant_id),
    ]);

    const origin = new URL(req.url).origin;
    const appUrl = env.APP_URL && env.APP_URL !== 'http://localhost:3000' ? env.APP_URL : origin;

    const { buildTableQrPdf } = await import('@/lib/qr-pdf.mjs');
    const pdf: Buffer = await buildTableQrPdf({
      restaurantName: restaurant?.name ?? 'Menu',
      appUrl,
      tables: tables.map((t: any) => ({
        number: t.number,
        label: t.label,
        table_code: t.table_code,
      })),
    });

    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="table-qr-codes.pdf"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}
