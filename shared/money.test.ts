import { describe, expect, it } from 'vitest';
import {
  cashDifference,
  expectedCash,
  expenseSchema,
  lastMonths,
  periodRange,
  profitByProduct,
  summarize,
  type SaleFact,
} from './money';

const sale = (over: Partial<SaleFact> = {}): SaleFact => ({
  date: '2026-10-29',
  status: 'PAID',
  subtotal: 920_000,
  total: 920_000,
  returnedValue: 0,
  lines: [
    { productId: 1, name: 'Samsung A15', qty: 1, returnedQty: 0, unitPrice: 900_000, unitCost: 780_000 },
    { productId: 5, name: 'Protector', qty: 2, returnedQty: 0, unitPrice: 10_000, unitCost: 3_000 },
  ],
  payments: [],
  ...over,
});

describe('close day', () => {
  it('expected cash = cash sales + cash debt payments - cash refunds - cash expenses', () => {
    const e = expectedCash({ cashSales: 500_000, cashDebtPayments: 200_000, cashRefunds: 45_000, cashExpenses: 55_000 });
    expect(e).toBe(600_000);
    expect(cashDifference(590_000, e)).toBe(-10_000);
    expect(cashDifference(610_000, e)).toBe(10_000);
  });
});

describe('periods', () => {
  it('computes ranges in order', () => {
    // 2026-10-29 is a Thursday
    expect(periodRange('today', '2026-10-29')).toEqual({ from: '2026-10-29', to: '2026-10-29' });
    expect(periodRange('week', '2026-10-29')).toEqual({ from: '2026-10-26', to: '2026-10-29' });
    expect(periodRange('week', '2026-10-26')).toEqual({ from: '2026-10-26', to: '2026-10-26' });
    expect(periodRange('month', '2026-10-29')).toEqual({ from: '2026-10-01', to: '2026-10-29' });
    expect(periodRange('year', '2026-10-29')).toEqual({ from: '2026-01-01', to: '2026-10-29' });
    expect(periodRange('custom', '2026-10-29', { from: '2026-10-05', to: '2026-10-10' })).toEqual({ from: '2026-10-05', to: '2026-10-10' });
    expect(periodRange('custom', '2026-10-29', { from: '2026-10-10', to: '2026-10-05' })).toEqual({ from: '2026-10-29', to: '2026-10-29' });
  });
  it('lists the last 6 months across a year boundary', () => {
    expect(lastMonths('2026-10-29', 6)).toEqual(['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']);
    expect(lastMonths('2026-02-03', 4)).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
  });
});

describe('profit', () => {
  it('gross = sales - cost; net = gross - expenses', () => {
    const s = summarize([sale()], [120_000]);
    expect(s).toMatchObject({ sales: 920_000, cogs: 786_000, gross: 134_000, expenses: 120_000, net: 14_000, count: 1 });
  });
  it('a discount lowers profit', () => {
    const s = summarize([sale({ total: 900_000 })], []);
    expect(s.gross).toBe(114_000);
  });
  it('void sales are excluded entirely', () => {
    expect(summarize([sale({ status: 'VOID' }), sale()], [])).toMatchObject({ sales: 920_000, count: 1 });
  });
  it('returned goods take their revenue and cost out', () => {
    const f = sale({
      returnedValue: 20_000,
      lines: [
        { productId: 1, name: 'Samsung A15', qty: 1, returnedQty: 0, unitPrice: 900_000, unitCost: 780_000 },
        { productId: 5, name: 'Protector', qty: 2, returnedQty: 2, unitPrice: 10_000, unitCost: 3_000 },
      ],
    });
    expect(summarize([f], [])).toMatchObject({ sales: 900_000, cogs: 780_000, gross: 120_000 });
  });
  it('ranks products by profit', () => {
    const top = profitByProduct([sale(), sale()]);
    expect(top[0]).toMatchObject({ productId: 1, qty: 2, profit: 240_000 });
    expect(top[1]).toMatchObject({ productId: 5, qty: 4, profit: 28_000 });
  });
});

describe('expense form', () => {
  it('needs a positive whole amount', () => {
    const base = { category: 'RENT', method: 'CASH', spentOn: '2026-10-29' };
    expect(expenseSchema.safeParse({ ...base, amount: '1200000' }).success).toBe(true);
    const bad = expenseSchema.safeParse({ ...base, amount: 0 });
    expect(bad.success).toBe(false);
    if (!bad.success) expect(bad.error.issues[0].message).toMatch(/kikubwa/);
    expect(expenseSchema.safeParse({ ...base, amount: 10.5 }).success).toBe(false);
  });
});
