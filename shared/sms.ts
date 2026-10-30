import { addDays, daysBetween } from './debts';
import { normalizePhone } from './schemas';

/* ---------- Message length ---------- */
const GSM_BASIC =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const GSM_EXTENDED = '^{}\\[~]|€';

export function smsSegments(text: string): { encoding: 'GSM-7' | 'UCS-2'; length: number; segments: number } {
  let units = 0;
  let gsm = true;
  for (const ch of text) {
    if (GSM_BASIC.includes(ch)) units += 1;
    else if (GSM_EXTENDED.includes(ch)) units += 2;
    else {
      gsm = false;
      break;
    }
  }
  if (gsm) return { encoding: 'GSM-7', length: units, segments: units === 0 ? 0 : units <= 160 ? 1 : Math.ceil(units / 153) };
  const length = [...text].length;
  return { encoding: 'UCS-2', length, segments: length === 0 ? 0 : length <= 70 ? 1 : Math.ceil(length / 67) };
}

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
const ddmmyyyy = (iso: string) => iso.split('-').reverse().join('/');

/* ---------- Daily owner report (basic info only, at most 2 segments) ---------- */
export interface DailyReportData {
  date: string; // yyyy-mm-dd
  sales: number;
  expenses: number;
  net: number;
  newDebt: number;
  debtPaid: number;
  totalDebt: number;
}

/** No payment-method breakdown and no stock alerts, by design. */
export function dailyReportSms(d: DailyReportData): string {
  return (
    `THE BEST - Ripoti ${ddmmyyyy(d.date)} ` +
    `Mauzo: ${fmt(d.sales)} Matumizi: ${fmt(d.expenses)} Faida halisi: ${fmt(d.net)} ` +
    `Madeni mapya: ${fmt(d.newDebt)} Yaliyolipwa: ${fmt(d.debtPaid)} Jumla ya madeni: ${fmt(d.totalDebt)}`
  );
}

/* ---------- Customer purchase confirmation ---------- */
export function purchaseSms(p: { name: string; receiptNo: string; items: string; total: number; paid: number; balance: number; dueDate?: string | null }): string {
  const debt = p.balance > 0 ? ` Deni: TSh ${fmt(p.balance)}${p.dueDate ? ` (kulipa kabla ya ${ddmmyyyy(p.dueDate)})` : ''}.` : '';
  return `THE BEST - Asante ${p.name}. ${p.items}. Jumla TSh ${fmt(p.total)}, umelipa TSh ${fmt(p.paid)}.${debt} Risiti ${p.receiptNo}.`;
}

/* ---------- Debt reminders: 2 days before the due date, and the day after it passes ---------- */
export type ReminderKind = 'BEFORE' | 'AFTER';
export interface ReminderCandidate {
  saleId: number;
  phone: string;
  name: string;
  balance: number;
  dueDate: string;
}

export function reminderKind(dueDate: string, today: string): ReminderKind | null {
  const left = daysBetween(today, dueDate);
  if (left === 2) return 'BEFORE';
  if (left === -1) return 'AFTER';
  return null;
}

export function planDebtReminders(
  rows: ReminderCandidate[],
  today: string,
): { saleId: number; kind: ReminderKind; to: string; dedupeKey: string; due: string; name: string; balance: number }[] {
  const out: ReturnType<typeof planDebtReminders> = [];
  for (const r of rows) {
    const kind = reminderKind(r.dueDate, today);
    if (!kind || r.balance <= 0) continue;
    out.push({ saleId: r.saleId, kind, to: r.phone, dedupeKey: `reminder:${r.saleId}:${kind}:${today}`, due: r.dueDate, name: r.name, balance: r.balance });
  }
  return out;
}

/** The day before `date`, used to label a report sent shortly after midnight. */
export const previousDay = (date: string) => addDays(date, -1);

/* ---------- Gateway ---------- */
export type SmsType = 'DAILY_REPORT' | 'DEBT_PAYMENT' | 'DEBT_REMINDER' | 'PURCHASE';
export interface SmsResult {
  ok: boolean;
  providerRef?: string;
  error?: string;
}
export interface SmsGateway {
  send(to: string, body: string): Promise<SmsResult>;
}

/** Development driver: writes to the log only, nothing leaves the machine. */
export class LogDriver implements SmsGateway {
  private n = 0;
  async send(): Promise<SmsResult> {
    this.n += 1;
    return { ok: true, providerRef: `log-${this.n}` };
  }
}

/** Generic JSON-over-HTTP driver; the real Tanzanian provider is chosen later and configured by env. */
export class HttpDriver implements SmsGateway {
  constructor(
    private cfg: { url: string; apiKey: string; senderId: string },
    private fetchImpl: typeof fetch = fetch,
  ) {}
  async send(to: string, body: string): Promise<SmsResult> {
    try {
      const res = await this.fetchImpl(this.cfg.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.cfg.apiKey}` },
        body: JSON.stringify({ to, message: body, sender: this.cfg.senderId }),
      });
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
      const data = (await res.json().catch(() => ({}))) as { id?: string; messageId?: string };
      return { ok: true, providerRef: data.id ?? data.messageId };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Network error' };
    }
  }
}

export function createGateway(env: { SMS_DRIVER?: string; SMS_API_URL?: string; SMS_API_KEY?: string; SMS_SENDER_ID?: string }): SmsGateway {
  if (env.SMS_DRIVER === 'http' && env.SMS_API_URL && env.SMS_API_KEY) {
    return new HttpDriver({ url: env.SMS_API_URL, apiKey: env.SMS_API_KEY, senderId: env.SMS_SENDER_ID ?? 'THE BEST' });
  }
  return new LogDriver();
}

/* ---------- Sending with a log and a once-only guard ---------- */
export interface SmsLogEntry {
  to: string;
  body: string;
  type: SmsType;
  status: 'SENT' | 'FAILED';
  providerRef?: string;
  error?: string;
  dedupeKey?: string;
  sentAt: string;
}
export interface SmsLogStore {
  has(dedupeKey: string): boolean;
  add(entry: SmsLogEntry): void;
}

export type DispatchStatus = 'SENT' | 'FAILED' | 'DUPLICATE';

/**
 * Sends one SMS and logs it. A message with a dedupeKey that was already SENT is never sent twice
 * (this is what makes the cron jobs safe to run again within the same day).
 */
export async function dispatchSms(
  gateway: SmsGateway,
  log: SmsLogStore,
  msg: { to: string; body: string; type: SmsType; dedupeKey?: string },
  now = new Date(),
): Promise<DispatchStatus> {
  if (msg.dedupeKey && log.has(msg.dedupeKey)) return 'DUPLICATE';
  const to = normalizePhone(msg.to);
  const base = { body: msg.body, type: msg.type, dedupeKey: msg.dedupeKey, sentAt: now.toISOString() };
  if (!to) {
    log.add({ ...base, to: msg.to, status: 'FAILED', error: 'Namba ya simu si sahihi' });
    return 'FAILED';
  }
  const res = await gateway.send(to, msg.body);
  if (!res.ok) {
    // A failure is logged without the dedupe key, so a later run may retry it.
    log.add({ ...base, dedupeKey: undefined, to, status: 'FAILED', error: res.error });
    return 'FAILED';
  }
  log.add({ ...base, to, status: 'SENT', providerRef: res.providerRef });
  return 'SENT';
}
