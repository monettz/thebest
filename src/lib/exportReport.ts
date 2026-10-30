import { PAYMENT_LABEL } from '@shared/constants';
import { EXPENSE_LABEL } from '@shared/money';
import type { Report } from '@/mock/ledger';
import { formatDate } from './format';
import { tr } from '@/i18n';
import { downloadBlob } from './saveFile';

const PERIOD_LABEL: Record<Report['period'], string> = {
  today: 'Leo',
  week: 'Wiki hii',
  month: 'Mwezi huu',
  year: 'Mwaka huu',
  custom: 'Kipindi maalum',
};

const isoToDate = (iso: string) => formatDate(new Date(`${iso}T00:00:00`));

/** Rows shared by the Excel and PDF exports. Cost and profit rows exist only when the report carries them (owner). */
function sections(r: Report): { title: string; head: string[]; rows: (string | number)[][] }[] {
  const out: { title: string; head: string[]; rows: (string | number)[][] }[] = [];
  const summary: (string | number)[][] = [['Mauzo', r.sales], ['Idadi ya mauzo', r.count]];
  if (r.gross !== undefined) {
    summary.push(
      ['Gharama za bidhaa', r.cogs ?? 0],
      ['Faida ghafi', r.gross],
      ['Matumizi', r.expenses ?? 0],
      ['Faida halisi', r.net ?? 0],
    );
  }
  out.push({ title: 'Muhtasari', head: ['Kipengele', 'Kiasi (TSh)'], rows: summary });
  out.push({
    title: 'Njia za malipo',
    head: ['Njia', 'Kiasi (TSh)', 'Asilimia'],
    rows: r.methods.map((m) => [tr(PAYMENT_LABEL[m.method]), m.amount, `${m.pct}%`]),
  });
  out.push({
    title: r.top[0]?.profit !== undefined ? 'Bidhaa zenye faida zaidi' : 'Bidhaa zinazouzwa zaidi',
    head: r.top[0]?.profit !== undefined ? ['Bidhaa', 'Zimeuzwa', 'Faida (TSh)'] : ['Bidhaa', 'Zimeuzwa'],
    rows: r.top.map((t) => (t.profit !== undefined ? [t.name, t.qty, t.profit] : [t.name, t.qty])),
  });
  out.push({
    title: 'Miezi 6',
    head: r.months[0]?.net !== undefined ? ['Mwezi', 'Mauzo (TSh)', 'Faida halisi (TSh)'] : ['Mwezi', 'Mauzo (TSh)'],
    rows: r.months.map((m) => (m.net !== undefined ? [m.ym, m.sales, m.net] : [m.ym, m.sales])),
  });
  if (r.expensesByCategory?.length) {
    out.push({
      title: 'Matumizi kwa aina',
      head: ['Aina', 'Kiasi (TSh)'],
      rows: r.expensesByCategory.map((e) => [tr(EXPENSE_LABEL[e.category]), e.amount]),
    });
  }
  // Everything the owner reads in the file follows the interface language.
  return out.map((s) => ({ title: tr(s.title), head: s.head.map((h) => tr(h)), rows: s.rows.map((row) => row.map((c) => (typeof c === 'string' ? tr(c) : c))) }));
}

const fileName = (r: Report, ext: string) => `ripoti-${r.range.from}_${r.range.to}.${ext}`;
const heading = (r: Report) => `THE BEST - ${tr('Ripoti')}: ${tr(PERIOD_LABEL[r.period])} (${isoToDate(r.range.from)} - ${isoToDate(r.range.to)})`;

/** The export libraries are large, so they load only when the user asks for a file. */
export async function exportExcel(r: Report): Promise<void> {
  const XLSX = await import('xlsx');
  const aoa: (string | number)[][] = [[heading(r)], []];
  for (const s of sections(r)) aoa.push([s.title], s.head, ...s.rows, []);
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 30 }, { wch: 16 }, { wch: 18 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, tr('Ripoti'));
  const bytes = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
  downloadBlob(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), fileName(r, 'xlsx'));
}

export async function exportPdf(r: Report): Promise<void> {
  const [{ default: JsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const doc = new JsPDF({ unit: 'pt', format: 'a4' });
  doc.setFontSize(14);
  doc.text(heading(r), 40, 48);
  let y = 70;
  for (const s of sections(r)) {
    doc.setFontSize(11);
    doc.text(s.title, 40, y);
    autoTable(doc, {
      startY: y + 6,
      head: [s.head],
      body: s.rows.map((row) => row.map((c) => (typeof c === 'number' ? c.toLocaleString('en-US') : c))),
      styles: { fontSize: 9 },
      headStyles: { fillColor: [37, 99, 235] },
      margin: { left: 40, right: 40 },
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 24;
    if (y > 740) {
      doc.addPage();
      y = 48;
    }
  }
  downloadBlob(doc.output('blob'), fileName(r, 'pdf'));
}
