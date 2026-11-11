import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Button, cx } from '@/components/ui';
import { tr } from '@/i18n';
import { useAuth } from '@/lib/auth';

export interface SuccessOptions {
  title: string;
  message?: string;
  /** 'debt' paints the tick and the highlighted row amber (a sale that still has a balance). */
  tone?: 'ok' | 'debt';
  badge?: string;
  rows?: { label: string; value: string; highlight?: boolean }[];
  primary?: { label: string; onClick: () => void };
  secondary?: { label: string; onClick: () => void };
}

type Show = (o: SuccessOptions) => void;
const Ctx = createContext<Show>(() => undefined);

/** Shows the confirmation dialog from anywhere: `const showSuccess = useSuccess(); showSuccess({ title })`. */
export const useSuccess = (): Show => useContext(Ctx);

export function SuccessProvider({ children }: { children: ReactNode }) {
  const [opts, setOpts] = useState<SuccessOptions | null>(null);
  const show = useCallback<Show>((o) => setOpts(o), []);
  const close = useCallback(() => setOpts(null), []);
  return (
    <Ctx.Provider value={show}>
      {children}
      {opts && <SuccessDialog opts={opts} onClose={close} />}
    </Ctx.Provider>
  );
}

function SuccessDialog({ opts, onClose }: { opts: SuccessOptions; onClose: () => void }) {
  const { user } = useAuth();
  const firstFocus = useRef<HTMLButtonElement>(null);
  const debt = opts.tone === 'debt';
  const firstName = user?.name.split(/\s+/)[0];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    firstFocus.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const run = (fn?: () => void) => () => {
    onClose();
    fn?.();
  };

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-navy/50 animate-fade-in sm:items-center sm:p-4 print:hidden" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="success-title"
        onClick={(e) => e.stopPropagation()}
        className="pb-safe max-h-[94dvh] w-full animate-sheet overflow-y-auto rounded-t-[28px] bg-white px-5 pb-6 pt-9 text-center sm:max-w-[400px] sm:rounded-[28px]"
      >
        <svg className={cx('success-pop mx-auto h-20 w-20', debt ? 'text-amber-600' : 'text-primary')} viewBox="0 0 80 80" fill="none" aria-hidden>
          <circle className="success-ring" cx="40" cy="40" r="38" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
          <path className="success-tick" d="M25 41l10 10 20-21" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>

        {firstName && <p className="mt-4 text-[14px] text-body">{tr('Hongera, {name},', { name: firstName })}</p>}
        <h2 id="success-title" className="mt-1 text-[22px] font-extrabold leading-tight tracking-tight text-ink">
          {opts.title}
        </h2>
        {opts.badge && (
          <span className="mt-1.5 inline-block rounded-chip bg-warn-bg px-2.5 py-0.5 text-[11.5px] font-bold text-warn-fg">{opts.badge}</span>
        )}
        {opts.message && <p className="mx-auto mt-2 max-w-[300px] text-[13.5px] leading-relaxed text-muted">{opts.message}</p>}

        {opts.rows && opts.rows.length > 0 && (
          <dl className="mt-4 rounded-field bg-[#F7F8FB] px-3 py-2 text-left text-[13px] text-body">
            {opts.rows.map((r) => (
              <div
                key={r.label}
                className={cx('flex items-center justify-between gap-3 py-1.5', r.highlight && 'my-1 rounded-lg bg-warn-bg px-2 font-bold text-warn-fg')}
              >
                <dt>{r.label}</dt>
                <dd className={cx('tabular', !r.highlight && 'font-semibold text-ink')}>{r.value}</dd>
              </div>
            ))}
          </dl>
        )}

        <div className="mt-5 flex flex-col gap-2.5">
          {opts.primary ? (
            <>
              <Button ref={firstFocus} block className="min-h-[50px] text-[13.5px] uppercase tracking-wide" onClick={run(opts.primary.onClick)}>
                {opts.primary.label}
              </Button>
              <Button variant="outline" block onClick={run(opts.secondary?.onClick)}>
                {opts.secondary?.label ?? tr('Funga')}
              </Button>
            </>
          ) : (
            <Button ref={firstFocus} block className="min-h-[50px] text-[13.5px] uppercase tracking-wide" onClick={run(opts.secondary?.onClick)}>
              {opts.secondary?.label ?? tr('Sawa')}
            </Button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

