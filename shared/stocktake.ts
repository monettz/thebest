import type { ProductType } from './constants';

export const COUNT_REASONS = ['DAMAGED', 'LOST', 'ENTRY_ERROR', 'OTHER'] as const;
export type CountReason = (typeof COUNT_REASONS)[number];
export const COUNT_REASON_LABEL: Record<CountReason, string> = {
  DAMAGED: 'Imeharibika',
  LOST: 'Imepotea',
  ENTRY_ERROR: 'Kosa la kuingiza',
  OTHER: 'Nyingine',
};

export interface CountLine {
  productId: number;
  name: string;
  type: ProductType;
  systemQty: number;
  countedQty: number;
  reason?: CountReason;
  /** Phones only: the IMEIs the counter could not find (as many as the shortage). */
  missingImeis?: string[];
  /** Phones only: every IMEI the system believes is at this location. */
  systemImeis?: string[];
}

export const difference = (l: Pick<CountLine, 'systemQty' | 'countedQty'>) => l.countedQty - l.systemQty;

/** Rules for submitting a count to the owner. Returns Swahili messages, empty when valid. */
export function validateCount(lines: CountLine[]): string[] {
  const errors: string[] = [];
  if (lines.length === 0) errors.push('Hakuna bidhaa zilizohesabiwa');
  for (const l of lines) {
    if (!Number.isInteger(l.countedQty) || l.countedQty < 0) {
      errors.push(`${l.name}: idadi uliyohesabu si sahihi`);
      continue;
    }
    const diff = difference(l);
    if (diff !== 0 && !l.reason) errors.push(`${l.name}: chagua sababu ya tofauti`);
    if (l.type === 'phone') {
      if (diff > 0) {
        errors.push(`${l.name}: simu haziwezi kuzidi zilizopo kwenye mfumo; zipokee kupitia "Pokea mzigo"`);
        continue;
      }
      const missing = l.missingImeis ?? [];
      // IMEI ni hiari: chagua zile unazozijua, zilizobaki hazina IMEI.
      if (missing.length > -diff) errors.push(`${l.name}: IMEI ${missing.length} ni nyingi kuliko upungufu ${-diff}`);
      if (new Set(missing).size !== missing.length) errors.push(`${l.name}: IMEI imechaguliwa mara mbili`);
      const known = new Set(l.systemImeis ?? []);
      if (missing.some((i) => !known.has(i))) errors.push(`${l.name}: IMEI haipo kwenye stock ya eneo hili`);
    }
  }
  return [...new Set(errors)];
}

export interface Adjustment {
  productId: number;
  name: string;
  delta: number; // + surplus, - shortage
  reason: CountReason;
  missingImeis: string[];
}

export type ApprovalPlan = { ok: true; adjustments: Adjustment[] } | { ok: false; errors: string[] };

/**
 * Approval applies the counted difference (not the counted total), so sales that happened
 * between counting and approving are kept. Stock can still never go below zero.
 */
export function planApproval(lines: CountLine[], currentQty: Record<number, number>): ApprovalPlan {
  const errors: string[] = [];
  const adjustments: Adjustment[] = [];
  for (const l of lines) {
    const delta = difference(l);
    if (delta === 0) continue;
    if ((currentQty[l.productId] ?? 0) + delta < 0) {
      errors.push(`${l.name}: stock ya sasa (${currentQty[l.productId] ?? 0}) haitoshi kupunguza ${-delta}`);
      continue;
    }
    adjustments.push({ productId: l.productId, name: l.name, delta, reason: l.reason ?? 'OTHER', missingImeis: l.missingImeis ?? [] });
  }
  return errors.length ? { ok: false, errors } : { ok: true, adjustments };
}

/** Value of what is missing, at cost price (owner only). */
export function shortageValue(lines: CountLine[], costs: Record<number, number>): number {
  return lines.reduce((a, l) => a + Math.max(0, -difference(l)) * (costs[l.productId] ?? 0), 0);
}
