import { redirect } from 'next/navigation';
import { getStaffUser } from '@/server/auth';
import { getTablesWithCodes } from '@/server/repos/service';
import { AdminTables } from '@/components/admin/AdminTables';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Tables & QR codes' };

export default async function TablesAdminPage() {
  const user = await getStaffUser();
  if (!user || user.role !== 'admin') redirect('/staff/login');
  const tables = await getTablesWithCodes(user.restaurant_id);

  return <AdminTables user={user} tables={tables} appUrl={process.env.NEXT_PUBLIC_APP_URL ?? ''} />;
}
