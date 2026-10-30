import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { COUNT_REASONS, COUNT_REASON_LABEL, difference, shortageValue, validateCount, type CountLine, type CountReason } from '@shared/stocktake';
import { useAuth } from '@/lib/auth';
import { useLocationCode } from '@/lib/location';
import { formatDate, formatTZS } from '@/lib/format';
import { internalProducts } from '@/mock/api';
import { approveStockTake, getCountSheet, listStockTakes, submitStockTake, type StockTakeRow } from '@/mock/stocktake';
import type { Loc } from '@/mock/api';
import { Badge, Button, Card, PageHeader, Spinner, cx } from '@/components/ui';
import { Stepper } from '../pos/Cart';
import { tr } from '@/i18n';

const shortImei = (i: string) => `${i.slice(0, 2)} ${i.slice(2, 5)} ${i.slice(5, 6)}…${i.slice(-4)}`;
const LOC_LABEL: Record<Loc, string> = { STORE: 'Store', SHOP: 'Duka' };

export default function StockTake() {
  const { user, isOwner } = useAuth();
  const qc = useQueryClient();
  const { code } = useLocationCode();
  const location: Loc = code;
  const { data: sheet } = useQuery({ queryKey: ['count-sheet', location], queryFn: () => getCountSheet(location), staleTime: 0 });
  const { data: takes } = useQuery({ queryKey: ['stock-takes', user?.role], queryFn: () => listStockTakes(user!.role) });
  const [lines, setLines] = useState<CountLine[]>([]);
  const [done, setDone] = useState('');

  useEffect(() => {
    if (sheet) setLines(sheet);
  }, [sheet]);

  const submit = useMutation({
    mutationFn: () => submitStockTake(user!, { location, lines }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['stock-takes'] });
      void qc.invalidateQueries({ queryKey: ['count-sheet'] });
      setDone('Hesabu imetumwa kwa mmiliki kwa idhini.');
    },
  });

  if (!sheet || !takes) return <Spinner variant="table" />;

  const patch = (productId: number, change: Partial<CountLine>) => {
    setDone('');
    setLines((ls) => ls.map((l) => (l.productId === productId ? { ...l, ...change } : l)));
  };
  const setCounted = (l: CountLine, counted: number) => {
    const next = Math.max(0, counted);
    // A phone count that goes back up (or changes) drops picks that no longer fit the shortage.
    const missing = (l.missingImeis ?? []).slice(0, Math.max(0, l.systemQty - next));
    patch(l.productId, { countedQty: next, missingImeis: missing, reason: next === l.systemQty ? undefined : l.reason });
  };

  const diffLines = lines.filter((l) => difference(l) !== 0);
  const costs = Object.fromEntries(internalProducts().map((p) => [p.id, p.costPrice]));
  const errors = validateCount(lines);

  return (
    <>
      <PageHeader
        title="Kuhesabu stock"
        badge={<Badge tone="navy">{tr(LOC_LABEL[location])}</Badge>}
        subtitle="Hesabu bidhaa zilizopo kwa mkono, weka tofauti na sababu, kisha mtumie mmiliki aidhinishe."
      />

      <div className="rounded-[20px] border border-line bg-white shadow-sm overflow-hidden mb-6">
        <div className={cx('grid divide-y divide-line-soft sm:divide-y-0 sm:divide-x', isOwner ? 'sm:grid-cols-3' : 'sm:grid-cols-2')}>
          <div className="p-5">
            <p className="text-[13px] font-medium text-muted">{tr('Bidhaa')}</p>
            <p className="mt-2 text-[26px] font-extrabold tracking-tight text-ink tabular-nums">{lines.length}</p>
            <p className="mt-2 text-[12px] text-muted">{tr('jumla ya aina za bidhaa')}</p>
          </div>
          <div className="p-5">
            <p className="text-[13px] font-medium text-muted">{tr('Zenye tofauti')}</p>
            <p className={cx('mt-2 text-[26px] font-extrabold tracking-tight tabular-nums', diffLines.length > 0 ? 'text-warn-fg' : 'text-ok-fg')}>
              {diffLines.length}
            </p>
            <p className="mt-2 text-[12px] text-muted">{diffLines.length === 0 ? 'hesabu inalingana' : 'zinahitaji uhakiki'}</p>
          </div>
          {isOwner && (
            <div className={cx('p-5', shortageValue(lines, costs) > 0 ? 'bg-rose-50/40' : '')}>
              <p className={cx('text-[13px] font-medium', shortageValue(lines, costs) > 0 ? 'text-rose-800' : 'text-muted')}>
                {tr('Thamani ya upungufu')}
              </p>
              <p className={cx('mt-2 text-[26px] font-extrabold tracking-tight tabular-nums', shortageValue(lines, costs) > 0 ? 'text-bad-fg' : 'text-ok-fg')}>
                {formatTZS(shortageValue(lines, costs))}
              </p>
              <p className="mt-2 text-[12px] text-muted">{tr('kwa bei ya ununuzi')}</p>
            </div>
          )}
        </div>
      </div>

      {/* Phones: one card per product */}
      <ul className="mt-4 space-y-3 md:hidden">
        {lines.map((l) => {
          const diff = difference(l);
          return (
            <li key={l.productId} className="card p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold">{l.name}</p>
                  <p className="text-[12.5px] text-muted">{l.type === 'phone' ? tr('Simu') : tr('Accessory')} · mfumo {l.systemQty}</p>
                </div>
                <b className={cx('text-[18px]', diff < 0 ? 'text-bad-fg' : diff > 0 ? 'text-ok-fg' : 'text-muted')}>{diff > 0 ? `+${diff}` : diff}</b>
              </div>
              <div className="mt-3 flex items-center justify-between gap-3">
                <Stepper qty={l.countedQty} onMinus={() => setCounted(l, l.countedQty - 1)} onPlus={() => setCounted(l, l.countedQty + 1)} />
                {diff !== 0 && (
                  <select
                    aria-label={tr(`Sababu ya tofauti ya ${l.name}`)}
                    className="input !min-h-[40px] w-40"
                    value={l.reason ?? ''}
                    onChange={(e) => patch(l.productId, { reason: (e.target.value || undefined) as CountReason | undefined })}
                  >
                    <option value="">{tr('Chagua sababu…')}</option>
                    {COUNT_REASONS.map((r) => <option key={r} value={r}>{tr(COUNT_REASON_LABEL[r])}</option>)}
                  </select>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <Card className="mt-4 overflow-hidden max-md:!border-0 max-md:!bg-transparent">
        <table className="hidden w-full text-[14px] md:table">
          <thead>
            <tr className="bg-app/60 text-left text-[13px] text-muted">
              <th className="px-4 py-2.5 font-medium">{tr('Bidhaa')}</th>
              <th className="py-2.5 text-right font-medium">{tr('Mfumo')}</th>
              <th className="px-6 py-2.5 font-medium">{tr('Uliyohesabu')}</th>
              <th className="py-2.5 text-right font-medium">{tr('Tofauti')}</th>
              <th className="px-4 py-2.5 font-medium">{tr('Sababu')}</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => {
              const diff = difference(l);
              return (
                <tr key={l.productId} className="border-t border-line-soft align-top">
                  <td className="px-4 py-3">
                    <p className="font-semibold">{l.name}</p>
                    <p className="text-[12.5px] text-muted">{l.type === 'phone' ? tr('Simu') : tr('Accessory')}</p>
                  </td>
                  <td className="py-3 text-right font-bold">{l.systemQty}</td>
                  <td className="px-6 py-3"><Stepper qty={l.countedQty} onMinus={() => setCounted(l, l.countedQty - 1)} onPlus={() => setCounted(l, l.countedQty + 1)} /></td>
                  <td className={cx('py-3 text-right font-bold', diff < 0 ? 'text-bad-fg' : diff > 0 ? 'text-ok-fg' : 'text-muted')}>{diff > 0 ? `+${diff}` : diff}</td>
                  <td className="px-4 py-3">
                    {diff !== 0 && (
                      <select
                        aria-label={tr(`Sababu ya tofauti ya ${l.name}`)}
                        className="input !min-h-[38px] w-40"
                        value={l.reason ?? ''}
                        onChange={(e) => patch(l.productId, { reason: (e.target.value || undefined) as CountReason | undefined })}
                      >
                        <option value="">{tr('Chagua sababu…')}</option>
                        {COUNT_REASONS.map((r) => <option key={r} value={r}>{tr(COUNT_REASON_LABEL[r])}</option>)}
                      </select>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {lines.filter((l) => l.type === 'phone' && difference(l) < 0).map((l) => (
          <div key={l.productId} className="border-t border-line-soft p-4">
            <p className="text-[13.5px] font-semibold">{tr('{name}: IMEI zisizopatikana (hiari, hadi {n}) ({a}/{n})', { name: l.name, n: -difference(l), a: l.missingImeis?.length ?? 0 })}</p>
            <ul className="mt-2 flex max-h-36 flex-wrap gap-2 overflow-y-auto">
              {(l.systemImeis ?? []).map((imei) => {
                const picked = l.missingImeis?.includes(imei) ?? false;
                return (
                  <li key={imei}>
                    <button
                      type="button"
                      aria-pressed={picked}
                      onClick={() => patch(l.productId, { missingImeis: picked ? l.missingImeis!.filter((i) => i !== imei) : [...(l.missingImeis ?? []), imei] })}
                      className={cx('rounded-chip border px-3 py-1.5 font-mono text-[12.5px]', picked ? 'border-bad-fg bg-bad-bg text-bad-fg' : 'border-line bg-white text-body')}
                    >
                      {shortImei(imei)}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </Card>

      {done && <p role="status" className="mt-4 rounded-field bg-ok-bg px-4 py-3 text-[14px] font-medium text-ok-fg">{tr(done)}</p>}
      {diffLines.length > 0 && errors.length > 0 && (
        <ul role="alert" className="mt-4 space-y-1 rounded-field bg-bad-bg px-3.5 py-2.5 text-[12.5px] font-medium text-bad-fg">
          {errors.map((e) => <li key={e}>{tr(e)}</li>)}
        </ul>
      )}
      {submit.isError && <p role="alert" className="mt-4 rounded-field bg-bad-bg px-3.5 py-2.5 text-[12.5px] font-medium text-bad-fg">{tr((submit.error as Error).message)}</p>}
      <div className="mt-4 flex justify-end gap-3">
        <Button variant="outline" onClick={() => { setLines(sheet); setDone(''); }}>{tr('Anza upya')}</Button>
        <Button loading={submit.isPending} disabled={errors.length > 0 || submit.isPending} onClick={() => submit.mutate()}>{tr('Tuma kwa mmiliki')}</Button>
      </div>

      <h2 className="mb-3 mt-8 text-[17px] font-bold">{tr('Hesabu zilizotumwa')}</h2>
      <div className="space-y-3">
        {takes.length === 0 && <p className="text-[13.5px] text-muted">{tr('Bado hakuna hesabu iliyotumwa.')}</p>}
        {takes.map((t) => <TakeCard key={t.id} take={t} isOwner={isOwner} />)}
      </div>
    </>
  );
}

function TakeCard({ take, isOwner }: { take: StockTakeRow; isOwner: boolean }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const approve = useMutation({
    mutationFn: () => approveStockTake(user!, take.id),
    onSuccess: () => {
      for (const k of ['stock-takes', 'count-sheet', 'products', 'movements', 'store-imeis', 'pos-products', 'audit']) void qc.invalidateQueries({ queryKey: [k] });
    },
  });
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center gap-3">
        <Badge tone={take.location === 'STORE' ? 'navy' : 'blue'}>{tr(LOC_LABEL[take.location])}</Badge>
        <span className="text-[13.5px] text-body">{take.createdBy} · {formatDate(new Date(take.createdAt))}</span>
        <span className="flex-1" />
        <Badge tone={take.status === 'APPROVED' ? 'ok' : 'warn'}>{take.status === 'APPROVED' ? (take.approvedBy ? tr('Imeidhinishwa na {name}', { name: take.approvedBy }) : tr('Imeidhinishwa')) : tr('Inasubiri idhini')}</Badge>
      </div>
      <p className="mt-2 text-[13.5px] text-body">
        {take.differences === 0 ? tr('Hakuna tofauti.') : `Tofauti ${take.differences}`}
        {take.shortage !== undefined && take.shortage > 0 && <> · upungufu <b className="text-bad-fg">{formatTZS(take.shortage)}</b></>}
      </p>
      {take.lines.length > 0 && (
        <ul className="mt-2 divide-y divide-line-soft text-[13.5px]">
          {take.lines.map((l) => (
            <li key={l.productId} className="flex justify-between py-1.5">
              <span>{l.name}{l.reason && <span className="text-muted"> · {tr(COUNT_REASON_LABEL[l.reason])}</span>}</span>
              <b className={difference(l) < 0 ? 'text-bad-fg' : 'text-ok-fg'}>{difference(l) > 0 ? `+${difference(l)}` : difference(l)}</b>
            </li>
          ))}
        </ul>
      )}
      {approve.isError && <p role="alert" className="mt-2 rounded-field bg-bad-bg px-3.5 py-2 text-[12.5px] font-medium text-bad-fg">{tr((approve.error as Error).message)}</p>}
      {take.status === 'SUBMITTED' && isOwner && (
        <Button loading={approve.isPending} className="mt-3" disabled={approve.isPending} onClick={() => approve.mutate()}>{tr('Idhinisha na rekebisha stock')}</Button>
      )}
    </Card>
  );
}
