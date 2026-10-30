/**
 * Receipt as a PDF sized like the thermal paper (80mm or 58mm wide, as long as the content needs),
 * plus the same receipt as plain text for WhatsApp / copy. Receipts stay in Kiswahili on purpose.
 */
import { PAYMENT_LABEL } from '@shared/constants';
import type { PaymentReceiptView, ReceiptView } from '@/mock/sales';
import type { Settings } from '@/mock/seed';
import { displayPhone, formatDate, formatNumber, formatTZS } from './format';

type Op =
  | { t: 'text'; left?: string; right?: string; bold?: boolean; big?: boolean; center?: boolean }
  | { t: 'rule' }
  | { t: 'gap' };

const MM = 2.8346; // points per millimetre

function stamp(iso: string): string {
  const d = new Date(iso);
  return `${formatDate(d)} ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
}

function saleOps(r: ReceiptView, s: Settings): Op[] {
  const ops: Op[] = [{ t: 'text', left: s.shopName, bold: true, big: true, center: true }];
  if (s.shopAddress) ops.push({ t: 'text', left: s.shopAddress, center: true });
  if (s.shopPhone) ops.push({ t: 'text', left: `Simu: ${s.shopPhone}`, center: true });
  ops.push({ t: 'rule' }, { t: 'text', left: `Risiti: ${r.receiptNo}`, bold: true }, { t: 'text', left: `Tarehe: ${stamp(r.createdAt)}` }, { t: 'text', left: `Muuzaji: ${r.userName}` });
  if (r.customer) ops.push({ t: 'text', left: `Mteja: ${r.customer.name}${r.customer.phone ? ` - ${displayPhone(r.customer.phone)}` : ''}` });
  ops.push({ t: 'rule' });
  for (const l of r.lines) {
    ops.push({ t: 'text', left: l.name, bold: true });
    if (l.imei) ops.push({ t: 'text', left: `IMEI: ${l.imei}` });
    ops.push({ t: 'text', left: `${l.qty} x ${formatNumber(l.unitPrice)}`, right: formatNumber(l.qty * l.unitPrice) }, { t: 'gap' });
  }
  ops.push({ t: 'rule' }, { t: 'text', left: 'Jumla ndogo', right: formatNumber(r.subtotal) });
  if (r.discount > 0) ops.push({ t: 'text', left: 'Punguzo', right: `-${formatNumber(r.discount)}` });
  ops.push({ t: 'text', left: 'JUMLA', right: formatTZS(r.total), bold: true, big: true }, { t: 'rule' });
  for (const p of r.payments) ops.push({ t: 'text', left: PAYMENT_LABEL[p.method], right: formatNumber(p.amount) });
  ops.push({ t: 'text', left: 'Amelipa', right: formatNumber(r.paid) });
  if (r.balance > 0) {
    ops.push({ t: 'text', left: 'DENI LINABAKI', right: formatTZS(r.balance), bold: true });
    if (r.dueDate) ops.push({ t: 'text', left: `Kulipa kabla ya: ${formatDate(new Date(`${r.dueDate}T00:00:00`))}` });
  }
  ops.push({ t: 'rule' }, { t: 'text', left: s.receiptFooter, center: true });
  return ops;
}

function paymentOps(r: PaymentReceiptView, s: Settings): Op[] {
  const ops: Op[] = [
    { t: 'text', left: s.shopName, bold: true, big: true, center: true },
    { t: 'text', left: 'RISITI YA MALIPO YA DENI', bold: true, center: true },
    { t: 'rule' },
    { t: 'text', left: `Risiti: ${r.paymentNo}`, bold: true },
    { t: 'text', left: `Mauzo asilia: ${r.receiptNo}` },
    { t: 'text', left: `Tarehe: ${stamp(r.paidAt)}` },
    { t: 'text', left: `Imepokelewa na: ${r.userName}` },
  ];
  if (r.customer) ops.push({ t: 'text', left: `Mteja: ${r.customer.name}${r.customer.phone ? ` - ${displayPhone(r.customer.phone)}` : ''}` });
  ops.push(
    { t: 'rule' },
    { t: 'text', left: 'Jumla ya mauzo', right: formatNumber(r.saleTotal) },
    { t: 'text', left: `Malipo (${PAYMENT_LABEL[r.method]})`, right: formatNumber(r.amount), bold: true },
    { t: 'text', left: 'Jumla imelipwa', right: formatNumber(r.paidToDate) },
    { t: 'text', left: r.balance > 0 ? 'DENI LINABAKI' : 'DENI', right: r.balance > 0 ? formatTZS(r.balance) : 'LIMEKWISHA', bold: true },
  );
  if (r.dueDate) ops.push({ t: 'text', left: `Kulipa kabla ya: ${formatDate(new Date(`${r.dueDate}T00:00:00`))}` });
  ops.push({ t: 'rule' }, { t: 'text', left: s.receiptFooter, center: true });
  return ops;
}

async function render(ops: Op[], printerWidth: Settings['printerWidth']): Promise<Blob> {
  const { default: JsPDF } = await import('jspdf');
  const width = (printerWidth === '58' ? 58 : 80) * MM;
  const margin = 9;
  const inner = width - margin * 2;
  const base = printerWidth === '58' ? 7.5 : 8.5;
  const gap = 5;

  type Laid = { op: Op; lines: string[]; size: number; h: number; rightW: number };
  // jsPDF swaps width and height when a page is wider than it is tall, so a short receipt must never be shorter than its width.
  const probe = new JsPDF({ unit: 'pt', format: [width, width + 10], orientation: 'portrait' });
  const laid: Laid[] = ops.map((op) => {
    if (op.t === 'rule') return { op, lines: [], size: base, h: 8, rightW: 0 };
    if (op.t === 'gap') return { op, lines: [], size: base, h: 3, rightW: 0 };
    const size = op.big ? base + 2.5 : base;
    probe.setFont('courier', op.bold ? 'bold' : 'normal');
    probe.setFontSize(size);
    const rightW = op.right ? probe.getTextWidth(op.right) + gap : 0;
    const lines = probe.splitTextToSize(op.left ?? '', Math.max(40, inner - rightW)) as string[];
    return { op, lines: lines.length ? lines : [''], size, h: lines.length * size * 1.35, rightW };
  });
  const height = Math.ceil(laid.reduce((a, l) => a + l.h, 0) + margin * 2 + 6);

  const doc = new JsPDF({ unit: 'pt', format: [width, Math.max(height, Math.ceil(width) + 2)], orientation: 'portrait' });
  doc.setTextColor(0, 0, 0);
  let y = margin;
  for (const l of laid) {
    const { op } = l;
    if (op.t === 'rule') {
      doc.setLineDashPattern([2, 2], 0);
      doc.setLineWidth(0.6);
      doc.line(margin, y + 3, width - margin, y + 3);
      doc.setLineDashPattern([], 0);
    } else if (op.t === 'text') {
      doc.setFont('courier', op.bold ? 'bold' : 'normal');
      doc.setFontSize(l.size);
      l.lines.forEach((line, i) => {
        const baseline = y + l.size * 1.05 + i * l.size * 1.35;
        if (op.center) doc.text(line, width / 2, baseline, { align: 'center' });
        else doc.text(line, margin, baseline);
        if (i === 0 && op.right) doc.text(op.right, width - margin, baseline, { align: 'right' });
      });
    }
    y += l.h;
  }
  return doc.output('blob');
}

export const receiptFileName = (receiptNo: string) => `risiti-${receiptNo.replace(/[^\p{L}\p{N}-]+/gu, '-')}.pdf`;

export const buildSaleReceiptPdf = (r: ReceiptView, s: Settings) => render(saleOps(r, s), s.printerWidth);
export const buildPaymentReceiptPdf = (r: PaymentReceiptView, s: Settings) => render(paymentOps(r, s), s.printerWidth);

/** The same receipt as plain text (WhatsApp message / clipboard). */
function toText(ops: Op[]): string {
  return ops
    .map((op) => {
      if (op.t === 'rule') return '--------------------------';
      if (op.t === 'gap') return '';
      return op.right ? `${op.left}  ${op.right}` : (op.left ?? '');
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');
}
export const saleReceiptText = (r: ReceiptView, s: Settings) => toText(saleOps(r, s));
export const paymentReceiptText = (r: PaymentReceiptView, s: Settings) => toText(paymentOps(r, s));
