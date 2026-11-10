'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useT } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { ArrowLeft, Check, Loader2, Timer, Users } from 'lucide-react';

/**
 * "Play with my table" and "whole restaurant".
 *
 * The SERVER decides which question is on screen: question i runs during
 * [startsAt + i*15s, startsAt + (i+1)*15s). This phone only keeps an offset between its clock
 * and the server's, so everybody sees the same question at the same moment whatever their
 * network speed. Nothing here shows points, who is right, or the answers until the round ends.
 */

type Question = { index: number; id: string; question: string; options: string[] };
type MyAnswer = { questionIndex: number; selectedIndex: number };
type PlayerRow = { id: string; name: string; guestNo: number; tableNumber: number | null };

export type SyncRoundState = {
  round: {
    id: string;
    mode: 'solo' | 'table' | 'restaurant';
    status: 'lobby' | 'active' | 'finished';
    questionCount: number;
    startsAt: string;
    serverNow: string;
    questionSeconds: number | null;
    instructionSeconds: number;
    /** a restaurant game that never ran: 'not_enough_tables' | 'admin' */
    cancelReason?: string | null;
  };
  player: { id: string; left?: boolean } | null;
  questions: Question[];
  myAnswers: MyAnswer[];
  players: PlayerRow[];
  lobbyTables: { tableNumber: number; players: number }[];
};

const COPY = {
  en: {
    howTitle: 'How points work',
    waiting: 'Starts in',
    joined: 'Who is playing',
    tablePlayers: 'players',
    quit: 'Quit',
    answered: 'Answer locked in',
    nextIn: 'Next question in',
    over: 'Round complete — getting your results…',
    cancelTitle: 'This game was cancelled',
    cancelTables: 'Fewer than 2 tables joined, so it did not start.',
    cancelAdmin: 'The restaurant called it off.',
    leftTitle: 'You left this game',
    leftBody: 'You cannot come back to this round, but you can join the next one.',
    lateTitle: 'This game has already started',
    lateBody: 'Nobody can join once the first question is out. Join the next round.',
    back: 'Back to games',
    results: 'See results',
    rules: {
      common: [
        '10 questions · 15 seconds each. Everybody sees the same question at the same time.',
        'Right answer = 100 points. Answer faster for up to 50 bonus points.',
        'Wrong or no answer = 0. Scores stay hidden until the end, so nobody gets a hint.',
        'Nobody can join after the game starts. If you leave, you cannot come back to this round.',
      ],
      table: 'You play for yourself. The right answers and reasons come at the end.',
      restaurant:
        'Your TABLE scores a question only if EVERY player at your table is right. It then gets the average of their points. One wrong or missing answer = 0 for the table on that question.',
    },
  },
  hi: {
    howTitle: 'पॉइंट कैसे मिलेंगे',
    waiting: 'शुरू होने में',
    joined: 'कौन खेल रहा है',
    tablePlayers: 'खिलाड़ी',
    quit: 'छोड़ें',
    answered: 'जवाब दर्ज हो गया',
    nextIn: 'अगला सवाल',
    over: 'राउंड पूरा — नतीजे आ रहे हैं…',
    cancelTitle: 'यह गेम रद्द हो गया',
    cancelTables: '2 से कम टेबल जुड़ीं, इसलिए गेम शुरू नहीं हुआ।',
    cancelAdmin: 'रेस्टोरेंट ने गेम रद्द कर दिया।',
    leftTitle: 'आपने यह गेम छोड़ दिया',
    leftBody: 'इस राउंड में वापस नहीं आ सकते, अगले राउंड में जुड़ सकते हैं।',
    lateTitle: 'यह गेम शुरू हो चुका है',
    lateBody: 'पहला सवाल आने के बाद कोई नहीं जुड़ सकता। अगले राउंड में जुड़ें।',
    back: 'गेम्स पर वापस',
    results: 'परिणाम देखें',
    rules: {
      common: [
        '10 सवाल · हर सवाल के 15 सेकंड। सबको एक ही समय पर एक ही सवाल दिखेगा।',
        'सही जवाब = 100 पॉइंट। जल्दी जवाब देने पर 50 तक बोनस।',
        'गलत या जवाब नहीं = 0। स्कोर अंत तक छिपा रहेगा, किसी को हिंट नहीं मिलेगा।',
        'गेम शुरू होने के बाद कोई नहीं जुड़ सकता। छोड़ने पर इस राउंड में वापस नहीं आ सकते।',
      ],
      table: 'आप अपने लिए खेलते हैं। सही जवाब और कारण अंत में दिखेंगे।',
      restaurant:
        'आपकी टेबल को सवाल का स्कोर तभी मिलेगा जब टेबल का हर खिलाड़ी सही हो। तब टेबल को उनके पॉइंट का औसत मिलेगा। एक भी गलत या खाली जवाब = उस सवाल पर टेबल के 0।',
    },
  },
} as const;

export function SyncQuizRound({ initialState, tableCode }: { initialState: SyncRoundState; tableCode: string }) {
  const { locale } = useT();
  const c = COPY[locale === 'hi' ? 'hi' : 'en'];
  const router = useRouter();
  const { push } = useToast();

  const [state, setState] = React.useState<SyncRoundState>(initialState);
  // server clock = this phone's clock + offset (refreshed on every poll)
  const offset = React.useRef(new Date(initialState.round.serverNow).getTime() - Date.now());
  const [now, setNow] = React.useState(() => Date.now() + offset.current);
  const [picked, setPicked] = React.useState<Record<number, number>>({});
  const [busy, setBusy] = React.useState(false);
  const leftSent = React.useRef(false);

  const roundId = state.round.id;
  const mode = state.round.mode;
  const qMs = (state.round.questionSeconds ?? 15) * 1000;
  const startsMs = new Date(state.round.startsAt).getTime();
  const total = state.round.questionCount;
  const endMs = startsMs + total * qMs;
  const iLeft = Boolean(state.player?.left);
  const serverFinished = state.round.status === 'finished';

  const refreshState = React.useCallback(async () => {
    try {
      const sent = Date.now();
      const data = await api.get<SyncRoundState>(
        `/api/public/games/round?t=${encodeURIComponent(tableCode)}&roundId=${roundId}`,
      );
      // half the round trip is the best guess for how old the server's "now" already is
      offset.current = new Date(data.round.serverNow).getTime() + (Date.now() - sent) / 2 - Date.now();
      setState(data);
    } catch {
      /* keep the last known state */
    }
  }, [roundId, tableCode]);

  // the screen follows the server's clock, four times a second
  React.useEffect(() => {
    const timer = setInterval(() => setNow(Date.now() + offset.current), 250);
    return () => clearInterval(timer);
  }, []);

  // and checks in with the server every 3 s (who joined, my answers, is it finished)
  React.useEffect(() => {
    if (serverFinished) return;
    const timer = setInterval(refreshState, 3000);
    return () => clearInterval(timer);
  }, [refreshState, serverFinished]);

  const phase: 'lobby' | 'question' | 'ended' =
    now < startsMs ? 'lobby' : now >= endMs ? 'ended' : 'question';
  const idx = phase === 'question' ? Math.min(total - 1, Math.floor((now - startsMs) / qMs)) : -1;
  const question = idx >= 0 ? state.questions.find((q) => q.index === idx) : undefined;
  const windowEnd = idx >= 0 ? startsMs + (idx + 1) * qMs : 0;
  const secondsLeft = idx >= 0 ? Math.max(0, Math.ceil((windowEnd - now) / 1000)) : 0;
  const myPick =
    idx >= 0 ? picked[idx] ?? state.myAnswers.find((a) => a.questionIndex === idx)?.selectedIndex ?? null : null;

  // a new question just appeared on the clock but this phone has not got its text yet
  React.useEffect(() => {
    if (phase === 'question' && !question) void refreshState();
  }, [phase, idx, question, refreshState]);

  // the lobby just ended: fetch the first question straight away
  React.useEffect(() => {
    if (phase === 'question' && state.round.status === 'lobby') void refreshState();
  }, [phase, state.round.status, refreshState]);

  // after the last window: ask until the server confirms it is finished, then show the results
  React.useEffect(() => {
    if (phase !== 'ended') return;
    if (serverFinished) {
      router.push(`/t/${tableCode}/games/results/${roundId}`);
      return;
    }
    void refreshState();
    const timer = setInterval(refreshState, 1000);
    return () => clearInterval(timer);
  }, [phase, serverFinished, refreshState, router, tableCode, roundId]);

  // Quit, or the phone's Back button: out of this round for good
  const canLeave = !iLeft && !serverFinished && state.player !== null;
  const leaveGame = React.useCallback(async () => {
    if (leftSent.current) return;
    leftSent.current = true;
    try {
      await api.post('/api/public/games/leave', { table_code: tableCode, payload: { roundId } });
    } catch {
      leftSent.current = false; // offline: nothing was recorded
    }
  }, [roundId, tableCode]);

  React.useEffect(() => {
    if (!canLeave) return;
    const onBack = () => void leaveGame();
    window.addEventListener('popstate', onBack);
    return () => window.removeEventListener('popstate', onBack);
  }, [canLeave, leaveGame]);

  async function quit(e: React.MouseEvent) {
    if (!canLeave) return;
    e.preventDefault();
    await leaveGame();
    router.push(`/t/${tableCode}/games`);
  }

  async function answer(selected: number) {
    if (busy || myPick !== null || idx < 0) return;
    setBusy(true);
    setPicked((p) => ({ ...p, [idx]: selected }));
    try {
      await api.post('/api/public/games/answer', {
        table_code: tableCode,
        payload: { roundId, questionIndex: idx, selectedIndex: selected },
      });
    } catch (err) {
      // too late for that question (or a hiccup): forget the tap and look at the server's view
      setPicked((p) => {
        const copy = { ...p };
        delete copy[idx];
        return copy;
      });
      push(err instanceof Error ? err.message : 'Could not submit the answer', 'error');
      void refreshState();
    } finally {
      setBusy(false);
    }
  }

  // ---------------------------------------------------------------- cancelled before it started
  if (state.round.cancelReason) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center p-6 text-center">
        <Users className="h-14 w-14 text-muted-foreground" aria-hidden />
        <h1 className="mt-3 text-xl font-bold">{c.cancelTitle}</h1>
        <p className="mt-1 max-w-xs text-sm text-muted-foreground">
          {state.round.cancelReason === 'admin' ? c.cancelAdmin : c.cancelTables}
        </p>
        <Button asChild size="lg" className="mt-6 w-full max-w-xs">
          <Link href={`/t/${tableCode}/games`}>{c.back}</Link>
        </Button>
      </div>
    );
  }

  // ---------------------------------------------------------------- left / too late
  if (iLeft || (state.player === null && state.round.status !== 'lobby' && phase !== 'lobby')) {
    const late = !iLeft;
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center p-6 text-center">
        <Users className="h-14 w-14 text-muted-foreground" aria-hidden />
        <h1 className="mt-3 text-xl font-bold">{late ? c.lateTitle : c.leftTitle}</h1>
        <p className="mt-1 max-w-xs text-sm text-muted-foreground">{late ? c.lateBody : c.leftBody}</p>
        {serverFinished && !late && (
          <Button size="lg" className="mt-6 w-full max-w-xs" onClick={() => router.push(`/t/${tableCode}/games/results/${roundId}`)}>
            {c.results}
          </Button>
        )}
        <Button asChild size="lg" variant={serverFinished && !late ? 'outline' : 'default'} className="mt-2 w-full max-w-xs">
          <Link href={`/t/${tableCode}/games`}>{c.back}</Link>
        </Button>
      </div>
    );
  }

  // ---------------------------------------------------------------- lobby: rules + who is in
  if (phase === 'lobby') {
    const left = Math.max(0, Math.ceil((startsMs - now) / 1000));
    return (
      <div className="min-h-dvh p-4 pb-10">
        <header className="flex items-center gap-3">
          <Link href={`/t/${tableCode}/games`} onClick={quit} className="tap rounded-full hover:bg-secondary" aria-label={c.quit}>
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div className="flex-1 text-center">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{c.waiting}</p>
            <p className="text-3xl font-black tabular-nums">{left}s</p>
          </div>
          <span className="w-9" aria-hidden />
        </header>

        <section className="mt-4 rounded-2xl border border-border bg-card p-4">
          <h2 className="text-sm font-bold">{c.howTitle}</h2>
          <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
            {c.rules.common.map((line) => (
              <li key={line}>{line}</li>
            ))}
            <li className="font-medium text-foreground">{mode === 'restaurant' ? c.rules.restaurant : c.rules.table}</li>
          </ul>
        </section>

        <section className="mt-4 rounded-2xl border border-border bg-card p-4">
          <h2 className="text-sm font-bold">{c.joined}</h2>
          <div className="mt-2 space-y-1.5">
            {mode === 'restaurant'
              ? state.lobbyTables.map((tb) => (
                  <div key={tb.tableNumber} className="rounded-xl bg-secondary px-3 py-2">
                    <p className="text-sm font-semibold">Table {tb.tableNumber}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {tb.players} {c.tablePlayers}
                    </p>
                  </div>
                ))
              : state.players.map((p) => (
                  <div key={p.id} className="flex items-center justify-between rounded-xl bg-secondary px-3 py-2 text-sm">
                    <span className="font-medium">{p.name}</span>
                    <Check className="h-4 w-4 text-[hsl(var(--success))]" />
                  </div>
                ))}
          </div>
        </section>
      </div>
    );
  }

  // ---------------------------------------------------------------- after the last question
  if (phase === 'ended') {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center p-6 text-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" aria-hidden />
        <p className="mt-3 text-sm text-muted-foreground">{c.over}</p>
      </div>
    );
  }

  if (!question) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // ---------------------------------------------------------------- question
  const answered = myPick !== null;
  return (
    <div className="min-h-dvh pb-24">
      <header className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur">
        <div className="flex items-center gap-3 p-3">
          <Link href={`/t/${tableCode}/games`} onClick={quit} className="tap rounded-full hover:bg-secondary" aria-label={c.quit}>
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div className="flex-1">
            <p className="text-xs text-muted-foreground">
              Question {idx + 1} of {total}
            </p>
            <div className="mt-1 flex items-center gap-2">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary">
                <div
                  className="h-full rounded-full bg-primary transition-[width] duration-300 ease-linear"
                  style={{ width: `${Math.max(0, Math.min(100, ((windowEnd - now) / qMs) * 100))}%` }}
                />
              </div>
              <span className="flex items-center gap-1 text-xs font-semibold tabular-nums">
                <Timer className="h-3.5 w-3.5" /> {secondsLeft}s
              </span>
            </div>
          </div>
        </div>
      </header>

      <main className="p-4">
        <h1 className="text-lg font-bold leading-snug">{question.question}</h1>
        <div className="mt-4 space-y-2.5">
          {question.options.map((option, i) => {
            const isMine = myPick === i;
            return (
              <button
                key={i}
                type="button"
                onClick={() => answer(i)}
                disabled={answered || busy}
                aria-pressed={isMine}
                data-quiz-option={i}
                className={cn(
                  'flex w-full items-center gap-3 rounded-2xl border-2 p-4 text-left text-sm font-medium transition',
                  'disabled:opacity-100',
                  !answered && 'border-border bg-card hover:border-primary/60 active:scale-[.99]',
                  isMine && 'border-primary bg-primary/10',
                  answered && !isMine && 'border-border bg-card opacity-60',
                )}
              >
                <span
                  className={cn(
                    'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold',
                    isMine ? 'bg-primary text-primary-foreground' : 'bg-secondary',
                  )}
                >
                  {isMine ? <Check className="h-4 w-4" /> : String.fromCharCode(65 + i)}
                </span>
                <span className="flex-1">{option}</span>
              </button>
            );
          })}
        </div>

        {answered && (
          <p className="mt-4 rounded-2xl bg-secondary p-3 text-center text-sm font-semibold" role="status">
            {c.answered} · {c.nextIn} {secondsLeft}s
          </p>
        )}
      </main>
    </div>
  );
}
