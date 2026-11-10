import { notFound, redirect } from 'next/navigation';
import { CustomerProvider } from '@/components/customer/CustomerProvider';
import { MenuScreen } from '@/components/customer/MenuScreen';
import { cookies } from 'next/headers';
import { getCustomerStateSafe, getMenuForCode } from '@/server/customer-state';
import { findTableByCode } from '@/server/session';

export const dynamic = 'force-dynamic';

export default async function MenuPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const table = await findTableByCode(code);
  if (!table) notFound();

  // No code entered yet? Render the read-only preview (D2) instead of bouncing the
  // guest back to the landing page — the banner explains that the code is needed.
  // A phone that WAS inside and lost its session (waiter closed the table, idle,
  // hard cap) goes to the landing page instead, where the code screen explains why.
  const initial = await getCustomerStateSafe(code);
  if (!initial) redirect(`/t/${code}`);
  if (initial.needs_code) {
    const jar = await cookies();
    if (jar.get('tt_session')?.value) redirect(`/t/${code}`);
  }
  const menu = await getMenuForCode(code);

  return (
    <CustomerProvider tableCode={code} initial={initial}>
      <MenuScreen menu={menu} tableNumber={initial.session.table_number} />
    </CustomerProvider>
  );
}
