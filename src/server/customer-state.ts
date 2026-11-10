import 'server-only';
import { db } from '@/server/db';
import { getGuestNo, requireSession } from '@/server/session';
import { getCart } from '@/server/repos/cart';
import { getSessionOrders } from '@/server/repos/orders';
import { getReviewForSession } from '@/server/repos/service';
import { getRestaurantGameBanner } from '@/server/repos/games';
import type { Cart, OrderView, RestaurantGameInfo } from '@/types';

/**
 * One shared snapshot builder: the API route and the server components both
 * use this so a page never has to fetch its own HTTP endpoint.
 */
export type CustomerState = {
  /**
   * true when this phone has NOT entered the table code yet: the shell is a
   * read-only preview (no session id, no cart writes, no orders) — see
   * `needs_code`. Ordering endpoints reject it because the session id is empty.
   */
  needs_code?: boolean;
  /** read-only menu for the preview; null on the verified snapshot */
  preview_menu?: unknown;
  session: {
    id: string;
    table_number: number;
    table_label: string | null;
    expires_at: string;
  };
  guest_no: number;
  /** the restaurant game the admin started, for the banner (null when none is on) */
  restaurantGame: RestaurantGameInfo;
  cart: Cart;
  orders: OrderView[];
  review: { rating: number; routed_to: string } | null;
  accent: string;
  currency: string;
  settings: PublicSettings;
};

export type PublicSettings = {
  restaurant_name: string;
  slug: string;
  logo_url: string | null;
  accent_color: string;
  currency: string;
  wifi_ssid: string | null;
  /** Never selected here on purpose — see getWifiCard() for the gated password. */
  google_review_url: string | null;
  instagram_url: string | null;
  facebook_url: string | null;
  website_url: string | null;
  phone: string | null;
  address: string | null;
  session_hours: number;
  /** read-only menu before the code is entered (admin setting J1) */
  menu_preview_before_code: boolean;
  code_length: number;
};

export async function getPublicSettings(restaurantId: string): Promise<PublicSettings> {
  const r = await db.one<any>(
    `select name, slug, logo_url, accent_color, currency, wifi_ssid,
            google_review_url, instagram_url, facebook_url, website_url, phone, address,
            menu_preview_before_code, otp_length, session_max_hours
       from restaurants where id = $1`,
    [restaurantId],
  );
  return {
    restaurant_name: r?.name ?? '',
    slug: r?.slug ?? '',
    logo_url: r?.logo_url ?? null,
    accent_color: r?.accent_color ?? '#e85d2a',
    currency: r?.currency ?? 'INR',
    wifi_ssid: r?.wifi_ssid ?? null,
    google_review_url: r?.google_review_url ?? null,
    instagram_url: r?.instagram_url ?? null,
    facebook_url: r?.facebook_url ?? null,
    website_url: r?.website_url ?? null,
    phone: r?.phone ?? null,
    address: r?.address ?? null,
    session_hours: r?.session_max_hours ?? 4,
    menu_preview_before_code: r?.menu_preview_before_code ?? true,
    code_length: r?.otp_length ?? 4,
  };
}

export async function getCustomerState(tableCode: string): Promise<CustomerState> {
  const session = await requireSession(tableCode);
  const [cart, orders, review, guestNo, settings] = await Promise.all([
    getCart(session.id, session.restaurant_id),
    getSessionOrders(session.id),
    getReviewForSession(session.id),
    getGuestNo(tableCode),
    getPublicSettings(session.restaurant_id),
  ]);

  // one cheap query when no game is on (almost always); rides on the poll the phone already makes
  const restaurantGame = await getRestaurantGameBanner(session, guestNo).catch(() => null);

  return {
    session: {
      id: session.id,
      table_number: session.table_number,
      table_label: session.table_label,
      expires_at: session.expires_at,
    },
    guest_no: guestNo,
    restaurantGame,
    cart,
    orders,
    review: review ? { rating: review.rating, routed_to: review.routed_to } : null,
    accent: session.accent_color,
    currency: session.currency,
    settings,
  };
}

/**
 * Same snapshot, but never throws: returns a "no session yet" shell so the guest
 * landing page can render and let the client create its session. Sub-pages keep
 * using getCustomerState() and send the guest home when it throws.
 */
export async function getCustomerStateSafe(tableCode: string): Promise<CustomerState | null> {
  try {
    const state = await getCustomerState(tableCode);
    return { ...state, needs_code: false };
  } catch {
    return getGuestShell(tableCode);
  }
}

/**
 * The unverified shell. It carries the read-only menu (when the restaurant allows
 * previewing it) but an EMPTY session id, so every write endpoint refuses it —
 * browsing works, ordering does not.
 */
export async function getGuestShell(tableCode: string): Promise<CustomerState | null> {
  const table = await db.one<{ restaurant_id: string; number: number; label: string | null }>(
    `select restaurant_id, number, label from tables where table_code = $1`,
    [tableCode],
  );
  if (!table) return null;
  const settings = await getPublicSettings(table.restaurant_id);
  let preview: unknown = null;
  if (settings.menu_preview_before_code) {
    const { getMenu } = await import('@/server/repos/menu');
    preview = await getMenu(table.restaurant_id);
  }
  return {
    needs_code: true,
    preview_menu: preview,
    session: { id: '', table_number: table.number, table_label: table.label, expires_at: '' },
    guest_no: 1,
    restaurantGame: null,
    cart: { id: '', lines: [], subtotal: 0, itemCount: 0 },
    orders: [],
    review: null,
    accent: settings.accent_color,
    currency: settings.currency,
    settings,
  };
}

/** Public menu for a table code (no session required — read-only). */
export async function getMenuForCode(tableCode: string) {
  const { getMenu } = await import('@/server/repos/menu');
  try {
    const session = await requireSession(tableCode);
    return getMenu(session.restaurant_id);
  } catch {
    // no code entered yet: the menu still renders, read-only (D2)
    const table = await db.one<{ restaurant_id: string }>(
      `select restaurant_id from tables where table_code = $1 and is_active`,
      [tableCode],
    );
    if (!table) throw new Error('TABLE_INVALID');
    return getMenu(table.restaurant_id);
  }
}

/**
 * Page-level loader for guest sub-pages: if the session is gone (waiter closed
 * the table, or the 3h TTL elapsed) we send the guest back to the landing page,
 * which re-mints a session and shows the "scan again" copy if the table code is
 * no longer valid.
 */
export async function getCustomerStateForPage(tableCode: string): Promise<CustomerState | null> {
  return getCustomerStateSafe(tableCode).then((state) => (state?.session.id ? state : null));
}
