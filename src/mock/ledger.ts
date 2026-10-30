/**
 * Mock money ledger: expenses, close-day cash counts, the live dashboard and reports.
 * Everything is derived from the sales ledger (salesFacts) so numbers always agree with POS.
 * Cost and profit fields are only filled in for the owner.
 */
import type { PaymentMethod, Role } from '@shared/constants';
import {
  cashDifference,
  expectedCash,
  expenseSchema,
  inRange,
  lastMonths,
  periodRange,
  profitByProduct,
  summarize,
  type CashParts,
  type ExpenseCategory,
  type ExpenseInput,
  type PeriodKind,
  type Range,
} from '@shared/money';
import { internalProducts, type ShopDashboard } from './api';
import { logAudit } from './audit';
import { getDebtOverview, salesFacts, todayDar } from './sales';
import { addDays } from '@shared/debts';
import type { DailyReportData } from '@shared/sms';
import { supabase } from '@/lib/supabase';
import { check, ensureFresh, isRemote, rpc, write } from './sync';

const delay = <T,>(v: T, ms = 120) => (isRemote() ? Promise.resolve(v) : new Promise<T>((r) => setTimeout(() => r(v), ms)));

// No browser storage: state lives in memory and, with Supabase, is reloaded from the database (see ./hydrate).
function load<T>(_key: string, fallback: () => T): T {
  return fallback();
}
function save(_key: string, _value: unknown) {
  /* nothing to persist: the database is the source of truth */
}

/* ---------- Expenses ---------- */
export interface Expense {
  id: number;
  category: ExpenseCategory;
  amount: number;
  description: string;
  method: PaymentMethod;
  spentOn: string;
  userName: string;
  key?: string; // idempotency key of the form submission
}

function seedExpenses(): Expense[] {
  const today = todayDar();
  const out: Omit<Expense, 'id'>[] = [];
  const add = (spentOn: string, category: ExpenseCategory, amount: number, description: string, method: PaymentMethod) => {
    if (spentOn <= today) out.push({ spentOn, category, amount, description, method, userName: 'Mmiliki Mkuu' });
  };
  for (const ym of lastMonths(today, 6)) {
    const d = (n: number) => `${ym}-${String(n).padStart(2, '0')}`;
    add(d(1), 'RENT', 1_200_000, 'Kodi ya mwezi', 'BANK');
    add(d(1), 'OTHER', 70_000, 'Vifungashio na risiti', 'CASH');
    add(d(10), 'SALARIES', 400_000, 'Mshahara wa muuzaji', 'BANK');
    add(d(12), 'TRANSPORT', 130_000, 'Usafiri wa mizigo', 'CASH');
    add(d(15), 'ELECTRICITY', 100_000, 'LUKU', 'MPESA');
    add(d(25), 'SALARIES', 400_000, 'Mshahara wa muuzaji', 'BANK');
  }
  // This week's small daily costs.
  add(today, 'ELECTRICITY', 80_000, 'LUKU', 'MPESA');
  add(today, 'TRANSPORT', 40_000, 'Kusafirisha mzigo kutoka store', 'CASH');
  add(addDays(today, -1), 'FOOD', 15_000, 'Chakula cha wafanyakazi', 'CASH');
  return out.map((e, i) => ({ ...e, id: i + 1 }));
}
let expenses = load<Expense[]>('tb4.expenses', () => {
  return typeof process !== 'undefined' && (process.env?.NODE_ENV === 'test' || !!process.env?.VITEST)
    ? seedExpenses()
    : [];
});

export function hydrateLedger(nextExpenses: Expense[], nextClosings: Closing[]): void {
  expenses = nextExpenses;
  closings = nextClosings;
}

export interface ExpenseOverview {
  range: Range;
  total: number; // expenses in the selected range
  today: number; // today's expenses, whatever the range
  net?: number; // owner only: sales - cost of goods - expenses, for the selected range (expenses are subtracted once, here)
  byCategory: { category: ExpenseCategory; amount: number }[];
  rows: Expense[]; // every expense in the range, newest first
}

export async function getExpenseOverview(role: Role, range: Range): Promise<ExpenseOverview> {
  await ensureFresh();
  const today = todayDar();
  const inPeriod = expenses.filter((e) => inRange(e.spentOn, range));
  const by = new Map<ExpenseCategory, number>();
  for (const e of inPeriod) by.set(e.category, (by.get(e.category) ?? 0) + e.amount);
  const data: ExpenseOverview = {
    range,
    total: inPeriod.reduce((a, e) => a + e.amount, 0),
    today: expenses.filter((e) => e.spentOn === today).reduce((a, e) => a + e.amount, 0),
    byCategory: [...by].map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount),
    rows: [...inPeriod].sort((a, b) => b.spentOn.localeCompare(a.spentOn) || b.id - a.id),
  };
  if (role === 'owner') {
    data.net = summarize(salesFacts().filter((f) => inRange(f.date, range)), inPeriod.map((e) => e.amount)).net;
  }
  return delay(data);
}

export async function addExpense(user: { name: string }, raw: ExpenseInput, key?: string): Promise<Expense> {
  await ensureFresh();
  if (key) {
    const seen = expenses.find((e) => e.key === key);
    if (seen) return seen; // the same submission is never recorded twice
  }
  const parsed = expenseSchema.safeParse(raw);
  if (!parsed.success) throw new Error(parsed.error.issues[0].message);
  const v = parsed.data;
  if (v.spentOn > todayDar()) throw new Error('Tarehe haiwezi kuwa ya kesho');
  if (isRemote()) {
    return write(async () => {
      const res = check(
        await supabase
          .from('expenses')
          .insert({ category: v.category, amount: v.amount, description: v.description ?? '', method: v.method, spent_on: v.spentOn, user_name: user.name, idempotency_key: key ?? null })
          .select('id')
          .single(),
      );
      return {
        id: (res.data as { id: number }).id,
        category: v.category,
        amount: v.amount,
        description: v.description ?? '',
        method: v.method,
        spentOn: v.spentOn,
        userName: user.name,
        key,
      };
    });
  }
  const created: Expense = {
    id: Math.max(0, ...expenses.map((e) => e.id)) + 1,
    category: v.category,
    amount: v.amount,
    description: v.description ?? '',
    method: v.method,
    spentOn: v.spentOn,
    userName: user.name,
    key,
  };
  expenses = [...expenses, created];
  save('tb4.expenses', expenses);

  return delay(created);
}

/* ---------- Close day ---------- */
interface Closing {
  id: number;
  userName: string;
  date: string;
  expected: number;
  counted: number;
  difference: number;
  note: string;
}
let closings = load<Closing[]>('tb4.closings', () => []);

export interface CloseDay {
  date: string;
  parts: CashParts;
  expected: number;
  closing: Closing | null;
}

export async function getCloseDay(date = todayDar()): Promise<CloseDay> {
  await ensureFresh();
  const facts = salesFacts();
  const cashIn = (kind: 'SALE' | 'DEBT' | 'REFUND') =>
    facts.flatMap((f) => f.payments).filter((p) => p.date === date && p.kind === kind && p.method === 'CASH').reduce((a, p) => a + p.amount, 0);
  const parts: CashParts = {
    cashSales: cashIn('SALE'),
    cashDebtPayments: cashIn('DEBT'),
    cashRefunds: Math.max(0, -cashIn('REFUND')), // refunds are stored negative
    cashExpenses: expenses.filter((e) => e.spentOn === date && e.method === 'CASH').reduce((a, e) => a + e.amount, 0),
  };
  return delay({ date, parts, expected: expectedCash(parts), closing: closings.find((c) => c.date === date) ?? null });
}

export async function closeDay(user: { name: string }, req: { counted: number; note: string }): Promise<Closing> {
  const day = await getCloseDay();
  if (day.closing) throw new Error('Siku hii imeshafungwa tayari');
  if (!Number.isInteger(req.counted) || req.counted < 0) throw new Error('Weka kiasi cha cash ulichohesabu');
  if (isRemote()) {
    return write(async () => {
      const id = await rpc<number>('rpc_close_day', { payload: { date: day.date, counted: req.counted, note: req.note.trim() } });
      return { id: Number(id), userName: user.name, date: day.date, expected: day.expected, counted: req.counted, difference: cashDifference(req.counted, day.expected), note: req.note.trim() };
    });
  }
  const closing: Closing = {
    id: closings.length + 1,
    userName: user.name,
    date: day.date,
    expected: day.expected,
    counted: req.counted,
    difference: cashDifference(req.counted, day.expected),
    note: req.note.trim(),
  };
  closings = [...closings, closing];
  save('tb4.closings', closings);
  logAudit(user.name, 'CASH_CLOSING', closing.id, `${day.date}: inatarajiwa ${closing.expected}, imehesabiwa ${closing.counted}, tofauti ${closing.difference}`);

  return delay(closing);
}

/* ---------- Dashboard ---------- */
export async function getShopDashboardLive(role: Role, _daysList?: Date[]): Promise<ShopDashboard> {
  await ensureFresh();
  const facts = salesFacts();
  const debts = await getDebtOverview();
  const today = todayDar();
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6));
  const spent = (d: string) => expenses.filter((e) => e.spentOn === d).map((e) => e.amount);
  const day = (d: string) => summarize(facts.filter((f) => f.date === d), spent(d));
  const [yesterday, now] = [day(days[5]), day(days[6])];
  const pct = (a: number, b: number) => (b > 0 ? Math.round(((a - b) / b) * 100) : 0);

  const weekFacts = facts.filter((f) => inRange(f.date, { from: days[0], to: today }));
  const types = new Map(internalProducts().map((p) => [p.id, p.type]));
  const top = profitByProduct(weekFacts).sort((a, b) => b.qty - a.qty).slice(0, 5);
  const maxQty = Math.max(1, ...top.map((t) => t.qty));
  const week = days.map((d) => day(d).sales);

  const data: ShopDashboard = {
    salesToday: now.sales,
    salesTrendPct: pct(now.sales, yesterday.sales),
    salesCount: now.count,
    salesCountDelta: now.count - yesterday.count,
    expensesToday: spent(today).reduce((a, b) => a + b, 0),
    totalDebt: debts.totalDebt,
    debtorCount: debts.debtorCount,
    week,
    weekTotal: week.reduce((a, b) => a + b, 0),
    weekExpenses: days.map((d) => spent(d).reduce((a, b) => a + b, 0)),
    topProducts: top.map((t) => ({
      name: t.name,
      sub: `${types.get(t.productId) === 'phone' ? 'Simu' : 'Accessory'} · ${t.qty} zimeuzwa`,
      sold: t.qty,
      soldPct: Math.round((t.qty / maxQty) * 92),
    })),
    debtors: debts.rows.slice(0, 5).map((r) => ({
      id: r.saleId,
      name: r.customer.name,
      item: r.item,
      since: r.saleDate.split('-').reverse().slice(0, 2).join('/'),
      amount: r.balance,
      tag: r.due ?? { kind: r.status === 'OVERDUE' ? 'overdue' : 'soon', label: r.dueDate ? r.dueDate : 'Hakuna tarehe' },
    })),
  };
  if (role === 'owner') {
    data.netProfitToday = now.net;
    data.profitTrendPct = pct(now.net, yesterday.net);
    data.weekProfit = days.map((d) => Math.max(0, day(d).net));
  }
  return delay(data);
}

/* ---------- Reports ---------- */
const MONTH_SW = ['Jan', 'Feb', 'Mac', 'Apr', 'Mei', 'Jun', 'Jul', 'Ago', 'Sep', 'Okt', 'Nov', 'Des'];

export interface Report {
  period: PeriodKind;
  range: Range;
  sales: number;
  count: number;
  methods: { method: PaymentMethod; amount: number; pct: number }[];
  top: { name: string; qty: number; profit?: number }[];
  months: { ym: string; label: string; sales: number; net?: number }[];
  // Owner only
  cogs?: number;
  gross?: number;
  expenses?: number;
  net?: number;
  expensesByCategory?: { category: ExpenseCategory; amount: number }[];
}

export async function getReport(role: Role, period: PeriodKind, custom?: Range): Promise<Report> {
  await ensureFresh();
  const today = todayDar();
  const range = periodRange(period, today, custom);
  const facts = salesFacts();
  const inPeriod = facts.filter((f) => inRange(f.date, range));
  const spent = expenses.filter((e) => inRange(e.spentOn, range));
  const sum = summarize(inPeriod, spent.map((e) => e.amount));

  // Money actually received per method (refunds count against the method they were paid back on).
  const received = new Map<PaymentMethod, number>();
  for (const p of facts.flatMap((f) => f.payments)) {
    if (inRange(p.date, range)) received.set(p.method, (received.get(p.method) ?? 0) + p.amount);
  }
  const totalReceived = [...received.values()].reduce((a, b) => a + Math.max(0, b), 0) || 1;
  const methods = [...received]
    .filter(([, a]) => a > 0)
    .map(([method, amount]) => ({ method, amount, pct: Math.round((amount / totalReceived) * 100) }))
    .sort((a, b) => b.amount - a.amount);

  const ranked = profitByProduct(inPeriod);
  const top =
    role === 'owner'
      ? ranked.slice(0, 5).map((t) => ({ name: t.name, qty: t.qty, profit: t.profit }))
      : [...ranked].sort((a, b) => b.qty - a.qty).slice(0, 5).map((t) => ({ name: t.name, qty: t.qty }));

  const months = lastMonths(today, 6).map((ym) => {
    const f = facts.filter((x) => x.date.startsWith(ym));
    const s = summarize(f, expenses.filter((e) => e.spentOn.startsWith(ym)).map((e) => e.amount));
    return { ym, label: MONTH_SW[Number(ym.slice(5, 7)) - 1], sales: s.sales, ...(role === 'owner' ? { net: s.net } : {}) };
  });

  const report: Report = { period, range, sales: sum.sales, count: sum.count, methods, top, months };
  if (role === 'owner') {
    const by = new Map<ExpenseCategory, number>();
    for (const e of spent) by.set(e.category, (by.get(e.category) ?? 0) + e.amount);
    Object.assign(report, {
      cogs: sum.cogs,
      gross: sum.gross,
      expenses: sum.expenses,
      net: sum.net,
      expensesByCategory: [...by].map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount),
    });
  }
  return delay(report);
}

/* ---------- Data for the evening SMS ---------- */
export async function getDayReportData(date: string): Promise<DailyReportData> {
  await ensureFresh();
  const facts = salesFacts();
  const day = facts.filter((f) => f.date === date);
  const spent = expenses.filter((e) => e.spentOn === date).map((e) => e.amount);
  const sum = summarize(day, spent);
  const newDebt = day
    .filter((f) => f.status !== 'VOID')
    .reduce((a, f) => a + Math.max(0, f.total - f.payments.filter((p) => p.kind === 'SALE').reduce((x, p) => x + p.amount, 0)), 0);
  const debtPaid = facts.flatMap((f) => f.payments).filter((p) => p.kind === 'DEBT' && p.date === date).reduce((a, p) => a + p.amount, 0);
  const debts = await getDebtOverview();
  return { date, sales: sum.sales, expenses: sum.expenses, net: sum.net, newDebt, debtPaid, totalDebt: debts.totalDebt };
}
