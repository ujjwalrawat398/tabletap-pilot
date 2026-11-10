'use client';

import * as React from 'react';
import Link from 'next/link';
import { useCustomer } from '@/components/customer/CustomerProvider';
import { useT } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { ArrowLeft, Copy, Check, Wifi, Eye, EyeOff } from 'lucide-react';

type Settings = {
  wifi_ssid: string | null;
  wifi_password: string | null;
  restaurant_name: string;
};

/**
 * Wi-Fi card (spec §11). The QR payload uses the standard Wi-Fi scheme
 * WIFI:T:WPA;S:<ssid>;P:<password>;; which iOS 11+ and Android 10+ recognise.
 */
export function WifiScreen({
  settings,
  qrDataUrl,
  live = true,
}: {
  settings: Settings & Record<string, any>;
  qrDataUrl: string | null;
  /** False when this device has no live table session (deep link, closed table). */
  live?: boolean;
}) {
  const { t } = useT();
  const { tableCode } = useCustomer();
  const { push } = useToast();
  const [copied, setCopied] = React.useState(false);
  const [reveal, setReveal] = React.useState(false);

  const ssid = settings.wifi_ssid;
  const password = settings.wifi_password;
  const qr = qrDataUrl;

  async function copy() {
    if (!password) return;
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
      push(t.copied, 'success');
      setTimeout(() => setCopied(false), 2500);
    } catch {
      push('Copy failed — long-press the password to copy it.', 'error');
    }
  }

  return (
    <div className="min-h-dvh pb-24">
      <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-border bg-background/95 p-3 backdrop-blur">
        <Link href={`/t/${tableCode}`} className="tap rounded-full hover:bg-secondary" aria-label="Back">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-base font-bold">{t.connectWifi}</h1>
      </header>

      <main className="p-5">
        {!live ? (
          <div className="mt-16 text-center text-sm text-muted-foreground">
            <Wifi className="mx-auto h-10 w-10 opacity-40" />
            <p className="mt-3 font-semibold text-foreground">Your table session has ended.</p>
            <p>Scan the QR code on your table again to see the Wi-Fi password.</p>
            <Button asChild className="mt-4">
              <Link href={`/t/${tableCode}`}>Back to the table</Link>
            </Button>
          </div>
        ) : !ssid || !password ? (
          <div className="mt-16 text-center text-sm text-muted-foreground">
            <Wifi className="mx-auto h-10 w-10 opacity-40" />
            <p className="mt-3 font-semibold text-foreground">Wi-Fi details are not set yet.</p>
            <p>Please ask a member of staff.</p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-2xl border border-border bg-card p-5 shadow-soft">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t.wifiName}
              </p>
              <p className="mt-1 text-xl font-bold">{ssid}</p>

              <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Password
              </p>
              <div className="mt-1 flex items-center gap-2">
                <code className="flex-1 truncate rounded-lg bg-secondary px-3 py-2 font-mono text-base">
                  {reveal ? password : '•'.repeat(Math.min(password.length, 14))}
                </code>
                <button
                  type="button"
                  onClick={() => setReveal((r) => !r)}
                  className="tap rounded-lg border border-border px-2"
                  aria-label={reveal ? 'Hide password' : 'Show password'}
                >
                  {reveal ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>

              <Button size="lg" className="mt-4 w-full" onClick={copy}>
                {copied ? <Check className="h-5 w-5" /> : <Copy className="h-5 w-5" />}
                {copied ? t.copied : t.copyPassword}
              </Button>
            </div>

            {qr && (
              <div className="rounded-2xl border border-border bg-card p-5 text-center shadow-soft">
                <p className="text-sm font-semibold">Scan to join automatically</p>
                <p className="text-xs text-muted-foreground">
                  Works on iPhone (iOS 11+) and most Android phones
                </p>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={qr} alt={`Wi-Fi QR code for ${ssid}`} className="mx-auto mt-3 h-56 w-56" width={224} height={224} />
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
