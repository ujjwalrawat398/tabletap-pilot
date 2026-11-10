import { redirect } from 'next/navigation';
import { getStaffUser } from '@/server/auth';
import { getOpenCalls, getSettings, getTableGrid } from '@/server/repos/service';
import { getKitchenOrders, getPendingOrders } from '@/server/repos/orders';
import { listLiveOtps } from '@/server/repos/otp';
import { WaiterBoard, type StaffOtpCard } from '@/components/staff/WaiterBoard';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Waiter board' };

export default async function WaiterPage() {
  const user = await getStaffUser();
  if (!user) redirect('/staff/login');
  if (user.role === 'kitchen') redirect('/kitchen');

  const [tables, pending, calls, kitchen, settings, otps] = await Promise.all([
    getTableGrid(user.restaurant_id),
    getPendingOrders(user.restaurant_id),
    getOpenCalls(user.restaurant_id),
    getKitchenOrders(user.restaurant_id),
    getSettings(user.restaurant_id),
    listLiveOtps(user.restaurant_id),
  ]);

  return (
    <WaiterBoard
      user={user}
      initial={{ tables, pending, calls, kitchen, otps: otps as unknown as StaffOtpCard[] }}
      sounds={settings.sounds ?? {}}
    />
  );
}
