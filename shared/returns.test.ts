import { describe, expect, it } from 'vitest';
import { planReturn, planVoid, type SaleSnapshot } from './returns';

// Phone 900,000 + 2 protectors at 10,000 = 920,000, no discount
const sale = (over: Partial<SaleSnapshot> = {}): SaleSnapshot => ({
  status: 'PAID',
  subtotal: 920_000,
  total: 920_000,
  paidNet: 920_000,
  returnedValue: 0,
  lines: [
    { qty: 1, unitPrice: 900_000, imei: '359101000079197', returnedQty: 0 },
    { qty: 2, unitPrice: 10_000, returnedQty: 0 },
  ],
  ...over,
});
const errs = (r: { ok: boolean; errors?: string[] }) => (r.ok ? '' : (r.errors ?? []).join(' | '));

describe('void', () => {
  it('is owner only and needs a reason', () => {
    expect(errs(planVoid(sale(), 'seller', 'kosa'))).toMatch(/Mmiliki tu/);
    expect(errs(planVoid(sale(), 'owner', ''))).toMatch(/sababu/);
  });
  it('refunds everything paid and restocks every remaining line', () => {
    const p = planVoid(sale(), 'owner', 'Mteja amebadili mawazo');
    expect(p).toMatchObject({ ok: true, refund: 920_000 });
    if (p.ok) expect(p.restock).toEqual([{ lineIndex: 0, qty: 1 }, { lineIndex: 1, qty: 2 }]);
  });
  it('refunds only what was actually paid on a debt sale', () => {
    const p = planVoid(sale({ status: 'PARTIAL', paidNet: 500_000 }), 'owner', 'kosa la bei');
    expect(p).toMatchObject({ ok: true, refund: 500_000 });
  });
  it('skips lines already returned and cannot void twice', () => {
    const s = sale({ returnedValue: 900_000, paidNet: 20_000, lines: [{ qty: 1, unitPrice: 900_000, returnedQty: 1 }, { qty: 2, unitPrice: 10_000, returnedQty: 0 }] });
    const p = planVoid(s, 'owner', 'kosa');
    if (p.ok) expect(p.restock).toEqual([{ lineIndex: 1, qty: 2 }]);
    expect(errs(planVoid(sale({ status: 'VOID' }), 'owner', 'kosa'))).toMatch(/yamefutwa/);
  });
});

describe('return', () => {
  it('refunds in cash when the sale was fully paid', () => {
    const p = planReturn(sale(), [{ lineIndex: 1, qty: 1 }], 'Haifai');
    expect(p).toMatchObject({ ok: true, value: 10_000, refund: 10_000, newBalance: 0 });
  });

  it('on a debt sale the return reduces the debt first, no cash out', () => {
    // paid 500,000 of 920,000; returning the 900,000 phone leaves a 20,000 total, so 480,000 comes back
    const s = sale({ status: 'PARTIAL', paidNet: 500_000 });
    expect(planReturn(s, [{ lineIndex: 1, qty: 2 }], 'Haifai')).toMatchObject({ ok: true, value: 20_000, refund: 0, newBalance: 400_000 + 0 });
    const phone = planReturn(s, [{ lineIndex: 0, qty: 1 }], 'Simu mbovu');
    expect(phone).toMatchObject({ ok: true, value: 900_000, refund: 480_000, newBalance: 0 });
  });

  it('cannot return more than was sold or already returned', () => {
    expect(errs(planReturn(sale(), [{ lineIndex: 1, qty: 3 }], 'kosa'))).toMatch(/2 tu/);
    const s = sale({ lines: [{ qty: 1, unitPrice: 900_000, returnedQty: 0 }, { qty: 2, unitPrice: 10_000, returnedQty: 2 }], returnedValue: 20_000, paidNet: 900_000, total: 920_000 });
    expect(errs(planReturn(s, [{ lineIndex: 1, qty: 1 }], 'kosa'))).toMatch(/0 tu/);
  });

  it('needs a reason, an item and a non-void sale', () => {
    expect(errs(planReturn(sale(), [{ lineIndex: 0, qty: 1 }], ''))).toMatch(/sababu/);
    expect(errs(planReturn(sale(), [], 'kosa'))).toMatch(/Chagua bidhaa/);
    expect(errs(planReturn(sale({ status: 'VOID' }), [{ lineIndex: 0, qty: 1 }], 'kosa'))).toMatch(/yamefutwa/);
  });

  it('shares a discount proportionally and settles rounding on the last return', () => {
    // 3 x 10,000 = 30,000 less 1 = 29,999 total
    const s: SaleSnapshot = { status: 'PAID', subtotal: 30_000, total: 29_999, paidNet: 29_999, returnedValue: 0, lines: [{ qty: 3, unitPrice: 10_000, returnedQty: 0 }] };
    const a = planReturn(s, [{ lineIndex: 0, qty: 1 }], 'kosa');
    expect(a).toMatchObject({ ok: true, value: 9_999 });
    const b = planReturn({ ...s, returnedValue: 9_999, paidNet: 20_000, lines: [{ qty: 3, unitPrice: 10_000, returnedQty: 1 }] }, [{ lineIndex: 0, qty: 2 }], 'kosa');
    expect(b).toMatchObject({ ok: true, value: 20_000, refund: 20_000 });
  });
});
