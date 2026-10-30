import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { cashDifference } from '@shared/money';
import { useAuth } from '@/lib/auth';
import { formatDate, formatTZS } from '@/lib/format';
import { closeDay, getCloseDay } from '@/mock/ledger';
import { Button, Spinner } from '@/components/ui';
import { tr } from '@/i18n';

export default function CloseDay({ onClose }: { onClose: () => void }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['close-day'], queryFn: () => getCloseDay() });
  const [counted, setCounted] = useState('');
  const [note, setNote] = useState('');

  const save = useMutation({
    mutationFn: () => closeDay(user!, { counted: Number(counted), note }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['close-day'] }),
  });

  const value = counted === '' ? null : Number(counted);
  const diff = data && value !== null ? cashDifference(value, data.expected) : null;
  const done = data?.closing ?? null;
  const shown = done?.difference ?? diff;

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-navy/50 animate-fade-in sm:items-center" onClick={onClose}>
      <div role="dialog" aria-label={tr('Funga siku')} onClick={(e) => e.stopPropagation()} className="pb-safe max-h-[92vh] w-full max-w-md space-y-4 overflow-y-auto animate-sheet rounded-t-[28px] bg-white p-6 shadow-2xl sm:rounded-[28px]">
        <h2 className="text-[20px] font-extrabold text-ink">{tr('Funga siku')}</h2>
        {!data ? (
          <Spinner variant="list" />
        ) : (
          <>
            <p className="text-[13px] text-muted">{formatDate(new Date(`${data.date}T00:00:00`))} · {tr('Cash tu (Lipa Namba na Bank hazihesabiwi hapa)')}</p>
            <dl className="space-y-1.5 rounded-field border border-line-soft p-4 text-[14px]">
              <Line label="Mauzo ya cash" value={formatTZS(data.parts.cashSales)} />
              <Line label="Malipo ya madeni (cash)" value={formatTZS(data.parts.cashDebtPayments)} />
              <Line label="Marejesho (cash)" value={`-${formatTZS(data.parts.cashRefunds)}`} />
              <Line label="Matumizi (cash)" value={`-${formatTZS(data.parts.cashExpenses)}`} />
              <div className="flex justify-between border-t border-line-soft pt-2 font-bold">
                <dt>{tr('Cash inayotarajiwa')}</dt>
                <dd className="text-[18px]">{formatTZS(data.expected)}</dd>
              </div>
            </dl>

            {done ? (
              <p role="status" className="rounded-field bg-primary-tint px-4 py-3 text-[13.5px] text-primary-link">
                Siku imefungwa na {done.userName}. Uliyehesabu: <b>{formatTZS(done.counted)}</b>.
              </p>
            ) : (
              <>
                <label className="block">
                  <span className="label">{tr('Cash uliyohesabu (TSh)')}</span>
                  <input className="input" inputMode="numeric" autoFocus value={counted} onChange={(e) => setCounted(e.target.value.replace(/\D/g, ''))} />
                </label>
                <label className="block">
                  <span className="label">{tr('Maelezo (hiari)')}</span>
                  <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
                </label>
              </>
            )}

            {shown !== null && (
              <p className={`flex justify-between rounded-field px-4 py-3 text-[14px] font-semibold ${shown === 0 ? 'bg-ok-bg text-ok-fg' : shown < 0 ? 'bg-bad-bg text-bad-fg' : 'bg-warn-bg text-warn-fg'}`}>
                <span>{shown === 0 ? tr('Hesabu inalingana') : shown < 0 ? tr('Upungufu') : tr('Ziada')}</span>
                <b>{formatTZS(Math.abs(shown))}</b>
              </p>
            )}
            {save.isError && <p role="alert" className="rounded-field bg-bad-bg px-3.5 py-2 text-[13px] font-medium text-bad-fg">{tr((save.error as Error).message)}</p>}
            <div className="grid grid-cols-2 gap-3">
              <Button variant="outline" onClick={onClose}>{tr('Funga dirisha')}</Button>
              <Button loading={save.isPending} disabled={!!done || value === null || save.isPending} onClick={() => save.mutate()}>{tr('Hifadhi hesabu')}</Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <dt className="text-body">{tr(label)}</dt>
      <dd className="font-semibold">{value}</dd>
    </div>
  );
}
