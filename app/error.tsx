'use client';

export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col items-center justify-center p-6 text-center">
      <p className="text-5xl">😕</p>
      <h1 className="mt-4 text-xl font-bold">Something went wrong</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Please try again. If it keeps happening, reload the page or scan the QR code once more.
      </p>
      <button
        onClick={reset}
        className="mt-6 flex min-h-[48px] items-center rounded-xl bg-primary px-5 font-semibold text-primary-foreground"
      >
        Try again
      </button>
    </main>
  );
}
