'use client';

import * as React from 'react';
import { supabaseBrowser } from '@/lib/supabase-browser';
import { playSound, vibrate } from '@/lib/sounds';

export type StaffEvent = {
  type:
    | 'new_order'
    | 'waiter_call'
    | 'bill_request'
    | 'order_ready'
    | 'order_status'
    | 'otp_request'
    | 'otp_dismissed'
    | 'otp_locked';
  tableNumber?: number;
  orderId?: string;
  payload?: Record<string, unknown>;
  at?: number;
};

type Options = {
  restaurantId: string;
  sounds: Record<string, string>;
  onEvent: (event: StaffEvent) => void;
  /** poll interval in ms when realtime is unavailable */
  pollMs?: number;
  /** fetch a fingerprint so the poller only fires on change */
  fetchFingerprint?: () => Promise<string>;
};

/**
 * Staff realtime feed.
 *  - Supabase mode: subscribes to the restaurant broadcast channel + postgres
 *    changes on orders / waiter_calls, RLS applies to the browser JWT.
 *  - Fallback mode:  polls a compact fingerprint endpoint, so the same audio +
 *    refresh path runs everywhere (dev, self-hosted, degraded networks).
 */
export function useStaffFeed({ restaurantId, sounds, onEvent, pollMs = 5000, fetchFingerprint }: Options) {
  const [mode, setMode] = React.useState<'realtime' | 'polling'>('polling');
  const handler = React.useRef(onEvent);
  handler.current = onEvent;
  const soundMap = React.useRef(sounds);
  soundMap.current = sounds;

  const emit = React.useCallback((event: StaffEvent) => {
    handler.current(event);
    const soundName =
      event.type === 'new_order'
        ? soundMap.current.new_order
        : event.type === 'waiter_call'
          ? soundMap.current.waiter_call
          : event.type === 'bill_request'
            ? soundMap.current.bill_request
            : event.type === 'order_ready'
              ? soundMap.current.order_ready
              : event.type === 'otp_request'
                ? soundMap.current.otp_request
                : null;
    if (soundName) {
      playSound(soundName, 0.35);
      vibrate(
        event.type === 'new_order' || event.type === 'otp_request' ? [80, 40, 80] : [60, 40, 60],
      );
    }
  }, []);

  // ---------------------------------------------------------------- realtime
  React.useEffect(() => {
    const client = supabaseBrowser();
    if (!client) return;

    setMode('realtime');
    const channel = client
      .channel(`restaurant-${restaurantId}`, { config: { broadcast: { self: false } } })
      .on('broadcast', { event: 'staff-event' }, ({ payload }) => {
        emit(payload as StaffEvent);
      })
      .subscribe();

    const tables = client
      .channel(`db-${restaurantId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders', filter: `restaurant_id=eq.${restaurantId}` },
        (payload) => {
          const row: any = payload.new ?? payload.old;
          if (!row) return;
          const type =
            payload.eventType === 'INSERT'
              ? 'new_order'
              : row.status === 'ready'
                ? 'order_ready'
                : 'order_status';
          emit({ type: type as StaffEvent['type'], orderId: row.id, payload: { status: row.status } });
        },
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'waiter_calls', filter: `restaurant_id=eq.${restaurantId}` },
        (payload) => {
          const row: any = payload.new;
          emit({ type: row?.type === 'bill' ? 'bill_request' : 'waiter_call', payload: { id: row?.id } });
        },
      )
      .subscribe();

    return () => {
      void client.removeChannel(channel);
      void client.removeChannel(tables);
    };
  }, [restaurantId, emit]);

  // ---------------------------------------------------------------- polling
  React.useEffect(() => {
    if (!fetchFingerprint) return;
    let last: string | null = null;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const tick = async () => {
      if (cancelled) return;
      try {
        if (document.visibilityState === 'visible' && mode === 'polling') {
          const fingerprint = await fetchFingerprint();
          if (last !== null && fingerprint !== last) {
            emit({ type: 'order_status', payload: { fingerprint } });
            playSound(soundMap.current.new_order, 0.3);
            vibrate([60, 40, 60]);
          }
          last = fingerprint;
        }
      } catch {
        /* network blip — try again next tick */
      }
      timer = setTimeout(tick, pollMs);
    };
    tick();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [fetchFingerprint, pollMs, mode, emit]);

  return { mode };
}
