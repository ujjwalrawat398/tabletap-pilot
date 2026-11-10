import Link from 'next/link';
import { notFound } from 'next/navigation';
import { demoAllowed } from '@/server/demo-gate';
import { SetupPanel } from '@/components/staff/SetupPanel';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Setup' };

export default function SetupPage() {
  if (!demoAllowed()) notFound();
  return (
    <main className="mx-auto max-w-lg space-y-4 p-5">
      <div>
        <h1 className="text-2xl font-black">Setup &amp; demo data</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Check the installation, create the demo staff logins and print your table QR codes.
        </p>
      </div>
      <SetupPanel />
      <p className="text-center text-xs text-muted-foreground">
        <Link href="/" className="underline">
          ← Back to the start page
        </Link>
      </p>
    </main>
  );
}
