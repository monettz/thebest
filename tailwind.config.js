/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: { sans: ['"Montserrat Variable"', 'Montserrat', 'system-ui', 'sans-serif'] },
      screens: { wide: '1440px' },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'page-in': { from: { opacity: '0', transform: 'translateY(6px)' }, to: { opacity: '1', transform: 'none' } },
        'slide-up': { from: { transform: 'translateY(100%)' }, to: { transform: 'none' } },
        'scale-in': { from: { opacity: '0', transform: 'scale(0.96)' }, to: { opacity: '1', transform: 'none' } },
        shimmer: { '100%': { transform: 'translateX(100%)' } },
      },
      animation: {
        'fade-in': 'fade-in 150ms ease-out both',
        'page-in': 'page-in 180ms ease-out both',
        'slide-up': 'slide-up 260ms cubic-bezier(0.32, 0.72, 0, 1) both',
        'scale-in': 'scale-in 180ms ease-out both',
      },
      // Every colour is a CSS variable (src/index.css): light values on :root, dark values on .dark.
      colors: {
        primary: { DEFAULT: 'rgb(var(--c-primary) / <alpha-value>)', link: 'rgb(var(--c-primary-link) / <alpha-value>)', tint: 'rgb(var(--c-primary-tint) / <alpha-value>)' },
        bar: { 1: 'rgb(var(--c-bar-1) / <alpha-value>)', 2: 'rgb(var(--c-bar-2) / <alpha-value>)', 3: 'rgb(var(--c-bar-3) / <alpha-value>)' },
        navy: 'rgb(var(--c-ink) / <alpha-value>)',
        ink: 'rgb(var(--c-ink) / <alpha-value>)',
        body: 'rgb(var(--c-body) / <alpha-value>)',
        muted: 'rgb(var(--c-muted) / <alpha-value>)',
        line: { DEFAULT: 'rgb(var(--c-line) / <alpha-value>)', soft: 'rgb(var(--c-line-soft) / <alpha-value>)' },
        app: 'rgb(var(--c-app) / <alpha-value>)',
        /** Cards, dialogs, fields: white in light mode, a raised grey-green in dark mode. */
        surface: 'rgb(var(--c-surface) / <alpha-value>)',
        ok: { bg: 'rgb(var(--c-ok-bg) / <alpha-value>)', fg: 'rgb(var(--c-ok-fg) / <alpha-value>)' },
        warn: { bg: 'rgb(var(--c-warn-bg) / <alpha-value>)', fg: 'rgb(var(--c-warn-fg) / <alpha-value>)' },
        bad: { bg: 'rgb(var(--c-bad-bg) / <alpha-value>)', fg: 'rgb(var(--c-bad-fg) / <alpha-value>)' },
      },
      borderRadius: { card: '16px', field: '12px', chip: '10px' },
      minHeight: { touch: '44px' },
    },
  },
  plugins: [],
};
