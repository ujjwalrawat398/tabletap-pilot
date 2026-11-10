'use client';

import Link from 'next/link';
import { useT } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn, money } from '@/lib/utils';
import { ArrowLeft, Check, Medal, Trophy, X } from 'lucide-react';

type Results = {
  round: { id: string; mode: string; status: string; questionCount: number };
  players: {
    id: string;
    name: string;
    tableNumber: number | null;
    score: number;
    correctCount: number;
    answeredCount: number;
    totalMs: number;
  }[];
  tables: { tableId: string; tableNumber: number; points: number; correctCount: number; members?: number }[];
  questions: {
    index: number;
    question: string;
    options: string[];
    correctIndex: number;
    explanation: string | null;
  }[];
};

export function ResultsScreen({ results, tableCode }: { results: Results; tableCode: string }) {
  const { t } = useT();
  const top = results.players[0];

  return (
    <div className="min-h-dvh pb-24">
      <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-border bg-background/95 p-3 backdrop-blur">
        <Link href={`/t/${tableCode}/games`} className="tap rounded-full hover:bg-secondary" aria-label="Back">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-base font-bold">{t.seeResults}</h1>
      </header>

      <main className="space-y-4 p-4">
        <section className="rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 p-5 text-center text-white shadow-card">
          <Trophy className="mx-auto h-10 w-10" />
          <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-white/80">
            {results.round.mode === 'restaurant' ? 'Restaurant round' : 'Table round'} complete
          </p>
          <h2 className="mt-1 text-xl font-bold">{top ? top.name : 'Nice work'}</h2>
          <p className="text-sm text-white/90">
            {top?.correctCount ?? 0} of {results.round.questionCount} correct · {top?.score ?? 0} points
          </p>
        </section>

        {results.round.mode === 'restaurant' && results.tables.length > 0 && (
          <section className="rounded-2xl border border-border bg-card p-4">
            <h3 className="text-sm font-bold">Tables</h3>
            <p className="text-[11px] text-muted-foreground">
              A table scores a question only when every player at it is right.
            </p>
            <ol className="mt-2 space-y-1.5">
              {results.tables.map((tb, i) => (
                <li
                  key={tb.tableId}
                  className={cn(
                    'flex items-center gap-2 rounded-xl px-3 py-2 text-sm',
                    i === 0 ? 'bg-amber-50 dark:bg-amber-500/10' : 'bg-secondary/60',
                  )}
                >
                  <span className="w-6 text-center text-xs font-bold">{i + 1}</span>
                  <span className="flex-1 font-medium">
                    Table {tb.tableNumber}
                    {tb.members ? (
                      <span className="ml-1 text-[11px] text-muted-foreground">
                        {tb.members} player{tb.members === 1 ? '' : 's'}
                      </span>
                    ) : null}
                  </span>
                  <span className="text-xs text-muted-foreground">{tb.correctCount} won</span>
                  <span className="font-bold">{tb.points}</span>
                </li>
              ))}
            </ol>
          </section>
        )}

        <section className="rounded-2xl border border-border bg-card p-4">
          <h3 className="text-sm font-bold">{results.round.mode === 'restaurant' ? 'Players' : 'Leaderboard'}</h3>
          <ol className="mt-2 space-y-1.5">
            {results.players.map((p, i) => (
              <li
                key={p.id}
                className={cn(
                  'flex items-center gap-2 rounded-xl px-3 py-2 text-sm',
                  i === 0 ? 'bg-amber-50 dark:bg-amber-500/10' : 'bg-secondary/60',
                )}
              >
                <span className="w-6 text-center text-xs font-bold">
                  {i < 3 ? <Medal className="mx-auto h-4 w-4 text-amber-500" aria-hidden /> : i + 1}
                </span>
                <span className="flex-1 truncate font-medium">
                  {p.name}
                  {p.tableNumber ? (
                    <span className="ml-1 text-[11px] text-muted-foreground">Table {p.tableNumber}</span>
                  ) : null}
                </span>
                <span className="text-xs text-muted-foreground">{p.correctCount} correct</span>
                <span className="font-bold">{p.score}</span>
              </li>
            ))}
          </ol>
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-bold">Answers & explanations</h3>
          {results.questions.map((q) => (
            <details key={q.index} className="rounded-2xl border border-border bg-card p-3">
              <summary className="cursor-pointer text-sm font-medium">
                {q.index + 1}. {q.question}
              </summary>
              <ul className="mt-2 space-y-1 text-sm">
                {q.options.map((opt, i) => (
                  <li
                    key={i}
                    className={cn(
                      'flex items-center gap-2 rounded-lg px-2 py-1',
                      i === q.correctIndex
                        ? 'bg-emerald-50 font-semibold text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300'
                        : 'text-muted-foreground',
                    )}
                  >
                    {i === q.correctIndex ? <Check className="h-4 w-4" /> : <X className="h-4 w-4 opacity-30" />}
                    {opt}
                  </li>
                ))}
              </ul>
              {q.explanation && (
                <p className="mt-2 rounded-lg bg-secondary p-2 text-xs text-muted-foreground">
                  {q.explanation}
                </p>
              )}
            </details>
          ))}
        </section>

        <div className="flex gap-2">
          <Button asChild className="flex-1">
            <Link href={`/t/${tableCode}/games`}>{t.playAgain}</Link>
          </Button>
          <Button asChild variant="outline" className="flex-1">
            <Link href={`/t/${tableCode}/menu`}>{t.viewMenu}</Link>
          </Button>
        </div>
      </main>
    </div>
  );
}
