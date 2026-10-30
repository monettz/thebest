import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PAYMENT_LABEL, PAYMENT_METHODS, type PaymentMethod } from '@shared/constants';
import { planReturn, planVoid, type ReturnItem, type SaleSnapshot } from '@shared/returns';
import { useAuth } from '@/lib/auth';
import { displayPhone, formatDate, formatTZS } from '@/lib/format';
import { getSaleDetail, returnItems, voidSale } from '@/mock/sales';
import { Badge, Button, Card, PageHeader, Spinner, cx } from '@/components/ui';
import { SaleStatusBadge } from './Sales';
import { tr } from '@/i18n';

type Panel = 'none' | 'return' | 'void';

export default function SaleDetail() {
  const { saleId } = useParams();
  const { user, isOwner } = useAuth();
  const qc = useQueryClient();
  const { data: sale } = useQuery({ queryKey: ['sale', saleId], queryFn: () => getSaleDetail(Number(saleId)) });
  const [panel, setPanel] = useState<Panel>('none');
  const [qty, setQty] = useState<Record<number, number>>({});
  const [reason, setReason] = useState('');
  const [condition, setCondition] = useState<'RESTOCK' | 'DAMAGED'>('RESTOCK');
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [done, setDone] = useState('');

  const snapshot: SaleSnapshot | null | undefined = useMemo(
    () =>
      sale && {
        status: sale.status,
        subtotal: sale.subtotal,
        total: sale.total,
        paidNet: sale.netPaid,
        returnedValue: sale.returnedValue,
        lines: sale.lines.map((l) => ({ qty: l.qty, unitPrice: l.unitPrice, imei: l.imei, returnedQty: l.returnedQty })),
      },
    [sale],
  );

  const refresh = () => {
    for (const k of ['sale', 'sales', 'debts', 'customers', 'customer', 'products', 'pos-products']) void qc.invalidateQueries({ queryKey: [k] });
  };
  const reset = () => {
    setPanel('none');
    setQty({});
    setReason('');
    setCondition('RESTOCK');
  };

  const items: ReturnItem[] = Object.entries(qty).map(([lineIndex, q]) => ({ lineIndex: Number(lineIndex), qty: q }));
  const retPlan = snapshot && planReturn(snapshot, items, reason);
  const voidPlan = snapshot && user ? planVoid(snapshot, user.role, reason) : null;

  const doReturn = useMutation({
    mutationFn: () => returnItems(user!, { saleId: sale!.id, items, reason, condition, refundMethod: method }),
    onSuccess: ({ refund }) => {
      refresh();
      reset();
      setDone(refund > 0 ? `Bidhaa imerudishwa. Rudisha pesa: ${formatTZS(refund)}.` : tr('Bidhaa imerudishwa. Deni limepunguzwa.'));
    },
  });
  const doVoid = useMutation({
    mutationFn: () => voidSale(user!, { saleId: sale!.id, reason, refundMethod: method }),
    onSuccess: () => {
      refresh();
      reset();
      setDone('Mauzo yamefutwa. Stock imerudishwa na pesa zimerekodiwa kama marejesho.');
    },
  });

  if (!sale || !snapshot) return <Spinner variant="form" />;
  const isVoid = sale.status === 'VOID';
  const canReturn = !isVoid && sale.lines.some((l) => l.qty - l.returnedQty > 0);
  const refundNow = panel === 'return' ? (retPlan?.ok ? retPlan.refund : 0) : voidPlan?.ok ? voidPlan.refund : 0;
  const errors = panel === 'return' ? (retPlan && !retPlan.ok ? retPlan.errors : []) : voidPlan && !voidPlan.ok ? voidPlan.errors : [];
  const busy = doReturn.isPending || doVoid.isPending;
  const serverError = ((doReturn.error ?? doVoid.error) as Error | null)?.message;

  return (
    <>
      <PageHeader
        title={sale.receiptNo}
        badge={<SaleStatusBadge status={sale.status} hasReturns={sale.returns.length > 0} />}
        subtitle={`${formatDate(new Date(sale.createdAt))} · ${sale.userName} · ${sale.customer ? `${sale.customer.name} ${displayPhone(sale.customer.phone)}` : tr('Mteja wa kawaida')}`}
        actions={
          <Link to={`/receipts/${sale.id}`} className="inline-flex min-h-touch items-center rounded-field border border-line px-4 text-[14px] font-semibold text-primary-link">
            {tr('Risiti')}
          </Link>
        }
      />
      {done && <p role="status" className="mb-4 rounded-field bg-ok-bg px-4 py-2.5 text-[13.5px] font-medium text-ok-fg">{tr(done)}</p>}
      {sale.voided && (
        <p className="mb-4 rounded-field bg-bad-bg px-4 py-2.5 text-[13.5px] text-bad-fg">
          <b>{tr('Imefutwa')}</b> na {sale.voided.by} · {formatDate(new Date(sale.voided.at))} · Sababu: {sale.voided.reason}
        </p>
      )}

      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        <div className="min-w-0 space-y-5">
          <Card className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-[14px]">
              <thead>
                <tr className="bg-slate-50/80 text-left text-[11.5px] font-bold uppercase tracking-wider text-slate-500">
                  <th className="px-5 py-3.5">{tr('Bidhaa')}</th>
                  <th className="py-3.5 text-right">{tr('Idadi')}</th>
                  <th className="py-3.5 text-right">{tr('Bei')}</th>
                  <th className="px-5 py-3.5 text-right">{tr('Rudisha')}</th>
                </tr>
              </thead>
              <tbody>
                {sale.lines.map((l) => {
                  const left = l.qty - l.returnedQty;
                  return (
                    <tr key={l.index} className="border-t border-line-soft transition hover:bg-slate-50/70">
                      <td className="px-4 py-3">
                        <p className="font-semibold">{l.name}</p>
                        {l.imei && <p className="font-mono text-[12px] text-muted">IMEI {l.imei}</p>}
                        {l.returnedQty > 0 && <Badge tone="blue" className="mt-1">Imerudishwa {l.returnedQty}</Badge>}
                      </td>
                      <td className="text-right">{l.qty}</td>
                      <td className="text-right">{formatTZS(l.unitPrice)}</td>
                      <td className="px-4 text-right">
                        {panel === 'return' && left > 0 ? (
                          <input
                            aria-label={tr(`Idadi ya kurudisha ${l.name}`)}
                            className="input !min-h-[38px] w-20 text-right"
                            inputMode="numeric"
                            value={qty[l.index] ?? ''}
                            placeholder="0"
                            onChange={(e) => setQty({ ...qty, [l.index]: Math.min(left, Number(e.target.value.replace(/\D/g, '')) || 0) })}
                          />
                        ) : (
                          <span className="text-muted">{left > 0 ? '–' : 'Zote'}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <dl className="space-y-1.5 border-t border-line-soft p-4 text-[14px]">
              <Row label="Jumla ndogo" value={formatTZS(sale.subtotal)} />
              {sale.discount > 0 && <Row label="Punguzo" value={`-${formatTZS(sale.discount)}`} />}
              {sale.returnedValue > 0 && <Row label="Zilizorudishwa" value={`-${formatTZS(sale.returnedValue)}`} />}
              <Row label="Zilizolipwa (baada ya marejesho)" value={formatTZS(sale.netPaid)} />
              {sale.balance > 0 && <Row label="Deni linabaki" value={formatTZS(sale.balance)} tone="warn" />}
            </dl>
          </Card>

          <Card className="p-5">
            <h2 className="mb-2 text-[15px] font-bold">{tr('Malipo')}</h2>
            <ul className="divide-y divide-line-soft text-[14px]">
              {sale.payments.map((p, i) => (
                <li key={i} className="flex items-center justify-between py-2.5">
                  <span>
                    {tr(PAYMENT_LABEL[p.method])} · <span className="text-muted">{tr(p.kind === 'REFUND' ? 'Marejesho' : p.kind === 'DEBT' ? 'Malipo ya deni' : 'Wakati wa mauzo')} · {formatDate(new Date(p.paidAt))}</span>
                  </span>
                  <b className={cx(p.amount < 0 && 'text-bad-fg')}>{p.amount < 0 ? `-${formatTZS(-p.amount)}` : formatTZS(p.amount)}</b>
                </li>
              ))}
              {sale.payments.length === 0 && <li className="py-2.5 text-muted">{tr('Hakuna malipo yaliyorekodiwa.')}</li>}
            </ul>
          </Card>

          {sale.returns.length > 0 && (
            <Card className="p-5">
              <h2 className="mb-2 text-[15px] font-bold">{tr('Historia ya marejesho')}</h2>
              <ul className="divide-y divide-line-soft text-[13.5px]">
                {sale.returns.map((r) => (
                  <li key={r.id} className="py-2.5">
                    <p>
                      <b>{formatTZS(r.value)}</b> · {r.condition === 'DAMAGED' ? tr('Imeharibika') : tr('Imerudi stock')} · {formatDate(new Date(r.at))} · {r.by}
                    </p>
                    <p className="text-muted">Sababu: {r.reason}{r.refund > 0 && ` · Pesa zilizorudishwa ${formatTZS(r.refund)}`}</p>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        <aside className="space-y-4">
          {panel === 'none' ? (
            <Card className="space-y-3 p-5">
              <h2 className="text-[15px] font-bold">{tr('Hatua')}</h2>
              <Button block variant="outline" disabled={!canReturn} onClick={() => { setDone(''); setPanel('return'); }}>
                {tr('Rudisha bidhaa')}
              </Button>
              {isOwner ? (
                <Button block variant="outline" className="!text-bad-fg" disabled={isVoid} onClick={() => { setDone(''); setPanel('void'); }}>
                  {tr('Futa mauzo')}
                </Button>
              ) : (
                <p className="text-[12.5px] text-muted">{tr('Mmiliki tu ndiye anaweza kufuta mauzo.')}</p>
              )}
            </Card>
          ) : (
            <Card className="space-y-4 p-5">
              <h2 className="text-[16px] font-extrabold">{panel === 'return' ? tr('Rudisha bidhaa') : tr('Futa mauzo')}</h2>
              {panel === 'return' ? (
                <p className="text-[13px] text-muted">{tr('Weka idadi ya kurudisha kwenye jedwali upande wa kushoto.')}</p>
              ) : (
                <p className="rounded-field bg-bad-bg px-3 py-2 text-[13px] text-bad-fg">
                  Mauzo hayafutwi kabisa: yanabaki kwenye ripoti kama "Imefutwa". Stock inarudi na pesa zilizolipwa zinarejeshwa.
                </p>
              )}
              <label className="block">
                <span className="label">{tr('Sababu (lazima)')}</span>
                <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={tr('Mfano: simu ina hitilafu')} />
              </label>
              {panel === 'return' && (
                <div className="grid grid-cols-2 gap-1 rounded-field bg-app p-1" role="tablist">
                  {(['RESTOCK', 'DAMAGED'] as const).map((c) => (
                    <button key={c} type="button" role="tab" aria-selected={condition === c} onClick={() => setCondition(c)}
                      className={cx('min-h-[40px] rounded-chip text-[13.5px] font-semibold', condition === c ? 'bg-white shadow-sm' : 'text-muted')}>
                      {c === 'RESTOCK' ? tr('Rudi stock') : tr('Imeharibika')}
                    </button>
                  ))}
                </div>
              )}
              {refundNow > 0 && (
                <div>
                  <p className="label">{tr('Rudisha pesa kwa')}</p>
                  <div className="flex flex-wrap gap-2">
                    {PAYMENT_METHODS.map((m) => (
                      <button key={m} type="button" aria-pressed={method === m} onClick={() => setMethod(m)}
                        className={cx('min-h-[38px] rounded-chip border px-3 text-[13px] font-semibold', method === m ? 'border-primary bg-primary-tint text-primary-link' : 'border-line bg-white text-body')}>
                        {tr(PAYMENT_LABEL[m])}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="rounded-field border border-line-soft p-3.5 text-[14px]">
                {panel === 'return' && retPlan?.ok && (
                  <>
                    <Row label="Thamani ya bidhaa" value={formatTZS(retPlan.value)} />
                    <Row label="Deni litakalobaki" value={formatTZS(retPlan.newBalance)} />
                  </>
                )}
                <Row label="Pesa za kurudisha" value={formatTZS(refundNow)} tone={refundNow > 0 ? 'bad' : undefined} />
              </div>
              {(errors.length > 0 || serverError) && (
                <ul role="alert" className="space-y-1 rounded-field bg-bad-bg px-3.5 py-2.5 text-[12.5px] font-medium text-bad-fg">
                  {[...errors, ...(serverError ? [serverError] : [])].map((e) => <li key={e}>{tr(e)}</li>)}
                </ul>
              )}
              <div className="grid grid-cols-2 gap-3">
                <Button variant="outline" onClick={reset}>{tr('Ghairi')}</Button>
                <Button loading={busy}
                  disabled={errors.length > 0 || busy}
                  className={panel === 'void' ? '!bg-bad-fg hover:!bg-red-800' : ''}
                  onClick={() => (panel === 'return' ? doReturn.mutate() : doVoid.mutate())}
                >
                  {panel === 'return' ? tr('Thibitisha') : tr('Futa mauzo')}
                </Button>
              </div>
            </Card>
          )}
        </aside>
      </div>
    </>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: 'warn' | 'bad' }) {
  return (
    <div className={cx('flex justify-between py-0.5', tone === 'warn' && 'text-warn-fg', tone === 'bad' && 'text-bad-fg')}>
      <dt>{tr(label)}</dt>
      <dd className="font-semibold">{value}</dd>
    </div>
  );
}
