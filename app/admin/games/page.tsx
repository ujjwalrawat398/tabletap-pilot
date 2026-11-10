import { redirect } from 'next/navigation';
import { getStaffUser } from '@/server/auth';
import { db } from '@/server/db';
import { getDailyLeaderboard, getGameSettings, listPrizes, listQuizQuestions } from '@/server/repos/games';
import { AdminGames } from '@/components/admin/AdminGames';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Games & prizes' };

export default async function GamesAdminPage() {
  const user = await getStaffUser();
  if (!user || user.role !== 'admin') redirect('/staff/login');

  const [categories, questions, prizes, leaderboard, gameSettings] = await Promise.all([
    db.query<any>(
      `select * from quiz_categories where restaurant_id = $1 order by sort_order`,
      [user.restaurant_id],
    ),
    listQuizQuestions(user.restaurant_id),
    listPrizes(user.restaurant_id),
    getDailyLeaderboard(user.restaurant_id),
    getGameSettings(user.restaurant_id),
  ]);

  return (
    <AdminGames
      user={user}
      categories={categories}
      questions={questions}
      prizes={prizes}
      leaderboard={leaderboard}
      showPrizes={gameSettings.showPrizes}
    />
  );
}
