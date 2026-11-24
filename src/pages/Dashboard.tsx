import { useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { timeDar } from '@/lib/dar';
import { dayName, dayShort, formatCompact, formatDayMonth, formatLongDate, formatTZS, formatTZSCompact } from '@/lib/format';
import { listProducts, type ShopDashboard } from '@/mock/api';
import { getShopDashboardLive } from '@/mock/ledger';
import { getDebtOverview, listSales } from '@/mock/sales';
import { SaleStatusBadge } from '@/pages/Sales';
import { Avatar, Badge, Button, Card, Spinner, cx } from '@/components/ui';
import { CalendarIcon, PlusIcon, RefreshIcon, SearchIcon } from '@/components/ui/icons';
import { AnimatedNumber } from '@/components/ui';
import { tr } from '@/i18n';

type TrendTab = 'sales' | 'profit' | 'debts' | 'expenses';
type PeriodOption = 'today' | 'week' | 'month' | 'custom';

const PERIODS: { value: PeriodOption; label: string }[] = [
  { value: 'today', label: 'Leo' },
  { value: 'week', label: 'Wiki hii' },
  { value: 'month', label: 'Mwezi huu' },
  { value: 'custom', label: 'Kipindi maalum' },
];

/** "HH:MM" in Dar → the matching Swahili greeting. */
const greetingOf = (hhmm: string) => {
  const h = Number(hhmm.slice(0, 2));
  return h < 12 ? 'Habari za asubuhi' : h < 16 ? 'Habari za mchana' : 'Habari za jioni';
};

function Kpi({ label, value, foot, tone }: { label: string; value: ReactNode; foot: ReactNode; tone?: string }) {
  return (
    <Card className="flex flex-col gap-2.5 p-5">
      <span className="text-[13px] font-medium text-muted">{label}</span>
      <span className={cx('text-[26px] font-bold leading-tight tracking-tight tabular-nums', tone ?? 'text-ink')}>{value}</span>
      <span className="flex flex-wrap items-center gap-1.5 text-[12px] text-muted">{foot}</span>
    </Card>
  );
}

function Delta({ value, unit = '' }: { value: number; unit?: string }) {
  const up = value >= 0;
  return (
    <span className={cx('rounded-md px-1.5 py-0.5 font-semibold', up ? 'bg-ok-bg text-ok-fg' : 'bg-bad-bg text-bad-fg')}>
      {up ? '↑' : '↓'} {Math.abs(value)}
      {unit}
    </span>
  );
}

function EmptyNote({ children }: { children: ReactNode }) {
  return (
    <p className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-line px-4 py-8 text-center text-[13px] text-muted">
      <span>{children}</span>
    </p>
  );
}

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
  const { data: recent } = useQuery({ queryKey: ['sales', '', 5], queryFn: () => listSales('', 5), select: (r) => r.items });
  const { data: products } = useQuery({ queryKey: ['products', user?.role], queryFn: () => listProducts(user!.role) });

  if (isLoading || !base || !debts) return <Spinner variant="dashboard" />;

  const firstName = user?.name.trim().split(/\s+/)[0] ?? '';
  const lowStock = (products ?? [])
    .filter((p) => p.shopStatus !== 'IPO')
    .sort((a, b) => a.shopQty - a.minStock - (b.shopQty - b.minStock));

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

      {/* ---------- Desktop View: "Safi" ---------- */}
      <div className="hidden flex-col gap-6 md:flex">
        <header className="flex flex-wrap items-center gap-3">
          <div className="flex min-w-[260px] flex-1 flex-col gap-1">
            <span className="text-[13px] text-muted">
              {dayName(today)}, {formatLongDate(today)}
            </span>
            <h1 className="text-[26px] font-bold leading-tight tracking-tight text-ink">
              {tr(greetingOf(timeDar()))}
              {firstName && `, ${firstName}`}
            </h1>
          </div>
          <label className="flex h-11 w-[280px] items-center gap-2 rounded-xl border border-line bg-white px-3.5 text-muted focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20">
            <SearchIcon width={17} height={17} />
            <span className="sr-only">{tr('Tafuta')}</span>
            <input
              id="dashboard-search"
              type="search"
              className="min-w-0 flex-1 bg-transparent text-[14px] text-ink outline-none placeholder:text-muted/70"
              placeholder={tr('Tafuta bidhaa au mteja…')}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </label>
          <Button onClick={() => navigate('/pos')} className="min-h-[44px] rounded-xl px-5 font-semibold">
            <PlusIcon width={18} height={18} /> {tr('Uza sasa')}
          </Button>
        </header>

        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <div role="tablist" aria-label={tr('Chagua kipindi')} className="inline-flex gap-0.5 rounded-xl border border-line bg-white p-1">
              {PERIODS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  role="tab"
                  aria-selected={period === p.value}
                  onClick={() => {
                    setPeriod(p.value);
                    setShowDatePicker(p.value === 'custom');
                  }}
                  className={cx(
                    'h-[34px] rounded-lg px-3.5 text-[13px] transition-colors',
                    period === p.value ? 'bg-ink font-semibold text-white' : 'font-medium text-body hover:bg-app',
                  )}
                >
                  {tr(p.label)}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setShowDatePicker(!showDatePicker)}
              aria-expanded={showDatePicker}
              className="inline-flex h-11 items-center gap-2 rounded-xl border border-line bg-white px-3.5 text-[13px] font-medium text-body transition hover:bg-app"
            >
              <CalendarIcon width={15} height={15} className="text-muted" />
              {days.length === 1 ? formatLongDate(days[0]) : `${formatLongDate(days[0])} – ${formatLongDate(days[days.length - 1])}`}
            </button>
            <button
              type="button"
              onClick={() => void refetch()}
              aria-label={tr('Onyesha upya')}
              title={tr('Onyesha upya')}
              className="ml-auto flex h-11 w-11 items-center justify-center rounded-xl border border-line bg-white text-body transition hover:bg-app"
            >
              <RefreshIcon width={16} height={16} />
            </button>
          </div>

          {showDatePicker && (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-white p-3 animate-fade-in">
              <label className="flex items-center gap-2 text-[12.5px] font-medium text-muted">
                {tr('Kuanzia')}:
                <input type="date" value={customFrom} max={customTo} onChange={(e) => setCustomFrom(e.target.value)} className="h-9 rounded-lg border border-line px-2 text-[13px] text-ink outline-none focus:border-primary" />
              </label>
              <label className="flex items-center gap-2 text-[12.5px] font-medium text-muted">
                {tr('Hadi')}:
                <input type="date" value={customTo} min={customFrom} onChange={(e) => setCustomTo(e.target.value)} className="h-9 rounded-lg border border-line px-2 text-[13px] text-ink outline-none focus:border-primary" />
              </label>
              <Button
                variant="soft"
                className="!min-h-[36px] px-3 text-[12.5px]"
                onClick={() => {
                  if (customFrom && customTo) {
                    setPeriod('custom');
                    setShowDatePicker(false);
                  }
                }}
              >
                {tr('Tumia')}
              </Button>
              <Button variant="ghost" className="!min-h-[36px] px-2 text-[12.5px]" onClick={() => setShowDatePicker(false)}>
                {tr('Funga')}
              </Button>
            </div>
          )}
        </div>

        {/* Today's figures: these always describe today, whatever period the chart shows. */}
        <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-4">
          <Kpi
            label={tr('Mauzo ya leo')}
            value={<AnimatedNumber id="dash.salesToday" value={data.salesToday} format={formatTZS} />}
            foot={
              <>
                <Delta value={data.salesTrendPct} unit="%" /> {tr('vs siku iliyopita')}
              </>
            }
          />
          <Kpi
            label={tr('Idadi ya mauzo')}
            value={<AnimatedNumber id="dash.count" value={data.salesCount} />}
            foot={
              <>
                <Delta value={data.salesCountDelta} /> {tr('vs siku iliyopita')}
              </>
            }
          />
          {isOwner && data.netProfitToday !== undefined ? (
            <Kpi
              label={tr('Faida halisi ya leo')}
              tone="text-emerald-700"
              value={<AnimatedNumber id="dash.net" value={data.netProfitToday} format={formatTZS} />}
              foot={
                <>
                  <Delta value={data.profitTrendPct ?? 0} unit="%" /> {tr('baada ya matumizi')}
                </>
              }
            />
          ) : (
            <Kpi
              label={tr('Wastani wa mauzo')}
              value={formatTZS(data.salesCount > 0 ? Math.round(data.salesToday / data.salesCount) : 0)}
              foot={tr('kwa kila muamala')}
            />
          )}
          <Kpi
            label={tr('Jumla ya madeni')}
            tone="text-warn-fg"
            value={<AnimatedNumber id="dash.debt" value={data.totalDebt} format={formatTZS} />}
            foot={
              <Link to="/debts" className="font-semibold text-warn-fg hover:underline">
                {tr('wateja {n} wanadaiwa', { n: data.debtorCount })} →
              </Link>
            }
          />
        </div>

        <div className="flex flex-wrap gap-4">
          <Card className="flex min-w-0 flex-[2_1_520px] flex-col p-6">
            <div className="flex flex-wrap items-start gap-3">
              <div className="min-w-0 flex-1">
                <h2 className="text-[16px] font-semibold text-ink">{chartTitle}</h2>
                <p className="mt-1 text-[24px] font-bold tracking-tight text-ink tabular-nums">
                  <AnimatedNumber id={`dash.chart.${tab}`} value={chartTotal} format={formatTZS} />
                </p>
                <p className="text-[12.5px] text-muted">{chartSubtitle}</p>
              </div>
              <div role="tablist" aria-label={tr('Kipimo')} className="flex flex-wrap gap-1.5">
                {tabs.map((t) => (
                  <button
                    key={t.value}
                    type="button"
                    role="tab"
                    aria-selected={tab === t.value}
                    onClick={() => setTab(t.value)}
                    className={cx(
                      'h-9 rounded-lg border px-3 text-[12.5px] transition-colors',
                      tab === t.value
                        ? 'border-primary bg-primary-tint font-semibold text-primary-link'
                        : 'border-line bg-white font-medium text-body hover:bg-app',
                    )}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
            <DccStyleChart series={chartSeries} days={days} />
          </Card>

          <Card className="flex min-w-0 flex-[1_1_300px] flex-col gap-4 p-6">
            <div className="flex items-center">
              <h2 className="flex-1 text-[16px] font-semibold text-ink">{tr('Bidhaa zinazouzwa zaidi')}</h2>
              <Link to="/reports" className="text-[13px] font-semibold text-primary-link hover:underline">
                {tr('Ona yote')}
              </Link>
            </div>
            {filteredProducts.length === 0 ? (
              <EmptyNote>{needle ? tr('Hakuna bidhaa iliyopatikana.') : tr('Hakuna mauzo katika kipindi hiki.')}</EmptyNote>
            ) : (
              <ul className="flex flex-col gap-4">
                {filteredProducts.map((p) => (
                  <li key={p.name} className="flex flex-col gap-1.5">
                    <div className="flex items-baseline gap-2 text-[13px]">
                      <span className="min-w-0 flex-1 truncate font-medium text-ink">{p.name}</span>
                      <span className="shrink-0 text-muted">{tr('{n} zimeuzwa', { n: p.sold })}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-app">
                      <div className="h-1.5 rounded-full bg-primary" style={{ width: `${Math.max(4, p.soldPct)}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="flex flex-wrap items-start gap-4">
          <Card className="flex min-w-0 flex-[2_1_520px] flex-col gap-3 p-6">
            <div className="flex items-center">
              <h2 className="flex-1 text-[16px] font-semibold text-ink">{tr('Mauzo ya hivi karibuni')}</h2>
              <Link to="/sales" className="text-[13px] font-semibold text-primary-link hover:underline">
                {tr('Ona yote')}
              </Link>
            </div>
            {!recent ? (
              <Spinner variant="list" />
            ) : recent.length === 0 ? (
              <EmptyNote>
                {tr('Hakuna mauzo bado.')}{' '}
                <Link to="/pos" className="font-semibold text-primary-link hover:underline">
                  {tr('Anza kuuza')}
                </Link>
              </EmptyNote>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[520px] border-collapse text-[13px]">
                  <thead>
                    <tr className="text-left text-[12px] text-muted">
                      <th className="border-b border-line py-2 font-medium">{tr('Risiti')}</th>
                      <th className="border-b border-line py-2 font-medium">{tr('Mteja')}</th>
                      <th className="border-b border-line py-2 font-medium">{tr('Tarehe')}</th>
                      <th className="border-b border-line py-2 font-medium">{tr('Hali')}</th>
                      <th className="border-b border-line py-2 text-right font-medium">{tr('Kiasi')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recent.map((s) => (
                      <tr key={s.id} className="cursor-pointer hover:bg-app/60" onClick={() => navigate(`/sales/${s.id}`)}>
                        <td className="border-b border-line-soft py-3 font-semibold">
                          <Link to={`/sales/${s.id}`} className="hover:underline" onClick={(e) => e.stopPropagation()}>
                            {s.receiptNo}
                          </Link>
                        </td>
                        <td className="max-w-[200px] truncate border-b border-line-soft py-3">{tr(s.customerName)}</td>
                        <td className="border-b border-line-soft py-3 text-muted">{formatDayMonth(new Date(`${s.date}T00:00:00`))}</td>
                        <td className="border-b border-line-soft py-3">
                          <SaleStatusBadge status={s.status} hasReturns={s.hasReturns} />
                        </td>
                        <td className="border-b border-line-soft py-3 text-right font-semibold tabular-nums">{formatTZS(s.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <div className="flex min-w-0 flex-[1_1_300px] flex-col gap-4">
            <Card className="flex flex-col gap-2 p-6">
              <div className="flex items-center gap-2">
                <h2 className="flex-1 text-[16px] font-semibold text-ink">{tr('Stock inayoisha')}</h2>
                {lowStock.length > 0 && <Badge tone="bad">{lowStock.length}</Badge>}
              </div>
              {lowStock.length === 0 ? (
                <EmptyNote>{tr('Stock yote ya duka iko juu ya kiwango cha chini.')}</EmptyNote>
              ) : (
                <ul className="flex flex-col">
                  {lowStock.slice(0, 5).map((p) => (
                    <li key={p.id} className="flex items-center gap-3 border-b border-line-soft py-2.5 last:border-0">
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="truncate text-[13px] font-medium text-ink">{p.name}</span>
                        <span className="text-[12px] text-muted">
                          {p.shopQty === 0 ? tr('Imeisha') : tr('Zimebaki {n}', { n: p.shopQty })} · {tr('kiwango {n}', { n: p.minStock })}
                        </span>
                      </div>
                      <Link to="/stock-in" className="inline-flex min-h-[36px] items-center rounded-lg border border-line px-3 text-[12.5px] font-semibold text-ink transition hover:bg-app">
                        {tr('Ingiza')}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card className="flex flex-col p-6">
              <div className="flex items-center">
                <h2 className="flex-1 text-[16px] font-semibold text-ink">{tr('Madeni ya wateja')}</h2>
                <Link to="/debts" className="text-[13px] font-semibold text-primary-link hover:underline">
                  {tr('Ona yote')}
                </Link>
              </div>
              <DebtorList debtors={filteredDebtors} />
            </Card>
          </div>
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
