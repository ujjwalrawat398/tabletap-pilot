'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCustomer } from '@/components/customer/CustomerProvider';
import { useT } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { SYNC_QUESTION_SECONDS } from '@/lib/constants';
import type { RestaurantGameInfo } from '@/types';
import { ArrowLeft, Loader2, Medal, Shuffle, Sparkles, Timer, Trophy, Users, Zap } from 'lucide-react';

type Category = { id: string; name: string; emoji: string | null; question_count: number };
type TableRound = { id: string; startsAt: string; status: 'lobby' | 'active'; joined: boolean; players: number } | null;
type Leaderboard = {
  date: string;
  pointsMode: 'sum' | 'average';
  rows: { rank: number; tableNumber: number; points: number; prize: { title: string } | null }[];
};

export function GamesLobby({
  categories,
  restaurantGame: initialGame,
  leaderboard: initialLeaderboard,
  tableRound: initialTableRound,
}: {
  categories: Category[];
  restaurantGame: RestaurantGameInfo;
  leaderboard: Leaderboard;
  tableRound: TableRound;
}) {
  const { t } = useT();
  const { tableCode } = useCustomer();
  const router = useRouter();
  const { push } = useToast();
  const [categoryId, setCategoryId] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [game, setGame] = React.useState<RestaurantGameInfo>(initialGame);
  const [now, setNow] = React.useState(() => Date.now());
  const [leaderboard, setLeaderboard] = React.useState<Leaderboard>(initialLeaderboard);
  const [tableRound, setTableRound] = React.useState<TableRound>(initialTableRound);
  const [tableLeft, setTableLeft] = React.useState(0);

  // keep the next-round countdown, the leaderboard and "your table started a game" fresh
  React.useEffect(() => {
    let alive = true;
    const refresh = async () => {
      try {
        const d = await api.get<{ restaurantGame: RestaurantGameInfo; leaderboard: Leaderboard; tableRound: TableRound }>(
          `/api/public/games/lobby?t=${encodeURIComponent(tableCode)}`,
        );
        if (!alive) return;
        setGame(d.restaurantGame);
        setLeaderboard(d.leaderboard);
        setTableRound(d.tableRound);
      } catch {
        /* keep what is on screen */
      }
    };
    // quick while a game is on (a table game or the restaurant game), slow otherwise
    const busyNow = Boolean(game) || Boolean(tableRound);
    const timer = setInterval(refresh, busyNow ? 4000 : 12000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [tableCode, Boolean(game), Boolean(tableRound)]); // eslint-disable-line react-hooks/exhaustive-deps

  React.useEffect(() => {
    if (!tableRound || tableRound.status !== 'lobby') return;
    const tick = () =>
      setTableLeft(Math.max(0, Math.ceil((new Date(tableRound.startsAt).getTime() - Date.now()) / 1000)));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [tableRound]);

  // the restaurant game's clock: the server's time, not this phone's
  const offset = React.useMemo(
    () => (game ? new Date(game.serverNow).getTime() - Date.now() : 0),
    [game?.serverNow, game?.id], // eslint-disable-line react-hooks/exhaustive-deps
  );
  React.useEffect(() => {
    if (!game) return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [game?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function start(mode: 'solo' | 'table' | 'restaurant') {
    setBusy(mode);
    try {
      const res = await api.post<{ roundId: string }>('/api/public/games/start', {
        table_code: tableCode,
        payload: { mode, categoryId },
      });
      router.push(`/t/${tableCode}/games/round/${res.roundId}`);
    } catch (err) {
      push(err instanceof Error ? err.message : 'Could not start the game', 'error');
      setBusy(null);
    }
  }

  const secsTo = (iso: string) => Math.max(0, Math.ceil((new Date(iso).getTime() - (now + offset)) / 1000));
  const mmss = (n: number) => `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
  const canJoinGame = Boolean(game) && game!.phase === 'join' && !game!.joined && !game!.left && !game!.tableFull;
  const canOpenGame = Boolean(game) && game!.joined;

  return (
    <div className="min-h-dvh pb-24">
      <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-border bg-background/95 p-3 backdrop-blur">
        <Link href={`/t/${tableCode}`} className="tap rounded-full hover:bg-secondary" aria-label="Back">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-base font-bold">{t.playGames}</h1>
      </header>

      <main className="space-y-4 p-4">
        {/* category picker */}
        <section>
          <h2 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Category</h2>
          <div className="no-scrollbar -mx-1 mt-2 flex gap-2 overflow-x-auto px-1 pb-1">
            <button
              type="button"
              onClick={() => setCategoryId(null)}
              className={cn(
                'tap flex shrink-0 items-center gap-1.5 rounded-xl border-2 px-3 text-sm font-semibold',
                categoryId === null ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-card',
              )}
            >
              <Shuffle className="h-3.5 w-3.5" aria-hidden /> Mixed
            </button>
            {categories.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setCategoryId(c.id)}
                className={cn(
                  'tap flex shrink-0 items-center gap-1.5 rounded-xl border-2 px-3 text-sm font-semibold',
                  categoryId === c.id ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-card',
                )}
              >
                <span className="text-base leading-none" aria-hidden>
                  {c.emoji ?? '🏆'}
                </span>
                {c.name}
                <span className="text-[10px] font-normal text-muted-foreground">
                  {c.question_count}
                </span>
              </button>
            ))}
          </div>
        </section>

        {/* modes */}
        <section className="space-y-3">
          <button
            type="button"
            onClick={() => start('solo')}
            disabled={Boolean(busy)}
            className="w-full rounded-2xl border border-border bg-card p-4 text-left shadow-soft transition active:scale-[.99] disabled:opacity-60"
          >
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent text-accent-foreground">
                <Sparkles className="h-5 w-5" />
              </span>
              <div className="flex-1">
                <p className="font-bold">{t.solo}</p>
                <p className="text-xs text-muted-foreground">10 questions · your own pace</p>
              </div>
              {busy === 'solo' ? <Loader2 className="h-5 w-5 animate-spin" /> : <Zap className="h-6 w-6 text-primary" aria-hidden />}
            </div>
          </button>

          <button
            type="button"
            onClick={() => start('table')}
            disabled={Boolean(busy)}
            className="w-full rounded-2xl border border-border bg-card p-4 text-left shadow-soft transition active:scale-[.99] disabled:opacity-60"
          >
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent text-accent-foreground">
                <Users className="h-5 w-5" />
              </span>
              <div className="flex-1">
                <p className="font-bold">{t.withTable}</p>
                <p className="text-xs text-muted-foreground">
                  Everyone at your table · same 10 questions · {SYNC_QUESTION_SECONDS}s each
                </p>
                {tableRound && (tableRound.status === 'lobby' || tableRound.joined) && (
                  <p className="mt-1 text-xs font-semibold text-primary">
                    {tableRound.joined
                      ? 'You are in this game — tap to open it'
                      : `Your table started a game · ${tableRound.players} joined · tap to join (${tableLeft}s left)`}
                  </p>
                )}
              </div>
              {busy === 'table' ? <Loader2 className="h-5 w-5 animate-spin" /> : <Users className="h-6 w-6 text-primary" aria-hidden />}
            </div>
          </button>

          <div className="rounded-2xl border border-border bg-card p-4 shadow-soft">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent text-accent-foreground">
                <Timer className="h-5 w-5" />
              </span>
              <div className="flex-1">
                <p className="font-bold">{t.wholeRestaurant}</p>
                <p className="text-xs text-muted-foreground">
                  {!game
                    ? 'No game right now · the admin starts it'
                    : game.joined
                      ? game.phase === 'live'
                        ? 'You are in · the game is on'
                        : `You are in · starts in ${mmss(secsTo(game.startsAt))}`
                      : game.left
                        ? 'You left this game'
                        : game.phase === 'join'
                          ? game.tableFull
                            ? 'Your table already has 2 players'
                            : `Starts in ${mmss(secsTo(game.startsAt))} · ${SYNC_QUESTION_SECONDS}s per question · max 2 per table`
                          : game.phase === 'rules'
                            ? 'Joining closed · starting now'
                            : 'Game in progress · join the next one'}
                </p>
              </div>
              <Button
                size="sm"
                onClick={() =>
                  canOpenGame ? router.push(`/t/${tableCode}/games/round/${game!.id}`) : start('restaurant')
                }
                loading={busy === 'restaurant'}
                disabled={!canJoinGame && !canOpenGame}
              >
                {canOpenGame ? 'Open' : canJoinGame ? t.joinNow : 'Closed'}
              </Button>
            </div>
          </div>
        </section>

        {/* leaderboard */}
        <section className="rounded-2xl border border-border bg-card p-4 shadow-soft">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-bold">
              <Trophy className="h-4 w-4 text-amber-500" /> {t.leaderboard}
            </h2>
            <Badge variant="muted" className="text-[10px]">
              {leaderboard.pointsMode === 'average' ? 'avg points' : 'total points'}
            </Badge>
          </div>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Resets at midnight · {leaderboard.date}
          </p>

          {leaderboard.rows.length === 0 ? (
            <p className="mt-3 rounded-lg bg-secondary p-3 text-xs text-muted-foreground">
              No restaurant rounds played yet today. Be the first table on the board!
            </p>
          ) : (
            <ol className="mt-3 space-y-1.5">
              {leaderboard.rows.slice(0, 8).map((row) => (
                <li
                  key={row.tableNumber}
                  className={cn(
                    'flex items-center gap-3 rounded-xl px-3 py-2 text-sm',
                    row.rank === 1 ? 'bg-amber-50 dark:bg-amber-500/10' : 'bg-secondary/60',
                  )}
                >
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-card text-xs font-bold">
                    {row.rank <= 3 ? ['🥇', '🥈', '🥉'][row.rank - 1] : row.rank}
                  </span>
                  <span className="flex-1 font-medium">{t.table} {row.tableNumber}</span>
                  {row.prize && (
                    <span className="hidden items-center gap-1 text-[11px] font-semibold text-amber-700 sm:flex dark:text-amber-300">
                      <Medal className="h-3 w-3" /> {row.prize.title}
                    </span>
                  )}
                  <span className="font-bold">{row.points}</span>
                </li>
              ))}
            </ol>
          )}
        </section>

        <p className="pb-2 text-center text-[11px] text-muted-foreground">
          Answers are scored on our server — no peeking, no cheating.
        </p>
      </main>
    </div>
  );
}
