import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** ₹1,240.00 style money formatting (no decimals when whole). */
export function money(amount: number | string, currency = 'INR') {
  const n = typeof amount === 'string' ? Number(amount) : amount;
  const safe = Number.isFinite(n) ? n : 0;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency,
    minimumFractionDigits: Number.isInteger(safe) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(safe);
}

export function timeAgo(from: string | number | Date, now = Date.now()) {
  const t = new Date(from).getTime();
  const secs = Math.max(0, Math.round((now - t) / 1000));
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ${secs % 60}s`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m`;
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

export function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

/** Deterministic shuffle with a seed (used for question order server-side). */
export function seededShuffle<T>(items: T[], seed: string): T[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    h = (Math.imul(h, 48271) + 11) % 2147483647;
    const j = Math.abs(h) % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
