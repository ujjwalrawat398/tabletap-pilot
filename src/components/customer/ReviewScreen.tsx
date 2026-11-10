'use client';

import * as React from 'react';
import Link from 'next/link';
import { useCustomer } from '@/components/customer/CustomerProvider';
import { useT } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Textarea, Input, Label } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { ArrowLeft, CheckCircle2, ExternalLink, HeartHandshake, Sparkles, Star } from 'lucide-react';

/**
 * Review routing (spec §10):
 *   4–5 stars -> Google Maps review button
 *   1–3 stars -> private feedback form (owner only)
 * One review per session, enforced by a unique index on reviews.session_id.
 */
export function ReviewScreen({
  googleReviewUrl,
  restaurantName,
}: {
  googleReviewUrl: string | null;
  restaurantName: string;
}) {
  const { t } = useT();
  const { tableCode, review, refresh } = useCustomer();
  const { push } = useToast();

  const [rating, setRating] = React.useState<number>(0);
  const [hover, setHover] = React.useState<number>(0);
  const [message, setMessage] = React.useState('');
  const [contact, setContact] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [done, setDone] = React.useState<{ kind: 'google' | 'private' } | null>(
    review ? { kind: review.routed_to === 'google' ? 'google' : 'private' } : null,
  );

  const shown = hover || rating;

  async function saveRating(value: number) {
    setRating(value);
    if (review) return;
    try {
      await api.post('/api/public/review', {
        table_code: tableCode,
        payload: { rating: value, routedTo: value >= 4 ? 'google' : 'private' },
      });
    } catch {
      /* the rating is still usable locally if this races */
    }
  }

  async function submitPrivate() {
    setBusy(true);
    try {
      await api.post('/api/public/feedback', {
        table_code: tableCode,
        payload: { rating: rating || undefined, message, contact: contact || undefined },
      });
      setDone({ kind: 'private' });
      push(t.thanksFeedback, 'success');
      await refresh();
    } catch (err) {
      push(err instanceof Error ? err.message : 'Could not send feedback', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-dvh pb-24">
      <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-border bg-background/95 p-3 backdrop-blur">
        <Link href={`/t/${tableCode}`} className="tap rounded-full hover:bg-secondary" aria-label="Back">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-base font-bold">{t.leaveReview}</h1>
      </header>

      <main className="p-5">
        {done ? (
          <div className="mt-16 text-center">
            <CheckCircle2 className="mx-auto h-14 w-14 text-[hsl(var(--success))]" />
            <h2 className="mt-3 text-lg font-bold">
              {done.kind === 'private' ? t.thanksFeedback : 'Thank you!'}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {done.kind === 'private'
                ? 'Only the owner will see this. We read every message.'
                : `Thanks for sharing your visit to ${restaurantName}.`}
            </p>
            {done.kind === 'google' && googleReviewUrl && (
              <Button asChild size="lg" className="mt-5 w-full max-w-xs">
                <a href={googleReviewUrl} target="_blank" rel="noopener noreferrer">
                  {t.googleReview} <ExternalLink className="h-4 w-4" />
                </a>
              </Button>
            )}
            <Button asChild variant="outline" className="mt-3 w-full max-w-xs">
              <Link href={`/t/${tableCode}`}>Back to table</Link>
            </Button>
          </div>
        ) : (
          <>
            <h2 className="text-center text-lg font-bold">{t.rateVisit}</h2>
            <p className="mt-1 text-center text-sm text-muted-foreground">{restaurantName}</p>

            <div
              className="mt-6 flex justify-center gap-2"
              role="radiogroup"
              aria-label="Star rating"
              onMouseLeave={() => setHover(0)}
              style={{ touchAction: 'manipulation' }}
            >
              {[1, 2, 3, 4, 5].map((value) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={rating === value}
                  aria-label={`${value} star${value > 1 ? 's' : ''}`}
                  onClick={() => saveRating(value)}
                  onMouseEnter={() => setHover(value)}
                  onFocus={() => setHover(value)}
                  onBlur={() => setHover(0)}
                  className="tap rounded-full p-1 transition-transform active:scale-90"
                >
                  <Star
                    className={cn(
                      'h-10 w-10 transition-colors',
                      value <= shown ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/40',
                    )}
                  />
                </button>
              ))}
            </div>

            {rating > 0 && rating >= 4 && (
              <div className="mt-8 animate-fade-in rounded-2xl border border-border bg-card p-5 text-center shadow-soft">
                <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-amber-100 text-amber-600 dark:bg-amber-500/15">
                  <Sparkles className="h-7 w-7" aria-hidden />
                </span>
                <h3 className="mt-2 text-base font-bold">Lovely! Would you share it on Google?</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  A 30-second review helps this restaurant more than anything else.
                </p>
                {googleReviewUrl ? (
                  <Button
                    size="lg"
                    className="mt-4 w-full"
                    onClick={() => setDone({ kind: 'google' })}
                    asChild
                  >
                    <a href={googleReviewUrl} target="_blank" rel="noopener noreferrer">
                      {t.googleReview} <ExternalLink className="h-4 w-4" />
                    </a>
                  </Button>
                ) : (
                  <p className="mt-3 rounded-lg bg-secondary p-3 text-xs text-muted-foreground">
                    The owner has not added a Google review link yet.
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => setDone({ kind: 'google' })}
                  className="mt-3 text-xs font-medium text-muted-foreground underline"
                >
                  Maybe later
                </button>
              </div>
            )}

            {rating > 0 && rating <= 3 && (
              <div className="mt-8 animate-fade-in rounded-2xl border border-border bg-card p-5 shadow-soft">
                <div className="flex items-center gap-2">
                  <HeartHandshake className="h-5 w-5 text-primary" />
                  <h3 className="text-base font-bold">We&apos;re sorry. What went wrong?</h3>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  This goes only to the owner — not to the public.
                </p>

                <Label htmlFor="feedback" className="mt-4 block">
                  Your feedback
                </Label>
                <Textarea
                  id="feedback"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="The food was cold, the wait was long, the music…"
                  maxLength={1000}
                  required
                  className="mt-1"
                />

                <Label htmlFor="contact" className="mt-3 block">
                  Phone or email (optional)
                </Label>
                <Input
                  id="contact"
                  value={contact}
                  onChange={(e) => setContact(e.target.value)}
                  placeholder="So we can make it right"
                  maxLength={120}
                  className="mt-1"
                />

                <Button
                  size="lg"
                  className="mt-4 w-full"
                  onClick={submitPrivate}
                  loading={busy}
                  disabled={message.trim().length < 3}
                >
                  Send privately
                </Button>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
