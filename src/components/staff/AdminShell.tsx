'use client';

import { StaffShell } from '@/components/staff/StaffShell';
import type { StaffUser } from '@/types';
import {
  BarChart3,
  BookOpen,
  Grid2x2,
  MessageSquareHeart,
  Salad,
  Settings2,
  Trophy,
  Users,
} from 'lucide-react';

const NAV = [
  { href: '/admin/overview', label: 'Overview', icon: Grid2x2 },
  { href: '/admin/menu', label: 'Menu & offers', icon: Salad },
  { href: '/admin/tables', label: 'Tables & QR', icon: BookOpen },
  { href: '/admin/staff', label: 'Staff', icon: Users },
  { href: '/admin/reports', label: 'Reports', icon: BarChart3 },
  { href: '/admin/games', label: 'Games', icon: Trophy },
  { href: '/admin/feedback', label: 'Feedback', icon: MessageSquareHeart },
  { href: '/admin/settings', label: 'Settings', icon: Settings2 },
];

export function AdminShell({ user, children }: { user: StaffUser; children: React.ReactNode }) {
  return (
    <StaffShell user={user} nav={NAV}>
      <div className="mx-auto w-full max-w-5xl p-3 pb-24">{children}</div>
    </StaffShell>
  );
}
