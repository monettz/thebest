import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { dayShort, formatCompact, formatDayMonth, formatLongDate, formatTZS, formatTZSCompact } from '@/lib/format';
import type { ShopDashboard } from '@/mock/api';
import { getShopDashboardLive } from '@/mock/ledger';
import { getDebtOverview } from '@/mock/sales';
import { Avatar, Badge, Button, Card, CodeTile, Spinner, cx } from '@/components/ui';
import {
  CalendarIcon,
  ChevronDown,
  PlusIcon,
  RefreshIcon,
  SearchIcon,
} from '@/components/ui/icons';
import { AnimatedNumber } from '@/components/ui';
import { tr } from '@/i18n';

type TrendTab = 'sales' | 'profit' | 'debts' | 'expenses';
type PeriodOption = 'today' | 'week' | 'month' | 'custom';

/** The N days ending today, oldest first. */
function dateRangeDays(startDate: Date, endDate: Date): Date[] {
  const dates: Date[] = [];
  const curr = new Date(startDate);
  while (curr <= endDate) {
    dates.push(new Date(curr));
    curr.setDate(curr.getDate() + 1);
  }
  return dates.length > 0 ? dates : [new Date(endDate)];
}

/** +12% / -7% with the matching colour. */
const signed = (n: number, unit = '') => `${n > 0 ? '+' : ''}${n}${unit}`;

const TAG_TONE: Record<string, 'warn' | 'bad'> = { soon: 'warn', overdue: 'bad' };

export default function Dashboard() {
  const { user, isOwner } = useAuth();
  const navigate = useNavigate();
  const today = useMemo(() => new Date(), []);
  const defaultFrom = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 6);
    return d.toISOString().slice(0, 10);
  }, []);
  const defaultTo = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const [tab, setTab] = useState<TrendTab>('sales');
  const [period, setPeriod] = useState<PeriodOption>('week');
  const [customFrom, setCustomFrom] = useState<string>(defaultFrom);
  const [customTo, setCustomTo] = useState<string>(defaultTo);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [q, setQ] = useState('');

  const days = useMemo(() => {
    const end = new Date(today);
    let start = new Date(today);

    if (period === 'today') {
      return [end];
    } else if (period === 'week') {
      start.setDate(end.getDate() - 6);
      return dateRangeDays(start, end);
    } else if (period === 'month') {
      start = new Date(end.getFullYear(), end.getMonth(), 1);
      return dateRangeDays(start, end);
    } else if (period === 'custom' && customFrom && customTo) {
      const s = new Date(customFrom);
      const e = new Date(customTo);
      return dateRangeDays(s, e);
    }
    // Default 7 days
    start.setDate(end.getDate() - 6);
    return dateRangeDays(start, end);
  }, [period, today, customFrom, customTo]);

  const { data: base, isLoading, refetch } = useQuery({
    queryKey: ['shop-dashboard', user?.role, period, customFrom, customTo],
    queryFn: () => getShopDashboardLive(user!.role, days),
  });
  const { data: debts } = useQuery({ queryKey: ['debts'], queryFn: getDebtOverview });

  if (isLoading || !base || !debts) return <Spinner variant="dashboard" />;

  // Debts come from the real sales ledger, not the sample dashboard numbers.
  const data: ShopDashboard = {
    ...base,
    totalDebt: debts.totalDebt,
    debtorCount: debts.debtorCount,
    debtors: debts.rows.slice(0, 5).map((r) => ({
      id: r.saleId,
      name: r.customer.name,
      item: r.item,
      since: formatDayMonth(new Date(`${r.saleDate}T00:00:00`)),
      amount: r.balance,
      tag: { kind: r.due?.kind === 'overdue' ? 'overdue' : 'soon', label: r.due ? tr(r.due.label) : tr('Hakuna tarehe') },
    })),
  };

  const tabs: { value: TrendTab; label: string }[] = [
    { value: 'sales', label: tr('Mwenendo wa mauzo') },
    ...(isOwner ? [{ value: 'profit' as const, label: tr('Faida') }] : []),
    { value: 'debts', label: tr('Madeni') },
    { value: 'expenses', label: tr('Matumizi') },
  ];

  // Configure chart data based on active tab
  let chartSeries = days.map((_, i) => data.week[i] ?? 0);
  let chartTotal = chartSeries.reduce((a, b) => a + b, 0);
  let chartTitle = tr('Takwimu za mauzo');
  let chartSubtitle = tr('Idadi ya miamala na mauzo ya wiki');

  if (tab === 'profit') {
    chartSeries = days.map((_, i) => data.weekProfit?.[i] ?? 0);
    chartTotal = chartSeries.reduce((a, b) => a + b, 0);
    chartTitle = tr('Takwimu za faida halisi');
    chartSubtitle = tr('Faida baada ya gharama za bidhaa na matumizi');
  } else if (tab === 'expenses') {
    chartSeries = days.map((_, i) => data.weekExpenses?.[i] ?? 0);
    chartTotal = chartSeries.reduce((a, b) => a + b, 0);
    chartTitle = tr('Takwimu za matumizi');
    chartSubtitle = tr('Matumizi yote yaliyorekodiwa');
  } else if (tab === 'debts') {
    chartSeries = days.map(() => 0);
    if (chartSeries.length > 0) chartSeries[chartSeries.length - 1] = data.totalDebt;
    chartTotal = data.totalDebt;
    chartTitle = tr('Mwenendo wa madeni');
    chartSubtitle = tr('Madeni yanayosubiri kukusanywa');
  }

  const needle = q.trim().toLowerCase();
  const filteredProducts = data.topProducts.filter(
    (p) => !needle || p.name.toLowerCase().includes(needle) || p.sub.toLowerCase().includes(needle),
  );
  const filteredDebtors = data.debtors.filter(
    (d) => !needle || d.name.toLowerCase().includes(needle) || d.item.toLowerCase().includes(needle),
  );

  return (
    <>
      {/* ---------- Mobile View ---------- */}
      <div className="space-y-4 md:hidden">
        <section className="relative overflow-hidden rounded-[24px] bg-gradient-to-br from-primary via-primary to-blue-700 p-5 text-white shadow-lg">
          <div className="flex items-center justify-between text-[13px] text-blue-100">
            <span>{tr('Mauzo ya leo')} · {today.getDate()} {formatLongDate(today).split(' ')[1]}</span>
            <span className="inline-flex items-center gap-1 rounded-full bg-white/20 px-2.5 py-0.5 text-[12px] font-bold text-white backdrop-blur-sm">
              {data.salesTrendPct >= 0 ? '↑' : '↓'} {signed(data.salesTrendPct, '%')}
            </span>
          </div>
          <p className="mt-2 text-[32px] font-extrabold tracking-tight tabular-nums">{<AnimatedNumber id="dash.salesToday" value={data.salesToday} format={formatTZS} />}</p>
          <div className="mt-4 grid grid-cols-2 gap-2.5">
            {isOwner && data.netProfitToday !== undefined && (
              <div className="rounded-2xl bg-white/15 p-3 backdrop-blur-sm">
                <p className="text-[12px] text-blue-100">{tr('Faida halisi')}</p>
                <p className="mt-0.5 whitespace-nowrap text-[16px] font-extrabold tabular-nums">{<AnimatedNumber id="dash.net" value={data.netProfitToday} format={formatTZS} />}</p>
              </div>
            )}
            <div className="rounded-2xl bg-white/15 p-3 backdrop-blur-sm">
              <p className="text-[12px] text-blue-100">{tr('Idadi ya mauzo')}</p>
              <p className="mt-0.5 text-[17px] font-extrabold tabular-nums">{tr('mauzo {n}', { n: data.salesCount })}</p>
            </div>
          </div>
        </section>

        <div className="grid grid-cols-2 gap-3">
          <Card className="p-4">
            <p className="text-[12px] font-semibold text-muted uppercase tracking-wider">{tr('Jumla ya madeni')}</p>
            <p className="mt-1 text-[20px] font-extrabold text-warn-fg tabular-nums">{<AnimatedNumber id="dash.debtC" value={data.totalDebt} format={formatTZSCompact} />}</p>
            <p className="mt-1 text-[12px] text-muted">{tr('wateja {n} wanadaiwa', { n: data.debtorCount })}</p>
          </Card>
          <Card className="p-4">
            <p className="text-[12px] font-semibold text-muted uppercase tracking-wider">{tr('Matumizi ya leo')}</p>
            <p className="mt-1 whitespace-nowrap text-[20px] font-extrabold tabular-nums">{<AnimatedNumber id="dash.expToday" value={data.expensesToday} format={formatTZS} />}</p>
            <p className="mt-1 text-[12px] text-muted">{tr('Umeme, usafiri n.k.')}</p>
          </Card>
        </div>

        <Card className="p-5">
          <div className="flex items-baseline justify-between border-b border-line-soft pb-3">
            <div>
              <h2 className="text-[16px] font-bold text-ink">{tr('Mauzo ya wiki')}</h2>
              <p className="text-[12px] text-muted">{tr('Jumla:')} <b className="font-bold text-ink">{<AnimatedNumber id="dash.week" value={data.weekTotal} format={formatTZS} />}</b></p>
            </div>
            <span className="text-[12px] font-bold text-primary">{today.getDate()} {formatLongDate(today).split(' ')[1]}</span>
          </div>
          <DccStyleChart series={data.week} days={days} compact />
        </Card>

        <Card className="p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-[16px] font-bold text-ink">{tr('Madeni')}</h2>
            <Link to="/debts" className="inline-flex min-h-[36px] items-center text-[13.5px] font-semibold text-primary-link">
              {tr('Ona yote')} →
            </Link>
          </div>
          <DebtorList debtors={data.debtors} />
        </Card>
      </div>

      {/* ---------- Desktop View (Matching Reference UI in Royal Blue) ---------- */}
      <div className="hidden md:block space-y-6">
        {/* Top Header */}
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-line-soft pb-5">
          <div>
            <h1 className="text-[28px] font-extrabold tracking-tight text-ink">{tr('Uchambuzi')}</h1>
            <p className="mt-1 text-[13.5px] text-muted">{tr('Angalia na dhibiti takwimu za biashara ya duka lako.')}</p>
          </div>
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              aria-label={tr('Tafuta')}
              onClick={() => {
                const el = document.getElementById('dashboard-search');
                el?.focus();
              }}
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-line bg-white text-slate-600 shadow-sm transition hover:bg-slate-50"
            >
              <SearchIcon width={17} height={17} />
            </button>
            <Button onClick={() => navigate('/pos')} className="min-h-[40px] rounded-xl px-5 font-bold shadow-sm">
              <PlusIcon width={17} height={17} /> {tr('Uza sasa')}
            </Button>
          </div>
        </header>

        {/* Section: Business Data */}
        <section>
          <div className="mb-3.5 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-[16px] font-bold text-ink">{tr('Taarifa za biashara')}</h2>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setShowDatePicker(!showDatePicker)}
                className="inline-flex h-9 items-center gap-2 rounded-xl border border-line bg-white px-3.5 text-[13px] font-medium text-slate-700 shadow-sm hover:bg-slate-50 transition"
              >
                <CalendarIcon width={14} height={14} className="text-muted" />
                {days.length === 1 ? formatLongDate(days[0]) : `${formatLongDate(days[0])} – ${formatLongDate(days[days.length - 1])}`}
              </button>

              <div className="relative">
                <select
                  aria-label={tr('Chagua kipindi')}
                  value={period}
                  onChange={(e) => {
                    const p = e.target.value as PeriodOption;
                    setPeriod(p);
                    if (p === 'custom') setShowDatePicker(true);
                  }}
                  className="inline-flex h-9 appearance-none items-center rounded-xl border border-line bg-white pl-3.5 pr-8 text-[13px] font-medium text-slate-700 shadow-sm outline-none focus:border-primary cursor-pointer hover:bg-slate-50"
                >
                  <option value="today">{tr('Leo')}</option>
                  <option value="week">{tr('Wiki hii')}</option>
                  <option value="month">{tr('Mwezi huu')}</option>
                  <option value="custom">{tr('Kipindi maalum')}</option>
                </select>
                <ChevronDown width={14} height={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted" />
              </div>
            </div>
          </div>

          {/* Custom Date Range Picker when selected */}
          {showDatePicker && (
            <div className="mb-3.5 flex flex-wrap items-center gap-2 rounded-xl border border-line-soft bg-white p-3 shadow-sm animate-fade-in">
              <span className="text-[12.5px] font-medium text-muted">{tr('Kuanzia')}:</span>
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="h-8 rounded-lg border border-line px-2 text-[12.5px] outline-none"
              />
              <span className="text-[12.5px] font-medium text-muted">{tr('Hadi')}:</span>
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="h-8 rounded-lg border border-line px-2 text-[12.5px] outline-none"
              />
              <Button
                variant="soft"
                className="!min-h-[32px] px-3 text-[12px]"
                onClick={() => {
                  if (customFrom && customTo) {
                    setPeriod('custom');
                    setShowDatePicker(false);
                  }
                }}
              >
                {tr('Tumia')}
              </Button>
              <Button
                variant="ghost"
                className="!min-h-[32px] px-2 text-[12px]"
                onClick={() => setShowDatePicker(false)}
              >
                {tr('Funga')}
              </Button>
            </div>
          )}

          {/* Divided 4-Column Strip Card (Matching the "D.CC" layout) */}
          <div className="rounded-[22px] border border-line bg-white shadow-sm overflow-hidden">
            <div className={cx('grid divide-y divide-line-soft md:divide-y-0 md:divide-x md:grid-cols-4', !isOwner && 'md:grid-cols-3')}>
              {/* Col 1: Revenue (Mauzo) */}
              <div className="p-5 lg:p-6">
                <p className="text-[13px] font-medium text-muted">{tr('Mauzo')}</p>
                <p className="mt-2 text-[26px] font-extrabold tracking-tight text-ink tabular-nums">
                  {<AnimatedNumber id="dash.salesToday" value={data.salesToday} format={formatTZS} />}
                </p>
                <p className="mt-2 text-[12.5px] text-muted flex items-center gap-1">
                  <span className={cx('font-bold', data.salesTrendPct >= 0 ? 'text-ok-fg' : 'text-bad-fg')}>
                    {data.salesTrendPct >= 0 ? '↑' : '↓'} {signed(data.salesTrendPct, '%')}
                  </span>
                  <span>{tr('vs siku iliyopita')}</span>
                </p>
              </div>

              {/* Col 2: Total Orders (Idadi ya Mauzo) */}
              <div className="p-5 lg:p-6">
                <p className="text-[13px] font-medium text-muted">{tr('Idadi ya mauzo')}</p>
                <p className="mt-2 text-[26px] font-extrabold tracking-tight text-ink tabular-nums">
                  <AnimatedNumber id="dash.count" value={data.salesCount} />
                </p>
                <p className="mt-2 text-[12.5px] text-muted flex items-center gap-1">
                  <span className={cx('font-bold', data.salesCountDelta >= 0 ? 'text-ok-fg' : 'text-bad-fg')}>
                    {data.salesCountDelta >= 0 ? '↑' : '↓'} {signed(data.salesCountDelta)}
                  </span>
                  <span>{tr('vs siku iliyopita')}</span>
                </p>
              </div>

              {/* Col 3: Net Profit (Owner) / Average Order (Cashier) */}
              {isOwner && data.netProfitToday !== undefined ? (
                <div className="p-5 lg:p-6">
                  <p className="text-[13px] font-medium text-muted">{tr('Faida halisi')}</p>
                  <p className="mt-2 text-[26px] font-extrabold tracking-tight text-emerald-600 tabular-nums">
                    {<AnimatedNumber id="dash.net" value={data.netProfitToday} format={formatTZS} />}
                  </p>
                  <p className="mt-2 text-[12.5px] text-muted flex items-center gap-1">
                    <span className={cx('font-bold', (data.profitTrendPct ?? 0) >= 0 ? 'text-ok-fg' : 'text-bad-fg')}>
                      {(data.profitTrendPct ?? 0) >= 0 ? '↑' : '↓'} {signed(data.profitTrendPct ?? 0, '%')}
                    </span>
                    <span>{tr('baada ya matumizi')}</span>
                  </p>
                </div>
              ) : (
                <div className="p-5 lg:p-6">
                  <p className="text-[13px] font-medium text-muted">{tr('Wastani wa mauzo')}</p>
                  <p className="mt-2 text-[26px] font-extrabold tracking-tight text-ink tabular-nums">
                    {formatTZS(data.salesCount > 0 ? Math.round(data.salesToday / data.salesCount) : 0)}
                  </p>
                  <p className="mt-2 text-[12.5px] text-muted">{tr('kwa kila muamala')}</p>
                </div>
              )}

              {/* Col 4: Customer Debts (Madeni) */}
              <div className="p-5 lg:p-6">
                <p className="text-[13px] font-medium text-muted">{tr('Jumla ya madeni')}</p>
                <p className="mt-2 text-[26px] font-extrabold tracking-tight text-warn-fg tabular-nums">
                  {<AnimatedNumber id="dash.debt" value={data.totalDebt} format={formatTZS} />}
                </p>
                <p className="mt-2 text-[12.5px] text-muted font-medium">
                  <span className="font-bold text-amber-700">{tr('wateja {n} wanadaiwa', { n: data.debtorCount })}</span>
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Trend Tabs & Filter Control Row */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Segmented Pill Tabs */}
          <div className="inline-flex rounded-xl border border-line bg-white p-1 shadow-sm">
            {tabs.map((t) => (
              <button
                key={t.value}
                onClick={() => setTab(t.value)}
                className={cx(
                  'rounded-lg px-4 py-2 text-[13.5px] font-semibold transition-all duration-150',
                  tab === t.value
                    ? 'bg-primary text-white shadow-sm'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50',
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Search + Action Controls */}
          <div className="flex items-center gap-2">
            <div className="relative">
              <SearchIcon width={16} height={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
              <input
                id="dashboard-search"
                className="h-10 w-[260px] rounded-xl border border-line bg-white pl-10 pr-3 text-[13.5px] shadow-sm outline-none placeholder:text-muted/70 focus:border-primary focus:ring-2 focus:ring-primary/20"
                placeholder={tr('Tafuta bidhaa au mteja…')}
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
            <button
              onClick={() => void refetch()}
              aria-label={tr('Onyesha upya')}
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-line bg-white text-slate-700 shadow-sm transition hover:bg-slate-50"
            >
              <RefreshIcon width={16} height={16} />
            </button>
          </div>
        </div>

        {/* The Hero Bar Chart ("Sales Statistics" with Black Tooltip & Dots) */}
        <Card className="p-6 transition-all duration-200">
          <div className="flex items-start justify-between border-b border-line-soft pb-4">
            <div>
              <h2 className="text-[15px] font-bold text-slate-600">{chartTitle}</h2>
              <p className="mt-1 text-[32px] font-extrabold tracking-tight text-ink tabular-nums">
                {<AnimatedNumber id={`dash.chart.${tab}`} value={chartTotal} format={formatTZS} />}
              </p>
              <p className="mt-0.5 text-[13px] text-muted">{chartSubtitle}</p>
            </div>
            <span className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-line bg-white px-3.5 text-[13px] font-medium text-slate-700 shadow-sm">
              {period === 'today' ? tr('Leo') : period === 'month' ? tr('Mwezi huu') : period === 'custom' ? tr('Kipindi maalum') : tr('Wiki hii')}
            </span>
          </div>

          <DccStyleChart series={chartSeries} days={days} />
        </Card>

        {/* Bottom Split: Top Products with Gradient Progress Bars & Debtor List */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Top Products (Matching the "Top Dishes" Gradient Bar Style) */}
          <Card className="p-6">
            <div className="flex items-center justify-between border-b border-line-soft pb-3.5">
              <h2 className="text-[16px] font-bold text-ink">{tr('Bidhaa zinazouzwa zaidi')}</h2>
              <span className="inline-flex h-8 items-center gap-1 rounded-lg border border-line bg-white px-2.5 text-[12px] font-medium text-slate-700">
                {tr('Wiki hii')} <ChevronDown width={13} height={13} className="text-muted" />
              </span>
            </div>

            <ul className="mt-5 space-y-5">
              {filteredProducts.map((p) => (
                <li key={p.name} className="flex items-center gap-3.5">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-tint">
                    <CodeTile code={p.name.slice(0, 2).toUpperCase()} size={38} />
                  </div>
                  <div className="w-[120px] shrink-0 truncate sm:w-[150px]">
                    <p className="truncate text-[14px] font-bold text-ink">{p.name}</p>
                    <p className="text-[12px] text-muted">{p.sub}</p>
                  </div>
                  {/* Signature Gradient Progress Bar Ending with Circular Percentage Badge */}
                  <div className="relative flex flex-1 items-center">
                    <div className="relative h-4 flex-1 overflow-hidden rounded-full bg-blue-50/80">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-blue-200 via-blue-400 to-primary transition-all duration-300"
                        style={{ width: `${p.soldPct}%` }}
                      />
                    </div>
                    {/* Circle badge at the end of progress bar */}
                    <span className="ml-2 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-[10.5px] font-extrabold text-white shadow-sm">
                      {p.soldPct}%
                    </span>
                  </div>
                </li>
              ))}
              {filteredProducts.length === 0 && (
                <p className="py-8 text-center text-[13.5px] text-muted">{tr('Hakuna bidhaa iliyopatikana.')}</p>
              )}
            </ul>
          </Card>

          {/* Customer Debts List */}
          <Card className="p-6">
            <div className="flex items-start justify-between border-b border-line-soft pb-3.5">
              <div>
                <h2 className="text-[16px] font-bold text-ink">{tr('Madeni ya wateja')}</h2>
                <p className="text-[12.5px] text-muted">
                  {tr('Jumla:')} <b className="font-bold text-warn-fg tabular-nums">{<AnimatedNumber id="dash.debt" value={data.totalDebt} format={formatTZS} />}</b>
                </p>
              </div>
              <Link
                to="/debts"
                className="inline-flex min-h-[36px] items-center rounded-xl border border-line bg-white px-3 text-[13px] font-semibold text-primary-link shadow-sm hover:bg-slate-50 transition"
              >
                {tr('Ona yote')} →
              </Link>
            </div>
            <DebtorList debtors={filteredDebtors} />
          </Card>
        </div>
      </div>
    </>
  );
}

/**
 * Modern Bar Chart crafted in the exact style of the reference image:
 * - Dashed horizontal guide lines
 * - Soft pastel blue inactive bars with percentage dots on top
 * - Solid royal blue active bar with matching bottom date pill
 * - Black floating tooltip with amount and green growth badge
 */
function DccStyleChart({
  series,
  days,
  compact,
}: {
  series: number[];
  days: Date[];
  compact?: boolean;
}) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const rawMax = Math.max(0, ...series);
  const step = rawMax > 2_000_000 ? 1_000_000 : rawMax > 500_000 ? 250_000 : rawMax > 0 ? 100_000 : 50_000;
  const axisMax = rawMax > 0 ? Math.ceil(rawMax / step) * step : 100_000;
  const H = compact ? 160 : 250;

  // The active/highlighted index (default to the last day only when data exists)
  const activeIdx = hoveredIdx !== null ? hoveredIdx : (rawMax > 0 ? days.length - 1 : null);

  // Calculate percentage relative to average for the top dot badges
  const totalVal = series.reduce((a, b) => a + b, 0);
  const avg = totalVal / (series.length || 1);
  const percentages = series.map((v) => (avg > 0 ? Math.round((v / avg) * 100) : 0));

  return (
    <div className="mt-5 select-none">
      <div className="flex gap-3">
        {/* Y-Axis numbers */}
        {!compact && (
          <div
            className="flex flex-col justify-between pb-8 pr-2 text-right text-[11.5px] font-medium text-slate-400 tabular-nums"
            style={{ height: H + 32 }}
          >
            {[4, 3, 2, 1, 0].map((stepIdx) => {
              const val = (axisMax / 4) * stepIdx;
              return (
                <span key={stepIdx}>
                  {val >= 1_000_000
                    ? `${(val / 1_000_000).toFixed(val % 1_000_000 === 0 ? 0 : 1)}M`
                    : formatCompact(val)}
                </span>
              );
            })}
          </div>
        )}

        {/* Chart Canvas with Dashed Lines */}
        <div className="relative flex-1" style={{ height: H + 32 }}>
          {/* Dashed Horizontal Grid Lines */}
          <div className="absolute inset-x-0 top-0 flex flex-col justify-between pointer-events-none" style={{ height: H }}>
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="border-b border-dashed border-slate-200/90 w-full" />
            ))}
          </div>

          {/* Bars */}
          <div className="relative z-10 flex h-full items-end justify-between gap-3 pb-8">
            {series.map((v, i) => {
              const isSelected = activeIdx === i;
              const h = v > 0 ? Math.max(12, (v / axisMax) * H) : 4;
              const pct = percentages[i];

              return (
                <div
                  key={i}
                  onMouseEnter={() => setHoveredIdx(i)}
                  onMouseLeave={() => setHoveredIdx(null)}
                  className="group relative flex flex-1 flex-col items-center justify-end cursor-pointer"
                  style={{ height: H }}
                >
                  {/* Floating tooltip for the selected/hovered bar */}
                  {isSelected && (() => {
                    const edge = i >= series.length - 2 ? 'right' : i <= 1 ? 'left' : 'center';
                    const bottom = Math.max(4, Math.min(H - 60, h + 14));
                    return (
                      <>
                        <div
                          className={cx(
                            'pointer-events-none absolute inset-x-0 z-30 flex',
                            edge === 'right' ? 'justify-end' : edge === 'left' ? 'justify-start' : 'justify-center',
                          )}
                          style={{ bottom }}
                        >
                          <div role="tooltip" className="whitespace-nowrap rounded-xl bg-[#0F172A] px-3.5 py-2 text-white shadow-lg animate-fade-in">
                            <p className="text-[11px] font-medium text-slate-300">{formatLongDate(days[i])}</p>
                            <div className="mt-0.5 flex items-center gap-2">
                              <span className="text-[14px] font-extrabold tabular-nums tracking-tight text-white">{formatTZS(v)}</span>
                              {v > 0 && <span className="rounded-full bg-emerald-500/20 px-1.5 text-[10.5px] font-bold text-emerald-400">{pct}%</span>}
                            </div>
                          </div>
                        </div>
                        <span
                          aria-hidden
                          className="pointer-events-none absolute z-30 -translate-x-1/2 border-x-4 border-t-4 border-x-transparent border-t-[#0F172A]"
                          style={{ bottom: bottom - 4, left: '50%' }}
                        />
                      </>
                    );
                  })()}

                  {/* Top Percentage & Dot (Only if v > 0) */}
                  {!compact && !isSelected && v > 0 && (
                    <div className="mb-1.5 flex flex-col items-center gap-0.5">
                      <span className="text-[10px] font-medium text-slate-400 tabular-nums">{pct}%</span>
                      <span className="h-1.5 w-1.5 rounded-full bg-blue-300" />
                    </div>
                  )}

                  {/* The Bar */}
                  <div
                    className={cx(
                      'w-full rounded-t-lg transition-all duration-200',
                      v === 0
                        ? (isSelected ? 'bg-slate-300' : 'bg-slate-100 hover:bg-slate-200')
                        : (isSelected ? 'bg-primary shadow-md' : 'bg-blue-100/70 hover:bg-blue-200/90'),
                    )}
                    style={{ height: h, maxWidth: compact ? undefined : 64 }}
                  />

                  {/* X-Axis Date Pill */}
                  <span
                    className={cx(
                      'mt-2.5 transition-all text-[11.5px] font-semibold',
                      isSelected && v > 0
                        ? 'rounded-lg bg-primary px-2.5 py-0.5 font-bold text-white shadow-sm'
                        : isSelected
                        ? 'rounded-lg bg-slate-200 px-2 py-0.5 font-bold text-slate-700'
                        : 'text-slate-400',
                    )}
                  >
                    {compact
                      ? dayShort(days[i])
                      : `${String(days[i].getMonth() + 1).padStart(2, '0')}-${String(days[i].getDate()).padStart(2, '0')}`}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function DebtorList({ debtors }: { debtors: ShopDashboard['debtors'] }) {
  if (debtors.length === 0) {
    return <p className="py-8 text-center text-[13.5px] text-muted">{tr('Hakuna madeni yaliyopatikana.')}</p>;
  }

  return (
    <ul className="mt-2 divide-y divide-line-soft">
      {debtors.map((d) => (
        <li key={d.id} className="flex items-center gap-3 py-3 transition hover:bg-slate-50/70 rounded-lg px-1">
          <Avatar name={d.name} size={38} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[14px] font-semibold text-ink">{d.name}</p>
            <p className="text-[12px] text-muted">{d.item} · {d.since}</p>
          </div>
          <div className="text-right">
            <p className="text-[14px] font-extrabold text-ink tabular-nums">{formatTZS(d.amount)}</p>
            <Badge tone={TAG_TONE[d.tag.kind] ?? 'warn'} className="mt-0.5">
              {d.tag.label}
            </Badge>
          </div>
        </li>
      ))}
    </ul>
  );
}
