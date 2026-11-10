'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Gamepad2, Loader2 } from 'lucide-react';
import { api } from '@/lib/api-client';
import { useToast } from '@/components/ui/toast';
import { useCustomer } from '@/components/customer/CustomerProvider';

/**
 * Shown on the home and menu screens while the admin has a restaurant game on.
 * It rides on the state poll the phone already makes, so it costs no extra requests.
 *   join  : "Restaurant game · starts in 0:48 · Join"   (one tap joins and opens the game)
 *   rules : joined -> "Starting in 0:18 · open"   not joined -> nothing (joining is closed)
 *   live  : joined -> "Game in progress · back to it"  not joined -> nothing
 */
export function RestaurantGameBanner() {
  const { restaurantGame: game, tableCode } = useCustomer();
  const router = useRouter();
  const { push } = useToast();
  const [busy, setBusy] = React.useState(false);

  // the server's clock, not this phone's: the offset is refreshed with every poll
  const offset = React.useMemo(
    () => (game ? new Date(game.serverNow).getTime() - Date.now() : 0),
    [game?.serverNow, game?.id], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (!game) return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [game?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!game || game.left) return null;
  const serverNow = now + offset;
  const secs = (iso: string) => Math.max(0, Math.ceil((new Date(iso).getTime() - serverNow) / 1000));
  const mmss = (n: number) => `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;

  async function join() {
    if (busy) return;
    setBusy(true);
    try {
      const out = await api.post<{ roundId: string }>('/api/public/games/start', {
        table_code: tableCode,
        payload: { mode: 'restaurant', categoryId: null },
      });
      router.push(`/t/${tableCode}/games/round/${out.roundId}`);
    } catch (err) {
      push(err instanceof Error ? err.message : 'Could not join the game', 'error');
      setBusy(false);
    }
  }

  const strip =
    'relative z-10 mx-4 mt-3 flex items-center gap-3 rounded-2xl border border-primary/30 bg-primary/10 p-3 text-left shadow-card';

  if (game.phase === 'join') {
    const left = secs(game.joinClosesAt);
    if (game.joined) {
      return (
        <Link href={`/t/${tableCode}/games/round/${game.id}`} className={strip}>
          <Gamepad2 className="h-5 w-5 text-primary" aria-hidden />
          <div className="flex-1">
            <p className="text-sm font-semibold">You are in the restaurant game</p>
            <p className="text-xs text-muted-foreground">Joining closes in {mmss(left)} · tap to open</p>
          </div>
        </Link>
      );
    }
    return (
      <button type="button" onClick={join} disabled={busy || game.tableFull} className={`${strip} w-[calc(100%-2rem)] disabled:opacity-70`}>
        <Gamepad2 className="h-5 w-5 text-primary" aria-hidden />
        <div className="flex-1">
          <p className="text-sm font-semibold">Restaurant game · starts in {mmss(secs(game.startsAt))}</p>
          <p className="text-xs text-muted-foreground">
            {game.tableFull ? 'Your table already has 2 players' : 'Win a prize for your table · tap to join'}
          </p>
        </div>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : !game.tableFull && <span className="rounded-full bg-primary px-3 py-1 text-xs font-bold text-primary-foreground">Join</span>}
      </button>
    );
  }

  if (!game.joined) return null;
  return (
    <Link href={`/t/${tableCode}/games/round/${game.id}`} className={strip}>
      <Gamepad2 className="h-5 w-5 text-primary" aria-hidden />
      <div className="flex-1">
        <p className="text-sm font-semibold">
          {game.phase === 'rules' ? `Game starts in ${mmss(secs(game.startsAt))}` : 'Restaurant game in progress'}
        </p>
        <p className="text-xs text-muted-foreground">Tap to go back to it</p>
      </div>
    </Link>
  );
}
