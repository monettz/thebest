import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PAYMENT_LABEL, PAYMENT_METHODS, type PaymentMethod } from '@shared/constants';
import { validateDebtPayment, validatePaymentDate } from '@shared/debts';
import { useAuth } from '@/lib/auth';
import { todayDar } from '@/lib/dar';
import { displayPhone, formatTZS } from '@/lib/format';
import { getSettings } from '@/mock/api';
import { payCustomerDebt, payDebt, type DebtRow } from '@/mock/sales';
import { Button, cx } from '@/components/ui';
import Modal from '@/components/Modal';
import { Chip } from '@/components/ReportDialog';
import { tr } from '@/i18n';

const digits = (s: string) => Number(s.replace(/\D/g, '')) || 0;
const AUTO = 'auto';

/** Everything that shows balances has to refresh after money is received. */
export const PAYMENT_QUERY_KEYS = ['debts', 'customers', 'customer', 'sale', 'sales', 'shop-dashboard', 'close-day', 'report', 'audit'];

/**
 * Receive money against a debt. Opened from the Debts page (one sale) or the Customers page (all of
 * a customer's unpaid sales: pick one, or let the oldest be cleared first). Always recorded as a
 * repayment on the sale, never as a new sale.
 */
export default function ReceivePayment({ rows, onClose }: { rows: DebtRow[]; onClose: () => void }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const today = todayDar();
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: getSettings });
  const key = useRef(crypto.randomUUID()); // the same key can only be recorded once
  const customer = rows[0].customer;

  const [target, setTarget] = useState<string>(rows.length === 1 ? String(rows[0].saleId) : AUTO);
  const sale = rows.find((r) => String(r.saleId) === target) ?? null;
  const owed = sale ? sale.balance : rows.reduce((a, r) => a + r.balance, 0);

  const [amount, setAmount] = useState(String(owed));
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [reference, setReference] = useState('');
  const [paidOn, setPaidOn] = useState(today);
  const [notes, setNotes] = useState('');
  const [sms, setSms] = useState<boolean | null>(null);
  const sendSms = (sms ?? settings?.smsDebtPayment ?? true) && !!customer.phone;
  const [done, setDone] = useState<{ applied: { saleId: number; paymentId: number; amount: number }[]; left: number } | null>(null);

  const value = digits(amount);
  const amountError = validateDebtPayment(value, owed);
  // In "oldest first" mode the date must suit every sale it may touch, i.e. not precede the oldest one.
  const oldestSale = sale ? sale.saleDate : rows.reduce((m, r) => (r.saleDate < m ? r.saleDate : m), rows[0].saleDate);
  const dateError = validatePaymentDate(paidOn, oldestSale, today);
  const left = owed - value;

  const pay = useMutation({
    mutationFn: async () => {
      const base = { amount: value, method, sendSms, reference, notes, paidOn, key: key.current };
      if (sale) {
        const r = await payDebt(user!, { ...base, saleId: sale.saleId });
        return { applied: [{ ...r, amount: value }] };
      }
      return payCustomerDebt(user!, { ...base, customerId: customer.id });
    },
    onSuccess: (r) => {
      for (const k of PAYMENT_QUERY_KEYS) void qc.invalidateQueries({ queryKey: [k] });
      setDone({ applied: r.applied, left });
    },
  });

  if (done) {
    return (
      <Modal title={tr('Pokea malipo')} onClose={onClose}>
        <div className="space-y-4 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-ok-bg text-[22px] text-ok-fg">✓</div>
          <div>
            <h2 className="text-[18px] font-extrabold text-ink">{tr('Malipo yamehifadhiwa')}</h2>
            <p className="mt-1 text-[13.5px] text-muted">
              {customer.name} · {formatTZS(value)} ·{' '}
              {done.left === 0 ? <b className="text-ok-fg">{tr('Deni limekwisha')}</b> : <>{tr('Deni lililobaki')}: <b className="text-warn-fg">{formatTZS(done.left)}</b></>}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {done.applied.length === 1 ? (
              <Link to={`/receipts/${done.applied[0].saleId}?payment=${done.applied[0].paymentId}&print=1`} className="inline-flex min-h-touch items-center justify-center rounded-xl border border-line bg-white px-4 text-[14px] font-semibold text-slate-700 shadow-sm hover:bg-slate-50">
                {tr('Chapisha risiti')}
              </Link>
            ) : (
              <span />
            )}
            <Button onClick={onClose}>{tr('Sawa')}</Button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title={tr('Pokea malipo')} onClose={onClose}>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-[18px] font-extrabold text-ink">{tr('Pokea malipo')}</h2>
          <button type="button" onClick={onClose} className="text-[13px] font-semibold text-muted">{tr('Funga')}</button>
        </div>

        <div className="rounded-field border border-line p-3.5 text-[13.5px]">
          <p className="text-[15px] font-bold text-ink">{customer.name}</p>
          <p className="text-[12.5px] text-muted">{customer.phone ? displayPhone(customer.phone) : tr('Hana namba ya simu')}</p>
          {rows.length > 1 && (
            <select className="input mt-2.5" value={target} onChange={(e) => { setTarget(e.target.value); const r = rows.find((x) => String(x.saleId) === e.target.value); setAmount(String(r ? r.balance : rows.reduce((a, x) => a + x.balance, 0))); }} aria-label={tr('Deni la kulipa')}>
              <option value={AUTO}>{tr('Madeni ya zamani kwanza (yote: {a})', { a: formatTZS(rows.reduce((a, r) => a + r.balance, 0)) })}</option>
              {rows.map((r) => <option key={r.saleId} value={r.saleId}>{r.receiptNo} · {r.item} · {formatTZS(r.balance)}</option>)}
            </select>
          )}
          <dl className="mt-3 space-y-1.5">
            {sale ? (
              <>
                <Line label={tr('Risiti ya mauzo')} value={sale.receiptNo} />
                <Line label={tr('Kiasi cha mauzo')} value={formatTZS(sale.total)} />
                <Line label={tr('Alicholipa tayari')} value={formatTZS(sale.paid)} />
              </>
            ) : (
              <>
                <Line label={tr('Kiasi cha mauzo')} value={formatTZS(rows.reduce((a, r) => a + r.total, 0))} />
                <Line label={tr('Alicholipa tayari')} value={formatTZS(rows.reduce((a, r) => a + r.paid, 0))} />
              </>
            )}
            <Line label={tr('Deni lililobaki')} value={formatTZS(owed)} strong />
          </dl>
        </div>

        <label className="block">
          <span className="label">{tr('Kiasi anacholipa (TSh)')}</span>
          <input className="input" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))} aria-invalid={!!amountError} />
          {amountError && <span className="mt-1 block text-[12px] font-medium text-bad-fg">{tr(amountError)}</span>}
        </label>

        <div>
          <p className="label">{tr('Njia ya malipo')}</p>
          <div className="flex flex-wrap gap-2">
            {PAYMENT_METHODS.map((m) => <Chip key={m} active={method === m} onClick={() => setMethod(m)}>{tr(PAYMENT_LABEL[m])}</Chip>)}
          </div>
        </div>

        <div className={cx('grid gap-3', method !== 'CASH' && 'sm:grid-cols-2')}>
          {method !== 'CASH' && (
            <label className="block">
              <span className="label">{tr('Namba ya muamala (hiari)')}</span>
              <input className="input" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={40} />
            </label>
          )}
          <label className="block">
            <span className="label">{tr('Tarehe ya malipo')}</span>
            <input type="date" className="input" max={today} min={oldestSale} value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
            {dateError && <span className="mt-1 block text-[12px] font-medium text-bad-fg">{tr(dateError)}</span>}
          </label>
        </div>

        <label className="block">
          <span className="label">{tr('Maelezo (hiari)')}</span>
          <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={200} />
        </label>

        <div className="flex items-center justify-between rounded-field border border-line-soft px-4 py-3">
          <span className="text-[13.5px] text-body">{tr('Deni litabaki')}</span>
          {amountError ? <span className="text-[13px] font-semibold text-bad-fg">–</span> : left === 0 ? <span className="text-[18px] font-extrabold text-ok-fg">{tr('Limekwisha')}</span> : <span className="text-[18px] font-extrabold text-warn-fg">{formatTZS(left)}</span>}
        </div>

        {customer.phone && (
          <label className="flex min-h-touch items-center gap-3 text-[14px]">
            <input type="checkbox" className="h-4 w-4 accent-primary" checked={sendSms} onChange={(e) => setSms(e.target.checked)} />
            {tr('Tuma SMS ya uthibitisho kwa mteja')}
          </label>
        )}

        {pay.isError && <p role="alert" className="rounded-field bg-bad-bg px-3.5 py-2 text-[13px] font-medium text-bad-fg">{tr((pay.error as Error).message)}</p>}
        <Button loading={pay.isPending} block className="min-h-[50px] text-[15px]" disabled={!!amountError || !!dateError || pay.isPending || pay.isSuccess} onClick={() => pay.mutate()}>
          {pay.isPending ? tr('Inahifadhi…') : tr('Hifadhi malipo')}
        </Button>
      </div>
    </Modal>
  );
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-body">{label}</dt>
      <dd className={cx('tabular text-right', strong ? 'font-extrabold text-warn-fg' : 'font-semibold text-ink')}>{value}</dd>
    </div>
  );
}
