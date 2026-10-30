import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { SaleStatus } from '@shared/sales';
import { formatDate, formatTZS } from '@/lib/format';
import { listSales } from '@/mock/sales';
import { Badge, Button, Card, PageHeader, Spinner } from '@/components/ui';
import { ChevronRight, SearchIcon } from '@/components/ui/icons';
import { tr } from '@/i18n';

export function SaleStatusBadge({ status, hasReturns }: { status: SaleStatus; hasReturns?: boolean }) {
  if (status === 'VOID') return <Badge tone="bad">{tr('Imefutwa')}</Badge>;
  if (status === 'PARTIAL') return <Badge tone="warn">{tr('Deni')}</Badge>;
  return <Badge tone={hasReturns ? 'blue' : 'ok'}>{hasReturns ? tr('Imerudishwa') : tr('Imelipwa')}</Badge>;
}

export default function Sales() {
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(60);
  const { data: res } = useQuery({ queryKey: ['sales', q, limit], queryFn: () => listSales(q, limit), placeholderData: (prev) => prev });
  const data = res?.items;

  return (
    <>
      <PageHeader title="Historia ya mauzo" subtitle="Tafuta mauzo kwa namba ya risiti, mteja, bidhaa au IMEI." />
      <div className="relative mb-6 max-w-md">
        <SearchIcon width={16} height={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
        <input className="h-10 w-full rounded-xl border border-line bg-white pl-10 pr-3 text-[13.5px] shadow-sm outline-none placeholder:text-muted/70 focus:border-primary focus:ring-2 focus:ring-primary/20" placeholder={tr('TB-000001, jina, IMEI…')} value={q} onChange={(e) => { setQ(e.target.value); setLimit(60); }} />
      </div>
      {!data ? (
        <Spinner variant="list" />
      ) : (
        <Card className="overflow-hidden">
          {data.length === 0 && <p className="p-8 text-center text-muted">{tr('Hakuna mauzo yaliyopatikana.')}</p>}
          <ul className="divide-y divide-line-soft">
            {data.map((s) => (
              <li key={s.id}>
                <Link to={`/sales/${s.id}`} className="flex min-h-[64px] items-center gap-3 px-4 py-3 hover:bg-app">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14.5px] font-bold">
                      {s.receiptNo} · {tr(s.customerName)}
                    </p>
                    <p className="truncate text-[12.5px] text-muted">
                      {s.items} · {formatDate(new Date(`${s.date}T00:00:00`))}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-[14.5px] font-extrabold">{formatTZS(s.total)}</p>
                    <SaleStatusBadge status={s.status} hasReturns={s.hasReturns} />
                  </div>
                  <ChevronRight className="text-muted" width={18} height={18} />
                </Link>
              </li>
            ))}
          </ul>
          {res && res.total > res.items.length && (
            <div className="flex items-center justify-between gap-3 border-t border-line-soft px-4 py-3 text-[12.5px] text-muted">
              <span>{tr('Zinaonyeshwa {a} kati ya {b}', { a: res.items.length, b: res.total })}</span>
              <Button variant="outline" className="min-h-[36px] px-4 text-[13px]" onClick={() => setLimit(limit + 60)}>{tr('Onyesha zaidi')}</Button>
            </div>
          )}
        </Card>
      )}
    </>
  );
}
