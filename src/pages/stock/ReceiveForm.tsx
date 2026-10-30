import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PAYMENT_LABEL, PAYMENT_METHODS, type PaymentMethod } from '@shared/constants';
import { luhnValid } from '@shared/sales';
import { parseImeis, validatePurchase, type PurchaseInput } from '@shared/stock';
import { useAuth } from '@/lib/auth';
import { todayDar } from '@/lib/dar';
import { formatNumber, formatTZS } from '@/lib/format';
import { listProducts } from '@/mock/api';
import { allImeis, createPurchase, listSuppliers, saveSupplier } from '@/mock/inventory';
import Modal from '@/components/Modal';
import { CreateProductForm } from '@/pages/Products';
import { Badge, Button, Card, Field, Spinner, cx } from '@/components/ui';
import { Stepper } from '../pos/Cart';
import { tr } from '@/i18n';

interface Line {
  productId: number;
  qty: number;
  unitCost: string;
  imeis: string[];
}

const todayIso = () => todayDar();
const shortImei = (i: string) => `${i.slice(0, 2)} ${i.slice(2, 5)} ${i.slice(5, 6)}…${i.slice(-4)}`;
const digits = (s: string) => Number(s.replace(/\D/g, '')) || 0;

export default function ReceiveForm({ location }: { location: 'STORE' | 'SHOP' }) {
  const { user, isOwner } = useAuth();
  const role = user!.role;
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const { data: products } = useQuery({ queryKey: ['products', role], queryFn: () => listProducts(role) });
  const { data: suppliers } = useQuery({ queryKey: ['supplier-list'], queryFn: listSuppliers });

  const [supplierId, setSupplierId] = useState<number | null>(Number(params.get('supplier')) || null);
  const [invoiceNo, setInvoiceNo] = useState('');
  const [date, setDate] = useState(todayIso());
  const [lines, setLines] = useState<Line[]>([]);
  const [payMode, setPayMode] = useState<'all' | 'owe'>('owe');
  const [paid, setPaid] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [scan, setScan] = useState('');
  const [scanFor, setScanFor] = useState<number | null>(null);
  const [scanError, setScanError] = useState('');
  const [done, setDone] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [createdMsg, setCreatedMsg] = useState<(() => string) | ''>('');
  const [newSupplier, setNewSupplier] = useState<string | null>(null);

  const byId = useMemo(() => new Map((products ?? []).map((p) => [p.id, p])), [products]);

  const total = lines.reduce((a, l) => a + l.qty * digits(l.unitCost), 0);
  // Supplier payments belong to a named supplier; without one there is nothing to pay or owe.
  const paidNow = !isOwner || !supplierId ? 0 : payMode === 'all' ? total : Math.min(digits(paid), total);

  const input: PurchaseInput | null = products
    ? {
        supplierId,
        invoiceNo,
        date,
        location,
        lines: lines.map((l) => {
          const p = byId.get(l.productId)!;
          return { productId: l.productId, name: p.name, type: p.type, qty: l.qty, unitCost: digits(l.unitCost), imeis: l.imeis };
        }),
        paidNow,
        method,
      }
    : null;
  // The mock reads known IMEIs directly; the real API checks uniqueness inside the transaction.
  const verdict = input && validatePurchase(input, { knownImeis: allImeis(), today: todayIso() });
  const errors = verdict && !verdict.ok ? verdict.errors : [];

  const save = useMutation({
    mutationFn: () => createPurchase(user!, input!),
    onSuccess: ({ purchaseId }) => {
      for (const k of ['products', 'store-feed', 'store-dashboard', 'suppliers', 'store-imeis', 'pos-products', 'movements']) void qc.invalidateQueries({ queryKey: [k] });
      setDone(purchaseId);
      setCreatedMsg('');
      setLines([]);
      setInvoiceNo('');
      setPaid('');
      setPayMode('owe');
    },
  });

  const addSupplier = useMutation({
    mutationFn: (name: string) => saveSupplier(role, { name, phone: '' }),
    onSuccess: (sup) => {
      void qc.invalidateQueries({ queryKey: ['supplier-list'] });
      void qc.invalidateQueries({ queryKey: ['suppliers'] });
      setSupplierId(sup.id);
      setNewSupplier(null);
    },
  });

  if (!products || !suppliers) return <Spinner variant="form" />;

  const patchLine = (productId: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.productId === productId ? { ...l, ...patch } : l)));
  const addProduct = (id: number) => {
    const p = byId.get(id);
    if (!p || lines.some((l) => l.productId === id)) return;
    setLines((ls) => [...ls, { productId: id, qty: 1, unitCost: '', imeis: [] }]);
    if (p.type === 'phone') setScanFor(id);
    setDone(null);
  };

  const addScanned = (productId: number, text: string) => {
    const line = lines.find((l) => l.productId === productId)!;
    const tokens = parseImeis(text);
    if (tokens.length === 0) return;
    const known = allImeis();
    const next = [...line.imeis];
    let err = '';
    for (const t of tokens) {
      if (!luhnValid(t)) err = `IMEI ${t} si sahihi`;
      else if (next.includes(t) || lines.some((l) => l.imeis.includes(t))) err = `IMEI ${t} imeshaingizwa`;
      else if (known.has(t)) err = `IMEI ${t} tayari ipo kwenye mfumo`;
      else next.push(t);
    }
    setScanError(err);
    patchLine(productId, { imeis: next, qty: Math.max(line.qty, next.length) });
    if (!err) setScan('');
  };

  const phoneLines = lines.filter((l) => byId.get(l.productId)?.type === 'phone');
  const target = location === 'STORE' ? tr('Store') : 'Duka';
  const activeScan = scanFor && lines.some((l) => l.productId === scanFor) ? scanFor : (phoneLines[0]?.productId ?? null);

  return (
    <div className="grid gap-6 wide:grid-cols-[1fr_320px]">
      <div className="min-w-0 space-y-5">
        {done && (
          <p role="status" className="rounded-field bg-ok-bg px-4 py-3 text-[14px] font-medium text-ok-fg">
            Mzigo umehifadhiwa na stock ya {target} imeongezeka.{' '}
            <Link to={location === 'STORE' ? '/store' : '/products'} className="underline">{tr('Angalia stock')}</Link>
          </p>
        )}

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Supplier (hiari)">
            <select
              className="input"
              value={supplierId ?? ''}
              onChange={(e) => (e.target.value === 'new' ? setNewSupplier('') : setSupplierId(Number(e.target.value) || null))}
            >
              <option value="">{tr('Bila supplier')}</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
              {isOwner && <option value="new">{tr('+ Supplier mpya')}</option>}
            </select>
          </Field>
          <Field label="Namba ya invoice (hiari)">
            <input className="input" placeholder="INV-0231" value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} />
          </Field>
          <Field label="Tarehe">
            <input type="date" className="input" max={todayIso()} value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </div>
        {newSupplier !== null && (
          <div className="flex flex-col gap-2 rounded-field border border-line bg-white p-3 sm:flex-row">
            <input className="input flex-1" autoFocus placeholder={tr('Jina la supplier')} value={newSupplier} onChange={(e) => setNewSupplier(e.target.value)} />
            <div className="flex gap-2">
              <Button loading={addSupplier.isPending}
                disabled={newSupplier.trim().length < 2 || addSupplier.isPending}
                onClick={() => addSupplier.mutate(newSupplier)}
              >
                {tr('Hifadhi')}
              </Button>
              <Button variant="outline" onClick={() => setNewSupplier(null)}>{tr('Ghairi')}</Button>
            </div>
            {addSupplier.isError && <p role="alert" className="text-[12.5px] font-medium text-bad-fg">{tr((addSupplier.error as Error).message)}</p>}
          </div>
        )}
        {createdMsg && <p role="status" className="rounded-field bg-ok-bg px-4 py-3 text-[13.5px] font-medium text-ok-fg">{createdMsg()}</p>}

        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 p-4">
            <h2 className="text-[15px] font-bold">{tr('Bidhaa')}</h2>
            <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            <Button type="button" variant="soft" className="min-h-[38px] px-3 text-[13.5px]" onClick={() => setCreating(true)}>
              {tr('+ Bidhaa mpya')}
            </Button>
            <select
              aria-label={tr('Ongeza mstari')}
              className="min-h-[38px] rounded-field border border-dashed border-primary bg-primary-tint px-3 text-[13.5px] font-semibold text-primary-link"
              value=""
              onChange={(e) => addProduct(Number(e.target.value))}
            >
              <option value="">{tr('+ Ongeza mstari')}</option>
              {products.filter((p) => !lines.some((l) => l.productId === p.id)).map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            </div>
          </div>
          {lines.length === 0 ? (
            <p className="border-t border-line-soft p-6 text-center text-[13.5px] text-muted">{tr('Ongeza bidhaa zilizoletwa na supplier.')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-[14px]">
                <thead>
                  <tr className="bg-app/60 text-left text-[13px] text-muted">
                    <th className="px-4 py-2.5 font-medium">{tr('Bidhaa')}</th>
                    <th className="py-2.5 font-medium">{tr('Idadi')}</th>
                    {isOwner && <th className="py-2.5 text-right font-medium">{tr('Bei ya kununua')}</th>}
                    {isOwner && <th className="px-4 py-2.5 text-right font-medium">{tr('Jumla')}</th>}
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => {
                    const p = byId.get(l.productId)!;
                    return (
                      <tr key={l.productId} className="border-t border-line-soft align-middle">
                        <td className="px-4 py-3">
                          <p className="font-semibold">{p.name}</p>
                          <p className="text-[12.5px] text-muted">{p.type === 'phone' ? tr('Simu') : tr('Accessory')}</p>
                          <button type="button" className="text-[12px] font-semibold text-bad-fg" onClick={() => setLines((ls) => ls.filter((x) => x.productId !== l.productId))}>
                            {tr('Ondoa')}
                          </button>
                        </td>
                        <td>
                          <Stepper
                            qty={l.qty}
                            onMinus={() => patchLine(l.productId, { qty: Math.max(1, l.qty - 1) })}
                            onPlus={() => patchLine(l.productId, { qty: l.qty + 1 })}
                          />
                        </td>
                        {isOwner && (
                          <td className="text-right">
                            <input
                              aria-label={tr(`Bei ya kununua ${p.name}`)}
                              className="input !min-h-[38px] w-28 text-right"
                              inputMode="numeric"
                              placeholder={tr('TSh')}
                              value={l.unitCost}
                              onChange={(e) => patchLine(l.productId, { unitCost: e.target.value.replace(/\D/g, '') })}
                            />
                          </td>
                        )}
                        {isOwner && <td className="px-4 text-right font-bold">{formatTZS(l.qty * digits(l.unitCost))}</td>}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {phoneLines.length > 0 && activeScan && (
          <Card className="p-5">
            <div className="flex flex-wrap gap-2">
              {phoneLines.map((l) => (
                <button
                  key={l.productId}
                  type="button"
                  onClick={() => { setScanFor(l.productId); setScanError(''); }}
                  className={cx('rounded-chip border px-3 py-1.5 text-[13px] font-semibold', activeScan === l.productId ? 'border-primary bg-primary-tint text-primary-link' : 'border-line text-body')}
                >
                  {byId.get(l.productId)!.name} · {l.imeis.length}/{l.qty}
                </button>
              ))}
            </div>
            {(() => {
              const l = lines.find((x) => x.productId === activeScan)!;
              const pct = Math.min(100, Math.round((l.imeis.length / Math.max(1, l.qty)) * 100));
              return (
                <>
                  <h3 className="mt-4 text-[15px] font-bold">IMEI za {byId.get(l.productId)!.name}</h3>
                  <p className="text-[12.5px] text-muted">{tr('Scan au andika kila simu. Zimeingizwa {a} kati ya {b}.', { a: l.imeis.length, b: l.qty })}</p>
                  <div className="mt-3 flex gap-2">
                    <input
                      aria-label="IMEI"
                      className="input font-mono"
                      inputMode="numeric"
                      placeholder={tr('IMEI ya tarakimu 15')}
                      value={scan}
                      onChange={(e) => {
                        setScan(e.target.value);
                        if (/[\s,;]$/.test(e.target.value) || parseImeis(e.target.value).some((t) => t.length === 15)) addScanned(l.productId, e.target.value);
                      }}
                      onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addScanned(l.productId, scan))}
                    />
                    <Button variant="soft" onClick={() => addScanned(l.productId, scan)}>{tr('Ongeza')}</Button>
                  </div>
                  {scanError && <p role="alert" className="mt-2 text-[12.5px] font-medium text-bad-fg">{tr(scanError)}</p>}
                  <div className="mt-3.5 relative flex items-center">
                    <div className="h-3.5 flex-1 overflow-hidden rounded-full bg-blue-50/80">
                      <div className="h-full rounded-full bg-gradient-to-r from-blue-300 via-primary to-blue-600 transition-all duration-300" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="ml-2.5 flex h-6 w-11 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-white shadow-sm">
                      {pct}%
                    </span>
                  </div>
                  <ul className="mt-3 flex flex-wrap gap-2">
                    {l.imeis.map((i) => (
                      <li key={i}>
                        <button
                          type="button"
                          title="Bonyeza kuondoa"
                          onClick={() => patchLine(l.productId, { imeis: l.imeis.filter((x) => x !== i) })}
                          className="rounded-chip bg-app px-3 py-1.5 font-mono text-[12.5px] hover:bg-bad-bg"
                        >
                          {shortImei(i)} ×
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              );
            })()}
          </Card>
        )}
      </div>

      <aside className="space-y-4 wide:border-l wide:border-line-soft wide:pl-6">
        <h2 className="text-[18px] font-extrabold">{tr('Muhtasari')}</h2>
        <Card className="space-y-2 p-4 text-[14px]">
          <p className="flex justify-between"><span className="text-muted">{tr('Bidhaa')}</span><b>{lines.length} · vipande {formatNumber(lines.reduce((a, l) => a + l.qty, 0))}</b></p>
          {isOwner && <p className="flex items-baseline justify-between border-t border-line-soft pt-2"><b>{tr('Jumla ya mzigo')}</b><span className="text-[20px] font-extrabold">{formatTZS(total)}</span></p>}
        </Card>

        {isOwner && !supplierId ? (
          <p className="rounded-field bg-app px-4 py-3 text-[13px] text-muted">{tr('Hakuna supplier aliyechaguliwa, kwa hiyo hakuna deni wala malipo ya supplier yatakayorekodiwa.')}</p>
        ) : isOwner ? (
          <>
            <div>
              <p className="label">{tr('Malipo kwa supplier')}</p>
              <div className="grid grid-cols-2 gap-1 rounded-field bg-app p-1" role="tablist">
                {(['all', 'owe'] as const).map((m) => (
                  <button key={m} type="button" role="tab" aria-selected={payMode === m} onClick={() => setPayMode(m)}
                    className={cx('min-h-[40px] rounded-chip text-[13.5px] font-semibold', payMode === m ? 'bg-white shadow-sm' : 'text-muted')}>
                    {m === 'all' ? tr('Nimelipa yote') : tr('Nadaiwa')}
                  </button>
                ))}
              </div>
            </div>
            {payMode === 'owe' && (
              <Field label="Nimelipa (TSh)">
                <input className="input" inputMode="numeric" placeholder="0" value={paid} onChange={(e) => setPaid(e.target.value.replace(/\D/g, ''))} />
              </Field>
            )}
            {paidNow > 0 && (
              <div className="flex flex-wrap gap-2">
                {PAYMENT_METHODS.map((m) => (
                  <button key={m} type="button" aria-pressed={method === m} onClick={() => setMethod(m)}
                    className={cx('min-h-[38px] rounded-chip border px-3 text-[13px] font-semibold', method === m ? 'border-primary bg-primary-tint text-primary-link' : 'border-line text-body')}>
                    {tr(PAYMENT_LABEL[m])}
                  </button>
                ))}
              </div>
            )}
            <p className="flex items-center justify-between rounded-field bg-warn-bg px-4 py-3 text-[13.5px] text-warn-fg">
              <span>{tr('Deni kwa supplier')}</span>
              <b className="text-[16px]">{formatTZS(total - paidNow)}</b>
            </p>
          </>
        ) : (
          <p className="rounded-field bg-app px-4 py-3 text-[13px] text-muted">{tr('Bei na malipo ya supplier yanaingizwa na mmiliki.')}</p>
        )}

        <p className="rounded-field bg-primary-tint px-4 py-3 text-[13px] text-primary-link">
          {tr('Mzigo utaingia')} <Badge tone={location === 'STORE' ? 'navy' : 'blue'}>{target}</Badge>.{' '}
          {location === 'STORE' ? tr('Kuupeleka dukani tumia "Hamisha dukani".') : tr('Store haiguswi.')}
        </p>

        {(lines.length > 0 && errors.length > 0) || save.isError ? (
          <ul role="alert" className="space-y-1 rounded-field bg-bad-bg px-3.5 py-2.5 text-[12.5px] font-medium text-bad-fg">
            {[...(lines.length > 0 ? errors : []), ...(save.isError ? [tr((save.error as Error).message)] : [])].map((e) => <li key={e}>{tr(e)}</li>)}
          </ul>
        ) : null}
        <Button loading={save.isPending} block className="min-h-[52px] text-[15px]" disabled={errors.length > 0 || save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? tr('Inahifadhi…') : tr('Hifadhi mzigo')}
        </Button>
      </aside>

      {creating && (
        <Modal title={tr('Bidhaa mpya')} onClose={() => setCreating(false)} wide>
          <h2 className="mb-3 text-[18px] font-extrabold text-ink">{tr('Bidhaa mpya')}</h2>
          <p className="mb-3 rounded-field bg-primary-tint px-3.5 py-2.5 text-[12.5px] text-primary-link">
            {location === 'STORE' ? tr('Idadi ya awali itaingia Store moja kwa moja, kwa hiyo huhitaji kuiongeza kwenye mzigo hapa chini.') : tr('Idadi ya awali itaingia Dukani moja kwa moja.')}
          </p>
          <CreateProductForm
            hideHeading
            location={location}
            onCancel={() => setCreating(false)}
            onCreated={(_id, created) => {
              for (const k of ['products', 'store-feed', 'store-dashboard', 'store-imeis', 'pos-products', 'movements']) void qc.invalidateQueries({ queryKey: [k] });
              setCreating(false);
              setDone(null);
              setCreatedMsg(() => () => tr('Bidhaa mpya "{1}" imesajiliwa na vipande {2} vimeongezwa {3}.', { 1: created.name, 2: created.initialShopQty, 3: location === 'STORE' ? 'Store' : 'Dukani' }));
            }}
          />
        </Modal>
      )}
    </div>
  );
}
