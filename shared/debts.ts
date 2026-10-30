/** Debt rules and helpers. Dates are yyyy-mm-dd strings in Africa/Dar_es_Salaam. */

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export type DueKind = 'overdue' | 'soon' | 'later';
export interface DueTag {
  kind: DueKind;
  days: number; // overdue: days late, otherwise days left
  label: string;
}

export function dueTag(dueDate: string, today: string): DueTag {
  const left = daysBetween(today, dueDate);
  if (left < 0) return { kind: 'overdue', days: -left, label: `Imepita siku ${-left}` };
  if (left === 0) return { kind: 'soon', days: 0, label: 'Leo' };
  return { kind: left <= 7 ? 'soon' : 'later', days: left, label: `Baada ya siku ${left}` };
}

/** Aging buckets by age of the sale: 0–7, 8–30, over 30 days. */
export function ageBucket(ageDays: number): 0 | 1 | 2 {
  if (ageDays <= 7) return 0;
  if (ageDays <= 30) return 1;
  return 2;
}

/** A debt payment must be a whole number > 0 and never more than the current balance. */
export function validateDebtPayment(amount: number, balance: number): string | null {
  if (!Number.isInteger(amount) || amount <= 0) return 'Weka kiasi kikubwa kuliko sifuri';
  if (balance <= 0) return 'Deni hili limeshalipwa lote';
  if (amount > balance) return 'Kiasi kinazidi deni lililobaki';
  return null;
}

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
const ddmmyyyy = (iso: string) => iso.split('-').reverse().join('/');

export function debtPaymentSms(name: string, paid: number, balance: number): string {
  const rest = balance > 0 ? `Deni lililobaki: TSh ${fmt(balance)}.` : 'Deni lako limekwisha.';
  return `THE BEST - Habari ${name}, tumepokea TSh ${fmt(paid)}. ${rest} Asante.`;
}

export function debtReminderSms(name: string, balance: number, dueDate: string, overdue: boolean): string {
  const when = overdue ? `lilipaswa kulipwa ${ddmmyyyy(dueDate)}` : `linakamilika ${ddmmyyyy(dueDate)}`;
  return `THE BEST - Habari ${name}, deni lako la TSh ${fmt(balance)} ${when}. Tafadhali lipa. Asante.`;
}

/** Reminder for a debt that has no recorded due date (we never invent one). */
export function debtReminderNoDueSms(name: string, balance: number): string {
  return `THE BEST - Habari ${name}, una deni la TSh ${fmt(balance)}. Tafadhali lipa. Asante.`;
}

export type DebtStatus = 'OUTSTANDING' | 'PARTIAL' | 'OVERDUE' | 'PAID';

/** Overdue only when a due date is recorded and has passed; a debt without a due date is never overdue. */
export function debtStatus(balance: number, paid: number, dueDate: string | null, today: string): DebtStatus {
  if (balance <= 0) return 'PAID';
  if (dueDate && dueDate < today) return 'OVERDUE';
  return paid > 0 ? 'PARTIAL' : 'OUTSTANDING';
}

/** Payment date rules: not in the future and not before the sale. */
export function validatePaymentDate(paidOn: string, saleDate: string, today: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(paidOn)) return 'Weka tarehe ya malipo';
  if (paidOn > today) return 'Tarehe ya malipo haiwezi kuwa ya kesho';
  if (paidOn < saleDate) return 'Tarehe ya malipo ni kabla ya mauzo';
  return null;
}
