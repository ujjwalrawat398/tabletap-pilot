import { redirect } from 'next/navigation';
import { getStaffUser } from '@/server/auth';
import { listStaff } from '@/server/repos/staff';
import { listPendingRequests } from '@/server/repos/password-requests';
import { AdminStaff } from '@/components/admin/AdminStaff';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Staff accounts' };

export default async function StaffAdminPage() {
  const user = await getStaffUser();
  if (!user || user.role !== 'admin') redirect('/staff/login');
  const [staff, requests] = await Promise.all([
    listStaff(user.restaurant_id),
    listPendingRequests(user.restaurant_id),
  ]);

  return <AdminStaff user={user} staff={staff} requests={requests} />;
}
