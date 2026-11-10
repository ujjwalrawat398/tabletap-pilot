import { notFound } from 'next/navigation';
import { findTableByCode, requireSession } from '@/server/session';
import { getRoundResults } from '@/server/repos/games';
import { ResultsScreen } from '@/components/customer/ResultsScreen';

export const dynamic = 'force-dynamic';

export default async function ResultsPage({
  params,
}: {
  params: Promise<{ code: string; roundId: string }>;
}) {
  const { code, roundId } = await params;
  if (!(await findTableByCode(code))) notFound();

  const session = await requireSession(code);
  const results = await getRoundResults(roundId, session.restaurant_id).catch(() => null);
  if (!results) notFound();

  return <ResultsScreen results={results} tableCode={code} />;
}
