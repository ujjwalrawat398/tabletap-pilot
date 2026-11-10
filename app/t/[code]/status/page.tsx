import { notFound, redirect } from 'next/navigation';
import { CustomerProvider } from '@/components/customer/CustomerProvider';
import { StatusScreen } from '@/components/customer/StatusScreen';
import { getCustomerStateForPage } from '@/server/customer-state';
import { findTableByCode } from '@/server/session';

export const dynamic = 'force-dynamic';

export default async function StatusPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  if (!(await findTableByCode(code))) notFound();
  const initial = await getCustomerStateForPage(code);
  if (!initial) redirect(`/t/${code}`);

  return (
    <CustomerProvider tableCode={code} initial={initial}>
      <StatusScreen />
    </CustomerProvider>
  );
}
