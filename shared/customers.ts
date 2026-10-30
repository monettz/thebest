/** Customer rules shared by the Customers page and the POS: status, duplicate detection, report periods. */
import { normalizePhone } from './schemas';
import { periodRange, type Range } from './money';

export type CustomerStatus = 'DEBT' | 'PAID' | 'NONE';

/** Debt: owes money. Paid: has bought and owes nothing. None: registered but never bought. */
export function customerStatus(purchases: number, debt: number): CustomerStatus {
  if (purchases === 0) return 'NONE';
  return debt > 0 ? 'DEBT' : 'PAID';
}

export interface DuplicateHit {
  id: number;
  name: string;
  phone: string;
  reason: 'PHONE' | 'NAME';
}

const normName = (n: string) => n.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();

function distance(a: string, b: string): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 1) return 2;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

/** Same name (any word order, one typo allowed on longer names). */
export function similarNames(a: string, b: string): boolean {
  const x = normName(a);
  const y = normName(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const sort = (s: string) => s.split(' ').sort().join(' ');
  if (sort(x) === sort(y)) return true;
  return Math.min(x.length, y.length) >= 5 && distance(x, y) <= 1;
}

/** PHONE hits are exact matches (a number belongs to one customer); NAME hits are warnings. */
export function findDuplicates(
  existing: { id: number; name: string; phone: string }[],
  input: { name: string; phone: string },
  excludeId?: number,
): DuplicateHit[] {
  const phone = input.phone.trim() ? normalizePhone(input.phone) : null;
  const hits: DuplicateHit[] = [];
  for (const c of existing) {
    if (c.id === excludeId) continue;
    if (phone && c.phone === phone) hits.push({ id: c.id, name: c.name, phone: c.phone, reason: 'PHONE' });
    else if (input.name.trim().length >= 2 && similarNames(c.name, input.name)) hits.push({ id: c.id, name: c.name, phone: c.phone, reason: 'NAME' });
  }
  return hits.sort((a, b) => (a.reason === b.reason ? 0 : a.reason === 'PHONE' ? -1 : 1));
}

/* ---------- Report periods ---------- */
export type ReportPeriod = 'today' | 'week' | 'month' | 'custom' | 'all';
export const REPORT_PERIODS: { value: ReportPeriod; label: string }[] = [
  { value: 'today', label: 'Leo' },
  { value: 'week', label: 'Wiki hii' },
  { value: 'month', label: 'Mwezi huu' },
  { value: 'custom', label: 'Kipindi maalum' },
  { value: 'all', label: 'Muda wote' },
];

/** null = all time. */
export function reportRange(kind: ReportPeriod, today: string, custom?: Range): Range | null {
  if (kind === 'all') return null;
  return periodRange(kind, today, custom);
}

export const inReport = (date: string, r: Range | null) => !r || (date >= r.from && date <= r.to);
