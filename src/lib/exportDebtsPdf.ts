import { PAYMENT_LABEL } from '@shared/constants';
import type { DebtReport } from '@/mock/sales';
import { displayPhone } from './format';
import { addPageNumbers, endY, fileStamp, heading, isoDate, newDoc, tableStyle, totalsBlock, tsh } from './pdfKit';
import { tr } from '@/i18n';
import { downloadBlob } from './saveFile';

export const DEBT_STATUS_LABEL = { OUTSTANDING: 'Anadaiwa', PARTIAL: 'Amelipa sehemu', OVERDUE: 'Amechelewa', PAID: 'Imelipwa' } as const;

const SCOPE_TITLE = {
  outstanding: 'Ripoti ya madeni: wateja wanaodaiwa',
  overdue: 'Ripoti ya madeni yaliyopita tarehe',
  customer: 'Ripoti ya madeni ya mteja',
} as const;

export async function exportDebtsPdf(r: DebtReport): Promise<void> {
  const title = tr(SCOPE_TITLE[r.scope]) + (r.customer ? `: ${r.customer.name}` : '');
  const { doc, autoTable, startY } = await newDoc(title, r.range, r.customer?.phone ? `${tr('Namba ya simu')}: ${displayPhone(r.customer.phone)}` : undefined);

  let y = heading(
    doc,
    tr('Madeni'),
    startY,
    r.scope === 'customer' ? tr('Madeni yaliyoanza kipindini na yanayodaiwa sasa.') : tr('Salio la sasa la kila deni, bila kujali lilianza lini. Alama * = lilianza kipindini.'),
  );
  autoTable(doc, {
    ...tableStyle,
    startY: y,
    head: [[tr('Mteja'), tr('Namba ya simu'), tr('Risiti'), tr('Tarehe ya mauzo'), tr('Kiasi'), tr('Amelipa'), tr('Salio'), tr('Tarehe ya kulipa'), tr('Hali')]],
    body: r.rows.length
      ? r.rows.map((d) => [
          d.customer.name,
          d.customer.phone ? displayPhone(d.customer.phone) : '-',
          d.receiptNo,
          `${isoDate(d.saleDate)}${r.range && d.createdInPeriod ? ' *' : ''}`,
          tsh(d.total),
          tsh(d.paid),
          tsh(d.balance),
          d.dueDate ? isoDate(d.dueDate) : tr('Haijawekwa'),
          tr(DEBT_STATUS_LABEL[d.status]),
        ])
      : [[{ content: tr('Hakuna madeni'), colSpan: 9, styles: { halign: 'center' } }]],
    styles: { ...tableStyle.styles, fontSize: 7.5 },
    columnStyles: { 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' } },
  });

  y = heading(doc, tr('Malipo ya madeni yaliyopokelewa kipindini'), endY(doc) + 22);
  autoTable(doc, {
    ...tableStyle,
    startY: y,
    head: [[tr('Tarehe'), tr('Mteja'), tr('Risiti'), tr('Njia'), tr('Namba ya muamala'), tr('Kiasi')]],
    body: r.payments.length
      ? r.payments.map((p) => [isoDate(p.date), p.customer.name, p.receiptNo, tr(PAYMENT_LABEL[p.method]), p.reference ?? '-', tsh(p.amount)])
      : [[{ content: tr('Hakuna malipo katika kipindi hiki'), colSpan: 6, styles: { halign: 'center' } }]],
    columnStyles: { 5: { halign: 'right' } },
  });

  const lines: [string, string][] = [];
  if (r.range) lines.push([tr('Madeni mapya ya kipindi (jumla ya mauzo)'), tsh(r.totals.createdInPeriod)]);
  lines.push([tr('Malipo ya madeni yaliyopokelewa kipindini'), tsh(r.totals.collectedInPeriod)]);
  if (r.scope !== 'overdue') lines.push([tr('Jumla iliyochelewa'), tsh(r.totals.overdueNow)]);
  lines.push([r.scope === 'overdue' ? tr('Jumla iliyochelewa') : tr('Jumla ya madeni yanayodaiwa sasa'), tsh(r.scope === 'overdue' ? r.totals.overdueNow : r.totals.outstandingNow)]);
  totalsBlock(doc, lines, endY(doc) + 22, true);

  addPageNumbers(doc);
  const who = r.customer ? `-${r.customer.name.replace(/[^\p{L}\p{N}]+/gu, '-')}` : '';
  downloadBlob(doc.output('blob'), `madeni-${r.scope}${who}-${fileStamp(r.range)}.pdf`);
}
