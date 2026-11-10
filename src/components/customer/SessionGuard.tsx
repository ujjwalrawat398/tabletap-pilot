'use client';

import { AlertTriangle, WifiOff } from 'lucide-react';
import * as React from 'react';
import { useCustomer } from '@/components/customer/CustomerProvider';
import { useT } from '@/lib/i18n';

/**
 * Shows the "scan again" state when the waiter closed the table session, and a
 * persistent offline banner when the connection drops (spec §15).
 */
export function SessionGuard() {
  const { error } = useCustomer();
  const { t } = useT();
  const [offline, setOffline] = React.useState(false);

  React.useEffect(() => {
    const on = () => setOffline(false);
    const off = () => setOffline(true);
    setOffline(!navigator.onLine);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  return (
    <>
      {error === 'SESSION_INVALID' && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-background/95 p-6 text-center backdrop-blur">
          <div className="max-w-sm space-y-3">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10 text-destructive">
              <AlertTriangle className="h-7 w-7" />
            </div>
            <h2 className="text-lg font-bold">{t.scanAgain}</h2>
            <p className="text-sm text-muted-foreground">
              Your table session was closed by our team. Scan the QR code on your table to start a
              new order.
            </p>
          </div>
        </div>
      )}

      {offline && (
        <div
          className="fixed inset-x-0 top-0 z-[95] flex items-center justify-center gap-2 bg-[hsl(var(--warning))] px-4 py-2 text-sm font-medium text-black"
          role="status"
        >
          <WifiOff className="h-4 w-4" />
          {t.offline}
        </div>
      )}
    </>
  );
}
