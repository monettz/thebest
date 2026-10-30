import { describe, expect, it } from 'vitest';
import { addDays, ageBucket, daysBetween, debtPaymentSms, dueTag, validateDebtPayment } from './debts';

describe('debt payment rule', () => {
  it('must be > 0 and <= balance', () => {
    expect(validateDebtPayment(0, 200_000)).toMatch(/sifuri/);
    expect(validateDebtPayment(-5, 200_000)).toMatch(/sifuri/);
    expect(validateDebtPayment(1.5, 200_000)).toMatch(/sifuri/);
    expect(validateDebtPayment(200_001, 200_000)).toMatch(/inazidi/);
    expect(validateDebtPayment(200_000, 200_000)).toBeNull();
    expect(validateDebtPayment(1, 200_000)).toBeNull();
    expect(validateDebtPayment(10, 0)).toMatch(/limeshalipwa/);
  });
});

describe('dates and aging', () => {
  it('computes day differences', () => {
    expect(addDays('2026-10-29', 14)).toBe('2026-11-12');
    expect(daysBetween('2026-10-29', '2026-11-12')).toBe(14);
    expect(daysBetween('2026-10-29', '2026-10-17')).toBe(-12);
  });
  it('tags due dates', () => {
    expect(dueTag('2026-10-17', '2026-10-29')).toMatchObject({ kind: 'overdue', days: 12, label: 'Imepita siku 12' });
    expect(dueTag('2026-10-29', '2026-10-29').label).toBe('Leo');
    expect(dueTag('2026-11-03', '2026-10-29')).toMatchObject({ kind: 'soon', label: 'Baada ya siku 5' });
    expect(dueTag('2026-11-15', '2026-10-29').kind).toBe('later');
  });
  it('buckets by age', () => {
    expect([0, 7, 8, 30, 31].map(ageBucket)).toEqual([0, 0, 1, 1, 2]);
  });
});

describe('sms', () => {
  it('stays within 2 segments (<= 306 chars)', () => {
    expect(debtPaymentSms('Juma Hassan', 200_000, 0).length).toBeLessThan(306);
    expect(debtPaymentSms('Juma Hassan', 200_000, 100_000)).toContain('TSh 100,000. Asante.');
    expect(debtPaymentSms('Juma Hassan', 200_000, 0)).toContain('limekwisha. Asante.');
  });
});
