import { useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { PAYMENT_LABEL, type PaymentMethod } from '@shared/constants';
import { useAuth } from '@/lib/auth';
import { timeDar, todayDar } from '@/lib/dar';
import { dayName, dayShort, formatCompact, formatDayMonth, formatLongDate, formatTZS, monthShort } from '@/lib/format';
import { listProducts } from '@/mock/api';
import { getShopDashboardLive } from '@/mock/ledger';
import { getDebtOverview, listSales, type SaleListItem } from '@/mock/sales';
import { AnimatedNumber, Spinner, cx } from '@/components/ui';
import { CalendarIcon, PlusIcon, SearchIcon } from '@/components/ui/icons';
import { tr } from '@/i18n';

/**
 * Shop dashboard, laid out as the "Safi" design: greeting and actions, period switch, four figures for the
 * chosen period, the sales trend beside the best sellers, then recent sales beside stock that is running low.
 * One layout for every width: cards stack on phones.
 */

type TrendTab = 'sales' | 'profit' | 'debts' | 'expenses';
type PeriodOption = 'today' | 'week' | 'month' | 'year' | 'custom';

const PERIODS: { value: Exclude<PeriodOption, 'custom'>; label: string }[] = [
  { value: 'today', label: 'Leo' },
  { value: 'week', label: 'Wiki hii' },
  { value: 'month', label: 'Mwezi' },
  { value: 'year', label: 'Mwaka' },
];

const VS: Record<PeriodOption, string> = {
  today: 'vs jana',
  week: 'vs wiki iliyopita',
  month: 'vs kipindi kilichopita',
  year: 'vs kipindi kilichopita',
  custom: 'vs kipindi kilichopita',
};

/** "HH:MM" in Dar → the matching Swahili greeting. */
const greetingOf = (hhmm: string) => {
  const h = Number(hhmm.slice(0, 2));
  return h < 12 ? 'Habari za asubuhi' : h < 16 ? 'Habari za mchana' : 'Habari za jioni';
};

/** Every day from start to end, oldest first (at least one). */
function daysBetween(start: Date, end: Date): Date[] {
  const out: Date[] = [];
  const d = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  while (d <= end) {
    out.push(new Date(d));
    d.setDate(d.getDate() + 1);
  }
  return out.length ? out : [new Date(end)];
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const fromIso = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};

const METHOD_TONE: Partial<Record<PaymentMethod, string>> = {
  CASH: 'bg-app text-body',
  BANK: 'bg-primary-tint text-primary-link',
};

function MethodPill({ sale }: { sale: SaleListItem }) {
  if (sale.status === 'VOID') return <Pill className="bg-bad-bg text-bad-fg">{tr('Imefutwa')}</Pill>;
  if (sale.status === 'PARTIAL') return <Pill className="bg-warn-bg text-warn-fg">{tr('Mkopo')}</Pill>;
  if (!sale.method) return <span className="text-muted">—</span>;
  return <Pill className={METHOD_TONE[sale.method] ?? 'bg-ok-bg text-ok-fg'}>{tr(PAYMENT_LABEL[sale.method])}</Pill>;
}

function Pill({ className, children }: { className: string; children: ReactNode }) {
  return <span className={cx('inline-flex whitespace-nowrap rounded-md px-2 py-0.5 text-[12px] font-semibold', className)}>{children}</span>;
}

/** Green up / red down; no change is grey. */
function Delta({ value, unit = '' }: { value: number; unit?: string }) {
  const tone = value > 0 ? 'bg-ok-bg text-ok-fg' : value < 0 ? 'bg-bad-bg text-bad-fg' : 'bg-app text-body';
  return (
    <span className={cx('whitespace-nowrap rounded-md px-1.5 py-0.5 font-semibold', tone)}>
      {value > 0 ? '↑ ' : value < 0 ? '↓ ' : ''}
      {Math.abs(value)}
      {unit}
    </span>
  );
}

function Kpi({ label, value, foot, tone }: { label: string; value: ReactNode; foot: ReactNode; tone?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-2.5 rounded-2xl border border-line bg-white p-4 sm:p-5">
      <span className="text-[13px] font-medium text-muted">{label}</span>
      <span className={cx('truncate text-[20px] font-bold leading-tight tracking-[-0.02em] tabular-nums sm:text-[24px] xl:text-[28px]', tone ?? 'text-ink')}>
        {value}
      </span>
      <span className="flex flex-wrap items-center gap-1.5 text-[12px] text-muted">{foot}</span>
    </div>
  );
}

function Panel({ title, action, children, className }: { title: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx('flex min-w-0 flex-col gap-4 rounded-2xl border border-line bg-white px-4 py-5 sm:px-6', className)}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 className="flex-1 whitespace-nowrap text-[16px] font-semibold text-ink">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function EmptyNote({ children }: { children: ReactNode }) {
  return (
    <p className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-line px-4 py-8 text-center text-[13px] text-muted">
      <span>{children}</span>
    </p>
  );
}

/** A readable top for the axis: 1, 2, 2.5, 3, 5 × 10ⁿ. */
function niceMax(v: number): number {
  if (v <= 0) return 300_000;
  const p = 10 ** Math.floor(Math.log10(v));
  return ([1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].map((m) => m * p).find((m) => m >= v) ?? 10 * p);
}

const short = (v: number) => (v >= 1_000_000 ? `${+(v / 1_000_000).toFixed(1)}M` : formatCompact(v));

/** The Safi bar chart: three dashed guides, value over each bar, the latest bar in solid blue. */
function TrendChart({ bars }: { bars: { label: string; value: number }[] }) {
  const max = niceMax(Math.max(0, ...bars.map((b) => b.value)));
  const empty = bars.every((b) => b.value === 0);
  const dense = bars.length > 14;
  const step = dense ? Math.ceil(bars.length / 8) : 1;
  return (
    <div className="flex h-[260px] gap-2 sm:gap-3">
      <div className="flex w-9 shrink-0 flex-col justify-between pb-[22px] text-right text-[11px] text-muted" aria-hidden>
        {[max, (max * 2) / 3, max / 3, 0].map((t, i) => (
          <span key={i} className="leading-none">{short(Math.round(t))}</span>
        ))}
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div
          className="relative flex flex-1 items-end border-b border-line"
          style={{ gap: dense ? 3 : 'clamp(6px, 1.6vw, 14px)' }}
          role="img"
          aria-label={empty ? tr('Hakuna mauzo katika kipindi hiki.') : tr('Mwenendo wa mauzo')}
        >
          {[1, 2].map((i) => (
            <div key={i} aria-hidden className="pointer-events-none absolute inset-x-0 border-t border-dashed border-line-soft" style={{ bottom: `${(i / 3) * 100}%` }} />
          ))}
          {bars.map((b, i) => {
            const last = i === bars.length - 1;
            return (
              <div key={i} className="relative flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1.5" title={`${b.label}: ${formatTZS(b.value)}`}>
                {!dense && b.value > 0 && (
                  <span className="hidden text-[11px] font-semibold text-body sm:block">{short(b.value)}</span>
                )}
                <div
                  className={cx('w-full max-w-[44px] rounded-t-lg rounded-b-[3px]', last ? 'bg-primary' : 'bg-[#C7D2FE]')}
                  style={{ height: `${(b.value / max) * 100}%`, minHeight: 3 }}
                />
              </div>
            );
          })}
          {empty && (
            <span className="absolute inset-0 flex items-center justify-center">
              <span className="rounded-lg bg-white/90 px-3 py-1.5 text-[13px] text-muted">{tr('Hakuna mauzo katika kipindi hiki.')}</span>
            </span>
          )}
        </div>
        <div className="flex pt-1.5" style={{ gap: dense ? 3 : 'clamp(6px, 1.6vw, 14px)' }} aria-hidden>
          {bars.map((b, i) => (
            <span key={i} className="h-4 min-w-0 flex-1 truncate text-center text-[11px] text-muted sm:text-[12px]">
              {i % step === 0 || i === bars.length - 1 ? b.label : ''}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/** "07:31" today, "Jana 19:48" yesterday, "21 Nov 18:40" before that. */
function whenOf(s: SaleListItem, today: string, yesterday: string) {
  if (s.date === today) return s.time;
  if (s.date === yesterday) return `${tr('Jana')} ${s.time}`;
  return `${formatDayMonth(fromIso(s.date))} ${s.time}`;
}

export default function Dashboard() {
  const { user, isOwner } = useAuth();
  const navigate = useNavigate();
  const today = useMemo(() => new Date(), []);
  const [tab, setTab] = useState<TrendTab>('sales');
  const [period, setPeriod] = useState<PeriodOption>('week');
  const [customFrom, setCustomFrom] = useState(() => iso(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6)));
  const [customTo, setCustomTo] = useState(() => iso(today));
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [q, setQ] = useState('');

  const days = useMemo(() => {
    const end = new Date(today);
    if (period === 'today') return [end];
    if (period === 'month') return daysBetween(new Date(end.getFullYear(), end.getMonth(), 1), end);
    if (period === 'year') return daysBetween(new Date(end.getFullYear(), 0, 1), end);
    if (period === 'custom' && customFrom && customTo && customFrom <= customTo) return daysBetween(fromIso(customFrom), fromIso(customTo));
    return daysBetween(new Date(end.getFullYear(), end.getMonth(), end.getDate() - 6), end);
  }, [period, today, customFrom, customTo]);

  const { data, isLoading, refetch, dataUpdatedAt } = useQuery({
    queryKey: ['shop-dashboard', user?.role, period, customFrom, customTo],
    queryFn: () => getShopDashboardLive(user!.role, days),
  });
  const { data: debts } = useQuery({ queryKey: ['debts'], queryFn: getDebtOverview });
  const { data: recent } = useQuery({ queryKey: ['sales', '', 5], queryFn: () => listSales('', 5), select: (r) => r.items });
  const { data: products } = useQuery({ queryKey: ['products', user?.role], queryFn: () => listProducts(user!.role) });

  if (isLoading || !data || !debts) return <Spinner variant="dashboard" />;

  const p = data.period ?? { sales: data.weekTotal, count: data.salesCount, salesPct: 0, countDelta: 0, net: data.netProfitToday };
  const firstName = user?.name.trim().split(/\s+/)[0] ?? '';
  const todayIso = todayDar();
  const yesterdayIso = todayDar(new Date(today.getTime() - 86_400_000));
  const needle = q.trim().toLowerCase();

  const tabs: { value: TrendTab; label: string; title: string }[] = [
    { value: 'sales', label: tr('Mauzo'), title: tr('Mwenendo wa mauzo') },
    ...(isOwner ? [{ value: 'profit' as const, label: tr('Faida'), title: tr('Mwenendo wa faida') }] : []),
    { value: 'debts', label: tr('Madeni'), title: tr('Mwenendo wa madeni') },
    { value: 'expenses', label: tr('Matumizi'), title: tr('Mwenendo wa matumizi') },
  ];
  const active = tabs.find((t) => t.value === tab) ?? tabs[0];

  const perDay =
    tab === 'profit' ? days.map((_, i) => data.weekProfit?.[i] ?? 0)
    : tab === 'expenses' ? days.map((_, i) => data.weekExpenses?.[i] ?? 0)
    : tab === 'debts' ? days.map((_, i) => (i === days.length - 1 ? debts.totalDebt : 0))
    : days.map((_, i) => data.week[i] ?? 0);

  // A whole year reads as twelve months; anything else as one bar per day.
  const bars =
    period === 'year'
      ? Array.from({ length: today.getMonth() + 1 }, (_, m) => ({
          label: monthShort(`${today.getFullYear()}-${String(m + 1).padStart(2, '0')}`),
          value: days.reduce((sum, d, i) => (d.getMonth() === m ? sum + perDay[i] : sum), 0),
        }))
      : days.map((d, i) => ({
          label: period === 'month' || days.length > 14 ? String(d.getDate()) : dayShort(d),
          value: perDay[i],
        }));

  const top = data.topProducts.filter((t) => !needle || t.name.toLowerCase().includes(needle));
  const lowStock = (products ?? [])
    .filter((x) => x.shopStatus !== 'IPO' && (!needle || x.name.toLowerCase().includes(needle)))
    .sort((a, b) => a.shopQty - a.minStock - (b.shopQty - b.minStock));
  const sales = (recent ?? []).filter((s) => !needle || s.receiptNo.toLowerCase().includes(needle) || s.customerName.toLowerCase().includes(needle));

  const range = days.length === 1 ? formatLongDate(days[0]) : `${formatDayMonth(days[0])} – ${formatLongDate(days[days.length - 1])}`;

  return (
    <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-5 md:gap-6">
      <header className="flex flex-wrap items-center gap-3">
        <div className="flex min-w-[220px] flex-1 flex-col gap-1">
          <span className="text-[13px] text-muted">
            {dayName(today)}, {formatLongDate(today)}
          </span>
          <h1 className="text-[22px] font-bold leading-tight tracking-[-0.02em] text-ink md:text-[26px]">
            {tr(greetingOf(timeDar()))}
            {firstName && `, ${firstName}`}
          </h1>
        </div>
        <label className="flex h-11 w-full items-center gap-2 rounded-xl border border-line bg-white px-3.5 text-muted focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20 sm:w-[280px]">
          <SearchIcon width={18} height={18} />
          <span className="sr-only">{tr('Tafuta')}</span>
          <input
            type="search"
            className="min-w-0 flex-1 bg-transparent text-[14px] text-ink outline-none placeholder:text-muted/80"
            placeholder={tr('Tafuta bidhaa, mteja, risiti…')}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
        {/* Phones have a floating sell button instead. The bell lives in the top bar. */}
        <Link
          to="/pos"
          className="hidden h-11 items-center gap-2 rounded-xl bg-primary px-[18px] text-[14px] font-semibold text-white transition hover:bg-primary-link md:inline-flex"
        >
          <PlusIcon width={18} height={18} /> {tr('Uza sasa')}
        </Link>
      </header>

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div role="tablist" aria-label={tr('Chagua kipindi')} className="flex gap-0.5 rounded-xl border border-line bg-white p-1">
            {PERIODS.map((o) => (
              <button
                key={o.value}
                type="button"
                role="tab"
                aria-selected={period === o.value}
                onClick={() => {
                  setPeriod(o.value);
                  setShowDatePicker(false);
                }}
                className={cx(
                  'h-[34px] rounded-lg px-3 text-[13px] transition-colors sm:px-3.5',
                  period === o.value ? 'bg-ink font-semibold text-white' : 'font-medium text-body hover:bg-app',
                )}
              >
                {tr(o.label)}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setShowDatePicker(!showDatePicker)}
            aria-expanded={showDatePicker}
            title={tr('Kipindi maalum')}
            className={cx(
              'inline-flex h-11 items-center gap-2 rounded-xl border bg-white px-3.5 text-[13px] font-medium text-body transition hover:bg-app',
              period === 'custom' ? 'border-ink' : 'border-line',
            )}
          >
            <CalendarIcon width={16} height={16} />
            {range}
          </button>
          <button
            type="button"
            onClick={() => void refetch()}
            title={tr('Onyesha upya')}
            className="ml-auto min-h-[44px] text-[12px] text-muted hover:text-ink"
          >
            {tr('Imesasishwa saa {t}', { t: timeDar(new Date(dataUpdatedAt || Date.now())) })}
          </button>
        </div>

        {showDatePicker && (
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-white p-3 animate-fade-in">
            <label className="flex items-center gap-2 text-[12.5px] font-medium text-muted">
              {tr('Kuanzia')}:
              <input type="date" value={customFrom} max={customTo} onChange={(e) => setCustomFrom(e.target.value)} className="h-10 rounded-lg border border-line px-2 text-[13px] text-ink outline-none focus:border-primary" />
            </label>
            <label className="flex items-center gap-2 text-[12.5px] font-medium text-muted">
              {tr('Hadi')}:
              <input type="date" value={customTo} min={customFrom} max={iso(today)} onChange={(e) => setCustomTo(e.target.value)} className="h-10 rounded-lg border border-line px-2 text-[13px] text-ink outline-none focus:border-primary" />
            </label>
            <button
              type="button"
              onClick={() => {
                if (customFrom && customTo && customFrom <= customTo) {
                  setPeriod('custom');
                  setShowDatePicker(false);
                }
              }}
              className="min-h-[40px] rounded-lg bg-primary-tint px-3.5 text-[13px] font-semibold text-primary-link hover:bg-[#DCE6FB]"
            >
              {tr('Tumia')}
            </button>
            <button type="button" onClick={() => setShowDatePicker(false)} className="min-h-[40px] rounded-lg px-3 text-[13px] font-semibold text-muted hover:bg-app">
              {tr('Funga')}
            </button>
          </div>
        )}
      </div>

      <div className={cx('grid grid-cols-2 gap-3 sm:gap-4', isOwner ? 'xl:grid-cols-4' : 'xl:grid-cols-3')}>
        <Kpi
          label={tr('Mauzo')}
          value={<AnimatedNumber id="dash.sales" value={p.sales} format={formatTZS} />}
          foot={
            <>
              <Delta value={p.salesPct} unit="%" /> {tr(VS[period])}
            </>
          }
        />
        <Kpi
          label={tr('Idadi ya mauzo')}
          value={<AnimatedNumber id="dash.count" value={p.count} />}
          foot={
            <>
              <Delta value={p.countDelta} />
              {p.count > 0 ? tr('wastani {t}', { t: formatTZS(Math.round(p.sales / p.count)) }) : tr(VS[period])}
            </>
          }
        />
        {isOwner && p.net !== undefined && (
          <Kpi
            label={tr('Faida halisi')}
            tone="text-[#15803D]"
            value={<AnimatedNumber id="dash.net" value={p.net} format={formatTZS} />}
            foot={
              <>
                <span className="rounded-md bg-app px-1.5 py-0.5 font-semibold text-body">
                  {p.sales > 0 ? Math.round((p.net / p.sales) * 100) : 0}%
                </span>
                {tr('baada ya matumizi')}
              </>
            }
          />
        )}
        <Kpi
          label={tr('Jumla ya madeni')}
          tone="text-[#B45309]"
          value={<AnimatedNumber id="dash.debt" value={debts.totalDebt} format={formatTZS} />}
          foot={
            <Link to="/debts" className="font-semibold text-warn-fg hover:underline">
              {tr('Wateja {n} wanadaiwa', { n: debts.debtorCount })} →
            </Link>
          }
        />
      </div>

      <div className="flex flex-wrap gap-4">
        <Panel
          title={active.title}
          className="flex-[2_1_520px]"
          action={
            <div role="tablist" aria-label={tr('Kipimo')} className="flex flex-wrap gap-1">
              {tabs.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  role="tab"
                  aria-selected={tab === t.value}
                  onClick={() => setTab(t.value)}
                  className={cx(
                    'h-9 rounded-lg border px-3 text-[12px] transition-colors',
                    tab === t.value ? 'border-primary bg-[#EEF2FF] font-semibold text-primary-link' : 'border-line bg-white font-medium text-body hover:bg-app',
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
          }
        >
          <TrendChart bars={bars} />
        </Panel>

        <Panel
          title={tr('Zinazouzwa zaidi')}
          className="flex-[1_1_300px]"
          action={
            <Link to="/reports" className="text-[13px] font-semibold text-primary-link hover:underline">
              {tr('Zote')}
            </Link>
          }
        >
          {top.length === 0 ? (
            <EmptyNote>{needle ? tr('Hakuna bidhaa iliyopatikana.') : tr('Hakuna mauzo katika kipindi hiki.')}</EmptyNote>
          ) : (
            <ul className="flex flex-col gap-4">
              {top.map((t) => (
                <li key={t.name} className="flex flex-col gap-1.5">
                  <div className="flex items-baseline gap-2 text-[13px]">
                    <span className="min-w-0 flex-1 truncate font-medium text-ink">{t.name}</span>
                    <span className="shrink-0 text-muted">{tr('{n} pcs', { n: t.sold })}</span>
                    <span className="w-[82px] shrink-0 text-right font-semibold tabular-nums text-ink">{t.revenue.toLocaleString('en-US')}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-app">
                    <div className="h-1.5 rounded-full bg-primary" style={{ width: `${Math.max(3, t.revenuePct)}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <div className="flex flex-wrap items-start gap-4">
        <Panel
          title={tr('Mauzo ya hivi karibuni')}
          className="flex-[2_1_520px]"
          action={
            <Link to="/sales" className="text-[13px] font-semibold text-primary-link hover:underline">
              {tr('Ona yote')}
            </Link>
          }
        >
          {!recent ? (
            <Spinner variant="list" />
          ) : sales.length === 0 ? (
            <EmptyNote>
              {needle ? tr('Hakuna mauzo yaliyopatikana.') : tr('Hakuna mauzo bado.')}{' '}
              {!needle && (
                <Link to="/pos" className="font-semibold text-primary-link hover:underline">
                  {tr('Anza kuuza')}
                </Link>
              )}
            </EmptyNote>
          ) : (
            <>
              {/* Phones: one row per sale. */}
              <ul className="-mt-1 flex flex-col sm:hidden">
                {sales.map((s) => (
                  <li key={s.id} className="border-b border-line-soft last:border-0">
                    <Link to={`/sales/${s.id}`} className="flex min-h-[56px] items-center gap-3 py-2.5">
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="truncate text-[13.5px] font-semibold text-ink">
                          {s.receiptNo} · {tr(s.customerName)}
                        </span>
                        <span className="flex items-center gap-2 text-[12px] text-muted">
                          <MethodPill sale={s} /> {whenOf(s, todayIso, yesterdayIso)}
                        </span>
                      </span>
                      <span className="shrink-0 text-[13.5px] font-semibold tabular-nums text-ink">{formatTZS(s.total)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
              {/* Wider screens: the table. */}
              <div className="hidden overflow-x-auto sm:block">
                <table className="w-full min-w-[520px] border-collapse text-[13px]">
                  <thead>
                    <tr className="text-left text-[12px] text-muted">
                      <th className="border-b border-line py-2 font-medium">{tr('Risiti')}</th>
                      <th className="border-b border-line py-2 font-medium">{tr('Mteja')}</th>
                      <th className="border-b border-line py-2 font-medium">{tr('Malipo')}</th>
                      <th className="border-b border-line py-2 font-medium">{tr('Saa')}</th>
                      <th className="border-b border-line py-2 text-right font-medium">{tr('Kiasi')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sales.map((s) => (
                      <tr key={s.id} className="cursor-pointer hover:bg-app/60" onClick={() => navigate(`/sales/${s.id}`)}>
                        <td className="border-b border-line-soft py-3 font-semibold text-ink">
                          <Link to={`/sales/${s.id}`} className="hover:underline" onClick={(e) => e.stopPropagation()}>
                            {s.receiptNo}
                          </Link>
                        </td>
                        <td className="max-w-[220px] truncate border-b border-line-soft py-3 text-ink">{tr(s.customerName)}</td>
                        <td className="border-b border-line-soft py-3">
                          <MethodPill sale={s} />
                        </td>
                        <td className="border-b border-line-soft py-3 text-muted">{whenOf(s, todayIso, yesterdayIso)}</td>
                        <td className="border-b border-line-soft py-3 text-right font-semibold tabular-nums text-ink">{formatTZS(s.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Panel>

        <Panel
          title={tr('Stock inayoisha')}
          className="flex-[1_1_300px]"
          action={
            lowStock.length > 0 ? (
              <span className="rounded-full bg-bad-bg px-2 py-0.5 text-[12px] font-bold text-bad-fg">{lowStock.length}</span>
            ) : undefined
          }
        >
          {!products ? (
            <Spinner variant="list" />
          ) : lowStock.length === 0 ? (
            <EmptyNote>{tr('Stock yote ya duka iko juu ya kiwango cha chini.')}</EmptyNote>
          ) : (
            <ul className="-mt-1 flex flex-col">
              {lowStock.slice(0, 5).map((x) => (
                <li key={x.id} className="flex items-center gap-3 border-b border-line-soft py-2.5 last:border-0">
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate text-[13px] font-medium text-ink">{x.name}</span>
                    <span className="text-[12px] text-muted">
                      {x.shopQty <= 0 ? tr('Imeisha') : tr('Zimebaki {n}', { n: x.shopQty })} · {tr('kiwango {n}', { n: x.minStock })}
                    </span>
                  </div>
                  <Link
                    to="/stock-in"
                    className="inline-flex min-h-[36px] shrink-0 items-center rounded-lg border border-line px-2.5 text-[12px] font-semibold text-ink transition hover:bg-app"
                  >
                    {tr('Ingiza')}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
