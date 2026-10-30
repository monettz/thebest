import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PAYMENT_LABEL, PAYMENT_METHODS, type PaymentMethod } from '@shared/constants';
import { validateSupplierPayment } from '@shared/stock';
import { useAuth } from '@/lib/auth';
import { formatDayMonth, formatTZS, formatTZSCompact } from '@/lib/format';
import { getSuppliersOverview, paySupplier, saveSupplier, type Supplier } from '@/mock/inventory';
import { Badge, Button, Card, Field, PageHeader, Spinner, cx } from '@/components/ui';
import { tr } from '@/i18n';

const dm = (iso: string) => formatDayMonth(new Date(`${iso}T00:00:00`));
const initialsOf = (name: string) => 'S' + (name.trim().slice(-1) || '').toUpperCase();

export default function Suppliers() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { data } = useQuery({ queryKey: ['suppliers'], queryFn: () => getSuppliersOverview(user!.role) });
  const [paying, setPaying] = useState<{ supplier: Supplier; owed: number } | null>(null);
  const [adding, setAdding] = useState(false);

  if (!data) return <Spinner variant="cards" />;

  return (
    <>
      <PageHeader
        title="Suppliers"
        badge={<Badge tone="navy">{tr('Store')}</Badge>}
        subtitle="Wasambazaji wako, mizigo uliyonunua na kiasi unachodaiwa."
        actions={<Button onClick={() => setAdding(true)}>{tr('+ Ongeza supplier')}</Button>}
      />

      <div className="rounded-[20px] border border-line bg-white shadow-sm overflow-hidden mb-6">
        <div className="grid divide-y divide-line-soft sm:divide-y-0 sm:divide-x sm:grid-cols-3">
          <div className="p-5">
            <p className="text-[13px] font-medium text-muted">{tr('Suppliers')}</p>
            <p className="mt-2 text-[26px] font-extrabold tracking-tight text-ink tabular-nums">{data.supplierCount}</p>
            <p className="mt-2 text-[12px] text-muted">{tr('wasambazaji waliosajiliwa')}</p>
          </div>
          <div className="p-5">
            <p className="text-[13px] font-medium text-muted">{tr('Manunuzi ya mwezi')}</p>
            <p className="mt-2 text-[26px] font-extrabold tracking-tight text-ink tabular-nums">{formatTZSCompact(data.monthTotal)}</p>
            <p className="mt-2 text-[12px] text-muted">{tr('thamani ya mizigo mwezi huu')}</p>
          </div>
          <div className="p-5 bg-amber-50/40">
            <p className="text-[13px] font-medium text-amber-800">{tr('Tunadaiwa na suppliers')}</p>
            <p className="mt-2 text-[26px] font-extrabold tracking-tight text-warn-fg tabular-nums">{formatTZS(data.owedTotal)}</p>
            <p className="mt-2 text-[12px] text-amber-700 font-medium">{tr('inayopaswa kulipwa')}</p>
          </div>
        </div>
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {data.cards.map(({ supplier, deliveries, total, owed }) => (
          <Card key={supplier.id} className="p-4">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-field bg-app text-[14px] font-extrabold">{initialsOf(supplier.name)}</span>
              <div>
                <p className="text-[15px] font-bold">{supplier.name}</p>
                <p className="text-[12.5px] text-muted">{supplier.phone || tr('[Namba ya simu]')}</p>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <div className="rounded-field bg-app p-3"><p className="text-[12px] text-muted">{tr('Mizigo')}</p><p className="font-bold">{deliveries}</p></div>
              <div className="rounded-field bg-app p-3"><p className="text-[12px] text-muted">{tr('Jumla')}</p><p className="font-bold">{formatTZSCompact(total)}</p></div>
            </div>
            <p className={cx('mt-2 flex justify-between rounded-field px-3 py-2.5 text-[13.5px]', owed > 0 ? 'bg-warn-bg text-warn-fg' : 'bg-ok-bg text-ok-fg')}>
              <span>{tr('Tunadaiwa')}</span>
              <b>{owed > 0 ? formatTZS(owed) : tr('Hakuna')}</b>
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Button variant="soft" onClick={() => navigate(`/store/receive?supplier=${supplier.id}`)}>{tr('Pokea mzigo')}</Button>
              <Button variant="outline" disabled={owed === 0} onClick={() => setPaying({ supplier, owed })}>{tr('Lipa')}</Button>
            </div>
          </Card>
        ))}
      </div>

      <Card className="mt-5 overflow-x-auto">
        <h2 className="p-4 text-[16px] font-bold">{tr('Manunuzi ya karibuni')}</h2>
        <table className="w-full min-w-[520px] text-[14px]">
          <thead>
            <tr className="bg-app/60 text-left text-[13px] text-muted">
              <th className="px-4 py-2.5 font-medium">{tr('Tarehe')}</th>
              <th className="py-2.5 font-medium">{tr('Supplier')}</th>
              <th className="py-2.5 font-medium">{tr('Invoice')}</th>
              <th className="py-2.5 text-right font-medium">{tr('Kiasi')}</th>
              <th className="px-4 py-2.5 text-right font-medium">{tr('Hali')}</th>
            </tr>
          </thead>
          <tbody>
            {data.recent.map((r) => (
              <tr key={r.id} className="border-t border-line-soft">
                <td className="px-4 py-3">{dm(r.date)}</td>
                <td className="font-semibold">{r.supplier}</td>
                <td className="font-mono text-[12.5px] text-body">{r.invoiceNo || '–'}</td>
                <td className="text-right font-bold">{formatTZS(r.total)}</td>
                <td className="px-4 text-right">
                  {r.owed > 0 ? <Badge tone="warn">{tr('Deni')} {formatTZSCompact(r.owed).replace('TSh ', '')}</Badge> : <Badge tone="ok">{tr('Imelipwa')}</Badge>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {paying && <PayDialog {...paying} onClose={() => setPaying(null)} />}
      {adding && <SupplierDialog onClose={() => setAdding(false)} />}
    </>
  );
}

function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-navy/50 animate-fade-in sm:items-center" onClick={onClose}>
      <div role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()} className="pb-safe max-h-[92vh] w-full max-w-md space-y-4 overflow-y-auto animate-sheet rounded-t-[28px] bg-white p-6 sm:rounded-[28px]">
        <h2 className="text-[18px] font-extrabold">{title}</h2>
        {children}
      </div>
    </div>
  );
}

function PayDialog({ supplier, owed, onClose }: { supplier: Supplier; owed: number; onClose: () => void }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [amount, setAmount] = useState(String(owed));
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const value = Number(amount.replace(/\D/g, '')) || 0;
  const error = validateSupplierPayment(value, owed);
  const pay = useMutation({
    mutationFn: () => paySupplier(user!, { supplierId: supplier.id, amount: value, method }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['suppliers'] });
      onClose();
    },
  });

  return (
    <Dialog title={`Lipa ${supplier.name}`} onClose={onClose}>
      <p className="text-[13.5px] text-body">{tr('Deni la sasa:')} <b className="text-warn-fg">{formatTZS(owed)}</b></p>
      <Field label="Kiasi unacholipa (TSh)">
        <input className="input" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))} autoFocus />
      </Field>
      <div className="flex flex-wrap gap-2">
        {PAYMENT_METHODS.map((m) => (
          <button key={m} type="button" aria-pressed={method === m} onClick={() => setMethod(m)}
            className={cx('min-h-[38px] rounded-chip border px-3 text-[13px] font-semibold', method === m ? 'border-primary bg-primary-tint text-primary-link' : 'border-line text-body')}>
            {tr(PAYMENT_LABEL[m])}
          </button>
        ))}
      </div>
      <p className="text-[13.5px]">
        Deni litabaki: {error ? <b className="text-bad-fg">{tr(error)}</b> : <b>{formatTZS(owed - value)}</b>}
      </p>
      {pay.isError && <p role="alert" className="rounded-field bg-bad-bg px-3.5 py-2 text-[13px] font-medium text-bad-fg">{tr((pay.error as Error).message)}</p>}
      <div className="grid grid-cols-2 gap-3">
        <Button variant="outline" onClick={onClose}>{tr('Ghairi')}</Button>
        <Button loading={pay.isPending} disabled={!!error || pay.isPending} onClick={() => pay.mutate()}>{tr('Hifadhi malipo')}</Button>
      </div>
    </Dialog>
  );
}

function SupplierDialog({ onClose }: { onClose: () => void }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const save = useMutation({
    mutationFn: () => saveSupplier(user!.role, { name, phone }),
    onSuccess: () => {
      for (const k of ['suppliers', 'supplier-list']) void qc.invalidateQueries({ queryKey: [k] });
      onClose();
    },
  });
  return (
    <Dialog title="Ongeza supplier" onClose={onClose}>
      <Field label="Jina la supplier"><input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
      <Field label="Namba ya simu (hiari)"><input className="input" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
      {save.isError && <p role="alert" className="rounded-field bg-bad-bg px-3.5 py-2 text-[13px] font-medium text-bad-fg">{tr((save.error as Error).message)}</p>}
      <div className="grid grid-cols-2 gap-3">
        <Button variant="outline" onClick={onClose}>{tr('Ghairi')}</Button>
        <Button loading={save.isPending} disabled={save.isPending} onClick={() => save.mutate()}>{tr('Hifadhi')}</Button>
      </div>
    </Dialog>
  );
}
