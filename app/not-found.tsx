import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col items-center justify-center p-6 text-center">
      <p className="text-5xl">🔍</p>
      <h1 className="mt-4 text-xl font-bold">This table link is not valid</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        The QR code or NFC tag may have been replaced. Please ask a member of staff for help.
      </p>
      <Link
        href="/"
        className="mt-6 flex min-h-[48px] items-center rounded-xl bg-primary px-5 font-semibold text-primary-foreground"
      >
        Go to home
      </Link>
    </main>
  );
}
