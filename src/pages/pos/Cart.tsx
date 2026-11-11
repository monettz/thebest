import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PAYMENT_LABEL, POS_PAYMENT_METHODS, type PaymentMethod } from '@shared/constants';
import { availableImeisForLine, lineTotal, type CartLine } from '@shared/sales';
import { displayPhone, formatDate, formatTZS } from '@/lib/format';
import { useAuth } from '@/lib/auth';
import { checkCustomerDuplicates, saveCustomer, searchCustomers, SimilarCustomerError, type Customer, type PosProduct } from '@/mock/sales';
import { Button, cx } from '@/components/ui';
import { tr } from '@/i18n';

export const digits = (s: string) => Number(s.replace(/\D/g, '')) || 0;

export interface CustomerState {
  selected: Customer | null;
  creating: boolean;
  name: string;
  phone: string;
}

export interface CartState {
  lines: CartLine[];
  customer: CustomerState;
  methods: PaymentMethod[];
  amounts: Partial<Record<PaymentMethod, string>>;
  mode: 'full' | 'debt';
  paid: string; // debt mode, single method
  dueDate: string;
  soldOn: string; // yyyy-mm-dd
  discount: string;
  ownerPin: string;
}

interface Props {
  state: CartState;
  patch: (p: Partial<CartState>) => void;
  products?: PosProduct[];
  total: number;
  subtotal: number;
  discount: number;
  paid: number;
  balance: number;
  errors: string[];
  needsOwnerPin: boolean;
  today: string;
  busy: boolean;
  onQty: (index: number, delta: number) => void;
  onRemove: (index: number) => void;
  onChangeImei?: (index: number, newImei: string) => void;
  onAddPhoneUnit?: (productId: number) => void;
  onClear: () => void;
  onSubmit: () => void;
  onClose?: () => void;
}

export function Cart(p: Props) {
  const { state: s, patch, products = [] } = p;
  const [openImeiIndex, setOpenImeiIndex] = useState<number | null>(null);
  const multi = s.methods.length > 1;
  const itemCount = s.lines.reduce((sum, l) => sum + l.qty, 0);

  const toggleMethod = (m: PaymentMethod) => {
    const has = s.methods.includes(m);
    if (has && s.methods.length === 1) return;
    patch({ methods: has ? s.methods.filter((x) => x !== m) : [...s.methods, m] });
  };

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-white">
      {/* 1. HEADER: Cart title and Clear all action */}
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-[#E2E8F0] bg-white px-4 py-3.5">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="text-[17px] font-bold leading-tight text-[#0F172A]">{tr('Kikapu')}</h2>
          {itemCount > 0 && (
            <span className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-[#2563EB] px-1.5 text-[11px] font-bold text-white">
              {itemCount}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {s.lines.length > 0 && (
            <button
              type="button"
              onClick={p.onClear}
              className="text-[13px] font-semibold text-bad-fg hover:underline"
            >
              {tr('Futa yote')}
            </button>
          )}
          {p.onClose && (
            <button
              type="button"
              onClick={p.onClose}
              aria-label={tr('Funga')}
              className="inline-flex h-8 items-center justify-center rounded-[8px] border border-[#E2E8F0] bg-[#F8FAFC] px-2.5 text-[12.5px] font-semibold text-[#64748B] hover:bg-slate-100 hover:text-[#0F172A]"
            >
              {tr('Funga')}
            </button>
          )}
        </div>
      </header>

      {/* 2. SCROLLABLE CONTENT: Cart items, customer, payment methods, checkout fields */}
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-4 py-4 space-y-4">
        {s.lines.length === 0 ? (
          <p className="rounded-[10px] border border-[#E2E8F0] bg-[#F8FAFC] p-4 text-center text-[13px] text-[#64748B]">
            {tr('Chagua bidhaa au scan IMEI.')}
          </p>
        ) : (
          <ul className="space-y-3">
            {s.lines.map((l, i) => {
              const prod = products.find((x) => x.id === l.productId);
              const availableForLine =
                l.type === 'phone' && prod ? availableImeisForLine(prod.imeis, s.lines, i) : l.imei ? [l.imei] : [];
              const isEditingImei = openImeiIndex === i;

              return (
                <li
                  key={`${l.productId}-${l.imei ?? i}`}
                  className="rounded-[10px] border border-[#E2E8F0] bg-[#F8FAFC]/60 p-3"
                >
                  {/* Product name and price aligned on the same row */}
                  <div className="flex items-center justify-between gap-3">
                    <p className="min-w-0 truncate text-[13.5px] font-semibold leading-snug text-[#0F172A]">
                      {l.name}
                    </p>
                    <p className="shrink-0 text-[13.5px] font-bold tabular-nums leading-snug text-[#0F172A]">
                      {formatTZS(lineTotal(l))}
                    </p>
                  </div>

                  {/* Secondary detail: IMEI or unit price */}
                  {l.type === 'phone' && l.imei ? (
                    <p className="mt-0.5 truncate font-mono text-[11.5px] font-medium text-[#64748B]">
                      IMEI: <span className="text-[#0F172A]">{l.imei}</span>
                    </p>
                  ) : l.type === 'phone' ? (
                    <p className="mt-0.5 text-[11.5px] text-[#64748B]">
                      {tr('Bila IMEI')} · {formatTZS(l.unitPrice)} {tr('kila moja')}
                    </p>
                  ) : (
                    <p className="mt-0.5 text-[11.5px] text-[#64748B]">
                      {formatTZS(l.unitPrice)} {tr('kila moja')}
                    </p>
                  )}

                  {/* Consistently aligned quantity controls and item actions */}
                  <div className="mt-2 flex items-center justify-between gap-2">
                    {l.type === 'phone' && !l.imei ? (
                      <div className="flex items-center gap-3">
                        <Stepper compact qty={l.qty} onMinus={() => p.onQty(i, -1)} onPlus={() => p.onQty(i, 1)} />
                        {l.qty === 1 && availableForLine.length > 0 && (
                          <button
                            type="button"
                            onClick={() => setOpenImeiIndex(isEditingImei ? null : i)}
                            className="text-[12px] font-semibold text-[#2563EB] hover:underline"
                          >
                            {tr('Weka IMEI')}
                          </button>
                        )}
                      </div>
                    ) : l.type === 'phone' ? (
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => setOpenImeiIndex(isEditingImei ? null : i)}
                          className="text-[12px] font-semibold text-[#2563EB] hover:underline"
                        >
                          {tr('Badilisha IMEI')}
                        </button>
                        {p.onAddPhoneUnit && (
                          <button
                            type="button"
                            onClick={() => p.onAddPhoneUnit?.(l.productId)}
                            className="text-[12px] font-semibold text-[#64748B] hover:text-[#0F172A]"
                          >
                            + {tr('Ongeza')}
                          </button>
                        )}
                      </div>
                    ) : (
                      <Stepper compact qty={l.qty} onMinus={() => p.onQty(i, -1)} onPlus={() => p.onQty(i, 1)} />
                    )}

                    <button
                      type="button"
                      onClick={() => {
                        if (openImeiIndex === i) setOpenImeiIndex(null);
                        p.onRemove(i);
                      }}
                      className="text-[12px] font-semibold text-bad-fg hover:underline"
                    >
                      {tr('Ondoa')}
                    </button>
                  </div>

                  {l.type === 'phone' && isEditingImei && (
                    <div className="mt-2.5 rounded-[8px] border border-[#E2E8F0] bg-white p-2.5">
                      <div className="mb-1.5 flex items-center justify-between">
                        <span className="text-[11px] font-semibold text-[#64748B]">
                          {tr('Chagua IMEI ({n} zinapatikana)', { n: availableForLine.length })}
                        </span>
                        <button
                          type="button"
                          onClick={() => setOpenImeiIndex(null)}
                          className="text-[11px] font-semibold text-[#64748B] hover:text-[#0F172A]"
                        >
                          {tr('Funga')}
                        </button>
                      </div>
                      {availableForLine.length <= (l.imei ? 1 : 0) ? (
                        <p className="text-[11.5px] text-[#64748B]">{tr('Hakuna IMEI nyingine inayopatikana.')}</p>
                      ) : (
                        <select
                          aria-label={tr('Badilisha IMEI')}
                          value={l.imei ?? ''}
                          onChange={(e) => {
                            if (e.target.value) p.onChangeImei?.(i, e.target.value);
                            setOpenImeiIndex(null);
                          }}
                          className="h-8 w-full rounded-[6px] border border-[#E2E8F0] bg-white px-2 font-mono text-[12px] text-[#0F172A] outline-none focus:border-[#2563EB]"
                        >
                          {!l.imei && <option value="">{tr('Chagua IMEI')}</option>}
                          {availableForLine.map((imei) => (
                            <option key={imei} value={imei}>
                              {imei}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {/* Sale date: today by default; pick an earlier day to record a past sale. */}
        <div className="rounded-[10px] border border-[#E2E8F0] bg-[#F8FAFC]/60 p-3">
          <div className="flex items-center justify-between gap-3">
            <label htmlFor="sold-on" className="text-[12.5px] font-semibold text-[#0F172A]">
              {tr('Tarehe ya mauzo')}
            </label>
            {s.soldOn !== p.today && (
              <button
                type="button"
                onClick={() => patch({ soldOn: p.today })}
                className="text-[12px] font-semibold text-[#2563EB] hover:underline"
              >
                {tr('Rudisha leo')}
              </button>
            )}
          </div>
          <input
            id="sold-on"
            type="date"
            className="input mt-1.5 h-10 bg-white"
            max={p.today}
            value={s.soldOn}
            onChange={(e) => patch({ soldOn: e.target.value || p.today })}
          />
          {s.soldOn !== p.today && (
            <p className="mt-1.5 rounded-[8px] bg-warn-bg px-2.5 py-1.5 text-[12px] font-medium text-warn-fg">
              {tr('Mauzo yataandikwa kwa tarehe {date}, si leo.', { date: formatDate(new Date(`${s.soldOn}T12:00:00`)) })}
            </p>
          )}
        </div>

        <CustomerPicker value={s.customer} onChange={(customer) => patch({ customer })} required={s.mode === 'debt'} />

        {/* Payment Method: Cash, Lipa Namba, Bank */}
        <div>
          <p className="mb-1.5 text-[12.5px] font-semibold text-[#0F172A]">
            {tr('Njia ya malipo')}{' '}
            {multi && <span className="font-normal text-[#64748B]">{tr('(gawanya kiasi)')}</span>}
          </p>
          <div className="grid grid-cols-3 gap-2">
            {POS_PAYMENT_METHODS.map((m) => {
              const active = s.methods.includes(m);
              return (
                <button
                  key={m}
                  type="button"
                  aria-pressed={active}
                  onClick={() => toggleMethod(m)}
                  className={cx(
                    'flex min-h-[38px] items-center justify-center rounded-[10px] border px-2.5 text-[13px] font-semibold transition-colors',
                    active
                      ? 'border-[#2563EB] bg-blue-50/80 text-[#2563EB]'
                      : 'border-[#E2E8F0] bg-white text-[#0F172A] hover:border-slate-300',
                  )}
                >
                  {tr(PAYMENT_LABEL[m])}
                </button>
              );
            })}
          </div>
        </div>

        {/* Payment Type: Full payment vs Debt */}
        <div
          className="grid grid-cols-2 gap-1 rounded-[10px] border border-[#E2E8F0] bg-[#F8FAFC] p-1"
          role="tablist"
        >
          {(['full', 'debt'] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={s.mode === m}
              onClick={() => patch({ mode: m, paid: m === 'full' ? '' : s.paid })}
              className={cx(
                'min-h-[36px] rounded-[8px] text-[13px] font-semibold transition-colors',
                s.mode === m ? 'bg-white text-[#0F172A] shadow-sm' : 'text-[#64748B] hover:text-[#0F172A]',
              )}
            >
              {m === 'full' ? tr('Malipo kamili') : tr('Deni (sehemu)')}
            </button>
          ))}
        </div>

        {multi && (
          <div className="space-y-2">
            {s.methods.map((m) => (
              <label key={m} className="flex items-center gap-3">
                <span className="w-[88px] shrink-0 text-[12.5px] font-medium text-[#0F172A]">
                  {tr(PAYMENT_LABEL[m])}
                </span>
                <input
                  className="input h-10"
                  inputMode="numeric"
                  placeholder={tr('TSh')}
                  value={s.amounts[m] ?? ''}
                  onChange={(e) => patch({ amounts: { ...s.amounts, [m]: e.target.value.replace(/\D/g, '') } })}
                />
              </label>
            ))}
          </div>
        )}

        {/* Paid (TSh) and Discount (TSh) */}
        <div className={cx('grid gap-3', !multi ? 'grid-cols-2' : 'grid-cols-1')}>
          {!multi && (
            <label className="block min-w-0">
              <span className="mb-1.5 block text-[12.5px] font-semibold text-[#0F172A]">{tr('Amelipa (TSh)')}</span>
              <input
                className="input h-10"
                inputMode="numeric"
                placeholder={s.mode === 'full' && p.total > 0 ? String(p.total) : '0'}
                value={s.mode === 'full' && s.paid === '' ? (p.total > 0 ? String(p.total) : '') : s.paid}
                onChange={(e) => patch({ paid: e.target.value.replace(/\D/g, '') })}
              />
            </label>
          )}
          <label className="block min-w-0">
            <span className="mb-1.5 block text-[12.5px] font-semibold text-[#0F172A]">{tr('Punguzo (TSh)')}</span>
            <input
              className="input h-10"
              inputMode="numeric"
              placeholder="0"
              value={s.discount}
              onChange={(e) => patch({ discount: e.target.value.replace(/\D/g, '') })}
            />
          </label>
        </div>

        {s.mode === 'debt' && (
          <label className="block min-w-0">
            <span className="mb-1.5 block text-[12.5px] font-semibold text-[#0F172A]">{tr('Tarehe ya kumaliza')}</span>
            <input
              type="date"
              className="input h-10"
              min={p.today}
              value={s.dueDate}
              onChange={(e) => patch({ dueDate: e.target.value })}
            />
          </label>
        )}

        {p.needsOwnerPin && (
          <label className="block">
            <span className="mb-1.5 block text-[12.5px] font-semibold text-[#0F172A]">
              {tr('PIN ya mmiliki (punguzo kubwa)')}
            </span>
            <input
              className="input h-10 tracking-[0.4em]"
              type="password"
              inputMode="numeric"
              maxLength={4}
              value={s.ownerPin}
              onChange={(e) => patch({ ownerPin: e.target.value.replace(/\D/g, '') })}
            />
          </label>
        )}

        {p.errors.length > 0 && s.lines.length > 0 && (
          <ul
            role="alert"
            className="space-y-1 rounded-[10px] bg-bad-bg px-3 py-2.5 text-[12px] font-medium text-bad-fg"
          >
            {p.errors.map((e) => (
              <li key={e}>{tr(e)}</li>
            ))}
          </ul>
        )}
      </div>

      {/* 3. FIXED FOOTER: Final total and Complete Sale button */}
      <footer className="shrink-0 border-t border-[#E2E8F0] bg-white px-4 py-3.5 pb-safe">
        <dl className="mb-3 space-y-1 text-[13px]">
          {p.discount > 0 && (
            <>
              <Row label="Jumla ndogo" value={formatTZS(p.subtotal)} />
              <Row label="Punguzo" value={`− ${formatTZS(p.discount)}`} />
            </>
          )}
          {p.balance > 0 && s.lines.length > 0 && <Row label="Deni linabaki" value={formatTZS(p.balance)} tone="warn" />}
          {p.balance < 0 && s.lines.length > 0 && <Row label="Zaidi ya jumla" value={formatTZS(-p.balance)} tone="bad" />}
          <div className="flex items-baseline justify-between pt-0.5">
            <dt className="text-[14px] font-bold text-[#0F172A]">{tr('Jumla')}</dt>
            <dd className="text-[20px] font-extrabold tabular-nums text-[#0F172A]">{formatTZS(p.total)}</dd>
          </div>
        </dl>

        <Button loading={p.busy}
          block
          className="min-h-[48px] text-[14.5px]"
          disabled={p.errors.length > 0 || p.busy}
          onClick={p.onSubmit}
        >
          {p.busy ? tr('Inahifadhi…') : tr('Kamilisha na chapisha risiti')}
        </Button>
      </footer>
    </div>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: 'warn' | 'bad' }) {
  const c = tone === 'warn' ? 'text-warn-fg' : tone === 'bad' ? 'text-bad-fg' : 'text-body';
  return (
    <div className={cx('flex justify-between', c)}>
      <dt>{tr(label)}</dt>
      <dd className="font-semibold">{value}</dd>
    </div>
  );
}

export function Stepper({
  qty,
  onMinus,
  onPlus,
  compact = false,
}: {
  qty: number;
  onMinus: () => void;
  onPlus: () => void;
  compact?: boolean;
}) {
  return (
    <div
      className={cx(
        'inline-flex items-center rounded-[8px] border border-[#E2E8F0] bg-[#F8FAFC]',
        compact ? 'gap-0.5 p-0.5' : 'gap-1 p-1',
      )}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        aria-label={tr('Punguza')}
        onClick={(e) => {
          e.stopPropagation();
          onMinus();
        }}
        className={cx(
          'flex items-center justify-center rounded-[6px] bg-white font-bold text-[#0F172A] border border-[#E2E8F0] hover:bg-slate-50',
          compact ? 'h-6 w-6 text-[14px]' : 'h-8 w-8 text-[16px]',
        )}
      >
        −
      </button>
      <span
        className={cx(
          'text-center font-bold tabular-nums text-[#0F172A]',
          compact ? 'min-w-[22px] px-1 text-[12.5px]' : 'w-7 text-[13.5px]',
        )}
      >
        {qty}
      </span>
      <button
        type="button"
        aria-label={tr('Ongeza')}
        onClick={(e) => {
          e.stopPropagation();
          onPlus();
        }}
        className={cx(
          'flex items-center justify-center rounded-[6px] bg-[#2563EB] font-bold text-white hover:bg-blue-700',
          compact ? 'h-6 w-6 text-[14px]' : 'h-8 w-8 text-[16px]',
        )}
      >
        +
      </button>
    </div>
  );
}

function CustomerPicker({
  value,
  onChange,
  required,
}: {
  value: CustomerState;
  onChange: (v: CustomerState) => void;
  required: boolean;
}) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [error, setError] = useState('');
  const { data: results = [] } = useQuery({
    queryKey: ['customer-search', q],
    queryFn: () => searchCustomers(q),
    enabled: !value.selected && !value.creating && q.trim().length > 0,
  });
  // Same duplicate check the Customers page uses, live while the new customer is typed.
  const { data: dups = [] } = useQuery({
    queryKey: ['customer-dups', value.name, value.phone],
    queryFn: () => checkCustomerDuplicates({ name: value.name, phone: value.phone }),
    enabled: value.creating && (value.name.trim().length >= 2 || value.phone.trim().length >= 9),
  });
  const phoneDup = dups.find((d) => d.reason === 'PHONE');
  const nameDups = dups.filter((d) => d.reason === 'NAME');

  const pick = (c: Customer) => {
    setError('');
    onChange({ selected: c, creating: false, name: '', phone: '' });
    setQ('');
  };
  const register = useMutation({
    mutationFn: (allowSimilarName: boolean) => saveCustomer({ name: value.name, phone: value.phone }, undefined, { allowSimilarName, by: user?.name }),
    onSuccess: (c) => {
      void qc.invalidateQueries({ queryKey: ['customers'] });
      pick(c);
    },
    onError: (e: Error) => setError(e instanceof SimilarCustomerError ? '' : e.message),
  });
  const similarFound = register.error instanceof SimilarCustomerError || (nameDups.length > 0 && !phoneDup);

  return (
    <div>
      <p className="mb-1.5 text-[12.5px] font-semibold text-[#0F172A]">
        {tr('Mteja')}{' '}
        {required ? (
          <span className="font-normal text-bad-fg">{tr('(lazima kwa deni)')}</span>
        ) : (
          <span className="font-normal text-[#64748B]">{tr('(si lazima)')}</span>
        )}
      </p>
      {value.selected ? (
        <div className="flex h-10 items-center justify-between gap-2 rounded-[10px] border border-[#E2E8F0] bg-[#F8FAFC]/60 px-3">
          <span className="min-w-0 truncate text-[13.5px] font-medium text-[#0F172A]">
            {value.selected.name}
            {value.selected.phone && ` · ${displayPhone(value.selected.phone)}`}
          </span>
          <button
            type="button"
            className="shrink-0 text-[12.5px] font-semibold text-[#2563EB] hover:underline"
            onClick={() => onChange({ ...value, selected: null })}
          >
            {tr('Badilisha')}
          </button>
        </div>
      ) : value.creating ? (
        <div className="space-y-2 rounded-[10px] border border-[#E2E8F0] bg-[#F8FAFC]/60 p-2.5">
          <input
            className="input h-10"
            placeholder={tr('Jina la mteja')}
            aria-label={tr('Jina la mteja')}
            value={value.name}
            onChange={(e) => {
              setError('');
              register.reset();
              onChange({ ...value, name: e.target.value });
            }}
          />
          <input
            className="input h-10"
            inputMode="tel"
            placeholder={tr('07XX XXX XXX (hiari)')}
            aria-label={tr('Namba ya simu (hiari)')}
            value={value.phone}
            onChange={(e) => {
              setError('');
              register.reset();
              onChange({ ...value, phone: e.target.value });
            }}
          />
          {phoneDup && (
            <div role="alert" className="rounded-[10px] bg-warn-bg px-3 py-2 text-[12.5px] text-warn-fg">
              <p className="font-semibold">{tr('Namba hii tayari imesajiliwa kwa {name}', { name: phoneDup.name })}</p>
              <button
                type="button"
                className="mt-1 font-bold underline"
                onClick={() => void searchCustomers(phoneDup.phone).then((r) => r[0] && pick(r[0]))}
              >
                {tr('Tumia mteja huyu')}
              </button>
            </div>
          )}
          {!phoneDup && similarFound && nameDups.length > 0 && (
            <div role="alert" className="rounded-[10px] bg-warn-bg px-3 py-2 text-[12.5px] text-warn-fg">
              <p className="font-semibold">{tr('Mteja mwenye jina linalofanana tayari yupo:')}</p>
              <ul className="mt-1 space-y-0.5">
                {nameDups.map((d) => (
                  <li key={d.id} className="flex items-center justify-between gap-2">
                    <span className="truncate">{d.name}{d.phone && ` · ${displayPhone(d.phone)}`}</span>
                    <button type="button" className="shrink-0 font-bold underline" onClick={() => void searchCustomers(d.name).then((r) => { const hit = r.find((c) => c.id === d.id); if (hit) pick(hit); })}>
                      {tr('Tumia')}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {error && <p role="alert" className="text-[12.5px] font-medium text-bad-fg">{tr(error)}</p>}
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              className="text-[12.5px] font-semibold text-[#2563EB] hover:underline"
              onClick={() => {
                setError('');
                register.reset();
                onChange({ ...value, creating: false });
              }}
            >
              {tr('Tafuta mteja aliyepo')}
            </button>
            <Button loading={register.isPending}
              className="min-h-[36px] px-3 text-[13px]"
              disabled={register.isPending || value.name.trim().length < 2 || !!phoneDup}
              onClick={() => register.mutate(similarFound)}
            >
              {register.isPending ? tr('Inahifadhi…') : similarFound ? tr('Sajili hata hivyo') : tr('Sajili na uchague')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="relative">
          <input
            className="input h-10"
            placeholder={tr('Tafuta jina au simu…')}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {q.trim() && (
            <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-[10px] border border-[#E2E8F0] bg-white shadow-lg">
              {results.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    className="flex min-h-[40px] w-full items-center justify-between gap-2 px-3 text-left text-[13.5px] hover:bg-slate-50"
                    onClick={() => pick(c)}
                  >
                    <span className="truncate font-medium text-[#0F172A]">{c.name}</span>
                    <span className="shrink-0 text-[#64748B]">{c.phone ? displayPhone(c.phone) : ''}</span>
                  </button>
                </li>
              ))}
              <li>
                <button
                  type="button"
                  className="min-h-[40px] w-full border-t border-[#E2E8F0] px-3 text-left text-[13.5px] font-semibold text-[#2563EB] hover:bg-slate-50"
                  onClick={() => {
                    const isPhone = /^[\d\s+]+$/.test(q);
                    onChange({ ...value, creating: true, name: isPhone ? '' : q, phone: isPhone ? q : '' });
                    setQ('');
                  }}
                >
                  + {tr('Mteja mpya')}
                </button>
              </li>
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
