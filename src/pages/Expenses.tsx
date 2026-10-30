import { useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PAYMENT_LABEL, type PaymentMethod } from '@shared/constants';
import { EXPENSE_CATEGORIES, EXPENSE_LABEL, EXPENSE_METHODS, expenseSchema, periodRange, type ExpenseCategory, type PeriodKind } from '@shared/money';
import { useAuth } from '@/lib/auth';
import { todayDar } from '@/lib/dar';
import { formatDate, formatTZS } from '@/lib/format';
import { addExpense, getExpenseOverview } from '@/mock/ledger';
import { AnimatedNumber, Badge, Button, Card, PageHeader, Spinner, cx } from '@/components/ui';
import { SearchIcon } from '@/components/ui/icons';
import { Chip } from '@/components/ReportDialog';
import CloseDay from './CloseDay';
import { tr } from '@/i18n';

type Period = Extract<PeriodKind, 'today' | 'week' | 'month' | 'custom'>;
const PERIODS: { value: Period; label: string }[] = [
  { value: 'today', label: 'Leo' },
  { value: 'week', label: 'Wiki hii' },
  { value: 'month', label: 'Mwezi huu' },
  { value: 'custom', label: 'Kipindi maalum' },
];
const PAGE_SIZE = 10;
const day = (ymd: string) => formatDate(new Date(`${ymd}T00:00:00`));
type Errors = Partial<Record<'category' | 'amount' | 'description' | 'method' | 'spentOn', string>>;

export default function Expenses() {
  const { user, isOwner } = useAuth();
  const qc = useQueryClient();
  const today = todayDar();

  // The selected period lives in the URL, so it survives navigation and a refresh.
  const [params, setParams] = useSearchParams();
  const period: Period = (PERIODS.find((p) => p.value === params.get('p'))?.value ?? 'month') as Period;
  const appliedCustom = { from: params.get('from') ?? today, to: params.get('to') ?? today };
  const range = useMemo(() => periodRange(period, today, appliedCustom), [period, today, appliedCustom.from, appliedCustom.to]); // eslint-disable-line react-hooks/exhaustive-deps
  const [draft, setDraft] = useState(appliedCustom);
  const draftError = draft.from && draft.to && draft.from > draft.to ? 'Tarehe ya mwisho iwe baada ya ya mwanzo' : !draft.from || !draft.to ? 'Weka tarehe zote mbili' : '';
  const setPeriod = (p: Period) => {
    const next = new URLSearchParams(params);
    next.set('p', p);
    if (p !== 'custom') {
      next.delete('from');
      next.delete('to');
    }
    setParams(next, { replace: true });
    setPage(1);
  };
  const applyCustom = () => {
    if (draftError) return;
    setParams({ p: 'custom', from: draft.from, to: draft.to }, { replace: true });
    setPage(1);
  };

  const { data } = useQuery({ queryKey: ['expenses', user?.role, range.from, range.to], queryFn: () => getExpenseOverview(user!.role, range) });

  // Record form
  const [category, setCategory] = useState<ExpenseCategory>('ELECTRICITY');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState(today);
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [errors, setErrors] = useState<Errors>({});
  const [saved, setSaved] = useState(false);
  const [closing, setClosing] = useState(false);
  const submitKey = useRef(crypto.randomUUID());

  const save = useMutation({
    mutationFn: (input: ReturnType<typeof expenseSchema.parse>) => addExpense(user!, input, submitKey.current),
    onSuccess: () => {
      for (const k of ['expenses', 'shop-dashboard', 'close-day', 'report']) void qc.invalidateQueries({ queryKey: [k] });
      setAmount('');
      setDescription('');
      setErrors({});
      setSaved(true);
      submitKey.current = crypto.randomUUID(); // the next expense is a new submission
    },
    onError: (e: Error) => setErrors({ amount: e.message }),
  });

  const submit = () => {
    if (save.isPending) return;
    setSaved(false);
    const parsed = expenseSchema.safeParse({ category, amount, description, method, spentOn: date });
    if (!parsed.success) {
      const next: Errors = {};
      for (const i of parsed.error.issues) next[i.path[0] as keyof Errors] ??= i.message;
      if (amount.trim() === '') next.amount = 'Weka kiasi';
      setErrors(next);
      return;
    }
    setErrors({});
    save.mutate(parsed.data);
  };

  // History filters
  const [search, setSearch] = useState('');
  const [cat, setCat] = useState<ExpenseCategory | 'all'>('all');
  const [page, setPage] = useState(1);
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (data?.rows ?? []).filter((e) => (cat === 'all' || e.category === cat) && (!needle || e.description.toLowerCase().includes(needle)));
  }, [data, search, cat]);

  if (!data) return <Spinner variant="cards" />;
  const maxCat = Math.max(1, ...data.byCategory.map((c) => c.amount));
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const shown = filtered.slice((Math.min(page, pages) - 1) * PAGE_SIZE, Math.min(page, pages) * PAGE_SIZE);
  const rangeLabel = range.from === range.to ? day(range.from) : `${day(range.from)} – ${day(range.to)}`;

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Matumizi"
        subtitle="Rekodi na ufuatilie matumizi ya biashara ili ujue faida yako halisi."
        actions={<Button variant="outline" onClick={() => setClosing(true)}>{tr('Funga siku')}</Button>}
      />

      {/* 1. Date filters */}
      <section aria-label={tr('Kipindi')} className="mb-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="inline-flex max-w-full flex-wrap gap-1 rounded-xl border border-line bg-white p-1 shadow-sm" role="tablist">
            {PERIODS.map((o) => (
              <button
                key={o.value}
                type="button"
                role="tab"
                aria-selected={period === o.value}
                onClick={() => setPeriod(o.value)}
                className={cx('min-h-[38px] shrink-0 whitespace-nowrap rounded-lg px-3.5 text-[13px] font-semibold transition-colors', period === o.value ? 'bg-primary text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50')}
              >
                {tr(o.label)}
              </button>
            ))}
          </div>
          <p className="text-[12.5px] text-muted">{rangeLabel}</p>
        </div>
        {period === 'custom' && (
          <div className="mt-3 grid grid-cols-2 items-end gap-2 sm:flex sm:flex-wrap">
            <label className="block">
              <span className="label">{tr('Tarehe ya kuanza')}</span>
              <input type="date" className="input h-10 min-h-0" max={today} value={draft.from} onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))} />
            </label>
            <label className="block">
              <span className="label">{tr('Tarehe ya mwisho')}</span>
              <input type="date" className="input h-10 min-h-0" max={today} value={draft.to} onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))} />
            </label>
            <Button className="col-span-2 min-h-[40px] sm:col-span-1" disabled={!!draftError} onClick={applyCustom}>{tr('Tumia kichujio')}</Button>
            {draftError && <p className="col-span-2 text-[12px] font-medium text-bad-fg sm:self-center">{tr(draftError)}</p>}
          </div>
        )}
      </section>

      {/* 2. Summary */}
      <div className={cx('mb-4 grid grid-cols-2 gap-3', isOwner && data.net !== undefined ? 'sm:grid-cols-3' : 'sm:grid-cols-2')}>
        <Tile label={tr('Jumla ya matumizi')} value={<AnimatedNumber id="exp.total" value={data.total} format={formatTZS} />} note={rangeLabel} tone="text-ink" />
        <Tile label={tr('Matumizi ya leo')} value={<AnimatedNumber id="exp.today" value={data.today} format={formatTZS} />} note={tr('bila kujali kipindi')} tone={data.today > 0 ? 'text-warn-fg' : 'text-ink'} />
        {isOwner && data.net !== undefined && (
          <Tile
            className="col-span-2 sm:col-span-1"
            label={tr('Faida halisi')}
            value={<AnimatedNumber id="exp.net" value={data.net} format={formatTZS} />}
            note={tr('baada ya kutoa matumizi')}
            tone={data.net >= 0 ? 'text-ok-fg' : 'text-bad-fg'}
          />
        )}
      </div>

      {/* 3. Record an expense */}
      <Card className="mb-4 p-4 sm:p-5">
        <h2 className="text-[16px] font-bold text-ink">{tr('Rekodi matumizi')}</h2>
        <div className="mt-3 space-y-3.5">
          <div>
            <p className="label">{tr('Aina ya matumizi')}</p>
            <div className="flex flex-wrap gap-2">
              {EXPENSE_CATEGORIES.map((c) => <Chip key={c} active={category === c} onClick={() => setCategory(c)}>{tr(EXPENSE_LABEL[c])}</Chip>)}
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block">
              <span className="label">{tr('Kiasi (TSh)')}</span>
              <input className="input" inputMode="numeric" placeholder="0" value={amount} aria-invalid={!!errors.amount} onChange={(e) => { setAmount(e.target.value.replace(/\D/g, '')); setErrors((x) => ({ ...x, amount: undefined })); setSaved(false); }} />
              {errors.amount && <span className="mt-1 block text-[12px] font-medium text-bad-fg">{tr(errors.amount)}</span>}
            </label>
            <label className="block">
              <span className="label">{tr('Tarehe')}</span>
              <input type="date" className="input" max={today} value={date} aria-invalid={!!errors.spentOn} onChange={(e) => { setDate(e.target.value); setErrors((x) => ({ ...x, spentOn: undefined })); }} />
              {errors.spentOn && <span className="mt-1 block text-[12px] font-medium text-bad-fg">{tr(errors.spentOn)}</span>}
            </label>
            <label className="block">
              <span className="label">{tr('Njia ya malipo')}</span>
              <select className="input" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
                {EXPENSE_METHODS.map((m) => <option key={m} value={m}>{tr(PAYMENT_LABEL[m])}</option>)}
              </select>
            </label>
          </div>
          <label className="block">
            <span className="label">{tr('Maelezo')} <span className="font-normal text-muted">({tr('hiari')})</span></span>
            <input className="input" placeholder={tr('Andika maelezo ya matumizi…')} maxLength={200} value={description} onChange={(e) => { setDescription(e.target.value); setErrors((x) => ({ ...x, description: undefined })); }} />
            {errors.description && <span className="mt-1 block text-[12px] font-medium text-bad-fg">{tr(errors.description)}</span>}
          </label>
          {saved && <p role="status" className="rounded-field bg-ok-bg px-3.5 py-2 text-[13px] font-medium text-ok-fg">{tr('Matumizi yamehifadhiwa.')}</p>}
          <Button loading={save.isPending} className="w-full sm:w-auto sm:min-w-[170px]" disabled={save.isPending} onClick={submit}>
            {save.isPending ? tr('Inahifadhi…') : tr('Hifadhi matumizi')}
          </Button>
        </div>
      </Card>

      {/* 4. By category */}
      <Card className="mb-4 p-4 sm:p-5">
        <h2 className="text-[16px] font-bold text-ink">{tr('Matumizi kwa aina ya gharama')}</h2>
        {data.byCategory.length === 0 ? (
          <p className="mt-2 text-[13.5px] text-muted">{tr('Hakuna matumizi katika kipindi hiki.')}</p>
        ) : (
          <ul className="mt-3 space-y-2.5">
            {data.byCategory.map((c) => (
              <li key={c.category} className="text-[13.5px]">
                <div className="mb-1 flex items-baseline justify-between gap-3">
                  <span className="font-semibold text-ink">{tr(EXPENSE_LABEL[c.category])}</span>
                  <span className="tabular font-extrabold text-ink">{formatTZS(c.amount)}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${(c.amount / maxCat) * 100}%` }} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* 5. History */}
      <Card className="mb-6 overflow-hidden">
        <div className="space-y-3 p-4 sm:p-5">
          <h2 className="text-[16px] font-bold text-ink">{tr('Historia ya matumizi')}</h2>
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <SearchIcon width={16} height={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
              <input className="input h-10 min-h-0 pl-10" placeholder={tr('Tafuta kwa maelezo…')} aria-label={tr('Tafuta kwa maelezo')} value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
            </div>
            <select className="input h-10 min-h-0 sm:w-48" aria-label={tr('Aina ya matumizi')} value={cat} onChange={(e) => { setCat(e.target.value as ExpenseCategory | 'all'); setPage(1); }}>
              <option value="all">{tr('Aina zote')}</option>
              {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{tr(EXPENSE_LABEL[c])}</option>)}
            </select>
          </div>
        </div>

        {filtered.length === 0 ? (
          <p className="border-t border-line-soft p-8 text-center text-[13.5px] text-muted">
            {data.rows.length === 0 ? tr('Hakuna matumizi katika kipindi hiki.') : tr('Hakuna matumizi yanayolingana na kichujio.')}
          </p>
        ) : (
          <>
            <div className="hidden overflow-x-auto border-t border-line-soft md:block">
              <table className="w-full text-[13.5px]">
                <thead>
                  <tr className="bg-slate-50/80 text-left text-[11.5px] font-bold uppercase tracking-wider text-slate-500">
                    <th className="px-5 py-3">{tr('Tarehe')}</th>
                    <th className="py-3">{tr('Aina')}</th>
                    <th className="py-3">{tr('Maelezo')}</th>
                    <th className="py-3">{tr('Njia')}</th>
                    <th className="py-3 text-right">{tr('Kiasi')}</th>
                    <th className="px-5 py-3">{tr('Aliyerekodi')}</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((e) => (
                    <tr key={e.id} className="border-t border-line-soft hover:bg-slate-50/70">
                      <td className="whitespace-nowrap px-5 py-2.5">{day(e.spentOn)}</td>
                      <td><Badge tone="blue">{tr(EXPENSE_LABEL[e.category])}</Badge></td>
                      <td className="max-w-[260px] truncate pr-3 text-body">{e.description || '–'}</td>
                      <td className="text-body">{tr(PAYMENT_LABEL[e.method])}</td>
                      <td className="tabular text-right font-bold">{formatTZS(e.amount)}</td>
                      <td className="px-5 text-muted">{e.userName}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="divide-y divide-line-soft border-t border-line-soft md:hidden">
              {shown.map((e) => (
                <li key={e.id} className="px-4 py-3 text-[13px]">
                  <div className="flex items-center justify-between gap-2">
                    <Badge tone="blue">{tr(EXPENSE_LABEL[e.category])}</Badge>
                    <span className="tabular text-[15px] font-extrabold text-ink">{formatTZS(e.amount)}</span>
                  </div>
                  {e.description && <p className="mt-1 text-body">{e.description}</p>}
                  <p className="mt-0.5 text-[12px] text-muted">{day(e.spentOn)} · {tr(PAYMENT_LABEL[e.method])} · {e.userName}</p>
                </li>
              ))}
            </ul>
            <div className="flex items-center justify-between gap-3 border-t border-line-soft px-4 py-3 text-[12.5px] text-muted sm:px-5">
              <span>{tr('matumizi {n}', { n: filtered.length })} · <b className="tabular text-ink">{formatTZS(filtered.reduce((a, e) => a + e.amount, 0))}</b></span>
              {pages > 1 && (
                <span className="flex items-center gap-1">
                  <Button variant="outline" className="min-h-[34px] px-3 text-[13px]" disabled={page <= 1} onClick={() => setPage(page - 1)}>{tr('Nyuma')}</Button>
                  <span className="px-1.5">{Math.min(page, pages)} / {pages}</span>
                  <Button variant="outline" className="min-h-[34px] px-3 text-[13px]" disabled={page >= pages} onClick={() => setPage(page + 1)}>{tr('Mbele')}</Button>
                </span>
              )}
            </div>
          </>
        )}
      </Card>

      {closing && <CloseDay onClose={() => setClosing(false)} />}
    </div>
  );
}

function Tile({ label, value, note, tone, className }: { label: string; value: React.ReactNode; note: string; tone: string; className?: string }) {
  return (
    <div className={cx('card px-4 py-3', className)}>
      <p className="text-[12px] font-medium leading-tight text-muted">{label}</p>
      <p className={cx('tabular mt-1 whitespace-nowrap text-[18px] font-extrabold leading-tight tracking-tight sm:text-[22px]', tone)}>{value}</p>
      <p className="mt-0.5 truncate text-[11.5px] text-muted">{note}</p>
    </div>
  );
}
