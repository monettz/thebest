import { useQuery } from '@tanstack/react-query';
import { listMovements, type Loc, type MovementType } from '@/mock/api';
import { Badge, Card, PageHeader, Spinner } from '@/components/ui';
import { ArrowRight } from '@/components/ui/icons';
import { tr } from '@/i18n';

const TYPE_LABEL: Record<MovementType, string> = {
  PURCHASE: 'Mzigo',
  TRANSFER: 'Uhamisho',
  SALE: 'Mauzo',
  RETURN: 'Rudisha',
  ADJUSTMENT: 'Marekebisho',
  DAMAGE: 'Imeharibika',
};
const place = (l: Loc | null) => (l === 'STORE' ? 'Store' : l === 'SHOP' ? 'Duka' : 'Nje');

export default function Movements() {
  const { data } = useQuery({ queryKey: ['movements'], queryFn: () => listMovements(100) });
  return (
    <>
      <PageHeader title="Ripoti za stock" subtitle="Kila badiliko la stock linaandikwa hapa; huwezi kuhariri idadi moja kwa moja." />
      {!data ? (
        <Spinner variant="list" />
      ) : (
        <Card className="overflow-x-auto">
          {data.length === 0 && <p className="p-8 text-center text-muted">{tr('Bado hakuna mabadiliko ya stock yaliyorekodiwa.')}</p>}
          {data.length > 0 && (
            <table className="w-full min-w-[560px] text-[14px]">
              <thead>
                <tr className="bg-slate-50/80 text-left text-[11.5px] font-bold uppercase tracking-wider text-slate-500">
                  <th className="px-5 py-3.5">{tr('Muda')}</th>
                  <th className="py-3.5">{tr('Bidhaa')}</th>
                  <th className="py-3.5">{tr('Aina')}</th>
                  <th className="py-3.5">{tr('Kutoka → Kwenda')}</th>
                  <th className="py-3.5 text-right">{tr('Idadi')}</th>
                  <th className="px-5 py-3.5 text-right">{tr('Aliyefanya')}</th>
                </tr>
              </thead>
              <tbody>
                {data.map((m) => (
                  <tr key={m.id} className="border-t border-line-soft transition hover:bg-slate-50/70">
                    <td className="px-4 py-3 text-[13px] text-body">
                      {new Date(m.at).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="font-semibold">{m.productName}</td>
                    <td><Badge tone={m.type === 'PURCHASE' || m.type === 'RETURN' ? 'ok' : m.type === 'SALE' ? 'blue' : 'warn'}>{tr(TYPE_LABEL[m.type])}</Badge></td>
                    <td>
                      <span className="inline-flex items-center gap-1.5 text-[13px]">
                        {place(m.from)} <ArrowRight width={13} height={13} className="text-muted" /> {place(m.to)}
                      </span>
                    </td>
                    <td className="text-right font-bold">{m.qty}</td>
                    <td className="px-4 text-right text-[13px] text-muted">{m.userName ?? '–'}</td>
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
