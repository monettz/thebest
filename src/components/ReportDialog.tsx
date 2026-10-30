import { useState } from 'react';
import { REPORT_PERIODS, reportRange, type ReportPeriod } from '@shared/customers';
import type { Range } from '@shared/money';
import { todayDar } from '@/lib/dar';
import { Button, cx } from '@/components/ui';
import Modal from '@/components/Modal';
import { tr } from '@/i18n';

export interface ReportChoice<S extends string> {
  scope: S;
  customerId?: number;
  range: Range | null;
}

/** Scope + period picker shared by the Customers and Debts PDF reports. */
export default function ReportDialog<S extends string>({
  title,
  scopes,
  customers,
  initialScope,
  initialCustomerId,
  onClose,
  onGenerate,
}: {
  title: string;
  scopes: { value: S; label: string }[];
  customers: { id: number; name: string }[];
  initialScope: S;
  initialCustomerId?: number;
  onClose: () => void;
  onGenerate: (c: ReportChoice<S>) => Promise<void>;
}) {
  const today = todayDar();
  const [scope, setScope] = useState<S>(initialScope);
  const [customerId, setCustomerId] = useState<number | ''>(initialCustomerId ?? '');
  const [period, setPeriod] = useState<ReportPeriod>('month');
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const needsCustomer = scope === ('customer' as S);
  const customRange: Range = { from, to };
  const invalidCustom = period === 'custom' && (!from || !to || from > to);
  const disabled = busy || invalidCustom || (needsCustomer && customerId === '');

  const generate = async () => {
    setBusy(true);
    setError('');
    try {
      await onGenerate({ scope, customerId: needsCustomer ? Number(customerId) : undefined, range: reportRange(period, today, customRange) });
      onClose();
    } catch (e) {
      setError((e as Error).message || tr('Imeshindwa kutengeneza PDF'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={title} onClose={onClose}>
      <div className="space-y-4">
        <h2 className="text-[18px] font-extrabold text-ink">{title}</h2>

        <div>
          <p className="label">{tr('Ripoti ya nani')}</p>
          <div className="flex flex-wrap gap-2">
            {scopes.map((o) => (
              <Chip key={o.value} active={scope === o.value} onClick={() => setScope(o.value)}>{tr(o.label)}</Chip>
            ))}
          </div>
          {needsCustomer && (
            <select className="input mt-2" value={customerId} onChange={(e) => setCustomerId(e.target.value ? Number(e.target.value) : '')} aria-label={tr('Chagua mteja')}>
              <option value="">{tr('Chagua mteja…')}</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
        </div>

        <div>
          <p className="label">{tr('Kipindi')}</p>
          <div className="flex flex-wrap gap-2">
            {REPORT_PERIODS.map((o) => (
              <Chip key={o.value} active={period === o.value} onClick={() => setPeriod(o.value)}>{tr(o.label)}</Chip>
            ))}
          </div>
          {period === 'custom' && (
            <div className="mt-2 grid grid-cols-2 gap-2">
              <label className="block">
                <span className="label">{tr('Kuanzia')}</span>
                <input type="date" className="input" max={today} value={from} onChange={(e) => setFrom(e.target.value)} />
              </label>
              <label className="block">
                <span className="label">{tr('Mpaka')}</span>
                <input type="date" className="input" max={today} value={to} onChange={(e) => setTo(e.target.value)} />
              </label>
              {invalidCustom && <p className="col-span-2 text-[12px] font-medium text-bad-fg">{tr('Tarehe ya mwisho iwe baada ya ya mwanzo')}</p>}
            </div>
          )}
        </div>

        {error && <p role="alert" className="rounded-field bg-bad-bg px-3.5 py-2 text-[13px] font-medium text-bad-fg">{error}</p>}
        <div className="grid grid-cols-2 gap-3">
          <Button variant="outline" onClick={onClose}>{tr('Ghairi')}</Button>
          <Button loading={busy} disabled={disabled} onClick={() => void generate()}>{busy ? tr('Inatengeneza…') : tr('Pakua PDF')}</Button>
        </div>
      </div>
    </Modal>
  );
}

export function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cx(
        'min-h-[38px] rounded-chip border px-3.5 text-[13px] font-semibold',
        active ? 'border-primary bg-primary-tint text-primary-link' : 'border-line bg-white text-body',
      )}
    >
      {children}
    </button>
  );
}
