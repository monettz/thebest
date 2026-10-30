import { describe, expect, it } from 'vitest';
import { periodRange } from '@shared/money';
import { customerStatus, findDuplicates, reportRange } from '@shared/customers';
import { debtStatus, validatePaymentDate } from '@shared/debts';
import { customerSchema } from '@shared/schemas';
import { addExpense, getExpenseOverview, getReport } from './ledger';
import {
  SimilarCustomerError,
  checkCustomerDuplicates,
  completeSale,
  getCustomerProfile,
  getCustomerReport,
  getDebtOverview,
  getDebtReport,
  getSaleDetail,
  listCustomers,
  payCustomerDebt,
  payDebt,
  previewDebtReminders,
  saveCustomer,
  sendDebtReminders,
  todayDar,
} from './sales';

const owner = { id: 1, name: 'Mmiliki Mkuu', role: 'owner' as const };
const charger = (qty = 1) => ({ productId: 6, name: 'Charger 25W', type: 'accessory' as const, unitPrice: 35_000, qty });
const future = () => {
  const d = new Date();
  d.setDate(d.getDate() + 10);
  return todayDar(d);
};

describe('customer rules (shared)', () => {
  it('status: Debt / Paid / No purchases', () => {
    expect(customerStatus(0, 0)).toBe('NONE');
    expect(customerStatus(3, 0)).toBe('PAID');
    expect(customerStatus(3, 120_000)).toBe('DEBT');
  });

  it('registration needs only a name; phone and email are optional but validated when given', () => {
    expect(customerSchema.safeParse({ name: 'Asha' }).success).toBe(true);
    expect(customerSchema.safeParse({ name: 'A' }).success).toBe(false);
    expect(customerSchema.safeParse({ name: 'Asha', phone: '123' }).success).toBe(false);
    expect(customerSchema.safeParse({ name: 'Asha', email: 'nope' }).success).toBe(false);
    expect(customerSchema.safeParse({ name: 'Asha', phone: '0712 345 678', email: 'a@b.co' }).success).toBe(true);
  });

  it('finds the same phone (blocking) and similar names (warning)', () => {
    const list = [{ id: 1, name: 'Hamisi Mrisho', phone: '255782556001' }, { id: 2, name: 'Grace Lyimo', phone: '' }];
    expect(findDuplicates(list, { name: 'Other', phone: '0782 556 001' })[0]).toMatchObject({ id: 1, reason: 'PHONE' });
    expect(findDuplicates(list, { name: 'mrisho hamisi', phone: '' })[0]).toMatchObject({ id: 1, reason: 'NAME' });
    expect(findDuplicates(list, { name: 'Grace Lymo', phone: '' })[0]).toMatchObject({ id: 2, reason: 'NAME' });
    expect(findDuplicates(list, { name: 'Peter Kimaro', phone: '0712000999' })).toEqual([]);
    expect(findDuplicates(list, { name: 'Hamisi Mrisho', phone: '' }, 1)).toEqual([]); // editing yourself is fine
  });

  it('report periods', () => {
    const today = '2026-10-29'; // Thursday
    expect(reportRange('today', today)).toEqual({ from: today, to: today });
    expect(reportRange('week', today)).toEqual({ from: '2026-10-26', to: today });
    expect(reportRange('month', today)).toEqual({ from: '2026-10-01', to: today });
    expect(reportRange('custom', today, { from: '2026-09-01', to: '2026-09-30' })).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(reportRange('all', today)).toBeNull();
  });

  it('debt status never calls a debt without a due date overdue', () => {
    expect(debtStatus(0, 100, null, '2026-10-29')).toBe('PAID');
    expect(debtStatus(50, 0, null, '2026-10-29')).toBe('OUTSTANDING');
    expect(debtStatus(50, 10, null, '2026-10-29')).toBe('PARTIAL');
    expect(debtStatus(50, 10, '2026-10-01', '2026-10-29')).toBe('OVERDUE');
    expect(debtStatus(50, 10, '2026-10-29', '2026-10-29')).toBe('PARTIAL');
  });

  it('payment date: not in the future, not before the sale', () => {
    expect(validatePaymentDate('2026-10-30', '2026-10-01', '2026-10-29')).toMatch(/kesho/);
    expect(validatePaymentDate('2026-09-30', '2026-10-01', '2026-10-29')).toMatch(/kabla/);
    expect(validatePaymentDate('2026-10-15', '2026-10-01', '2026-10-29')).toBeNull();
  });
});

describe('customers and POS use one database', () => {
  it('registers a customer manually with only a name, and flags duplicates', async () => {
    const before = (await listCustomers()).length;
    const walkIn = await saveCustomer({ name: 'Zawadi Komba' }, undefined, { by: 'Test' });
    expect(walkIn.phone).toBe('');
    expect((await listCustomers()).length).toBe(before + 1);
    const profile = await getCustomerProfile(walkIn.id);
    expect(profile).toMatchObject({ purchases: 0, debt: 0, status: 'NONE' });

    const full = await saveCustomer({ name: 'Baraka Mushi', phone: '0766 111 222', email: 'b@x.co', area: 'Mikocheni', notes: 'VIP' });
    expect(full).toMatchObject({ phone: '255766111222', email: 'b@x.co', area: 'Mikocheni', notes: 'VIP' });

    await expect(saveCustomer({ name: 'Someone Else', phone: '0766111222' })).rejects.toThrow(/Baraka Mushi/);
    await expect(saveCustomer({ name: 'Mushi Baraka' })).rejects.toBeInstanceOf(SimilarCustomerError);
    expect((await checkCustomerDuplicates({ name: 'Mushi Baraka' }))[0].reason).toBe('NAME');
    const forced = await saveCustomer({ name: 'Mushi Baraka' }, undefined, { allowSimilarName: true });
    expect(forced.id).not.toBe(full.id);
    expect((await listCustomers()).length).toBe(before + 3);
  });

  it('a sale registers a new customer once and links to the existing id afterwards', async () => {
    const before = (await listCustomers()).length;
    const first = await completeSale(owner, { lines: [charger()], discount: 0, payments: [{ method: 'CASH', amount: 35_000 }], customer: { name: 'Neema Pallangyo', phone: '0755 000 111' } });
    expect((await listCustomers()).length).toBe(before + 1);
    const neema = (await listCustomers('0755000111'))[0];
    expect(neema.customer.name).toBe('Neema Pallangyo');
    expect(neema).toMatchObject({ purchases: 1, totalPurchased: 35_000, paid: 35_000, debt: 0, status: 'PAID' });

    // same phone typed again: same record. Selected by id: same record. Anonymous: no customer at all.
    await completeSale(owner, { lines: [charger()], discount: 0, payments: [{ method: 'CASH', amount: 35_000 }], customer: { name: 'Neema P.', phone: '255755000111' } });
    await completeSale(owner, { lines: [charger()], discount: 0, payments: [{ method: 'CASH', amount: 35_000 }], customer: { id: neema.customer.id, name: neema.customer.name, phone: neema.customer.phone } });
    await completeSale(owner, { lines: [charger()], discount: 0, payments: [{ method: 'CASH', amount: 35_000 }], customer: null });
    expect((await listCustomers()).length).toBe(before + 1);
    const profile = (await getCustomerProfile(neema.customer.id))!;
    expect(profile.purchases).toBe(3);
    expect(profile.history).toHaveLength(3);
    expect(profile.history.map((h) => h.saleId)).toContain(first.saleId);
    expect(profile.history[0]).toMatchObject({ payStatus: 'PAID', balance: 0 });
    expect(profile.history[0].receiptNo).toMatch(/^TB-/);

    // a bad phone is an error, never a silent anonymous sale
    await expect(completeSale(owner, { lines: [charger()], discount: 0, payments: [{ method: 'CASH', amount: 35_000 }], customer: { name: 'Bad Phone', phone: '12345' } })).rejects.toThrow();
  });
});

describe('debts and payments', () => {
  it('computes outstanding and overdue per sale without double counting', async () => {
    const d = await getDebtOverview();
    expect(d.totalDebt).toBe(d.rows.reduce((a, r) => a + r.balance, 0));
    expect(d.rows.every((r) => r.balance > 0)).toBe(true);
    const overdue = d.rows.filter((r) => r.status === 'OVERDUE');
    expect(d.overdueTotal).toBe(overdue.reduce((a, r) => a + r.balance, 0));
    expect(overdue.every((r) => r.dueDate && r.dueDate < todayDar())).toBe(true);
    // the customer list agrees with the debts page
    const byCustomer = (await listCustomers()).reduce((a, c) => a + c.debt, 0);
    expect(byCustomer).toBe(d.totalDebt);
  });

  it('partial then full payment updates balance, status and the customer', async () => {
    const sale = await completeSale(owner, {
      lines: [charger(2)],
      discount: 0,
      payments: [{ method: 'CASH', amount: 20_000 }],
      customer: { name: 'Mwajuma Selemani', phone: '0713 222 333' },
      dueDate: future(),
    });
    let row = (await getDebtOverview()).rows.find((r) => r.saleId === sale.saleId)!;
    expect(row).toMatchObject({ total: 70_000, paid: 20_000, balance: 50_000, status: 'PARTIAL' });
    const customerId = row.customer.id;
    expect((await getCustomerProfile(customerId))).toMatchObject({ debt: 50_000, status: 'DEBT' });

    await expect(payDebt(owner, { saleId: sale.saleId, amount: 0, method: 'CASH', sendSms: false })).rejects.toThrow();
    await expect(payDebt(owner, { saleId: sale.saleId, amount: 60_000, method: 'CASH', sendSms: false })).rejects.toThrow(); // more than owed
    await expect(payDebt(owner, { saleId: sale.saleId, amount: 10_000, method: 'CASH', sendSms: false, paidOn: future() })).rejects.toThrow(); // future date

    const key = 'form-1';
    await payDebt(owner, { saleId: sale.saleId, amount: 30_000, method: 'LIPA_NAMBA', sendSms: false, reference: 'MP123', notes: 'part', key });
    await payDebt(owner, { saleId: sale.saleId, amount: 30_000, method: 'LIPA_NAMBA', sendSms: false, reference: 'MP123', notes: 'part', key }); // double click: ignored
    row = (await getDebtOverview()).rows.find((r) => r.saleId === sale.saleId)!;
    expect(row).toMatchObject({ paid: 50_000, balance: 20_000 });
    const detail = (await getSaleDetail(sale.saleId))!;
    expect(detail.payments.filter((p) => p.kind === 'DEBT')).toHaveLength(1);
    expect(detail.payments.find((p) => p.kind === 'DEBT')).toMatchObject({ reference: 'MP123', notes: 'part', userName: owner.name });
    expect(detail.total).toBe(70_000); // repayments never create a sale or change the sale total

    await payDebt(owner, { saleId: sale.saleId, amount: 20_000, method: 'CASH', sendSms: false, key: 'form-2' });
    const after = await getDebtOverview();
    expect(after.rows.find((r) => r.saleId === sale.saleId)).toBeUndefined(); // gone from outstanding…
    expect(after.allRows.find((r) => r.saleId === sale.saleId)).toMatchObject({ balance: 0, status: 'PAID' }); // …kept as history
    expect(await getCustomerProfile(customerId)).toMatchObject({ debt: 0, status: 'PAID', paid: 70_000 });
  });

  it('a customer payment clears the oldest unpaid sale first', async () => {
    const a = await completeSale(owner, { lines: [charger()], discount: 0, payments: [{ method: 'CASH', amount: 5_000 }], customer: { name: 'Rehema Chuma', phone: '0714 555 666' }, dueDate: future() });
    const b = await completeSale(owner, { lines: [charger(2)], discount: 0, payments: [{ method: 'CASH', amount: 10_000 }], customer: { name: 'Rehema Chuma', phone: '0714555666' }, dueDate: future() });
    const customerId = (await getDebtOverview()).rows.find((r) => r.saleId === a.saleId)!.customer.id;
    expect((await getCustomerProfile(customerId))!.debt).toBe(30_000 + 60_000);

    const res = await payCustomerDebt(owner, { customerId, amount: 40_000, method: 'CASH', sendSms: false, key: 'cust-1' });
    expect(res.applied).toEqual([
      expect.objectContaining({ saleId: a.saleId, amount: 30_000 }),
      expect.objectContaining({ saleId: b.saleId, amount: 10_000 }),
    ]);
    const rows = (await getDebtOverview()).rows;
    expect(rows.find((r) => r.saleId === a.saleId)).toBeUndefined();
    expect(rows.find((r) => r.saleId === b.saleId)!.balance).toBe(50_000);
    expect((await getCustomerProfile(customerId))).toMatchObject({ debt: 50_000, status: 'DEBT' });
    await expect(payCustomerDebt(owner, { customerId, amount: 90_000, method: 'CASH', sendSms: false })).rejects.toThrow(); // more than owed
  });

  it('reminders need a configured SMS service and staff choice; nothing is sent otherwise', async () => {
    const rows = (await getDebtOverview()).rows;
    const previews = await previewDebtReminders(rows.map((r) => r.saleId));
    expect(previews.length).toBe(rows.length);
    expect(previews.find((p) => p.eligible)!.message).toContain('TSh');
    await expect(sendDebtReminders(rows.map((r) => r.saleId))).rejects.toThrow(/SMS/);
  });
});

describe('PDF report data', () => {
  it('customer report: period activity is separate from current debt', async () => {
    const today = todayDar();
    const all = await getCustomerReport(null);
    expect(all.totals.debt).toBe((await getDebtOverview()).totalDebt);
    const todayRange = reportRange('today', today)!;
    const day = await getCustomerReport(todayRange);
    expect(day.totals.debt).toBe(all.totals.debt); // debt is "now", not per period
    expect(day.totals.purchases).toBeLessThanOrEqual(all.totals.purchases);
    const one = await getCustomerReport(null, 1);
    expect(one.detail!.customer.id).toBe(1);
    expect(one.detail!.sales.length).toBe(4);
    expect(one.detail!.openDebts.reduce((a, d) => a + d.balance, 0)).toBe(one.rows[0].debt);
  });

  it('debt report: outstanding now vs created/collected in the period', async () => {
    const today = todayDar();
    const month = reportRange('month', today);
    const all = await getDebtReport('outstanding', null);
    expect(all.totals.outstandingNow).toBe((await getDebtOverview()).totalDebt);
    const inMonth = await getDebtReport('outstanding', month);
    expect(inMonth.totals.outstandingNow).toBe(all.totals.outstandingNow); // the period does not change what is owed
    expect(inMonth.rows.filter((r) => r.createdInPeriod).length).toBeLessThanOrEqual(inMonth.rows.length);
    const overdue = await getDebtReport('overdue', null);
    expect(overdue.rows.every((r) => r.status === 'OVERDUE')).toBe(true);
    expect(overdue.totals.overdueNow).toBe((await getDebtOverview()).overdueTotal);
    const cust = await getDebtReport('customer', null, 3);
    expect(cust.rows.every((r) => r.customer.id === 3)).toBe(true);
  });
});

describe('expenses by period', () => {
  it('summary, breakdown and net profit use the selected range and subtract expenses once', async () => {
    const today = todayDar();
    const month = periodRange('month', today);
    const o = await getExpenseOverview('owner', month);
    const r = await getReport('owner', 'custom', month);
    expect(o.total).toBe(o.rows.reduce((a, e) => a + e.amount, 0));
    expect(o.total).toBe(o.byCategory.reduce((a, c) => a + c.amount, 0));
    expect(o.total).toBe(r.expenses);
    expect(o.net).toBe(r.net); // same figure the Reports page shows
    expect(o.byCategory.map((c) => c.amount)).toEqual([...o.byCategory.map((c) => c.amount)].sort((a, b) => b - a));
    expect(o.rows.every((e) => e.spentOn >= month.from && e.spentOn <= month.to)).toBe(true);

    const todayOnly = await getExpenseOverview('owner', periodRange('today', today));
    expect(todayOnly.total).toBe(todayOnly.today);
    expect((await getExpenseOverview('seller', month)).net).toBeUndefined(); // cost data is owner-only
  });

  it('records an expense once per submission and updates totals and net', async () => {
    const today = todayDar();
    const range = periodRange('today', today);
    const before = await getExpenseOverview('owner', range);
    const input = { category: 'TRANSPORT' as const, amount: 7_500, description: 'Boda', method: 'CASH' as const, spentOn: today };
    await addExpense(owner, input, 'k1');
    await addExpense(owner, input, 'k1'); // double click
    const after = await getExpenseOverview('owner', range);
    expect(after.total).toBe(before.total + 7_500);
    expect(after.today).toBe(before.today + 7_500);
    expect(after.net).toBe(before.net! - 7_500);
    await expect(addExpense(owner, { ...input, amount: 0 })).rejects.toThrow();
    await expect(addExpense(owner, { ...input, spentOn: future() })).rejects.toThrow();
  });
});
