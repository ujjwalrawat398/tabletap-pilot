'use client';

import * as React from 'react';
import { AdminShell } from '@/components/staff/AdminShell';
import { api } from '@/lib/api-client';
import { useToast } from '@/components/ui/toast';
import { Button } from '@/components/ui/button';
import { Input, Label, Select, Textarea } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { playSound, unlockAudio } from '@/lib/sounds';
import { SOUND_OPTIONS, type SoundEvent } from '@/lib/constants';
import type { StaffUser } from '@/types';
import {
  Palette,
  Save,
  Volume2,
  Wifi,
  Star,
  Settings2,
  MapPin,
  Percent,
  KeyRound,
  ShieldAlert,
} from 'lucide-react';

type Restaurant = {
  name: string;
  logo_url: string | null;
  accent_color: string;
  wifi_ssid: string | null;
  wifi_password: string | null;
  google_review_url: string | null;
  instagram_url: string | null;
  facebook_url: string | null;
  website_url: string | null;
  phone: string | null;
  address: string | null;
  tax_percent: string | number;
  service_charge_percent: string | number;
  // table-code / session rules (J1)
  otp_length?: number;
  otp_window_minutes?: number;
  otp_max_attempts?: number;
  otp_reissue_cooldown_seconds?: number;
  max_devices_per_session?: number;
  session_idle_minutes?: number;
  session_max_hours?: number;
  auto_confirm_orders?: boolean;
  menu_preview_before_code?: boolean;
};

type Settings = {
  sounds?: Partial<Record<SoundEvent, string>>;
  games?: Record<string, unknown>;
};

const ACCENTS = ['#e85d2a', '#0f766e', '#7c3aed', '#b91c1c', '#1d4ed8', '#166534', '#a16207', '#be185d'];

export function AdminSettings({
  user,
  restaurant,
  settings,
}: {
  user: StaffUser;
  restaurant: Restaurant;
  settings: Settings;
}) {
  const { push } = useToast();
  const [busy, setBusy] = React.useState<string | boolean>(false);
  const [form, setForm] = React.useState({
    name: restaurant.name,
    logoUrl: restaurant.logo_url ?? '',
    accentColor: restaurant.accent_color,
    wifiSsid: restaurant.wifi_ssid ?? '',
    wifiPassword: restaurant.wifi_password ?? '',
    googleReviewUrl: restaurant.google_review_url ?? '',
    instagramUrl: restaurant.instagram_url ?? '',
    facebookUrl: restaurant.facebook_url ?? '',
    websiteUrl: restaurant.website_url ?? '',
    phone: restaurant.phone ?? '',
    address: restaurant.address ?? '',
    taxPercent: Number(restaurant.tax_percent ?? 0),
    serviceChargePercent: Number(restaurant.service_charge_percent ?? 0),
  });

  const [sounds, setSounds] = React.useState<Record<SoundEvent, string>>({
    new_order: settings.sounds?.new_order ?? 'chime',
    waiter_call: settings.sounds?.waiter_call ?? 'bell',
    bill_request: settings.sounds?.bill_request ?? 'cash',
    order_ready: settings.sounds?.order_ready ?? 'ding',
    otp_request: settings.sounds?.otp_request ?? 'otp',
  });

  // Table codes + session limits (spec §3, J1). Ranges match the DB check
  // constraints in migration 0006, so the form cannot submit an invalid value.
  const [otp, setOtp] = React.useState({
    length: Number(restaurant.otp_length ?? 4),
    windowMinutes: Number(restaurant.otp_window_minutes ?? 10),
    maxAttempts: Number(restaurant.otp_max_attempts ?? 5),
    cooldownSeconds: Number(restaurant.otp_reissue_cooldown_seconds ?? 60),
    maxDevices: Number(restaurant.max_devices_per_session ?? 12),
    idleMinutes: Number(restaurant.session_idle_minutes ?? 90),
    maxHours: Number(restaurant.session_max_hours ?? 4),
    autoConfirmOrders: Boolean(restaurant.auto_confirm_orders ?? false),
    menuPreview: Boolean(restaurant.menu_preview_before_code ?? true),
  });

  const otpInvalid =
    otp.length < 4 || otp.length > 6 ||
    otp.windowMinutes < 3 || otp.windowMinutes > 30 ||
    otp.maxAttempts < 3 || otp.maxAttempts > 10 ||
    otp.cooldownSeconds < 0 || otp.cooldownSeconds > 300 ||
    otp.maxDevices < 4 || otp.maxDevices > 20 ||
    otp.idleMinutes < 30 || otp.idleMinutes > 240 ||
    otp.maxHours < 1 || otp.maxHours > 8;

  const [games, setGames] = React.useState({
    roundsPerRound: Number((settings.games?.roundsPerRound as number) ?? 10),
    restaurantRoundIntervalMinutes: Number(
      (settings.games?.restaurantRoundIntervalMinutes as number) ?? 5,
    ),
    speedBonusMax: Number((settings.games?.speedBonusMax as number) ?? 50),
    pointsCorrect: Number((settings.games?.pointsCorrect as number) ?? 100),
    pointsMode: ((settings.games?.pointsMode as string) ?? 'sum') as 'sum' | 'average',
  });

  async function save() {
    if (otpInvalid) {
      push('Fix the table code settings first — a value is out of range.', 'error');
      return;
    }
    setBusy(true);
    try {
      await api.post('/api/admin/settings', {
        name: form.name,
        logoUrl: form.logoUrl || null,
        accentColor: form.accentColor,
        wifiSsid: form.wifiSsid || null,
        wifiPassword: form.wifiPassword || null,
        googleReviewUrl: form.googleReviewUrl || null,
        instagramUrl: form.instagramUrl || null,
        facebookUrl: form.facebookUrl || null,
        websiteUrl: form.websiteUrl || null,
        phone: form.phone || null,
        address: form.address || null,
        taxPercent: Number(form.taxPercent),
        serviceChargePercent: Number(form.serviceChargePercent),
        sounds,
        games,
        otp,
      });
      push('Settings saved', 'success');
      // apply the accent live
      document.documentElement.style.setProperty('--brand', form.accentColor);
    } catch (err) {
      push(err instanceof Error ? err.message : 'Could not save settings', 'error');
    } finally {
      setBusy(false);
    }
  }

  /** J3 — end every session and every code in one tap (closing time, leaked code). */
  async function endAllSessions() {
    if (!window.confirm('End every table session and delete every live code? Guests will have to ask for a new code.')) {
      return;
    }
    setBusy('panic');
    try {
      await api.post('/api/admin/end-all-sessions', { confirm: 'END' });
      push('All sessions ended and all codes cleared', 'success');
    } catch (err) {
      push(err instanceof Error ? err.message : 'Could not end the sessions', 'error');
    } finally {
      setBusy(false);
    }
  }

  function testSound(event: SoundEvent) {
    unlockAudio();
    playSound(sounds[event], 0.35);
  }

  return (
    <AdminShell user={user}>
      <div className="space-y-4">
        {/* brand */}
        <section className="rounded-2xl border border-border bg-card p-4">
          <h2 className="flex items-center gap-2 text-sm font-bold">
            <Palette className="h-4 w-4" /> Brand
          </h2>
          <div className="mt-2 space-y-3">
            <div>
              <Label htmlFor="r-name">Restaurant name</Label>
              <Input
                id="r-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="r-logo">Logo URL</Label>
              <Input
                id="r-logo"
                value={form.logoUrl}
                onChange={(e) => setForm({ ...form, logoUrl: e.target.value })}
                placeholder="https://…/logo.png"
                className="mt-1"
              />
            </div>
            <div>
              <Label>Accent colour</Label>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                {ACCENTS.map((colour) => (
                  <button
                    key={colour}
                    type="button"
                    onClick={() => setForm({ ...form, accentColor: colour })}
                    className="h-9 w-9 rounded-full border-2 border-white shadow"
                    style={{ background: colour }}
                    aria-label={`Use ${colour}`}
                    aria-pressed={form.accentColor === colour}
                  />
                ))}
                <input
                  type="color"
                  value={form.accentColor}
                  onChange={(e) => setForm({ ...form, accentColor: e.target.value })}
                  className="h-9 w-14 rounded border border-border"
                  aria-label="Custom accent colour"
                />
                <code className="text-xs text-muted-foreground">{form.accentColor}</code>
              </div>
            </div>
          </div>
        </section>

        {/* wifi */}
        <section className="rounded-2xl border border-border bg-card p-4">
          <h2 className="flex items-center gap-2 text-sm font-bold">
            <Wifi className="h-4 w-4" /> Wi-Fi card
          </h2>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <div>
              <Label htmlFor="w-ssid">Network name</Label>
              <Input
                id="w-ssid"
                value={form.wifiSsid}
                onChange={(e) => setForm({ ...form, wifiSsid: e.target.value })}
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="w-pass">Password</Label>
              <Input
                id="w-pass"
                value={form.wifiPassword}
                onChange={(e) => setForm({ ...form, wifiPassword: e.target.value })}
                className="mt-1"
              />
            </div>
          </div>
        </section>

        {/* reviews */}
        <section className="rounded-2xl border border-border bg-card p-4">
          <h2 className="flex items-center gap-2 text-sm font-bold">
            <Star className="h-4 w-4" /> Review routing
          </h2>
          <div className="mt-2">
            <Label htmlFor="g-url">Google Maps review link</Label>
            <Input
              id="g-url"
              value={form.googleReviewUrl}
              onChange={(e) => setForm({ ...form, googleReviewUrl: e.target.value })}
              placeholder="https://search.google.com/local/writereview?placeid=…"
              className="mt-1"
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              4–5 star guests are sent here; 1–3 star guests write private feedback that only you see.
            </p>
          </div>
        </section>

        {/* contact + socials */}
        <section className="rounded-2xl border border-border bg-card p-4">
          <h2 className="flex items-center gap-2 text-sm font-bold">
            <MapPin className="h-4 w-4" /> Contact &amp; social
          </h2>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <div>
              <Label htmlFor="c-phone">Phone</Label>
              <Input
                id="c-phone"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="c-ig">Instagram</Label>
              <Input
                id="c-ig"
                value={form.instagramUrl}
                onChange={(e) => setForm({ ...form, instagramUrl: e.target.value })}
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="c-fb">Facebook</Label>
              <Input
                id="c-fb"
                value={form.facebookUrl}
                onChange={(e) => setForm({ ...form, facebookUrl: e.target.value })}
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="c-web">Website</Label>
              <Input
                id="c-web"
                value={form.websiteUrl}
                onChange={(e) => setForm({ ...form, websiteUrl: e.target.value })}
                className="mt-1"
              />
            </div>
          </div>
          <div className="mt-2">
            <Label htmlFor="c-addr">Address</Label>
            <Textarea
              id="c-addr"
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
              className="mt-1"
              rows={2}
            />
          </div>
        </section>

        {/* billing */}
        <section className="rounded-2xl border border-border bg-card p-4">
          <h2 className="flex items-center gap-2 text-sm font-bold">
            <Percent className="h-4 w-4" /> Billing
          </h2>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor="tax">Tax %</Label>
              <Input
                id="tax"
                type="number"
                min={0}
                max={30}
                step="0.5"
                value={form.taxPercent}
                onChange={(e) => setForm({ ...form, taxPercent: Number(e.target.value) })}
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="svc">Service charge %</Label>
              <Input
                id="svc"
                type="number"
                min={0}
                max={20}
                step="0.5"
                value={form.serviceChargePercent}
                onChange={(e) => setForm({ ...form, serviceChargePercent: Number(e.target.value) })}
                className="mt-1"
              />
            </div>
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Applied on the server when an order is placed; the customer sees the breakdown.
          </p>
        </section>

        {/* sounds */}
        <section className="rounded-2xl border border-border bg-card p-4">
          <h2 className="flex items-center gap-2 text-sm font-bold">
            <Volume2 className="h-4 w-4" /> Staff alert sounds
          </h2>
          <div className="mt-2 space-y-2">
            {(Object.keys(SOUND_OPTIONS) as SoundEvent[]).map((event) => (
              <div key={event} className="flex items-center gap-2">
                <span className="flex-1 text-sm capitalize">{event.replace('_', ' ')}</span>
                <Select
                  value={sounds[event]}
                  onChange={(e) => setSounds({ ...sounds, [event]: e.target.value })}
                  className="h-9 w-32 text-xs"
                  aria-label={`Sound for ${event}`}
                >
                  {SOUND_OPTIONS[event].map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </Select>
                <Button size="sm" variant="outline" onClick={() => testSound(event)}>
                  Test
                </Button>
              </div>
            ))}
          </div>
        </section>

        {/* table codes and sessions */}
        <section className="rounded-2xl border border-border bg-card p-4">
          <h2 className="flex items-center gap-2 text-sm font-bold">
            <KeyRound className="h-4 w-4" /> Table codes &amp; sessions
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Guests get the code from a waiter, in person. Changing these affects visits that
            start from now.
          </p>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor="o-len">Code length (digits)</Label>
              <Input
                id="o-len"
                type="number"
                min={4}
                max={6}
                value={otp.length}
                onChange={(e) => setOtp({ ...otp, length: Number(e.target.value) })}
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="o-win">Code valid for (min)</Label>
              <Input
                id="o-win"
                type="number"
                min={3}
                max={30}
                value={otp.windowMinutes}
                onChange={(e) => setOtp({ ...otp, windowMinutes: Number(e.target.value) })}
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="o-att">Wrong tries before the code dies</Label>
              <Input
                id="o-att"
                type="number"
                min={3}
                max={10}
                value={otp.maxAttempts}
                onChange={(e) => setOtp({ ...otp, maxAttempts: Number(e.target.value) })}
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="o-cool">Ask-again cooldown (sec)</Label>
              <Input
                id="o-cool"
                type="number"
                min={0}
                max={300}
                value={otp.cooldownSeconds}
                onChange={(e) => setOtp({ ...otp, cooldownSeconds: Number(e.target.value) })}
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="o-dev">Phones per table</Label>
              <Input
                id="o-dev"
                type="number"
                min={4}
                max={20}
                value={otp.maxDevices}
                onChange={(e) => setOtp({ ...otp, maxDevices: Number(e.target.value) })}
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="o-idle">End session after (min idle)</Label>
              <Input
                id="o-idle"
                type="number"
                min={30}
                max={240}
                value={otp.idleMinutes}
                onChange={(e) => setOtp({ ...otp, idleMinutes: Number(e.target.value) })}
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="o-max">Hard cap (hours)</Label>
              <Input
                id="o-max"
                type="number"
                min={1}
                max={8}
                value={otp.maxHours}
                onChange={(e) => setOtp({ ...otp, maxHours: Number(e.target.value) })}
                className="mt-1"
              />
            </div>
          </div>

          <label className="mt-3 flex items-start gap-2 rounded-xl bg-secondary p-3">
            <input
              type="checkbox"
              checked={otp.autoConfirmOrders}
              onChange={(e) => setOtp({ ...otp, autoConfirmOrders: e.target.checked })}
              className="mt-0.5 h-5 w-5"
            />
            <span className="text-xs">
              <span className="font-semibold">Skip the confirm tap</span>
              <br />
              Orders from a verified table go straight to the kitchen. Off by default — waiters
              confirm every order.
            </span>
          </label>

          <label className="mt-2 flex items-start gap-2 rounded-xl bg-secondary p-3">
            <input
              type="checkbox"
              checked={otp.menuPreview}
              onChange={(e) => setOtp({ ...otp, menuPreview: e.target.checked })}
              className="mt-0.5 h-5 w-5"
            />
            <span className="text-xs">
              <span className="font-semibold">Read-only menu before the code</span>
              <br />
              Guests can browse (and see prices) before they enter the code. Ordering still
              requires it.
            </span>
          </label>

          {otpInvalid && (
            <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
              One of the values is outside the allowed range — check the numbers above.
            </p>
          )}

          <Button
            variant="outline"
            className="mt-3 w-full border-red-300 text-red-700"
            onClick={endAllSessions}
            loading={busy === 'panic'}
          >
            <ShieldAlert className="h-4 w-4" /> End all sessions and codes
          </Button>
          <p className="mt-1 text-center text-[11px] text-muted-foreground">
            Use this when you have to start over (closing time, a device leaked the code). Every
            table goes Free and every guest has to ask for a new code.
          </p>
        </section>

        {/* games */}
        <section className="rounded-2xl border border-border bg-card p-4">
          <h2 className="flex items-center gap-2 text-sm font-bold">
            <Settings2 className="h-4 w-4" /> Games
          </h2>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor="g-rounds">Questions per round</Label>
              <Input
                id="g-rounds"
                type="number"
                min={5}
                max={20}
                value={games.roundsPerRound}
                onChange={(e) => setGames({ ...games, roundsPerRound: Number(e.target.value) })}
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="g-points">Points per correct answer</Label>
              <Input
                id="g-points"
                type="number"
                min={10}
                max={1000}
                value={games.pointsCorrect}
                onChange={(e) => setGames({ ...games, pointsCorrect: Number(e.target.value) })}
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="g-bonus">Max speed bonus</Label>
              <Input
                id="g-bonus"
                type="number"
                min={0}
                max={200}
                value={games.speedBonusMax}
                onChange={(e) => setGames({ ...games, speedBonusMax: Number(e.target.value) })}
                className="mt-1"
              />
            </div>
            <div className="col-span-2">
              <Label htmlFor="g-mode">Table leaderboard points</Label>
              <Select
                id="g-mode"
                value={games.pointsMode}
                onChange={(e) =>
                  setGames({ ...games, pointsMode: e.target.value as 'sum' | 'average' })
                }
                className="mt-1"
              >
                <option value="sum">Sum of all players at the table</option>
                <option value="average">Average points per round</option>
              </Select>
            </div>
          </div>
        </section>

        <div className="pt-1">
          <Button size="lg" className="w-full" onClick={save} loading={Boolean(busy)}>
            <Save className="h-5 w-5" /> Save all settings
          </Button>
          <p className="mt-2 text-center text-[11px] text-muted-foreground">
            Applies to every screen immediately — accent colour, sounds, tax and review routing.
          </p>
        </div>
      </div>
    </AdminShell>
  );
}
