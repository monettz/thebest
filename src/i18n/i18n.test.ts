import { afterEach, describe, expect, it } from 'vitest';
import { validateCheckout, type CheckoutContext } from '@shared/sales';
import { validateTransfer, validatePurchase, validateSupplierPayment } from '@shared/stock';
import { validateCount } from '@shared/stocktake';
import { planReturn, planVoid } from '@shared/returns';
import { validateDebtPayment, dueTag } from '@shared/debts';
import { normalizePhone } from '@shared/schemas';
import { EN } from './en';
import { setLanguage, tr } from './index';

afterEach(() => setLanguage('sw'));

describe('translator', () => {
  it('leaves Swahili untouched and fills named slots', () => {
    expect(tr('Mauzo ya leo')).toBe('Mauzo ya leo');
    expect(tr('Bidhaa {n} kwenye kikapu', { n: 3 })).toBe('Bidhaa 3 kwenye kikapu');
  });

  it('translates exact sentences, slots and patterns into English', () => {
    setLanguage('en');
    expect(tr('Mauzo ya leo')).toBe("Today's Sales");
    expect(tr('Bidhaa {n} kwenye kikapu', { n: 3 })).toBe('3 items in the cart');
    // a message built elsewhere (not through a template) is matched by pattern
    expect(tr('Samsung A15: zilizopo dukani ni 6 tu')).toBe('Samsung A15: only 6 in the shop');
  });

  it('translates words captured inside a pattern', () => {
    setLanguage('en');
    expect(tr('Simu · 28 zimeuzwa')).toBe('Phones · 28 sold');
  });

  it('translates multi-line messages line by line and leaves unknown text alone', () => {
    setLanguage('en');
    expect(tr('Kikapu ni tupu\nPunguzo si sahihi')).toBe('The cart is empty\nInvalid discount');
    expect(tr('Samsung A15')).toBe('Samsung A15');
  });

  it('keeps every slot of the Swahili key in the English text', () => {
    for (const [sw, en] of Object.entries(EN)) {
      expect(en.trim().length, sw).toBeGreaterThan(0);
      const slots = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
      expect(slots(en), `slots of "${sw}"`).toBe(slots(sw));
    }
  });
});

describe('every rule message has an English version', () => {
  const ctx: CheckoutContext = { shopStock: { 5: 1 }, availableImeis: new Set(), maxDiscountPct: 5, isOwner: false, ownerPinOk: false, today: '2026-10-29' };
  const messages = (): string[] => {
    const out: string[] = [];
    const add = (...m: (string | null | undefined | string[])[]) => m.forEach((x) => (Array.isArray(x) ? out.push(...x) : x && out.push(x)));
    const bad = validateCheckout(
      {
        lines: [
          { productId: 1, name: 'Samsung A15', type: 'phone', unitPrice: 900_000, qty: 1, imei: '123456789012345' },
          { productId: 1, name: 'Samsung A15', type: 'phone', unitPrice: 900_000, qty: 1, imei: '123456789012345' },
          { productId: 5, name: 'Charger', type: 'accessory', unitPrice: 10_000, qty: 9 },
        ],
        discount: 500_000,
        payments: [{ method: 'CASH', amount: 100 }],
        dueDate: '2020-01-01',
      },
      ctx,
    );
    add(bad.ok ? [] : bad.errors);
    const empty = validateCheckout({ lines: [], discount: 0, payments: [{ method: 'CASH', amount: 0 }] }, ctx);
    add(empty.ok ? [] : empty.errors);
    const t = validateTransfer([{ productId: 6, name: 'Charger', type: 'accessory', qty: 14, imeis: [] }, { productId: 1, name: 'Samsung', type: 'phone', qty: 2, imeis: ['x'] }], { storeStock: { 6: 12 }, storeImeis: new Set() });
    add(t.ok ? [] : t.errors);
    const p = validatePurchase({ supplierId: null, invoiceNo: '', date: '2099-01-01', location: 'STORE', lines: [{ productId: 1, name: 'Samsung', type: 'phone', qty: 2, unitCost: -1, imeis: ['1', '1'] }], paidNow: 9e9, method: 'CASH' }, { knownImeis: new Set(), today: '2026-10-29' });
    add(p.ok ? [] : p.errors);
    add(validateSupplierPayment(0, 10), validateSupplierPayment(20, 10), validateSupplierPayment(5, 0));
    add(validateDebtPayment(0, 10), validateDebtPayment(20, 10), validateDebtPayment(5, 0));
    add(validateCount([{ productId: 1, name: 'Samsung', type: 'phone', systemQty: 3, countedQty: 5 }, { productId: 6, name: 'Charger', type: 'accessory', systemQty: 3, countedQty: 1 }]));
    const snap = { status: 'VOID' as const, subtotal: 100, total: 100, paidNet: 100, returnedValue: 0, lines: [{ qty: 1, unitPrice: 100, returnedQty: 0 }] };
    const r1 = planReturn(snap, [{ lineIndex: 0, qty: 5 }], '');
    const r2 = planVoid(snap, 'seller', '');
    add(r1.ok ? [] : r1.errors, r2.ok ? [] : r2.errors);
    add(dueTag('2026-10-17', '2026-10-29').label, dueTag('2026-11-03', '2026-10-29').label);
    return out;
  };

  it('translates all of them', () => {
    setLanguage('en');
    const all = messages();
    expect(all.length).toBeGreaterThan(20);
    const untranslated = all.filter((m) => tr(m) === m);
    expect(untranslated).toEqual([]);
  });

  it('phone numbers are not affected', () => {
    expect(normalizePhone('0712345678')).toBe('255712345678');
  });
});
