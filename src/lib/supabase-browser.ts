'use client';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null = null;

/**
 * Browser Supabase client for staff realtime only. It authenticates with the
 * access token captured at login (non-HttpOnly cookie), so RLS policies still
 * restrict the socket to the staff member's own restaurant.
 * Returns null when the app runs in local Postgres mode.
 */
export function supabaseBrowser(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  if (typeof document === 'undefined') return null;

  if (client) return client;

  const token = document.cookie
    .split('; ')
    .find((c) => c.startsWith('tt_sb_access='))
    ?.split('=')[1];

  client = createClient(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: token ? { headers: { Authorization: `Bearer ${token}` } } : undefined,
    realtime: token ? { params: { apikey: anonKey } } : undefined,
  });

  if (token) {
    void client.realtime.setAuth(token);
  }
  return client;
}
