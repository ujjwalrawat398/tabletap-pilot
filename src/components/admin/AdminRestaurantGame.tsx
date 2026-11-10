'use client';

import * as React from 'react';
import { api } from '@/lib/api-client';
import { useToast } from '@/components/ui/toast';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Gamepad2, Trophy } from 'lucide-react';

type Current = {
  id: string;
  phase: 'join' | 'rules' | 'live';
  startsAt: string;
  joinClosesAt: string;
  serverNow: string;
  questionCount: number;
  currentQuestion: number | null;
  tables: { tableNumber: number; players: string[] }[];
};
type Result = {
  rank: number;
  tableId: string;
  tableNumber: number;
  points: number;
  questionsWon: number;
  players: string[];
  prize: string | null;
  prizeGiven: boolean;
};
type Match = {
  id: string;
  at: string;
  cancelReason: string | null;
  tablesJoined: number;
  results: Result[];
};
type View = { current: Current | null; matches: Match[] };

/**
 * Admin → Games: start the whole-restaurant game and see how it went.
 * Pressing Start is the admin's only job: 1 minute to join, 25 s of rules, then the match runs and ends
 * by itself, or cancels itself if fewer than 2 tables joined.
 */
export function AdminRestaurantGame() {
  const { push } = useToast();
  const [view, setView] = React.useState<View | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [now, setNow] = React.useState(() => Date.now());
  const offset = React.useRef(0);

  const load = React.useCallback(async () => {
    try {
      const v = await api.get<View>('/api/admin/restaurant-game');
      if (v.current) offset.current = new Date(v.current.serverNow).getTime() - Date.now();
      setView(v);
    } catch {
      /* keep what is on screen */
    }
  }, []);

  // look often while a game is on, rarely otherwise
  React.useEffect(() => {
    void load();
    const timer = setInterval(load, view?.current ? 3000 : 10000);
    return () => clearInterval(timer);
  }, [load, Boolean(view?.current)]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, []);

  async function act(kind: 'restaurant-game-start' | 'restaurant-game-cancel') {
    setBusy(kind);
    try {
      await api.post(`/api/admin/${kind}`, {});
      push(kind === 'restaurant-game-start' ? 'Game started — guests see the banner now' : 'Game cancelled', 'success');
      await load();
    } catch (err) {
      push(err instanceof Error ? err.message : 'Could not do that', 'error');
    } finally {
      setBusy(null);
    }
  }

  async function markPrize(roundId: string, tableId: string, given: boolean) {
    try {
      await api.post('/api/admin/restaurant-game-prize', { roundId, tableId, given });
      await load();
    } catch (err) {
      push(err instanceof Error ? err.message : 'Could not save', 'error');
    }
  }

  const cur = view?.current ?? null;
  const secs = (iso: string) => Math.max(0, Math.ceil((new Date(iso).getTime() - (now + offset.current)) / 1000));
  const mmss = (n: number) => `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
  const lastCancelled = view?.matches[0]?.cancelReason === 'not_enough_tables' ? view.matches[0] : null;

  return (
    <section className="rounded-2xl border border-border bg-card p-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-bold">
          <Gamepad2 className="h-4 w-4" /> Restaurant game
        </h2>
        {!cur && (
          <Button size="sm" onClick={() => act('restaurant-game-start')} loading={busy === 'restaurant-game-start'}>
            Start restaurant game
          </Button>
        )}
        {cur?.phase !== 'live' && cur && (
          <Button size="sm" variant="outline" onClick={() => act('restaurant-game-cancel')} loading={busy === 'restaurant-game-cancel'}>
            Cancel
          </Button>
        )}
      </div>

      {!cur && (
        <p className="mt-1 text-xs text-muted-foreground">
          Start it and every guest gets a banner. They have 1 minute to join (max 2 phones per table), then 25 seconds to read the
          rules, then it starts by itself. It cancels itself if fewer than 2 tables join.
        </p>
      )}

      {lastCancelled && !cur && (
        <p className="mt-2 rounded-xl bg-red-50 p-2 text-xs font-medium text-red-700 dark:bg-red-500/10 dark:text-red-300" role="status">
          Last game was cancelled: not enough teams ({lastCancelled.tablesJoined} joined, 2 needed).
        </p>
      )}

      {cur && (
        <div className="mt-2 rounded-xl bg-secondary/60 p-3">
          <p className="text-sm font-semibold">
            {cur.phase === 'join' && `Joining is open · ${mmss(secs(cur.joinClosesAt))} left`}
            {cur.phase === 'rules' && `Joining closed · rules on screen · starts in ${mmss(secs(cur.startsAt))}`}
            {cur.phase === 'live' && `Match is on · question ${cur.currentQuestion} of ${cur.questionCount}`}
          </p>
          <p className="text-xs text-muted-foreground">
            {cur.tables.length} {cur.tables.length === 1 ? 'table' : 'tables'} joined
            {cur.phase !== 'live' && cur.tables.length < 2 ? ' · 2 needed or it cancels' : ''}
          </p>
          <ul className="mt-2 space-y-1">
            {cur.tables.map((tb) => (
              <li key={tb.tableNumber} className="flex items-center justify-between rounded-lg bg-card px-2 py-1.5 text-xs">
                <span className="font-semibold">Table {tb.tableNumber}</span>
                <span className="text-muted-foreground">{tb.players.join(', ')}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* today's matches and who won */}
      {view && view.matches.length > 0 && (
        <div className="mt-3 space-y-2">
          <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Today&apos;s matches</h3>
          {view.matches.map((m, i) => (
            <div key={m.id} className="rounded-xl border border-border p-2.5">
              <p className="text-xs text-muted-foreground">
                {new Date(m.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                {i === 0 && !cur ? ' · latest' : ''}
              </p>
              {m.cancelReason ? (
                <p className="mt-1 text-sm font-medium">
                  Cancelled · {m.cancelReason === 'not_enough_tables' ? `not enough teams (${m.tablesJoined} joined)` : 'by admin'}
                </p>
              ) : m.results.length === 0 ? (
                <p className="mt-1 text-sm text-muted-foreground">No result</p>
              ) : (
                <ol className="mt-1 space-y-1">
                  {m.results.map((r) => (
                    <li key={r.tableId} className="rounded-lg bg-secondary/50 px-2 py-1.5">
                      <div className="flex items-center gap-2 text-sm">
                        {r.rank === 1 ? <Trophy className="h-4 w-4 text-amber-500" aria-hidden /> : <span className="w-4 text-center text-xs font-bold">{r.rank}</span>}
                        <span className="flex-1 font-semibold">
                          Table {r.tableNumber}
                          {r.rank === 1 && <span className="ml-1 text-[11px] font-bold text-amber-600">WINNER</span>}
                        </span>
                        <span className="font-bold">{r.points}</span>
                        <span className="text-[11px] text-muted-foreground">{r.questionsWon} won</span>
                      </div>
                      <p className="pl-6 text-[11px] text-muted-foreground">{r.players.join(', ')}</p>
                      {r.prize && (
                        <div className="mt-1 flex items-center justify-between pl-6 text-xs">
                          <span>
                            Prize: <span className="font-semibold">{r.prize}</span>
                          </span>
                          <label className="flex items-center gap-2">
                            <span className="text-muted-foreground">Given</span>
                            <Switch
                              checked={r.prizeGiven}
                              onCheckedChange={(v) => markPrize(m.id, r.tableId, v)}
                              aria-label={`Prize given to table ${r.tableNumber}`}
                            />
                          </label>
                        </div>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
