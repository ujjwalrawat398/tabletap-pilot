import { redirect } from 'next/navigation';
import { getStaffUser } from '@/server/auth';
import { STAFF_HOME } from '@/lib/constants';

export const dynamic = 'force-dynamic';

export default async function StaffIndex() {
  const user = await getStaffUser();
  redirect(user ? STAFF_HOME[user.role] : '/staff/login');
}
