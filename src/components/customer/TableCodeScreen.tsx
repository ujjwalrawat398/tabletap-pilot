'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowRight, Delete, Phone, UtensilsCrossed } from 'lucide-react';
import { api, ApiError } from '@/lib/api-client';
import { useLocale } from '@/lib/i18n';
import { Languages } from 'lucide-react';

type VerifyError = {
  code?: string;
  attemptsLeft?: number;
  canAskAgain?: boolean;
};

/**
 * The table-code screen (spec §3 codes, §5 flow).
 *
 * Rules it implements on the client side:
 *  - numeric keypad, 4-6 boxes driven by the restaurant's `otp_length`
 *  - auto-submit on the last digit, plus a manual Enter for 5/6 digit codes
 *  - "Ask again" obeys the re-issue cooldown and shows a countdown
 *  - wrong code shows how many tries are left; the 5th wrong answer locks it
 *  - no staff heartbeat → "please call a staff member" + the restaurant phone
 *  - the read-only menu stays reachable the whole time (D2)
 */
export function TableCodeScreen({
  tableCode,
  tableNumber,
  restaurantName,
  codeLength,
  menuHref,
  phone,
  staffOffline,
  retryAfter,
  awaitingWaiter = false,
}: {
  tableCode: string;
  tableNumber: number;
  restaurantName: string;
  codeLength: number;
  menuHref: string;
  phone: string | null;
  staffOffline: boolean;
  retryAfter: number;
  /** the board has no card for this table yet — nobody has read a code out */
  awaitingWaiter?: boolean;
}) {
  const { t, locale, setLocale } = useLocale();
  const [digits, setDigits] = React.useState<string[]>(Array(codeLength).fill(''));
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [attemptsLeft, setAttemptsLeft] = React.useState<number | null>(null);
  const [cooldown, setCooldown] = React.useState(retryAfter);
  const [asking, setAsking] = React.useState(false);
  const [asked, setAsked] = React.useState(false);
  const [waiting, setWaiting] = React.useState(awaitingWaiter);
  const [offline, setOffline] = React.useState(staffOffline);
  const inputs = React.useRef<Array<HTMLInputElement | null>>([]);

  React.useEffect(() => {
    inputs.current[0]?.focus();
  }, []);

  // Arriving at /t/{code} IS the request: raise the card once, so the waiter sees it
  // without the guest having to find "Ask again". The response never contains the
  // code, so this is safe to fire automatically.
  React.useEffect(() => {
    if (!awaitingWaiter) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await api.post<{ retry_after: number; staff_offline: boolean; awaiting_waiter?: boolean }>(
          '/api/public/session',
          { table_code: tableCode },
        );
        if (cancelled) return;
        setOffline(Boolean(res.staff_offline));
        setWaiting(Boolean(res.awaiting_waiter));
        setCooldown(res.retry_after || 0);
      } catch {
        /* the "Ask again" button is the fallback */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [awaitingWaiter, tableCode]);

  React.useEffect(() => {
    if (cooldown <= 0) return;
    const id = setInterval(() => setCooldown((c) => (c <= 0 ? 0 : c - 1)), 1000);
    return () => clearInterval(id);
  }, [cooldown]);

  // In-app browsers (Instagram/Facebook) and blocked cookies make the device
  // cookie silently fail; say so instead of looping on a code that "works".
  const [cookieProblem, setCookieProblem] = React.useState(false);
  React.useEffect(() => {
    if (typeof document === 'undefined') return;
    setCookieProblem(!navigator.cookieEnabled);
  }, []);

  const code = digits.join('');
  const complete = code.length === codeLength && digits.every(Boolean);

  const submit = React.useCallback(
    async (value: string) => {
      if (busy || value.length !== codeLength) return;
      setBusy(true);
      setError(null);
      try {
        await api.post('/api/public/verify-otp', { table_code: tableCode, code: value });
        // the cookie is set by that response; a full load picks up the session
        window.location.href = `/t/${tableCode}`;
      } catch (err) {
        const payload = err instanceof ApiError ? (err.payload as VerifyError | undefined) : undefined;
        const reason = err instanceof ApiError ? err.code : undefined;
        if (reason === 'WRONG') {
          setAttemptsLeft(payload?.attemptsLeft ?? null);
          setError(t.codeWrong.replace('{left}', String(payload?.attemptsLeft ?? 0)));
        } else if (reason === 'TOO_MANY' || reason === 'LOCKED') {
          setError(t.codeLocked);
        } else if (reason === 'EXPIRED' || reason === 'NO_CODE' || reason === 'NO_OPEN_CODE') {
          setError(t.codeExpired);
        } else if (reason === 'DEVICE_CAP') {
          setError(err instanceof ApiError ? err.message : '');
        } else if (err instanceof ApiError && err.status === 429) {
          setError(err.message);
        } else {
          setError(err instanceof ApiError ? err.message : t.retry);
        }
        setDigits(Array(codeLength).fill(''));
        inputs.current[0]?.focus();
      } finally {
        setBusy(false);
      }
    },
    [busy, codeLength, tableCode, t],
  );

  function setDigit(i: number, value: string) {
    const clean = value.replace(/\D/g, '');
    if (!clean) {
      setDigits((d) => d.map((x, idx) => (idx === i ? '' : x)));
      return;
    }
    setDigits((d) => {
      const next = [...d];
      // pasting the whole code into one box fills the rest
      for (let k = 0; k < clean.length && i + k < codeLength; k++) next[i + k] = clean[k];
      return next;
    });
    const target = Math.min(i + clean.length, codeLength - 1);
    inputs.current[target]?.focus();
    const joined = (() => {
      const next = [...digits];
      for (let k = 0; k < clean.length && i + k < codeLength; k++) next[i + k] = clean[k];
      return next.join('');
    })();
    if (joined.length === codeLength && /^\d+$/.test(joined)) void submit(joined);
  }

  function onKeyDown(i: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && !digits[i] && i > 0) {
      e.preventDefault();
      setDigits((d) => d.map((x, idx) => (idx === i - 1 ? '' : x)));
      inputs.current[i - 1]?.focus();
    }
    if (e.key === 'ArrowLeft' && i > 0) inputs.current[i - 1]?.focus();
    if (e.key === 'ArrowRight' && i < codeLength - 1) inputs.current[i + 1]?.focus();
    if (e.key === 'Enter' && complete) void submit(code);
  }

  async function askAgain() {
    if (cooldown > 0 || asking) return;
    setAsking(true);
    try {
      const res = await api.post<{
        retry_after: number;
        staff_offline: boolean;
        awaiting_waiter?: boolean;
      }>('/api/public/session', { table_code: tableCode });
      setOffline(Boolean(res.staff_offline));
      setWaiting(Boolean(res.awaiting_waiter));
      setCooldown(res.retry_after || 60);
      setAsked(true);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.retry);
    } finally {
      setAsking(false);
    }
  }

  return (
    <main className="relative z-10 flex min-h-dvh flex-col px-5 pb-6 pt-8">
      <header className="mb-6 text-center">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-stone-500">{restaurantName}</p>
          {/* language is reachable before the code: many guests need Hindi first */}
          <button
            type="button"
            onClick={() => {
              const next = locale === 'en' ? 'hi' : 'en';
              setLocale(next);
              document.documentElement.lang = next;
            }}
            className="flex min-h-11 items-center gap-1.5 rounded-full bg-stone-100 px-3 text-xs font-semibold text-stone-700"
            aria-label={locale === 'en' ? 'हिंदी में देखें' : 'View in English'}
            title={locale === 'en' ? 'हिंदी में देखें' : 'View in English'}
          >
            <Languages className="h-4 w-4" aria-hidden />
            {locale === 'en' ? 'हिं' : 'EN'}
          </button>
        </div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-stone-900">
          {t.codeTitle}
        </h1>
        <p className="mx-auto mt-2 max-w-xs text-sm text-stone-600">
          {t.codeSubtitle
            .replace('{n}', String(codeLength))
            .replace('{table}', String(tableNumber))}
        </p>
      </header>

      <div className="mx-auto w-full max-w-sm">
        <div className="flex justify-center gap-2" role="group" aria-label={t.codeLabel}>
          {digits.map((d, i) => (
            <input
              key={i}
              ref={(el) => {
                inputs.current[i] = el;
              }}
              value={d}
              onChange={(e) => setDigit(i, e.target.value)}
              onKeyDown={(e) => onKeyDown(i, e)}
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={codeLength}
              aria-label={`${t.codeLabel} ${i + 1}`}
              // 56px tall: readable at arm's length and above the 44px touch target
              className="h-14 w-12 rounded-xl border border-stone-300 bg-white text-center text-2xl font-semibold text-stone-900 shadow-sm outline-none focus:border-stone-900 focus:ring-2 focus:ring-stone-900/10 disabled:opacity-60"
              disabled={busy}
              
            />
          ))}
        </div>

        {error && (
          <p role="alert" className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-center text-sm text-red-700">
            {error}
          </p>
        )}

        {cookieProblem && (
          <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-center text-xs text-amber-800">
            Your browser is blocking cookies, so this device cannot stay signed in to the table.
            Open the link in Safari or Chrome (not the Instagram/Facebook browser) or allow cookies,
            then try again.
          </p>
        )}

        <button
          type="button"
          onClick={() => void submit(code)}
          disabled={!complete || busy}
          className="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-stone-900 text-base font-semibold text-white disabled:opacity-40"
        >
          {busy ? t.codeAsking : t.codeSubmit}
          {!busy && <ArrowRight className="h-4 w-4" aria-hidden />}
        </button>

        <div className="mt-6 rounded-xl bg-stone-100 p-4 text-center">
          <p className="text-sm text-stone-600">
            {waiting || asked ? (
              <span className="font-medium text-stone-900">{t.codeAsking}</span>
            ) : (
              t.codeAskPrompt
            )}
          </p>
          <button
            type="button"
            onClick={() => void askAgain()}
            disabled={cooldown > 0 || asking}
            className="mt-2 inline-flex min-h-11 items-center justify-center rounded-lg px-4 text-sm font-semibold text-stone-900 underline decoration-stone-300 underline-offset-4 disabled:no-underline disabled:opacity-50"
          >
            {cooldown > 0 ? t.codeWait.replace('{s}', String(cooldown)) : t.codeAskAgain}
          </button>
        </div>

        {offline && (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-center">
            <p className="text-sm font-medium text-amber-900">{t.codeNoStaff}</p>
            {phone && (
              <a
                href={`tel:${phone}`}
                className="mt-2 inline-flex min-h-11 items-center gap-2 rounded-lg bg-amber-900 px-4 text-sm font-semibold text-white"
              >
                <Phone className="h-4 w-4" aria-hidden />
                {t.codeCallStaff}
              </a>
            )}
          </div>
        )}

        <Link
          href={menuHref}
          className="mt-6 flex min-h-11 items-center justify-center gap-2 rounded-xl border border-stone-200 bg-white px-4 text-sm font-medium text-stone-700"
        >
          <UtensilsCrossed className="h-4 w-4" aria-hidden />
          {t.viewMenu}
        </Link>
        <p className="mt-2 text-center text-xs text-stone-500">{t.codePreviewNote}</p>
      </div>

      <p className="mt-auto pt-8 text-center text-[11px] text-stone-400">{t.codeFooter}</p>
    </main>
  );
}

/**
 * Shown when the session dies while the guest is inside (waiter closed the table,
 * 90 min idle, or the 4 h cap). The visit and the bill are untouched.
 */
export function SessionEndedScreen({ tableCode }: { tableCode: string }) {
  const { t } = useLocale();
  return (
    <main className="relative z-10 flex min-h-dvh flex-col items-center justify-center px-6 text-center">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold text-stone-900">{t.codeSessionEnded}</h1>
        <p className="mt-2 text-sm text-stone-600">{t.codeSessionEndedBody}</p>
        <Link
          href={`/t/${tableCode}`}
          className="mt-5 flex h-12 items-center justify-center rounded-xl bg-stone-900 text-base font-semibold text-white"
        >
          {t.codeTitle}
        </Link>
      </div>
    </main>
  );
}

/** Small helper used by the menu preview: a disabled stepper row. */
export function PreviewHint() {
  const { t } = useLocale();
  return (
    <p className="rounded-lg bg-stone-100 px-3 py-2 text-center text-xs font-medium text-stone-600">
      {t.codeEnterToOrder}
    </p>
  );
}
