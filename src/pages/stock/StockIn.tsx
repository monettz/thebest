import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { validateTransfer, type TransferLineInput } from '@shared/stock';
import { useAuth } from '@/lib/auth';
import { useLocationCode } from '@/lib/location';
import { formatNumber, formatTZS } from '@/lib/format';
import { listProducts, type ProductRow } from '@/mock/api';
import { createTransfer, imeisIn, listStoreImeis } from '@/mock/inventory';
import { Badge, Button, Card, PageHeader, Spinner, StockBadge, cx } from '@/components/ui';
import { BoxIcon, PhoneIcon, PlusIcon, SearchIcon, WarehouseIcon } from '@/components/ui/icons';
import { CreateProductForm } from '@/pages/Products';
import { tr } from '@/i18n';

type Source = 'store' | 'new';

interface StoreTransferLine {
  productId: number;
  qty: number;
  imeis: string[];
}

export default function StockIn() {
  const { user, isOwner } = useAuth();
  const role = user!.role;
  const qc = useQueryClient();

  const { data: products } = useQuery({ queryKey: ['products', role], queryFn: () => listProducts(role) });
  const { data: storeImeis } = useQuery({ queryKey: ['store-imeis'], queryFn: listStoreImeis });

  // On the Store side this screen only moves stock Store -> Shop. New products are added on "Receive goods".
  const storeSide = useLocationCode().code === 'STORE';
  const [pickedSource, setSource] = useState<Source>('store');
  const source: Source = storeSide ? 'store' : pickedSource;
  const [storeLines, setStoreLines] = useState<StoreTransferLine[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDropdownId, setSelectedDropdownId] = useState<string>('');
  // Held as a function so the text is built when shown, and follows a language switch.
  const [successMsg, setSuccessMsg] = useState<(() => string) | ''>('');
  const [showCreateProductForm, setShowCreateProductForm] = useState(false);

  const byId = useMemo(() => new Map((products ?? []).map((p) => [p.id, p])), [products]);

  const invalidateAll = () => {
    for (const k of ['products', 'store-imeis', 'store-feed', 'store-dashboard', 'pos-products', 'movements']) {
      void qc.invalidateQueries({ queryKey: [k] });
    }
  };

  // Transfer from Store -> Shop mutation
  const transferMut = useMutation({
    mutationFn: (payload: TransferLineInput[]) => createTransfer(user!, { lines: payload }),
    onSuccess: (_, payload) => {
      invalidateAll();
      const totalMoved = payload.reduce((s, l) => s + l.qty, 0);
      setSuccessMsg(() => () =>
        tr('Uhamisho umekamilika: bidhaa {1} (vipande {2}) zimehamishwa kutoka Store kwenda Dukani.', {
          1: payload.length,
          2: totalMoved,
        }),
      );
      setStoreLines([]);
    },
  });

  if (!products || !storeImeis) return <Spinner variant="products" />;

  // FROM STORE: only existing products with available Store stock (storeQty > 0)
  const storeEligibleProducts = products.filter((p) => p.storeQty > 0);

  const needle = searchQuery.trim().toLowerCase();
  const filteredStoreProducts = storeEligibleProducts.filter((p) => {
    if (!needle) return true;
    return (
      p.name.toLowerCase().includes(needle) ||
      p.detail.toLowerCase().includes(needle) ||
      p.code.toLowerCase().includes(needle) ||
      (p.barcode?.toLowerCase().includes(needle) ?? false) ||
      p.storeImeis.some((i) => i.includes(needle))
    );
  });

  /** Add an existing Store product to the transfer list (preventing duplicate rows). */
  const handleAddStoreProduct = (productId: number, matchedStoreImei?: string) => {
    const p = byId.get(productId);
    if (!p || p.storeQty <= 0) return;

    setSuccessMsg('');
    const existing = storeLines.find((l) => l.productId === productId);
    if (existing) {
      if (
        p.type === 'phone' &&
        matchedStoreImei &&
        !existing.imeis.includes(matchedStoreImei) &&
        existing.qty < p.storeQty
      ) {
        const nextImeis = [...existing.imeis, matchedStoreImei];
        setStoreLines((ls) =>
          ls.map((l) => (l.productId === productId ? { ...l, qty: nextImeis.length, imeis: nextImeis } : l)),
        );
      }
      return;
    }

    const defaultImeis =
      p.type === 'phone'
        ? matchedStoreImei
          ? [matchedStoreImei]
          : []
        : [];

    setStoreLines((ls) => [
      ...ls,
      {
        productId,
        qty: 1,
        imeis: defaultImeis,
      },
    ]);
    setSelectedDropdownId('');
  };

  /** Add from either dropdown selection or top search match / exact Store IMEI match. */
  const handleAddFromStoreSelector = () => {
    if (selectedDropdownId) {
      handleAddStoreProduct(Number(selectedDropdownId));
      return;
    }
    if (!needle) return;
    const imeiMatch = storeEligibleProducts.find((p) => p.storeImeis.some((i) => i === needle));
    if (imeiMatch) {
      handleAddStoreProduct(imeiMatch.id, needle);
      setSearchQuery('');
      return;
    }
    if (filteredStoreProducts.length > 0) {
      const firstUnadded =
        filteredStoreProducts.find((p) => !storeLines.some((l) => l.productId === p.id)) ?? filteredStoreProducts[0];
      handleAddStoreProduct(firstUnadded.id);
    }
  };

  const updateStoreLine = (productId: number, patch: Partial<StoreTransferLine>) => {
    setStoreLines((ls) => ls.map((l) => (l.productId === productId ? { ...l, ...patch } : l)));
  };

  const removeStoreLine = (productId: number) => {
    setStoreLines((ls) => ls.filter((l) => l.productId !== productId));
  };

  /** Update transfer quantity while keeping phone IMEIs synchronized with Store pool. */
  const handleStoreQtyChange = (line: StoreTransferLine, nextQty: number) => {
    const p = byId.get(line.productId);
    if (!p) return;
    const clamped = Number.isFinite(nextQty) ? Math.max(0, Math.floor(nextQty)) : 0;

    if (p.type === 'phone') {
      // IMEI ni hiari: idadi inaweza kuzidi IMEI zilizochaguliwa; IMEI zisizidi idadi.
      updateStoreLine(line.productId, { qty: clamped, imeis: line.imeis.slice(0, Math.max(0, clamped)) });
      return;
    }
    updateStoreLine(line.productId, { qty: clamped });
  };

  /** Toggle a Store IMEI for a phone in "From Store" mode. */
  const toggleStoreImei = (line: StoreTransferLine, imei: string) => {
    const exists = line.imeis.includes(imei);
    const nextImeis = exists ? line.imeis.filter((i) => i !== imei) : [...line.imeis, imei];
    updateStoreLine(line.productId, {
      imeis: nextImeis,
      qty: Math.max(1, line.qty, nextImeis.length),
    });
  };

  // Validation for Store -> Shop transfer
  const transferPayload: TransferLineInput[] = storeLines
    .filter((l) => byId.has(l.productId))
    .map((l) => {
      const p = byId.get(l.productId)!;
      return { productId: l.productId, name: p.name, type: p.type, qty: l.qty, imeis: l.imeis };
    });

  const transferVerdict = validateTransfer(transferPayload, {
    storeStock: Object.fromEntries(products.map((p) => [p.id, p.storeQty])),
    storeImeis: new Set(imeisIn('IN_STORE')),
  });

  const transferErrors = !transferVerdict.ok ? transferVerdict.errors : [];

  const getStoreRowErrors = (p: ProductRow, l: StoreTransferLine): string[] => {
    const errs: string[] = [];
    if (!Number.isInteger(l.qty) || l.qty < 1) {
      errs.push(tr('{1}: idadi si sahihi', { 1: p.name }));
    }
    if (l.qty > p.storeQty) {
      errs.push(tr('{1}: zilizopo store ni {2}, umeweka {3}', { 1: p.name, 2: p.storeQty, 3: l.qty }));
    }
    if (p.type === 'phone' && l.imeis.length > l.qty) {
      errs.push(tr('{1}: IMEI {3} ni nyingi kuliko idadi {2}', { 1: p.name, 2: l.qty, 3: l.imeis.length }));
    }
    return errs;
  };

  const totalProductTypes = storeLines.length;
  const totalUnits = storeLines.reduce((sum, l) => sum + (l.qty > 0 ? l.qty : 0), 0);
  const totalValue = storeLines.reduce((sum, l) => {
    const p = byId.get(l.productId);
    return sum + (l.qty > 0 ? l.qty : 0) * (p?.costPrice ?? 0);
  }, 0);

  const canSubmitTransfer = storeLines.length > 0 && transferErrors.length === 0 && !transferMut.isPending;

  return (
    <div className="space-y-5 overflow-x-hidden">
      {/* 1. PAGE HEADER */}
      <PageHeader
        title={storeSide ? 'Hamisha dukani' : 'Ingiza stock dukani'}
        subtitle={storeSide ? 'Hamisha bidhaa zilizopo Store kwenda Dukani.' : 'Hamisha bidhaa kutoka Store kwenda Dukani au ongeza stock mpya moja kwa moja Dukani.'}
        actions={
          storeSide ? (
            <Link to="/store/receive" className="inline-flex min-h-touch items-center rounded-xl border border-line bg-white px-4 text-[14px] font-semibold text-slate-700 shadow-sm hover:bg-slate-50">
              {tr('Bidhaa mpya? Pokea mzigo')}
            </Link>
          ) : undefined
        }
      />

      {successMsg && (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-2 rounded-[12px] border border-emerald-200 bg-ok-bg px-4 py-3 text-[13.5px] font-medium text-ok-fg"
        >
          <span>{successMsg()}</span>
          <Link to="/products" className="font-bold underline">
            {tr('Angalia stock')}
          </Link>
        </div>
      )}

      {/* 2. STEP 1 — SELECT STOCK SOURCE */}
      {!storeSide && (
      <section aria-labelledby="step-source-heading">
        <h2 id="step-source-heading" className="mb-3 text-[15px] font-bold text-[#0F172A]">
          {tr('1. Chagua chanzo cha stock')}
        </h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {/* CARD A: From Store */}
          <button
            type="button"
            aria-pressed={source === 'store'}
            onClick={() => {
              setSource('store');
              setSuccessMsg('');
            }}
            className={cx(
              'flex h-full items-start gap-3.5 rounded-[14px] border-2 p-4 text-left transition-all',
              source === 'store'
                ? 'border-[#2563EB] bg-[#EEF3FF]/70 shadow-xs'
                : 'border-[#E2E8F0] bg-white hover:border-slate-300 hover:bg-[#F8FAFC]',
            )}
          >
            <span
              className={cx(
                'flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] transition-colors',
                source === 'store' ? 'bg-[#2563EB] text-white' : 'bg-[#F8FAFC] text-[#64748B] border border-[#E2E8F0]',
              )}
            >
              <WarehouseIcon width={22} height={22} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[15.5px] font-bold text-[#0F172A]">{tr('Kutoka Store')}</span>
                {source === 'store' && <Badge tone="blue">{tr('Imechaguliwa')}</Badge>}
              </div>
              <p className="mt-0.5 text-[13px] font-medium text-[#334155]">
                {tr('Hamisha stock iliyopo kutoka Store kwenda Dukani.')}
              </p>
              <p className="mt-1 text-[12px] text-[#64748B]">
                {tr('Idadi ya Store inapungua na idadi ya Dukani inaongezeka.')}
              </p>
            </div>
          </button>

          {/* CARD B: Add New Stock */}
          <button
            type="button"
            aria-pressed={source === 'new'}
            onClick={() => {
              setSource('new');
              setSuccessMsg('');
            }}
            className={cx(
              'flex h-full items-start gap-3.5 rounded-[14px] border-2 p-4 text-left transition-all',
              source === 'new'
                ? 'border-[#2563EB] bg-[#EEF3FF]/70 shadow-xs'
                : 'border-[#E2E8F0] bg-white hover:border-slate-300 hover:bg-[#F8FAFC]',
            )}
          >
            <span
              className={cx(
                'flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] transition-colors',
                source === 'new' ? 'bg-[#2563EB] text-white' : 'bg-[#F8FAFC] text-[#64748B] border border-[#E2E8F0]',
              )}
            >
              <BoxIcon width={22} height={22} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[15.5px] font-bold text-[#0F172A]">{tr('Ongeza Stock Mpya')}</span>
                {source === 'new' && <Badge tone="blue">{tr('Imechaguliwa')}</Badge>}
              </div>
              <p className="mt-0.5 text-[13px] font-medium text-[#334155]">
                {tr('Ongeza stock mpya moja kwa moja Dukani.')}
              </p>
              <p className="mt-1 text-[12px] text-[#64748B]">
                {tr('Idadi ya Dukani inaongezeka bila kubadilisha stock ya Store.')}
              </p>
            </div>
          </button>
        </div>
      </section>
      )}

      {/* WORKFLOW 1: FROM STORE — Transfer Existing Products Only */}
      {source === 'store' ? (
        <>
          <Card className="border-[#E2E8F0] p-4 sm:p-5">
            <div className="border-b border-[#E2E8F0] pb-3">
              <h2 className="text-[15.5px] font-bold text-[#0F172A]">{tr('Bidhaa za kuhamisha kutoka Store')}</h2>
              <p className="text-[12.5px] text-[#64748B]">
                {tr('Chagua bidhaa zenye stock Store ili kuzihamishia Dukani.')}
              </p>
            </div>

            {/* Searchable Store Product Selector */}
            <div className="mt-3.5 flex flex-col gap-2.5 sm:flex-row">
              <div className="relative flex-1">
                <SearchIcon width={16} height={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#64748B]" />
                <input
                  type="text"
                  className="h-[42px] w-full rounded-[10px] border border-[#E2E8F0] bg-white pl-10 pr-3.5 text-[13.5px] text-[#0F172A] outline-none placeholder:text-[#64748B] focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/15"
                  placeholder={tr('Tafuta bidhaa kwa jina, model, SKU, barcode au IMEI...')}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddFromStoreSelector();
                    }
                  }}
                />
              </div>

              <div className="flex gap-2">
                <select
                  aria-label={tr('Bidhaa za kuhamisha kutoka Store')}
                  className="h-[42px] min-w-[180px] flex-1 rounded-[10px] border border-[#E2E8F0] bg-white px-3 text-[13.5px] font-medium text-[#0F172A] outline-none focus:border-[#2563EB] sm:max-w-[260px]"
                  value={selectedDropdownId}
                  onChange={(e) => {
                    const val = e.target.value;
                    setSelectedDropdownId(val);
                    if (val) handleAddStoreProduct(Number(val));
                  }}
                >
                  <option value="">{tr('Chagua kwenye orodha…')}</option>
                  {filteredStoreProducts.map((p) => {
                    const alreadyAdded = storeLines.some((l) => l.productId === p.id);
                    return (
                      <option key={p.id} value={p.id} disabled={alreadyAdded}>
                        {p.name} {p.detail ? `(${p.detail})` : ''} — {tr('Store')}: {p.storeQty}
                        {alreadyAdded ? ` (${tr('Imeongezwa')})` : ''}
                      </option>
                    );
                  })}
                </select>

                <Button
                  type="button"
                  className="min-h-[42px] shrink-0 px-4 text-[13.5px]"
                  disabled={filteredStoreProducts.length === 0 && !selectedDropdownId}
                  onClick={handleAddFromStoreSelector}
                >
                  {tr('+ Ongeza bidhaa')}
                </Button>
              </div>
            </div>

            {/* Filtered Store Products List */}
            <div className="mt-3 max-h-48 overflow-y-auto rounded-[10px] border border-[#E2E8F0] bg-[#F8FAFC] p-2">
              {filteredStoreProducts.length === 0 ? (
                <div className="px-2 py-3 text-[13px] text-[#64748B]">
                  {tr('Hakuna bidhaa yenye stock Store inayolingana na utafutaji.')}
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                  {filteredStoreProducts.map((p) => {
                    const added = storeLines.some((l) => l.productId === p.id);
                    return (
                      <div
                        key={p.id}
                        className={cx(
                          'flex items-center justify-between gap-2 rounded-[8px] border px-2.5 py-2 transition',
                          added
                            ? 'border-blue-200 bg-[#EEF3FF]/60'
                            : 'border-[#E2E8F0] bg-white hover:border-[#2563EB]',
                        )}
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-[6px] border border-[#E2E8F0] bg-[#F8FAFC] text-[#64748B]">
                            {p.imageUrl ? (
                              <img src={p.imageUrl} alt={p.name} className="h-full w-full object-contain p-0.5" />
                            ) : p.type === 'phone' ? (
                              <PhoneIcon width={15} height={15} />
                            ) : (
                              <BoxIcon width={15} height={15} />
                            )}
                          </span>
                          <div className="min-w-0">
                            <p className="truncate text-[13px] font-semibold text-[#0F172A]">{p.name}</p>
                            <p className="truncate text-[11.5px] text-[#64748B]">
                              {p.detail ? `${p.detail} · ` : ''}
                              {tr('Store')}: {formatNumber(p.storeQty)}
                            </p>
                          </div>
                        </div>

                        <button
                          type="button"
                          disabled={added}
                          onClick={() => handleAddStoreProduct(p.id)}
                          className={cx(
                            'shrink-0 rounded-[7px] px-2.5 py-1 text-[12px] font-semibold transition',
                            added
                              ? 'cursor-default bg-blue-100 text-[#2563EB]'
                              : 'bg-[#2563EB] text-white hover:bg-[#1D4ED8]',
                          )}
                        >
                          {added ? tr('Imeongezwa') : tr('+ Ongeza')}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Selected Products & Transfer Quantities */}
            <div className="mt-5">
              <div className="mb-2.5 flex items-center justify-between">
                <h3 className="text-[14px] font-bold text-[#0F172A]">
                  {tr('Bidhaa zilizochaguliwa ({n})', { n: storeLines.length })}
                </h3>
                {storeLines.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setStoreLines([])}
                    className="text-[12.5px] font-semibold text-[#64748B] hover:text-bad-fg"
                  >
                    {tr('Futa yote')}
                  </button>
                )}
              </div>

              {storeLines.length === 0 ? (
                <div className="rounded-[12px] border border-dashed border-[#E2E8F0] bg-[#F8FAFC] p-6 text-center text-[13.5px] text-[#64748B]">
                  {tr('Hakuna bidhaa iliyochaguliwa bado. Tafuta au chagua bidhaa hapo juu ili kuhamisha kutoka Store.')}
                </div>
              ) : (
                <div className="space-y-3">
                  {storeLines.map((l) => {
                    const p = byId.get(l.productId);
                    if (!p) return null;
                    const rowErrors = getStoreRowErrors(p, l);
                    const unitCostNum = p.costPrice ?? 0;
                    const lineSubtotal = (l.qty > 0 ? l.qty : 0) * unitCostNum;
                    const availableStoreImeis = storeImeis[p.id] ?? [];

                    return (
                      <div
                        key={l.productId}
                        className={cx(
                          'rounded-[12px] border bg-white p-3.5 transition',
                          rowErrors.length > 0 ? 'border-red-300' : 'border-[#E2E8F0]',
                        )}
                      >
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                          <div className="flex min-w-0 items-start gap-3">
                            <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-[8px] border border-[#E2E8F0] bg-[#F8FAFC] text-[#64748B]">
                              {p.imageUrl ? (
                                <img src={p.imageUrl} alt={p.name} className="h-full w-full object-contain p-0.5" />
                              ) : p.type === 'phone' ? (
                                <PhoneIcon width={18} height={18} />
                              ) : (
                                <BoxIcon width={18} height={18} />
                              )}
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="text-[14.5px] font-bold text-[#0F172A]">{p.name}</p>
                                <StockBadge status={p.shopStatus} />
                              </div>
                              <p className="mt-0.5 text-[12.5px] text-[#64748B]">
                                {p.detail ? `${p.detail} · ` : ''}
                                {p.type === 'phone' ? 'IMEI' : tr('Kwa idadi')}
                                {' · '}
                                <span className="font-semibold text-[#0F172A]">
                                  {tr('Zilizopo store')}: {formatNumber(p.storeQty)}
                                </span>
                              </p>
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#E2E8F0] pt-3 lg:border-t-0 lg:pt-0">
                            <div>
                              <span className="mb-1 block text-[11.5px] font-medium text-[#64748B]">
                                {tr('Idadi ya kuhamisha')}
                              </span>
                              <div className="inline-flex items-center rounded-[10px] border border-[#E2E8F0] bg-[#F8FAFC] p-0.5">
                                <button
                                  type="button"
                                  aria-label={tr('Punguza')}
                                  onClick={() => handleStoreQtyChange(l, Math.max(1, l.qty - 1))}
                                  className="flex h-9 w-9 items-center justify-center rounded-[8px] bg-white text-[16px] font-bold text-[#0F172A] shadow-2xs hover:bg-slate-50"
                                >
                                  −
                                </button>
                                <input
                                  type="number"
                                  min={1}
                                  max={p.storeQty}
                                  aria-label={`${tr('Idadi')} ${p.name}`}
                                  value={l.qty || ''}
                                  onChange={(e) => handleStoreQtyChange(l, Number(e.target.value))}
                                  className="h-9 w-14 bg-transparent text-center text-[14px] font-bold tabular-nums text-[#0F172A] outline-none"
                                />
                                <button
                                  type="button"
                                  aria-label={tr('Ongeza')}
                                  disabled={l.qty >= p.storeQty}
                                  onClick={() => handleStoreQtyChange(l, l.qty + 1)}
                                  className="flex h-9 w-9 items-center justify-center rounded-[8px] bg-[#2563EB] text-[16px] font-bold text-white shadow-2xs hover:bg-[#1D4ED8] disabled:bg-slate-200 disabled:text-slate-400"
                                >
                                  +
                                </button>
                              </div>
                            </div>

                            {isOwner && (
                              <div className="flex items-center gap-3">
                                <div className="text-right">
                                  <span className="block text-[11.5px] text-[#64748B]">{tr('Bei ya kununua')}</span>
                                  <span className="text-[13.5px] font-semibold tabular-nums text-[#334155]">
                                    {formatTZS(p.costPrice ?? 0)}
                                  </span>
                                </div>
                                <div className="min-w-[96px] text-right">
                                  <span className="block text-[11.5px] text-[#64748B]">{tr('Jumla ndogo')}</span>
                                  <span className="text-[14px] font-bold tabular-nums text-[#0F172A]">
                                    {formatTZS(lineSubtotal)}
                                  </span>
                                </div>
                              </div>
                            )}

                            <button
                              type="button"
                              onClick={() => removeStoreLine(l.productId)}
                              className="inline-flex min-h-[38px] items-center rounded-[8px] border border-red-200 bg-bad-bg/50 px-3 text-[12.5px] font-semibold text-bad-fg hover:bg-bad-bg"
                            >
                              {tr('Ondoa')}
                            </button>
                          </div>
                        </div>

                        {/* Store IMEI Selection for Phones */}
                        {p.type === 'phone' && (
                          <div className="mt-3 rounded-[10px] border border-[#E2E8F0] bg-[#F8FAFC] p-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <p className="text-[12.5px] font-semibold text-[#0F172A]">
                                {tr('IMEI za {name} zinazohamia dukani ({a}/{b})', {
                                  name: p.name,
                                  a: l.imeis.length,
                                  b: l.qty,
                                })}
                              </p>
                              <span className="text-[11.5px] text-[#64748B]">
                                {tr('Bonyeza IMEI kuchagua au kubadilisha kifaa')}
                              </span>
                            </div>
                            <div className="mt-2 flex max-h-32 flex-wrap gap-1.5 overflow-y-auto">
                              {availableStoreImeis.map((imei) => {
                                const picked = l.imeis.includes(imei);
                                return (
                                  <button
                                    key={imei}
                                    type="button"
                                    aria-pressed={picked}
                                    onClick={() => toggleStoreImei(l, imei)}
                                    className={cx(
                                      'rounded-[7px] border px-2.5 py-1 font-mono text-[12px] font-medium transition',
                                      picked
                                        ? 'border-[#2563EB] bg-[#2563EB] text-white'
                                        : 'border-[#E2E8F0] bg-white text-[#334155] hover:border-[#2563EB]',
                                    )}
                                  >
                                    {imei}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {rowErrors.length > 0 && (
                          <div className="mt-2.5 space-y-1 rounded-[8px] bg-bad-bg/70 px-3 py-2 text-[12px] font-medium text-bad-fg">
                            {rowErrors.map((err) => (
                              <p key={err}>{tr(err)}</p>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </Card>

          {/* Store Transfer Summary & Actions */}
          <Card className="border-[#E2E8F0] p-4 sm:p-5">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div className="space-y-1.5">
                <h2 className="text-[15px] font-bold text-[#0F172A]">{tr('Muhtasari wa stock')}</h2>
                {storeLines.length === 0 ? (
                  <p className="text-[13px] text-[#64748B]">{tr('Chagua angalau bidhaa moja ili kuona muhtasari.')}</p>
                ) : (
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[13.5px]">
                    <span className="text-[#334155]">
                      {tr('Aina za bidhaa')}: <b className="text-[#0F172A]">{totalProductTypes}</b>
                    </span>
                    <span className="text-[#334155]">
                      {tr('Jumla ya vipande')}: <b className="text-[#0F172A]">{formatNumber(totalUnits)}</b>
                    </span>
                    {isOwner && totalValue > 0 && (
                      <span className="text-[#334155]">
                        {tr('Thamani ya stock')}: <b className="text-[#0F172A]">{formatTZS(totalValue)}</b>
                      </span>
                    )}
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-[#EEF3FF] px-3 py-1 text-[12.5px] font-bold text-[#2563EB]">
                      Store: -{formatNumber(totalUnits)} → {tr('Duka')}: +{formatNumber(totalUnits)}
                    </span>
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center justify-end gap-2.5">
                <Button loading={transferMut.isPending}
                  variant="outline"
                  className="min-h-[44px] flex-1 sm:flex-initial"
                  disabled={storeLines.length === 0 || transferMut.isPending}
                  onClick={() => {
                    setStoreLines([]);
                    setSuccessMsg('');
                  }}
                >
                  {tr('Ghairi')}
                </Button>
                <Button
                  className="min-h-[44px] flex-1 px-5 sm:flex-initial"
                  disabled={!canSubmitTransfer}
                  onClick={() => {
                    if (canSubmitTransfer) transferMut.mutate(transferPayload);
                  }}
                >
                  {transferMut.isPending ? tr('Inahamisha…') : tr('Thibitisha uhamisho')}
                </Button>
              </div>
            </div>

            {transferMut.isError && (
              <p role="alert" className="mt-3 rounded-[8px] bg-bad-bg px-3.5 py-2.5 text-[12.5px] font-medium text-bad-fg">
                {tr((transferMut.error as Error).message)}
              </p>
            )}
          </Card>
        </>
      ) : (
        /* WORKFLOW 2: ADD NEW STOCK — Create New Products Only (No Existing Catalogue Listed) */
        <Card className="border-[#E2E8F0] p-4 sm:p-5">
          <div className="flex flex-col gap-3 border-b border-[#E2E8F0] pb-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <h2 className="text-[16px] font-bold text-[#0F172A]">{tr('Sajili bidhaa mpya dukani')}</h2>
              <p className="mt-0.5 text-[13px] text-[#64748B]">
                {tr('Chaguo hili ni kwa ajili ya kusajili bidhaa mpya ambazo hazipo kwenye mfumo na kuweka idadi yake ya awali moja kwa moja Dukani.')}
              </p>
            </div>
            <Button
              type="button"
              className="min-h-[44px] shrink-0 px-4 text-[13.5px]"
              onClick={() => {
                setSuccessMsg('');
                setShowCreateProductForm(true);
              }}
            >
              <PlusIcon width={16} height={16} />
              {tr('+ Unda bidhaa mpya')}
            </Button>
          </div>

          {!showCreateProductForm ? (
            <div className="mt-4 flex flex-col items-center justify-center rounded-[12px] border border-dashed border-[#E2E8F0] bg-[#F8FAFC] px-4 py-8 text-center">
              <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[#EEF3FF] text-[#2563EB]">
                <BoxIcon width={24} height={24} />
              </span>
              <h3 className="text-[15px] font-bold text-[#0F172A]">{tr('Bidhaa mpya pekee')}</h3>
              <p className="mt-1 max-w-md text-[13px] text-[#64748B]">
                {tr('Bonyeza "+ Unda bidhaa mpya" kusajili bidhaa mpya na kuingiza idadi yake ya awali moja kwa moja Dukani (stock ya Store haibadiliki).')}
              </p>
              <Button
                type="button"
                className="mt-4 min-h-[44px] px-5 text-[13.5px]"
                onClick={() => {
                  setSuccessMsg('');
                  setShowCreateProductForm(true);
                }}
              >
                <PlusIcon width={16} height={16} />
                {tr('+ Unda bidhaa mpya')}
              </Button>
            </div>
          ) : (
            <div className="mt-4 max-h-[75dvh] overflow-y-auto pr-0.5 sm:max-h-none sm:overflow-visible">
              <div className="mx-auto max-w-2xl rounded-[12px] border border-[#E2E8F0] bg-white p-3.5 sm:p-5">
                <CreateProductForm
                  hideHeading
                  onCancel={() => setShowCreateProductForm(false)}
                  onSwitchToStore={() => {
                    setShowCreateProductForm(false);
                    setSource('store');
                  }}
                  onCreated={(_createdId, created) => {
                    invalidateAll();
                    setShowCreateProductForm(false);
                    setSuccessMsg(() => () =>
                      tr('Bidhaa mpya "{1}" imesajiliwa na vipande {2} vimeongezwa moja kwa moja Dukani.', {
                        1: created.name,
                        2: created.initialShopQty,
                      }),
                    );
                  }}
                />
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
