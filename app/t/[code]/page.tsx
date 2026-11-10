import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { db } from '@/server/db';
import { findTableByCode } from '@/server/session';
import { CustomerProvider } from '@/components/customer/CustomerProvider';
import { TableHome } from '@/components/customer/TableHome';
import { TableCodeScreen } from '@/components/customer/TableCodeScreen';
import { getCustomerStateSafe } from '@/server/customer-state';
import { getOtpSettings } from '@/server/repos/otp';

export const dynamic = 'force-dynamic';
type Params = { params: Promise<{ code: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { code } = await params;
  const table = await findTableByCode(code);
  const name = table
    ? (await db.one<{ name: string }>(`select name from restaurants where id = $1`, [table.restaurant_id]))?.name
    : null;
  return {
    title: name ? `${name} · Table ${table?.number}` : 'Table ordering',
    description: name ? `Order at ${name} from your table` : undefined,
    robots: { index: false, follow: false },
  };
}

/**
 * The NFC/QR landing page.
 *
 * A scan grants nothing: it raises a table code for the waiter. Until this phone
 * enters that code the guest sees the code screen plus a read-only menu (D2);
 * after it, the normal table home.
 */
export default async function TablePage({ params }: Params) {
  const { code } = await params;

  const table = await findTableByCode(code);
  if (!table) notFound();

  const initial = await getCustomerStateSafe(code);
  if (!initial) notFound();

  if (initial.needs_code) {
    const otp = await getOtpSettings(table.restaurant_id);
    const staffOnline = await db.one<{ n: number }>(
      `select count(*)::int as n from staff_profiles
        where restaurant_id = $1 and is_active
          and last_seen_at > now() - interval '60 seconds'`,
      [table.restaurant_id],
    );
    return (
      <CustomerProvider tableCode={code} initial={initial}>
        <TableCodeScreen
          tableCode={code}
          tableNumber={table.number}
          restaurantName={initial.settings.restaurant_name}
          codeLength={otp.length}
          menuHref={`/t/${code}/menu`}
          phone={initial.settings.phone}
          staffOffline={(staffOnline?.n ?? 0) === 0}
          // no verified guest and no card yet ⇒ the page raises one on arrival
          awaitingWaiter={
            ((await db.one<{ n: number }>(
              `select count(*)::int as n from table_otps
                where table_id = $1 and invalidated_at is null
                  and expires_at > now() and verified_at is not null`,
              [table.id],
            ))?.n ?? 0) === 0
          }
          retryAfter={0}
        />
      </CustomerProvider>
    );
  }

  return (
    <CustomerProvider tableCode={code} initial={initial}>
      <TableHome
        tableNumber={table.number}
        tableLabel={table.label}
        restaurantName={initial.settings.restaurant_name}
        logoUrl={initial.settings.logo_url}
        accent={initial.settings.accent_color}
      />
    </CustomerProvider>
  );
}
