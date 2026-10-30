import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PAYMENT_LABEL } from '@shared/constants';
import type { PeriodKind } from '@shared/money';
import { useAuth } from '@/lib/auth';
import { exportExcel, exportPdf } from '@/lib/exportReport';
import { formatCompact, formatDate, monthShort, formatNumber, formatTZS, formatTZSCompact } from '@/lib/format';
import { getReport } from '@/mock/ledger';
import { todayDar } from '@/mock/sales';
import { AnimatedNumber, Button, Card, PageHeader, Spinner, Tabs, cx } from '@/components/ui';
import { tr } from '@/i18n';

const PERIODS: { value: PeriodKind; label: string }[] = [
  { value: 'today', label: 'Leo' },
  { value: 'week', label: 'Wiki hii' },
  { value: 'month', label: 'Mwezi huu' },
  { value: 'year', label: 'Mwaka huu' },
  { value: 'custom', label: 'Maalum' },
];
const d = (iso: string) => formatDate(new Date(`${iso}T00:00:00`));

export default function Reports() {
  const { user, isOwner } = useAuth();
  const today = todayDar();
  const [period, setPeriod] = useState<PeriodKind>('month');
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`);
  const [to, setTo] = useState(today);
  const [busy, setBusy] = useState<'xlsx' | 'pdf' | null>(null);
  const [error, setError] = useState('');

  const custom = period === 'custom' ? { from, to } : undefined;
  const { data: r } = useQuery({
    queryKey: ['report', user?.role, period, custom?.from, custom?.to],
    queryFn: () => getReport(user!.role, period, custom),
  });

  const run = async (kind: 'xlsx' | 'pdf') => {
    if (!r) return;
    setBusy(kind);
    setError('');
    try {
      await (kind === 'xlsx' ? exportExcel(r) : exportPdf(r));
    } catch {
      setError('Imeshindikana kutengeneza faili. Jaribu tena.');
    } finally {
      setBusy(null);
    }
  };

  const maxMonth = Math.max(1, ...(r?.months.map((m) => m.sales) ?? [1]));
  const maxMethod = Math.max(1, ...(r?.methods.map((m) => m.amount) ?? [1]));

  return (
    <>
      <PageHeader
        title="Ripoti"
        subtitle="Mauzo, faida, matumizi, madeni na stock kwa kipindi unachochagua."
        actions={
          <>
            <Button variant="outline" loading={busy === 'xlsx'} disabled={!r || busy !== null} onClick={() => run('xlsx')}>{busy === 'xlsx' ? tr('Inatengeneza…') : tr('Pakua Excel')}</Button>
            <Button loading={busy === 'pdf'} disabled={!r || busy !== null} onClick={() => run('pdf')}>{busy === 'pdf' ? tr('Inatengeneza…') : tr('Pakua PDF')}</Button>
          </>
        }
      />
      {error && <p role="alert" className="mb-3 rounded-field bg-bad-bg px-4 py-2 text-[13px] font-medium text-bad-fg">{tr(error)}</p>}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Tabs value={period} onChange={setPeriod} options={PERIODS} />
        {r && <span className="text-[13.5px] text-muted">{r.range.from === r.range.to ? d(r.range.from) : `${d(r.range.from)} – ${d(r.range.to)}`}</span>}
      </div>
      {period === 'custom' && (
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <label><span className="label">{tr('Kuanzia')}</span><input type="date" className="input" max={to} value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label><span className="label">{tr('Hadi')}</span><input type="date" className="input" max={today} min={from} value={to} onChange={(e) => setTo(e.target.value)} /></label>
        </div>
      )}

      {!r ? (
        <Spinner variant="list" />
      ) : (
        <>
          <div className="rounded-[20px] border border-line bg-white shadow-sm overflow-hidden mb-6">
            <div className={cx('grid divide-y divide-line-soft md:divide-y-0 md:divide-x', isOwner ? 'grid-cols-2 md:grid-cols-5' : 'grid-cols-2')}>
              <Cell label="Mauzo" value={<AnimatedNumber id="rep.sales" value={r.sales} format={formatTZSCompact} />} note={`mauzo ${formatNumber(r.count)}`} />
              {isOwner && r.gross !== undefined && r.net !== undefined ? (
                <>
                  <Cell label="Gharama za bidhaa" value={<AnimatedNumber id="rep.cogs" value={r.cogs ?? 0} format={(n) => `− ${formatTZSCompact(n)}`} />} note="bei ya kununua" />
                  <Cell label="Faida ghafi" value={<AnimatedNumber id="rep.gross" value={r.gross} format={formatTZSCompact} />} note={`${r.sales > 0 ? ((r.gross / r.sales) * 100).toFixed(1) : '0.0'}% ya mauzo`} />
                  <Cell label="Matumizi" value={<AnimatedNumber id="rep.exp" value={r.expenses ?? 0} format={(n) => `− ${formatTZSCompact(n)}`} />} note="pango, mishahara n.k." />
                  <Cell label="Faida halisi" value={<AnimatedNumber id="rep.net" value={r.net} format={formatTZSCompact} />} note="baada ya matumizi" good={r.net >= 0} bad={r.net < 0} />
                </>
              ) : (
                <Cell label="Idadi ya mauzo" value={<AnimatedNumber id="rep.count" value={r.count} />} note="mauzo yasiyofutwa" />
              )}
            </div>
          </div>

          <Card className="p-6 mb-6">
            <div className="flex items-center justify-between border-b border-line-soft pb-4">
              <h2 className="text-[17px] font-bold text-ink">{isOwner ? tr('Mauzo na faida halisi, miezi 6') : tr('Mauzo, miezi 6')}</h2>
              <ul className="flex gap-4 text-[12.5px] text-muted">
                <li className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-full bg-blue-200" />{tr('Mauzo')}</li>
                {isOwner && <li className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-full bg-primary" />{tr('Faida halisi')}</li>}
              </ul>
            </div>
            <div className="relative mt-6 pt-2">
              <div className="absolute inset-x-0 top-0 flex h-[160px] flex-col justify-between pointer-events-none">
                {[0, 1, 2, 3].map((i) => <div key={i} className="border-b border-dashed border-slate-200/90 w-full" />)}
              </div>
              <div className="relative z-10 flex h-[200px] items-end justify-around gap-2 pb-6" role="img" aria-label={tr('Mauzo ya miezi sita')}>
                {r.months.map((m) => (
                  <div key={m.ym} className="flex flex-1 flex-col items-center justify-end gap-2 group cursor-pointer">
                    <div className="flex h-[150px] items-end gap-1.5">
                      <div className="w-5 rounded-t-lg bg-blue-200 transition group-hover:bg-blue-300 sm:w-8" style={{ height: `${Math.max(6, (m.sales / maxMonth) * 100)}%` }} title={formatTZS(m.sales)} />
                      {m.net !== undefined && (
                        <div className={cx('w-5 rounded-t-lg transition sm:w-8', m.net >= 0 ? 'bg-primary group-hover:bg-blue-700 shadow-sm' : 'bg-bad-fg')} style={{ height: `${Math.max(6, (Math.abs(m.net) / maxMonth) * 100)}%` }} title={formatTZS(m.net)} />
                      )}
                    </div>
                    <div className="text-center">
                      <p className="text-[12.5px] font-bold text-ink">{monthShort(m.ym)}</p>
                      <p className="text-[11px] font-medium text-muted tabular-nums">{formatCompact(m.sales)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card className="p-6">
              <h2 className="text-[16px] font-bold text-ink border-b border-line-soft pb-3.5">{tr('Njia za malipo')}</h2>
              <ul className="mt-4 space-y-4">
                {r.methods.map((m) => (
                  <li key={m.method} className="flex items-center gap-3 text-[13.5px]">
                    <span className="w-20 shrink-0 font-semibold text-ink">{tr(PAYMENT_LABEL[m.method])}</span>
                    <div className="relative flex flex-1 items-center">
                      <div className="h-3 flex-1 overflow-hidden rounded-full bg-blue-50/80">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-blue-300 to-primary transition-all duration-300"
                          style={{ width: `${(m.amount / maxMethod) * 100}%` }}
                        />
                      </div>
                      <span className="ml-2.5 flex h-6 w-11 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-white shadow-sm">
                        {m.pct}%
                      </span>
                    </div>
                    <span className="w-24 shrink-0 text-right font-bold text-ink tabular-nums">{formatTZSCompact(m.amount)}</span>
                  </li>
                ))}
                {r.methods.length === 0 && <li className="text-muted py-3">{tr('Hakuna malipo kwenye kipindi hiki.')}</li>}
              </ul>
            </Card>

            <Card className="p-6">
              <h2 className="text-[16px] font-bold text-ink border-b border-line-soft pb-3.5">{isOwner ? tr('Bidhaa zenye faida zaidi') : tr('Bidhaa zinazouzwa zaidi')}</h2>
              <ol className="mt-3 divide-y divide-line-soft">
                {r.top.map((t, i) => (
                  <li key={t.name} className="flex items-center gap-3 py-3 text-[14px]">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary-tint text-[12px] font-bold text-primary-link">{i + 1}</span>
                    <span className="flex-1 font-semibold">{t.name}</span>
                    <span className="text-[13px] text-muted">{tr('{n} zimeuzwa', { n: formatNumber(t.qty) })}</span>
                    {t.profit !== undefined && <b className="w-20 text-right text-ok-fg">{formatTZSCompact(t.profit)}</b>}
                  </li>
                ))}
                {r.top.length === 0 && <li className="py-3 text-muted">{tr('Hakuna mauzo kwenye kipindi hiki.')}</li>}
              </ol>
            </Card>
          </div>
        </>
      )}
    </>
  );
}

function Cell({ label, value, note, good, bad }: { label: string; value: React.ReactNode; note: string; good?: boolean; bad?: boolean }) {
  return (
    <div className={cx('min-w-0 border-b border-r border-line-soft px-5 py-5', good && 'bg-[#F0FDF4]', bad && 'bg-[#FEF2F2]')}>
      <p className={cx('text-[13px]', good ? 'text-ok-fg' : bad ? 'text-bad-fg' : 'text-body')}>{tr(label)}</p>
      <p className={cx('mt-1.5 whitespace-nowrap text-[24px] font-extrabold leading-none', good ? 'text-ok-fg' : bad ? 'text-bad-fg' : 'text-ink')}>{value}</p>
      <p className="mt-2 text-[12.5px] text-muted">{tr(note)}</p>
    </div>
  );
}
