/**
 * Mock inventory backend: phone units (IMEI) for Store and Shop, suppliers, purchases,
 * supplier payments and transfers. Stock levels change only through moveStock() in api.ts.
 */
import { isShopPaymentMethod, type PaymentMethod, type Role } from '@shared/constants';
import { imeiFromBody } from '@shared/sales';
import {
  allocateSupplierPayments,
  validateDirectStockIn,
  validatePurchase,
  validateSupplierPayment,
  validateTransfer,
  type DirectStockLineInput,
  type PurchaseInput,
  type TransferLineInput,
} from '@shared/stock';
import { todayDar } from '@/lib/dar';
import { internalProducts, moveStock } from './api';
import { SEED_PRODUCTS } from './seed';
import { supabase } from '@/lib/supabase';
import { check, ensureFresh, isRemote, rpc, write } from './sync';

const delay = <T,>(v: T, ms = 150) => (isRemote() ? Promise.resolve(v) : new Promise<T>((r) => setTimeout(() => r(v), ms)));

// No browser storage: state lives in memory and, with Supabase, is reloaded from the database (see ./hydrate).
function load<T>(_key: string, fallback: () => T): T {
  return fallback();
}
function save(_key: string, _value: unknown) {
  /* nothing to persist: the database is the source of truth */
}

const todayIso = () => todayDar();
const dateDaysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return todayDar(d);
};
const isoDaysAgo = (n: number, hour = 10) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(hour, 24, 0, 0);
  return d.toISOString();
};

/* ---------- Units: one row per phone ---------- */
export type UnitStatus = 'IN_STORE' | 'IN_SHOP' | 'SOLD' | 'DAMAGED';
interface Unit {
  imei: string;
  productId: number;
  status: UnitStatus;
}

function seedUnits(): Unit[] {
  const out: Unit[] = [];
  const list = load('tb.products', () => SEED_PRODUCTS);
  for (const p of list.filter((p) => p.type === 'phone')) {
    const pid = String(p.id).padStart(2, '0');
    for (let i = 1; i <= p.shopQty; i++) {
      out.push({ imei: imeiFromBody(`3591${pid}${String(i * 7919).padStart(8, '0').slice(-8)}`), productId: p.id, status: 'IN_SHOP' });
    }
    for (let i = 1; i <= p.storeQty; i++) {
      out.push({ imei: imeiFromBody(`3592${pid}${String(i * 6007).padStart(8, '0').slice(-8)}`), productId: p.id, status: 'IN_STORE' });
    }
  }
  return out;
}
let units = load<Unit[]>('tb3.units', () => {
  return typeof process !== 'undefined' && (process.env?.NODE_ENV === 'test' || !!process.env?.VITEST)
    ? seedUnits()
    : [];
});
const saveUnits = () => save('tb3.units', units);

export function hydrateInventory(next: {
  units: Unit[];
  suppliers: Supplier[];
  purchases: Purchase[];
  payments: SupplierPayment[];
  transfers: Transfer[];
}): void {
  units = next.units;
  suppliers = next.suppliers;
  purchases = next.purchases;
  payments = next.payments;
  transfers = next.transfers;
}

export const imeisIn = (status: UnitStatus, productId?: number) =>
  units.filter((u) => u.status === status && (productId === undefined || u.productId === productId)).map((u) => u.imei);
export const allImeis = () => new Set(units.map((u) => u.imei));

export function getUnitsSnapshot(): Unit[] {
  return units.map((u) => ({ ...u }));
}

export function restoreUnitsSnapshot(snapshot: Unit[]): void {
  units = snapshot.map((u) => ({ ...u }));
  saveUnits();
}

export function registerShopUnits(productId: number, imeis: string[], location: 'SHOP' | 'STORE' = 'SHOP'): void {
  const known = allImeis();
  for (const imei of imeis) {
    if (known.has(imei)) throw new Error(`IMEI ${imei} tayari ipo kwenye mfumo`);
    known.add(imei);
  }
  units = [...units, ...imeis.map((imei) => ({ imei, productId, status: (location === 'STORE' ? 'IN_STORE' : 'IN_SHOP') as UnitStatus }))];
  saveUnits();
}

export function setUnitStatus(imeis: string[], status: UnitStatus) {
  const set = new Set(imeis);
  units = units.map((u) => (set.has(u.imei) ? { ...u, status } : u));
  saveUnits();
}

/** IMEIs available to move, per product (Store). */
export async function listStoreImeis(): Promise<Record<number, string[]>> {
  await ensureFresh();
  const out: Record<number, string[]> = {};
  for (const u of units) if (u.status === 'IN_STORE') (out[u.productId] ??= []).push(u.imei);
  return delay(out, 0);
}

/* ---------- Suppliers, purchases, payments ---------- */
export interface Supplier {
  id: number;
  name: string;
  phone: string;
  notes?: string;
}
interface PurchaseLine {
  productId: number;
  name: string;
  qty: number;
  unitCost: number;
}
interface Purchase {
  id: number;
  supplierId: number | null; // optional: stock can be received without naming a supplier
  location: 'STORE' | 'SHOP';
  invoiceNo: string;
  date: string;
  total: number;
  userName: string;
  lines: PurchaseLine[];
}
interface SupplierPayment {
  id: number;
  supplierId: number;
  purchaseId: number | null;
  amount: number;
  method: PaymentMethod;
  paidAt: string;
  userName: string;
}
interface Transfer {
  id: number;
  at: string;
  userName: string;
  note: string;
  items: { productId: number; name: string; qty: number; imeis: string[] }[];
}

const seedSuppliers = (): Supplier[] => [
  { id: 1, name: 'Supplier A', phone: '' },
  { id: 2, name: 'Supplier B', phone: '' },
  { id: 3, name: 'Supplier C', phone: '' },
  { id: 4, name: 'Supplier D', phone: '' },
];
let suppliers = load<Supplier[]>('tb3.suppliers', () => {
  return typeof process !== 'undefined' && (process.env?.NODE_ENV === 'test' || !!process.env?.VITEST)
    ? seedSuppliers()
    : [];
});

/** Historical receipts (their stock is already part of the sample stock levels). */
const seedPurchases = (): Purchase[] => {
  const mk = (id: number, supplierId: number, invoiceNo: string, ago: number, lines: [number, string, number, number][]): Purchase => ({
    id,
    supplierId,
    location: 'STORE',
    invoiceNo,
    date: dateDaysAgo(ago),
    total: lines.reduce((a, [, , q, c]) => a + q * c, 0),
    userName: 'Mmiliki Mkuu',
    lines: lines.map(([productId, name, qty, unitCost]) => ({ productId, name, qty, unitCost })),
  });
  return [
    mk(1, 3, 'INV-5520', 14, [[3, 'iPhone 11', 4, 950000], [4, 'Redmi 13', 10, 360000], [8, 'Earbuds', 80, 25000]]),
    mk(2, 1, 'INV-0229', 5, [[2, 'Tecno Spark 20', 6, 410000]]),
    mk(3, 2, 'INV-1187', 3, [[6, 'Charger 25W', 30, 18000], [7, 'Phone cover', 100, 5000]]),
    mk(4, 1, 'INV-0231', 1, [[1, 'Samsung A15', 10, 780000], [5, 'Screen protector A15', 200, 3000]]),
  ];
};
let purchases = load<Purchase[]>('tb3.purchases', () => {
  return typeof process !== 'undefined' && (process.env?.NODE_ENV === 'test' || !!process.env?.VITEST)
    ? seedPurchases()
    : [];
});

const seedPayments = (): SupplierPayment[] => [
  { id: 1, supplierId: 3, purchaseId: 1, amount: 9_400_000, method: 'BANK', paidAt: isoDaysAgo(14), userName: 'Mmiliki Mkuu' },
  { id: 2, supplierId: 1, purchaseId: 2, amount: 2_460_000, method: 'BANK', paidAt: isoDaysAgo(5), userName: 'Mmiliki Mkuu' },
  { id: 3, supplierId: 2, purchaseId: 3, amount: 300_000, method: 'CASH', paidAt: isoDaysAgo(3), userName: 'Mmiliki Mkuu' },
  { id: 4, supplierId: 1, purchaseId: 4, amount: 6_000_000, method: 'BANK', paidAt: isoDaysAgo(1), userName: 'Mmiliki Mkuu' },
];
let payments = load<SupplierPayment[]>('tb3.supplierPayments', () => {
  return typeof process !== 'undefined' && (process.env?.NODE_ENV === 'test' || !!process.env?.VITEST)
    ? seedPayments()
    : [];
});

const seedTransfers = (): Transfer[] => [
  { id: 1, at: isoDaysAgo(1, 16), userName: 'Muuzaji Mmoja', note: '', items: [{ productId: 7, name: 'Phone cover', qty: 15, imeis: [] }] },
  { id: 2, at: isoDaysAgo(0, 9), userName: 'Muuzaji Mmoja', note: '', items: [{ productId: 1, name: 'Samsung A15', qty: 2, imeis: [] }] },
  { id: 3, at: isoDaysAgo(0, 10), userName: 'Muuzaji Mmoja', note: '', items: [{ productId: 5, name: 'Screen protector A15', qty: 20, imeis: [] }] },
];
let transfers = load<Transfer[]>('tb3.transfers', () => {
  return typeof process !== 'undefined' && (process.env?.NODE_ENV === 'test' || !!process.env?.VITEST)
    ? seedTransfers()
    : [];
});

const supplierName = (id: number | null) => (id == null ? 'Bila supplier' : (suppliers.find((s) => s.id === id)?.name ?? '?'));

/** What each purchase still owes (payments linked to a purchase first, the rest oldest-first). */
function owedByPurchase(supplierId: number): Map<number, number> {
  const mine = purchases.filter((p) => p.supplierId === supplierId).sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  return allocateSupplierPayments(
    mine.map((p) => ({ id: p.id, total: p.total })),
    payments.filter((p) => p.supplierId === supplierId),
  );
}
const owedBySupplier = (supplierId: number) => [...owedByPurchase(supplierId).values()].reduce((a, b) => a + b, 0);

const ownerOnly = (role: Role) => {
  if (role !== 'owner') throw new Error('Huna ruhusa ya kuona madeni ya suppliers');
};

export async function listSuppliers() {
  await ensureFresh();
  return delay(suppliers.map((s) => ({ id: s.id, name: s.name })), 0);
}

export interface SuppliersOverview {
  supplierCount: number;
  monthTotal: number;
  owedTotal: number;
  cards: { supplier: Supplier; deliveries: number; total: number; owed: number }[];
  recent: { id: number; date: string; supplier: string; invoiceNo: string; total: number; owed: number }[];
}

export async function getSuppliersOverview(role: Role): Promise<SuppliersOverview> {
  ownerOnly(role);
  await ensureFresh();
  const month = todayIso().slice(0, 7);
  const owedMaps = new Map(suppliers.map((s) => [s.id, owedByPurchase(s.id)]));
  return delay({
    supplierCount: suppliers.length,
    monthTotal: purchases.filter((p) => p.date.startsWith(month)).reduce((a, p) => a + p.total, 0),
    owedTotal: suppliers.reduce((a, s) => a + owedBySupplier(s.id), 0),
    cards: suppliers.map((supplier) => {
      const mine = purchases.filter((p) => p.supplierId === supplier.id);
      return { supplier, deliveries: mine.length, total: mine.reduce((a, p) => a + p.total, 0), owed: owedBySupplier(supplier.id) };
    }),
    recent: [...purchases]
      .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id)
      .slice(0, 8)
      .map((p) => ({
        id: p.id,
        date: p.date,
        supplier: supplierName(p.supplierId),
        invoiceNo: p.invoiceNo,
        total: p.total,
        owed: (p.supplierId == null ? 0 : (owedMaps.get(p.supplierId)?.get(p.id) ?? 0)),
      })),
  });
}

export async function saveSupplier(role: Role, input: { name: string; phone: string; notes?: string }): Promise<Supplier> {
  ownerOnly(role);
  const name = input.name.trim();
  if (name.length < 2) throw new Error('Weka jina la supplier');
  await ensureFresh();
  if (suppliers.some((s) => s.name.toLowerCase() === name.toLowerCase())) throw new Error('Supplier huyu tayari yupo');
  if (isRemote()) {
    return write(async () => {
      const res = check(
        await supabase.from('suppliers').insert({ name, phone: input.phone.trim(), notes: input.notes?.trim() || null }).select('id, name, phone, notes').single(),
      );
      const row = res.data as { id: number; name: string; phone: string | null; notes: string | null };
      return { id: row.id, name: row.name, phone: row.phone ?? '', notes: row.notes ?? undefined };
    });
  }
  const created: Supplier = { id: Math.max(0, ...suppliers.map((s) => s.id)) + 1, name, phone: input.phone.trim(), notes: input.notes?.trim() || undefined };
  suppliers = [...suppliers, created];
  save('tb3.suppliers', suppliers);
  return delay(created);
}

export async function paySupplier(
  user: { name: string; role: Role },
  req: { supplierId: number; amount: number; method: PaymentMethod },
): Promise<void> {
  ownerOnly(user.role);
  await ensureFresh();
  const err = !isShopPaymentMethod(req.method) ? 'Njia ya malipo si sahihi. Tumia Cash, Lipa Namba au Bank' : validateSupplierPayment(req.amount, owedBySupplier(req.supplierId));
  if (err) {
    await delay(null);
    throw new Error(err);
  }
  if (isRemote()) {
    return write(async () => {
      check(await supabase.from('supplier_payments').insert({ supplier_id: req.supplierId, purchase_id: null, amount: req.amount, method: req.method, user_name: user.name }));
    });
  }
  payments = [
    ...payments,
    { id: payments.length + 1, supplierId: req.supplierId, purchaseId: null, amount: req.amount, method: req.method, paidAt: new Date().toISOString(), userName: user.name },
  ];
  save('tb3.supplierPayments', payments);
  await delay(null);
}

/**
 * Receive goods into Store (or straight into Shop). Sellers can receive, but cost and payment
 * are owner matters: the server fills the current cost and records the whole amount as owed.
 */
export async function createPurchase(
  user: { name: string; role: Role },
  input: PurchaseInput,
): Promise<{ purchaseId: number }> {
  await ensureFresh();
  const costs = new Map(internalProducts().map((p) => [p.id, p.costPrice]));
  const safe: PurchaseInput =
    user.role === 'owner'
      ? input
      : { ...input, paidNow: 0, lines: input.lines.map((l) => ({ ...l, unitCost: costs.get(l.productId) ?? 0 })) };

  const verdict = validatePurchase(safe, { knownImeis: allImeis(), today: todayIso() });
  if (!verdict.ok) {
    await delay(null);
    throw new Error(verdict.errors.join('\n'));
  }

  if (isRemote()) {
    return write(async () => {
      const purchaseId = await rpc<number>('rpc_create_purchase', {
        payload: {
          supplierId: safe.supplierId ?? null,
          location: safe.location,
          invoiceNo: safe.invoiceNo.trim(),
          date: safe.date,
          paidNow: safe.paidNow || 0,
          method: safe.method,
          lines: safe.lines.map((l) => ({ productId: l.productId, name: l.name, qty: l.qty, unitCost: l.unitCost, imeis: l.type === 'phone' ? l.imeis : [] })),
        },
      });
      return { purchaseId: Number(purchaseId) };
    });
  }

  const id = Math.max(0, ...purchases.map((p) => p.id)) + 1;
  // Apply every line; moveStock throws before changing anything for that line.
  for (const l of safe.lines) {
    moveStock({
      productId: l.productId,
      from: null,
      to: safe.location,
      qty: l.qty,
      type: 'PURCHASE',
      unitCost: l.unitCost,
      refType: 'purchase',
      refId: id,
      userName: user.name,
    });
    if (l.type === 'phone') {
      units = [...units, ...l.imeis.map((imei) => ({ imei, productId: l.productId, status: (safe.location === 'STORE' ? 'IN_STORE' : 'IN_SHOP') as UnitStatus }))];
    }
  }
  saveUnits();

  purchases = [
    ...purchases,
    {
      id,
      supplierId: safe.supplierId ?? null,
      location: safe.location,
      invoiceNo: safe.invoiceNo.trim(),
      date: safe.date,
      total: verdict.total,
      userName: user.name,
      lines: safe.lines.map((l) => ({ productId: l.productId, name: l.name, qty: l.qty, unitCost: l.unitCost })),
    },
  ];
  save('tb3.purchases', purchases);
  // Supplier payments only exist against a named supplier; without one there is no supplier ledger.
  if (safe.paidNow > 0 && safe.supplierId) {
    payments = [
      ...payments,
      { id: payments.length + 1, supplierId: safe.supplierId, purchaseId: id, amount: safe.paidNow, method: safe.method, paidAt: new Date().toISOString(), userName: user.name },
    ];
    save('tb3.supplierPayments', payments);
  }

  await delay(null);
  return { purchaseId: id };
}

/** Store -> Shop. Phones move by exact IMEI; quantities are checked against Store stock. */
export async function createTransfer(
  user: { name: string },
  req: { lines: TransferLineInput[]; note?: string },
): Promise<{ transferId: number }> {
  await ensureFresh();
  const products = internalProducts();
  const verdict = validateTransfer(req.lines, {
    storeStock: Object.fromEntries(products.map((p) => [p.id, p.storeQty])),
    storeImeis: new Set(imeisIn('IN_STORE')),
  });
  if (!verdict.ok) {
    await delay(null);
    throw new Error(verdict.errors.join('\n'));
  }
  if (isRemote()) {
    return write(async () => {
      const transferId = await rpc<number>('rpc_create_transfer', {
        payload: {
          note: req.note?.trim() ?? '',
          lines: req.lines.map((l) => ({ productId: l.productId, name: l.name, qty: l.qty, imeis: l.imeis })),
        },
      });
      return { transferId: Number(transferId) };
    });
  }
  const id = Math.max(0, ...transfers.map((t) => t.id)) + 1;
  for (const l of req.lines) {
    moveStock({ productId: l.productId, from: 'STORE', to: 'SHOP', qty: l.qty, type: 'TRANSFER', refType: 'transfer', refId: id, userName: user.name });
    if (l.imeis.length) setUnitStatus(l.imeis, 'IN_SHOP');
  }
  transfers = [
    ...transfers,
    { id, at: new Date().toISOString(), userName: user.name, note: req.note?.trim() ?? '', items: req.lines.map((l) => ({ productId: l.productId, name: l.name, qty: l.qty, imeis: l.imeis })) },
  ];
  save('tb3.transfers', transfers);

  await delay(null);
  return { transferId: id };
}

/**
 * Add new stock directly to Shop without touching Store stock or requiring a supplier invoice.
 * Increases Shop stock, updates unit buying cost when provided, records stock movements with user attribution,
 * and registers new IMEIs into IN_SHOP for IMEI-tracked phones.
 */
export async function addShopStock(
  user: { name: string; role: Role },
  req: { lines: DirectStockLineInput[] },
): Promise<{ total: number; unitsAdded: number }> {
  await ensureFresh();
  const costs = new Map(internalProducts().map((p) => [p.id, p.costPrice]));
  const safeLines: DirectStockLineInput[] = req.lines.map((l) => ({
    ...l,
    unitCost: user.role === 'owner' && l.unitCost > 0 ? l.unitCost : (costs.get(l.productId) ?? 0),
  }));

  const verdict = validateDirectStockIn(safeLines, { knownImeis: allImeis() });
  if (!verdict.ok) {
    await delay(null);
    throw new Error(verdict.errors.join('\n'));
  }

  if (isRemote()) {
    return write(async () => {
      await rpc('rpc_add_shop_stock', {
        payload: {
          location: 'SHOP',
          lines: safeLines.map((l) => ({ productId: l.productId, qty: l.qty, unitCost: l.unitCost, imeis: l.type === 'phone' ? l.imeis : [] })),
        },
      });
      return { total: verdict.total, unitsAdded: safeLines.reduce((a, l) => a + l.qty, 0) };
    });
  }

  let unitsAdded = 0;
  for (const l of safeLines) {
    moveStock({
      productId: l.productId,
      from: null,
      to: 'SHOP',
      qty: l.qty,
      type: 'PURCHASE',
      unitCost: l.unitCost,
      refType: 'stock-in',
      userName: user.name,
    });
    unitsAdded += l.qty;
    if (l.type === 'phone' && l.imeis.length > 0) {
      units = [
        ...units,
        ...l.imeis.map((imei) => ({ imei, productId: l.productId, status: 'IN_SHOP' as UnitStatus })),
      ];
    }
  }
  saveUnits();

  await delay(null);
  return { total: verdict.total, unitsAdded };
}

/**
 * Add stock directly to STORE without requiring a supplier invoice.
 * Increases Store stock and registers new IMEIs into IN_STORE.
 */
export async function addStoreStockDirect(
  user: { name: string; role?: Role },
  req: { lines: { productId: number; qty: number; imeis?: string[] }[] },
): Promise<{ unitsAdded: number }> {
  await ensureFresh();
  if (isRemote()) {
    return write(async () => {
      await rpc('rpc_add_shop_stock', {
        payload: { location: 'STORE', lines: req.lines.map((l) => ({ productId: l.productId, qty: l.qty, imeis: l.imeis ?? [] })) },
      });
      return { unitsAdded: req.lines.reduce((a, l) => a + l.qty, 0) };
    });
  }
  let unitsAdded = 0;
  for (const l of req.lines) {
    moveStock({
      productId: l.productId,
      from: null,
      to: 'STORE',
      qty: l.qty,
      type: 'PURCHASE',
      refType: 'stock-in',
      userName: user.name,
    });
    unitsAdded += l.qty;
    if (l.imeis && l.imeis.length > 0) {
      units = [
        ...units,
        ...l.imeis.map((imei) => ({ imei, productId: l.productId, status: 'IN_STORE' as UnitStatus })),
      ];
    }
  }
  saveUnits();

  await delay(null);
  return { unitsAdded };
}

/* ---------- Store dashboard feed ---------- */
export interface StoreFeed {
  receipts: { id: number; supplier: string; lines: string; total: number; date: string }[];
  transfers: { id: number; item: string; by: string; time: string; qty: number; when: string }[];
  receivedWeekValue: number;
  receivedWeekCount: number;
}

export async function getStoreFeed(role: Role): Promise<StoreFeed> {
  await ensureFresh();
  const owner = role === 'owner'; // purchase values are cost data
  const weekAgo = dateDaysAgo(7);
  const week = purchases.filter((p) => p.date >= weekAgo);
  const dayLabel = (iso: string) => {
    const d = new Date(iso);
    const t = todayIso();
    const day = todayDar(d);
    if (day === t) return 'Leo';
    if (day === dateDaysAgo(1)) return 'Jana';
    return day.split('-').reverse().slice(0, 2).join('/');
  };
  return delay({
    receipts: [...purchases]
      .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id)
      .slice(0, 3)
      .map((p) => ({
        id: p.id,
        supplier: supplierName(p.supplierId),
        lines: p.lines.map((l) => `${l.name} ×${l.qty}`).join(' · '),
        total: owner ? p.total : 0,
        date: p.date,
      })),
    transfers: [...transfers]
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, 3)
      .map((t) => ({
        id: t.id,
        item: t.items.length > 1 ? `${t.items[0].name} + ${t.items.length - 1}` : t.items[0].name,
        by: `Na ${t.userName.toLowerCase().includes('muuzaji') ? 'muuzaji' : t.userName}`,
        time: new Date(t.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
        qty: t.items.reduce((a, i) => a + i.qty, 0),
        when: dayLabel(t.at),
      })),
    receivedWeekValue: owner ? week.reduce((a, p) => a + p.total, 0) : 0,
    receivedWeekCount: week.length,
  });
}


/* ---------- Stock events (used by notifications) ---------- */
export interface StockEvent {
  kind: 'RECEIVED' | 'TRANSFERRED';
  id: number;
  at: string; // ISO timestamp
  title: string; // what moved
  qty: number;
  by: string;
  location: 'STORE' | 'SHOP';
}

/** The latest receipts and Store -> Shop transfers, newest first. No cost information. */
export function listStockEvents(limit = 12): StockEvent[] {
  const received: StockEvent[] = purchases.map((p) => ({
    kind: 'RECEIVED',
    id: p.id,
    at: p.date.length === 10 ? `${p.date}T12:00:00` : p.date,
    title: p.lines.length > 1 ? `${p.lines[0].name} + ${p.lines.length - 1}` : (p.lines[0]?.name ?? ''),
    qty: p.lines.reduce((a, l) => a + l.qty, 0),
    by: p.userName,
    location: p.location,
  }));
  const moved: StockEvent[] = transfers.map((t) => ({
    kind: 'TRANSFERRED',
    id: t.id,
    at: t.at,
    title: t.items.length > 1 ? `${t.items[0].name} + ${t.items.length - 1}` : (t.items[0]?.name ?? ''),
    qty: t.items.reduce((a, i) => a + i.qty, 0),
    by: t.userName,
    location: 'SHOP',
  }));
  return [...received, ...moved].sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}
