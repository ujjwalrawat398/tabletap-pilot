'use client';

/**
 * Notification sounds, synthesised with the Web Audio API so there are no audio
 * files to ship and no CORS/caching issues. Browsers block audio until the first
 * gesture, so staff screens call `unlockAudio()` from an "Enable sound" button.
 */

let ctx: AudioContext | null = null;

export function unlockAudio(): boolean {
  try {
    if (!ctx) {
      const Ctor = window.AudioContext ?? (window as any).webkitAudioContext;
      if (!Ctor) return false;
      ctx = new Ctor();
    }
    if (ctx.state === 'suspended') void ctx.resume();
    // a silent blip is enough to satisfy iOS
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    gain.gain.value = 0.0001;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.02);
    return true;
  } catch {
    return false;
  }
}

export function audioReady() {
  return Boolean(ctx && ctx.state === 'running');
}

type Note = { freq: number; start: number; duration: number; type?: OscillatorType; gain?: number };

const PRESETS: Record<string, Note[]> = {
  // calm two-tone chime for new orders
  chime: [
    { freq: 880, start: 0, duration: 0.16 },
    { freq: 1174.66, start: 0.14, duration: 0.24 },
  ],
  // classic bell, repeated — used for a guest calling a waiter
  bell: [
    { freq: 1318.5, start: 0, duration: 0.12 },
    { freq: 1318.5, start: 0.2, duration: 0.12 },
    { freq: 1046.5, start: 0.4, duration: 0.2 },
  ],
  // single bright ding for "order ready"
  ding: [{ freq: 1567.98, start: 0, duration: 0.35, gain: 0.22 }],
  // cash-register-ish double blip for bill requests
  cash: [
    { freq: 988, start: 0, duration: 0.09, type: 'triangle' },
    { freq: 1318.5, start: 0.1, duration: 0.09, type: 'triangle' },
    { freq: 1760, start: 0.2, duration: 0.22, type: 'triangle' },
  ],
  // short rising pair — a guest asked for the table code. Deliberately unlike
  // chime/bell/cash so a waiter can tell "code request" from "order" without looking.
  otp: [
    { freq: 1046.5, start: 0, duration: 0.1, type: 'sine', gain: 0.3 },
    { freq: 1567.98, start: 0.11, duration: 0.1, type: 'sine', gain: 0.3 },
    { freq: 2093, start: 0.22, duration: 0.16, type: 'sine', gain: 0.26 },
  ],
  // insistent alarm, escalates — used for long-waiting orders if configured
  alarm: [
    { freq: 660, start: 0, duration: 0.12, type: 'square', gain: 0.18 },
    { freq: 880, start: 0.14, duration: 0.12, type: 'square', gain: 0.18 },
    { freq: 660, start: 0.28, duration: 0.12, type: 'square', gain: 0.18 },
    { freq: 880, start: 0.42, duration: 0.16, type: 'square', gain: 0.18 },
  ],
  double: [
    { freq: 1046.5, start: 0, duration: 0.1 },
    { freq: 1046.5, start: 0.16, duration: 0.16 },
  ],
  success: [
    { freq: 784, start: 0, duration: 0.1 },
    { freq: 1046.5, start: 0.1, duration: 0.1 },
    { freq: 1318.5, start: 0.2, duration: 0.2 },
  ],
  error: [
    { freq: 320, start: 0, duration: 0.18, type: 'sawtooth', gain: 0.16 },
    { freq: 220, start: 0.2, duration: 0.24, type: 'sawtooth', gain: 0.16 },
  ],
};

export type SoundName = keyof typeof PRESETS;

export function playSound(name: string, volume = 0.3) {
  const notes = PRESETS[name] ?? PRESETS.chime;
  if (!ctx) {
    // try to create on demand; will stay silent until a gesture unlocks it
    if (!unlockAudio()) return false;
  }
  if (!ctx) return false;

  const now = ctx.currentTime;
  for (const note of notes) {
    const osc = ctx!.createOscillator();
    const gain = ctx!.createGain();
    osc.type = note.type ?? 'sine';
    osc.frequency.value = note.freq;
    gain.gain.setValueAtTime(0.0001, now + note.start);
    gain.gain.exponentialRampToValueAtTime(note.gain ?? volume, now + note.start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + note.start + note.duration);
    osc.connect(gain).connect(ctx!.destination);
    osc.start(now + note.start);
    osc.stop(now + note.start + note.duration + 0.02);
  }
  return true;
}

export function vibrate(pattern: number | number[] = [60, 40, 60]) {
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    try {
      navigator.vibrate(pattern);
    } catch {
      /* ignore */
    }
  }
}
