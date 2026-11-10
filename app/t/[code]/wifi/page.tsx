import { notFound, redirect } from 'next/navigation';
import QRCode from 'qrcode';
import { CustomerProvider } from '@/components/customer/CustomerProvider';
import { WifiScreen } from '@/components/customer/WifiScreen';
import { getCustomerStateForPage } from '@/server/customer-state';
import { findTableByCode, getSessionFromCookie } from '@/server/session';
import { getWifiCard } from '@/server/session-scan';

export const dynamic = 'force-dynamic';

/**
 * Wi-Fi card (spec §11). The QR is rendered server-side (the `qrcode` package
 * has no place in a mobile JS bundle) using the standard scheme
 * WIFI:T:WPA;S:<ssid>;P:<password>;; recognised by iOS 11+ and Android 10+.
 */
export default async function WifiPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  if (!(await findTableByCode(code))) notFound();

  const initial = await getCustomerStateForPage(code);
  if (!initial) redirect(`/t/${code}`);
  // The scan payload no longer carries the password (a photographed QR must not
  // leak it), so the Wi-Fi card reads it here for a device that holds a session.
  const live = Boolean(await getSessionFromCookie(code));
  const card = await getWifiCard(code);
  const ssid = card?.wifi_ssid ?? initial.settings.wifi_ssid;
  const password = card?.wifi_password ?? null;

  let qrDataUrl: string | null = null;
  if (ssid && password) {
    const escape = (v: string) => v.replace(/([\\;,:"])/g, '\\$1');
    try {
      qrDataUrl = await QRCode.toDataURL(
        `WIFI:T:WPA;S:${escape(ssid)};P:${escape(password)};;`,
        { margin: 1, width: 384, errorCorrectionLevel: 'M' },
      );
    } catch {
      qrDataUrl = null;
    }
  }

  return (
    <CustomerProvider tableCode={code} initial={initial}>
      <WifiScreen settings={{ ...initial.settings, wifi_password: password }} qrDataUrl={qrDataUrl} live={live} />
    </CustomerProvider>
  );
}
