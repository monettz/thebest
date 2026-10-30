import { describe, expect, it } from 'vitest';
import { ALL_PAYMENT_METHODS, PAYMENT_LABEL, PAYMENT_METHODS, POS_PAYMENT_METHODS } from '@shared/constants';
import { expenseSchema, periodRange, summarize } from '@shared/money';
import { hashSecret, sha256, validateSecret, verifySecret } from '@shared/passwords';
import { createAuthService } from './auth';
import { createProduct, listProducts } from './api';
import { listNotifications, markRead } from './notifications';
import { addExpense, getReport, getShopDashboardLive } from './ledger';
import { createTransfer, listStoreImeis, listStockEvents, paySupplier, createPurchase } from './inventory';
import { completeSale, getDebtOverview, listPosProducts, listSales, payDebt, returnItems, salesFacts, todayDar, voidSale } from './sales';
import { authUsers, localUsers, resetUsersForTest } from './users';

const owner = { id: 1, name: 'Mmiliki Mkuu', role: 'owner' as const };
const seller = { id: 2, name: 'Muuzaji Mmoja', role: 'seller' as const };
const charger = (qty = 1) => ({ productId: 6, name: 'Charger 25W', type: 'accessory' as const, unitPrice: 35_000, qty });

describe('payment methods: only Cash, Lipa Namba and Bank', () => {
  it('offers exactly the three, with the exact labels', () => {
    expect([...PAYMENT_METHODS]).toEqual(['CASH', 'LIPA_NAMBA', 'BANK']);
    expect([...POS_PAYMENT_METHODS]).toEqual(['CASH', 'LIPA_NAMBA', 'BANK']);
    expect(PAYMENT_METHODS.map((m) => PAYMENT_LABEL[m])).toEqual(['Cash', 'Lipa Namba', 'Bank']);
  });

  it('old methods stay readable in history but are labelled as old', () => {
    expect(ALL_PAYMENT_METHODS).toContain('MPESA');
    expect(PAYMENT_LABEL.MPESA).toMatch(/old/);
    const methodsInHistory = new Set(salesFacts().flatMap((f) => f.payments.map((p) => p.method)));
    expect(methodsInHistory.has('MPESA')).toBe(true); // the original records are untouched, not rewritten as Cash
  });

  it('rejects an old method for every new transaction', async () => {
    const sale = (method: string) => completeSale(owner, { lines: [charger()], discount: 0, payments: [{ method: method as 'CASH', amount: 35_000 }], customer: null });
    await expect(sale('MPESA')).rejects.toThrow(/Cash, Lipa Namba/);
    await expect(sale('AIRTEL')).rejects.toThrow();
    await expect(addExpense(owner, { category: 'FOOD', amount: 1000, description: '', method: 'MIXX' as 'CASH', spentOn: todayDar() })).rejects.toThrow();
    expect(expenseSchema.safeParse({ category: 'FOOD', amount: 1000, method: 'LIPA_NAMBA', spentOn: todayDar() }).success).toBe(true);
    const debtSale = await completeSale(owner, { lines: [charger()], discount: 0, payments: [{ method: 'CASH', amount: 5_000 }], customer: { name: 'Method Test', phone: '0788 100 200' }, dueDate: '2099-01-01' });
    await expect(payDebt(owner, { saleId: debtSale.saleId, amount: 1000, method: 'MPESA' as 'CASH', sendSms: false })).rejects.toThrow(/Cash, Lipa Namba/);
    await expect(voidSale(owner, { saleId: debtSale.saleId, reason: 'x', refundMethod: 'AIRTEL' as 'CASH' })).rejects.toThrow();
    await expect(returnItems(owner, { saleId: debtSale.saleId, items: [{ lineIndex: 0, qty: 1 }], reason: 'x', condition: 'RESTOCK', refundMethod: 'MIXX' as 'CASH' })).rejects.toThrow();
    await expect(paySupplier(owner, { supplierId: 1, amount: 1000, method: 'MPESA' as 'CASH' })).rejects.toThrow();
    await expect(
      createPurchase(owner, { supplierId: 1, invoiceNo: 'X', date: todayDar(), location: 'STORE', lines: [{ productId: 6, name: 'Charger 25W', type: 'accessory', qty: 1, unitCost: 100, imeis: [] }], paidNow: 100, method: 'MPESA' as 'CASH' }),
    ).rejects.toThrow(/Cash, Lipa Namba/);
  });

  it('reports keep old and new method totals so nothing is lost', async () => {
    const r = await getReport('owner', 'custom', { from: '2000-01-01', to: todayDar() });
    const methods = r.methods.map((m) => m.method);
    expect(methods).toContain('MPESA'); // history is still reported, not reclassified
    const total = salesFacts().flatMap((f) => f.payments).reduce((a, p) => a + p.amount, 0);
    expect(r.methods.reduce((a, m) => a + m.amount, 0)).toBe(total);
  });
});

describe('shop consistency: dashboard, reports and records agree', () => {
  it('today: dashboard = report = sum of sale records', async () => {
    const today = todayDar();
    const dash = await getShopDashboardLive('owner');
    const rep = await getReport('owner', 'today');
    const facts = salesFacts().filter((f) => f.date === today);
    const sum = summarize(facts, [rep.expenses ?? 0]);
    expect(dash.salesToday).toBe(rep.sales);
    expect(dash.salesCount).toBe(rep.count);
    expect(rep.sales).toBe(sum.sales);
    expect(dash.netProfitToday).toBe(rep.net);
    expect(dash.expensesToday).toBe(rep.expenses);
  });

  it('month report net = sales - cost of goods - expenses (expenses subtracted once)', async () => {
    const rep = await getReport('owner', 'month');
    expect(rep.net).toBe(rep.sales - rep.cogs! - rep.expenses!);
    expect(rep.gross).toBe(rep.sales - rep.cogs!);
    expect(rep.expensesByCategory!.reduce((a, c) => a + c.amount, 0)).toBe(rep.expenses);
  });

  it('custom range really limits the report to that range', async () => {
    const today = todayDar();
    const day = await getReport('owner', 'custom', { from: today, to: today });
    const month = periodRange('month', today);
    const mon = await getReport('owner', 'custom', month);
    expect(day.sales).toBeLessThanOrEqual(mon.sales);
    const past = await getReport('owner', 'custom', { from: '2000-01-01', to: '2000-01-31' });
    expect(past.sales).toBe(0);
  });

  it("sellers never receive cost or profit figures", async () => {
    const rep = await getReport('seller', 'month');
    expect(rep.net).toBeUndefined();
    expect(rep.cogs).toBeUndefined();
    expect((await getShopDashboardLive('seller')).netProfitToday).toBeUndefined();
  });

  it('debt overview total equals the sum of unpaid sales', async () => {
    const d = await getDebtOverview();
    expect(d.totalDebt).toBe(d.rows.reduce((a, r) => a + r.balance, 0));
  });
});

describe('stock rules in the shop', () => {
  it('an accessory sale deducts exactly the shop quantity and not the store', async () => {
    const before = (await listPosProducts()).find((p) => p.id === 7)!;
    const storeBefore = (await listProducts('owner')).find((p) => p.id === 7)!.storeQty;
    await completeSale(owner, { lines: [{ productId: 7, name: 'Phone cover', type: 'accessory', unitPrice: 15_000, qty: 3 }], discount: 0, payments: [{ method: 'CASH', amount: 45_000 }], customer: null });
    const after = (await listPosProducts()).find((p) => p.id === 7)!;
    expect(after.shopQty).toBe(before.shopQty - 3);
    expect((await listProducts('owner')).find((p) => p.id === 7)!.storeQty).toBe(storeBefore);
  });

  it('cannot sell more than is in the shop, and nothing is deducted when it fails', async () => {
    const before = (await listPosProducts()).find((p) => p.id === 8)!.shopQty;
    await expect(completeSale(owner, { lines: [{ productId: 8, name: 'Earbuds', type: 'accessory', unitPrice: 45_000, qty: before + 1 }], discount: 0, payments: [{ method: 'CASH', amount: 1 }], customer: null })).rejects.toThrow();
    expect((await listPosProducts()).find((p) => p.id === 8)!.shopQty).toBe(before);
  });

  it('a phone sale uses one IMEI exactly once', async () => {
    const phone = (await listPosProducts()).find((p) => p.id === 4)!;
    const imei = phone.imeis[0];
    const line = { productId: 4, name: 'Redmi 13', type: 'phone' as const, unitPrice: 420_000, qty: 1, imei };
    await completeSale(owner, { lines: [line], discount: 0, payments: [{ method: 'BANK', amount: 420_000 }], customer: null });
    await expect(completeSale(owner, { lines: [line], discount: 0, payments: [{ method: 'BANK', amount: 420_000 }], customer: null })).rejects.toThrow();
    const after = (await listPosProducts()).find((p) => p.id === 4)!;
    expect(after.imeis).not.toContain(imei);
    expect(after.shopQty).toBe(phone.shopQty - 1);
  });

  it('a transfer moves Store stock to Shop and cannot exceed Store stock', async () => {
    const p = (await listProducts('owner')).find((x) => x.id === 6)!;
    await expect(createTransfer(owner, { lines: [{ productId: 6, name: 'Charger 25W', type: 'accessory', qty: p.storeQty + 1, imeis: [] }] })).rejects.toThrow();
    await createTransfer(owner, { lines: [{ productId: 6, name: 'Charger 25W', type: 'accessory', qty: 2, imeis: [] }] });
    const after = (await listProducts('owner')).find((x) => x.id === 6)!;
    expect(after.storeQty).toBe(p.storeQty - 2);
    expect(after.shopQty).toBe(p.shopQty + 2);
  });

  it('phone transfers move the exact IMEI between locations', async () => {
    const store = await listStoreImeis();
    const imei = store[1]?.[0];
    expect(imei).toBeTruthy();
    await createTransfer(owner, { lines: [{ productId: 1, name: 'Samsung A15', type: 'phone', qty: 1, imeis: [imei] }] });
    expect((await listPosProducts()).find((p) => p.id === 1)!.imeis).toContain(imei);
    expect((await listStoreImeis())[1] ?? []).not.toContain(imei);
  });
});

describe('sales history', () => {
  it('can page past the first 60 sales', async () => {
    const first = await listSales('', 60);
    expect(first.items.length).toBe(60);
    expect(first.total).toBeGreaterThan(60);
    const more = await listSales('', 120);
    expect(more.items.length).toBe(Math.min(120, first.total));
    expect(more.items.slice(0, 60).map((s) => s.id)).toEqual(first.items.map((s) => s.id));
  });
});

describe('users (local store) and passwords', () => {
  it('hashes deterministically with a salt and verifies', () => {
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    const h = hashSecret('4321', 'salt1');
    expect(h).not.toContain('4321');
    expect(verifySecret('4321', 'salt1', h)).toBe(true);
    expect(verifySecret('4322', 'salt1', h)).toBe(false);
    expect(hashSecret('4321', 'salt2')).not.toBe(h);
  });

  it('password rules: 4 digits (the login PIN) and a matching confirmation', () => {
    expect(validateSecret('12', '12')).toMatch(/tarakimu 4/);
    expect(validateSecret('1234', '1235')).toMatch(/halifanani/);
    expect(validateSecret('1234', '1234')).toBeNull();
  });

  it('owner adds a seller who can then sign in; password is not stored in plain text', async () => {
    resetUsersForTest();
    const u = await localUsers.create(owner, { name: 'Neema Seller', phone: '0711 222 333', role: 'seller', isActive: true, password: '2468', confirm: '2468' });
    expect(u).not.toHaveProperty('hash');
    const stored = authUsers().find((x) => x.id === u.id)!;
    expect(JSON.stringify(stored)).not.toContain('2468');
    const login = createAuthService(authUsers);
    expect(login('0711222333', '2468')).toMatchObject({ ok: true });
    expect(login('0711222333', '1111')).toMatchObject({ ok: false });
    // existing seeded accounts still sign in
    expect(login('0712000001', '1234')).toMatchObject({ ok: true });
  });

  it('validates input, blocks duplicates and lets only the owner manage users', async () => {
    await expect(localUsers.create(owner, { name: 'X', phone: '0711222444', role: 'seller', isActive: true, password: '1234', confirm: '1234' })).rejects.toThrow();
    await expect(localUsers.create(owner, { name: 'Dup Phone', phone: '0711222333', role: 'seller', isActive: true, password: '1234', confirm: '1234' })).rejects.toThrow(/tayari/);
    await expect(localUsers.create(owner, { name: 'No Match', phone: '0711222555', role: 'seller', isActive: true, password: '1234', confirm: '9999' })).rejects.toThrow(/halifanani/);
    await expect(localUsers.create(seller, { name: 'Sneaky', phone: '0711222666', role: 'owner', isActive: true, password: '1234', confirm: '1234' })).rejects.toThrow(/Mmiliki/);
  });

  it('disabled users cannot sign in; the last owner and your own account are protected', async () => {
    const list = await localUsers.list();
    const neema = list.find((x) => x.name === 'Neema Seller')!;
    await localUsers.update(owner, neema.id, { name: neema.name, phone: neema.phone, role: 'seller', isActive: false });
    expect(createAuthService(authUsers)('0711222333', '2468')).toMatchObject({ ok: false, reason: 'inactive' });
    await localUsers.update(owner, neema.id, { name: neema.name, phone: neema.phone, role: 'seller', isActive: true, password: '1357', confirm: '1357' });
    const login = createAuthService(authUsers);
    expect(login('0711222333', '2468').ok).toBe(false); // old password no longer works
    expect(login('0711222333', '1357').ok).toBe(true);
    await expect(localUsers.update(owner, 1, { name: 'Mmiliki Mkuu', phone: '0712000001', role: 'seller', isActive: true })).rejects.toThrow(/mmiliki/);
    await expect(localUsers.update(owner, 1, { name: 'Mmiliki Mkuu', phone: '0712000001', role: 'owner', isActive: false })).rejects.toThrow();
  });
});

describe('Store: receiving, creating, transferring and notifications', () => {
  it('receives stock into Store only, without a supplier, and logs it as a purchase', async () => {
    const before = (await listProducts('owner')).find((p) => p.id === 5)!;
    await createPurchase(owner, { supplierId: null, invoiceNo: '', date: todayDar(), location: 'STORE', lines: [{ productId: 5, name: 'Screen protector A15', type: 'accessory', qty: 40, unitCost: 3000, imeis: [] }], paidNow: 0, method: 'CASH' });
    const after = (await listProducts('owner')).find((p) => p.id === 5)!;
    expect(after.storeQty).toBe(before.storeQty + 40);
    expect(after.shopQty).toBe(before.shopQty);
    expect(listStockEvents(20).some((e) => e.kind === 'RECEIVED' && e.qty === 40 && e.location === 'STORE')).toBe(true);
  });

  it('a phone IMEI is optional, but one given must be valid, unique and not above the quantity', async () => {
    const dup = (await listStoreImeis())[1][0];
    const line = (imeis: string[], qty = imeis.length) => ({ productId: 1, name: 'Samsung A15', type: 'phone' as const, qty, unitCost: 780_000, imeis });
    const base = { supplierId: null, invoiceNo: '', date: todayDar(), location: 'STORE' as const, paidNow: 0, method: 'CASH' as const };
    await expect(createPurchase(owner, { ...base, lines: [line([dup])] })).rejects.toThrow(/tayari ipo/);
    await expect(createPurchase(owner, { ...base, lines: [line([dup, dup], 1)] })).rejects.toThrow(/nyingi kuliko/);
  });

  it('a new product created in Store puts its initial quantity (and IMEIs) in Store, not the Shop', async () => {
    const id = await createProduct(owner, { name: 'Store Test Phone', type: 'phone', costPrice: 100_000, sellPrice: 150_000, minStock: 2, initialShopQty: 2, imeis: ['490154203237518', '356938035643809'] }, 'STORE');
    const row = (await listProducts('owner')).find((p) => p.id === id)!;
    expect([row.storeQty, row.shopQty, row.minStock]).toEqual([2, 0, 2]);
    expect(row.storeImeis.length).toBe(2);
    expect(row.shopImeis.length).toBe(0);
    // quantity is mandatory, accessories need no IMEIs
    await expect(createProduct(owner, { name: 'No Qty', type: 'accessory', costPrice: 1, sellPrice: 2, minStock: 1, initialShopQty: undefined as unknown as number }, 'STORE')).rejects.toThrow();
    const acc = await createProduct(owner, { name: 'Store Test Case', type: 'accessory', costPrice: 1000, sellPrice: 3000, minStock: 5, initialShopQty: 9 }, 'STORE');
    const accRow = (await listProducts('owner')).find((p) => p.id === acc)!;
    expect([accRow.storeQty, accRow.shopQty]).toEqual([9, 0]);
    // moving it to the Shop is a transfer, not a purchase
    await createTransfer(owner, { lines: [{ productId: acc, name: accRow.name, type: 'accessory', qty: 4, imeis: [] }] });
    const moved = (await listProducts('owner')).find((p) => p.id === acc)!;
    expect([moved.storeQty, moved.shopQty]).toEqual([5, 4]);
  });

  it('notifications are derived from real data and the read state persists per user', async () => {
    const list = await listNotifications({ id: 1, role: 'owner' });
    const products = await listProducts('owner');
    const lowStore = products.filter((p) => p.storeStatus !== 'IPO').length;
    expect(list.filter((n) => n.id.startsWith('stock:STORE:')).length).toBe(lowStore);
    expect(list.some((n) => n.kind === 'TRANSFERRED' || n.kind === 'RECEIVED')).toBe(true);
    expect(list.every((n) => !n.read)).toBe(true);
    markRead(1, [list[0].id]);
    const again = await listNotifications({ id: 1, role: 'owner' });
    expect(again.filter((n) => n.read).map((n) => n.id)).toEqual([list[0].id]);
    expect((await listNotifications({ id: 2, role: 'seller' })).every((n) => !n.read)).toBe(true); // another user is unaffected
    // a stock change raises a new alert
    const phone = products.find((p) => p.id === 3)!; // iPhone 11: low in the shop
    expect(list.some((n) => n.id.includes(`:SHOP:${phone.id}:`))).toBe(true);
  });
});
