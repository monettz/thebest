/** Shared pieces of the PDF reports: header, TSh format, period label and page numbers. */
import type { jsPDF } from 'jspdf';
import type { Range } from '@shared/money';
import { formatDate } from './format';
import { tr } from '@/i18n';

export const BLUE: [number, number, number] = [37, 99, 235];
export const MARGIN = 40;

export const tsh = (n: number) => `TSh ${Math.round(n).toLocaleString('en-US')}`;
export const isoDate = (iso: string) => formatDate(new Date(`${iso}T00:00:00`));

export const periodText = (range: Range | null) =>
  range ? (range.from === range.to ? isoDate(range.from) : `${isoDate(range.from)} - ${isoDate(range.to)}`) : tr('Muda wote');

type Doc = jsPDF & { lastAutoTable?: { finalY: number } };

export async function newDoc(title: string, range: Range | null, extra?: string) {
  const [{ default: JsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const doc = new JsPDF({ unit: 'pt', format: 'a4' }) as Doc;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(15, 23, 42);
  doc.text('THE BEST', MARGIN, 46);
  doc.setFontSize(13);
  doc.text(title, MARGIN, 66);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(100, 116, 139);
  doc.text(`${tr('Kipindi')}: ${periodText(range)}`, MARGIN, 82);
  if (extra) doc.text(extra, MARGIN, 95);
  doc.text(`${tr('Imetolewa')}: ${isoDate(new Date().toISOString().slice(0, 10))}`, doc.internal.pageSize.getWidth() - MARGIN, 46, { align: 'right' });
  doc.setDrawColor(226, 232, 240);
  doc.line(MARGIN, extra ? 103 : 90, doc.internal.pageSize.getWidth() - MARGIN, extra ? 103 : 90);
  return { doc, autoTable, startY: extra ? 118 : 106 };
}

export const endY = (doc: Doc) => doc.lastAutoTable?.finalY ?? 0;

/** Section heading; moves to a new page when there is no room left for a heading and a few rows. */
export function heading(doc: Doc, text: string, y: number, note?: string): number {
  if (y > 730) {
    doc.addPage();
    y = 50;
  }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(15, 23, 42);
  doc.text(text, MARGIN, y);
  if (note) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(100, 116, 139);
    doc.text(note, MARGIN, y + 12);
    return y + 18;
  }
  return y + 6;
}

/** Label/value lines for the totals block. */
export function totalsBlock(doc: Doc, rows: [string, string][], y: number, strongLast = false): number {
  const width = doc.internal.pageSize.getWidth();
  if (y > 700) {
    doc.addPage();
    y = 50;
  }
  doc.setFontSize(10);
  rows.forEach(([label, value], i) => {
    const strong = strongLast && i === rows.length - 1;
    doc.setFont('helvetica', strong ? 'bold' : 'normal');
    doc.setTextColor(strong ? 15 : 71, strong ? 23 : 85, strong ? 42 : 105);
    doc.text(label, MARGIN, y + i * 15);
    doc.text(value, width - MARGIN, y + i * 15, { align: 'right' });
  });
  return y + rows.length * 15 + 8;
}

export function addPageNumbers(doc: Doc) {
  const n = doc.getNumberOfPages();
  const w = doc.internal.pageSize.getWidth();
  const h = doc.internal.pageSize.getHeight();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(100, 116, 139);
    doc.text('THE BEST', MARGIN, h - 24);
    doc.text(`${tr('Ukurasa')} ${i} / ${n}`, w - MARGIN, h - 24, { align: 'right' });
  }
}

export const tableStyle = {
  styles: { fontSize: 8.5, cellPadding: 4, textColor: [15, 23, 42] as [number, number, number], lineColor: [226, 232, 240] as [number, number, number] },
  headStyles: { fillColor: BLUE, textColor: 255, fontStyle: 'bold' as const },
  alternateRowStyles: { fillColor: [248, 250, 252] as [number, number, number] },
  margin: { left: MARGIN, right: MARGIN, bottom: 40 },
};

export const fileStamp = (range: Range | null) => (range ? `${range.from}_${range.to}` : 'all');
