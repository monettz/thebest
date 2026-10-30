import { describe, expect, it } from 'vitest';
import { imeiFromBody } from './sales';
import {
  allocateSupplierPayments,
  parseImeis,
  validateDirectStockIn,
  validatePurchase,
  validateSupplierPayment,
  validateTransfer,
  type PurchaseInput,
} from './stock';

const A = imeiFromBody('35912000000001');
const B = imeiFromBody('35912000000002');
const errs = (r: { ok: boolean; errors?: string[] }) => (r.ok ? '' : (r.errors ?? []).join(' | '));

const purchase = (over: Partial<PurchaseInput> = {}): PurchaseInput => ({
  supplierId: 1,
  invoiceNo: 'INV-1',
  date: '2026-10-29',
  location: 'STORE',
  lines: [{ productId: 1, name: 'Samsung A15', type: 'phone', qty: 2, unitCost: 780_000, imeis: [A, B] }],
  paidNow: 0,
  method: 'CASH',
  ...over,
});
const ctx = { knownImeis: new Set<string>(), today: '2026-10-29' };

describe('receiving goods', () => {
  it('accepts valid IMEIs and computes the supplier debt', () => {
    const r = validatePurchase(purchase({ paidNow: 1_000_000 }), ctx);
    expect(r).toMatchObject({ ok: true, total: 1_560_000, owed: 560_000 });
  });
  it('IMEI is optional, but each one given must be valid and unique', () => {
    const lines = (imeis: string[]) => [{ productId: 1, name: 'Samsung A15', type: 'phone' as const, qty: 2, unitCost: 1, imeis }];
    expect(validatePurchase(purchase({ lines: lines([A]) }), ctx).ok).toBe(true); // IMEI ni hiari: 1 kati ya 2 inakubalika
    expect(validatePurchase(purchase({ lines: lines([]) }), ctx).ok).toBe(true);
    expect(errs(validatePurchase(purchase({ lines: lines([A, B, '359120000000999']) }), ctx))).toMatch(/nyingi kuliko/);
    expect(errs(validatePurchase(purchase({ lines: lines([A, '123456789012345']) }), ctx))).toMatch(/si sahihi/);
    expect(errs(validatePurchase(purchase({ lines: lines([A, A]) }), ctx))).toMatch(/imerudiwa/);
    expect(errs(validatePurchase(purchase(), { ...ctx, knownImeis: new Set([B]) }))).toMatch(/tayari ipo/);
  });
  it('accessories need no IMEI', () => {
    const r = validatePurchase(
      purchase({ lines: [{ productId: 5, name: 'Protector', type: 'accessory', qty: 200, unitCost: 3000, imeis: [] }] }),
      ctx,
    );
    expect(r).toMatchObject({ ok: true, total: 600_000 });
  });
  it('supplier is optional, but you cannot pay more than the total', () => {
    expect(validatePurchase(purchase({ supplierId: null }), ctx).ok).toBe(true);
    expect(errs(validatePurchase(purchase({ paidNow: 2_000_000 }), ctx))).toMatch(/kinazidi/);
  });
  it('splits scanned text into IMEIs', () => {
    expect(parseImeis(`${A}, ${B}\n${A}`)).toEqual([A, B, A]);
  });
});

describe('transfer Store to Shop', () => {
  const stock = { storeStock: { 1: 24, 5: 420, 6: 12 }, storeImeis: new Set([A, B]) };
  const phone = (imeis: string[], qty = imeis.length) => ({ productId: 1, name: 'Samsung A15', type: 'phone' as const, qty, imeis });
  const acc = (qty: number) => ({ productId: 6, name: 'Charger 25W', type: 'accessory' as const, qty, imeis: [] });

  it('accepts quantities within Store stock', () => {
    expect(validateTransfer([phone([A, B]), acc(12)], stock).ok).toBe(true);
  });
  it('never takes more than Store has', () => {
    expect(errs(validateTransfer([acc(14)], stock))).toMatch(/zilizopo store ni 12, umeweka 14/);
  });
  it('picked IMEIs are optional, at most the quantity, and must be in Store', () => {
    expect(errs(validateTransfer([phone([A, B], 1)], stock))).toMatch(/nyingi kuliko/);
    expect(errs(validateTransfer([phone(['359120000000999'])], stock))).toMatch(/haipo store/);
    expect(errs(validateTransfer([phone([A, A])], stock))).toMatch(/mara mbili/);
  });
  it('rejects an empty transfer', () => {
    expect(errs(validateTransfer([], stock))).toMatch(/angalau/);
  });
});

describe('supplier payments', () => {
  it('is > 0 and at most what is owed', () => {
    expect(validateSupplierPayment(0, 100)).toMatch(/sifuri/);
    expect(validateSupplierPayment(101, 100)).toMatch(/kinazidi/);
    expect(validateSupplierPayment(100, 100)).toBeNull();
    expect(validateSupplierPayment(5, 0)).toMatch(/Hakuna deni/);
  });
  it('spreads loose payments over the oldest purchases first', () => {
    const owed = allocateSupplierPayments(
      [{ id: 1, total: 1000 }, { id: 2, total: 500 }],
      [{ purchaseId: 2, amount: 100 }, { purchaseId: null, amount: 1200 }],
    );
    expect(owed.get(1)).toBe(0);
    expect(owed.get(2)).toBe(200); // 500 - 100 direct - 200 loose left after clearing purchase 1
  });
});

describe('add new stock directly to Shop (validateDirectStockIn)', () => {
  it('validates phones with matching IMEIs and accessories without requiring a supplier', () => {
    const res = validateDirectStockIn(
      [
        { productId: 1, name: 'Samsung A15', type: 'phone', qty: 2, unitCost: 780_000, imeis: [A, B] },
        { productId: 6, name: 'Charger 25W', type: 'accessory', qty: 5, unitCost: 18_000, imeis: [] },
      ],
      { knownImeis: new Set() },
    );
    expect(res).toEqual({ ok: true, total: 2 * 780_000 + 5 * 18_000 });
  });

  it('rejects duplicate products, invalid quantities, or mismatched IMEIs', () => {
    const dup = validateDirectStockIn(
      [
        { productId: 6, name: 'Charger 25W', type: 'accessory', qty: 2, unitCost: 18_000, imeis: [] },
        { productId: 6, name: 'Charger 25W', type: 'accessory', qty: 3, unitCost: 18_000, imeis: [] },
      ],
      { knownImeis: new Set() },
    );
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.errors.join(' ')).toMatch(/mara mbili/);

    const badImei = validateDirectStockIn(
      [{ productId: 1, name: 'Samsung A15', type: 'phone', qty: 2, unitCost: 780_000, imeis: [A] }],
      { knownImeis: new Set() },
    );
    expect(badImei.ok).toBe(true); // 1 kati ya 2 inakubalika
    const tooMany = validateDirectStockIn(
      [{ productId: 1, name: 'Samsung A15', type: 'phone', qty: 1, unitCost: 780_000, imeis: [A, B] }],
      { knownImeis: new Set() },
    );
    expect(tooMany.ok).toBe(false);
    if (!tooMany.ok) expect(tooMany.errors.join(' ')).toMatch(/nyingi kuliko/);
  });
});
