import type { Config } from 'tailwindcss';

export default {
  darkMode: ['class'],
  content: ['./src/**/*.{ts,tsx}', './app/**/*.{ts,tsx}'],
  theme: {
    container: { center: true, padding: '1rem', screens: { '2xl': '1200px' } },
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: { DEFAULT: 'hsl(var(--primary))', foreground: 'hsl(var(--primary-foreground))' },
        secondary: { DEFAULT: 'hsl(var(--secondary))', foreground: 'hsl(var(--secondary-foreground))' },
        muted: { DEFAULT: 'hsl(var(--muted))', foreground: 'hsl(var(--muted-foreground))' },
        accent: { DEFAULT: 'hsl(var(--accent))', foreground: 'hsl(var(--accent-foreground))' },
        destructive: { DEFAULT: 'hsl(var(--destructive))', foreground: 'hsl(var(--destructive-foreground))' },
        card: { DEFAULT: 'hsl(var(--card))', foreground: 'hsl(var(--card-foreground))' },
        success: 'hsl(var(--success))',
        warning: 'hsl(var(--warning))',
      },
      borderRadius: { lg: 'var(--radius)', md: 'calc(var(--radius) - 2px)', sm: 'calc(var(--radius) - 4px)' },
      boxShadow: {
        soft: '0 1px 2px rgba(16,24,40,.04), 0 8px 24px -12px rgba(16,24,40,.18)',
        card: '0 1px 3px rgba(16,24,40,.06), 0 12px 32px -16px rgba(16,24,40,.24)',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0', transform: 'translateY(4px)' }, to: { opacity: '1', transform: 'none' } },
        'pulse-ring': {
          '0%': { boxShadow: '0 0 0 0 hsl(var(--primary) / .45)' },
          '100%': { boxShadow: '0 0 0 14px hsl(var(--primary) / 0)' },
        },
        shimmer: { '100%': { transform: 'translateX(100%)' } },
        'slide-up': { from: { transform: 'translateY(100%)' }, to: { transform: 'none' } },
      },
      animation: {
        'fade-in': 'fade-in .25s ease-out both',
        'pulse-ring': 'pulse-ring 1.6s ease-out infinite',
        shimmer: 'shimmer 1.6s infinite',
        'slide-up': 'slide-up .25s cubic-bezier(.32,.72,0,1) both',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
} satisfies Config;
