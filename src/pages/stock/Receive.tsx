import { useState, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { listProducts } from '@/mock/api';
import { addStoreStockDirect } from '@/mock/inventory';
import { Badge, Button, Card, PageHeader, Spinner, cx } from '@/components/ui';
import { BoxIcon, PlusIcon, WarehouseIcon, SearchIcon } from '@/components/ui/icons';
import { CreateProductForm } from '@/pages/Products';
import { Stepper } from '../pos/Cart';
import { formatNumber } from '@/lib/format';
import { tr } from '@/i18n';
import { parseImeis } from '@shared/stock';

interface StockLine {
  productId: number;
  qty: number;
  imeis: string[];
}

export default function Receive() {
  const { user } = useAuth();
  const role = user!.role;
  const qc = useQueryClient();

  const { data: products } = useQuery({ queryKey: ['products', role], queryFn: () => listProducts(role) });

  const [activeTab, setActiveTab] = useState<'existing' | 'new'>('existing');
  const [lines, setLines] = useState<StockLine[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDropdownId, setSelectedDropdownId] = useState<string>('');
  const [successMsg, setSuccessMsg] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [showCreateProductForm, setShowCreateProductForm] = useState(false);

  const byId = useMemo(() => new Map((products ?? []).map((p) => [p.id, p])), [products]);

  const addLine = (productId: number) => {
    const p = byId.get(productId);
    if (!p) return;
    setSuccessMsg('');
    setErrorMsg('');
    if (lines.some((l) => l.productId === productId)) return;
    setLines((ls) => [...ls, { productId, qty: 1, imeis: [] }]);
    setSelectedDropdownId('');
  };

  const removeLine = (productId: number) => {
    setLines((ls) => ls.filter((l) => l.productId !== productId));
  };

  const patchLine = (productId: number, change: Partial<StockLine>) => {
    setLines((ls) => ls.map((l) => (l.productId === productId ? { ...l, ...change } : l)));
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      // IMEI ni hiari: zinaweza kuwa 0 hadi idadi ya simu.
      for (const line of lines) {
        const prod = byId.get(line.productId);
        if (prod?.type === 'phone' && line.imeis.length > line.qty) {
          throw new Error(`Simu ${prod.name}: IMEI ${line.imeis.length} ni nyingi kuliko idadi ${line.qty}.`);
        }
      }

      return addStoreStockDirect(user!, {
        lines: lines.map((l) => ({
          productId: l.productId,
          qty: l.qty,
          imeis: l.imeis,
        })),
      });
    },
    onSuccess: (res) => {
      for (const k of ['products', 'store-feed', 'store-dashboard', 'store-imeis', 'pos-products', 'movements']) {
        void qc.invalidateQueries({ queryKey: [k] });
      }
      setLines([]);
      setSuccessMsg(`Vipande ${res.unitsAdded} vimeongezwa Store kikamilifu.`);
      setErrorMsg('');
    },
    onError: (err: Error) => {
      setErrorMsg(err.message || 'Hitilafu imetokea wakati wa kuhifadhi.');
    },
  });

  if (!products) return <Spinner variant="table" />;

  return (
    <>
      <PageHeader
        title={tr('Pokea mzigo')}
        badge={<Badge tone="navy">{tr('Store')}</Badge>}
        subtitle={tr('Ingiza mzigo mpya store. Supplier ni hiari. IMEI za simu ni hiari.')}
      />

      {successMsg && (
        <div role="status" className="mb-4 rounded-[12px] border border-emerald-200 bg-emerald-50 px-4 py-3 text-[14px] font-semibold text-emerald-800">
          ✓ {successMsg}
        </div>
      )}

      {errorMsg && (
        <div role="alert" className="mb-4 rounded-[12px] border border-rose-200 bg-rose-50 px-4 py-3 text-[14px] font-semibold text-rose-800">
          ✕ {errorMsg}
        </div>
      )}

      {/* Two clean source tabs */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => {
            setActiveTab('existing');
            setShowCreateProductForm(false);
          }}
          className={cx(
            'flex items-center gap-4 rounded-[16px] border p-4 text-left transition',
            activeTab === 'existing'
              ? 'border-[#2563EB] bg-[#EEF3FF] shadow-sm ring-2 ring-[#2563EB]/20'
              : 'border-[#E2E8F0] bg-white hover:border-slate-300',
          )}
        >
          <span className={cx(
            'flex h-12 w-12 shrink-0 items-center justify-center rounded-[12px]',
            activeTab === 'existing' ? 'bg-[#2563EB] text-white' : 'bg-slate-100 text-slate-600',
          )}>
            <WarehouseIcon width={24} height={24} />
          </span>
          <div>
            <h3 className="text-[15px] font-bold text-slate-900">Ongeza Mzigo wa Bidhaa Zilizopo</h3>
            <p className="text-[12.5px] text-slate-500">Ongeza idadi ya simu au vifaa vinavyotambulika Store.</p>
          </div>
        </button>

        <button
          type="button"
          onClick={() => {
            setActiveTab('new');
            setShowCreateProductForm(true);
          }}
          className={cx(
            'flex items-center gap-4 rounded-[16px] border p-4 text-left transition',
            activeTab === 'new'
              ? 'border-[#2563EB] bg-[#EEF3FF] shadow-sm ring-2 ring-[#2563EB]/20'
              : 'border-[#E2E8F0] bg-white hover:border-slate-300',
          )}
        >
          <span className={cx(
            'flex h-12 w-12 shrink-0 items-center justify-center rounded-[12px]',
            activeTab === 'new' ? 'bg-[#2563EB] text-white' : 'bg-slate-100 text-slate-600',
          )}>
            <PlusIcon width={24} height={24} />
          </span>
          <div>
            <h3 className="text-[15px] font-bold text-slate-900">+ Sajili Bidhaa Mpya Store</h3>
            <p className="text-[12.5px] text-slate-500">Tengeneza bidhaa mpya kabisa yenye stock ya awali Store.</p>
          </div>
        </button>
      </div>

      {activeTab === 'new' ? (
        <Card className="p-6">
          {!showCreateProductForm ? (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[#EEF3FF] text-[#2563EB]">
                <BoxIcon width={24} height={24} />
              </span>
              <h3 className="text-[15px] font-bold text-[#0F172A]">{tr('Bidhaa mpya pekee')}</h3>
              <p className="mt-1 max-w-md text-[13px] text-[#64748B]">
                Sajili bidhaa mpya moja kwa moja Store na uweke idadi yake ya awali.
              </p>
              <Button
                type="button"
                className="mt-4 min-h-[44px] px-5 text-[13.5px]"
                onClick={() => setShowCreateProductForm(true)}
              >
                <PlusIcon width={16} height={16} />
                {tr('+ Unda bidhaa mpya')}
              </Button>
            </div>
          ) : (
            <div className="mx-auto max-w-2xl rounded-[12px] border border-[#E2E8F0] bg-white p-3.5 sm:p-5">
              <CreateProductForm
                hideHeading
                onCancel={() => setShowCreateProductForm(false)}
                onCreated={(_createdId, created) => {
                  for (const k of ['products', 'store-feed', 'store-dashboard', 'store-imeis', 'pos-products', 'movements']) {
                    void qc.invalidateQueries({ queryKey: [k] });
                  }
                  setShowCreateProductForm(false);
                  setActiveTab('existing');
                  setSuccessMsg(`Bidhaa mpya "${created.name}" imesajiliwa Store kikamilifu.`);
                }}
              />
            </div>
          )}
        </Card>
      ) : (
        /* Main Workflow: Add Stock to Existing Products */
        <Card className="overflow-hidden p-5">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-[16px] font-extrabold text-slate-900">Chagua Bidhaa za Kuongeza Store</h2>
              <p className="text-[13px] text-slate-500">Tafuta kwa jina, model au SKU, kisha uweke idadi.</p>
            </div>

            <Button
              type="button"
              variant="soft"
              className="text-[13px]"
              onClick={() => {
                setActiveTab('new');
                setShowCreateProductForm(true);
              }}
            >
              <PlusIcon width={16} height={16} /> Sajili Bidhaa Mpya
            </Button>
          </div>

          {/* Search bar & dropdown */}
          <div className="mb-4 flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <SearchIcon width={16} height={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                className="h-10 w-full rounded-[10px] border border-slate-200 bg-white pl-10 pr-3 text-[13.5px] shadow-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                placeholder={tr('Tafuta bidhaa…')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            <select
              className="h-10 rounded-[10px] border border-slate-200 bg-white px-3 text-[13.5px] shadow-sm outline-none focus:border-blue-500"
              value={selectedDropdownId}
              onChange={(e) => {
                if (e.target.value) {
                  addLine(Number(e.target.value));
                }
              }}
            >
              <option value="">-- Chagua kutoka kwenye orodha --</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.detail || p.code}) - Store: {p.storeQty}
                </option>
              ))}
            </select>
          </div>

          {/* Selected Lines for Stocking */}
          {lines.length === 0 ? (
            <div className="rounded-[12px] border border-dashed border-slate-200 bg-slate-50/70 py-10 text-center text-slate-400">
              <WarehouseIcon width={36} height={36} className="mx-auto mb-2 text-slate-300" />
              <p className="text-[14px] font-medium text-slate-600">Hakuna bidhaa iliyochaguliwa bado.</p>
              <p className="text-[12.5px]">Tafuta na ubofye kwenye orodha ili kuingiza idadi au IMEI.</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[13.5px]">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-[12px] font-bold uppercase tracking-wider text-slate-500">
                      <th className="px-4 py-3">Bidhaa</th>
                      <th className="py-3">Hisa ya Sasa Store</th>
                      <th className="py-3 text-center">Idadi ya Kuongeza</th>
                      <th className="px-4 py-3 text-right">Kitendo</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {lines.map((l) => {
                      const prod = byId.get(l.productId);
                      if (!prod) return null;
                      return (
                        <tr key={l.productId} className="hover:bg-slate-50/50">
                          <td className="px-4 py-3.5">
                            <p className="font-bold text-slate-900">{prod.name}</p>
                            <p className="text-[12px] text-slate-500">{prod.detail || prod.code} · {prod.type === 'phone' ? 'Simu (IMEI)' : 'Accessory'}</p>
                          </td>
                          <td className="py-3.5 font-semibold text-slate-700">
                            {formatNumber(prod.storeQty)} vipande
                          </td>
                          <td className="py-3.5">
                            <div className="flex justify-center">
                              <Stepper
                                qty={l.qty}
                                onMinus={() => patchLine(l.productId, { qty: Math.max(1, l.qty - 1) })}
                                onPlus={() => patchLine(l.productId, { qty: l.qty + 1 })}
                              />
                            </div>

                            {/* IMEI Input for Phones */}
                            {prod.type === 'phone' && (
                              <div className="mt-2.5 max-w-sm rounded-[8px] border border-blue-100 bg-blue-50/40 p-2.5">
                                <p className="mb-1 text-[11.5px] font-bold text-blue-900">
                                  IMEI (hiari, hadi {l.qty}) · moja kwa mstari au scan:
                                </p>
                                <textarea
                                  className="w-full rounded-[6px] border border-blue-200 bg-white p-2 font-mono text-[12px] outline-none focus:border-blue-500"
                                  rows={Math.min(4, Math.max(2, l.qty))}
                                  placeholder="359200000000000"
                                  value={l.imeis.join('\n')}
                                  onChange={(e) => {
                                    const parsed = parseImeis(e.target.value);
                                    patchLine(l.productId, { imeis: parsed });
                                  }}
                                />
                                <div className="mt-1 flex items-center justify-between text-[11px]">
                                  <span className={l.imeis.length === l.qty ? 'font-bold text-emerald-600' : 'font-bold text-amber-600'}>
                                    Zimeingizwa: {l.imeis.length} / {l.qty}
                                  </span>
                                </div>
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-3.5 text-right">
                            <button
                              type="button"
                              onClick={() => removeLine(l.productId)}
                              className="text-[12px] font-bold text-rose-600 hover:text-rose-800"
                            >
                              Ondoa
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center justify-end gap-3 border-t border-slate-100 pt-4">
                <Button
                  variant="outline"
                  onClick={() => setLines([])}
                >
                  Ghairi
                </Button>
                <Button
                  loading={saveMutation.isPending}
                  disabled={saveMutation.isPending || lines.length === 0}
                  onClick={() => saveMutation.mutate()}
                  className="min-h-[42px] px-6 text-[14px]"
                >
                  Hifadhi Mzigo Store
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}
    </>
  );
}
