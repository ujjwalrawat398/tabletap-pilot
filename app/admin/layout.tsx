import { redirect } from 'next/navigation';
import { getStaffUser } from '@/server/auth';

export const dynamic = 'force-dynamic';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getStaffUser();
  if (!user) redirect('/staff/login');
  if (user.role !== 'admin') redirect(user.role === 'kitchen' ? '/kitchen' : '/waiter');
  return <>{children}</>;
}
