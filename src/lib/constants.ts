export const HINDI_READY = true;

export const ORDER_STATUS_LABEL = {
  pending: { en: 'Waiting for waiter', hi: 'वेटर की प्रतीक्षा' },
  confirmed: { en: 'Confirmed', hi: 'पुष्टि हुई' },
  rejected: { en: 'Rejected', hi: 'अस्वीकृत' },
  preparing: { en: 'Preparing', hi: 'तैयार हो रहा है' },
  ready: { en: 'Ready', hi: 'तैयार' },
  served: { en: 'Served', hi: 'परोसा गया' },
  cancelled: { en: 'Cancelled', hi: 'रद्द' },
} as const;

export const ORDER_STATUS_COLOR = {
  pending: 'bg-amber-500 text-white',
  confirmed: 'bg-blue-600 text-white',
  rejected: 'bg-red-600 text-white',
  preparing: 'bg-indigo-600 text-white',
  ready: 'bg-emerald-600 text-white',
  served: 'bg-neutral-500 text-white',
  cancelled: 'bg-neutral-400 text-white',
} as const;

export const STAFF_HOME = { admin: '/admin', waiter: '/waiter', kitchen: '/kitchen' } as const;

export const SOUND_OPTIONS = {
  new_order: ['chime', 'bell', 'ding', 'double', 'alarm'],
  waiter_call: ['bell', 'chime', 'alarm'],
  bill_request: ['cash', 'alarm', 'chime'],
  order_ready: ['ding', 'chime', 'bell'],
  // "a guest is waiting for the table code" — its own tone, never shared with orders
  otp_request: ['otp', 'ding', 'bell'],
} as const;

export type SoundEvent = keyof typeof SOUND_OPTIONS;

export const SESSION_TTL_HOURS = 3;
/** Hard cap for one visit; never extended by activity. Overridden per restaurant. */
export const HARD_CAP_HOURS = 4;
/** Scan endpoint: generous, because every guest on the restaurant Wi-Fi shares an IP. */
export const OTP_VERIFY_RATE_LIMIT = { attempts: 60, windowSeconds: 600 };
export const WAITER_CALL_COOLDOWN_SECONDS = 30;
export const ORDER_RATE_LIMIT = { perSession: 6, windowSeconds: 300 };
export const LOGIN_RATE_LIMIT = { attempts: 8, windowSeconds: 600 };
/** NFC/QR scans per IP. Walk-ins share the restaurant's Wi-Fi IP, so keep it loose. */
export const SCAN_RATE_LIMIT = { attempts: 120, windowSeconds: 600 };
export const QUIZ_ANSWER_RATE_LIMIT = { perPlayer: 40, windowSeconds: 300 };

/**
 * "Play with my table" and "whole restaurant" games run on the SERVER's clock:
 * every phone sees the same question at the same time, each question lasts
 * SYNC_QUESTION_SECONDS, and nobody can join once the first question has started.
 * Players get SYNC_INSTRUCTION_SECONDS to read how points work before that.
 */
export const SYNC_QUESTION_SECONDS = 15;
export const SYNC_INSTRUCTION_SECONDS = 25;

/**
 * Whole-restaurant game, started by the admin: 1 minute to join, then SYNC_INSTRUCTION_SECONDS to
 * read the rules (nobody joins any more), then the match starts by itself. It is cancelled by
 * itself if fewer than RESTAURANT_MIN_TABLES tables have joined. At most 2 phones per table.
 */
export const RESTAURANT_JOIN_WINDOW_SECONDS = 60;
export const RESTAURANT_MIN_TABLES = 2;
export const RESTAURANT_MAX_PLAYERS_PER_TABLE = 2;
