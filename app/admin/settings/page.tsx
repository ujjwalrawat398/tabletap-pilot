import { redirect } from 'next/navigation';
import { getStaffUser } from '@/server/auth';
import { getRestaurant, getSettings } from '@/server/repos/service';
import { AdminSettings } from '@/components/admin/AdminSettings';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Restaurant settings' };

export default async function SettingsAdminPage() {
  const user = await getStaffUser();
  if (!user || user.role !== 'admin') redirect('/staff/login');

  const [restaurant, settings] = await Promise.all([
    getRestaurant(user.restaurant_id),
    getSettings(user.restaurant_id),
  ]);

  return <AdminSettings user={user} restaurant={restaurant} settings={settings} />;
}
