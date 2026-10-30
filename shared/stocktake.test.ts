import { describe, expect, it } from 'vitest';
import { planApproval, shortageValue, validateCount, type CountLine } from './stocktake';

const acc = (system: number, counted: number, reason?: CountLine['reason']): CountLine => ({
  productId: 6, name: 'Charger 25W', type: 'accessory', systemQty: system, countedQty: counted, reason,
});
const phone = (system: number, counted: number, over: Partial<CountLine> = {}): CountLine => ({
  productId: 1, name: 'Samsung A15', type: 'phone', systemQty: system, countedQty: counted,
  systemImeis: ['A', 'B', 'C'], missingImeis: [], ...over,
});

describe('submitting a count', () => {
  it('needs a reason whenever the count differs', () => {
    expect(validateCount([acc(12, 12)])).toEqual([]);
    expect(validateCount([acc(12, 10)])[0]).toMatch(/sababu/);
    expect(validateCount([acc(12, 10, 'LOST')])).toEqual([]);
    expect(validateCount([acc(12, 15, 'ENTRY_ERROR')])).toEqual([]);
  });
  it('rejects negative or fractional counts and empty sheets', () => {
    expect(validateCount([acc(12, -1, 'OTHER')])[0]).toMatch(/si sahihi/);
    expect(validateCount([acc(12, 1.5, 'OTHER')])[0]).toMatch(/si sahihi/);
    expect(validateCount([])[0]).toMatch(/Hakuna/);
  });
  it('phones: missing IMEIs are optional, at most the shortage, and exist at the location', () => {
    expect(validateCount([phone(3, 3)])).toEqual([]);
    expect(validateCount([phone(3, 2, { reason: 'LOST' })])).toEqual([]); // IMEI ni hiari
    expect(validateCount([phone(3, 2, { reason: 'LOST', missingImeis: ['A', 'B'] })])[0]).toMatch(/nyingi kuliko/);
    expect(validateCount([phone(3, 2, { reason: 'LOST', missingImeis: ['B'] })])).toEqual([]);
    expect(validateCount([phone(3, 2, { reason: 'LOST', missingImeis: ['Z'] })])[0]).toMatch(/haipo/);
    expect(validateCount([phone(3, 1, { reason: 'LOST', missingImeis: ['B', 'B'] })]).join()).toMatch(/mara mbili/);
  });
  it('phones cannot be found in surplus', () => {
    expect(validateCount([phone(3, 4, { reason: 'ENTRY_ERROR' })])[0]).toMatch(/Pokea mzigo/);
  });
});

describe('approving a count', () => {
  it('turns each difference into an adjustment', () => {
    const plan = planApproval([acc(12, 10, 'LOST'), acc(5, 5), phone(3, 2, { reason: 'DAMAGED', missingImeis: ['A'] })], { 6: 12, 1: 3 });
    expect(plan.ok && plan.adjustments).toEqual([
      { productId: 6, name: 'Charger 25W', delta: -2, reason: 'LOST', missingImeis: [] },
      { productId: 1, name: 'Samsung A15', delta: -1, reason: 'DAMAGED', missingImeis: ['A'] },
    ]);
  });
  it('keeps sales made after counting by applying the difference, and never goes below zero', () => {
    // counted 10 of 12, then 11 were sold before approval: only 1 left, can not remove 2
    expect(planApproval([acc(12, 10, 'LOST')], { 6: 1 })).toMatchObject({ ok: false });
    // 3 sold meanwhile: 9 left, minus the 2 missing = 7
    expect(planApproval([acc(12, 10, 'LOST')], { 6: 9 })).toMatchObject({ ok: true });
  });
});

describe('shortage value', () => {
  it('counts only what is missing, at cost', () => {
    expect(shortageValue([acc(12, 10, 'LOST'), acc(5, 8, 'ENTRY_ERROR')], { 6: 18_000 })).toBe(36_000);
  });
});
