/**
 * Loading kit: one place for skeletons, the page loader and the inline spinner, so every screen
 * loads the same way. Skeletons copy the shape of the content they stand in for and share the
 * `.skeleton` shimmer in index.css (which is switched off by prefers-reduced-motion).
 *
 * No `cx`/Button imports here on purpose: ui/index.tsx re-exports Spinner from this file.
 */
import { useEffect, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { tr } from '@/i18n';

const join = (...p: (string | false | null | undefined)[]) => p.filter(Boolean).join(' ');

/* ---------- Primitives ---------- */
export function Skeleton({ className, style }: { className?: string; style?: CSSProperties }) {
  return <div aria-hidden className={join('skeleton', className)} style={style} />;
}

/** Small spinner for buttons and inline work. Inherits the text colour. */
export function InlineSpinner({ className }: { className?: string }) {
  return (
    <svg className={join('h-4 w-4 animate-spin', className)} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

const Card = ({ className, children }: { className?: string; children?: React.ReactNode }) => (
  <div aria-hidden className={join('rounded-2xl border border-line bg-white', className)}>{children}</div>
);

/* ---------- Shapes that mirror real content ---------- */
export function PageHeaderSkeleton({ actions = 1 }: { actions?: number }) {
  return (
    <div aria-hidden className="mb-4 flex items-start justify-between gap-3 border-b border-line-soft pb-4 md:mb-6 md:pb-5">
      <div className="space-y-2">
        <Skeleton className="h-7 w-44 md:h-8" />
        <Skeleton className="h-3.5 w-64 max-w-[70vw]" />
      </div>
      <div className="flex gap-2">{Array.from({ length: actions }, (_, i) => <Skeleton key={i} className="h-10 w-24 rounded-xl" />)}</div>
    </div>
  );
}

export function StatStripSkeleton({ cells = 4 }: { cells?: number }) {
  return (
    <Card className="overflow-hidden">
      <div className={join('grid grid-cols-2 divide-y divide-line-soft md:divide-y-0 md:divide-x', cells === 3 ? 'md:grid-cols-3' : 'md:grid-cols-4')}>
        {Array.from({ length: cells }, (_, i) => (
          <div key={i} className="space-y-2.5 p-4 md:p-5">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-7 w-32" />
            <Skeleton className="h-3 w-24" />
          </div>
        ))}
      </div>
    </Card>
  );
}

/** Bars of different heights, like the real weekly chart. */
export function ChartSkeleton({ height = 220, bars = 7 }: { height?: number; bars?: number }) {
  const heights = [45, 78, 38, 62, 50, 85, 70, 55];
  return (
    <div aria-hidden className="flex items-end justify-between gap-3 px-1" style={{ height }}>
      {Array.from({ length: bars }, (_, i) => (
        <div key={i} className="flex flex-1 flex-col items-center justify-end gap-2" style={{ height: '100%' }}>
          <Skeleton className="w-full max-w-[56px] rounded-t-lg" style={{ height: `${heights[i % heights.length]}%` }} />
          <Skeleton className="h-3 w-8" />
        </div>
      ))}
    </div>
  );
}

export function ListRowsSkeleton({ rows = 5, avatar = true }: { rows?: number; avatar?: boolean }) {
  return (
    <ul aria-hidden className="divide-y divide-line-soft">
      {Array.from({ length: rows }, (_, i) => (
        <li key={i} className="flex items-center gap-3 px-4 py-3">
          {avatar && <Skeleton className="h-10 w-10 shrink-0 rounded-full" />}
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-3.5 w-40 max-w-full" />
            <Skeleton className="h-3 w-28" />
          </div>
          <div className="space-y-2 text-right">
            <Skeleton className="ml-auto h-3.5 w-20" />
            <Skeleton className="ml-auto h-4 w-14 rounded-full" />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** A table card: toolbar, header row and body rows. Rows collapse to list rows on phones. */
export function TableSkeleton({ rows = 7, cols = 5, toolbar = true }: { rows?: number; cols?: number; toolbar?: boolean }) {
  return (
    <Card className="overflow-hidden">
      {toolbar && (
        <div className="flex flex-wrap items-center gap-2.5 p-4">
          <Skeleton className="h-10 w-full rounded-xl sm:w-64" />
          <Skeleton className="hidden h-10 w-72 rounded-xl md:block" />
        </div>
      )}
      <div className="hidden md:block">
        <div className="grid gap-4 border-y border-line-soft bg-app/60 px-5 py-3" style={{ gridTemplateColumns: `2fr repeat(${cols - 1}, 1fr)` }}>
          {Array.from({ length: cols }, (_, i) => <Skeleton key={i} className="h-3 w-16" />)}
        </div>
        {Array.from({ length: rows }, (_, r) => (
          <div key={r} className="grid items-center gap-4 border-b border-line-soft px-5 py-3.5 last:border-0" style={{ gridTemplateColumns: `2fr repeat(${cols - 1}, 1fr)` }}>
            <div className="flex items-center gap-3"><Skeleton className="h-9 w-9 shrink-0 rounded-lg" /><Skeleton className="h-3.5 w-32" /></div>
            {Array.from({ length: cols - 1 }, (_, c) => <Skeleton key={c} className="h-3.5 w-16" />)}
          </div>
        ))}
      </div>
      <div className="md:hidden"><ListRowsSkeleton rows={Math.min(rows, 6)} /></div>
    </Card>
  );
}

/** Product tiles or product rows (catalogue, stock list). */
export function ProductListSkeleton({ count = 8, grid = false }: { count?: number; grid?: boolean }) {
  if (grid) {
    return (
      <div aria-hidden className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: count }, (_, i) => (
          <Card key={i} className="space-y-3 p-3">
            <Skeleton className="h-24 w-full rounded-xl" />
            <Skeleton className="h-3.5 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
            <Skeleton className="h-4 w-24" />
          </Card>
        ))}
      </div>
    );
  }
  return (
    <Card className="overflow-hidden">
      <ul aria-hidden className="divide-y divide-line-soft">
        {Array.from({ length: count }, (_, i) => (
          <li key={i} className="flex items-center gap-3 px-4 py-3">
            <Skeleton className="h-11 w-11 shrink-0 rounded-[10px]" />
            <div className="min-w-0 flex-1 space-y-2"><Skeleton className="h-3.5 w-44 max-w-full" /><Skeleton className="h-3 w-32" /></div>
            <Skeleton className="h-6 w-16 rounded-full" />
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** Dashboard: mobile hero + two tiles + chart + list, or the desktop strip + tabs + chart + two cards. */
export function DashboardSkeleton() {
  return (
    <div aria-hidden>
      <div className="space-y-4 md:hidden">
        <Skeleton className="h-[170px] rounded-[24px]" />
        <div className="grid grid-cols-2 gap-3"><Skeleton className="h-24 rounded-2xl" /><Skeleton className="h-24 rounded-2xl" /></div>
        <Card className="p-5"><Skeleton className="mb-4 h-4 w-32" /><ChartSkeleton height={160} /></Card>
        <Card><ListRowsSkeleton rows={3} /></Card>
      </div>
      <div className="hidden space-y-6 md:block">
        <PageHeaderSkeleton actions={2} />
        <StatStripSkeleton cells={4} />
        <div className="flex items-center justify-between"><Skeleton className="h-11 w-72 rounded-xl" /><Skeleton className="h-10 w-64 rounded-xl" /></div>
        <Card className="space-y-4 p-6"><Skeleton className="h-4 w-36" /><Skeleton className="h-9 w-56" /><ChartSkeleton height={250} /></Card>
        <div className="grid grid-cols-2 gap-6"><Card><ListRowsSkeleton rows={4} /></Card><Card><ListRowsSkeleton rows={4} /></Card></div>
      </div>
    </div>
  );
}

export type LoaderVariant = 'dashboard' | 'table' | 'products' | 'catalogue' | 'cards' | 'list' | 'form';

function VariantSkeleton({ variant }: { variant: LoaderVariant }) {
  switch (variant) {
    case 'dashboard': return <DashboardSkeleton />;
    case 'table': return <><PageHeaderSkeleton actions={2} /><TableSkeleton /></>;
    case 'products': return <><PageHeaderSkeleton actions={2} /><StatStripSkeleton cells={4} /><div className="mt-4"><ProductListSkeleton count={7} /></div></>;
    case 'catalogue': return <><PageHeaderSkeleton actions={2} /><Skeleton className="mb-4 h-10 w-full rounded-xl" /><ProductListSkeleton grid count={9} /></>;
    case 'cards': return <><PageHeaderSkeleton /><StatStripSkeleton cells={3} /><div className="mt-4"><TableSkeleton rows={5} toolbar={false} /></div></>;
    case 'list': return <Card className="overflow-hidden"><ListRowsSkeleton rows={6} /></Card>;
    case 'form': return <><PageHeaderSkeleton /><Card className="space-y-4 p-5">{[0, 1, 2, 3].map((i) => <div key={i} className="space-y-2"><Skeleton className="h-3 w-24" /><Skeleton className="h-11 w-full rounded-xl" /></div>)}</Card></>;
  }
}

/* ---------- Loader: delay, failure and slow-load handling ---------- */

/** True only after `ms`: a request that finishes within that time never shows a skeleton at all. */
export function useAfter(ms: number): boolean {
  const [on, setOn] = useState(ms <= 0);
  useEffect(() => {
    if (ms <= 0) return;
    const t = setTimeout(() => setOn(true), ms);
    return () => clearTimeout(t);
  }, [ms]);
  return on;
}

/** Keys of mounted queries that have failed. Stable string so the store can be read without re-render loops. */
function useFailedQueryKeys(): string {
  const cache = useQueryClient().getQueryCache();
  const snapshot = () =>
    cache
      .getAll()
      .filter((q) => q.state.status === 'error' && q.getObserversCount() > 0)
      .map((q) => q.queryHash)
      .sort()
      .join('|');
  return useSyncExternalStore((cb) => cache.subscribe(cb), snapshot, snapshot);
}

const SLOW_MS = 12_000;

/**
 * What a screen shows instead of its content until data is ready.
 *  - nothing for the first 150 ms (fast loads never flash a skeleton),
 *  - then a skeleton shaped like the page,
 *  - an error card with Retry as soon as a request has failed (never an endless skeleton),
 *  - a "taking longer than usual" notice with Retry after 12 s.
 */
export function PageLoader({ variant = 'cards', label = 'Inapakia…' }: { variant?: LoaderVariant; label?: string }) {
  const qc = useQueryClient();
  const show = useAfter(150);
  const slow = useAfter(SLOW_MS);
  const failed = useFailedQueryKeys();
  const retry = () => void qc.refetchQueries({ predicate: (q) => q.getObserversCount() > 0 && (q.state.status === 'error' || q.state.data === undefined) });

  if (failed) {
    return (
      <div role="alert" className="mx-auto mt-10 max-w-md rounded-2xl border border-line bg-white p-6 text-center">
        <p className="text-[15px] font-bold text-ink">{tr('Imeshindikana kupakia data')}</p>
        <p className="mt-1 text-[13px] text-muted">{tr('Kuna tatizo wakati wa kupakia taarifa hizi. Jaribu tena.')}</p>
        <button type="button" onClick={retry} className="mt-4 inline-flex min-h-touch items-center justify-center rounded-xl bg-primary px-5 text-[14px] font-semibold text-white transition hover:bg-primary-link focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 active:scale-[0.98]">
          {tr('Jaribu tena')}
        </button>
      </div>
    );
  }
  if (!show) return <div aria-busy="true" className="min-h-[60vh]" />; // keeps the page height, draws nothing yet
  return (
    <div role="status" aria-busy="true" aria-label={tr(label)} className="animate-fade-in">
      <VariantSkeleton variant={variant} />
      {slow && (
        <p className="mt-4 text-center text-[13px] text-muted">
          {tr('Inachukua muda mrefu kuliko kawaida…')}{' '}
          <button type="button" onClick={retry} className="font-semibold text-primary-link underline">{tr('Jaribu tena')}</button>
        </p>
      )}
    </div>
  );
}
