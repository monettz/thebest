/**
 * Mock sales backend: phone units (IMEI), customers, sales, debt payments and an SMS log,
 * persisted in localStorage. completeSale() and payDebt() run the same shared rules
 * the real API will run inside a DB transaction.
 */
import { isShopPaymentMethod, type PaymentMethod, type Role } from '@shared/constants';
import { todayDar } from '@/lib/dar';
import {
  addDays,
  ageBucket,
  daysBetween,
  debtPaymentSms,
  debtReminderNoDueSms,
  debtReminderSms,
  debtStatus,
  dueTag,
  validateDebtPayment,
  validatePaymentDate,
  type DebtStatus,
  type DueTag,
} from '@shared/debts';
import { customerStatus, findDuplicates, inReport, type CustomerStatus, type DuplicateHit } from '@shared/customers';
import { planReturn, planVoid, type ReturnItem, type SaleSnapshot } from '@shared/returns';
import type { Range, SaleFact } from '@shared/money';
import { purchaseSms } from '@shared/sms';
import { customerSchema, normalizePhone } from '@shared/schemas';
import {
  imeiFromBody,
  validateCheckout,
  type CheckoutInput,
  type CustomerInput,
  type SaleStatus,
} from '@shared/sales';
import { currentSettings, deductShopStock, internalProducts } from './api';
import { logAudit } from './audit';
import { hasSentSms, isSmsConfigured, sendSms } from './sms';
import { imeisIn, setUnitStatus } from './inventory';
import { SEED_USERS } from './seed';
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

export { todayDar };
const isoDaysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(10, 0, 0, 0);
  return d.toISOString();
};

/* ---------- Customers ---------- */
export interface Customer {
  id: number;
  name: string;
  phone: string; // normalized 255XXXXXXXXX, or '' when the customer has no phone on record
  email?: string;
  area?: string; // address
  notes?: string;
  idNumber?: string;
  createdAt: string;
}
const seedCustomers = (): Customer[] =>
  [
    [1, 'Juma Hassan', '255712345678', 'Kariakoo', 240],
    [2, 'Amina Mussa', '255754221900', 'Mwenge', 200],
    [3, 'Peter Kimaro', '255689112334', 'Sinza', 180],
    [4, 'Saida Ngowi', '255745090122', 'Mbezi', 90],
    [5, 'Grace Lyimo', '255716778410', 'Ubungo', 60],
    [6, 'Hamisi Mrisho', '255782556001', 'Temeke', 45],
    [7, 'Omari Juma', '255713000555', 'Kimara', 30],
  ].map(([id, name, phone, area, ago]) => ({
    id: id as number,
    name: name as string,
    phone: phone as string,
    area: area as string,
    createdAt: isoDaysAgo(ago as number),
  }));
let customers = load<Customer[]>('tb2.customers', () => {
  return typeof process !== 'undefined' && (process.env?.NODE_ENV === 'test' || !!process.env?.VITEST)
    ? seedCustomers()
    : [];
});

const squash = (t: string) => t.toLowerCase().replace(/\s/g, '');
function matchesCustomer(c: Customer, needle: string): boolean {
  const n = squash(needle);
  if (!n) return true;
  return squash(c.name).includes(n) || (!!c.phone && c.phone.includes(n.replace(/^0/, '255').replace(/^\+/, '')));
}

export async function searchCustomers(q: string): Promise<Customer[]> {
  await ensureFresh();
  const s = q.trim().toLowerCase().replace(/\s/g, '');
  if (!s) return delay([], 0);
  return delay(
    customers
      .filter((c) => matchesCustomer(c, s))
      .slice(0, 6),
    0,
  );
}

/* ---------- Sales ---------- */
interface PaymentRecord {
  id: number;
  method: PaymentMethod;
  amount: number;
  paidAt: string;
  kind: 'SALE' | 'DEBT' | 'REFUND';
  userName?: string; // who received it (debt payments)
  reference?: string; // transaction reference (mobile money / bank)
  notes?: string;
  key?: string; // client-generated idempotency key: the same key is never recorded twice
}
interface SaleLine {
  productId: number;
  name: string;
  qty: number;
  unitPrice: number;
  unitCost: number; // snapshot, never leaves this module
  imei?: string;
}
interface SaleRecord {
  id: number;
  receiptNo: string;
  createdAt: string;
  userName: string;
  customerId: number | null;
  lines: SaleLine[];
  subtotal: number;
  discount: number;
  total: number;
  payments: PaymentRecord[];
  dueDate: string | null;
  status: SaleStatus;
  returns?: ReturnRecord[];
  voided?: { by: string; reason: string; at: string };
}
interface ReturnRecord {
  id: number;
  at: string;
  by: string;
  reason: string;
  condition: 'RESTOCK' | 'DAMAGED';
  items: { lineIndex: number; qty: number }[];
  value: number;
  refund: number;
}

interface SeedSale {
  cust: number;
  ago: number;
  items: [name: string, productId: number, qty: number, price: number, imei?: string][];
  paid: number;
  later?: [daysAgo: number, amount: number][];
  due?: number; // days from today
}

/** Historical sample sales: six open debts plus some paid history. */
const SEED_SALES: SeedSale[] = [
  { cust: 1, ago: 1, items: [['Samsung A15', 1, 1, 900000, imeiFromBody('86100000004471')]], paid: 500000, later: [[0, 200000]], due: 17 },
  { cust: 2, ago: 9, items: [['Tecno Spark 20', 2, 1, 480000, imeiFromBody('86100000008820')]], paid: 180000, due: 10 },
  { cust: 3, ago: 40, items: [['iPhone 11', 3, 1, 1150000, imeiFromBody('35300000002093')]], paid: 500000, due: -12 },
  { cust: 4, ago: 4, items: [['Redmi 13', 4, 1, 420000, imeiFromBody('86200000001177')]], paid: 150000, later: [[1, 120000]], due: 5 },
  { cust: 7, ago: 2, items: [['Charger 25W', 6, 1, 35000], ['Earbuds', 8, 1, 45000]], paid: 0, due: 3 },
  { cust: 6, ago: 12, items: [['Samsung A15', 1, 1, 900000, imeiFromBody('86100000005512')]], paid: 380000, due: 20 },
  { cust: 1, ago: 78, items: [['Charger 25W', 6, 1, 30000], ['Phone cover', 7, 1, 15000]], paid: 45000 },
  { cust: 1, ago: 162, items: [['Tecno Spark 20', 2, 1, 480000, imeiFromBody('86104500005093')]], paid: 480000 },
  { cust: 1, ago: 240, items: [['Protector A15', 5, 1, 25000]], paid: 25000 },
  { cust: 5, ago: 20, items: [['Phone cover', 7, 1, 15000]], paid: 15000 },
];

function seedSales(): SaleRecord[] {
  const costs = new Map(internalProducts().map((p) => [p.id, p.costPrice]));
  const today = todayDar();
  return SEED_SALES.map((s, i) => {
    const id = i + 1;
    const total = s.items.reduce((a, [, , q, price]) => a + q * price, 0);
    const payments: PaymentRecord[] = [];
    if (s.paid > 0) payments.push({ id: 1, method: 'CASH', amount: s.paid, paidAt: isoDaysAgo(s.ago), kind: 'SALE' });
    for (const [ago, amount] of s.later ?? []) {
      payments.push({ id: payments.length + 1, method: 'MPESA', amount, paidAt: isoDaysAgo(ago), kind: 'DEBT' });
    }
    const paid = payments.reduce((a, p) => a + p.amount, 0);
    return {
      id,
      receiptNo: `TB-${String(id).padStart(6, '0')}`,
      createdAt: isoDaysAgo(s.ago),
      userName: 'Muuzaji Mmoja',
      customerId: s.cust,
      lines: s.items.map(([name, productId, qty, unitPrice, imei]) => ({
        productId,
        name,
        qty,
        unitPrice,
        unitCost: costs.get(productId) ?? 0,
        imei,
      })),
      subtotal: total,
      discount: 0,
      total,
      payments,
      dueDate: paid < total && s.due !== undefined ? addDays(today, s.due) : null,
      status: paid >= total ? 'PAID' : 'PARTIAL',
    } satisfies SaleRecord;
  });
}
/** Sample history: one month-and-a-half of busy days plus older daily totals, so reports have something to show. */
function historySales(firstId: number): SaleRecord[] {
  let seed = 20260;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const WEEK = [1_900_000, 3_100_000, 1_200_000, 2_600_000, 2_200_000, 2_800_000, 3_450_000]; // oldest -> today
  const SPLIT: [PaymentMethod, number][] = [['MPESA', 44], ['CASH', 29], ['MIXX', 12], ['AIRTEL', 8], ['BANK', 7]];
  const out: SaleRecord[] = [];
  let id = firstId;

  const linesFor = (total: number): SaleLine[] => {
    let rest = total;
    const lines: SaleLine[] = [];
    const take = (productId: number, name: string, price: number, cost: number, qty: number) => {
      if (qty <= 0) return;
      lines.push({ productId, name, qty, unitPrice: price, unitCost: cost });
      rest -= qty * price;
    };
    take(1, 'Samsung A15', 900000, 780000, Math.floor((rest * 0.45) / 900000));
    take(2, 'Tecno Spark 20', 480000, 410000, Math.floor((rest * 0.95) / 480000));
    take(6, 'Charger 25W', 35000, 18000, Math.floor((rest * 0.3) / 35000));
    take(7, 'Phone cover', 15000, 5000, Math.floor((rest * 0.4) / 15000));
    take(5, 'Screen protector A15', 10000, 3000, Math.floor(rest / 10000));
    if (rest > 0) lines.push({ productId: 7, name: 'Phone cover', qty: 1, unitPrice: rest, unitCost: Math.round(rest * 0.33) });
    return lines;
  };

  for (let ago = 184; ago >= 0; ago--) {
    const target = ago <= 6 ? WEEK[6 - ago] : Math.round((1_100_000 + rnd() * 1_800_000) / 5000) * 5000;
    const parts = ago <= 34 ? 2 : 1;
    let left = target;
    for (let k = 0; k < parts; k++) {
      const amount = k === parts - 1 ? left : Math.floor(target / parts / 5000) * 5000;
      left -= amount;
      const at = isoDaysAgo(ago);
      let allocated = 0;
      const payments = SPLIT.map(([method, pct], i): PaymentRecord => {
        const part = i === SPLIT.length - 1 ? amount - allocated : Math.floor((amount * pct) / 100);
        allocated += part;
        return { id: i + 1, method, amount: part, paidAt: at, kind: 'SALE' };
      }).filter((p) => p.amount > 0);
      out.push({
        id,
        receiptNo: `TB-${String(id).padStart(6, '0')}`,
        createdAt: at,
        userName: 'Muuzaji Mmoja',
        customerId: null,
        lines: linesFor(amount),
        subtotal: amount,
        discount: 0,
        total: amount,
        payments,
        dueDate: null,
        status: 'PAID',
      });
      id++;
    }
  }
  return out;
}

let sales = load<SaleRecord[]>('tb4.sales', () => {
  if (typeof process !== 'undefined' && (process.env?.NODE_ENV === 'test' || !!process.env?.VITEST)) {
    const base = seedSales();
    return [...base, ...historySales(base.length + 1)];
  }
  return [];
});

export type { SaleRecord };
export function hydrateSales(nextCustomers: Customer[], nextSales: SaleRecord[]): void {
  customers = nextCustomers;
  sales = nextSales;
}

/** Facts the reports are built from. Cost snapshots live here, so only owner-facing code may use `unitCost`. */
export function salesFacts(): SaleFact[] {
  return sales.map((s) => ({
    date: todayDar(new Date(s.createdAt)),
    status: s.status,
    subtotal: s.subtotal,
    total: s.total,
    returnedValue: returnedValueOf(s),
    lines: s.lines.map((l, i) => ({
      productId: l.productId,
      name: l.name,
      qty: l.qty,
      returnedQty: returnedQtyOf(s, i),
      unitPrice: l.unitPrice,
      unitCost: l.unitCost,
    })),
    payments: s.payments.map((p) => ({ method: p.method, amount: p.amount, kind: p.kind, date: todayDar(new Date(p.paidAt)) })),
  }));
}

const paidOf = (s: SaleRecord) => s.payments.reduce((a, p) => a + p.amount, 0); // refunds are negative
const returnedValueOf = (s: SaleRecord) => (s.returns ?? []).reduce((a, r) => a + r.value, 0);
const returnedQtyOf = (s: SaleRecord, lineIndex: number) =>
  (s.returns ?? []).flatMap((r) => r.items).filter((i) => i.lineIndex === lineIndex).reduce((a, i) => a + i.qty, 0);
/** Total after returns; a void sale counts for nothing. */
const effTotal = (s: SaleRecord) => (s.status === 'VOID' ? 0 : s.total - returnedValueOf(s));
const balanceOf = (s: SaleRecord) => (s.status === 'VOID' ? 0 : Math.max(0, effTotal(s) - paidOf(s)));
const customerOf = (id: number | null) => (id == null ? null : (customers.find((c) => c.id === id) ?? null));

/* ---------- POS catalog ---------- */
export interface PosProduct {
  id: number;
  name: string;
  detail: string;
  type: 'phone' | 'accessory';
  code: string;
  sellPrice: number;
  shopQty: number;
  imeis: string[]; // phones only: units IN_SHOP
  imageUrl?: string;
}

export async function listPosProducts(): Promise<PosProduct[]> {
  await ensureFresh();
  return delay(
    internalProducts().filter((p) => !p.archived).map((p) => ({
      id: p.id,
      name: p.name,
      detail: p.detail,
      type: p.type,
      code: p.code,
      sellPrice: p.sellPrice,
      shopQty: p.shopQty,
      imeis: imeisIn('IN_SHOP', p.id),
      imageUrl: p.imageUrl,
    })),
  );
}

export interface CheckoutRequest extends CheckoutInput {
  ownerPin?: string;
}

/** A sale recorded for a past day is stamped at midday Dar es Salaam time; today's sales keep the real time. */
export function soldAtOf(soldOn: string | undefined, today: string): string | null {
  return soldOn && soldOn !== today ? `${soldOn}T12:00:00+03:00` : null;
}

export async function completeSale(
  user: { id: number; name: string; role: Role },
  req: CheckoutRequest,
): Promise<{ saleId: number }> {
  await ensureFresh();
  const products = internalProducts();
  const verdict = validateCheckout(req, {
    shopStock: Object.fromEntries(products.map((p) => [p.id, p.shopQty])),
    availableImeis: new Set(imeisIn('IN_SHOP')),
    maxDiscountPct: currentSettings().maxDiscountPct,
    isOwner: user.role === 'owner',
    // With Supabase the PIN is checked by the database function; here we only require that one was typed.
    ownerPinOk: !!req.ownerPin && (isRemote() || SEED_USERS.some((u) => u.role === 'owner' && u.pin === req.ownerPin)),
    today: todayDar(),
  });
  if (!verdict.ok) {
    await delay(null);
    throw new Error(verdict.errors.join('\n'));
  }

  if (isRemote()) {
    let customer: Customer | null = null;
    let receiptNo = '';
    const out = await write(async () => {
      customer = await resolveCustomerRemote(req.customer, user.name);
      const res = await rpc<{ saleId: number; receiptNo: string }>('rpc_complete_sale', {
        payload: {
          key: (req as CheckoutRequest & { key?: string }).key,
          customerId: customer?.id ?? null,
          discount: req.discount,
          dueDate: verdict.balance > 0 ? (req.dueDate ?? null) : null,
          soldAt: soldAtOf(req.soldOn, todayDar()),
          ownerPin: req.ownerPin,
          lines: req.lines.map((l) => ({ productId: l.productId, qty: l.qty, unitPrice: l.unitPrice, imei: l.imei ?? null })),
          payments: req.payments.map((p) => ({ method: p.method, amount: p.amount })),
        },
      });
      receiptNo = res.receiptNo;
      return { saleId: Number(res.saleId) };
    });
    const c = customer as Customer | null;
    if (c?.phone && currentSettings().smsPurchase) {
      const itemNames = req.lines.map((l) => l.name).filter((n, i, a) => a.indexOf(n) === i);
      void sendSms({
        to: c.phone,
        body: purchaseSms({
          name: c.name,
          receiptNo,
          items: itemNames.length > 2 ? `${itemNames[0]} na vingine ${itemNames.length - 1}` : itemNames.join(' na '),
          total: verdict.total,
          paid: verdict.paid,
          balance: verdict.balance,
          dueDate: req.dueDate ?? null,
        }),
        type: 'PURCHASE',
      });
    }
    return out;
  }

  const customer = resolveCustomer(req.customer, user.name);
  const nowIso = soldAtOf(req.soldOn, todayDar()) ?? new Date().toISOString();
  const id = Math.max(0, ...sales.map((s) => s.id)) + 1;
  const record: SaleRecord = {
    id,
    receiptNo: `TB-${String(id).padStart(6, '0')}`,
    createdAt: nowIso,
    userName: user.name,
    customerId: customer?.id ?? null,
    lines: req.lines.map((l) => ({
      productId: l.productId,
      name: l.name,
      qty: l.qty,
      unitPrice: l.unitPrice,
      unitCost: products.find((p) => p.id === l.productId)?.costPrice ?? 0, // snapshot
      imei: l.imei,
    })),
    subtotal: verdict.subtotal,
    discount: req.discount,
    total: verdict.total,
    payments: req.payments.map((p, i) => ({ id: i + 1, method: p.method, amount: p.amount, paidAt: nowIso, kind: 'SALE' as const })),
    dueDate: verdict.balance > 0 ? (req.dueDate ?? null) : null,
    status: verdict.status,
  };

  if (req.discount > 0 && (req.discount / verdict.subtotal) * 100 > currentSettings().maxDiscountPct) {
    logAudit(user.name, 'DISCOUNT_OVER_LIMIT', id, `${record.receiptNo}: punguzo ${req.discount} la ${verdict.subtotal}${user.role === 'seller' ? ' (PIN ya mmiliki)' : ''}`);
  }
  // Stock + units move together (one transaction in the real backend).
  const sold = new Set(req.lines.map((l) => l.imei).filter(Boolean));
  setUnitStatus([...sold] as string[], 'SOLD');
  for (const l of req.lines) deductShopStock(l.productId, l.qty, id, user.name);
  sales = [...sales, record];
  save('tb4.sales', sales);


  if (customer?.phone && currentSettings().smsPurchase) {
    const itemNames = record.lines.map((l) => l.name).filter((n, i, a) => a.indexOf(n) === i);
    void sendSms({
      to: customer.phone,
      body: purchaseSms({
        name: customer.name,
        receiptNo: record.receiptNo,
        items: itemNames.length > 2 ? `${itemNames[0]} na vingine ${itemNames.length - 1}` : itemNames.join(' na '),
        total: record.total,
        paid: verdict.paid,
        balance: verdict.balance,
        dueDate: record.dueDate,
      }),
      type: 'PURCHASE',
    });
  }
  return delay({ saleId: id });
}

/** POS with Supabase: same rules as resolveCustomer, but a new customer is written to the database first. */
async function resolveCustomerRemote(input: CustomerInput | null | undefined, by: string): Promise<Customer | null> {
  if (!input) return null;
  if (input.id != null) {
    const found = customers.find((c) => c.id === input.id);
    if (!found) throw new Error('Mteja hajapatikana');
    return found;
  }
  if (!input.name.trim() && !(input.phone ?? '').trim()) return null;
  const fields = cleanFields({ name: input.name, phone: input.phone });
  const existing = fields.phone ? customers.find((c) => c.phone === fields.phone) : undefined;
  return existing ?? insertCustomerRemote(fields, by);
}

async function insertCustomerRemote(fields: ReturnType<typeof cleanFields>, by?: string): Promise<Customer> {
  const res = check(
    await supabase
      .from('customers')
      .insert({ name: fields.name, phone: fields.phone || null, area: fields.area ?? null, id_number: fields.idNumber ?? null, notes: fields.notes ?? null })
      .select('id, created_at')
      .single(),
  );
  const row = res.data as { id: number; created_at: string };
  const created: Customer = { id: row.id, createdAt: row.created_at, ...fields };
  if (by) logAudit(by, 'CUSTOMER_CREATE', created.id, `${created.name}${created.phone ? ` (${created.phone})` : ''}`);
  return created;
}

/** POS: a selected customer is looked up by id; a new one goes through the same rules as the Customers page. */
function resolveCustomer(input: CustomerInput | null | undefined, by: string): Customer | null {
  if (!input) return null;
  if (input.id != null) {
    const found = customers.find((c) => c.id === input.id);
    if (!found) throw new Error('Mteja hajapatikana');
    return found;
  }
  if (!input.name.trim() && !(input.phone ?? '').trim()) return null;
  const fields = cleanFields({ name: input.name, phone: input.phone });
  // A phone number that is already registered is the same person: reuse the record, never duplicate it.
  const existing = fields.phone ? customers.find((c) => c.phone === fields.phone) : undefined;
  return existing ?? insertCustomer(fields, by);
}

/* ---------- Receipts (no cost or profit fields, for any role) ---------- */
export interface ReceiptView {
  receiptNo: string;
  createdAt: string;
  userName: string;
  customer: Customer | null;
  lines: { name: string; qty: number; unitPrice: number; imei?: string }[];
  subtotal: number;
  discount: number;
  total: number;
  payments: { method: PaymentMethod; amount: number }[];
  paid: number;
  balance: number;
  dueDate: string | null;
  status: SaleStatus;
}

export async function getReceipt(saleId: number): Promise<ReceiptView | null> {
  await ensureFresh();
  const s = sales.find((x) => x.id === saleId);
  if (!s) return delay(null);
  const atSale = s.payments.filter((p) => p.kind === 'SALE');
  return delay({
    receiptNo: s.receiptNo,
    createdAt: s.createdAt,
    userName: s.userName,
    customer: customerOf(s.customerId),
    lines: s.lines.map(({ name, qty, unitPrice, imei }) => ({ name, qty, unitPrice, imei })),
    subtotal: s.subtotal,
    discount: s.discount,
    total: s.total,
    payments: atSale.map(({ method, amount }) => ({ method, amount })),
    paid: atSale.reduce((a, p) => a + p.amount, 0),
    balance: balanceOf(s),
    dueDate: s.dueDate,
    status: s.status,
  });
}

export interface PaymentReceiptView {
  receiptNo: string; // of the original sale
  paymentNo: string;
  paidAt: string;
  userName: string;
  customer: Customer | null;
  method: PaymentMethod;
  amount: number;
  saleTotal: number;
  paidToDate: number;
  balance: number;
  dueDate: string | null;
}

export async function getPaymentReceipt(saleId: number, paymentId: number): Promise<PaymentReceiptView | null> {
  await ensureFresh();
  const s = sales.find((x) => x.id === saleId);
  const p = s?.payments.find((x) => x.id === paymentId);
  if (!s || !p) return delay(null);
  const upTo = s.payments.filter((x) => new Date(x.paidAt) <= new Date(p.paidAt) && x.id <= p.id);
  const paidToDate = upTo.reduce((a, x) => a + x.amount, 0);
  return delay({
    receiptNo: s.receiptNo,
    paymentNo: `${s.receiptNo}-M${p.id}`,
    paidAt: p.paidAt,
    userName: p.userName ?? s.userName,
    customer: customerOf(s.customerId),
    method: p.method,
    amount: p.amount,
    saleTotal: effTotal(s),
    paidToDate,
    balance: effTotal(s) - paidToDate,
    dueDate: effTotal(s) - paidToDate > 0 ? s.dueDate : null,
  });
}

/* ---------- Debts ---------- */
export interface DebtRow {
  saleId: number;
  receiptNo: string;
  customer: Customer;
  item: string;
  saleDate: string; // yyyy-mm-dd
  total: number; // sale amount after returns
  paid: number;
  balance: number;
  dueDate: string | null; // null = no due date was recorded; never guessed
  due: DueTag | null;
  ageDays: number;
  status: DebtStatus;
}

export interface DebtOverview {
  rows: DebtRow[]; // debts with a balance still to pay
  allRows: DebtRow[]; // the same plus fully paid debts (kept as history)
  totalDebt: number;
  debtorCount: number;
  overdueTotal: number;
  overdueCount: number;
  paidThisMonth: number;
  paymentsThisMonth: number;
  buckets: [number, number, number]; // 0–7, 8–30, over 30 days (unpaid amount by age of the sale)
}

function itemSummary(s: SaleRecord): string {
  const first = s.lines[0]?.name ?? '';
  return s.lines.length > 1 ? `${first} + ${s.lines.length - 1}` : first;
}

/** A sale is a debt when the customer left owing money, or later paid something against it. */
const wasDebt = (s: SaleRecord) =>
  s.status !== 'VOID' &&
  s.customerId != null &&
  (s.total > s.payments.filter((p) => p.kind === 'SALE').reduce((a, p) => a + p.amount, 0) || s.payments.some((p) => p.kind === 'DEBT'));

function debtRowOf(s: SaleRecord, customer: Customer, today: string): DebtRow {
  const saleDate = todayDar(new Date(s.createdAt));
  const balance = balanceOf(s);
  const paid = paidOf(s);
  const dueDate = balance > 0 ? s.dueDate : null;
  return {
    saleId: s.id,
    receiptNo: s.receiptNo,
    customer,
    item: itemSummary(s),
    saleDate,
    total: effTotal(s),
    paid,
    balance,
    dueDate,
    due: dueDate ? dueTag(dueDate, today) : null,
    ageDays: daysBetween(saleDate, today),
    status: debtStatus(balance, paid, dueDate, today),
  };
}

const byUrgency = (a: DebtRow, b: DebtRow) => (a.dueDate ?? '9999-12-31').localeCompare(b.dueDate ?? '9999-12-31') || a.saleDate.localeCompare(b.saleDate);

export async function getDebtOverview(): Promise<DebtOverview> {
  await ensureFresh();
  const today = todayDar();
  const all: DebtRow[] = [];
  for (const s of sales) {
    const customer = customerOf(s.customerId);
    if (!customer || !wasDebt(s)) continue;
    all.push(debtRowOf(s, customer, today));
  }
  const rows = all.filter((r) => r.balance > 0).sort(byUrgency);
  const paidRows = all.filter((r) => r.balance <= 0).sort((a, b) => b.saleDate.localeCompare(a.saleDate));

  const buckets: [number, number, number] = [0, 0, 0];
  for (const r of rows) buckets[ageBucket(r.ageDays)] += r.balance;
  const month = today.slice(0, 7);
  const monthly = sales
    .filter((s) => s.status !== 'VOID')
    .flatMap((s) => s.payments)
    .filter((p) => p.kind === 'DEBT' && todayDar(new Date(p.paidAt)).startsWith(month));
  const overdue = rows.filter((r) => r.status === 'OVERDUE');

  return delay({
    rows,
    allRows: [...rows, ...paidRows],
    // Per sale, so one customer with several unpaid sales is summed once per sale and never twice.
    totalDebt: rows.reduce((a, r) => a + r.balance, 0),
    debtorCount: new Set(rows.map((r) => r.customer.id)).size,
    overdueTotal: overdue.reduce((a, r) => a + r.balance, 0),
    overdueCount: new Set(overdue.map((r) => r.customer.id)).size,
    paidThisMonth: monthly.reduce((a, p) => a + p.amount, 0),
    paymentsThisMonth: monthly.length,
    buckets,
  });
}

export interface DebtPaymentRequest {
  saleId: number;
  amount: number;
  method: PaymentMethod;
  sendSms: boolean;
  reference?: string;
  notes?: string;
  paidOn?: string; // yyyy-mm-dd, defaults to today
  key?: string; // makes a double submit harmless
}

/** Dated at the moment of payment when it is today, otherwise at midday Dar es Salaam on that day. */
const paidAtIso = (paidOn: string | undefined, today: string) =>
  !paidOn || paidOn === today ? new Date().toISOString() : new Date(`${paidOn}T12:00:00+03:00`).toISOString();

function applyDebtPayment(user: { name: string }, req: DebtPaymentRequest): { saleId: number; paymentId: number; left: number; duplicate: boolean } {
  const s = sales.find((x) => x.id === req.saleId);
  if (!s) throw new Error('Mauzo hayajapatikana');
  if (req.key) {
    const seen = s.payments.find((p) => p.key === req.key);
    if (seen) return { saleId: s.id, paymentId: seen.id, left: balanceOf(s), duplicate: true };
  }
  if (!isShopPaymentMethod(req.method)) throw new Error('Njia ya malipo si sahihi. Tumia Cash, Lipa Namba au Bank');
  const balance = balanceOf(s);
  const err = validateDebtPayment(req.amount, balance);
  if (err) throw new Error(err);
  const today = todayDar();
  if (req.paidOn) {
    const dateErr = validatePaymentDate(req.paidOn, todayDar(new Date(s.createdAt)), today);
    if (dateErr) throw new Error(dateErr);
  }
  const paymentId = Math.max(0, ...s.payments.map((p) => p.id)) + 1;
  const left = balance - req.amount;
  const payment: PaymentRecord = {
    id: paymentId,
    method: req.method,
    amount: req.amount,
    paidAt: paidAtIso(req.paidOn, today),
    kind: 'DEBT',
    userName: user.name,
    reference: req.reference?.trim() || undefined,
    notes: req.notes?.trim() || undefined,
    key: req.key,
  };
  const updated: SaleRecord = {
    ...s,
    payments: [...s.payments, payment],
    status: left === 0 ? 'PAID' : 'PARTIAL',
    dueDate: left === 0 ? null : s.dueDate,
  };
  sales = sales.map((x) => (x.id === s.id ? updated : x));
  save('tb4.sales', sales);
  logAudit(user.name, 'DEBT_PAYMENT', s.id, `${s.receiptNo}: TSh ${req.amount} (${req.method})${payment.reference ? ` ref ${payment.reference}` : ''}, balance ${left}`);

  const customer = customerOf(s.customerId);
  if (req.sendSms && customer?.phone && currentSettings().smsDebtPayment) {
    void sendSms({ to: customer.phone, body: debtPaymentSms(customer.name, req.amount, left), type: 'DEBT_PAYMENT' });
  }


  return { saleId: s.id, paymentId, left, duplicate: false };
}

/** A repayment against one sale. It is recorded as a DEBT payment on that sale, never as a new sale. */
async function payDebtRemote(_user: { name: string }, req: DebtPaymentRequest): Promise<{ saleId: number; paymentId: number; left: number }> {
  const s = sales.find((x) => x.id === req.saleId);
  if (!s) throw new Error('Mauzo hayajapatikana');
  if (!isShopPaymentMethod(req.method)) throw new Error('Njia ya malipo si sahihi. Tumia Cash, Lipa Namba au Bank');
  const err = validateDebtPayment(req.amount, balanceOf(s));
  if (err) throw new Error(err);
  const today = todayDar();
  if (req.paidOn) {
    const dateErr = validatePaymentDate(req.paidOn, todayDar(new Date(s.createdAt)), today);
    if (dateErr) throw new Error(dateErr);
  }
  const r = await rpc<{ saleId: number; paymentId: number; left: number }>('rpc_pay_debt', {
    payload: {
      saleId: s.id,
      amount: req.amount,
      method: req.method,
      reference: req.reference?.trim() || null,
      key: req.key ?? null,
      paidAt: req.paidOn && req.paidOn !== today ? paidAtIso(req.paidOn, today) : null,
    },
  });
  const customer = customerOf(s.customerId);
  if (req.sendSms && customer?.phone && currentSettings().smsDebtPayment) {
    void sendSms({ to: customer.phone, body: debtPaymentSms(customer.name, req.amount, Number(r.left)), type: 'DEBT_PAYMENT' });
  }
  return { saleId: Number(r.saleId), paymentId: Number(r.paymentId), left: Number(r.left) };
}

export async function payDebt(user: { name: string }, req: DebtPaymentRequest): Promise<{ saleId: number; paymentId: number }> {
  await ensureFresh();
  if (isRemote()) {
    return write(async () => {
      const r = await payDebtRemote(user, req);
      return { saleId: r.saleId, paymentId: r.paymentId };
    });
  }
  try {
    const r = applyDebtPayment(user, req);
    return delay({ saleId: r.saleId, paymentId: r.paymentId });
  } catch (e) {
    await delay(null);
    throw e;
  }
}

/**
 * Money received from a customer without naming a sale: it clears their oldest unpaid sales first,
 * one repayment record per sale touched.
 */
export async function payCustomerDebt(
  user: { name: string },
  req: Omit<DebtPaymentRequest, 'saleId'> & { customerId: number },
): Promise<{ applied: { saleId: number; paymentId: number; amount: number }[] }> {
  await ensureFresh();
  const open = sales
    .filter((s) => s.customerId === req.customerId && balanceOf(s) > 0)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id - b.id);
  const owed = open.reduce((a, s) => a + balanceOf(s), 0);
  const err = validateDebtPayment(req.amount, owed);
  if (err) {
    await delay(null);
    throw new Error(err);
  }
  // Plan first, then apply: either every sale takes its share or nothing is recorded.
  const plan: { s: SaleRecord; part: number }[] = [];
  for (let rest = req.amount, i = 0; rest > 0 && i < open.length; i++) {
    const part = Math.min(rest, balanceOf(open[i]));
    plan.push({ s: open[i], part });
    rest -= part;
  }
  if (req.paidOn) {
    for (const { s } of plan) {
      const dateErr = validatePaymentDate(req.paidOn, todayDar(new Date(s.createdAt)), todayDar());
      if (dateErr) {
        await delay(null);
        throw new Error(dateErr);
      }
    }
  }
  if (isRemote()) {
    return write(async () => {
      const done: { saleId: number; paymentId: number; amount: number }[] = [];
      for (const { s, part } of plan) {
        const r = await payDebtRemote(user, { ...req, saleId: s.id, amount: part, key: req.key ? `${req.key}:${s.id}` : undefined });
        done.push({ saleId: r.saleId, paymentId: r.paymentId, amount: part });
      }
      return { applied: done };
    });
  }
  const applied: { saleId: number; paymentId: number; amount: number }[] = [];
  for (const { s, part } of plan) {
    const r = applyDebtPayment(user, { ...req, saleId: s.id, amount: part, key: req.key ? `${req.key}:${s.id}` : undefined });
    applied.push({ saleId: r.saleId, paymentId: r.paymentId, amount: part });
  }
  return delay({ applied });
}

/* ---------- Reminders ---------- */
export interface ReminderPreview {
  saleId: number;
  customerName: string;
  phone: string;
  balance: number;
  receiptNo: string;
  message: string;
  eligible: boolean;
  reason?: string; // why it cannot be sent
}

function reminderBody(s: SaleRecord, c: Customer, today: string): string {
  const balance = balanceOf(s);
  return s.dueDate ? debtReminderSms(c.name, balance, s.dueDate, s.dueDate < today) : debtReminderNoDueSms(c.name, balance);
}

export async function previewDebtReminders(saleIds: number[]): Promise<ReminderPreview[]> {
  await ensureFresh();
  const today = todayDar();
  const out: ReminderPreview[] = [];
  for (const id of saleIds) {
    const s = sales.find((x) => x.id === id);
    const c = s && customerOf(s.customerId);
    if (!s || !c || balanceOf(s) <= 0) continue;
    const reason = !c.phone ? 'Hana namba ya simu' : hasSentSms(`reminder:${s.id}:${today}`) ? 'Ameshakumbushwa leo' : undefined;
    out.push({ saleId: s.id, customerName: c.name, phone: c.phone, balance: balanceOf(s), receiptNo: s.receiptNo, message: reminderBody(s, c, today), eligible: !reason, reason });
  }
  return delay(out, 0);
}

/** Sends only what staff confirmed, once per sale per day. Nothing is sent when no SMS service is configured. */
export async function sendDebtReminders(saleIds: number[]): Promise<{ sent: number; duplicates: number; failed: number }> {
  await ensureFresh();
  if (!isSmsConfigured()) throw new Error('SMS haijawekwa. Weka huduma ya SMS ili kutuma vikumbusho.');
  const today = todayDar();
  const res = { sent: 0, duplicates: 0, failed: 0 };
  for (const id of saleIds) {
    const s = sales.find((x) => x.id === id);
    const c = s && customerOf(s.customerId);
    if (!s || !c || !c.phone || balanceOf(s) <= 0) continue;
    const status = await sendSms({ to: c.phone, body: reminderBody(s, c, today), type: 'DEBT_REMINDER', dedupeKey: `reminder:${s.id}:${today}` });
    if (status === 'SENT') res.sent++;
    else if (status === 'DUPLICATE') res.duplicates++;
    else res.failed++;
  }
  return delay(res);
}

/* ---------- Customers ---------- */
export interface CustomerListItem {
  customer: Customer;
  purchases: number; // sales that still count (not voided)
  totalPurchased: number; // after returns
  paid: number; // net of refunds
  debt: number; // outstanding balance, sale by sale
  lastPurchase: string | null; // yyyy-mm-dd
  status: CustomerStatus;
}

function summaryOf(customer: Customer): CustomerListItem {
  const mine = sales.filter((s) => s.customerId === customer.id && s.status !== 'VOID');
  const debt = mine.reduce((a, s) => a + balanceOf(s), 0);
  const last = mine.reduce<string | null>((m, s) => {
    const d = todayDar(new Date(s.createdAt));
    return !m || d > m ? d : m;
  }, null);
  return {
    customer,
    purchases: mine.length,
    totalPurchased: mine.reduce((a, s) => a + effTotal(s), 0),
    paid: mine.reduce((a, s) => a + paidOf(s), 0),
    debt,
    lastPurchase: last,
    status: customerStatus(mine.length, debt),
  };
}

export async function listCustomers(q = ''): Promise<CustomerListItem[]> {
  await ensureFresh();
  return delay(
    customers
      .filter((c) => matchesCustomer(c, q))
      .map(summaryOf)
      .sort((a, b) => b.debt - a.debt || a.customer.name.localeCompare(b.customer.name)),
  );
}

export interface CustomerSaleRow {
  saleId: number;
  receiptNo: string;
  date: string;
  items: string; // "Samsung A15 ×1, Charger ×2"
  imeis: string[];
  amount: number;
  paid: number;
  balance: number;
  dueDate: string | null;
  voided: boolean;
  payStatus: 'PAID' | 'PARTIAL' | 'UNPAID' | 'VOID';
  payments: { date: string; method: PaymentMethod; amount: number; kind: PaymentRecord['kind']; reference?: string }[];
}

export interface CustomerProfile extends CustomerListItem {
  firstDebtSaleId: number | null;
  history: CustomerSaleRow[];
}

function saleRowOf(s: SaleRecord): CustomerSaleRow {
  const voided = s.status === 'VOID';
  const paid = paidOf(s);
  const balance = balanceOf(s);
  return {
    saleId: s.id,
    receiptNo: s.receiptNo,
    date: todayDar(new Date(s.createdAt)),
    items: s.lines.map((l) => (l.qty > 1 ? `${l.name} ×${l.qty}` : l.name)).join(', '),
    imeis: s.lines.map((l) => l.imei).filter((x): x is string => !!x),
    amount: voided ? s.total : effTotal(s),
    paid,
    balance,
    dueDate: balance > 0 ? s.dueDate : null,
    voided,
    payStatus: voided ? 'VOID' : balance <= 0 ? 'PAID' : paid > 0 ? 'PARTIAL' : 'UNPAID',
    payments: s.payments.map((p) => ({ date: todayDar(new Date(p.paidAt)), method: p.method, amount: p.amount, kind: p.kind, reference: p.reference })),
  };
}

export async function getCustomerProfile(id: number): Promise<CustomerProfile | null> {
  await ensureFresh();
  const customer = customers.find((c) => c.id === id);
  if (!customer) return delay(null);
  const mine = sales.filter((s) => s.customerId === id);
  const open = mine.filter((s) => balanceOf(s) > 0).sort((a, b) => balanceOf(b) - balanceOf(a));
  return delay({
    ...summaryOf(customer),
    firstDebtSaleId: open[0]?.id ?? null,
    history: mine.map(saleRowOf).sort((a, b) => b.date.localeCompare(a.date) || b.saleId - a.saleId),
  });
}

export interface CustomerFormInput {
  name: string;
  phone?: string;
  email?: string;
  area?: string; // address
  notes?: string;
  idNumber?: string;
}

/** Thrown when another customer has a similar name; the caller may confirm and save anyway. */
export class SimilarCustomerError extends Error {
  constructor(public matches: DuplicateHit[]) {
    super('Mteja mwenye jina linalofanana tayari yupo');
  }
}

export async function checkCustomerDuplicates(input: { name: string; phone?: string }, excludeId?: number): Promise<DuplicateHit[]> {
  await ensureFresh();
  return delay(findDuplicates(customers, { name: input.name, phone: input.phone ?? '' }, excludeId), 0);
}

function cleanFields(input: CustomerFormInput) {
  const parsed = customerSchema.safeParse(input);
  if (!parsed.success) throw new Error(parsed.error.issues[0].message);
  const v = parsed.data;
  return {
    name: v.name,
    phone: v.phone ? (normalizePhone(v.phone) ?? '') : '',
    email: v.email || undefined,
    area: v.area || undefined,
    notes: v.notes || undefined,
    idNumber: v.idNumber?.trim() || undefined,
  };
}

function insertCustomer(fields: ReturnType<typeof cleanFields>, by?: string): Customer {
  const created: Customer = { id: Math.max(0, ...customers.map((c) => c.id)) + 1, createdAt: new Date().toISOString(), ...fields };
  customers = [...customers, created];
  save('tb2.customers', customers);
  if (by) logAudit(by, 'CUSTOMER_CREATE', created.id, `${created.name}${created.phone ? ` (${created.phone})` : ''}`);
  return created;
}

/**
 * The single place customers are created or edited (Customers page and POS both come here).
 * A phone number that already belongs to someone is refused; a similar name is a warning the caller can confirm.
 */
export async function saveCustomer(
  input: CustomerFormInput,
  id?: number,
  opts: { allowSimilarName?: boolean; by?: string } = {},
): Promise<Customer> {
  await ensureFresh();
  const fields = cleanFields(input);
  const hits = findDuplicates(customers, fields, id);
  const phoneHit = hits.find((h) => h.reason === 'PHONE');
  if (phoneHit) throw new Error(`Namba hii tayari imesajiliwa kwa ${phoneHit.name}`);
  if (hits.length > 0 && !opts.allowSimilarName) throw new SimilarCustomerError(hits);
  if (isRemote()) {
    return write(async () => {
      if (id == null) return insertCustomerRemote(fields, opts.by);
      const before = customers.find((c) => c.id === id);
      if (!before) throw new Error('Mteja hajapatikana');
      check(
        await supabase
          .from('customers')
          .update({ name: fields.name, phone: fields.phone || null, area: fields.area ?? null, id_number: fields.idNumber ?? null, notes: fields.notes ?? null, updated_at: new Date().toISOString() })
          .eq('id', id),
      );
      if (opts.by) logAudit(opts.by, 'CUSTOMER_UPDATE', id, fields.name);
      return { ...before, ...fields };
    });
  }
  let result: Customer;
  if (id != null) {
    const before = customers.find((c) => c.id === id);
    if (!before) throw new Error('Mteja hajapatikana');
    result = { ...before, ...fields };
    customers = customers.map((c) => (c.id === id ? result : c));
    save('tb2.customers', customers);
    if (opts.by) logAudit(opts.by, 'CUSTOMER_UPDATE', id, result.name);
  } else {
    result = insertCustomer(fields, opts.by);
  }
  return delay(result);
}

/* ---------- Reports (PDF data) ---------- */
export interface CustomerReportRow {
  customer: Customer;
  purchasesCount: number;
  purchasesAmount: number; // sales made in the period (after returns)
  paymentsAmount: number; // money received in the period
  debt: number; // outstanding NOW, whatever the period
  status: CustomerStatus;
}
export interface CustomerReport {
  range: Range | null;
  rows: CustomerReportRow[];
  totals: { purchases: number; payments: number; debt: number };
  /** Only for a single-customer report. */
  detail?: {
    customer: Customer;
    sales: CustomerSaleRow[]; // sales made in the period
    payments: { date: string; receiptNo: string; method: PaymentMethod; amount: number; kind: PaymentRecord['kind']; reference?: string }[]; // received in the period
    openDebts: DebtRow[]; // owed now
  };
}

const paymentsIn = (s: SaleRecord, range: Range | null) =>
  s.payments.filter((p) => p.kind !== 'REFUND' && inReport(todayDar(new Date(p.paidAt)), range));

export async function getCustomerReport(range: Range | null, customerId?: number): Promise<CustomerReport> {
  await ensureFresh();
  const today = todayDar();
  const list = customers.filter((c) => customerId == null || c.id === customerId);
  const rows: CustomerReportRow[] = list.map((customer) => {
    const mine = sales.filter((s) => s.customerId === customer.id && s.status !== 'VOID');
    const inPeriod = mine.filter((s) => inReport(todayDar(new Date(s.createdAt)), range));
    const sum = summaryOf(customer);
    return {
      customer,
      purchasesCount: inPeriod.length,
      purchasesAmount: inPeriod.reduce((a, s) => a + effTotal(s), 0),
      paymentsAmount: mine.reduce((a, s) => a + paymentsIn(s, range).reduce((x, p) => x + p.amount, 0), 0),
      debt: sum.debt,
      status: sum.status,
    };
  });
  rows.sort((a, b) => b.debt - a.debt || a.customer.name.localeCompare(b.customer.name));
  const report: CustomerReport = {
    range,
    rows,
    totals: {
      purchases: rows.reduce((a, r) => a + r.purchasesAmount, 0),
      payments: rows.reduce((a, r) => a + r.paymentsAmount, 0),
      debt: rows.reduce((a, r) => a + r.debt, 0),
    },
  };
  if (customerId != null && list[0]) {
    const mine = sales.filter((s) => s.customerId === customerId);
    report.detail = {
      customer: list[0],
      sales: mine.filter((s) => inReport(todayDar(new Date(s.createdAt)), range)).map(saleRowOf).sort((a, b) => a.date.localeCompare(b.date)),
      payments: mine
        .filter((s) => s.status !== 'VOID')
        .flatMap((s) => paymentsIn(s, range).map((p) => ({ date: todayDar(new Date(p.paidAt)), receiptNo: s.receiptNo, method: p.method, amount: p.amount, kind: p.kind, reference: p.reference })))
        .sort((a, b) => a.date.localeCompare(b.date)),
      openDebts: mine.filter((s) => balanceOf(s) > 0).map((s) => debtRowOf(s, list[0], today)).sort(byUrgency),
    };
  }
  return delay(report);
}

export type DebtReportScope = 'outstanding' | 'overdue' | 'customer';
export interface DebtReport {
  scope: DebtReportScope;
  range: Range | null;
  customer?: Customer;
  /** Debts in scope that are unpaid NOW (any sale date); `createdInPeriod` marks the ones born in the period. */
  rows: (DebtRow & { createdInPeriod: boolean })[];
  payments: { date: string; customer: Customer; receiptNo: string; method: PaymentMethod; amount: number; reference?: string }[];
  totals: { outstandingNow: number; overdueNow: number; createdInPeriod: number; collectedInPeriod: number };
}

export async function getDebtReport(scope: DebtReportScope, range: Range | null, customerId?: number): Promise<DebtReport> {
  await ensureFresh();
  const today = todayDar();
  const scoped = sales.filter((s) => {
    const c = customerOf(s.customerId);
    if (!c || !wasDebt(s)) return false;
    return scope !== 'customer' || c.id === customerId;
  });
  const all = scoped.map((s) => ({ ...debtRowOf(s, customerOf(s.customerId)!, today), createdInPeriod: inReport(todayDar(new Date(s.createdAt)), range) }));
  // A customer report also lists paid debts created in the period; the other scopes list what is unpaid now.
  let rows = all.filter((r) => (scope === 'customer' ? r.balance > 0 || r.createdInPeriod : r.balance > 0));
  if (scope === 'overdue') rows = rows.filter((r) => r.status === 'OVERDUE');
  rows.sort(byUrgency);
  const ids = new Set(rows.map((r) => r.saleId));
  const payments = scoped
    .filter((s) => s.status !== 'VOID' && (scope !== 'overdue' || ids.has(s.id)))
    .flatMap((s) =>
      s.payments
        .filter((p) => p.kind === 'DEBT' && inReport(todayDar(new Date(p.paidAt)), range))
        .map((p) => ({ date: todayDar(new Date(p.paidAt)), customer: customerOf(s.customerId)!, receiptNo: s.receiptNo, method: p.method, amount: p.amount, reference: p.reference })),
    )
    .sort((a, b) => a.date.localeCompare(b.date));
  return delay({
    scope,
    range,
    customer: customerId != null ? (customerOf(customerId) ?? undefined) : undefined,
    rows,
    payments,
    totals: {
      outstandingNow: rows.reduce((a, r) => a + r.balance, 0),
      overdueNow: rows.filter((r) => r.status === 'OVERDUE').reduce((a, r) => a + r.balance, 0),
      createdInPeriod: rows.filter((r) => r.createdInPeriod).reduce((a, r) => a + r.total, 0),
      collectedInPeriod: payments.reduce((a, p) => a + p.amount, 0),
    },
  });
}

/* ---------- Sales history, void and returns ---------- */
export interface SaleListItem {
  id: number;
  receiptNo: string;
  date: string; // yyyy-mm-dd
  customerName: string;
  items: string;
  total: number;
  status: SaleStatus;
  hasReturns: boolean;
}

export async function listSales(q = '', limit = 60): Promise<{ items: SaleListItem[]; total: number }> {
  await ensureFresh();
  const needle = q.trim().toLowerCase();
  const matched = [...sales]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id)
      .map((s) => ({ s, customer: customerOf(s.customerId) }))
      .filter(
        ({ s, customer }) =>
          !needle ||
          s.receiptNo.toLowerCase().includes(needle) ||
          (customer?.name.toLowerCase().includes(needle) ?? false) ||
          s.lines.some((l) => l.imei?.includes(needle) || l.name.toLowerCase().includes(needle)),
      );
  return delay({
    total: matched.length,
    items: matched.slice(0, limit).map(({ s, customer }) => ({
        id: s.id,
        receiptNo: s.receiptNo,
        date: todayDar(new Date(s.createdAt)),
        customerName: customer?.name ?? 'Mteja wa kawaida',
        items: itemSummary(s),
        total: s.status === 'VOID' ? s.total : effTotal(s),
        status: s.status,
        hasReturns: (s.returns ?? []).length > 0,
      })),
  });
}

export interface SaleDetail {
  id: number;
  receiptNo: string;
  createdAt: string;
  userName: string;
  customer: Customer | null;
  lines: { index: number; name: string; qty: number; unitPrice: number; imei?: string; returnedQty: number }[];
  subtotal: number;
  discount: number;
  total: number;
  returnedValue: number;
  netPaid: number;
  balance: number;
  status: SaleStatus;
  dueDate: string | null;
  payments: { id: number; method: PaymentMethod; amount: number; paidAt: string; kind: PaymentRecord['kind']; userName?: string; reference?: string; notes?: string }[];
  returns: { id: number; at: string; by: string; reason: string; condition: 'RESTOCK' | 'DAMAGED'; value: number; refund: number }[];
  voided: { by: string; reason: string; at: string } | null;
}

/** No cost or profit fields, for any role. */
export async function getSaleDetail(saleId: number): Promise<SaleDetail | null> {
  await ensureFresh();
  const s = sales.find((x) => x.id === saleId);
  if (!s) return delay(null);
  return delay({
    id: s.id,
    receiptNo: s.receiptNo,
    createdAt: s.createdAt,
    userName: s.userName,
    customer: customerOf(s.customerId),
    lines: s.lines.map((l, index) => ({
      index,
      name: l.name,
      qty: l.qty,
      unitPrice: l.unitPrice,
      imei: l.imei,
      returnedQty: returnedQtyOf(s, index),
    })),
    subtotal: s.subtotal,
    discount: s.discount,
    total: s.total,
    returnedValue: returnedValueOf(s),
    netPaid: paidOf(s),
    balance: balanceOf(s),
    status: s.status,
    dueDate: s.dueDate,
    payments: s.payments.map(({ id, method, amount, paidAt, kind, userName, reference, notes }) => ({ id, method, amount, paidAt, kind, userName, reference, notes })),
    returns: (s.returns ?? []).map(({ id, at, by, reason, condition, value, refund }) => ({ id, at, by, reason, condition, value, refund })),
    voided: s.voided ?? null,
  });
}

function snapshotOf(s: SaleRecord): SaleSnapshot {
  return {
    status: s.status,
    subtotal: s.subtotal,
    total: s.total,
    paidNet: paidOf(s),
    returnedValue: returnedValueOf(s),
    lines: s.lines.map((l, i) => ({ qty: l.qty, unitPrice: l.unitPrice, imei: l.imei, returnedQty: returnedQtyOf(s, i) })),
  };
}

/** Put goods back: phones by IMEI, accessories by quantity. Damaged goods do not return to sellable stock. */
function restockLines(s: SaleRecord, items: ReturnItem[], condition: 'RESTOCK' | 'DAMAGED') {
  for (const it of items) {
    const line = s.lines[it.lineIndex];
    if (line.imei) setUnitStatus([line.imei], condition === 'RESTOCK' ? 'IN_SHOP' : 'DAMAGED');
    if (condition === 'RESTOCK') deductShopStock(line.productId, -it.qty, s.id);
  }
}

function refundPayment(s: SaleRecord, amount: number, method: PaymentMethod, by: string): PaymentRecord[] {
  if (amount <= 0) return s.payments;
  const id = Math.max(0, ...s.payments.map((p) => p.id)) + 1;
  return [...s.payments, { id, method, amount: -amount, paidAt: new Date().toISOString(), kind: 'REFUND', userName: by }];
}

export async function voidSale(
  user: { name: string; role: Role },
  req: { saleId: number; reason: string; refundMethod: PaymentMethod },
): Promise<void> {
  if (!isShopPaymentMethod(req.refundMethod)) throw new Error('Njia ya malipo si sahihi. Tumia Cash, Lipa Namba au Bank');
  await ensureFresh();
  const s = sales.find((x) => x.id === req.saleId);
  if (!s) throw new Error('Mauzo hayajapatikana');
  const plan = planVoid(snapshotOf(s), user.role, req.reason);
  if (!plan.ok) {
    await delay(null);
    throw new Error(plan.errors.join('\n'));
  }
  if (isRemote()) {
    return write(async () => {
      await rpc('rpc_void_sale', { payload: { saleId: s.id, reason: req.reason.trim(), refundMethod: req.refundMethod, refund: plan.refund, restock: plan.restock } });
    });
  }
  restockLines(s, plan.restock, 'RESTOCK');
  const next: SaleRecord = {
    ...s,
    status: 'VOID',
    dueDate: null,
    payments: refundPayment(s, plan.refund, req.refundMethod, user.name),
    voided: { by: user.name, reason: req.reason.trim(), at: new Date().toISOString() },
  };
  sales = sales.map((x) => (x.id === s.id ? next : x));
  save('tb4.sales', sales);
  logAudit(user.name, 'SALE_VOID', s.id, `${s.receiptNo}: ${req.reason.trim()} (refund ${plan.refund})`);
  await delay(null);
}

export async function returnItems(
  user: { name: string; role: Role },
  req: { saleId: number; items: ReturnItem[]; reason: string; condition: 'RESTOCK' | 'DAMAGED'; refundMethod: PaymentMethod },
): Promise<{ refund: number }> {
  if (!isShopPaymentMethod(req.refundMethod)) throw new Error('Njia ya malipo si sahihi. Tumia Cash, Lipa Namba au Bank');
  await ensureFresh();
  const s = sales.find((x) => x.id === req.saleId);
  if (!s) throw new Error('Mauzo hayajapatikana');
  const plan = planReturn(snapshotOf(s), req.items, req.reason);
  if (!plan.ok) {
    await delay(null);
    throw new Error(plan.errors.join('\n'));
  }
  if (isRemote()) {
    return write(async () => {
      await rpc('rpc_return_items', {
        payload: { saleId: s.id, items: plan.restock, reason: req.reason.trim(), condition: req.condition, value: plan.value, refund: plan.refund, refundMethod: req.refundMethod },
      });
      return { refund: plan.refund };
    });
  }
  restockLines(s, plan.restock, req.condition);
  const record: ReturnRecord = {
    id: (s.returns ?? []).length + 1,
    at: new Date().toISOString(),
    by: user.name,
    reason: req.reason.trim(),
    condition: req.condition,
    items: plan.restock,
    value: plan.value,
    refund: plan.refund,
  };
  const withReturn: SaleRecord = {
    ...s,
    returns: [...(s.returns ?? []), record],
    payments: refundPayment(s, plan.refund, req.refundMethod, user.name),
  };
  const open = balanceOf(withReturn) > 0;
  const next: SaleRecord = { ...withReturn, status: open ? 'PARTIAL' : 'PAID', dueDate: open ? s.dueDate : null };
  sales = sales.map((x) => (x.id === s.id ? next : x));
  save('tb4.sales', sales);
  logAudit(user.name, 'SALE_RETURN', s.id, `${s.receiptNo}: ${req.reason.trim()} (value ${plan.value}, refund ${plan.refund}, ${req.condition})`);
  await delay(null);
  return { refund: plan.refund };
}
