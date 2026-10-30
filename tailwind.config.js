/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: { sans: ['"Inter Variable"', 'Inter', 'system-ui', 'sans-serif'] },
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
      colors: {
        primary: { DEFAULT: '#2563EB', link: '#1D4ED8', tint: '#EEF3FF' },
        bar: { 1: '#93B4F5', 2: '#C7D7FB', 3: '#DCE6FB' },
        navy: '#0F172A',
        ink: '#0F172A',
        body: '#334155',
        muted: '#5B6577',
        line: { DEFAULT: '#E5E8EE', soft: '#EEF0F4' },
        app: '#F1F3F7',
        ok: { bg: '#DCFCE7', fg: '#166534' },
        warn: { bg: '#FEF3C7', fg: '#92400E' },
        bad: { bg: '#FEE2E2', fg: '#991B1B' },
      },
      borderRadius: { card: '16px', field: '12px', chip: '10px' },
      minHeight: { touch: '44px' },
    },
  },
  plugins: [],
};
