import { describe, expect, it } from 'vitest';
import {
  HttpDriver,
  LogDriver,
  createGateway,
  dailyReportSms,
  dispatchSms,
  planDebtReminders,
  purchaseSms,
  reminderKind,
  smsSegments,
  type SmsGateway,
  type SmsLogEntry,
  type SmsLogStore,
} from './sms';

const store = (): SmsLogStore & { entries: SmsLogEntry[] } => {
  const entries: SmsLogEntry[] = [];
  return {
    entries,
    has: (k) => entries.some((e) => e.dedupeKey === k && e.status === 'SENT'),
    add: (e) => void entries.push(e),
  };
};

describe('daily report sms', () => {
  const data = { date: '2026-10-28', sales: 3_450_000, expenses: 120_000, net: 290_000, newDebt: 500_000, debtPaid: 200_000, totalDebt: 1_900_000 };
  it('matches the agreed wording', () => {
    expect(dailyReportSms(data)).toBe(
      'THE BEST - Ripoti 28/10/2026 Mauzo: 3,450,000 Matumizi: 120,000 Faida halisi: 290,000 Madeni mapya: 500,000 Yaliyolipwa: 200,000 Jumla ya madeni: 1,900,000',
    );
  });
  it('stays within 2 segments even with huge numbers', () => {
    const big = dailyReportSms({ ...data, sales: 9_999_999_999, expenses: 9_999_999_999, net: -9_999_999_999, totalDebt: 9_999_999_999 });
    expect(smsSegments(big).segments).toBeLessThanOrEqual(2);
  });
  it('has no payment-method breakdown or stock alerts', () => {
    const t = dailyReportSms(data).toLowerCase();
    for (const word of ['cash', 'm-pesa', 'mixx', 'airtel', 'bank', 'stock', 'imeisha']) expect(t).not.toContain(word);
  });
  it('counts segments', () => {
    expect(smsSegments('a'.repeat(160)).segments).toBe(1);
    expect(smsSegments('a'.repeat(161)).segments).toBe(2);
    expect(smsSegments('€'.repeat(81))).toMatchObject({ encoding: 'GSM-7', length: 162, segments: 2 });
    expect(smsSegments('héllo 🙂').encoding).toBe('UCS-2');
  });
});

describe('customer sms', () => {
  it('purchase confirmation includes the debt and due date', () => {
    const t = purchaseSms({ name: 'Juma', receiptNo: 'TB-000007', items: 'Samsung A15', total: 900_000, paid: 500_000, balance: 400_000, dueDate: '2026-11-15' });
    expect(t).toContain('Deni: TSh 400,000 (kulipa kabla ya 15/11/2026)');
    expect(smsSegments(t).segments).toBeLessThanOrEqual(2);
  });
});

describe('debt reminders', () => {
  it('fires 2 days before and the day after the due date only', () => {
    expect(reminderKind('2026-10-31', '2026-10-29')).toBe('BEFORE');
    expect(reminderKind('2026-10-28', '2026-10-29')).toBe('AFTER');
    for (const due of ['2026-10-30', '2026-10-29', '2026-10-27', '2026-11-05']) expect(reminderKind(due, '2026-10-29')).toBeNull();
  });
  it('plans one message per debt with a per-day key and skips cleared debts', () => {
    const plan = planDebtReminders(
      [
        { saleId: 1, phone: '0712345678', name: 'A', balance: 100, dueDate: '2026-10-31' },
        { saleId: 2, phone: '0712345679', name: 'B', balance: 100, dueDate: '2026-10-28' },
        { saleId: 3, phone: '0712345670', name: 'C', balance: 0, dueDate: '2026-10-31' },
        { saleId: 4, phone: '0712345671', name: 'D', balance: 100, dueDate: '2026-12-01' },
      ],
      '2026-10-29',
    );
    expect(plan.map((p) => [p.saleId, p.kind, p.dedupeKey])).toEqual([
      [1, 'BEFORE', 'reminder:1:BEFORE:2026-10-29'],
      [2, 'AFTER', 'reminder:2:AFTER:2026-10-29'],
    ]);
  });
});

describe('sending', () => {
  it('never sends the same keyed message twice', async () => {
    const log = store();
    const gw = new LogDriver();
    const msg = { to: '0712345678', body: 'hi', type: 'DAILY_REPORT' as const, dedupeKey: 'daily:2026-10-29' };
    expect(await dispatchSms(gw, log, msg)).toBe('SENT');
    expect(await dispatchSms(gw, log, msg)).toBe('DUPLICATE');
    expect(log.entries).toHaveLength(1);
    expect(log.entries[0].to).toBe('255712345678');
  });
  it('logs an invalid number as failed without sending', async () => {
    const log = store();
    let called = false;
    const gw: SmsGateway = { send: async () => ((called = true), { ok: true }) };
    expect(await dispatchSms(gw, log, { to: '123', body: 'x', type: 'PURCHASE' })).toBe('FAILED');
    expect(called).toBe(false);
    expect(log.entries[0]).toMatchObject({ status: 'FAILED' });
  });
  it('a failed send can be retried later with the same key', async () => {
    const log = store();
    let ok = false;
    const gw: SmsGateway = { send: async () => (ok ? { ok: true, providerRef: 'r1' } : { ok: false, error: 'HTTP 500' }) };
    const msg = { to: '0712345678', body: 'x', type: 'DAILY_REPORT' as const, dedupeKey: 'daily:d' };
    expect(await dispatchSms(gw, log, msg)).toBe('FAILED');
    ok = true;
    expect(await dispatchSms(gw, log, msg)).toBe('SENT');
  });
  it('http driver posts JSON with the bearer key and reports failures', async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const okFetch = (async (url: string, init: RequestInit) => ((seen = { url, init }), new Response(JSON.stringify({ id: 'abc' }), { status: 200 }))) as unknown as typeof fetch;
    const res = await new HttpDriver({ url: 'https://sms.test/send', apiKey: 'K', senderId: 'THE BEST' }, okFetch).send('255712345678', 'hello');
    expect(res).toEqual({ ok: true, providerRef: 'abc' });
    expect(seen!.url).toBe('https://sms.test/send');
    expect((seen!.init.headers as Record<string, string>).Authorization).toBe('Bearer K');
    expect(JSON.parse(seen!.init.body as string)).toEqual({ to: '255712345678', message: 'hello', sender: 'THE BEST' });
    const badFetch = (async () => new Response('no', { status: 500 })) as unknown as typeof fetch;
    expect(await new HttpDriver({ url: 'u', apiKey: 'k', senderId: 's' }, badFetch).send('255712345678', 'x')).toEqual({ ok: false, error: 'HTTP 500' });
  });
  it('defaults to the log driver', () => {
    expect(createGateway({})).toBeInstanceOf(LogDriver);
    expect(createGateway({ SMS_DRIVER: 'http', SMS_API_URL: 'u', SMS_API_KEY: 'k' })).toBeInstanceOf(HttpDriver);
  });
});
