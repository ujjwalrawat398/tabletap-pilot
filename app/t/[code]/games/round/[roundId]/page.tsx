import { notFound, redirect } from 'next/navigation';
import { findTableByCode, requireSession, getGuestNo } from '@/server/session';
import { getRoundState } from '@/server/repos/games';
import { QuizRound } from '@/components/customer/QuizRound';
import { SyncQuizRound } from '@/components/customer/SyncQuizRound';

export const dynamic = 'force-dynamic';

export default async function RoundPage({
  params,
}: {
  params: Promise<{ code: string; roundId: string }>;
}) {
  const { code, roundId } = await params;
  if (!(await findTableByCode(code))) notFound();

  const session = await requireSession(code);
  const guestNo = await getGuestNo(code);
  const state = await getRoundState({
    roundId,
    restaurantId: session.restaurant_id,
    sessionId: session.id,
    guestNo,
  }).catch(() => null);

  if (!state) redirect(`/t/${code}/games`);

  // solo: your own pace. Table / whole restaurant: everyone on the server's clock.
  if (state.round.mode === 'solo') return <QuizRound initialState={state} tableCode={code} />;
  return <SyncQuizRound initialState={state} tableCode={code} />;
}
