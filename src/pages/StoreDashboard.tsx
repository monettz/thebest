import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { formatDate, formatNumber, formatTZS, formatTZSCompact } from '@/lib/format';
import { getStoreDashboard, listProducts, type ProductRow } from '@/mock/api';
import { getStoreFeed, listStockEvents } from '@/mock/inventory';
import { AnimatedNumber, Badge, Button, Card, Kpi, PageHeader, Spinner, StockBadge, Tabs } from '@/components/ui';
import { ArrowRight, BoxIcon, PhoneIcon, PlusIcon, SearchIcon } from '@/components/ui/icons';
import { tr } from '@/i18n';

type Filter = 'all' | 'phone' | 'accessory';
const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'Zote' },
  { value: 'phone', label: 'Simu' },
  { value: 'accessory', label: 'Accessories' },
];

function Thumb({ p, size }: { p: ProductRow; size: number }) {
  return (
    <span className="flex shrink-0 items-center justify-center overflow-hidden rounded-[8px] border border-line bg-app text-muted" style={{ width: size, height: size }}>
      {p.imageUrl ? (
        <img src={p.imageUrl} alt="" className="h-full w-full object-contain p-0.5" />
      ) : p.type === 'phone' ? (
        <PhoneIcon width={18} height={18} />
      ) : (
        <BoxIcon width={18} height={18} />
      )}
    </span>
  );
}

const spec = (p: ProductRow) => (p.type === 'phone' ? `${p.detail ? `${p.detail} · ` : ''}${tr('kwa IMEI')}` : `${p.detail ? `${p.detail} · ` : ''}${tr('Kwa idadi')}`);

export default function StoreDashboard() {
  const { user, isOwner } = useAuth();
  const navigate = useNavigate();
  const role = user!.role;
  const { data } = useQuery({ queryKey: ['store-dashboard', role], queryFn: () => getStoreDashboard(role) });
  const { data: products } = useQuery({ queryKey: ['products', role], queryFn: () => listProducts(role) });
  const { data: feed } = useQuery({ queryKey: ['store-feed', role], queryFn: () => getStoreFeed(role) });
  const { data: events } = useQuery({ queryKey: ['store-feed', 'events'], queryFn: async () => listStockEvents(6) });
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');

  if (!data || !products || !feed || !events) return <Spinner variant="products" />;

  const needle = q.trim().toLowerCase();
  const rows = products.filter(
    (p) =>
      (filter === 'all' || p.type === filter) &&
      (!needle ||
        p.name.toLowerCase().includes(needle) ||
        p.detail.toLowerCase().includes(needle) ||
        p.code.toLowerCase().includes(needle) ||
        (p.barcode?.toLowerCase().includes(needle) ?? false) ||
        p.storeImeis.some((i) => i.includes(needle)) ||
        p.shopImeis.some((i) => i.includes(needle))),
  );
  const low = products.filter((p) => p.storeStatus !== 'IPO').sort((a, b) => a.storeQty - b.storeQty);

  return (
    <>
      <PageHeader
        title="Store"
        badge={<Badge tone="navy">{tr('Stock kuu')}</Badge>}
        subtitle="Mzigo uliopo store, uliopokelewa na uliohamishwa dukani."
        actions={
          <>
            <Button variant="outline" onClick={() => navigate('/stock-in')}>
              <ArrowRight width={16} height={16} /> {tr('Hamisha kwenda dukani')}
            </Button>
            <Button onClick={() => navigate('/store/receive')}>
              <PlusIcon width={18} height={18} /> {tr('Pokea mzigo')}
            </Button>
          </>
        }
      />

      <div className="overflow-hidden rounded-[20px] border border-line bg-white shadow-sm">
        <div className="grid grid-cols-2 divide-y divide-line-soft md:divide-y-0 md:divide-x xl:grid-cols-4">
          {isOwner && data.stockValue !== undefined ? (
            <Kpi label="Thamani ya stock store" value={<AnimatedNumber id="store.value" value={data.stockValue} format={formatTZSCompact} />} note="kwa bei ya kununua" />
          ) : (
            <Kpi label="Aina za bidhaa" value={<AnimatedNumber id="store.types" value={products.length} />} note="zilizopo kwenye mfumo" />
          )}
          <Kpi label="Bidhaa zilizopo store" value={<AnimatedNumber id="store.items" value={data.itemCount} />} note={`simu ${data.phoneCount} · accessories ${formatNumber(data.accessoryCount)}`} />
          <Kpi label="Mzigo uliopokelewa" value={isOwner ? <AnimatedNumber id="store.recvValue" value={feed.receivedWeekValue} format={formatTZSCompact} /> : <AnimatedNumber id="store.recvCount" value={feed.receivedWeekCount} />} note={`mizigo ${feed.receivedWeekCount} wiki hii`} />
          <Kpi label="Zinazokaribia kuisha" value={<AnimatedNumber id="store.low" value={data.lowStockCount} />} tone="bad" note="bidhaa chini ya kiwango" />
        </div>
      </div>

      {low.length > 0 && (
        <Card className="mt-4 p-4">
          <h2 className="mb-2 text-[15px] font-bold">{tr('Zinazokaribia kuisha')}</h2>
          <ul className="grid gap-x-6 sm:grid-cols-2">
            {low.map((p) => (
              <li key={p.id} className="flex items-center gap-2.5 border-b border-line-soft py-2 last:border-0 sm:[&:nth-last-child(2):nth-child(odd)]:border-0">
                <Thumb p={p} size={32} />
                <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold">{p.name}</span>
                <span className="text-[12.5px] text-muted">{tr('Store')} <b className="text-ink">{formatNumber(p.storeQty)}</b> / {p.minStock}</span>
                <StockBadge status={p.storeStatus} />
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="mt-4 overflow-hidden">
        <div className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-[16px] font-bold">{tr('Stock iliyopo')}</h2>
            <p className="text-[12.5px] text-muted">{tr('Idadi store na dukani kwa kila bidhaa')}</p>
          </div>
          <div className="flex w-full flex-col gap-2.5 sm:flex-row md:w-auto">
            <Tabs value={filter} onChange={setFilter} options={FILTERS} className="w-full sm:w-auto" />
            <div className="relative w-full sm:w-[240px]">
              <SearchIcon width={16} height={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
              <input className="input h-10 min-h-0 w-full pl-10" aria-label={tr('Tafuta bidhaa au IMEI…')} placeholder={tr('Tafuta bidhaa au IMEI…')} value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
          </div>
        </div>

        <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[640px] text-[13.5px]">
            <thead>
              <tr className="bg-app/60 text-left text-[12.5px] text-muted">
                <th className="px-4 py-2.5 font-medium">{tr('Bidhaa')}</th>
                <th className="py-2.5 text-right font-medium">{tr('Store')}</th>
                <th className="py-2.5 text-right font-medium">{tr('Dukani')}</th>
                {isOwner && <th className="py-2.5 text-right font-medium">{tr('Bei ya kununua')}</th>}
                <th className="px-4 py-2.5 text-right font-medium">{tr('Hali')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className="border-t border-line-soft">
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-3">
                      <Thumb p={p} size={36} />
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-ink">{p.name}</p>
                        <p className="text-[12px] text-muted">{spec(p)}</p>
                      </div>
                    </div>
                  </td>
                  <td className="text-right font-bold tabular-nums">{formatNumber(p.storeQty)}</td>
                  <td className="text-right tabular-nums text-body">{formatNumber(p.shopQty)}</td>
                  {isOwner && <td className="text-right tabular-nums text-body">{formatTZS(p.costPrice ?? 0)}</td>}
                  <td className="px-4 text-right"><StockBadge status={p.storeStatus} /></td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={5} className="p-8 text-center text-muted">{tr('Hakuna bidhaa iliyopatikana.')}</td></tr>}
            </tbody>
          </table>
        </div>

        <ul className="divide-y divide-line-soft border-t border-line-soft md:hidden">
          {rows.map((p) => (
            <li key={p.id} className="flex items-center gap-3 px-4 py-2.5">
              <Thumb p={p} size={40} />
              <div className="min-w-0 flex-1">
                <p className="break-words text-[14px] font-bold leading-snug text-ink">{p.name}</p>
                <p className="text-[12px] text-muted">{spec(p)}</p>
                <p className="mt-0.5 text-[12.5px] text-muted">
                  {tr('Store')} <b className="tabular-nums text-ink">{formatNumber(p.storeQty)}</b> · {tr('Dukani')} <b className="tabular-nums text-ink">{formatNumber(p.shopQty)}</b>
                </p>
              </div>
              <StockBadge status={p.storeStatus} />
            </li>
          ))}
          {rows.length === 0 && <li className="p-6 text-center text-[13.5px] text-muted">{tr('Hakuna bidhaa iliyopatikana.')}</li>}
        </ul>
      </Card>

      <Card className="mt-4 p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-[15px] font-bold">{tr('Shughuli za karibuni')}</h2>
          <Link to="/store/movements" className="inline-flex min-h-[36px] items-center text-[13.5px] font-semibold text-primary-link">{tr('Ona yote')}</Link>
        </div>
        {events.length === 0 ? (
          <p className="py-4 text-center text-[13px] text-muted">{tr('Hakuna mzigo uliopokelewa wala kuhamishwa bado.')}</p>
        ) : (
          <ul className="mt-1 divide-y divide-line-soft">
            {events.map((e) => (
              <li key={`${e.kind}-${e.id}`} className="flex items-center gap-3 py-2.5">
                <Badge tone={e.kind === 'RECEIVED' ? 'ok' : 'blue'}>{e.kind === 'RECEIVED' ? tr('Imepokelewa') : tr('Imehamishwa')}</Badge>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13.5px] font-semibold">{e.title}</p>
                  <p className="text-[12px] text-muted">{e.by} · {formatDate(new Date(e.at))}</p>
                </div>
                <p className="text-[14px] font-extrabold tabular-nums">{e.qty}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
