import type { Role } from './constants';

/**
 * Void and return rules.
 * A sale's balance is (total - returnedValue) - SUM(payments); refunds are negative payments,
 * so SUM(payments) is already net of refunds. Nothing here stores a balance.
 */
export interface SaleSnapshot {
  status: 'PAID' | 'PARTIAL' | 'VOID';
  subtotal: number;
  total: number;
  paidNet: number; // SUM(payments.amount), refunds included as negatives
  returnedValue: number;
  lines: { qty: number; unitPrice: number; imei?: string; returnedQty: number }[];
}

export interface ReturnItem {
  lineIndex: number;
  qty: number;
}

export type ReturnPlan =
  | {
      ok: true;
      value: number; // goes off the sale total
      refund: number; // cash to give back (negative payment); 0 when it only reduces the debt
      newBalance: number;
      restock: ReturnItem[];
    }
  | { ok: false; errors: string[] };

export const effectiveTotal = (s: Pick<SaleSnapshot, 'total' | 'returnedValue'>) => s.total - s.returnedValue;

const remaining = (l: SaleSnapshot['lines'][number]) => l.qty - l.returnedQty;

export function planReturn(sale: SaleSnapshot, items: ReturnItem[], reason: string): ReturnPlan {
  const errors: string[] = [];
  if (sale.status === 'VOID') errors.push('Mauzo haya yamefutwa tayari');
  if (reason.trim().length < 3) errors.push('Andika sababu ya kurudisha');

  const picked = items.filter((i) => i.qty > 0);
  if (picked.length === 0) errors.push('Chagua bidhaa ya kurudisha');
  const seen = new Set<number>();
  let rawValue = 0;
  for (const it of picked) {
    const line = sale.lines[it.lineIndex];
    if (!line) {
      errors.push('Bidhaa haipo kwenye mauzo haya');
      continue;
    }
    if (seen.has(it.lineIndex)) errors.push('Bidhaa imechaguliwa mara mbili');
    seen.add(it.lineIndex);
    if (!Number.isInteger(it.qty) || it.qty < 1) errors.push('Idadi si sahihi');
    else if (it.qty > remaining(line)) errors.push(`Unaweza kurudisha ${remaining(line)} tu`);
    rawValue += Math.floor(((line.unitPrice * it.qty) * sale.total) / Math.max(1, sale.subtotal));
  }
  if (errors.length) return { ok: false, errors };

  const before = effectiveTotal(sale);
  const returnsEverything = sale.lines.every((l, i) => {
    const take = picked.find((p) => p.lineIndex === i)?.qty ?? 0;
    return remaining(l) - take === 0;
  });
  // The last return takes whatever is left, so rounding never leaves a few shillings behind.
  const value = returnsEverything ? before : Math.min(rawValue, before);
  const after = before - value;
  const refund = Math.max(0, sale.paidNet - after);
  return { ok: true, value, refund, newBalance: Math.max(0, after - (sale.paidNet - refund)), restock: picked };
}

export type VoidPlan =
  | { ok: true; refund: number; restock: ReturnItem[] }
  | { ok: false; errors: string[] };

export function planVoid(sale: SaleSnapshot, role: Role, reason: string): VoidPlan {
  const errors: string[] = [];
  if (role !== 'owner') errors.push('Mmiliki tu ndiye anaweza kufuta mauzo');
  if (sale.status === 'VOID') errors.push('Mauzo haya yamefutwa tayari');
  if (reason.trim().length < 3) errors.push('Andika sababu ya kufuta mauzo');
  if (errors.length) return { ok: false, errors };

  const restock = sale.lines
    .map((l, lineIndex) => ({ lineIndex, qty: remaining(l) }))
    .filter((r) => r.qty > 0);
  return { ok: true, refund: Math.max(0, sale.paidNet), restock };
}
