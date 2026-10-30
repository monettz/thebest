import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { displayPhone, formatDate, formatTZS } from '@/lib/format';
import { todayDar } from '@/lib/dar';
import { exportDebtsPdf } from '@/lib/exportDebtsPdf';
import { getDebtOverview, getDebtReport, previewDebtReminders, sendDebtReminders, type DebtRow } from '@/mock/sales';
import { isSmsConfigured } from '@/mock/sms';
import { AnimatedNumber, Button, Card, PageHeader, Spinner, Tabs, cx } from '@/components/ui';
import { SearchIcon } from '@/components/ui/icons';
import DebtDetail from '@/components/DebtDetail';
import Modal from '@/components/Modal';
import ReceivePayment from '@/components/ReceivePayment';
import ReportDialog from '@/components/ReportDialog';
import { DebtStatusBadge } from '@/components/badges';
import { tr } from '@/i18n';

type Filter = 'open' | 'overdue' | 'today' | 'paid' | 'range';
const FILTERS: { value: Filter; label: string }[] = [
  { value: 'open', label: 'Yanayodaiwa yote' },
  { value: 'overdue', label: 'Yaliyopita tarehe' },
  { value: 'today', label: 'Leo' },
  { value: 'paid', label: 'Yaliyolipwa' },
  { value: 'range', label: 'Kipindi maalum' },
];

const day = (ymd: string) => formatDate(new Date(`${ymd}T00:00:00`));
const phoneOf = (r: DebtRow) => (r.customer.phone ? displayPhone(r.customer.phone) : '');
const dueText = (r: DebtRow) => (r.dueDate ? day(r.dueDate) : tr('Haijawekwa'));

export default function Debts() {
  const today = todayDar();
  const [params] = useSearchParams();
  const [filter, setFilter] = useState<Filter>(FILTERS.some((f) => f.value === params.get('filter')) ? (params.get('filter') as Filter) : 'open');
  const [q, setQ] = useState(params.get('q') ?? '');
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`);
  const [to, setTo] = useState(today);
  const [paying, setPaying] = useState<DebtRow | null>(null);
  const [viewing, setViewing] = useState<number | null>(null);
  const [reporting, setReporting] = useState(false);
  const [reminding, setReminding] = useState(false);
  const { data } = useQuery({ queryKey: ['debts'], queryFn: getDebtOverview });

  const rows = useMemo(() => {
    if (!data) return [];
    const needle = q.trim().toLowerCase().replace(/\s/g, '');
    const phoneNeedle = needle.replace(/^0/, '255').replace(/^\+/, '');
    const base = data.allRows.filter((r) => {
      switch (filter) {
        case 'open': return r.balance > 0;
        case 'overdue': return r.status === 'OVERDUE';
        case 'today': return r.balance > 0 && r.dueDate === today;
        case 'paid': return r.balance <= 0;
        case 'range': return r.saleDate >= from && r.saleDate <= to;
      }
    });
    return base.filter(
      (r) =>
        !needle ||
        r.customer.name.toLowerCase().replace(/\s/g, '').includes(needle) ||
        (!!r.customer.phone && r.customer.phone.includes(phoneNeedle)) ||
        r.receiptNo.toLowerCase().includes(needle),
    );
  }, [data, filter, q, from, to, today]);

  if (!data) return <Spinner variant="cards" />;

  const bucketTotal = data.buckets.reduce((a, b) => a + b, 0);
  const BUCKETS = [
    { label: tr('Siku 0–7'), color: 'bg-bar-1' },
    { label: tr('Siku 8–30'), color: 'bg-primary' },
    { label: tr('Zaidi ya siku 30'), color: 'bg-bad-fg' },
  ];
  const wantedSale = Number(params.get('sale')) || null;
  const deepLinked = wantedSale ? data.rows.find((r) => r.saleId === wantedSale) : undefined;

  return (
    <>
      <PageHeader
        title="Madeni"
        subtitle="Fuatilia salio la wateja, pokea malipo na simamia madeni yaliyopita tarehe."
        actions={
          <>
            <Button variant="outline" onClick={() => setReminding(true)}>{tr('Tuma SMS za kukumbusha')}</Button>
            <Button variant="outline" onClick={() => setReporting(true)}>{tr('Pakua PDF')}</Button>
          </>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Summary label={tr('Jumla ya madeni')} value={<AnimatedNumber id="debts.total" value={data.totalDebt} format={formatTZS} />} note={tr('wateja {n}', { n: data.debtorCount })} tone="text-warn-fg" />
        <Summary label={tr('Yaliyopita tarehe')} value={<AnimatedNumber id="debts.overdue" value={data.overdueTotal} format={formatTZS} />} note={tr('wateja {n}', { n: data.overdueCount })} tone={data.overdueTotal > 0 ? 'text-bad-fg' : 'text-ink'} />
        <Summary className="col-span-2 sm:col-span-1" label={tr('Malipo yaliyopokelewa mwezi huu')} value={<AnimatedNumber id="debts.paid" value={data.paidThisMonth} format={formatTZS} />} note={tr('malipo {n}', { n: data.paymentsThisMonth })} tone="text-ok-fg" />
      </div>

      {bucketTotal > 0 && (
        <Card className="mb-4 px-4 py-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-5">
            <p className="shrink-0 text-[12.5px] font-semibold text-ink">{tr('Umri wa madeni')}</p>
            <div className="flex h-2 w-full overflow-hidden rounded-full bg-slate-100 sm:w-auto sm:flex-1" role="img" aria-label={tr('Umri wa madeni')}>
              {data.buckets.map((v, i) => <div key={i} className={BUCKETS[i].color} style={{ width: `${(v / bucketTotal) * 100}%` }} />)}
            </div>
            <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-slate-600">
              {BUCKETS.map((b, i) => (
                <li key={b.label} className="flex items-center gap-1.5">
                  <span className={cx('h-2 w-2 rounded-full', b.color)} />
                  {b.label} <b className="tabular text-ink">{formatTZS(data.buckets[i])}</b>
                </li>
              ))}
            </ul>
          </div>
        </Card>
      )}

      <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="relative w-full lg:max-w-sm">
          <SearchIcon width={16} height={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
          <input className="input h-10 min-h-0 pl-10" placeholder={tr('Jina, simu au namba ya risiti…')} aria-label={tr('Tafuta deni')} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Tabs value={filter} onChange={setFilter} options={FILTERS} />
      </div>
      {filter === 'range' && (
        <div className="mb-3 flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="label">{tr('Mauzo kuanzia')}</span>
            <input type="date" className="input h-10 min-h-0" max={to} value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="block">
            <span className="label">{tr('Mpaka')}</span>
            <input type="date" className="input h-10 min-h-0" min={from} max={today} value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
        </div>
      )}

      {rows.length === 0 ? (
        <Card className="p-8 text-center text-[14px] text-muted">{tr('Hakuna madeni katika kichujio hiki.')}</Card>
      ) : (
        <>
          <Card className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[820px] text-[12.5px]">
              <thead>
                <tr className="bg-slate-50/80 text-left text-[11.5px] font-bold uppercase tracking-wider text-slate-500">
                  <th className="px-4 py-3">{tr('Mteja')}</th>
                  <th className="py-3">{tr('Tarehe ya mauzo')}</th>
                  <th className="py-3">{tr('Risiti')}</th>
                  <th className="py-3 pl-3 text-right">{tr('Kiasi cha mauzo')}</th>
                  <th className="py-3 pl-3 text-right">{tr('Amelipa')}</th>
                  <th className="py-3 pl-3 text-right">{tr('Deni lililobaki')}</th>
                  <th className="py-3 pl-4">{tr('Tarehe ya kulipa')}</th>
                  <th className="py-3">{tr('Hali')}</th>
                  <th className="px-4 py-3 text-right">{tr('Vitendo')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.saleId} className="border-t border-line-soft hover:bg-slate-50/70">
                    <td className="max-w-[160px] px-4 py-2.5">
                      <Link to={`/customers?c=${r.customer.id}`} className="block truncate font-bold text-ink hover:text-primary-link hover:underline" title={tr('Tazama mteja')}>{r.customer.name}</Link>
                      <p className="truncate text-[12px] text-muted">{phoneOf(r) || '–'}</p>
                    </td>
                    <td className="whitespace-nowrap">{day(r.saleDate)}</td>
                    <td className="whitespace-nowrap font-semibold text-primary-link"><button type="button" className="hover:underline" onClick={() => setViewing(r.saleId)}>{r.receiptNo}</button></td>
                    <td className="tabular whitespace-nowrap pl-3 text-right">{formatTZS(r.total)}</td>
                    <td className="tabular whitespace-nowrap pl-3 text-right">{formatTZS(r.paid)}</td>
                    <td className={cx('tabular whitespace-nowrap pl-3 text-right', r.balance > 0 ? 'font-extrabold text-ink' : 'text-muted')}>{r.balance > 0 ? formatTZS(r.balance) : '–'}</td>
                    <td className={cx('whitespace-nowrap pl-4', r.status === 'OVERDUE' && 'font-semibold text-bad-fg', !r.dueDate && 'text-muted')}>{r.balance > 0 ? dueText(r) : '–'}</td>
                    <td><DebtStatusBadge status={r.status} /></td>
                    <td className="px-4">
                      <div className="flex items-center justify-end gap-1">
                        {r.balance > 0 && <Button variant="soft" className="min-h-[34px] whitespace-nowrap px-3 text-[13px]" onClick={() => setPaying(r)} aria-label={`${tr('Pokea malipo')}: ${r.customer.name} ${r.receiptNo}`}>{tr('Pokea')}</Button>}
                        <Button variant="ghost" className="min-h-[34px] px-3 text-[13px]" onClick={() => setViewing(r.saleId)}>{tr('Tazama')}</Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <ul className="space-y-2.5 md:hidden">
            {rows.map((r) => (
              <li key={r.saleId} className="card p-3.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-[14.5px] font-bold text-ink">{r.customer.name}</p>
                    <p className="text-[12px] text-muted">{r.receiptNo}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="tabular text-[16px] font-extrabold text-ink">{formatTZS(r.balance)}</p>
                    <DebtStatusBadge status={r.status} />
                  </div>
                </div>
                <div className="mt-2.5 flex gap-2">
                  {r.balance > 0 && <Button className="min-h-[40px] flex-1 text-[13.5px]" onClick={() => setPaying(r)}>{tr('Pokea malipo')}</Button>}
                  <Button variant="outline" className="min-h-[40px] flex-1 text-[13.5px]" onClick={() => setViewing(r.saleId)}>{tr('Tazama maelezo')}</Button>
                </div>
                <details className="mt-2 text-[12.5px] text-muted">
                  <summary className="cursor-pointer select-none py-1 font-semibold text-body">{tr('Maelezo zaidi')}</summary>
                  <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1">
                    <dt>{tr('Namba ya simu')}</dt><dd className="text-right text-body">{phoneOf(r) || '–'}</dd>
                    <dt>{tr('Tarehe ya mauzo')}</dt><dd className="text-right text-body">{day(r.saleDate)}</dd>
                    <dt>{tr('Kiasi cha mauzo')}</dt><dd className="tabular text-right text-body">{formatTZS(r.total)}</dd>
                    <dt>{tr('Amelipa')}</dt><dd className="tabular text-right text-body">{formatTZS(r.paid)}</dd>
                    <dt>{tr('Tarehe ya kulipa')}</dt><dd className={cx('text-right', r.status === 'OVERDUE' ? 'font-semibold text-bad-fg' : 'text-body')}>{r.balance > 0 ? dueText(r) : '–'}</dd>
                  </dl>
                  <Link to={`/customers?c=${r.customer.id}`} className="mt-1.5 inline-block font-semibold text-primary-link">{tr('Tazama mteja')}</Link>
                </details>
              </li>
            ))}
          </ul>
        </>
      )}

      {(paying || deepLinked) && !viewing && (
        <ReceivePayment rows={[paying ?? deepLinked!]} onClose={() => { setPaying(null); if (deepLinked) window.history.replaceState(null, '', '/debts'); }} />
      )}
      {viewing && (
        <DebtDetail
          saleId={viewing}
          onClose={() => setViewing(null)}
          onPay={() => {
            const r = data.rows.find((x) => x.saleId === viewing);
            setViewing(null);
            if (r) setPaying(r);
          }}
        />
      )}
      {reminding && <ReminderDialog rows={rows.filter((r) => r.balance > 0)} onClose={() => setReminding(false)} />}
      {reporting && (
        <ReportDialog
          title={tr('Ripoti ya madeni (PDF)')}
          scopes={[
            { value: 'outstanding', label: 'Wateja wote wanaodaiwa' },
            { value: 'overdue', label: 'Madeni yaliyopita tarehe' },
            { value: 'customer', label: 'Mteja mmoja' },
          ]}
          customers={[...new Map(data.allRows.map((r) => [r.customer.id, { id: r.customer.id, name: r.customer.name }])).values()].sort((a, b) => a.name.localeCompare(b.name))}
          initialScope="outstanding"
          onClose={() => setReporting(false)}
          onGenerate={async (c) => exportDebtsPdf(await getDebtReport(c.scope, c.range, c.customerId))}
        />
      )}
    </>
  );
}

function Summary({ label, value, note, tone, className }: { label: string; value: React.ReactNode; note: string; tone: string; className?: string }) {
  return (
    <div className={cx('card px-4 py-3', className)}>
      <p className="text-[12px] font-medium leading-tight text-muted">{label}</p>
      <p className={cx('tabular mt-1 whitespace-nowrap text-[18px] font-extrabold leading-tight tracking-tight sm:text-[22px]', tone)}>{value}</p>
      <p className="mt-0.5 text-[11.5px] text-muted">{note}</p>
    </div>
  );
}

/** Staff review the exact messages and pick who gets one. Nothing leaves without the Send click. */
function ReminderDialog({ rows, onClose }: { rows: DebtRow[]; onClose: () => void }) {
  const qc = useQueryClient();
  const configured = isSmsConfigured();
  const { data: previews } = useQuery({ queryKey: ['reminder-preview', rows.map((r) => r.saleId)], queryFn: () => previewDebtReminders(rows.map((r) => r.saleId)), enabled: configured });
  const [off, setOff] = useState<Set<number>>(new Set());
  const send = useMutation({
    mutationFn: (ids: number[]) => sendDebtReminders(ids),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['reminder-preview'] }),
  });

  if (!configured) {
    return (
      <Modal title={tr('Tuma SMS za kukumbusha')} onClose={onClose}>
        <div className="space-y-4">
          <h2 className="text-[18px] font-extrabold text-ink">{tr('SMS haijawekwa')}</h2>
          <p className="rounded-field bg-warn-bg px-3.5 py-3 text-[13.5px] leading-relaxed text-warn-fg">
            {tr('Huduma ya SMS bado haijawekwa kwenye mfumo huu, kwa hiyo hakuna ujumbe utakaotumwa. Weka mtoa huduma wa SMS (VITE_SMS_DRIVER, VITE_SMS_API_URL na VITE_SMS_API_KEY) kisha ufungue tena ukurasa huu.')}
          </p>
          <Button block onClick={onClose}>{tr('Sawa')}</Button>
        </div>
      </Modal>
    );
  }

  const eligible = (previews ?? []).filter((p) => p.eligible);
  const chosen = eligible.filter((p) => !off.has(p.saleId));
  const result = send.data;

  return (
    <Modal title={tr('Tuma SMS za kukumbusha')} onClose={onClose} wide>
      <div className="space-y-4">
        <h2 className="text-[18px] font-extrabold text-ink">{tr('Tuma SMS za kukumbusha')}</h2>
        {!previews ? (
          <Spinner variant="list" />
        ) : previews.length === 0 ? (
          <p className="text-[13.5px] text-muted">{tr('Hakuna madeni ya kukumbusha katika kichujio hiki.')}</p>
        ) : (
          <ul className="max-h-[48vh] divide-y divide-line-soft overflow-y-auto rounded-field border border-line">
            {previews.map((p) => (
              <li key={p.saleId} className={cx('p-3 text-[13px]', !p.eligible && 'bg-slate-50')}>
                <label className="flex items-start gap-3">
                  <input type="checkbox" className="mt-1 h-4 w-4 accent-primary" disabled={!p.eligible} checked={p.eligible && !off.has(p.saleId)} onChange={(e) => setOff((s) => { const n = new Set(s); if (e.target.checked) n.delete(p.saleId); else n.add(p.saleId); return n; })} />
                  <span className="min-w-0 flex-1">
                    <span className="flex justify-between gap-2 font-bold text-ink"><span className="truncate">{p.customerName} · {p.receiptNo}</span><span className="tabular shrink-0">{formatTZS(p.balance)}</span></span>
                    {p.eligible ? <span className="mt-0.5 block text-muted">{p.message}</span> : <span className="mt-0.5 block font-medium text-warn-fg">{tr(p.reason ?? '')}</span>}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
        {send.isError && <p role="alert" className="rounded-field bg-bad-bg px-3.5 py-2 text-[13px] font-medium text-bad-fg">{tr((send.error as Error).message)}</p>}
        {result && <p role="status" className="rounded-field bg-ok-bg px-3.5 py-2 text-[13px] font-medium text-ok-fg">{tr('Zimetumwa: {a}. Zilizorudiwa: {b}. Zilizoshindwa: {c}.', { a: result.sent, b: result.duplicates, c: result.failed })}</p>}
        <div className="grid grid-cols-2 gap-3">
          <Button variant="outline" onClick={onClose}>{tr('Funga')}</Button>
          <Button loading={send.isPending} disabled={chosen.length === 0 || send.isPending || !!result} onClick={() => send.mutate(chosen.map((p) => p.saleId))}>
            {send.isPending ? tr('Inatuma…') : tr('Tuma SMS {n}', { n: chosen.length })}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
