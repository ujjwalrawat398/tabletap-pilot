'use client';

import * as React from 'react';
import { api, ApiError } from '@/lib/api-client';
import { dict, LocaleContext, type Locale } from '@/lib/i18n';
import type { Cart, OrderView, RestaurantGameInfo } from '@/types';

type SessionInfo = {
  id: string;
  table_number: number;
  table_label: string | null;
  expires_at: string;
};

type StateResponse = {
  session: SessionInfo;
  guest_no: number;
  restaurantGame?: RestaurantGameInfo;
  cart: Cart;
  orders: OrderView[];
  review: { rating: number; routed_to: string } | null;
  accent: string;
  currency: string;
  settings: Record<string, any>;
};

type CustomerContextValue = {
  tableCode: string;
  restaurantGame: RestaurantGameInfo;
  session: SessionInfo | null;
  guestNo: number;
  cart: Cart | null;
  orders: OrderView[];
  review: { rating: number; routed_to: string } | null;
  settings: Record<string, any>;
  currency: string;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  addToCart: (menuItemId: string, qty?: number, notes?: string) => Promise<void>;
  setQty: (cartItemId: string, qty: number) => Promise<void>;
  removeLine: (cartItemId: string) => Promise<void>;
  sendOrder: (notes?: string) => Promise<void>;
  callWaiter: (type: 'call' | 'bill') => Promise<void>;
  lastEvent: { type: string; at: number } | null;
};

const CustomerContext = React.createContext<CustomerContextValue | null>(null);

export function useCustomer() {
  const ctx = React.useContext(CustomerContext);
  if (!ctx) throw new Error('useCustomer must be used inside CustomerProvider');
  return ctx;
}

export function CustomerProvider({
  tableCode,
  initial,
  children,
}: {
  tableCode: string;
  initial: StateResponse;
  children: React.ReactNode;
}) {
  const [state, setState] = React.useState<StateResponse>(initial);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [lastEvent, setLastEvent] = React.useState<{ type: string; at: number } | null>(null);
  const [locale, setLocaleState] = React.useState<Locale>('en');

  React.useEffect(() => {
    const stored = (localStorage.getItem('tt_locale') as Locale | null) ?? null;
    if (stored === 'hi' || stored === 'en') setLocaleState(stored);
  }, []);

  const setLocale = React.useCallback((l: Locale) => {
    setLocaleState(l);
    localStorage.setItem('tt_locale', l);
  }, []);

  const applyState = React.useCallback((data: StateResponse) => {
    setState((prev) => {
      // detect a status change so the UI can animate / vibrate
      const prevStatuses = new Map(prev.orders.map((o) => [o.id, o.status]));
      const changed = data.orders.find((o) => prevStatuses.get(o.id) && prevStatuses.get(o.id) !== o.status);
      if (changed) setLastEvent({ type: changed.status, at: Date.now() });
      return data;
    });
    setError(null);
  }, []);

  /** Silent refresh used by polling — never toggles the loading flag. */
  const refreshSilent = React.useCallback(async () => {
    try {
      const data = await api.get<StateResponse>(`/api/public/state?t=${encodeURIComponent(tableCode)}`);
      applyState(data);
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 404)) {
        setError('SESSION_INVALID');
      }
    }
  }, [tableCode, applyState]);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<StateResponse>(`/api/public/state?t=${encodeURIComponent(tableCode)}`);
      applyState(data);
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 404)) {
        setError('SESSION_INVALID');
      }
    } finally {
      setLoading(false);
    }
  }, [tableCode, applyState]);

  // live updates: poll every 4s while visible (works with or without Supabase)
  React.useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let cancelled = false;

    const tick = async () => {
      if (cancelled) return;
      if (document.visibilityState === 'visible') await refreshSilent();
      timer = setTimeout(tick, 4000);
    };
    timer = setTimeout(tick, 2000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [refreshSilent]);

  const mutate = React.useCallback(
    async (fn: () => Promise<void>) => {
      setLoading(true);
      try {
        await fn();
        await refreshSilent();
      } finally {
        setLoading(false);
      }
    },
    [refreshSilent],
  );

  const addToCart = React.useCallback(
    (menuItemId: string, qty = 1, notes?: string) =>
      mutate(async () => {
        const res = await api.post<{ cart: Cart }>('/api/public/cart', {
          table_code: tableCode,
          op: 'add',
          payload: { menuItemId, qty, notes },
        });
        setState((s) => ({ ...s, cart: res.cart }));
      }),
    [mutate, tableCode],
  );

  const setQty = React.useCallback(
    (cartItemId: string, qty: number) =>
      mutate(async () => {
        const res = await api.post<{ cart: Cart }>('/api/public/cart', {
          table_code: tableCode,
          op: 'qty',
          payload: { cartItemId, qty },
        });
        setState((s) => ({ ...s, cart: res.cart }));
      }),
    [mutate, tableCode],
  );

  const removeLine = React.useCallback(
    (cartItemId: string) =>
      mutate(async () => {
        const res = await api.post<{ cart: Cart }>('/api/public/cart', {
          table_code: tableCode,
          op: 'remove',
          payload: { cartItemId },
        });
        setState((s) => ({ ...s, cart: res.cart }));
      }),
    [mutate, tableCode],
  );

  const sendOrder = React.useCallback(
    (notes?: string) =>
      mutate(async () => {
        const res = await api.post<{ orderId: string; orders: OrderView[] }>('/api/public/order', {
          table_code: tableCode,
          payload: { notes },
        });
        setState((s) => ({ ...s, orders: res.orders, cart: { ...s.cart, lines: [], subtotal: 0, itemCount: 0 } }));
      }),
    [mutate, tableCode],
  );

  const callWaiter = React.useCallback(
    (type: 'call' | 'bill') =>
      mutate(async () => {
        await api.post('/api/public/call', { table_code: tableCode, payload: { type } });
      }),
    [mutate, tableCode],
  );

  const value: CustomerContextValue = {
    tableCode,
    restaurantGame: state.restaurantGame ?? null,
    session: state.session,
    guestNo: state.guest_no,
    cart: state.cart,
    orders: state.orders,
    review: state.review,
    settings: state.settings,
    currency: state.currency,
    loading,
    error,
    refresh,
    addToCart,
    setQty,
    removeLine,
    sendOrder,
    callWaiter,
    lastEvent,
  };

  return (
      <LocaleContext.Provider value={{ locale, setLocale, t: dict[locale] }}>
        <CustomerContext.Provider value={value}>{children}</CustomerContext.Provider>
      </LocaleContext.Provider>
  );
}
