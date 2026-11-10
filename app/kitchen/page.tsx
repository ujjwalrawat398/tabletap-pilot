import { redirect } from 'next/navigation';
import { getStaffUser } from '@/server/auth';
import { getKitchenOrders } from '@/server/repos/orders';
import { getSettings } from '@/server/repos/service';
import { KitchenBoard } from '@/components/staff/KitchenBoard';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Kitchen' };

export default async function KitchenPage() {
  const user = await getStaffUser();
  if (!user) redirect('/staff/login');
  if (user.role === 'waiter') redirect('/waiter');

  const [orders, settings] = await Promise.all([
    getKitchenOrders(user.restaurant_id),
    getSettings(user.restaurant_id),
  ]);

  return <KitchenBoard user={user} initial={{ orders }} sounds={settings.sounds ?? {}} />;
}
