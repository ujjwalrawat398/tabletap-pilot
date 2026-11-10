import { redirect } from 'next/navigation';
import { getStaffUser } from '@/server/auth';
import { getFeedback } from '@/server/repos/service';
import { AdminFeedback } from '@/components/admin/AdminFeedback';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Private feedback' };

export default async function FeedbackAdminPage() {
  const user = await getStaffUser();
  if (!user || user.role !== 'admin') redirect('/staff/login');
  const feedback = await getFeedback(user.restaurant_id);

  return <AdminFeedback user={user} feedback={feedback} />;
}
