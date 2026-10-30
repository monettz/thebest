import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { PAYMENT_LABEL } from '@shared/constants';
import { debtStatus, dueTag } from '@shared/debts';
import { displayPhone, formatDate, formatTZS } from '@/lib/format';
import { todayDar } from '@/lib/dar';
import { getSaleDetail } from '@/mock/sales';
import { Button, Spinner } from '@/components/ui';
import Modal from '@/components/Modal';
import { DebtStatusBadge } from '@/components/badges';
import { tr } from '@/i18n';

const day = (iso: string) => formatDate(new Date(iso));
const dayOnly = (ymd: string) => formatDate(new Date(`${ymd}T00:00:00`));
type Detail = NonNullable<Awaited<ReturnType<typeof getSaleDetail>>>;

/** One debt at a glance: customer, products, amounts, due date and every payment made against it. */
export default function DebtDetail({ saleId, onClose, onPay }: { saleId: number; onClose: () => void; onPay?: () => void }) {
  const { data: d } = useQuery({ queryKey: ['sale', saleId], queryFn: () => getSaleDetail(saleId) });

  return (
    <Modal title={tr('Maelezo ya deni')} onClose={onClose} wide>
      {!d ? <Spinner variant="list" /> : <DebtBody d={d} onClose={onClose} onPay={onPay} />}
    </Modal>
  );
}

const kindLabel = (k: 'SALE' | 'DEBT' | 'REFUND') => (k === 'DEBT' ? tr('Malipo ya deni') : k === 'REFUND' ? tr('Marejesho') : tr('Malipo ya mauzo'));

function DebtBody({ d, onClose, onPay }: { d: Detail; onClose: () => void; onPay?: () => void }) {
  const today = todayDar();
  const status = debtStatus(d.balance, d.netPaid, d.dueDate, today);
  const due = d.dueDate && d.balance > 0 ? dueTag(d.dueDate, today) : null;
  const overdue = status === 'OVERDUE';

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[17px] font-extrabold leading-tight text-ink sm:text-[18px]">{d.receiptNo}</h2>
          <p className="text-[12.5px] text-muted">{day(d.createdAt)}</p>
        </div>
        <DebtStatusBadge status={status} />
      </div>

      {d.customer && (
        <div className="flex items-center justify-between gap-3 rounded-field border border-line px-3.5 py-2.5">
          <div className="min-w-0">
            <p className="truncate text-[14.5px] font-bold text-ink">{d.customer.name}</p>
            <p className="text-[12.5px] text-muted">{d.customer.phone ? displayPhone(d.customer.phone) : tr('Hana namba ya simu')}</p>
          </div>
          <Link to={`/customers?c=${d.customer.id}`} className="inline-flex min-h-[36px] shrink-0 items-center rounded-xl bg-primary-tint px-3 text-[13px] font-semibold text-primary-link">
            {tr('Tazama mteja')}
          </Link>
        </div>
      )}

      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label={tr('Kiasi cha mauzo')} value={formatTZS(d.total - d.returnedValue)} />
        <Stat label={tr('Jumla aliyolipa')} value={formatTZS(d.netPaid)} tone="text-ok-fg" />
        <Stat
          label={tr('Deni lililobaki')}
          value={formatTZS(d.balance)}
          tone={d.balance > 0 ? (overdue ? 'text-bad-fg' : 'text-warn-fg') : 'text-ok-fg'}
          box={d.balance > 0 ? (overdue ? 'border-bad-fg/30 bg-bad-bg/40' : 'border-warn-fg/25 bg-warn-bg/40') : undefined}
        />
        <Stat
          label={tr('Tarehe ya kulipa')}
          value={d.dueDate && d.balance > 0 ? dayOnly(d.dueDate) : d.balance > 0 ? tr('Haijawekwa') : '–'}
          note={due ? tr(due.label) : undefined}
          tone={overdue ? 'text-bad-fg' : undefined}
        />
      </dl>
      {d.returnedValue > 0 && <p className="text-[12.5px] text-muted">{tr('Bidhaa zilizorudishwa zimepunguza kiasi cha mauzo kwa {a}.', { a: formatTZS(d.returnedValue) })}</p>}

      <section>
        <h3 className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-muted">{tr('Bidhaa')}</h3>
        <ul className="divide-y divide-line-soft rounded-field border border-line">
          {d.lines.map((l) => (
            <li key={l.index} className="flex items-start justify-between gap-3 px-3.5 py-2 text-[13.5px]">
              <span className="min-w-0">
                <span className="block break-words">{l.name}{l.qty > 1 && ` ×${l.qty}`}</span>
                {l.imei && <span className="block break-all font-mono text-[11.5px] text-muted">IMEI {l.imei}</span>}
              </span>
              <span className="tabular shrink-0 font-semibold">{formatTZS(l.unitPrice * l.qty)}</span>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h3 className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-muted">{tr('Historia ya malipo')}</h3>
        {d.payments.length === 0 ? (
          <p className="rounded-field border border-line px-3.5 py-3 text-center text-[13px] text-muted">{tr('Hakuna malipo bado')}</p>
        ) : (
          <>
            {/* Phones: one compact card per payment */}
            <ul className="space-y-2 sm:hidden">
              {d.payments.map((p) => (
                <li key={p.id} className="rounded-field border border-line px-3.5 py-2.5 text-[13px]">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-ink">{day(p.paidAt)}</span>
                    <span className={`tabular font-extrabold ${p.amount < 0 ? 'text-bad-fg' : 'text-ink'}`}>{formatTZS(p.amount)}</span>
                  </div>
                  <p className="mt-0.5 text-muted">{tr(PAYMENT_LABEL[p.method])} · {kindLabel(p.kind)}</p>
                  <p className="break-words text-[12px] text-muted">
                    {tr('Aliyepokea')}: {p.userName ?? d.userName}
                    {p.reference && <> · {p.reference}</>}
                  </p>
                  {p.notes && <p className="break-words text-[12px] italic text-muted">{p.notes}</p>}
                </li>
              ))}
            </ul>
            <div className="hidden overflow-x-auto rounded-field border border-line sm:block">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="bg-slate-50 text-left text-[11.5px] font-bold uppercase tracking-wide text-slate-500">
                    <th className="px-3 py-2">{tr('Tarehe')}</th>
                    <th className="py-2">{tr('Aina')}</th>
                    <th className="py-2">{tr('Njia')}</th>
                    <th className="py-2">{tr('Aliyepokea')}</th>
                    <th className="px-3 py-2 text-right">{tr('Kiasi')}</th>
                  </tr>
                </thead>
                <tbody>
                  {d.payments.map((p) => (
                    <tr key={p.id} className="border-t border-line-soft align-top">
                      <td className="px-3 py-2">{day(p.paidAt)}</td>
                      <td>{kindLabel(p.kind)}</td>
                      <td>
                        {tr(PAYMENT_LABEL[p.method])}
                        {p.reference && <span className="block text-[11.5px] text-muted">{p.reference}</span>}
                        {p.notes && <span className="block text-[11.5px] italic text-muted">{p.notes}</span>}
                      </td>
                      <td className="text-muted">{p.userName ?? d.userName}</td>
                      <td className="tabular px-3 text-right font-semibold">{formatTZS(p.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      {/* Sticks to the bottom of the sheet while it scrolls, so the actions are never hidden */}
      <div className="sticky -bottom-4 -mx-4 grid grid-cols-2 gap-2.5 border-t border-line-soft bg-white px-4 pb-1 pt-3 sm:static sm:mx-0 sm:border-0 sm:p-0">
        <Link to={`/sales/${d.id}`} className="inline-flex min-h-touch items-center justify-center rounded-xl border border-line bg-white px-4 text-[14px] font-semibold text-slate-700 shadow-sm hover:bg-slate-50">{tr('Tazama mauzo')}</Link>
        {onPay && d.balance > 0 ? <Button onClick={onPay}>{tr('Pokea malipo')}</Button> : <Button variant="outline" onClick={onClose}>{tr('Funga')}</Button>}
      </div>
    </div>
  );
}

function Stat({ label, value, tone, note, box }: { label: string; value: string; tone?: string; note?: string; box?: string }) {
  return (
    <div className={`rounded-field border px-3 py-2 ${box ?? 'border-line-soft bg-slate-50/60'}`}>
      <dt className="text-[11.5px] text-muted">{label}</dt>
      <dd className={`tabular mt-0.5 text-[15px] font-extrabold leading-tight ${tone ?? 'text-ink'}`}>{value}</dd>
      {note && <p className={`text-[11.5px] font-medium ${tone ?? 'text-muted'}`}>{note}</p>}
    </div>
  );
}
