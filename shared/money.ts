import { z } from 'zod';
import { PAYMENT_METHODS, type PaymentMethod } from './constants';
import { addDays } from './debts';

/* ---------- Expenses ---------- */
export const EXPENSE_CATEGORIES = ['RENT', 'ELECTRICITY', 'SALARIES', 'TRANSPORT', 'FOOD', 'OTHER'] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];
export const EXPENSE_LABEL: Record<ExpenseCategory, string> = {
  RENT: 'Pango',
  ELECTRICITY: 'Umeme',
  SALARIES: 'Mishahara',
  TRANSPORT: 'Usafiri',
  FOOD: 'Chakula',
  OTHER: 'Mengineyo',
};

export const expenseSchema = z.object({
  category: z.enum(EXPENSE_CATEGORIES),
  amount: z.coerce
    .number({ invalid_type_error: 'Kiasi lazima kiwe namba' })
    .int('Kiasi lazima kiwe namba kamili')
    .positive('Kiasi lazima kiwe kikubwa kuliko sifuri'),
  description: z.string().trim().max(200, 'Maelezo ni marefu mno').optional(),
  method: z.enum(PAYMENT_METHODS, { errorMap: () => ({ message: 'Chagua Cash, Lipa Namba au Bank' }) }),
  spentOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Weka tarehe'),
});
export type ExpenseInput = z.infer<typeof expenseSchema>;
/** Payment methods an expense can be paid with (same list the schema accepts). */
export const EXPENSE_METHODS = PAYMENT_METHODS;

/* ---------- Close day ---------- */
export interface CashParts {
  cashSales: number;
  cashDebtPayments: number;
  cashRefunds: number; // positive number: cash given back
  cashExpenses: number;
}

/** Expected cash = cash sales + cash debt payments - cash refunds - cash expenses. */
export const expectedCash = (p: CashParts) => p.cashSales + p.cashDebtPayments - p.cashRefunds - p.cashExpenses;
/** Negative = cash is short, positive = cash is over. */
export const cashDifference = (counted: number, expected: number) => counted - expected;

/* ---------- Periods ---------- */
export type PeriodKind = 'today' | 'week' | 'month' | 'year' | 'custom';
export interface Range {
  from: string; // yyyy-mm-dd, inclusive
  to: string;
}

export function periodRange(kind: PeriodKind, today: string, custom?: Range): Range {
  switch (kind) {
    case 'today':
      return { from: today, to: today };
    case 'week': {
      const dow = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7; // Monday = 0
      return { from: addDays(today, -dow), to: today };
    }
    case 'month':
      return { from: `${today.slice(0, 7)}-01`, to: today };
    case 'year':
      return { from: `${today.slice(0, 4)}-01-01`, to: today };
    case 'custom':
      return custom && custom.from <= custom.to ? custom : { from: today, to: today };
  }
}

export const inRange = (date: string, r: Range) => date >= r.from && date <= r.to;

/** The `n` calendar months ending with the month of `today`, oldest first ("2026-05"…"2026-10"). */
export function lastMonths(today: string, n: number): string[] {
  let y = Number(today.slice(0, 4));
  let m = Number(today.slice(5, 7));
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    out.unshift(`${y}-${String(m).padStart(2, '0')}`);
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
  }
  return out;
}

/* ---------- Profit ---------- */
export interface SaleFact {
  date: string; // yyyy-mm-dd (Dar es Salaam)
  status: 'PAID' | 'PARTIAL' | 'VOID';
  subtotal: number;
  total: number;
  returnedValue: number;
  lines: { productId: number; name: string; qty: number; returnedQty: number; unitPrice: number; unitCost: number }[];
  payments: { method: PaymentMethod; amount: number; kind: 'SALE' | 'DEBT' | 'REFUND'; date: string }[];
}

/** Sales after discounts and returns; a void sale counts for nothing. */
export const saleRevenue = (f: SaleFact) => (f.status === 'VOID' ? 0 : f.total - f.returnedValue);
/** Cost of goods actually kept by the customer, from the unit cost snapshot taken at sale time. */
export const saleCogs = (f: SaleFact) =>
  f.status === 'VOID' ? 0 : f.lines.reduce((a, l) => a + l.unitCost * (l.qty - l.returnedQty), 0);

export interface Summary {
  sales: number;
  count: number;
  cogs: number;
  gross: number;
  expenses: number;
  net: number;
}

/** gross profit = sales - cost of goods; net profit = gross profit - expenses in the period. */
export function summarize(facts: SaleFact[], expenseAmounts: number[]): Summary {
  const live = facts.filter((f) => f.status !== 'VOID');
  const sales = live.reduce((a, f) => a + saleRevenue(f), 0);
  const cogs = live.reduce((a, f) => a + saleCogs(f), 0);
  const expenses = expenseAmounts.reduce((a, b) => a + b, 0);
  return { sales, count: live.length, cogs, gross: sales - cogs, expenses, net: sales - cogs - expenses };
}

/** Profit per product (discount shared proportionally, returned units left out). */
export function profitByProduct(facts: SaleFact[]): { productId: number; name: string; qty: number; profit: number }[] {
  const by = new Map<number, { productId: number; name: string; qty: number; profit: number }>();
  for (const f of facts) {
    if (f.status === 'VOID') continue;
    const ratio = f.subtotal > 0 ? f.total / f.subtotal : 1;
    for (const l of f.lines) {
      const kept = l.qty - l.returnedQty;
      if (kept <= 0) continue;
      const row = by.get(l.productId) ?? { productId: l.productId, name: l.name, qty: 0, profit: 0 };
      row.qty += kept;
      row.profit += Math.floor(l.unitPrice * kept * ratio) - l.unitCost * kept;
      by.set(l.productId, row);
    }
  }
  return [...by.values()].sort((a, b) => b.profit - a.profit);
}
