import { redirect } from 'next/navigation';
import { getStaffUser } from '@/server/auth';
import { getAdminMenu } from '@/server/repos/menu';
import { AdminMenu } from '@/components/admin/AdminMenu';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Menu & offers' };

export default async function MenuAdminPage() {
  const user = await getStaffUser();
  if (!user || user.role !== 'admin') redirect('/staff/login');
  const { categories, items } = await getAdminMenu(user.restaurant_id);

  return <AdminMenu user={user} categories={categories} items={items} />;
}
