import type { Metadata, Viewport } from 'next';
import { ToastProvider } from '@/components/ui/toast';
import { PwaRegister } from '@/components/PwaRegister';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'TableTap — order from your table',
    template: '%s · TableTap',
  },
  description:
    'Scan, order, review — a QR/NFC table ordering platform for restaurants and cafés by U&D Digital Studio.',
  applicationName: 'TableTap',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'TableTap' },
  formatDetection: { telephone: false },
  icons: {
    icon: [{ url: '/icons/icon.svg', type: 'image/svg+xml' }],
    apple: [{ url: '/icons/icon-192.png' }],
  },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#141210' },
  ],
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem('tt_theme');if(t==='dark'||(!t&&window.matchMedia('(prefers-color-scheme:dark)').matches)){document.documentElement.classList.add('dark')}}catch(e){}`,
          }}
        />
      </head>
      <body suppressHydrationWarning>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[200] focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground"
        >
          Skip to content
        </a>
        <ToastProvider>
          <div id="main">{children}</div>
        </ToastProvider>
        <PwaRegister />
      </body>
    </html>
  );
}
