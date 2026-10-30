import { isShopPaymentMethod, type PaymentMethod, type ProductType } from './constants';
import { luhnValid } from './sales';

/** Split pasted/scanned text into IMEIs (spaces, commas, new lines). */
export function parseImeis(text: string): string[] {
  return text
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/* ---------- Receiving goods from a supplier ---------- */
export interface PurchaseLineInput {
  productId: number;
  name: string;
  type: ProductType;
  qty: number;
  unitCost: number;
  imeis: string[];
}

export interface PurchaseInput {
  supplierId: number | null;
  invoiceNo: string;
  date: string; // yyyy-mm-dd
  location: 'STORE' | 'SHOP';
  lines: PurchaseLineInput[];
  paidNow: number;
  method: PaymentMethod;
}

export type PurchaseResult = { ok: true; total: number; owed: number } | { ok: false; errors: string[] };

export function validatePurchase(
  input: PurchaseInput,
  ctx: { knownImeis: ReadonlySet<string>; today: string },
): PurchaseResult {
  const errors: string[] = [];
  if (!input.date) errors.push('Weka tarehe');
  else if (input.date > ctx.today) errors.push('Tarehe haiwezi kuwa ya kesho');
  if (input.lines.length === 0) errors.push('Ongeza angalau bidhaa moja');

  const seen = new Set<string>();
  let total = 0;
  for (const l of input.lines) {
    if (!Number.isInteger(l.qty) || l.qty < 1) errors.push(`${l.name}: idadi si sahihi`);
    if (!Number.isInteger(l.unitCost) || l.unitCost < 0) errors.push(`${l.name}: bei ya kununua si sahihi`);
    total += (Number.isInteger(l.qty) ? l.qty : 0) * (Number.isInteger(l.unitCost) ? l.unitCost : 0);
    if (l.type !== 'phone') continue;

    // IMEI ni hiari: 0 hadi idadi ya simu.
    if (l.imeis.length > l.qty) errors.push(`${l.name}: IMEI ${l.imeis.length} ni nyingi kuliko idadi ${l.qty}`);
    for (const imei of l.imeis) {
      if (!luhnValid(imei)) errors.push(`IMEI ${imei} si sahihi`);
      else if (seen.has(imei)) errors.push(`IMEI ${imei} imerudiwa`);
      else if (ctx.knownImeis.has(imei)) errors.push(`IMEI ${imei} tayari ipo kwenye mfumo`);
      seen.add(imei);
    }
  }
  if (!Number.isInteger(input.paidNow) || input.paidNow < 0) errors.push('Kiasi kilicholipwa si sahihi');
  if (input.paidNow > 0 && !isShopPaymentMethod(input.method)) errors.push('Njia ya malipo si sahihi. Tumia Cash, Lipa Namba au Bank');
  else if (input.paidNow > total) errors.push('Kiasi kilicholipwa kinazidi jumla ya mzigo');

  if (errors.length) return { ok: false, errors: [...new Set(errors)] };
  return { ok: true, total, owed: total - input.paidNow };
}

/* ---------- Moving stock from Store to Shop ---------- */
export interface TransferLineInput {
  productId: number;
  name: string;
  type: ProductType;
  qty: number;
  imeis: string[]; // exact units for phones
}

export type TransferResult = { ok: true } | { ok: false; errors: string[] };

export function validateTransfer(
  lines: TransferLineInput[],
  ctx: { storeStock: Record<number, number>; storeImeis: ReadonlySet<string> },
): TransferResult {
  const errors: string[] = [];
  if (lines.length === 0) errors.push('Ongeza angalau bidhaa moja');

  const seen = new Set<string>();
  const wanted = new Map<number, number>();
  for (const l of lines) {
    if (!Number.isInteger(l.qty) || l.qty < 1) errors.push(`${l.name}: idadi si sahihi`);
    wanted.set(l.productId, (wanted.get(l.productId) ?? 0) + (Number.isInteger(l.qty) ? l.qty : 0));
    if (l.type !== 'phone') continue;
    if (l.imeis.length > l.qty) errors.push(`${l.name}: IMEI ${l.imeis.length} ni nyingi kuliko idadi ${l.qty}`);
    for (const imei of l.imeis) {
      if (!ctx.storeImeis.has(imei)) errors.push(`IMEI ${imei} haipo store`);
      if (seen.has(imei)) errors.push(`IMEI ${imei} imechaguliwa mara mbili`);
      seen.add(imei);
    }
  }
  for (const [productId, qty] of wanted) {
    const have = ctx.storeStock[productId] ?? 0;
    if (qty > have) {
      const name = lines.find((l) => l.productId === productId)?.name ?? 'Bidhaa';
      errors.push(`${name}: zilizopo store ni ${have}, umeweka ${qty}`);
    }
  }
  return errors.length ? { ok: false, errors: [...new Set(errors)] } : { ok: true };
}

/* ---------- Adding new stock directly to Shop ---------- */
export interface DirectStockLineInput {
  productId: number;
  name: string;
  type: ProductType;
  qty: number;
  unitCost: number;
  imeis: string[];
}

export type DirectStockResult =
  | { ok: true; total: number }
  | { ok: false; errors: string[]; byProduct: Record<number, string[]> };

export function validateDirectStockIn(
  lines: DirectStockLineInput[],
  ctx: { knownImeis: ReadonlySet<string> },
): DirectStockResult {
  const errors: string[] = [];
  const byProduct: Record<number, string[]> = {};
  const addErr = (productId: number | null, msg: string) => {
    errors.push(msg);
    if (productId !== null) (byProduct[productId] ??= []).push(msg);
  };

  if (lines.length === 0) addErr(null, 'Ongeza angalau bidhaa moja');

  const seenProducts = new Set<number>();
  const seenImeis = new Set<string>();
  let total = 0;

  for (const l of lines) {
    if (seenProducts.has(l.productId)) {
      addErr(l.productId, `${l.name}: bidhaa imechaguliwa mara mbili`);
    }
    seenProducts.add(l.productId);

    if (!Number.isInteger(l.qty) || l.qty < 1) {
      addErr(l.productId, `${l.name}: idadi si sahihi`);
    }
    if (!Number.isInteger(l.unitCost) || l.unitCost < 0) {
      addErr(l.productId, `${l.name}: bei ya kununua si sahihi`);
    }
    total +=
      (Number.isInteger(l.qty) && l.qty > 0 ? l.qty : 0) *
      (Number.isInteger(l.unitCost) && l.unitCost >= 0 ? l.unitCost : 0);

    if (l.type !== 'phone') continue;

    if (l.imeis.length > l.qty) {
      addErr(l.productId, `${l.name}: IMEI ${l.imeis.length} ni nyingi kuliko idadi ${l.qty}`);
    }
    for (const imei of l.imeis) {
      if (!luhnValid(imei)) addErr(l.productId, `IMEI ${imei} si sahihi`);
      else if (seenImeis.has(imei)) addErr(l.productId, `IMEI ${imei} imerudiwa`);
      else if (ctx.knownImeis.has(imei)) addErr(l.productId, `IMEI ${imei} tayari ipo kwenye mfumo`);
      seenImeis.add(imei);
    }
  }

  if (errors.length) return { ok: false, errors: [...new Set(errors)], byProduct };
  return { ok: true, total };
}

/* ---------- Duplicate product prevention when creating a new product ---------- */
export interface ExistingProductRef {
  id: number;
  name: string;
  detail: string;
  type: ProductType;
  code: string;
  barcode?: string;
}

export interface NewProductDuplicateCheckInput {
  name: string;
  detail?: string;
  type: ProductType;
  code?: string;
  barcode?: string;
  imeis?: string[];
}

/**
 * Validates that a newly created product does not duplicate an existing product by SKU (`code`),
 * `barcode`, registered `IMEI`, or identical `(name, detail, type)` when no distinguishing identifier is given.
 * Does not rely on `name` alone when `detail`, `code`, or `barcode` distinguishes the product.
 */
export function validateNewProductDuplicates(
  input: NewProductDuplicateCheckInput,
  ctx: { existingProducts: ExistingProductRef[]; knownImeis: ReadonlySet<string> },
): string | null {
  const norm = (s?: string) => (s ?? '').trim().toLowerCase();
  const codeNorm = norm(input.code);
  const barcodeNorm = norm(input.barcode);
  const nameNorm = norm(input.name);
  const detailNorm = norm(input.detail);

  if (codeNorm) {
    const byCode = ctx.existingProducts.find((p) => norm(p.code) === codeNorm);
    if (byCode) {
      return `Bidhaa yenye SKU "${input.code!.trim()}" tayari ipo (${byCode.name}). Tumia "Kutoka Store" kuhamisha stock ya bidhaa iliyopo.`;
    }
  }

  if (barcodeNorm) {
    const byBarcode = ctx.existingProducts.find((p) => p.barcode && norm(p.barcode) === barcodeNorm);
    if (byBarcode) {
      return `Bidhaa yenye barcode "${input.barcode!.trim()}" tayari ipo (${byBarcode.name}). Tumia "Kutoka Store" kuhamisha stock ya bidhaa iliyopo.`;
    }
  }

  for (const imei of input.imeis ?? []) {
    if (ctx.knownImeis.has(imei)) {
      return `IMEI ${imei} tayari ipo kwenye mfumo`;
    }
  }

  // If no distinguishing SKU or barcode is provided, prevent creating an identical (name + detail + type) product
  const sameIdentity = ctx.existingProducts.find(
    (p) =>
      norm(p.name) === nameNorm &&
      norm(p.detail) === detailNorm &&
      p.type === input.type &&
      (!codeNorm || norm(p.code) === codeNorm) &&
      (!barcodeNorm || norm(p.barcode) === barcodeNorm),
  );
  if (sameIdentity) {
    const label = sameIdentity.detail ? `${sameIdentity.name} (${sameIdentity.detail})` : sameIdentity.name;
    return `Bidhaa "${label}" tayari ipo kwenye mfumo. Tumia "Kutoka Store" kuhamisha stock ya bidhaa iliyopo.`;
  }

  return null;
}

/* ---------- Supplier debt ---------- */
export const supplierDebt = (purchaseTotals: number[], payments: number[]) =>
  purchaseTotals.reduce((a, b) => a + b, 0) - payments.reduce((a, b) => a + b, 0);

export function validateSupplierPayment(amount: number, owed: number): string | null {
  if (!Number.isInteger(amount) || amount <= 0) return 'Weka kiasi kikubwa kuliko sifuri';
  if (owed <= 0) return 'Hakuna deni kwa supplier huyu';
  if (amount > owed) return 'Kiasi kinazidi deni';
  return null;
}

/**
 * Pay purchases oldest first: returns what each purchase still owes.
 * Payments tied to a purchase reduce it directly; the rest are spread over the oldest debts.
 */
export function allocateSupplierPayments(
  purchases: { id: number; total: number }[], // oldest first
  payments: { purchaseId: number | null; amount: number }[],
): Map<number, number> {
  const owed = new Map(purchases.map((p) => [p.id, p.total]));
  let loose = 0;
  for (const p of payments) {
    if (p.purchaseId != null && owed.has(p.purchaseId)) owed.set(p.purchaseId, (owed.get(p.purchaseId) ?? 0) - p.amount);
    else loose += p.amount;
  }
  for (const p of purchases) {
    const left = owed.get(p.id) ?? 0;
    const take = Math.min(Math.max(left, 0), loose);
    owed.set(p.id, left - take);
    loose -= take;
  }
  return owed;
}
