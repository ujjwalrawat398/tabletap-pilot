import { redirect } from 'next/navigation';
import { getStaffUser } from '@/server/auth';
import { getDashboardStats, getSalesReport } from '@/server/repos/reports';
import { getTableGrid } from '@/server/repos/service';
import { AdminOverview } from '@/components/admin/AdminOverview';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Overview' };

export default async function OverviewPage() {
  const user = await getStaffUser();
  if (!user || user.role !== 'admin') redirect('/staff/login');

  const today = new Date().toISOString().slice(0, 10);
  const [stats, tables, report] = await Promise.all([
    getDashboardStats(user.restaurant_id),
    getTableGrid(user.restaurant_id),
    getSalesReport(user.restaurant_id, today, today),
  ]);

  return <AdminOverview user={user} stats={stats} tables={tables} report={report} />;
}
