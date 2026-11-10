'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { audioReady, playSound, unlockAudio } from '@/lib/sounds';
import { api } from '@/lib/api-client';
import {
  BellRing,
  KeyRound,
  LogOut,
  Moon,
  Sun,
  Volume2,
  VolumeX,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { PushSetup } from '@/components/staff/PushSetup';
import { ChangePasswordDialog } from '@/components/staff/ChangePasswordDialog';
import type { StaffUser } from '@/types';

type Props = {
  user: StaffUser;
  children: React.ReactNode;
  nav?: { href: string; label: string; icon: typeof BellRing }[];
};

/**
 * Shared staff chrome: sound unlock, realtime/poll connection indicator,
 * dark mode, logout. Big targets, readable from a distance (spec §15).
 */
export function StaffShell({ user, children, nav = [] }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const { push } = useToast();
  const [soundOn, setSoundOn] = React.useState(false);
  const [dark, setDark] = React.useState(false);
  const [online, setOnline] = React.useState(true);
  const [changingPassword, setChangingPassword] = React.useState(false);

  React.useEffect(() => {
    setDark(document.documentElement.classList.contains('dark'));
    setSoundOn(audioReady());
    setOnline(navigator.onLine);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  const enableSound = () => {
    const ok = unlockAudio();
    setSoundOn(ok);
    if (ok) {
      playSound('chime');
      push('Sound enabled — you will hear new orders', 'success');
    } else {
      push('Your browser blocked audio. Try again after tapping the screen.', 'error');
    }
  };

  const toggleDark = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle('dark', next);
    localStorage.setItem('tt_theme', next ? 'dark' : 'light');
  };

  const logout = async () => {
    await api.post('/api/staff/logout');
    router.replace('/staff/login');
  };

  return (
    <div className="min-h-dvh bg-background">
      <header className="sticky top-0 z-30 border-b border-border bg-card/95 backdrop-blur">
        <div className="flex items-center gap-2 px-3 py-2">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold leading-tight">{user.restaurant_name}</p>
            <p className="truncate text-[11px] text-muted-foreground">
              {user.full_name} · {user.role}
            </p>
          </div>

          <span
            className={cn(
              'flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-semibold',
              online ? 'bg-[hsl(var(--success))]/12 text-[hsl(var(--success))]' : 'bg-destructive/10 text-destructive',
            )}
            title={online ? 'Connected' : 'Offline'}
          >
            {online ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
            {online ? 'live' : 'offline'}
          </span>

          <button
            type="button"
            onClick={toggleDark}
            className="tap rounded-lg hover:bg-secondary"
            aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>

          <button
            type="button"
            onClick={() => setChangingPassword(true)}
            className="tap rounded-lg text-muted-foreground hover:bg-secondary"
            aria-label="Change password"
          >
            <KeyRound className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={logout}
            className="tap rounded-lg text-muted-foreground hover:bg-secondary"
            aria-label="Sign out"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>

        {!soundOn && (
          <button
            type="button"
            onClick={enableSound}
            className="flex w-full items-center justify-center gap-2 bg-[hsl(var(--warning))] py-2 text-xs font-bold text-black"
          >
            <VolumeX className="h-4 w-4" /> Tap to enable sound alerts
          </button>
        )}

        <div className="flex items-center justify-between gap-2 px-3 pb-1">
          <PushSetup />
          <span className="text-[10px] text-muted-foreground">
            {soundOn ? 'Sound alerts on' : 'Sound off'}
          </span>
        </div>

        {nav.length > 0 && (
          <nav className="no-scrollbar flex gap-1 overflow-x-auto px-2 pb-2">
            {nav.map((item) => {
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    'flex min-h-[40px] shrink-0 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold',
                    active ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground',
                  )}
                >
                  <item.icon className="h-4 w-4" /> {item.label}
                </Link>
              );
            })}
          </nav>
        )}
      </header>

      {children}

      <ChangePasswordDialog open={changingPassword} onClose={() => setChangingPassword(false)} />
    </div>
  );
}
