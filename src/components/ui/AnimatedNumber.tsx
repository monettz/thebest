import { useEffect, useRef, useState } from 'react';
import { formatNumber } from '@/lib/format';

/**
 * Counting animation for headline numbers. Purely visual: the real value is always what ends up on
 * screen, nothing waits for the animation, and no calculation reads the animated number.
 */

/** Last value each `id` finished showing, so coming back to a page (or a tiny refetch) doesn't replay it. */
const lastShown = new Map<string, number>();

const prefersReducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

export function useCountUp(value: number, id?: string, duration = 700): number {
  const safe = Number.isFinite(value) ? value : 0;
  const [shown, setShown] = useState<number>(() => (prefersReducedMotion() ? safe : ((id ? lastShown.get(id) : undefined) ?? 0)));
  const shownRef = useRef(shown);
  shownRef.current = shown;

  useEffect(() => {
    const from = shownRef.current;
    if (from === safe) {
      if (id) lastShown.set(id, safe);
      return;
    }
    // Jump straight there for reduced motion, or for a negligible change (nothing to see).
    // Also jump when the page isn't visible (no frames are drawn there, so there is nothing to animate).
    if (prefersReducedMotion() || (typeof document !== 'undefined' && document.hidden) || Math.abs(safe - from) < 1e-9) {
      setShown(safe);
      if (id) lastShown.set(id, safe);
      return;
    }
    let raf = 0;
    const finish = () => {
      setShown(safe);
      if (id) lastShown.set(id, safe);
    };
    // Failsafe: if frames are throttled or dropped, the exact value still lands right after the animation time.
    const timer = setTimeout(finish, duration + 120);
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      if (t >= 1) {
        finish(); // exact final value, never an interpolated one
        return;
      }
      setShown(from + (safe - from) * easeOutCubic(t));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      clearTimeout(timer);
      cancelAnimationFrame(raf);
      // Interrupted by newer data: the next run continues from where we are.
    };
  }, [safe, id, duration]);

  return shown;
}

/**
 * `format` turns a number into text (formatTZS, formatTZSCompact, formatNumber …), so currency
 * formatting, separators, zero and negative values stay exactly as everywhere else.
 */
export function AnimatedNumber({
  value,
  format = formatNumber,
  id,
  duration,
  className,
}: {
  value: number;
  format?: (n: number) => string;
  id?: string;
  duration?: number;
  className?: string;
}) {
  const shown = useCountUp(value, id, duration);
  return <span className={className} data-value={value}>{format(shown)}</span>;
}
