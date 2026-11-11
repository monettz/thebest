import { describe, expect, it } from 'vitest';
import { PAYMENT_LABEL, POS_PAYMENT_METHODS } from './constants';
import {
  availableImeisForLine,
  changeLineImei,
  imeiFromBody,
  luhnValid,
  pickAvailableImei,
  validateCheckout,
  type CartLine,
  type CheckoutContext,
  type CheckoutInput,
} from './sales';

const IMEI_A = imeiFromBody('35912000000001');
const IMEI_B = imeiFromBody('35912000000002');
const IMEI_C = imeiFromBody('35912000000003');

const phone = (imei = IMEI_A): CartLine => ({ productId: 1, name: 'Samsung A15', type: 'phone', unitPrice: 900_000, qty: 1, imei });
const acc = (qty: number): CartLine => ({ productId: 5, name: 'Screen protector', type: 'accessory', unitPrice: 10_000, qty });

const ctx: CheckoutContext = {
  shopStock: { 1: 5, 5: 37 },
  availableImeis: new Set([IMEI_A, IMEI_B]),
  maxDiscountPct: 5,
  isOwner: false,
  ownerPinOk: false,
  today: '2026-10-29',
};
const base = (over: Partial<CheckoutInput>): CheckoutInput => ({
  lines: [phone()],
  discount: 0,
  payments: [{ method: 'CASH', amount: 900_000 }],
  ...over,
});
const errs = (r: ReturnType<typeof validateCheckout>) => (r.ok ? [] : r.errors).join(' | ');

describe('IMEI', () => {
  it('generates and validates Luhn IMEIs', () => {
    expect(luhnValid(IMEI_A)).toBe(true);
    expect(luhnValid('359120000000019')).toBe(IMEI_A === '359120000000019');
    expect(luhnValid('123')).toBe(false);
  });
});

describe('checkout rules', () => {
  it('the sale date can be today or a past day, never a future or malformed one', () => {
    const line: CartLine = { productId: 1, name: 'Samsung A15', type: 'phone', unitPrice: 900_000, qty: 1 };
    const sale = (soldOn?: string) => validateCheckout(base({ lines: [line], payments: [{ method: 'CASH', amount: 900_000 }], soldOn }), ctx);
    expect(sale()).toMatchObject({ ok: true });
    expect(sale('2026-10-29')).toMatchObject({ ok: true });
    expect(sale('2026-10-20')).toMatchObject({ ok: true });
    expect(errs(sale('2026-10-30'))).toMatch(/haiwezi kuwa ya kesho/);
    expect(errs(sale('29/10/2026'))).toMatch(/Weka tarehe ya mauzo/);
  });

  it('a phone can be sold without an IMEI, but only up to the quantity in the shop', () => {
    const noImei: CartLine = { productId: 1, name: 'Samsung A15', type: 'phone', unitPrice: 900_000, qty: 2 };
    expect(validateCheckout(base({ lines: [noImei], payments: [{ method: 'CASH', amount: 1_800_000 }] }), ctx)).toMatchObject({ ok: true, total: 1_800_000 });
    expect(errs(validateCheckout(base({ lines: [{ ...noImei, qty: 6 }], payments: [{ method: 'CASH', amount: 5_400_000 }] }), ctx))).toMatch(/zilizopo dukani ni 5/);
  });
  it('an IMEI that is given must be in the shop and used once', () => {
    expect(errs(validateCheckout(base({ lines: [phone(IMEI_C)] }), ctx))).toMatch(/haipatikani/);
    expect(errs(validateCheckout(base({ lines: [phone(), phone()], payments: [{ method: 'CASH', amount: 1_800_000 }] }), ctx))).toMatch(/mara mbili/);
  });
  it('accepts a full payment as PAID', () => {
    const r = validateCheckout(base({}), ctx);
    expect(r).toMatchObject({ ok: true, total: 900_000, balance: 0, status: 'PAID' });
  });

  it('accepts split payments that sum to the total', () => {
    const r = validateCheckout(
      base({ payments: [{ method: 'CASH', amount: 400_000 }, { method: 'LIPA_NAMBA', amount: 500_000 }] }),
      ctx,
    );
    expect(r).toMatchObject({ ok: true, balance: 0 });
  });

  it('exposes the three POS checkout payment options: Cash, Lipa Namba, Bank', () => {
    expect(POS_PAYMENT_METHODS).toEqual(['CASH', 'LIPA_NAMBA', 'BANK']);
    expect(POS_PAYMENT_METHODS.map((m) => PAYMENT_LABEL[m])).toEqual(['Cash', 'Lipa Namba', 'Bank']);
  });

  it('rejects overpayment', () => {
    expect(errs(validateCheckout(base({ payments: [{ method: 'CASH', amount: 900_001 }] }), ctx))).toMatch(/zimezidi|yamezidi/);
  });

  it('walk-in must pay in full', () => {
    const r = validateCheckout(base({ payments: [{ method: 'CASH', amount: 500_000 }] }), ctx);
    expect(errs(r)).toMatch(/Deni linahitaji jina na simu/);
  });

  it('debt needs customer and due date, then is PARTIAL', () => {
    const input = base({
      payments: [{ method: 'CASH', amount: 500_000 }],
      customer: { name: 'Juma Hassan', phone: '0712345678' },
    });
    expect(errs(validateCheckout(input, ctx))).toMatch(/tarehe ya kulipa/);
    const r = validateCheckout({ ...input, dueDate: '2026-11-15' }, ctx);
    expect(r).toMatchObject({ ok: true, balance: 400_000, status: 'PARTIAL' });
  });

  it('rejects a due date in the past', () => {
    const r = validateCheckout(
      base({ payments: [], customer: { name: 'Juma Hassan', phone: '0712345678' }, dueDate: '2026-10-01' }),
      ctx,
    );
    expect(errs(r)).toMatch(/imepita/);
  });

  it('cannot sell an IMEI that is not in the shop, or twice', () => {
    expect(errs(validateCheckout(base({ lines: [phone('359120000000999')] }), ctx))).toMatch(/haipatikani/);
    expect(errs(validateCheckout(base({ lines: [phone(), phone()] }), ctx))).toMatch(/mara mbili/);
  });

  it('stock can never go below zero', () => {
    const r = validateCheckout(base({ lines: [acc(38)], payments: [{ method: 'CASH', amount: 380_000 }] }), ctx);
    expect(errs(r)).toMatch(/zilizopo dukani ni 37/);
    expect(validateCheckout(base({ lines: [acc(37)], payments: [{ method: 'CASH', amount: 370_000 }] }), ctx).ok).toBe(true);
  });

  it('discount above the max needs the owner PIN', () => {
    const input = base({ discount: 100_000, payments: [{ method: 'CASH', amount: 800_000 }] });
    expect(errs(validateCheckout(input, ctx))).toMatch(/PIN ya mmiliki/);
    expect(validateCheckout(input, { ...ctx, ownerPinOk: true }).ok).toBe(true);
    expect(validateCheckout(input, { ...ctx, isOwner: true }).ok).toBe(true);
    // within the limit (5% of 900,000 = 45,000) needs no PIN
    expect(validateCheckout(base({ discount: 45_000, payments: [{ method: 'CASH', amount: 855_000 }] }), ctx).ok).toBe(true);
  });

  it('rejects an empty cart', () => {
    expect(errs(validateCheckout(base({ lines: [], payments: [] }), ctx))).toMatch(/tupu/);
  });
});

describe('automatic IMEI selection and changing IMEI', () => {
  it('1. selects a phone with one available IMEI automatically', () => {
    const picked = pickAvailableImei([IMEI_A], []);
    expect(picked).toBe(IMEI_A);
  });

  it('2. selects a phone with multiple available IMEIs and assigns the first free one', () => {
    const picked = pickAvailableImei([IMEI_A, IMEI_B, IMEI_C], []);
    expect(picked).toBe(IMEI_A);
  });

  it('3. returns null when selecting a phone with no available IMEIs', () => {
    expect(pickAvailableImei([], [])).toBeNull();
    expect(pickAvailableImei([IMEI_A], [phone(IMEI_A)])).toBeNull();
  });

  it('4. allows changing an assigned IMEI to another available IMEI and prevents duplicates', () => {
    const pool = new Set([IMEI_A, IMEI_B, IMEI_C]);
    const initial = [phone(IMEI_A), phone(IMEI_B)];
    expect(availableImeisForLine([IMEI_A, IMEI_B, IMEI_C], initial, 0)).toEqual([IMEI_A, IMEI_C]);

    // Changing line 0 from IMEI_A to IMEI_C succeeds
    const changed = changeLineImei(initial, 0, IMEI_C, pool);
    expect(changed.ok).toBe(true);
    if (changed.ok) {
      expect(changed.lines[0].imei).toBe(IMEI_C);
      expect(changed.lines[1].imei).toBe(IMEI_B);
    }

    // Changing line 0 to IMEI_B (already in cart on line 1) fails
    const dup = changeLineImei(initial, 0, IMEI_B, pool);
    expect(dup.ok).toBe(false);

    // Changing line 0 to an unavailable IMEI fails
    const missing = changeLineImei(initial, 0, '359120000000999', pool);
    expect(missing.ok).toBe(false);
  });

  it('5. assigns unique IMEIs when adding multiple phones', () => {
    const productImeis = [IMEI_A, IMEI_B, IMEI_C];
    const lines: CartLine[] = [];
    for (let i = 0; i < 3; i++) {
      const next = pickAvailableImei(productImeis, lines);
      expect(next).not.toBeNull();
      lines.push(phone(next!));
    }
    expect(lines.map((l) => l.imei)).toEqual([IMEI_A, IMEI_B, IMEI_C]);
    expect(new Set(lines.map((l) => l.imei)).size).toBe(3);
    // 4th attempt returns null because all 3 available IMEIs are now in the cart
    expect(pickAvailableImei(productImeis, lines)).toBeNull();
  });
});
