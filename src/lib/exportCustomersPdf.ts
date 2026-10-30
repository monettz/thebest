import { PAYMENT_LABEL } from '@shared/constants';
import type { CustomerReport } from '@/mock/sales';
import { displayPhone } from './format';
import { addPageNumbers, endY, fileStamp, heading, isoDate, newDoc, tableStyle, totalsBlock, tsh } from './pdfKit';
import { tr } from '@/i18n';
import { downloadBlob } from './saveFile';

const STATUS = { DEBT: 'Deni', PAID: 'Amelipa', NONE: 'Hajanunua' } as const;
const PAY_STATUS = { PAID: 'Imelipwa', PARTIAL: 'Sehemu', UNPAID: 'Hajalipa', VOID: 'Imefutwa' } as const;
const phone = (p: string) => (p ? displayPhone(p) : '-');

export async function exportCustomersPdf(r: CustomerReport): Promise<void> {
  const one = r.detail;
  const { doc, autoTable, startY } = await newDoc(
    one ? `${tr('Ripoti ya mteja')}: ${one.customer.name}` : tr('Ripoti ya wateja wote'),
    r.range,
    one ? `${tr('Namba ya simu')}: ${phone(one.customer.phone)}` : undefined,
  );

  let y: number;
  if (!one) {
    y = heading(doc, tr('Wateja'), startY, tr('Manunuzi na malipo ni ya kipindi kilichochaguliwa. Deni ni la sasa hivi.'));
    autoTable(doc, {
      ...tableStyle,
      startY: y,
      head: [[tr('Mteja'), tr('Namba ya simu'), tr('Manunuzi (kipindi)'), tr('Malipo (kipindi)'), tr('Deni la sasa'), tr('Hali')]],
      body: r.rows.map((x) => [
        x.customer.name,
        phone(x.customer.phone),
        `${x.purchasesCount} · ${tsh(x.purchasesAmount)}`,
        tsh(x.paymentsAmount),
        tsh(x.debt),
        tr(STATUS[x.status]),
      ]),
      columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' } },
    });
    y = totalsBlock(
      doc,
      [
        [tr('Manunuzi ya kipindi'), tsh(r.totals.purchases)],
        [tr('Malipo yaliyopokelewa kipindini'), tsh(r.totals.payments)],
        [tr('Deni lote la sasa (si la kipindi)'), tsh(r.totals.debt)],
      ],
      endY(doc) + 22,
      true,
    );
  } else {
    y = heading(doc, tr('Manunuzi ya kipindi'), startY);
    autoTable(doc, {
      ...tableStyle,
      startY: y,
      head: [[tr('Tarehe'), tr('Risiti'), tr('Bidhaa'), tr('Jumla'), tr('Amelipa'), tr('Salio'), tr('Hali')]],
      body: one.sales.length
        ? one.sales.map((s) => [isoDate(s.date), s.receiptNo, s.items, tsh(s.amount), tsh(s.paid), tsh(s.balance), tr(PAY_STATUS[s.payStatus])])
        : [[{ content: tr('Hakuna manunuzi katika kipindi hiki'), colSpan: 7, styles: { halign: 'center' } }]],
      columnStyles: { 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' } },
    });
    y = heading(doc, tr('Malipo yaliyopokelewa kipindini'), endY(doc) + 22);
    autoTable(doc, {
      ...tableStyle,
      startY: y,
      head: [[tr('Tarehe'), tr('Risiti ya mauzo'), tr('Aina'), tr('Njia'), tr('Namba ya muamala'), tr('Kiasi')]],
      body: one.payments.length
        ? one.payments.map((p) => [isoDate(p.date), p.receiptNo, p.kind === 'DEBT' ? tr('Malipo ya deni') : tr('Malipo ya mauzo'), tr(PAYMENT_LABEL[p.method]), p.reference ?? '-', tsh(p.amount)])
        : [[{ content: tr('Hakuna malipo katika kipindi hiki'), colSpan: 6, styles: { halign: 'center' } }]],
      columnStyles: { 5: { halign: 'right' } },
    });
    y = heading(doc, tr('Madeni ya sasa'), endY(doc) + 22, tr('Salio linalodaiwa sasa hivi, bila kujali kipindi.'));
    autoTable(doc, {
      ...tableStyle,
      startY: y,
      head: [[tr('Risiti'), tr('Tarehe ya mauzo'), tr('Kiasi cha mauzo'), tr('Amelipa'), tr('Salio'), tr('Tarehe ya kulipa')]],
      body: one.openDebts.length
        ? one.openDebts.map((d) => [d.receiptNo, isoDate(d.saleDate), tsh(d.total), tsh(d.paid), tsh(d.balance), d.dueDate ? isoDate(d.dueDate) : '-'])
        : [[{ content: tr('Hana deni'), colSpan: 6, styles: { halign: 'center' } }]],
      columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' } },
    });
    const row = r.rows[0];
    y = totalsBlock(
      doc,
      [
        [tr('Manunuzi ya kipindi'), tsh(row?.purchasesAmount ?? 0)],
        [tr('Malipo yaliyopokelewa kipindini'), tsh(row?.paymentsAmount ?? 0)],
        [tr('Deni la sasa (si la kipindi)'), tsh(row?.debt ?? 0)],
      ],
      endY(doc) + 22,
      true,
    );
  }
  addPageNumbers(doc);
  const name = one ? one.customer.name.replace(/[^\p{L}\p{N}]+/gu, '-') : 'wateja';
  downloadBlob(doc.output('blob'), `${name}-${fileStamp(r.range)}.pdf`);
}
