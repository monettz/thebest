import { isShopPaymentMethod, type PaymentMethod, type ProductType } from './constants';
import { normalizePhone } from './schemas';

export interface CartLine {
  productId: number;
  name: string;
  type: ProductType;
  unitPrice: number;
  qty: number; // phones: always 1, one line per IMEI
  imei?: string;
}

export interface PaymentInput {
  method: PaymentMethod;
  amount: number;
  reference?: string;
}

export interface CustomerInput {
  id?: number;
  name: string;
  phone?: string;
}

export interface CheckoutInput {
  lines: CartLine[];
  discount: number;
  payments: PaymentInput[];
  customer?: CustomerInput | null;
  dueDate?: string | null; // yyyy-mm-dd
}

export interface CheckoutContext {
  shopStock: Record<number, number>;
  availableImeis: ReadonlySet<string>;
  maxDiscountPct: number;
  isOwner: boolean;
  ownerPinOk: boolean;
  today: string; // yyyy-mm-dd in Africa/Dar_es_Salaam
}

export type SaleStatus = 'PAID' | 'PARTIAL' | 'VOID';

export type CheckoutResult =
  | { ok: true; subtotal: number; total: number; paid: number; balance: number; status: Exclude<SaleStatus, 'VOID'> }
  | { ok: false; errors: string[] };

export function luhnValid(digits: string): boolean {
  if (!/^\d{15}$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < 15; i++) {
    let d = Number(digits[14 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

/** Build a Luhn-valid 15-digit IMEI from a 14-digit body (used by seed data). */
export function imeiFromBody(body14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    let d = Number(body14[13 - i]);
    if (i % 2 === 0) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return body14 + String((10 - (sum % 10)) % 10);
}

export const lineTotal = (l: CartLine) => l.unitPrice * l.qty;
export const subtotalOf = (lines: CartLine[]) => lines.reduce((s, l) => s + lineTotal(l), 0);
export const paidOf = (payments: PaymentInput[]) => payments.reduce((s, p) => s + p.amount, 0);

/**
 * Pick the next available IMEI for a phone product that is not already assigned in the cart.
 * Returns null if no unassigned IMEI is available.
 */
export function pickAvailableImei(productImeis: readonly string[], lines: readonly CartLine[]): string | null {
  const taken = new Set<string>();
  for (const l of lines) {
    if (l.imei) taken.add(l.imei);
  }
  for (const imei of productImeis) {
    if (!taken.has(imei)) return imei;
  }
  return null;
}

/**
 * Return all available IMEIs for a specific cart line (includes the line's current IMEI plus any unassigned IMEIs of that product).
 */
export function availableImeisForLine(
  productImeis: readonly string[],
  lines: readonly CartLine[],
  lineIndex: number,
): string[] {
  const takenElsewhere = new Set<string>();
  lines.forEach((l, idx) => {
    if (idx !== lineIndex && l.imei) takenElsewhere.add(l.imei);
  });
  return productImeis.filter((imei) => !takenElsewhere.has(imei));
}

/**
 * Change the assigned IMEI on a phone cart line, ensuring the new IMEI is available in shop stock and not assigned to another cart item.
 */
export function changeLineImei(
  lines: readonly CartLine[],
  lineIndex: number,
  newImei: string,
  availablePool: ReadonlySet<string>,
): { ok: true; lines: CartLine[] } | { ok: false; error: string } {
  const target = lines[lineIndex];
  if (!target || target.type !== 'phone') {
    return { ok: false, error: 'Bidhaa haipo kwenye mauzo haya' };
  }
  const trimmed = newImei.trim();
  if (!availablePool.has(trimmed)) {
    return { ok: false, error: 'IMEI hii haipatikani dukani' };
  }
  if (lines.some((l, idx) => idx !== lineIndex && l.imei === trimmed)) {
    return { ok: false, error: 'IMEI hii tayari iko kwenye kikapu' };
  }
  return {
    ok: true,
    lines: lines.map((l, idx) => (idx === lineIndex ? { ...l, imei: trimmed } : l)),
  };
}

export function validateCheckout(input: CheckoutInput, ctx: CheckoutContext): CheckoutResult {
  const errors: string[] = [];
  const { lines, discount, payments, customer, dueDate } = input;

  if (lines.length === 0) errors.push('Kikapu ni tupu');

  const seen = new Set<string>();
  // Kila bidhaa (simu au accessory) inakaguliwa kwa idadi iliyopo dukani; IMEI kwa simu ni hiari.
  const accessoryQty = new Map<number, number>();
  for (const l of lines) {
    if (!Number.isInteger(l.qty) || l.qty < 1) errors.push(`Idadi ya ${l.name} si sahihi`);
    if (l.type === 'phone' && l.imei) {
      if (seen.has(l.imei)) errors.push(`IMEI ${l.imei} imeongezwa mara mbili`);
      else if (!ctx.availableImeis.has(l.imei)) errors.push(`IMEI ${l.imei} haipatikani dukani`);
      seen.add(l.imei);
      if (l.qty !== 1) errors.push(`${l.name}: simu yenye IMEI ni moja kwa kila mstari`);
    }
    accessoryQty.set(l.productId, (accessoryQty.get(l.productId) ?? 0) + l.qty);
  }
  for (const [productId, qty] of accessoryQty) {
    const have = ctx.shopStock[productId] ?? 0;
    if (qty > have) {
      const name = lines.find((l) => l.productId === productId)?.name ?? 'Bidhaa';
      errors.push(`${name}: zilizopo dukani ni ${have}, umeweka ${qty}`);
    }
  }

  const subtotal = subtotalOf(lines);
  if (!Number.isInteger(discount) || discount < 0) errors.push('Punguzo si sahihi');
  else if (discount > subtotal) errors.push('Punguzo haliwezi kuzidi jumla ndogo');
  else if (subtotal > 0 && (discount / subtotal) * 100 > ctx.maxDiscountPct && !ctx.isOwner && !ctx.ownerPinOk) {
    errors.push(`Punguzo linazidi ${ctx.maxDiscountPct}%. Inahitaji PIN ya mmiliki.`);
  }
  const total = Math.max(0, subtotal - (Number.isInteger(discount) ? discount : 0));

  for (const p of payments) {
    if (!Number.isInteger(p.amount) || p.amount <= 0) errors.push('Kila malipo lazima yawe zaidi ya sifuri');
    if (!isShopPaymentMethod(p.method) && !errors.includes('Njia ya malipo si sahihi. Tumia Cash, Lipa Namba au Bank')) errors.push('Njia ya malipo si sahihi. Tumia Cash, Lipa Namba au Bank');
  }
  const paid = paidOf(payments);
  if (paid > total) errors.push('Malipo yamezidi jumla ya mauzo');

  const balance = total - paid;
  if (balance > 0) {
    const nameOk = (customer?.name ?? '').trim().length >= 2;
    const phoneOk = !!customer && normalizePhone(customer.phone ?? '') !== null;
    if (!nameOk || !phoneOk) errors.push('Deni linahitaji jina na simu ya mteja');
    if (!dueDate) errors.push('Deni linahitaji tarehe ya kulipa');
    else if (dueDate < ctx.today) errors.push('Tarehe ya kulipa imepita');
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true, subtotal, total, paid, balance, status: balance === 0 ? 'PAID' : 'PARTIAL' };
}
