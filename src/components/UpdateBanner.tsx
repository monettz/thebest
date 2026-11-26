import { useEffect, useState } from 'react';
import { tr } from '@/i18n';

/**
 * The app is a PWA: a new deploy is downloaded in the background and takes over the page, but what is on
 * screen stays the old version until a reload. This asks once, instead of reloading by itself (a sale may be
 * half-entered in the POS).
 */
export function UpdateBanner() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const sw = navigator.serviceWorker;
    // No controller yet means a first install, not an update.
    const hadController = !!sw.controller;
    const onChange = () => hadController && setReady(true);
    sw.addEventListener('controllerchange', onChange);

    // Look for a new deploy when the app comes back to the front, and every 30 minutes.
    const check = () => void sw.getRegistration().then((r) => r?.update()).catch(() => {});
    const onVisible = () => document.visibilityState === 'visible' && check();
    document.addEventListener('visibilitychange', onVisible);
    const timer = window.setInterval(check, 30 * 60_000);
    return () => {
      sw.removeEventListener('controllerchange', onChange);
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(timer);
    };
  }, []);

  if (!ready) return null;
  return (
    <div
      role="status"
      className="fixed inset-x-3 bottom-24 z-[70] mx-auto flex max-w-md items-center gap-3 rounded-2xl bg-ink px-4 py-3 text-app shadow-xl animate-fade-in md:bottom-6"
    >
      <span className="flex-1 text-[13.5px] font-medium">{tr('Toleo jipya la app lipo.')}</span>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="min-h-[40px] rounded-xl bg-surface px-4 text-[13.5px] font-bold text-ink"
      >
        {tr('Sasisha')}
      </button>
    </div>
  );
}
