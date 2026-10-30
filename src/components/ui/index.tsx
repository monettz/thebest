import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { twMerge } from 'tailwind-merge';
import { tr } from '@/i18n';
import { InlineSpinner, PageLoader, type LoaderVariant } from './loading';
export { Skeleton, InlineSpinner, PageLoader, ChartSkeleton, DashboardSkeleton, ListRowsSkeleton, PageHeaderSkeleton, ProductListSkeleton, StatStripSkeleton, TableSkeleton } from './loading';
export { AnimatedNumber } from './AnimatedNumber';
import { initials } from '@/lib/format';
import type { StockStatus } from '@shared/constants';
import { STOCK_STATUS_LABEL } from '@shared/constants';

/** Joins classes and lets the LAST conflicting utility win (so `bg-white` on a primary button really overrides `bg-primary`). */
export function cx(...parts: (string | false | null | undefined)[]) {
  return twMerge(parts.filter(Boolean).join(' '));
}

/* ---------- Button ---------- */
type Variant = 'primary' | 'outline' | 'ghost' | 'soft';
interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  block?: boolean;
  /** Shows a spinner and blocks clicks, so an action in progress can't be submitted twice. */
  loading?: boolean;
}
const VARIANTS: Record<Variant, string> = {
  // Disabled keeps readable text (grey on grey) instead of fading white-on-blue.
  primary: 'bg-primary text-white hover:bg-primary-link shadow-sm disabled:bg-slate-200 disabled:text-slate-600',
  outline: 'border border-line bg-white text-slate-700 shadow-sm hover:bg-slate-50 disabled:bg-slate-50 disabled:text-slate-500',
  ghost: 'text-body hover:bg-app disabled:text-slate-400',
  soft: 'bg-primary-tint text-primary-link hover:bg-bar-3 disabled:bg-slate-100 disabled:text-slate-500',
};
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', block, loading, className, type = 'button', disabled, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx(
        'inline-flex min-h-touch items-center justify-center gap-2 rounded-xl px-4 text-[14px] font-semibold transition duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1 active:scale-[0.98] disabled:cursor-not-allowed disabled:active:scale-100',
        VARIANTS[variant],
        block && 'w-full',
        loading && 'cursor-wait disabled:cursor-wait',
        loading && variant === 'primary' && 'disabled:bg-primary disabled:text-white',
        className,
      )}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading && <InlineSpinner />}
      {children}
    </button>
  );
});

/* ---------- Card ---------- */
export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx('card', className)}>{children}</div>;
}

/* ---------- Badge (status pill) ---------- */
const BADGE: Record<'ok' | 'warn' | 'bad' | 'navy' | 'blue', string> = {
  ok: 'bg-ok-bg text-ok-fg',
  warn: 'bg-warn-bg text-warn-fg',
  bad: 'bg-bad-bg text-bad-fg',
  navy: 'bg-navy text-white',
  blue: 'bg-primary-tint text-primary-link',
};
export function Badge({ tone, children, className }: { tone: keyof typeof BADGE; children: ReactNode; className?: string }) {
  return (
    <span className={cx('inline-flex items-center rounded-full px-2.5 py-0.5 text-[12px] font-bold', BADGE[tone], className)}>
      {typeof children === 'string' ? tr(children) : children}
    </span>
  );
}

export function StockBadge({ status }: { status: StockStatus }) {
  const tone = status === 'IPO' ? 'ok' : status === 'CHINI' ? 'warn' : 'bad';
  return <Badge tone={tone}>{tr(STOCK_STATUS_LABEL[status])}</Badge>;
}

/* ---------- Segmented tabs / chips ---------- */
export function Tabs<T extends string>({
  value,
  onChange,
  options,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  className?: string;
}) {
  return (
    <div
      className={cx(
        'no-scrollbar inline-flex max-w-full gap-1 overflow-x-auto rounded-xl border border-line bg-white p-1 shadow-sm',
        className,
      )}
      role="tablist"
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={o.value === value}
          onClick={() => onChange(o.value)}
          className={cx(
            'min-h-[40px] shrink-0 whitespace-nowrap rounded-lg px-3.5 text-[13px] font-semibold transition-all duration-150 sm:px-4 sm:text-[13.5px]',
            o.value === value ? 'bg-primary text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900',
          )}
        >
          {tr(o.label)}
        </button>
      ))}
    </div>
  );
}

/* ---------- Avatar (initials) ---------- */
export function Avatar({ name, size = 40, dark }: { name: string; size?: number; dark?: boolean }) {
  return (
    <span
      className={cx(
        'inline-flex shrink-0 items-center justify-center rounded-full font-bold',
        dark ? 'bg-primary text-white' : 'bg-primary-tint text-primary-link',
      )}
      style={{ width: size, height: size, fontSize: size * 0.34 }}
    >
      {initials(name)}
    </span>
  );
}

/* ---------- Product code tile (A15, SP ...) ---------- */
export function CodeTile({ code, size = 36 }: { code: string; size?: number }) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-chip bg-primary-tint font-extrabold text-primary-link"
      style={{ width: size, height: size, fontSize: Math.max(12, size * 0.3) }}
    >
      {code}
    </span>
  );
}

/* ---------- Toggle switch (44px touch area, 48x28 track) ---------- */
export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className="inline-flex h-11 w-14 shrink-0 items-center justify-center rounded-full"
    >
      <span className={cx('relative h-7 w-12 rounded-full transition-colors duration-200', checked ? 'bg-primary' : 'bg-line')}>
        <span
          className={cx(
            'absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all duration-200',
            checked ? 'left-[22px]' : 'left-0.5',
          )}
        />
      </span>
    </button>
  );
}

/* ---------- Field wrapper ---------- */
export function Field({ label, error, children, className }: { label: string; error?: string; children: ReactNode; className?: string }) {
  return (
    <label className={cx('block', className)}>
      <span className="label">{tr(label)}</span>
      {children}
      {error && <span className="mt-1 block text-[12px] font-medium text-bad-fg">{tr(error)}</span>}
    </label>
  );
}

/* ---------- Page header ---------- */
export function PageHeader({
  title,
  subtitle,
  badge,
  actions,
}: {
  title: string;
  subtitle?: string;
  badge?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-4 flex flex-col gap-3 border-b border-line-soft pb-4 sm:flex-row sm:items-start sm:justify-between md:mb-6 md:pb-5">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="text-[22px] font-extrabold leading-tight tracking-tight text-ink sm:text-[24px] md:text-[28px]">
            {tr(title)}
          </h1>
          {badge}
        </div>
        {subtitle && <p className="mt-1 text-[13px] leading-snug text-muted sm:text-[13.5px]">{tr(subtitle)}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/* ---------- KPI strip cell ---------- */
export function Kpi({
  label,
  value,
  note,
  tone = 'ink',
  icon,
  iconBg,
  delta,
  bare,
  className,
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  tone?: 'ink' | 'warn' | 'bad' | 'ok';
  icon?: ReactNode;
  iconBg?: string;
  delta?: { value: string; isPositive?: boolean };
  /** Standalone tile (no strip dividers). */
  bare?: boolean;
  className?: string;
}) {
  const color = tone === 'warn' ? 'text-warn-fg' : tone === 'bad' ? 'text-bad-fg' : tone === 'ok' ? 'text-ok-fg' : 'text-ink';
  return (
    <div
      className={cx(
        'min-w-0 p-3.5 transition-all duration-150 sm:p-5',
        !bare &&
        'border-line-soft max-xl:border-b max-xl:odd:border-r max-xl:[&:nth-last-child(-n+2)]:border-b-0 xl:border-r xl:p-6 xl:last:border-r-0',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted sm:text-[12px]">{tr(label)}</p>
        {icon && (
          <span className={cx('flex h-8 w-8 shrink-0 items-center justify-center rounded-xl sm:h-9 sm:w-9', iconBg ?? 'bg-primary-tint text-primary-link')}>
            {icon}
          </span>
        )}
      </div>
      <p className={cx('mt-1.5 text-[20px] font-extrabold leading-tight tracking-tight tabular-nums sm:mt-2 sm:text-[22px] xl:text-[26px]', color)}>
        {value}
      </p>
      {(note || delta) && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[12px] leading-snug text-muted sm:mt-2 sm:text-[12.5px]">
          {delta && (
            <span
              className={cx(
                'inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[11px] font-bold',
                delta.isPositive ? 'bg-ok-bg text-ok-fg' : 'bg-bad-bg text-bad-fg',
              )}
            >
              {delta.isPositive ? '↑' : '↓'} {delta.value}
            </span>
          )}
          {note && <span>{typeof note === 'string' ? tr(note) : note}</span>}
        </div>
      )}
    </div>
  );
}

/** Kept under its old name: every `if (!data) return <Spinner />` now gets the delayed, shape-matching skeleton with error/retry handling. */
export function Spinner({ variant, label }: { variant?: LoaderVariant; label?: string } = {}) {
  return <PageLoader variant={variant} label={label} />;
}
