import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { AUDIT_LABEL, listAudit, type AuditAction } from '@/mock/audit';
import { Badge, Card, PageHeader, Spinner, Tabs } from '@/components/ui';
import { tr } from '@/i18n';

type Filter = 'all' | AuditAction;
const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'Yote' },
  { value: 'SALE_VOID', label: 'Kufuta' },
  { value: 'SALE_RETURN', label: 'Marejesho' },
  { value: 'DISCOUNT_OVER_LIMIT', label: 'Punguzo' },
  { value: 'CASH_CLOSING', label: 'Kufunga siku' },
  { value: 'STOCK_TAKE_APPROVED', label: 'Stock' },
  { value: 'SETTINGS_CHANGE', label: 'Mipangilio' },
];

export default function Audit() {
  const { user } = useAuth();
  const [filter, setFilter] = useState<Filter>('all');
  const { data } = useQuery({ queryKey: ['audit'], queryFn: () => listAudit(user!.role) });
  const rows = (data ?? []).filter((e) => filter === 'all' || e.action === filter);

  return (
    <>
      <PageHeader title="Kumbukumbu za mabadiliko" subtitle="Kila tukio nyeti: kufuta mauzo, marejesho, punguzo kubwa, kufunga siku na mabadiliko ya mipangilio." />
      <Tabs value={filter} onChange={setFilter} options={FILTERS} className="mb-4" />
      {!data ? (
        <Spinner variant="list" />
      ) : (
        <Card className="overflow-x-auto">
          {rows.length === 0 ? (
            <p className="p-8 text-center text-muted">{tr('Hakuna matukio yaliyorekodiwa bado.')}</p>
          ) : (
            <table className="w-full min-w-[560px] text-[14px]">
              <thead>
                <tr className="bg-slate-50/80 text-left text-[11.5px] font-bold uppercase tracking-wider text-slate-500">
                  <th className="px-5 py-3.5">{tr('Muda')}</th>
                  <th className="py-3.5">{tr('Aliyefanya')}</th>
                  <th className="py-3.5">{tr('Tukio')}</th>
                  <th className="px-5 py-3.5">{tr('Maelezo')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.id} className="border-t border-line-soft transition hover:bg-slate-50/70 align-top">
                    <td className="px-4 py-3 text-[13px] text-body">
                      {new Date(e.at).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="py-3 font-semibold">{e.userName}</td>
                    <td className="py-3"><Badge tone={e.action === 'SALE_VOID' ? 'bad' : e.action === 'DISCOUNT_OVER_LIMIT' ? 'warn' : 'blue'}>{tr(AUDIT_LABEL[e.action])}</Badge></td>
                    <td className="px-4 py-3 text-body">{e.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}
    </>
  );
}
