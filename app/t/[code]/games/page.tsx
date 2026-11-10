import { notFound, redirect } from 'next/navigation';
import { CustomerProvider } from '@/components/customer/CustomerProvider';
import { GamesLobby } from '@/components/customer/GamesLobby';
import { getCustomerStateForPage } from '@/server/customer-state';
import { findTableByCode, getGuestNo, requireSession } from '@/server/session';
import {
  getDailyLeaderboard,
  getRestaurantGameBanner,
  getQuizCategories,
  getTableRoundForLobby,
} from '@/server/repos/games';

export const dynamic = 'force-dynamic';

export default async function GamesPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  if (!(await findTableByCode(code))) notFound();

  const initial = await getCustomerStateForPage(code);
  if (!initial) redirect(`/t/${code}`);
  const session = await requireSession(code);

  const guestNo = await getGuestNo(code);
  const [categories, restaurantGame, leaderboard, tableRound] = await Promise.all([
    getQuizCategories(session.restaurant_id),
    getRestaurantGameBanner(session, guestNo).catch(() => null),
    getDailyLeaderboard(session.restaurant_id),
    getTableRoundForLobby(session, guestNo).catch(() => null),
  ]);

  return (
    <CustomerProvider tableCode={code} initial={initial}>
      <GamesLobby
        categories={categories}
        restaurantGame={restaurantGame}
        leaderboard={leaderboard}
        tableRound={tableRound}
      />
    </CustomerProvider>
  );
}
