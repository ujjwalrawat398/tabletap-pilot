import { redirect } from 'next/navigation';
import { getStaffUser } from '@/server/auth';
import { getSalesReport } from '@/server/repos/reports';
import { AdminReports } from '@/components/admin/AdminReports';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Sales reports' };

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const user = await getStaffUser();
  if (!user || user.role !== 'admin') redirect('/staff/login');

  const sp = await searchParams;
  const to = sp.to ?? new Date().toISOString().slice(0, 10);
  const from = sp.from ?? new Date(Date.now() - 6 * 86400_000).toISOString().slice(0, 10);
  const report = await getSalesReport(user.restaurant_id, from, to);

  return <AdminReports user={user} report={report} />;
}
