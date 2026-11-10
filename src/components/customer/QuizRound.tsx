'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useT } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { ArrowLeft, Check, Loader2, Timer, Trophy, X } from 'lucide-react';

/**
 * SOLO game: your own pace. 25 seconds to answer each question; after you answer you see
 * whether you were right, the reason, and a "Next question" button.
 * (Table and whole-restaurant games use SyncQuizRound, which runs on the server's clock.)
 */

type Question = { index: number; id: string; question: string; options: string[] };
type MyAnswer = {
  questionIndex: number;
  selectedIndex: number;
  isCorrect: boolean | null;
  msTaken: number;
  points: number | null;
  correctIndex: number | null;
  explanation: string | null;
};

type RoundState = {
  round: {
    id: string;
    mode: 'solo' | 'table' | 'restaurant';
    status: 'lobby' | 'active' | 'finished';
    questionCount: number;
    startsAt: string;
    endsAt: string | null;
    categoryName: string | null;
    serverNow: string;
    answeredCount: number;
  };
  player: {
    id: string;
    displayName: string;
    score: number;
    correctCount: number;
    answeredCount: number;
  } | null;
  questions: Question[];
  myAnswers: MyAnswer[];
};

const QUESTION_SECONDS = 25;

export function QuizRound({ initialState, tableCode }: { initialState: RoundState; tableCode: string }) {
  const { t } = useT();
  const router = useRouter();
  const { push } = useToast();
  const [state, setState] = React.useState<RoundState>(initialState);
  const [index, setIndex] = React.useState(initialState.myAnswers.length);
  const [picked, setPicked] = React.useState<number | null>(null);
  const [feedback, setFeedback] = React.useState<{
    isCorrect: boolean;
    correctIndex: number;
    explanation: string | null;
    points: number;
  } | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [secondsLeft, setSecondsLeft] = React.useState(QUESTION_SECONDS);
  const startedAt = React.useRef<number>(Date.now());

  const question = state.questions[index];
  const answeredCount = state.myAnswers.length;
  const finished = state.round.status === 'finished' || answeredCount >= state.round.questionCount;

  // per-question timer
  React.useEffect(() => {
    if (feedback || finished) return;
    startedAt.current = Date.now();
    setSecondsLeft(QUESTION_SECONDS);
    const timer = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          clearInterval(timer);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [index, feedback, finished]);

  // auto-submit when the timer runs out
  React.useEffect(() => {
    if (secondsLeft === 0 && !feedback && !finished && question) {
      void answer(-1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secondsLeft]);

  async function answer(selected: number) {
    if (busy || feedback || !question) return;
    setBusy(true);
    setPicked(selected);
    try {
      const res = await api.post<{
        isCorrect: boolean;
        correctIndex: number;
        explanation: string | null;
        points: number;
        totalScore: number;
        finished: boolean;
      }>('/api/public/games/answer', {
        table_code: tableCode,
        payload: {
          roundId: state.round.id,
          questionIndex: index,
          selectedIndex: Math.max(0, selected),
          msTaken: Date.now() - startedAt.current,
        },
      });

      setFeedback({
        isCorrect: res.isCorrect,
        correctIndex: res.correctIndex,
        explanation: res.explanation,
        points: res.points,
      });

      setState((s) => ({
        ...s,
        player: s.player
          ? {
              ...s.player,
              score: res.totalScore,
              correctCount: s.player.correctCount + (res.isCorrect ? 1 : 0),
              answeredCount: s.player.answeredCount + 1,
            }
          : s.player,
        myAnswers: [
          ...s.myAnswers,
          {
            questionIndex: index,
            selectedIndex: Math.max(0, selected),
            isCorrect: res.isCorrect,
            msTaken: Date.now() - startedAt.current,
            points: res.points,
            correctIndex: res.correctIndex,
            explanation: res.explanation,
          },
        ],
      }));

      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        navigator.vibrate(res.isCorrect ? 40 : [30, 60, 30]);
      }
    } catch (err) {
      push(err instanceof Error ? err.message : 'Could not submit the answer', 'error');
      setPicked(null);
    } finally {
      setBusy(false);
    }
  }

  function next() {
    setFeedback(null);
    setPicked(null);
    const nextIndex = index + 1;
    if (nextIndex >= state.round.questionCount) {
      router.push(`/t/${tableCode}/games/results/${state.round.id}`);
      return;
    }
    setIndex(nextIndex);
  }

  // ---------------------------------------------------------------- finished
  if (finished) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center p-6 text-center">
        <Trophy className="h-16 w-16 text-amber-500" />
        <h1 className="mt-3 text-xl font-bold">Round complete!</h1>
        <p className="text-sm text-muted-foreground">
          You scored {state.player?.score ?? 0} points · {state.player?.correctCount ?? 0}/
          {state.round.questionCount} correct
        </p>
        <Button
          size="lg"
          className="mt-6 w-full max-w-xs"
          onClick={() => router.push(`/t/${tableCode}/games/results/${state.round.id}`)}
        >
          {t.seeResults}
        </Button>
        <Button asChild variant="outline" className="mt-2 w-full max-w-xs">
          <Link href={`/t/${tableCode}/games`}>{t.playAgain}</Link>
        </Button>
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
  return (
    <div className="min-h-dvh pb-24">
      <header className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur">
        <div className="flex items-center gap-3 p-3">
          <Link href={`/t/${tableCode}/games`} className="tap rounded-full hover:bg-secondary" aria-label="Quit">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div className="flex-1">
            <p className="text-xs text-muted-foreground">
              {t.question} {index + 1} {t.of} {state.round.questionCount}
            </p>
            <div className="mt-1 flex items-center gap-2">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${((index + 1) / state.round.questionCount) * 100}%` }}
                />
              </div>
              <span className="flex items-center gap-1 text-xs font-semibold tabular-nums">
                <Timer className="h-3.5 w-3.5" /> {secondsLeft}s
              </span>
            </div>
          </div>
          <span className="rounded-full bg-secondary px-2.5 py-1 text-xs font-bold">
            {state.player?.score ?? 0}
          </span>
        </div>
      </header>

      <main className="p-4">
        <h1 className="text-lg font-bold leading-snug">{question.question}</h1>

        <div className="mt-4 space-y-2.5">
          {question.options.map((option, i) => {
            const isPicked = picked === i;
            const isCorrect = feedback?.correctIndex === i;
            const showCorrect = Boolean(feedback) && isCorrect;
            const showWrong = Boolean(feedback) && isPicked && !feedback?.isCorrect;

            return (
              <button
                key={i}
                type="button"
                onClick={() => answer(i)}
                disabled={Boolean(feedback) || busy}
                aria-pressed={isPicked}
                data-quiz-option={i}
                className={cn(
                  'flex w-full items-center gap-3 rounded-2xl border-2 p-4 text-left text-sm font-medium transition',
                  'disabled:opacity-100',
                  !feedback && 'border-border bg-card hover:border-primary/60 active:scale-[.99]',
                  showCorrect && 'border-emerald-600 bg-emerald-50 dark:bg-emerald-500/10',
                  showWrong && 'border-red-500 bg-red-50 dark:bg-red-500/10',
                  feedback && !showCorrect && !showWrong && 'border-border bg-card opacity-60',
                )}
              >
                <span
                  className={cn(
                    'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold',
                    showCorrect
                      ? 'bg-emerald-600 text-white'
                      : showWrong
                        ? 'bg-red-500 text-white'
                        : 'bg-secondary',
                  )}
                >
                  {showCorrect ? <Check className="h-4 w-4" /> : showWrong ? <X className="h-4 w-4" /> : String.fromCharCode(65 + i)}
                </span>
                <span className="flex-1">{option}</span>
              </button>
            );
          })}
        </div>

        {feedback && (
          <div
            className={cn(
              'mt-4 animate-fade-in rounded-2xl p-4',
              feedback.isCorrect
                ? 'bg-emerald-50 dark:bg-emerald-500/10'
                : 'bg-red-50 dark:bg-red-500/10',
            )}
            role="status"
          >
            <p className="flex items-center gap-2 font-bold">
              {feedback.isCorrect ? (
                <>
                  <Check className="h-5 w-5 text-emerald-600" /> Correct! +{feedback.points} points
                </>
              ) : (
                <>
                  <X className="h-5 w-5 text-red-500" /> Not quite
                </>
              )}
            </p>
            {feedback.explanation && (
              <p className="mt-1 text-sm text-muted-foreground">{feedback.explanation}</p>
            )}
            <Button size="lg" className="mt-3 w-full" onClick={next}>
              {index + 1 >= state.round.questionCount ? t.seeResults : 'Next question'}
            </Button>
          </div>
        )}
      </main>
    </div>
  );
}
