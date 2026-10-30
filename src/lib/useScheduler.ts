import { useEffect } from 'react';
import { runDueJobs } from '@/mock/jobs';

/** Dev stand-in for Vercel Cron: checks once a minute while an owner has the app open. */
export function useScheduler(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const tick = () => void runDueJobs().catch(() => undefined);
    const first = setTimeout(tick, 2000);
    const timer = setInterval(tick, 60_000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [enabled]);
}
