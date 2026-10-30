/**
 * The two scheduled jobs. In production Vercel Cron calls /api/cron/daily-report and
 * /api/cron/debt-reminders; here the same logic runs from Settings and from a timer
 * while the owner has the app open. Both are safe to run again: each message has a
 * once-per-day key in the SMS log.
 */
import { normalizePhone } from '@shared/schemas';
import { debtReminderSms } from '@shared/debts';
import { dailyReportSms, planDebtReminders, type DispatchStatus } from '@shared/sms';
import { timeDar } from '@/lib/dar';
import { getSettings } from './api';
import { getDayReportData } from './ledger';
import { getDebtOverview, todayDar } from './sales';
import { sendSms } from './sms';

export type DailyReportOutcome = DispatchStatus | 'DISABLED' | 'NO_PHONE';

export async function runDailyReport(date = todayDar()): Promise<DailyReportOutcome> {
  const settings = await getSettings();
  if (!settings.smsDaily) return 'DISABLED';
  if (!normalizePhone(settings.ownerPhone)) return 'NO_PHONE';
  const data = await getDayReportData(date);
  return sendSms({ to: settings.ownerPhone, body: dailyReportSms(data), type: 'DAILY_REPORT', dedupeKey: `daily:${date}` });
}

export interface ReminderOutcome {
  disabled: boolean;
  sent: number;
  duplicates: number;
  failed: number;
}

export async function runDebtReminders(today = todayDar()): Promise<ReminderOutcome> {
  const settings = await getSettings();
  const out: ReminderOutcome = { disabled: !settings.smsReminders, sent: 0, duplicates: 0, failed: 0 };
  if (out.disabled) return out;
  const { rows } = await getDebtOverview();
  const plan = planDebtReminders(
    // Only debts with a recorded due date and a phone number get automatic reminders.
    rows.flatMap((r) => (r.dueDate && r.customer.phone ? [{ saleId: r.saleId, phone: r.customer.phone, name: r.customer.name, balance: r.balance, dueDate: r.dueDate }] : [])),
    today,
  );
  for (const p of plan) {
    const status = await sendSms({
      to: p.to,
      body: debtReminderSms(p.name, p.balance, p.due, p.kind === 'AFTER'),
      type: 'DEBT_REMINDER',
      dedupeKey: p.dedupeKey,
    });
    if (status === 'SENT') out.sent++;
    else if (status === 'DUPLICATE') out.duplicates++;
    else out.failed++;
  }
  return out;
}

/** Local time in Dar es Salaam as "HH:MM". */
export const nowDar = timeDar;

/** What the timer does each minute: run whatever is due today (the once-a-day keys make repeats harmless). */
export async function runDueJobs(now = new Date()): Promise<void> {
  const settings = await getSettings();
  const time = nowDar(now);
  if (time >= settings.dailyTime) await runDailyReport();
  if (time >= '09:00') await runDebtReminders(); // matches the 06:00 UTC cron
}
