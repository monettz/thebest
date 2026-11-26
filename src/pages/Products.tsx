import { type ChangeEvent, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useSuccess } from '@/components/SuccessDialog';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  productSchema,
  productUpdateSchema,
  validateImageFile,
  type ProductFormValues,
  type ProductInput,
  type ProductUpdateInput,
} from '@shared/schemas';
import { luhnValid } from '@shared/sales';
import { parseImeis } from '@shared/stock';
import { useAuth } from '@/lib/auth';
import { useLocationCode } from '@/lib/location';
import { formatNumber, formatTZS, formatTZSCompact } from '@/lib/format';
import {
  createProduct,
  currentSettings,
  archiveProduct,
  deleteProduct,
  listProducts,
  updateProduct,
  updateProductImage,
  type ProductRow,
} from '@/mock/api';
import { allImeis } from '@/mock/inventory';
import { Badge, Button, Card, Field, PageHeader, Spinner, StockBadge, Tabs, cx } from '@/components/ui';
import { BoxIcon, PhoneIcon, SearchIcon } from '@/components/ui/icons';
import { tr } from '@/i18n';

/** A price, or "Haijawekwa" while it is not set yet (0): Store products may wait for their prices. */
const priceText = (n: number | undefined | null) => (n && n > 0 ? formatTZS(n) : tr('Haijawekwa'));

type Filter = 'all' | 'phone' | 'accessory' | 'low' | 'out';
const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'Zote' },
  { value: 'phone', label: 'Simu' },
  { value: 'accessory', label: 'Accessories' },
  { value: 'low', label: 'Chini ya kiwango' },
  { value: 'out', label: 'Imeisha' },
];

export default function Products() {
  const { user, isOwner } = useAuth();
  const role = user!.role;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { code } = useLocationCode();
  const { data: allProducts } = useQuery({ queryKey: ['products', role, 'with-archived'], queryFn: () => listProducts(role, { includeArchived: true }) });
  const [showArchived, setShowArchived] = useState(false);
  const archivedCount = allProducts?.filter((p) => p.archived).length ?? 0;
  // Archived products are kept for history but hidden unless asked for; the summary cards count live products only.
  const products = allProducts?.filter((p) => !!p.archived === showArchived);

  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const [banner, setBanner] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);

  // Image upload & management state
  const rowFileInputRef = useRef<HTMLInputElement>(null);
  const [imageModalProduct, setImageModalProduct] = useState<ProductRow | null>(null);
  const [imagePreview, setImagePreview] = useState<string>('');
  const [imageFileName, setImageFileName] = useState<string>('');
  const [imageError, setImageError] = useState<string>('');
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [confirmRemoveImage, setConfirmRemoveImage] = useState(false);

  // View Details, Edit & Delete modals
  const [detailProduct, setDetailProduct] = useState<ProductRow | null>(null);
  const [editingProduct, setEditingProduct] = useState<ProductRow | null>(null);
  const [deletingProduct, setDeletingProduct] = useState<ProductRow | null>(null);

  const showBanner = (tone: 'ok' | 'bad', text: string) => {
    setBanner({ tone, text });
    setTimeout(() => setBanner((prev) => (prev?.text === text ? null : prev)), 3500);
  };

  const invalidateCatalog = () => {
    void qc.invalidateQueries({ queryKey: ['products'] });
    void qc.invalidateQueries({ queryKey: ['pos-products'] });
    void qc.invalidateQueries({ queryKey: ['store-dashboard'] });
  };

  const saveImage = useMutation({
    mutationFn: async ({ id, url }: { id: number; url: string | null; name: string }) => {
      setUploadProgress(25);
      await new Promise((r) => setTimeout(r, 60));
      setUploadProgress(75);
      await updateProductImage(user!, id, url);
      setUploadProgress(100);
    },
    onSuccess: (_, vars) => {
      invalidateCatalog();
      setUploadProgress(null);
      setImageModalProduct(null);
      setImagePreview('');
      setImageFileName('');
      setImageError('');
      setConfirmRemoveImage(false);
      showBanner('ok', vars.url ? `Picha ya ${vars.name} imehifadhiwa.` : `Picha ya ${vars.name} imeondolewa.`);
    },
    onError: (err) => {
      setUploadProgress(null);
      setImageError((err as Error).message);
    },
  });

  const removeProd = useMutation({
    mutationFn: (id: number) => deleteProduct(user!, id),
    onSuccess: () => {
      invalidateCatalog();
      setDeletingProduct(null);
      showBanner('ok', 'Bidhaa imefutwa.');
    },
    onError: (err) => {
      const msg = (err as Error).message;
      setDeletingProduct(null);
      showBanner('bad', msg);
    },
  });

  const toggleArchive = useMutation({
    mutationFn: ({ id, archived }: { id: number; name: string; archived: boolean }) => archiveProduct(user!, id, archived),
    onSuccess: (_, v) => {
      invalidateCatalog();
      showBanner('ok', v.archived ? `${v.name} imefichwa. Historia yake imebaki.` : `${v.name} imerudishwa kwenye orodha.`);
    },
    onError: (err) => showBanner('bad', (err as Error).message),
  });

  /** Validate file (JPG, JPEG, PNG, WEBP <= 5MB) and load DataURL preview. */
  const handleValidatedFile = (
    e: ChangeEvent<HTMLInputElement>,
    onValid: (dataUrl: string, fileName: string) => void,
    onError: (msg: string) => void,
  ) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const validationErr = validateImageFile(file);
    if (validationErr) {
      onError(validationErr);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        onValid(reader.result, file.name);
      } else {
        onError('Imeshindikana kusoma picha.');
      }
    };
    reader.onerror = () => onError('Imeshindikana kusoma picha.');
    reader.readAsDataURL(file);
  };

  /** Clicking "Add image" on a row opens the file picker and prepares the preview modal for that product. */
  const triggerAddImageForProduct = (p: ProductRow, openPickerImmediately: boolean) => {
    setImageModalProduct(p);
    setImagePreview(p.imageUrl ?? '');
    setImageFileName('');
    setImageError('');
    setConfirmRemoveImage(false);
    if (openPickerImmediately) {
      setTimeout(() => rowFileInputRef.current?.click(), 0);
    }
  };

  if (!products || !allProducts) return <Spinner variant="products" />;

  const storeView = code === 'STORE';
  const locStatus = (p: ProductRow) => (storeView ? p.storeStatus : p.shopStatus);

  // Search by name, model/detail, SKU/code, barcode, or IMEI
  const needle = q.trim().toLowerCase();
  const rows = products.filter((p) => {
    const st = locStatus(p);
    const matchesFilter =
      filter === 'all' ||
      (filter === 'phone' && p.type === 'phone') ||
      (filter === 'accessory' && p.type === 'accessory') ||
      (filter === 'low' && st === 'CHINI') ||
      (filter === 'out' && st === 'IMEISHA');
    if (!matchesFilter) return false;
    if (!needle) return true;
    return (
      p.name.toLowerCase().includes(needle) ||
      p.detail.toLowerCase().includes(needle) ||
      p.code.toLowerCase().includes(needle) ||
      (p.barcode?.toLowerCase().includes(needle) ?? false) ||
      p.storeImeis.some((imei) => imei.includes(needle)) ||
      p.shopImeis.some((imei) => imei.includes(needle))
    );
  });

  // Summary card metrics calculated from actual database records without duplicate counting
  const live = allProducts.filter((p) => !p.archived);
  const storeValue = live.reduce((s, p) => s + p.storeQty * (p.costPrice ?? 0), 0);
  const shopValue = live.reduce((s, p) => s + p.shopQty * (p.costPrice ?? 0), 0);
  const lowCount = live.filter((p) => locStatus(p) === 'CHINI').length;
  const outCount = live.filter((p) => locStatus(p) === 'IMEISHA').length;

  return (
    <div className="grid gap-6">
      {/* Hidden file input shared by "Add image" links and modal "Choose image" button */}
      <input
        ref={rowFileInputRef}
        type="file"
        accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
        className="sr-only"
        onChange={(e) =>
          handleValidatedFile(
            e,
            (dataUrl, name) => {
              setImagePreview(dataUrl);
              setImageFileName(name);
              setImageError('');
              setConfirmRemoveImage(false);
            },
            (errMsg) => setImageError(errMsg),
          )
        }
      />

      <div className="min-w-0">
        <PageHeader
          title={storeView ? tr('Bidhaa za store') : tr('Bidhaa na stock')}
          subtitle="Bidhaa zote, bei zake, na idadi iliyopo store na dukani."
          actions={
            <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
              {storeView && (
                <Button
                  variant="outline"
                  className="min-h-[42px] flex-1 sm:flex-initial"
                  onClick={() => navigate('/store/receive')}
                >
                  {tr('Pokea mzigo')}
                </Button>
              )}
              <Button
                variant={storeView ? 'primary' : 'outline'}
                className="min-h-[42px] flex-1 sm:flex-initial"
                onClick={() => navigate('/stock-in')}
              >
                {tr('Ingiza stock')}
              </Button>
            </div>
          }
        />

        {/* 1. Four Summary Cards: 2-column grid on mobile/tablet, 4-column on desktop */}
        <div className="mb-5 grid grid-cols-2 gap-2.5 sm:gap-3 md:mb-6 lg:grid-cols-4">
          <div className="flex min-h-[96px] flex-col justify-between rounded-[14px] border border-line bg-white p-3.5 shadow-2xs sm:p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted sm:text-[12px]">
              {tr('Aina za bidhaa')}
            </p>
            <p className="mt-1.5 text-[21px] font-extrabold leading-tight tracking-tight tabular-nums text-ink sm:text-[24px]">
              {String(live.length)}
            </p>
            <p className="mt-1.5 text-[12px] leading-snug text-muted">{tr('kwenye orodha ya duka')}</p>
          </div>

          {isOwner ? (
            <>
              <div className="flex min-h-[96px] flex-col justify-between rounded-[14px] border border-line bg-white p-3.5 shadow-2xs sm:p-4">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted sm:text-[12px]">
                  {tr('Thamani store')}
                </p>
                <p className="mt-1.5 text-[20px] font-extrabold leading-tight tracking-tight tabular-nums text-ink sm:text-[24px]">
                  {formatTZSCompact(storeValue)}
                </p>
                <p className="mt-1.5 text-[12px] leading-snug text-muted">{tr('kwa bei ya kununua')}</p>
              </div>
              <div className="flex min-h-[96px] flex-col justify-between rounded-[14px] border border-line bg-white p-3.5 shadow-2xs sm:p-4">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted sm:text-[12px]">
                  {tr('Thamani dukani')}
                </p>
                <p className="mt-1.5 text-[20px] font-extrabold leading-tight tracking-tight tabular-nums text-ink sm:text-[24px]">
                  {formatTZSCompact(shopValue)}
                </p>
                <p className="mt-1.5 text-[12px] leading-snug text-muted">{tr('kwa bei ya kununua')}</p>
              </div>
            </>
          ) : (
            <>
              <div className="flex min-h-[96px] flex-col justify-between rounded-[14px] border border-line bg-white p-3.5 shadow-2xs sm:p-4">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted sm:text-[12px]">
                  {tr('Store')}
                </p>
                <p className="mt-1.5 text-[21px] font-extrabold leading-tight tracking-tight tabular-nums text-ink sm:text-[24px]">
                  {formatNumber(live.reduce((s, p) => s + p.storeQty, 0))}
                </p>
                <p className="mt-1.5 text-[12px] leading-snug text-muted">{tr('jumla ya vifaa store')}</p>
              </div>
              <div className="flex min-h-[96px] flex-col justify-between rounded-[14px] border border-line bg-white p-3.5 shadow-2xs sm:p-4">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted sm:text-[12px]">
                  {tr('Dukani')}
                </p>
                <p className="mt-1.5 text-[21px] font-extrabold leading-tight tracking-tight tabular-nums text-ink sm:text-[24px]">
                  {formatNumber(live.reduce((s, p) => s + p.shopQty, 0))}
                </p>
                <p className="mt-1.5 text-[12px] leading-snug text-muted">{tr('jumla ya vifaa dukani')}</p>
              </div>
            </>
          )}

          <div className="flex min-h-[96px] flex-col justify-between rounded-[14px] border border-line bg-white p-3.5 shadow-2xs sm:p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted sm:text-[12px]">
              {tr('Chini ya kiwango')}
            </p>
            <p className="mt-1.5 text-[21px] font-extrabold leading-tight tracking-tight tabular-nums text-warn-fg sm:text-[24px]">
              {String(lowCount)}
            </p>
            <p className="mt-1.5 text-[12px] leading-snug text-muted">
              {outCount > 0 ? tr('{n} zimeisha', { n: outCount }) : tr('zinazohitaji kuagizwa')}
            </p>
          </div>
        </div>

        {banner && (
          <p
            role="status"
            className={cx(
              'mb-4 rounded-[10px] px-3.5 py-2.5 text-[13px] font-medium',
              banner.tone === 'ok' ? 'bg-ok-bg text-ok-fg' : 'bg-bad-bg text-bad-fg',
            )}
          >
            {tr(banner.text)}
          </p>
        )}

        {/* 4. Filters and Search: Horizontally scrollable filters on top, full-width search below on mobile */}
        <div className="flex flex-col gap-2.5 md:flex-row md:items-center md:justify-between md:gap-3">
          <div className="flex w-full flex-wrap items-center gap-2 md:w-auto">
            <Tabs value={filter} onChange={setFilter} options={FILTERS} className="w-full md:w-auto" />
            {isOwner && (archivedCount > 0 || showArchived) && (
              <button
                type="button"
                onClick={() => setShowArchived((v) => !v)}
                className={cx(
                  'min-h-[36px] rounded-[10px] border px-3 text-[12.5px] font-semibold',
                  showArchived ? 'border-primary bg-primary-tint text-primary' : 'border-line bg-white text-muted',
                )}
              >
                {showArchived ? tr('Rudi kwenye bidhaa zinazotumika') : tr('Zilizofichwa ({n})', { n: archivedCount })}
              </button>
            )}
          </div>
          <div className="relative w-full md:max-w-[320px]">
            <SearchIcon width={16} height={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
            <input
              className="h-[42px] w-full rounded-[12px] border border-line bg-white pl-10 pr-3.5 text-[14px] text-ink shadow-2xs outline-none placeholder:text-muted focus:border-primary focus:ring-2 focus:ring-primary/15"
              placeholder={tr('Tafuta bidhaa, model, SKU, barcode au IMEI…')}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
        </div>

        {/* 2. Desktop/Tablet Products Table */}
        <Card className="mt-4 hidden overflow-x-auto border-line md:block">
          <table className="w-full min-w-[700px] text-[13.5px]">
            <thead>
              <tr className="border-b border-line bg-app text-left text-[11.5px] font-bold uppercase tracking-wider text-muted">
                <th className="px-4 py-3">{tr('Bidhaa')}</th>
                {isOwner && <th className="px-3 py-3 text-right">{tr('Bei ya kununua')}</th>}
                <th className="px-3 py-3 text-right">{tr('Bei ya kuuza')}</th>
                <th className="px-3 py-3 text-right">{tr('Store')}</th>
                <th className="px-3 py-3 text-right">{tr('Dukani')}</th>
                <th className="px-3 py-3 text-right">{tr('Hali')}</th>
                <th className="px-4 py-3 text-right">{tr('Hatua')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((p) => {
                const status = locStatus(p);
                const specText =
                  p.type === 'phone'
                    ? `${p.detail ? `${p.detail} · ` : ''}IMEI`
                    : p.detail
                      ? `${p.detail} · ${tr('Kwa idadi')}`
                      : tr('Kwa idadi');

                return (
                  <tr key={p.id} className="transition-colors hover:bg-app/80">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        {/* Product Thumbnail or Neutral Placeholder */}
                        {p.imageUrl ? (
                          <button
                            type="button"
                            onClick={() =>
                              isOwner ? triggerAddImageForProduct(p, false) : setDetailProduct(p)
                            }
                            title={isOwner ? tr('Badilisha picha') : p.name}
                            className="group relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-[8px] border border-line bg-app transition hover:border-primary"
                          >
                            <img
                              src={p.imageUrl}
                              alt={p.name}
                              className="h-full w-full object-contain p-0.5"
                            />
                          </button>
                        ) : (
                          <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-[8px] border border-line bg-app text-muted">
                            {p.type === 'phone' ? (
                              <PhoneIcon width={18} height={18} />
                            ) : (
                              <BoxIcon width={18} height={18} />
                            )}
                          </span>
                        )}

                        <div className="min-w-0">
                          <p className="truncate font-semibold text-ink">{p.name}</p>
                          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[12px] text-muted">
                            <span>{specText}</span>
                            {isOwner &&
                              (p.imageUrl ? (
                                <>
                                  <span>·</span>
                                  <button
                                    type="button"
                                    onClick={() => triggerAddImageForProduct(p, false)}
                                    title={tr('Badilisha picha')}
                                    className="inline-flex items-center gap-1 rounded border border-line bg-white px-1.5 py-0.5 text-[11px] font-medium text-ink hover:border-primary"
                                  >
                                    <img
                                      src={p.imageUrl}
                                      alt=""
                                      className="h-3.5 w-3.5 object-contain"
                                    />
                                    <span>{tr('Badilisha picha')}</span>
                                  </button>
                                </>
                              ) : (
                                <>
                                  <span>·</span>
                                  <button
                                    type="button"
                                    onClick={() => triggerAddImageForProduct(p, true)}
                                    className="font-semibold text-primary hover:underline"
                                  >
                                    {tr('Weka picha')}
                                  </button>
                                </>
                              ))}
                          </div>
                        </div>
                      </div>
                    </td>
                    {isOwner && (
                      <td className="px-3 py-3 text-right tabular-nums text-muted">
                        {priceText(p.costPrice)}
                      </td>
                    )}
                    <td className="px-3 py-3 text-right font-bold tabular-nums text-ink">
                      {priceText(p.sellPrice)}
                    </td>
                    <td
                      className={cx(
                        'px-3 py-3 text-right tabular-nums',
                        storeView ? 'font-bold text-ink' : 'text-muted',
                      )}
                    >
                      {formatNumber(p.storeQty)}
                    </td>
                    <td
                      className={cx(
                        'px-3 py-3 text-right tabular-nums',
                        !storeView ? 'font-bold text-ink' : 'text-muted',
                      )}
                    >
                      {formatNumber(p.shopQty)}
                    </td>
                    <td className="px-3 py-3 text-right">
                      <StockBadge status={status} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setDetailProduct(p)}
                          className="text-[12.5px] font-semibold text-primary hover:underline"
                        >
                          {tr('Angalia')}
                        </button>
                        {isOwner && (
                          <>
                            <button
                              type="button"
                              onClick={() => setEditingProduct(p)}
                              className="text-[12.5px] font-semibold text-ink hover:text-primary hover:underline"
                            >
                              {tr('Hariri')}
                            </button>
                            <button
                              type="button"
                              disabled={toggleArchive.isPending}
                              onClick={() => toggleArchive.mutate({ id: p.id, name: p.name, archived: !p.archived })}
                              className="text-[12.5px] font-semibold text-muted hover:text-ink hover:underline"
                            >
                              {p.archived ? tr('Weka tena') : tr('Ficha')}
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeletingProduct(p)}
                              className="text-[12.5px] font-semibold text-bad-fg hover:underline"
                            >
                              {tr('Futa')}
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={isOwner ? 7 : 6} className="p-8 text-center text-muted">
                    {tr('Hakuna bidhaa iliyopatikana.')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>

        {/* 8. Mobile Product Cards (< md) */}
        <div className="mt-3.5 space-y-3 md:hidden">
          {rows.map((p) => {
            const status = locStatus(p);
            const specText =
              p.type === 'phone'
                ? `${p.detail ? `${p.detail} · ` : ''}IMEI`
                : p.detail
                  ? `${p.detail} · ${tr('Kwa idadi')}`
                  : tr('Kwa idadi');

            return (
              <div
                key={p.id}
                className="rounded-[14px] border border-line bg-white p-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]"
              >
                {/* Top Row: Thumbnail on left, Name & Specs beside thumbnail, Stock status badge visible */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    {p.imageUrl ? (
                      <button
                        type="button"
                        onClick={() =>
                          isOwner ? triggerAddImageForProduct(p, false) : setDetailProduct(p)
                        }
                        title={isOwner ? tr('Badilisha picha') : p.name}
                        className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-[10px] border border-line bg-app p-1 transition hover:border-primary"
                      >
                        <img src={p.imageUrl} alt={p.name} className="h-full w-full object-contain" />
                      </button>
                    ) : (
                      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[10px] border border-line bg-app text-muted">
                        {p.type === 'phone' ? <PhoneIcon width={20} height={20} /> : <BoxIcon width={20} height={20} />}
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="break-words text-[15px] font-bold leading-snug text-ink">{p.name}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[12.5px] leading-snug text-muted">
                        <span>{specText}</span>
                        {isOwner &&
                          (p.imageUrl ? (
                            <>
                              <span>·</span>
                              <button
                                type="button"
                                onClick={() => triggerAddImageForProduct(p, false)}
                                className="font-semibold text-primary hover:underline"
                              >
                                {tr('Badilisha picha')}
                              </button>
                            </>
                          ) : (
                            <>
                              <span>·</span>
                              <button
                                type="button"
                                onClick={() => triggerAddImageForProduct(p, true)}
                                className="font-semibold text-primary hover:underline"
                              >
                                {tr('Weka picha')}
                              </button>
                            </>
                          ))}
                      </div>
                    </div>
                  </div>
                  <div className="shrink-0">
                    <StockBadge status={status} />
                  </div>
                </div>

                {/* Middle Section: Prominent Selling Price, Secondary Buying Price, Aligned Store & Shop Quantities */}
                <div className="mt-3 rounded-[10px] border border-line/80 bg-app p-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line pb-2.5">
                    <div>
                      <span className="block text-[12px] font-medium text-muted">{tr('Bei ya kuuza')}</span>
                      <span className="text-[16px] font-bold tabular-nums text-ink">{priceText(p.sellPrice)}</span>
                    </div>
                    {isOwner ? (
                      <div className="text-right">
                        <span className="block text-[12px] text-muted">{tr('Bei ya kununua')}</span>
                        <span className="text-[13px] font-semibold tabular-nums text-body">
                          {priceText(p.costPrice)}
                        </span>
                      </div>
                    ) : (
                      <div className="text-right">
                        <span className="block text-[12px] text-muted">{tr('Jumla ya stock')}</span>
                        <span className="text-[13px] font-semibold tabular-nums text-body">
                          {formatNumber(p.storeQty + p.shopQty)}
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="mt-2.5 grid grid-cols-2 gap-2">
                    <div
                      className={cx(
                        'flex items-center justify-between rounded-[8px] border px-2.5 py-1.5',
                        storeView
                          ? 'border-blue-200 bg-blue-50/70'
                          : 'border-line bg-white',
                      )}
                    >
                      <span className="text-[12.5px] font-medium text-muted">{tr('Store')}</span>
                      <span className="text-[14px] font-bold tabular-nums text-ink">
                        {formatNumber(p.storeQty)}
                      </span>
                    </div>
                    <div
                      className={cx(
                        'flex items-center justify-between rounded-[8px] border px-2.5 py-1.5',
                        !storeView
                          ? 'border-blue-200 bg-blue-50/70'
                          : 'border-line bg-white',
                      )}
                    >
                      <span className="text-[12.5px] font-medium text-muted">{tr('Dukani')}</span>
                      <span className="text-[14px] font-bold tabular-nums text-ink">
                        {formatNumber(p.shopQty)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Action Row: 42px Touch Targets for View Details, Edit, and Delete */}
                <div className={cx('mt-3 grid gap-2', isOwner ? 'grid-cols-3' : 'grid-cols-1')}>
                  <button
                    type="button"
                    onClick={() => setDetailProduct(p)}
                    className="inline-flex min-h-[42px] items-center justify-center rounded-[10px] border border-line bg-white px-2 text-[13px] font-semibold text-primary transition hover:bg-blue-50/50 active:scale-[0.98]"
                  >
                    {tr('Angalia')}
                  </button>
                  {isOwner && (
                    <>
                      <button
                        type="button"
                        onClick={() => setEditingProduct(p)}
                        className="inline-flex min-h-[42px] items-center justify-center rounded-[10px] border border-line bg-white px-2 text-[13px] font-semibold text-ink transition hover:bg-slate-50 active:scale-[0.98]"
                      >
                        {tr('Hariri')}
                      </button>
                      <button
                        type="button"
                        disabled={toggleArchive.isPending}
                        onClick={() => toggleArchive.mutate({ id: p.id, name: p.name, archived: !p.archived })}
                        className="inline-flex min-h-[42px] items-center justify-center rounded-[10px] border border-line bg-white px-2 text-[13px] font-semibold text-muted transition hover:bg-slate-50 active:scale-[0.98]"
                      >
                        {p.archived ? tr('Weka tena') : tr('Ficha')}
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeletingProduct(p)}
                        className="inline-flex min-h-[42px] items-center justify-center rounded-[10px] border border-red-200 bg-bad-bg/60 px-2 text-[13px] font-semibold text-bad-fg transition hover:bg-bad-bg active:scale-[0.98]"
                      >
                        {tr('Futa')}
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
          {rows.length === 0 && (
            <p className="rounded-[14px] border border-line bg-white p-6 text-center text-[13.5px] text-muted">
              {tr('Hakuna bidhaa iliyopatikana.')}
            </p>
          )}
        </div>

        {!isOwner && (
          <p className="mt-3 text-[12.5px] text-muted">
            <Badge tone="blue" className="mr-2">
              {tr('Muuzaji')}
            </Badge>
            {tr('Bei za kununua zinaonekana kwa mmiliki tu.')}
          </p>
        )}
      </div>

      {/* 3. Image Upload, Preview, Replace & Remove Modal */}
      {isOwner &&
        imageModalProduct &&
        createPortal(
          <div
            className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 p-0 animate-fade-in sm:p-4"
            onClick={() => {
              if (!saveImage.isPending) setImageModalProduct(null);
            }}
          >
            <div
              role="dialog"
              aria-label={`${tr('Picha ya bidhaa')}: ${imageModalProduct.name}`}
              className="flex h-[100dvh] w-full flex-col justify-between overflow-y-auto bg-white p-4 shadow-xl sm:h-auto sm:max-w-md sm:rounded-[16px] sm:border sm:border-line sm:p-5"
              onClick={(e) => e.stopPropagation()}
            >
              <div>
                <div className="mb-4 flex items-center justify-between gap-2 border-b border-line pb-3">
                  <div>
                    <h3 className="text-[17px] font-bold text-ink">{imageModalProduct.name}</h3>
                    <p className="text-[12.5px] text-muted">{tr('Hakiki picha kabla ya kuhifadhi')}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setImageModalProduct(null)}
                    className="min-h-[38px] rounded-[8px] border border-line bg-app px-3 text-[13px] font-semibold text-muted hover:text-ink"
                  >
                    {tr('Ghairi')}
                  </button>
                </div>

                {/* Image Preview Box */}
                <div className="flex flex-col items-center justify-center rounded-[12px] border border-line bg-app p-4">
                  <div className="flex h-48 w-full items-center justify-center overflow-hidden rounded-[8px] border border-line/70 bg-white p-2 sm:h-36">
                    {imagePreview.trim() ? (
                      <img
                        src={imagePreview}
                        alt={imageModalProduct.name}
                        className="h-full w-full object-contain"
                      />
                    ) : imageModalProduct.type === 'phone' ? (
                      <PhoneIcon width={40} height={40} className="text-muted" />
                    ) : (
                      <BoxIcon width={40} height={40} className="text-muted" />
                    )}
                  </div>
                  {imageFileName && (
                    <p className="mt-2 truncate text-[12.5px] font-medium text-ink">{imageFileName}</p>
                  )}
                  <p className="mt-1 text-[12px] text-muted">
                    {tr('JPG, PNG au WEBP (kiwango cha juu MB 5)')}
                  </p>
                </div>

                {uploadProgress !== null && (
                  <div className="mt-3 space-y-1">
                    <div className="flex justify-between text-[12px] font-medium text-primary">
                      <span>{tr('Inapakia picha…')}</span>
                      <span>{uploadProgress}%</span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-blue-100">
                      <div
                        className="h-full rounded-full bg-primary transition-all duration-150"
                        style={{ width: `${uploadProgress}%` }}
                      />
                    </div>
                  </div>
                )}

                {imageError && (
                  <p role="alert" className="mt-3 rounded-[8px] bg-bad-bg px-3 py-2 text-[12.5px] font-medium text-bad-fg">
                    {tr(imageError)}
                  </p>
                )}
              </div>

              {confirmRemoveImage ? (
                <div className="mt-4 rounded-[10px] border border-red-200 bg-bad-bg/60 p-3.5">
                  <p className="text-[13px] font-medium text-bad-fg">
                    {tr('Una uhakika unataka kuondoa picha ya {1}? Bidhaa na stock hazitafutwa.', {
                      1: imageModalProduct.name,
                    })}
                  </p>
                  <div className="mt-3 flex justify-end gap-2">
                    <Button
                      variant="outline"
                      className="min-h-[40px] px-3.5 text-[13px]"
                      onClick={() => setConfirmRemoveImage(false)}
                    >
                      {tr('Ghairi')}
                    </Button>
                    <Button loading={saveImage.isPending}
                      className="min-h-[40px] bg-bad-fg px-3.5 text-[13px] text-white hover:bg-red-700"
                      disabled={saveImage.isPending}
                      onClick={() =>
                        saveImage.mutate({ id: imageModalProduct.id, url: null, name: imageModalProduct.name })
                      }
                    >
                      {tr('Thibitisha kuondoa picha')}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => rowFileInputRef.current?.click()}
                      className="inline-flex min-h-[42px] items-center rounded-[10px] border border-line bg-white px-3.5 text-[13px] font-semibold text-ink hover:bg-slate-50"
                    >
                      {tr(imagePreview ? 'Chagua picha mpya' : 'Chagua picha')}
                    </button>
                    {imageModalProduct.imageUrl && (
                      <button
                        type="button"
                        onClick={() => setConfirmRemoveImage(true)}
                        className="min-h-[42px] px-2 text-[13px] font-semibold text-bad-fg hover:underline"
                      >
                        {tr('Ondoa picha')}
                      </button>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      className="min-h-[42px] px-3.5 text-[13px]"
                      onClick={() => setImageModalProduct(null)}
                    >
                      {tr('Ghairi')}
                    </Button>
                    <Button loading={saveImage.isPending}
                      className="min-h-[42px] px-4 text-[13px]"
                      disabled={!imagePreview.trim() || saveImage.isPending}
                      onClick={() =>
                        saveImage.mutate({
                          id: imageModalProduct.id,
                          url: imagePreview,
                          name: imageModalProduct.name,
                        })
                      }
                    >
                      {saveImage.isPending ? tr('Inahifadhi…') : tr('Hifadhi picha')}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>,
          document.body,
        )}

      {/* View Product Details Modal */}
      {detailProduct && (
        <ProductDetailsModal
          product={detailProduct}
          isOwner={isOwner}
          onClose={() => setDetailProduct(null)}
        />
      )}

      {/* Edit Product Modal (Owner Only) */}
      {isOwner && editingProduct && (
        <EditProductModal
          product={editingProduct}
          onClose={() => setEditingProduct(null)}
          onSaved={() => {
            invalidateCatalog();
            setEditingProduct(null);
            showBanner('ok', 'Bidhaa imesasishwa.');
          }}
        />
      )}

      {/* Delete Product Confirmation Modal (Owner Only) */}
      {isOwner &&
        deletingProduct &&
        createPortal(
          <div
            className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 p-4 animate-fade-in"
            onClick={() => setDeletingProduct(null)}
          >
            <div
              role="dialog"
              aria-label={tr('Futa bidhaa')}
              className="w-full max-w-sm rounded-[16px] border border-line bg-white p-5 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-[16px] font-bold text-ink">{tr('Futa bidhaa')}</h3>
              <p className="mt-2 text-[13.5px] text-muted">
                {tr('Una uhakika unataka kufuta {1}?', { 1: deletingProduct.name })}
              </p>
              <p className="mt-2 text-[12.5px] font-semibold text-bad-fg">
                {tr('Bidhaa na stock yake (Store na Duka) zitafutwa kabisa, haiwezi kurudishwa.')}
              </p>
              <p className="mt-1 text-[12.5px] text-body">
                {tr('Mauzo, malipo na madeni yake yanabaki kwenye ripoti kwa jina lake.')}
              </p>
              <div className="mt-4 flex justify-end gap-2">
                <Button variant="outline" onClick={() => setDeletingProduct(null)}>
                  {tr('Ghairi')}
                </Button>
                <Button loading={removeProd.isPending}
                  className="bg-bad-fg text-white hover:bg-red-700"
                  disabled={removeProd.isPending}
                  onClick={() => removeProd.mutate(deletingProduct.id)}
                >
                  {tr('Futa')}
                </Button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

function ProductDetailsModal({
  product: p,
  isOwner,
  onClose,
}: {
  product: ProductRow;
  isOwner: boolean;
  onClose: () => void;
}) {
  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 p-0 animate-fade-in sm:p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label={`${tr('Maelezo ya bidhaa')}: ${p.name}`}
        className="flex h-[100dvh] w-full flex-col overflow-hidden bg-white shadow-xl sm:h-auto sm:max-h-[88dvh] sm:max-w-lg sm:rounded-[16px] sm:border sm:border-line"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex shrink-0 items-center justify-between border-b border-line px-4 py-3.5 sm:px-5">
          <h3 className="text-[17px] font-bold text-ink">{tr('Maelezo ya bidhaa')}</h3>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[38px] rounded-[8px] border border-line bg-app px-3 text-[13px] font-semibold text-muted hover:text-ink"
          >
            {tr('Funga')}
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-4 space-y-4 sm:p-5">
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-[12px] border border-line bg-app text-muted">
              {p.imageUrl ? (
                <img src={p.imageUrl} alt={p.name} className="h-full w-full object-contain p-1" />
              ) : p.type === 'phone' ? (
                <PhoneIcon width={28} height={28} />
              ) : (
                <BoxIcon width={28} height={28} />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <h4 className="break-words text-[18px] font-bold leading-snug text-ink">{p.name}</h4>
              <p className="mt-0.5 text-[13px] text-muted">
                {p.type === 'phone' ? tr('Simu') : tr('Accessory')}
                {p.detail ? ` · ${p.detail}` : ''} · {tr('SKU / Msimbo')}: {p.code}
                {p.barcode ? ` · ${tr('Barcode')}: ${p.barcode}` : ''}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2.5 rounded-[12px] border border-line bg-app p-3 text-[13px]">
            <div>
              <span className="block text-[12px] text-muted">{tr('Store')}</span>
              <span className="text-[17px] font-bold tabular-nums text-ink">{formatNumber(p.storeQty)}</span>
              <div className="mt-1">
                <StockBadge status={p.storeStatus} />
              </div>
            </div>
            <div>
              <span className="block text-[12px] text-muted">{tr('Dukani')}</span>
              <span className="text-[17px] font-bold tabular-nums text-ink">{formatNumber(p.shopQty)}</span>
              <div className="mt-1">
                <StockBadge status={p.shopStatus} />
              </div>
            </div>
            <div>
              <span className="block text-[12px] text-muted">{tr('Jumla ya stock')}</span>
              <span className="text-[17px] font-bold tabular-nums text-ink">{formatNumber(p.storeQty + p.shopQty)}</span>
              <p className="mt-1 text-[11.5px] text-muted">
                {tr('Kiwango cha chini')}: {p.minStock}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 rounded-[12px] border border-line p-3.5 text-[13px]">
            <div>
              <span className="block text-[12px] text-muted">{tr('Bei ya kuuza')}</span>
              <span className="text-[16px] font-bold tabular-nums text-ink">{priceText(p.sellPrice)}</span>
            </div>
            {isOwner && (
              <div>
                <span className="block text-[12px] text-muted">{tr('Bei ya kununua')}</span>
                <span className="text-[16px] font-bold tabular-nums text-ink">{priceText(p.costPrice)}</span>
              </div>
            )}
          </div>

          {p.type === 'phone' && (
            <div className="space-y-3">
              <div>
                <p className="mb-1.5 text-[13px] font-semibold text-ink">
                  {tr('IMEI zilizopo dukani ({n})', { n: p.shopImeis.length })}
                </p>
                {p.shopImeis.length > 0 ? (
                  <div className="flex max-h-36 flex-wrap gap-1.5 overflow-y-auto rounded-[10px] border border-line bg-app p-2.5">
                    {p.shopImeis.map((imei) => (
                      <span
                        key={imei}
                        className="rounded border border-line bg-white px-2 py-1 font-mono text-[12px] text-ink"
                      >
                        {imei}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-[12.5px] text-muted">{tr('Imeisha')}</p>
                )}
              </div>

              <div>
                <p className="mb-1.5 text-[13px] font-semibold text-ink">
                  {tr('IMEI zilizopo store ({n})', { n: p.storeImeis.length })}
                </p>
                {p.storeImeis.length > 0 ? (
                  <div className="flex max-h-36 flex-wrap gap-1.5 overflow-y-auto rounded-[10px] border border-line bg-app p-2.5">
                    {p.storeImeis.map((imei) => (
                      <span
                        key={imei}
                        className="rounded border border-line bg-white px-2 py-1 font-mono text-[12px] text-ink"
                      >
                        {imei}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-[12.5px] text-muted">{tr('Imeisha')}</p>
                )}
              </div>
            </div>
          )}
        </div>

        <footer className="shrink-0 border-t border-line bg-white p-4 sm:hidden">
          <Button variant="outline" block className="min-h-[44px]" onClick={onClose}>
            {tr('Funga')}
          </Button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

function EditProductModal({
  product: p,
  onClose,
  onSaved,
}: {
  product: ProductRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { user } = useAuth();
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<ProductUpdateInput>({
    resolver: zodResolver(productUpdateSchema),
    defaultValues: {
      name: p.name,
      detail: p.detail,
      type: p.type,
      // A price not set yet shows as an empty box (saved as 0 = not set), not as "0".
      costPrice: (p.costPrice || '') as unknown as number,
      sellPrice: (p.sellPrice || '') as unknown as number,
      minStock: p.minStock,
      code: p.code ?? '',
      barcode: p.barcode ?? '',
      imageUrl: p.imageUrl ?? '',
    },
  });
  const type = watch('type');

  const save = useMutation({
    mutationFn: (v: ProductUpdateInput) => updateProduct(user!, p.id, v),
    onSuccess: onSaved,
  });

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 p-0 animate-fade-in sm:p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label={`${tr('Hariri bidhaa')}: ${p.name}`}
        className="flex h-[100dvh] w-full flex-col overflow-y-auto bg-white p-4 shadow-xl sm:h-auto sm:max-w-md sm:rounded-[16px] sm:border sm:border-line sm:p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between border-b border-line pb-3">
          <h3 className="text-[17px] font-bold text-ink">{tr('Hariri bidhaa')}</h3>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[38px] rounded-[8px] border border-line bg-app px-3 text-[13px] font-semibold text-muted hover:text-ink"
          >
            {tr('Funga')}
          </button>
        </div>

        <form onSubmit={handleSubmit((v) => save.mutate(v))} className="flex flex-1 flex-col justify-between space-y-3.5" noValidate>
          <div className="space-y-3.5">
            <Field label="Jina la bidhaa" error={errors.name?.message}>
              <input className="input h-11" {...register('name')} />
            </Field>
            <Field label="Model / Maelezo (hiari)">
              <input className="input h-11" placeholder={tr('Mfano 128GB au 25W')} {...register('detail')} />
            </Field>

            <div>
              <span className="label">{tr('Aina')}</span>
              <div className="grid grid-cols-2 gap-1 rounded-[10px] border border-line bg-app p-1">
                {(['phone', 'accessory'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setValue('type', t)}
                    className={cx(
                      'min-h-[40px] rounded-[8px] text-[13.5px] font-semibold',
                      type === t ? 'bg-white text-ink shadow-sm' : 'text-muted',
                    )}
                  >
                    {t === 'phone' ? tr('Simu') : tr('Accessory')}
                  </button>
                ))}
              </div>
            </div>

            {/* With stock in the Shop both prices are needed; otherwise they may stay empty for now. */}
            <div className="grid grid-cols-2 gap-3">
              <Field label={p.shopQty > 0 ? 'Bei ya kununua' : 'Bei ya kununua (hiari)'} error={errors.costPrice?.message}>
                <input className="input h-11" inputMode="numeric" placeholder={tr('TSh')} {...register('costPrice')} />
              </Field>
              <Field label={p.shopQty > 0 ? 'Bei ya kuuza' : 'Bei ya kuuza (hiari)'} error={errors.sellPrice?.message}>
                <input className="input h-11" inputMode="numeric" placeholder={tr('TSh')} {...register('sellPrice')} />
              </Field>
            </div>

            <Field label="Tahadhari ya stock chini ikifika" error={errors.minStock?.message}>
              <input className="input h-11" inputMode="numeric" {...register('minStock')} />
              <span className="mt-1 block text-[11.5px] leading-snug text-muted">
                {tr('Onyesha tahadhari idadi ya stock ikifika au kushuka chini ya kiwango hiki.')}
              </span>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="SKU / Msimbo (hiari)">
                <input className="input h-11" placeholder={tr('Mfano A25')} {...register('code')} />
              </Field>
              <Field label="Barcode (hiari)">
                <input className="input h-11" {...register('barcode')} />
              </Field>
            </div>

            {save.isError && (
              <p className="rounded-[8px] bg-bad-bg px-3 py-2 text-[12.5px] font-medium text-bad-fg">
                {tr((save.error as Error).message)}
              </p>
            )}
          </div>

          <div className="flex justify-end gap-2 border-t border-line pt-3.5">
            <Button variant="outline" className="min-h-[44px] flex-1 sm:flex-initial" onClick={onClose}>
              {tr('Ghairi')}
            </Button>
            <Button loading={save.isPending} type="submit" className="min-h-[44px] flex-1 sm:flex-initial" disabled={save.isPending}>
              {save.isPending ? tr('Inahifadhi…') : tr('Hifadhi mabadiliko')}
            </Button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Shared product creation form used by both Products & Stock and the Add Stock "Add New Stock" workflow.
 * Requires an explicit Initial Shop Quantity (`initialShopQty`) and valid IMEIs for phones.
 */
export function CreateProductForm({
  onCreated,
  onCancel,
  onSwitchToStore,
  hideHeading,
  location = 'SHOP',
}: {
  onCreated: (createdId: number, created: ProductInput) => void;
  onCancel?: () => void;
  onSwitchToStore?: () => void;
  hideHeading?: boolean;
  /** Where the mandatory initial quantity (and phone IMEIs) are placed. The other location stays at zero. */
  location?: 'SHOP' | 'STORE';
}) {
  const { user } = useAuth();
  const showSuccess = useSuccess();
  const navigate = useNavigate();
  const [formImageError, setFormImageError] = useState('');
  const [imeiDraft, setImeiDraft] = useState('');
  const [imeiDraftError, setImeiDraftError] = useState('');

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors },
  } = useForm<ProductFormValues>({
    resolver: zodResolver(productSchema),
    defaultValues: {
      name: '',
      detail: '',
      type: 'phone',
      costPrice: undefined as unknown as number,
      sellPrice: undefined as unknown as number,
      minStock: currentSettings().defaultMinStock,
      code: '',
      barcode: '',
      imageUrl: '',
      initialShopQty: undefined as unknown as number,
      imeis: [],
    },
  });

  const type = watch('type');
  const formImageUrl = watch('imageUrl');
  const rawQty = watch('initialShopQty');
  const imeis = watch('imeis') ?? [];
  const targetQty = Number.isFinite(Number(rawQty)) && Number(rawQty) > 0 ? Math.floor(Number(rawQty)) : 0;

  const add = useMutation({
    mutationFn: (v: ProductFormValues) => createProduct(user!, v, location),
    onSuccess: (createdId, vars) => {
      const parsed = productSchema.parse(vars);
      reset();
      setFormImageError('');
      setImeiDraft('');
      setImeiDraftError('');
      showSuccess({
        title: tr('Bidhaa imehifadhiwa!'),
        message: tr('{name} imeongezwa kwenye orodha. Ingiza stock ili ianze kuuzwa.', { name: parsed.name }),
        primary: { label: tr('Ingiza stock'), onClick: () => navigate('/stock-in') },
        secondary: { label: tr('Ongeza bidhaa nyingine') },
      });
      onCreated(createdId, parsed);
    },
  });

  const handleAddImeis = (rawText: string) => {
    const tokens = parseImeis(rawText);
    if (tokens.length === 0) return;
    const known = allImeis();
    const next = [...imeis];
    let err = '';

    for (const t of tokens) {
      if (!luhnValid(t)) {
        err = tr('IMEI {1} si sahihi', { 1: t });
      } else if (next.includes(t)) {
        err = tr('IMEI {1} imeshaingizwa', { 1: t });
      } else if (known.has(t)) {
        err = tr('IMEI {1} tayari ipo kwenye mfumo', { 1: t });
      } else {
        next.push(t);
      }
    }

    setImeiDraftError(err);
    setValue('imeis', next, { shouldValidate: true });
    if (!err) {
      setImeiDraft('');
    }
  };

  const removeImei = (imei: string) => {
    setValue(
      'imeis',
      imeis.filter((x) => x !== imei),
      { shouldValidate: true },
    );
  };

  const handleFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const validationErr = validateImageFile(file);
    if (validationErr) {
      setFormImageError(validationErr);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setValue('imageUrl', reader.result);
        setFormImageError('');
      } else {
        setFormImageError('Imeshindikana kusoma picha.');
      }
    };
    reader.onerror = () => setFormImageError('Imeshindikana kusoma picha.');
    reader.readAsDataURL(file);
  };

  const imeisErrorMsg =
    (errors.imeis?.message as string | undefined) ||
    (Array.isArray(errors.imeis) ? errors.imeis.find((x) => x?.message)?.message : undefined);

  return (
    <form onSubmit={handleSubmit((v) => add.mutate(v))} className="space-y-4" noValidate>
      {!hideHeading && <h2 className="text-[18px] font-extrabold text-ink">{tr('Ongeza bidhaa mpya')}</h2>}

      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
        <Field label="Jina la bidhaa" error={errors.name?.message}>
          <input className="input h-11" placeholder={tr('Mfano Samsung A25 128GB')} {...register('name')} />
        </Field>
        <Field label="Model / Maelezo (hiari)">
          <input className="input h-11" placeholder={tr('Mfano 128GB au 25W')} {...register('detail')} />
        </Field>
      </div>

      <div>
        <span className="label">{tr('Aina')}</span>
        <div className="grid grid-cols-2 gap-1 rounded-[10px] border border-line bg-app p-1">
          {(['phone', 'accessory'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => {
                setValue('type', t, { shouldValidate: true });
                setImeiDraftError('');
              }}
              className={cx(
                'min-h-[40px] rounded-[8px] text-[13.5px] font-semibold transition-colors',
                type === t ? 'bg-white text-ink shadow-sm' : 'text-muted',
              )}
            >
              {t === 'phone' ? tr('Simu') : tr('Accessory')}
            </button>
          ))}
        </div>
      </div>

      {/* Store: prices may wait until the product moves to the Shop. Shop: it sells at once, so both are needed. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={location === 'STORE' ? 'Bei ya kununua (hiari)' : 'Bei ya kununua'} error={errors.costPrice?.message}>
          <input className="input h-11" inputMode="numeric" placeholder={tr('TSh')} {...register('costPrice')} />
        </Field>
        <Field label={location === 'STORE' ? 'Bei ya kuuza (hiari)' : 'Bei ya kuuza'} error={errors.sellPrice?.message}>
          <input className="input h-11" inputMode="numeric" placeholder={tr('TSh')} {...register('sellPrice')} />
        </Field>
      </div>
      {location === 'STORE' && (
        <p className="-mt-1 text-[12px] text-muted">
          {tr('Bei zinaweza kusubiri. Utaziweka utakapohamisha bidhaa hii Dukani.')}
        </p>
      )}

      {/* Mandatory Initial Shop Quantity */}
      <Field label={location === 'STORE' ? 'Idadi ya awali store' : 'Idadi ya awali dukani'} error={location === 'STORE' ? (errors.initialShopQty?.message as string | undefined)?.replace('dukani', 'store') : (errors.initialShopQty?.message as string | undefined)}>
        <input
          type="number"
          min={1}
          step={1}
          inputMode="numeric"
          className="input h-11 font-semibold tabular-nums"
          placeholder={tr('Weka idadi ya vipande (mfano 5)')}
          {...register('initialShopQty')}
        />
        <span className="mt-1 block text-[11.5px] leading-snug text-muted">
          {location === 'STORE' ? tr('Idadi ya vipande vinavyoingia Store (Dukani haibadiliki).') : tr('Idadi ya vipande vinavyoingia moja kwa moja Dukani (Store haibadiliki).')}
        </span>
      </Field>

      {/* IMEI Registration for IMEI-tracked phones */}
      {type === 'phone' && (
        <div className="rounded-[12px] border border-line bg-app p-3.5 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[13px] font-bold text-ink">
              {tr('IMEI za simu (hiari) ({a}/{b})', { a: imeis.length, b: targetQty })}
            </span>
            <span className="text-[11.5px] text-muted">
              {tr('Weka IMEI unazozijua tu; simu zisizo na IMEI zinahesabiwa kwa idadi.')}
            </span>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              type="text"
              inputMode="numeric"
              placeholder={tr('IMEI ya tarakimu 15')}
              value={imeiDraft}
              onChange={(e) => {
                const val = e.target.value;
                setImeiDraft(val);
                if (/[\s,;]$/.test(val) || parseImeis(val).some((t) => t.length === 15)) {
                  handleAddImeis(val);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleAddImeis(imeiDraft);
                }
              }}
              className="h-[40px] flex-1 rounded-[8px] border border-line bg-white px-3 font-mono text-[13px] text-ink outline-none focus:border-primary"
            />
            <Button
              type="button"
              variant="soft"
              className="min-h-[40px] shrink-0 px-3.5 text-[12.5px]"
              onClick={() => handleAddImeis(imeiDraft)}
            >
              {tr('+ Ongeza IMEI')}
            </Button>
          </div>

          {(imeiDraftError || imeisErrorMsg) && (
            <p role="alert" className="text-[12px] font-medium text-bad-fg">
              {imeiDraftError || tr(imeisErrorMsg!)}
            </p>
          )}

          {imeis.length > 0 && (
            <div className="flex max-h-32 flex-wrap gap-1.5 overflow-y-auto pt-0.5">
              {imeis.map((imei) => (
                <button
                  key={imei}
                  type="button"
                  title={tr('Bonyeza kuondoa')}
                  onClick={() => removeImei(imei)}
                  className="inline-flex items-center gap-1.5 rounded-[7px] border border-line bg-white px-2.5 py-1 font-mono text-[12px] text-ink hover:border-red-300 hover:bg-bad-bg/40"
                >
                  <span>{imei}</span>
                  <span className="font-sans font-bold text-bad-fg">×</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <Field label="Tahadhari ya stock chini ikifika" error={errors.minStock?.message}>
        <input className="input h-11" inputMode="numeric" {...register('minStock')} />
        <span className="mt-1 block text-[11.5px] leading-snug text-muted">
          {tr('Onyesha tahadhari idadi ya stock ikifika au kushuka chini ya kiwango hiki.')}
        </span>
      </Field>

      <Field label="Picha ya bidhaa (hiari)" error={formImageError || undefined}>
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex min-h-[38px] cursor-pointer items-center rounded-[8px] border border-line bg-white px-3 py-1.5 text-[12.5px] font-semibold text-ink hover:bg-slate-50">
              {tr('Chagua picha')}
              <input
                type="file"
                accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
                className="sr-only"
                onChange={handleFile}
              />
            </label>
            <span className="text-[11.5px] text-muted">
              {tr('JPG, PNG au WEBP (kiwango cha juu MB 5)')}
            </span>
          </div>
          {formImageUrl && (
            <div className="flex items-center gap-3 rounded-[8px] border border-line bg-app p-2">
              <span className="inline-flex h-10 w-12 items-center justify-center overflow-hidden rounded border border-line bg-white">
                <img src={formImageUrl} alt="" className="h-full w-full object-contain p-0.5" />
              </span>
              <button
                type="button"
                onClick={() => setValue('imageUrl', '')}
                className="text-[12px] font-semibold text-bad-fg hover:underline"
              >
                {tr('Ondoa picha')}
              </button>
            </div>
          )}
        </div>
      </Field>
      <p className="text-[12.5px] text-muted">{tr('Bei ya kununua inaonekana kwa mmiliki tu.')}</p>

      {add.isError && (
        <div role="alert" className="rounded-[10px] border border-red-200 bg-bad-bg px-3.5 py-2.5 text-[13px] font-medium text-bad-fg space-y-1.5">
          <p>{tr((add.error as Error).message)}</p>
          {onSwitchToStore && (
            <button
              type="button"
              onClick={onSwitchToStore}
              className="text-[12.5px] font-bold text-primary underline"
            >
              {tr('Nenda kwenye "Kutoka Store" kuhamisha stock iliyopo')}
            </button>
          )}
        </div>
      )}

      <div className={cx('flex flex-wrap gap-2.5 pt-1', onCancel ? 'justify-end' : '')}>
        {onCancel && (
          <Button variant="outline" onClick={onCancel} className="min-h-[44px] flex-1 sm:flex-initial">
            {tr('Ghairi')}
          </Button>
        )}
        <Button loading={add.isPending}
          type="submit"
          block={!onCancel}
          disabled={add.isPending}
          className={cx('min-h-[46px] px-5', onCancel && 'flex-1 sm:flex-initial')}
        >
          {add.isPending ? tr('Inahifadhi…') : tr('Hifadhi bidhaa')}
        </Button>
      </div>
      <p className="text-center text-[12px] text-muted">{tr('Mfano wa bei: {p}', { p: formatTZS(900000) })}</p>
    </form>
  );
}
