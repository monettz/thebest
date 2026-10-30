import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { addDays } from '@shared/debts';
import {
  changeLineImei,
  pickAvailableImei,
  validateCheckout,
  type CartLine,
  type PaymentInput,
} from '@shared/sales';
import { ROLE_LABEL, type PaymentMethod } from '@shared/constants';
import { useAuth } from '@/lib/auth';
import { formatTZS } from '@/lib/format';
import { getSettings } from '@/mock/api';
import { completeSale, listPosProducts, todayDar, type PosProduct } from '@/mock/sales';
import { Button, PageHeader, Spinner, Tabs, cx } from '@/components/ui';
import { BoxIcon, ChevronRight, PhoneIcon, ScanIcon, SearchIcon } from '@/components/ui/icons';
import { Cart, Stepper, digits, type CartState } from './pos/Cart';
import { tr } from '@/i18n';

type Filter = 'all' | 'phone' | 'accessory';
const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'Zote' },
  { value: 'phone', label: 'Simu' },
  { value: 'accessory', label: 'Accessories' },
];

export default function POS() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const searchRef = useRef<HTMLInputElement>(null);
  const today = todayDar();

  const { data: products } = useQuery({ queryKey: ['pos-products'], queryFn: listPosProducts });
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: getSettings });

  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const [cart, setCart] = useState<CartState>({
    lines: [],
    customer: { selected: null, creating: false, name: '', phone: '' },
    methods: ['CASH'],
    amounts: {},
    mode: 'full',
    paid: '',
    dueDate: addDays(today, 14),
    discount: '',
    ownerPin: '',
  });
  const patch = (p: Partial<CartState>) => setCart((c) => ({ ...c, ...p }));

  const submit = useMutation({
    mutationFn: (req: Parameters<typeof completeSale>[1]) => completeSale(user!, req),
    onSuccess: ({ saleId }) => {
      void qc.invalidateQueries({ queryKey: ['pos-products'] });
      void qc.invalidateQueries({ queryKey: ['products'] });
      void qc.invalidateQueries({ queryKey: ['debts'] });
      void qc.invalidateQueries({ queryKey: ['customers'] });
      navigate(`/receipts/${saleId}?done=1`);
    },
  });

  const derived = useMemo(() => {
    const subtotal = cart.lines.reduce((s, l) => s + l.unitPrice * l.qty, 0);
    const discount = digits(cart.discount);
    const total = Math.max(0, subtotal - discount);
    const single = cart.methods.length === 1;
    const singleAmount =
      cart.mode === 'full' ? (cart.paid.trim() !== '' ? digits(cart.paid) : total) : digits(cart.paid);
    const payments: PaymentInput[] = cart.methods
      .map((m: PaymentMethod) => ({
        method: m,
        amount: single ? singleAmount : digits(cart.amounts[m] ?? ''),
      }))
      .filter((p) => p.amount > 0);
    const paid = payments.reduce((s, p) => s + p.amount, 0);
    return { subtotal, discount, total, payments, paid, balance: total - paid };
  }, [cart]);

  if (!products || !settings) return <Spinner variant="catalogue" />;

  const availablePool = new Set(products.flatMap((p) => p.imeis));

  const customerInput = cart.customer.selected
    ? { id: cart.customer.selected.id, name: cart.customer.selected.name, phone: cart.customer.selected.phone }
    : cart.customer.creating
      ? { name: cart.customer.name, phone: cart.customer.phone }
      : null;

  const request = {
    lines: cart.lines,
    discount: derived.discount,
    payments: derived.payments,
    customer: customerInput,
    dueDate: cart.mode === 'debt' ? cart.dueDate : null,
    ownerPin: cart.ownerPin,
  };

  const verdict = validateCheckout(request, {
    shopStock: Object.fromEntries(products.map((p) => [p.id, p.shopQty])),
    availableImeis: availablePool,
    maxDiscountPct: settings.maxDiscountPct,
    isOwner: user!.role === 'owner',
    ownerPinOk: cart.ownerPin.length === 4,
    today,
  });
  const errors = verdict.ok ? [] : [...verdict.errors];
  if (cart.mode === 'full' && cart.lines.length > 0 && derived.balance > 0) {
    errors.unshift('Jumla ya malipo lazima iwe sawa na jumla ya mauzo (au chagua Deni)');
  }
  if (cart.mode === 'debt' && cart.lines.length > 0 && derived.balance === 0 && derived.total > 0) {
    errors.unshift('Hakuna deni: amelipa kiasi chote. Chagua Malipo kamili.');
  }
  const needsOwnerPin =
    user!.role === 'seller' && derived.subtotal > 0 && (derived.discount / derived.subtotal) * 100 > settings.maxDiscountPct;

  /* ---------- cart actions ---------- */
  const flash = (m: string) => {
    setNotice(m);
    setTimeout(() => setNotice(''), 2500);
  };
  const inCart = (productId: number) => cart.lines.filter((l) => l.productId === productId).reduce((s, l) => s + l.qty, 0);

  const addAccessory = (p: PosProduct) => {
    const current = inCart(p.id);
    if (current + 1 > p.shopQty) {
      flash(`${p.name}: zilizopo dukani ni ${p.shopQty} tu`);
      return;
    }
    setCart((c) => {
      const totalNow = c.lines.filter((l) => l.productId === p.id).reduce((s, l) => s + l.qty, 0);
      if (totalNow + 1 > p.shopQty) return c;
      const idx = c.lines.findIndex((l) => l.productId === p.id);
      if (idx >= 0) {
        return { ...c, lines: c.lines.map((l, i) => (i === idx ? { ...l, qty: l.qty + 1 } : l)) };
      }
      return {
        ...c,
        lines: [...c.lines, { productId: p.id, name: p.name, type: p.type, unitPrice: p.sellPrice, qty: 1 }],
      };
    });
  };

  /**
   * Adds one phone. A tracked IMEI is assigned when one is free; otherwise the phone is added without an IMEI
   * (IMEI is optional), as long as the shop still has that quantity.
   */
  const addPhoneAuto = (p: PosProduct) => {
    if (inCart(p.id) + 1 > p.shopQty) {
      flash(`${p.name}: zilizopo dukani ni ${p.shopQty} tu`);
      return;
    }
    setCart((c) => {
      const totalNow = c.lines.filter((l) => l.productId === p.id).reduce((s, l) => s + l.qty, 0);
      if (totalNow + 1 > p.shopQty) return c;
      const assigned = pickAvailableImei(p.imeis, c.lines);
      if (!assigned) {
        const idx = c.lines.findIndex((l) => l.productId === p.id && !l.imei);
        if (idx >= 0) return { ...c, lines: c.lines.map((l, i) => (i === idx ? { ...l, qty: l.qty + 1 } : l)) };
        return { ...c, lines: [...c.lines, { productId: p.id, name: p.name, type: 'phone', unitPrice: p.sellPrice, qty: 1 }] };
      }
      const line: CartLine = {
        productId: p.id,
        name: p.name,
        type: 'phone',
        unitPrice: p.sellPrice,
        qty: 1,
        imei: assigned,
      };
      return { ...c, lines: [...c.lines, line] };
    });
  };

  const addPhoneSpecific = (p: PosProduct, imei: string): boolean => {
    if (!p.imeis.includes(imei)) {
      flash('IMEI hii haipatikani dukani');
      return false;
    }
    if (cart.lines.some((l) => l.imei === imei)) {
      flash('IMEI hii tayari iko kwenye kikapu');
      return false;
    }
    const line: CartLine = { productId: p.id, name: p.name, type: 'phone', unitPrice: p.sellPrice, qty: 1, imei };
    setCart((c) => (c.lines.some((l) => l.imei === imei) ? c : { ...c, lines: [...c.lines, line] }));
    flash(`${p.name} (IMEI ${imei}) imeongezwa kwenye kikapu`);
    return true;
  };

  const removeLastPhoneUnit = (productId: number) => {
    setCart((c) => {
      let lastIdx = -1;
      c.lines.forEach((l, i) => {
        if (l.productId === productId) lastIdx = i;
      });
      if (lastIdx < 0) return c;
      const last = c.lines[lastIdx];
      if (last.qty > 1) return { ...c, lines: c.lines.map((l, i) => (i === lastIdx ? { ...l, qty: l.qty - 1 } : l)) };
      return { ...c, lines: c.lines.filter((_, i) => i !== lastIdx) };
    });
  };

  const onChangeImei = (index: number, newImei: string) => {
    const res = changeLineImei(cart.lines, index, newImei, availablePool);
    if (!res.ok) {
      flash(res.error);
      return;
    }
    setCart((c) => ({ ...c, lines: res.lines }));
  };

  const setQty = (index: number, delta: number) =>
    setCart((c) => {
      const l = c.lines[index];
      if (!l) return c;
      const prod = products.find((p) => p.id === l.productId);
      const qty = l.qty + delta;
      if (qty < 1) return { ...c, lines: c.lines.filter((_, i) => i !== index) };
      if (prod && qty > prod.shopQty) {
        flash(`${l.name}: zilizopo dukani ni ${prod.shopQty} tu`);
        return c;
      }
      return { ...c, lines: c.lines.map((x, i) => (i === index ? { ...x, qty } : x)) };
    });
  const removeLine = (index: number) => setCart((c) => ({ ...c, lines: c.lines.filter((_, i) => i !== index) }));

  const onProduct = (p: PosProduct) => (p.type === 'phone' ? addPhoneAuto(p) : addAccessory(p));

  /** Typing/scanning a full 15-digit IMEI adds that exact unit immediately. */
  const onSearch = (v: string) => {
    setQ(v);
    const cleaned = v.replace(/\s/g, '');
    if (/^\d{15}$/.test(cleaned)) {
      const owner = products.find((p) => p.imeis.includes(cleaned));
      if (owner) {
        addPhoneSpecific(owner, cleaned);
        setQ('');
      } else flash('IMEI hii haipatikani dukani');
    }
  };

  /** Pressing Enter in the search box when an IMEI (full or unique partial digits) matches adds that unit directly. */
  const onSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    const cleaned = q.replace(/\s/g, '');
    if (!/^\d{3,15}$/.test(cleaned)) return;
    e.preventDefault();
    const taken = new Set(cart.lines.map((l) => l.imei).filter(Boolean));
    const matches: { product: PosProduct; imei: string }[] = [];
    for (const p of products) {
      if (p.type !== 'phone') continue;
      for (const imei of p.imeis) {
        if (!taken.has(imei) && imei.includes(cleaned)) {
          matches.push({ product: p, imei });
        }
      }
    }
    if (matches.length === 1) {
      addPhoneSpecific(matches[0].product, matches[0].imei);
      setQ('');
    } else if (matches.length === 0) {
      flash('IMEI hii haipatikani dukani');
    }
  };

  const needle = q.trim().toLowerCase();
  const list = products.filter(
    (p) => (filter === 'all' || p.type === filter) && (!needle || p.name.toLowerCase().includes(needle) || p.imeis.some((i) => i.includes(needle))),
  );

  const cartCount = cart.lines.reduce((s, l) => s + l.qty, 0);
  const cartProps = {
    state: cart,
    patch,
    products,
    total: derived.total,
    subtotal: derived.subtotal,
    discount: derived.discount,
    paid: derived.paid,
    balance: derived.balance,
    errors,
    needsOwnerPin,
    today,
    busy: submit.isPending,
    onQty: setQty,
    onRemove: removeLine,
    onChangeImei,
    onAddPhoneUnit: (productId: number) => {
      const prod = products.find((x) => x.id === productId);
      if (prod) addPhoneAuto(prod);
    },
    onClear: () => patch({ lines: [] }),
    onSubmit: () => submit.mutate(request),
  };

  return (
    <div className="pb-20">
      <div className="min-w-0">
        <div className="mb-3 flex items-center gap-2.5 md:hidden">
          <button
            type="button"
            aria-label={tr('Rudi')}
            onClick={() => navigate('/')}
            className="flex h-10 w-10 items-center justify-center rounded-[10px] border border-[#E2E8F0] bg-white"
          >
            <ChevronRight className="rotate-180" />
          </button>
          <div className="flex-1">
            <h1 className="text-[20px] font-bold leading-tight text-[#0F172A]">{tr('Uza')}</h1>
            <p className="text-[12.5px] text-[#64748B]">
              {tr('Duka')} · {tr(ROLE_LABEL[user!.role])}
            </p>
          </div>
          <Button variant="outline" className="min-h-[40px] px-3 text-[13px]" onClick={() => navigate('/sales')}>
            {tr('Historia')}
          </Button>
          <Button variant="soft" className="h-10 w-10 px-0" aria-label={tr('Scan IMEI')} onClick={() => setScanOpen(true)}>
            <ScanIcon />
          </Button>
        </div>
        <div className="hidden md:block">
          <PageHeader
            title="Mauzo"
            subtitle="Chagua bidhaa au scan IMEI / barcode."
            actions={
              <>
                <Button variant="outline" onClick={() => navigate('/sales')}>
                  {tr('Historia ya mauzo')}
                </Button>
                <Button variant="soft" onClick={() => setScanOpen(true)}>
                  <ScanIcon width={16} height={16} /> {tr('Scan IMEI')}
                </Button>
                <Button onClick={() => setSheetOpen(true)}>
                  {tr('Kikapu')} ({cartCount})
                </Button>
              </>
            }
          />
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative min-w-[220px] flex-1">
            <SearchIcon width={16} height={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#64748B]" />
            <input
              ref={searchRef}
              className="h-10 w-full rounded-[10px] border border-[#E2E8F0] bg-white pl-10 pr-3 text-[13.5px] text-[#0F172A] outline-none placeholder:text-[#64748B]/70 focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/15"
              placeholder={tr('Tafuta bidhaa, model au IMEI…')}
              value={q}
              onChange={(e) => onSearch(e.target.value)}
              onKeyDown={onSearchKeyDown}
            />
          </div>
          <Tabs value={filter} onChange={setFilter} options={FILTERS} />
        </div>
        {notice && (
          <p role="status" className="mt-2.5 rounded-[10px] border border-amber-200 bg-warn-bg px-3.5 py-2 text-[13px] font-medium text-warn-fg">
            {tr(notice)}
          </p>
        )}

        <div className="mt-3.5 grid grid-cols-1 gap-2.5 min-[380px]:grid-cols-2 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((p) => {
            const n = inCart(p.id);
            const availableUnits = p.shopQty;
            const out = availableUnits <= 0;

            return (
              <div
                key={p.id}
                onClick={() => {
                  if (!out) onProduct(p);
                  else if (p.type === 'phone') flash(`${p.name}: hakuna stock dukani`);
                }}
                role="button"
                tabIndex={out && p.type !== 'phone' ? -1 : 0}
                aria-disabled={out}
                aria-label={tr(`Ongeza ${p.name}`)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    if (!out) onProduct(p);
                    else if (p.type === 'phone') flash(`${p.name}: hakuna stock dukani`);
                  }
                }}
                className={cx(
                  'group flex min-h-[148px] max-h-[175px] flex-col justify-between rounded-[12px] border bg-white p-3 text-left transition-colors duration-150 select-none',
                  out ? 'cursor-not-allowed opacity-60 border-[#E2E8F0]' : 'cursor-pointer hover:border-slate-300',
                  n > 0 ? 'border-[#2563EB] ring-1 ring-[#2563EB]/20' : 'border-[#E2E8F0]',
                )}
              >
                {/* Compact Product Image / Neutral Placeholder (70px height) */}
                <div className="relative flex h-[70px] w-full shrink-0 items-center justify-center overflow-hidden rounded-[8px] border border-[#E2E8F0]/70 bg-[#F8FAFC]">
                  {p.imageUrl ? (
                    <img
                      src={p.imageUrl}
                      alt={p.name}
                      className="h-full w-full object-contain p-1"
                      loading="lazy"
                    />
                  ) : p.type === 'phone' ? (
                    <PhoneIcon width={24} height={24} className="text-[#64748B]" />
                  ) : (
                    <BoxIcon width={24} height={24} className="text-[#64748B]" />
                  )}
                  {n > 0 && (
                    <span className="absolute right-1.5 top-1.5 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-[#2563EB] px-1.5 text-[11px] font-bold text-white">
                      {n}
                    </span>
                  )}
                </div>

                {/* Compact Product Metadata */}
                <div className="mt-1.5 min-w-0">
                  <p className="truncate text-[13.5px] font-semibold leading-tight text-[#0F172A]">{p.name}</p>
                  <p className="mt-0.5 truncate text-[11.5px] leading-tight text-[#64748B]">
                    {p.type === 'phone' ? tr('Simu') : tr('Accessory')} ·{' '}
                    {out
                      ? tr('Imeisha')
                      : tr(p.type === 'phone' ? '{n} dukani' : '{n} zipo', { n: availableUnits })}
                  </p>
                </div>

                {/* Price & Inline Quantity Stepper (only when in cart) */}
                <div className="mt-1.5 flex min-h-[26px] items-center justify-between gap-1.5">
                  <span className="truncate text-[13.5px] font-bold tabular-nums text-[#0F172A]">
                    {formatTZS(p.sellPrice)}
                  </span>
                  {n > 0 && (
                    <Stepper
                      compact
                      qty={n}
                      onMinus={() =>
                        p.type === 'phone'
                          ? removeLastPhoneUnit(p.id)
                          : setQty(cart.lines.findIndex((l) => l.productId === p.id), -1)
                      }
                      onPlus={() => (p.type === 'phone' ? addPhoneAuto(p) : addAccessory(p))}
                    />
                  )}
                </div>
              </div>
            );
          })}
          {list.length === 0 && (
            <p className="col-span-full p-8 text-center text-[#64748B]">{tr('Hakuna bidhaa iliyopatikana.')}</p>
          )}
        </div>
      </div>

      {/* Bottom Cart Summary Bar */}
      <div className="pb-safe fixed inset-x-0 bottom-0 z-30 border-t border-[#E2E8F0] bg-white px-4 py-3 shadow-[0_-4px_16px_rgba(15,23,42,0.06)]">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            className="flex w-full items-center justify-between gap-3 text-left"
          >
            <span>
              <span className="block text-[12.5px] text-[#64748B]">
                {tr('Bidhaa {n} kwenye kikapu', { n: cartCount })}
              </span>
              <span className="block text-[19px] font-extrabold tabular-nums text-[#0F172A]">
                {formatTZS(derived.total)}
              </span>
            </span>
            <span className="inline-flex min-h-[42px] items-center gap-2 rounded-[10px] bg-[#2563EB] px-4 text-[13.5px] font-semibold text-white">
              {tr('Kikapu')} <ChevronRight width={16} height={16} />
            </span>
          </button>
        </div>
      </div>

      {/* Cart & Checkout Drawer: Right-side drawer on desktop (500px), bottom sheet on mobile */}
      {sheetOpen && (
        <div
          className="fixed inset-0 z-40 flex items-end justify-end bg-slate-900/25 animate-fade-in md:items-stretch"
          onClick={() => setSheetOpen(false)}
        >
          <div
            role="dialog"
            aria-label={tr('Kikapu')}
            className="flex h-[92dvh] max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-[20px] bg-white shadow-[0_-8px_30px_rgba(15,23,42,0.12)] md:h-dvh md:max-h-dvh md:w-[500px] md:max-w-[95vw] md:rounded-none md:border-l md:border-[#E2E8F0] md:shadow-[-8px_0_24px_rgba(15,23,42,0.08)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mt-2.5 mb-1 h-1.5 w-12 shrink-0 rounded-full bg-[#E2E8F0] md:hidden" />
            <Cart {...cartProps} onClose={() => setSheetOpen(false)} />
          </div>
        </div>
      )}

      {scanOpen && (
        <ScanImeiModal
          products={products}
          takenImeis={cart.lines.map((l) => l.imei).filter((x): x is string => !!x)}
          onScan={(product, imei) => {
            const ok = addPhoneSpecific(product, imei);
            if (ok) setScanOpen(false);
            return ok;
          }}
          onClose={() => setScanOpen(false)}
        />
      )}

      {submit.isError && (
        <div className="fixed inset-x-4 top-4 z-50 rounded-[10px] bg-bad-bg p-3.5 text-[13.5px] font-medium text-bad-fg shadow-md">
          {tr((submit.error as Error).message)}
        </div>
      )}
    </div>
  );
}

function ScanImeiModal({
  products,
  takenImeis,
  onScan,
  onClose,
}: {
  products: PosProduct[];
  takenImeis: string[];
  onScan: (product: PosProduct, imei: string) => boolean;
  onClose: () => void;
}) {
  const [input, setInput] = useState('');
  const [camActive, setCamActive] = useState(false);
  const [camError, setCamError] = useState('');
  const [localError, setLocalError] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);

  const takenSet = useMemo(() => new Set(takenImeis), [takenImeis]);

  const availableUnits = useMemo(() => {
    const out: { product: PosProduct; imei: string }[] = [];
    for (const p of products) {
      if (p.type !== 'phone') continue;
      for (const imei of p.imeis) {
        if (!takenSet.has(imei)) out.push({ product: p, imei });
      }
    }
    return out;
  }, [products, takenSet]);

  const cleaned = input.replace(/\s/g, '');
  const filtered = useMemo(() => {
    if (!cleaned) return availableUnits;
    const q = cleaned.toLowerCase();
    return availableUnits.filter(
      (u) => u.imei.includes(cleaned) || u.product.name.toLowerCase().includes(q),
    );
  }, [availableUnits, cleaned]);

  useEffect(() => {
    if (!camActive) return;
    let stream: MediaStream | null = null;
    let timer: number | undefined;
    let cancelled = false;

    const startCamera = async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          setCamError('Kamera haipatikani kwenye kifaa hiki');
          setCamActive(false);
          return;
        }
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        const BarcodeDetectorCtor = (
          window as unknown as {
            BarcodeDetector?: new (opts?: { formats: string[] }) => {
              detect: (el: HTMLVideoElement) => Promise<{ rawValue: string }[]>;
            };
          }
        ).BarcodeDetector;
        if (BarcodeDetectorCtor) {
          const detector = new BarcodeDetectorCtor({
            formats: ['code_128', 'code_39', 'ean_13', 'itf', 'qr_code'],
          });
          const tick = async () => {
            if (cancelled || !videoRef.current) return;
            try {
              const codes = await detector.detect(videoRef.current);
              for (const c of codes) {
                const digitsOnly = c.rawValue.replace(/\D/g, '');
                if (/^\d{15}$/.test(digitsOnly)) {
                  const match = availableUnits.find((u) => u.imei === digitsOnly);
                  if (match) {
                    onScan(match.product, match.imei);
                    return;
                  }
                }
              }
            } catch {
              /* ignore frame errors */
            }
            timer = window.setTimeout(tick, 250);
          };
          timer = window.setTimeout(tick, 300);
        }
      } catch {
        setCamError('Kamera haipatikani kwenye kifaa hiki');
        setCamActive(false);
      }
    };

    void startCamera();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [camActive, availableUnits, onScan]);

  const handleInput = (val: string) => {
    setInput(val);
    setLocalError('');
    const digitsOnly = val.replace(/\s/g, '');
    if (/^\d{15}$/.test(digitsOnly)) {
      const match = availableUnits.find((u) => u.imei === digitsOnly);
      if (match) {
        onScan(match.product, match.imei);
      } else {
        setLocalError('IMEI hii haipatikani dukani');
      }
    }
  };

  const handleEnter = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (filtered.length === 1) {
      onScan(filtered[0].product, filtered[0].imei);
    } else if (filtered.length === 0) {
      setLocalError('IMEI hii haipatikani dukani');
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/35 p-0 animate-fade-in sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label={tr('Scan IMEI')}
        className="flex max-h-[88dvh] w-full flex-col overflow-hidden rounded-t-[20px] border border-[#E2E8F0] bg-white shadow-xl sm:max-w-[480px] sm:rounded-[16px]"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex shrink-0 items-center justify-between border-b border-[#E2E8F0] px-4 py-3.5">
          <div className="flex items-center gap-2">
            <ScanIcon width={18} height={18} className="text-[#2563EB]" />
            <h2 className="text-[16px] font-bold text-[#0F172A]">{tr('Scan IMEI')}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-[8px] border border-[#E2E8F0] bg-[#F8FAFC] px-2.5 py-1 text-[12.5px] font-semibold text-[#64748B] hover:text-[#0F172A]"
          >
            {tr('Funga')}
          </button>
        </header>

        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-3.5">
          <p className="text-[12.5px] text-[#64748B]">
            {tr('Scan au andika IMEI ya simu kuongeza bidhaa moja kwa moja kwenye kikapu.')}
          </p>

          <div className="flex gap-2">
            <input
              autoFocus
              inputMode="numeric"
              className="input h-10 flex-1 font-mono text-[13.5px]"
              placeholder={tr('Scan au andika namba ya IMEI…')}
              value={input}
              onChange={(e) => handleInput(e.target.value)}
              onKeyDown={handleEnter}
            />
            <button
              type="button"
              onClick={() => {
                setCamError('');
                setCamActive((v) => !v);
              }}
              className={cx(
                'shrink-0 rounded-[10px] border px-3 text-[12.5px] font-semibold transition-colors',
                camActive
                  ? 'border-bad-fg bg-bad-bg text-bad-fg'
                  : 'border-[#2563EB] bg-blue-50/80 text-[#2563EB] hover:bg-blue-100/70',
              )}
            >
              {tr(camActive ? 'Zima kamera' : 'Washa kamera')}
            </button>
          </div>

          {camActive && (
            <div className="relative overflow-hidden rounded-[10px] border border-[#E2E8F0] bg-slate-950">
              <video ref={videoRef} className="h-[180px] w-full object-cover" muted playsInline />
              <div className="pointer-events-none absolute inset-x-8 top-1/2 h-0.5 -translate-y-1/2 bg-[#2563EB] shadow-[0_0_8px_#2563EB]" />
            </div>
          )}

          {(localError || camError) && (
            <p className="rounded-[8px] bg-bad-bg px-3 py-2 text-[12.5px] font-medium text-bad-fg">
              {tr(localError || camError)}
            </p>
          )}

          <div>
            <p className="mb-2 text-[12px] font-semibold text-[#64748B]">
              {tr('Simu zinazopatikana dukani ({n})', { n: filtered.length })}
            </p>
            <ul className="divide-y divide-[#E2E8F0] rounded-[10px] border border-[#E2E8F0] bg-[#F8FAFC]/50">
              {filtered.map(({ product, imei }) => (
                <li key={imei}>
                  <button
                    type="button"
                    onClick={() => onScan(product, imei)}
                    className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition-colors hover:bg-blue-50/50"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-[13.5px] font-semibold text-[#0F172A]">{product.name}</p>
                      <p className="font-mono text-[12px] text-[#64748B]">IMEI: {imei}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-[13px] font-bold tabular-nums text-[#0F172A]">
                        {formatTZS(product.sellPrice)}
                      </p>
                      <span className="text-[11.5px] font-semibold text-[#2563EB]">
                        + {tr('Ongeza')}
                      </span>
                    </div>
                  </button>
                </li>
              ))}
              {filtered.length === 0 && (
                <li className="p-5 text-center text-[13px] text-[#64748B]">
                  {tr('Hakuna IMEI iliyopatikana.')}
                </li>
              )}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
