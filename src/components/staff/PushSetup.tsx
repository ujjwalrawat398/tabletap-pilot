'use client';

import * as React from 'react';
import { api } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { BellRing, BellOff } from 'lucide-react';

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

/**
 * Web Push opt-in for staff devices (spec §6).
 * iPhone/iPad: Safari only allows push once the site is added to the Home
 * Screen — the UI says so instead of failing silently.
 */
export function PushSetup() {
  const { push } = useToast();
  const [state, setState] = React.useState<'unsupported' | 'default' | 'granted' | 'denied' | 'busy'>(
    'default',
  );
  const [isIosNeedsInstall, setIsIosNeedsInstall] = React.useState(false);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as any).standalone === true;
    setIsIosNeedsInstall(ios && !standalone);

    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      setState('unsupported');
      return;
    }
    setState(Notification.permission === 'granted' ? 'granted' : Notification.permission === 'denied' ? 'denied' : 'default');
  }, []);

  async function subscribe() {
    setState('busy');
    try {
      const { publicKey } = await api.get<{ publicKey: string | null }>('/api/staff/push');
      if (!publicKey) {
        push('Web Push is not configured — add VAPID keys to the environment.', 'error');
        setState('default');
        return;
      }
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setState('denied');
        push('Notifications are blocked in this browser', 'error');
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      const existing = await registration.pushManager.getSubscription();
      const subscription =
        existing ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        }));

      await api.post('/api/staff/push', subscription.toJSON());
      setState('granted');
      push('Push notifications enabled on this device', 'success');
    } catch (err) {
      setState('default');
      push(err instanceof Error ? err.message : 'Could not enable push', 'error');
    }
  }

  if (state === 'granted') {
    return (
      <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <BellRing className="h-3 w-3 text-[hsl(var(--success))]" /> Push alerts on
      </p>
    );
  }

  return (
    <div className="space-y-1">
      <Button size="sm" variant="outline" onClick={subscribe} disabled={state === 'busy' || state === 'unsupported'}>
        {state === 'unsupported' ? <BellOff className="h-3.5 w-3.5" /> : <BellRing className="h-3.5 w-3.5" />}
        {state === 'unsupported' ? 'Push unsupported' : 'Enable push alerts'}
      </Button>
      {isIosNeedsInstall && (
        <p className="text-[10px] text-muted-foreground">
          On iPhone: Share → Add to Home Screen, then enable push.
        </p>
      )}
    </div>
  );
}
