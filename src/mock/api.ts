/**
 * Mock API. Same shape the real /api routes will return, so pages do not change
 * when the Neon + Drizzle backend is plugged in.
 * Permission rule: cost and profit fields are omitted for sellers (never just hidden in the UI).
 */
import type { ProductType, Role, StockStatus } from '@shared/constants';
import {
  productSchema,
  productUpdateSchema,
  type ProductFormValues,
  type ProductInput,
  type ProductUpdateInput,
} from '@shared/schemas';
import { validateNewProductDuplicates } from '@shared/stock';
import { DEFAULT_SETTINGS, SEED_PRODUCTS, type Settings } from './seed';
import { localUsers } from './users';
import { logAudit } from './audit';
import {
  allImeis,
  getUnitsSnapshot,
  imeisIn,
  registerShopUnits,
  restoreUnitsSnapshot,
} from './inventory';
import { check, ensureFresh, isRemote, rpc, write } from './sync';
import { supabase } from '@/lib/supabase';

/** Local-only latency for the in-memory test engine; with Supabase there is nothing to simulate. */
const delay = <T,>(v: T, ms = 120) => (isRemote() ? Promise.resolve(v) : new Promise<T>((r) => setTimeout(() => r(v), ms)));

const LS_PRODUCTS = 'tb.products';
const LS_SETTINGS = 'tb.settings';

// No browser storage: state lives in memory and, with Supabase, is reloaded from the database (see ./hydrate).
function load<T>(_key: string, fallback: T): T {
  return fallback;
}
function save(_key: string, _value: unknown) {
  /* nothing to persist: the database is the source of truth */
}

const isTestEnvironment = () => typeof process !== 'undefined' && (process.env?.NODE_ENV === 'test' || !!process.env?.VITEST);

var products = load<any[]>(LS_PRODUCTS, isTestEnvironment() ? SEED_PRODUCTS : []);
let settings = load<Settings>(LS_SETTINGS, DEFAULT_SETTINGS);

export function stockStatus(qty: number, min: number): StockStatus {
  if (qty <= 0) return 'IMEISHA';
  if (qty <= min) return 'CHINI';
  return 'IPO';
}

export interface ProductRow {
  id: number;
  name: string;
  detail: string;
  type: ProductType;
  code: string;
  barcode?: string;
  sellPrice: number;
  costPrice?: number; // owner only
  storeQty: number;
  shopQty: number;
  minStock: number;
  storeStatus: StockStatus;
  shopStatus: StockStatus;
  soldThisWeek: number;
  imageUrl?: string;
  archived?: boolean;
  storeImeis: string[];
  shopImeis: string[];
}

/** Replaces the catalog with what the database holds (called by ./hydrate). */
export function hydrateCatalog(nextProducts: any[], nextMovements: Movement[], nextSettings: Settings): void {
  products = nextProducts;
  movements = nextMovements;
  settings = nextSettings;
}

/** Archived products are hidden everywhere except the Products screen, which asks for them with `includeArchived`. */
export async function listProducts(role: Role, opts: { includeArchived?: boolean } = {}): Promise<ProductRow[]> {
  await ensureFresh();
  return delay(
    products.filter((p) => opts.includeArchived || !p.archived).map((p) => {
      const row: ProductRow = {
        id: p.id,
        name: p.name,
        detail: p.detail,
        type: p.type,
        code: p.code,
        barcode: p.barcode,
        sellPrice: p.sellPrice,
        storeQty: p.storeQty,
        shopQty: p.shopQty,
        minStock: p.minStock,
        storeStatus: stockStatus(p.storeQty, p.minStock),
        shopStatus: stockStatus(p.shopQty, p.minStock),
        soldThisWeek: p.soldThisWeek,
        imageUrl: p.imageUrl,
        archived: !!p.archived,
        storeImeis: p.type === 'phone' ? imeisIn('IN_STORE', p.id) : [],
        shopImeis: p.type === 'phone' ? imeisIn('IN_SHOP', p.id) : [],
      };
      if (role === 'owner') row.costPrice = p.costPrice;
      return row;
    }),
  );
}

function generateUniqueCode(name: string, explicitCode?: string): string {
  const cleaned = explicitCode?.trim().toUpperCase();
  if (cleaned) return cleaned;
  const taken = new Set(products.map((p) => p.code.toUpperCase()));
  const base = name.replace(/[^A-Za-z0-9]/g, '').slice(0, 3).toUpperCase() || 'PR';
  if (!taken.has(base)) return base;
  let suffix = 2;
  while (taken.has(`${base}${suffix}`)) suffix++;
  return `${base}${suffix}`;
}

export async function createProduct(
  user: { name: string; role: Role },
  input: ProductFormValues | ProductInput,
  location: 'SHOP' | 'STORE' = 'SHOP',
): Promise<number> {
  const parsed = productSchema.safeParse(input);
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Taarifa za bidhaa si sahihi');
  const data = parsed.data;
  await ensureFresh();

  // Validate against existing records (SKU/code, barcode, IMEIs, and product identity)
  const dupError = validateNewProductDuplicates(data, {
    existingProducts: products,
    knownImeis: allImeis(),
  });
  if (dupError) throw new Error(dupError);

  const code = generateUniqueCode(data.name, data.code);
  const imageUrl = data.imageUrl?.trim() || undefined;
  const barcode = data.barcode?.trim() || undefined;

  if (isRemote()) {
    return write(async () => {
      const newId = await rpc<number>('rpc_create_product', {
        payload: {
          name: data.name,
          detail: data.detail?.trim() ?? '',
          type: data.type,
          code,
          barcode,
          costPrice: data.costPrice,
          sellPrice: data.sellPrice,
          minStock: data.minStock,
          imageUrl,
          initialQty: data.initialShopQty,
          location,
          imeis: data.imeis,
        },
      });
      logAudit(
        user.name,
        'PRODUCT_CREATE',
        Number(newId),
        `${data.name}: kununua ${data.costPrice}, kuuza ${data.sellPrice}, stock ya awali ${location === 'STORE' ? 'store' : 'dukani'} ${data.initialShopQty}`,
      );
      return Number(newId);
    });
  }

  const id = Math.max(0, ...products.map((p) => p.id)) + 1;

  // Transactional snapshot: roll back everything if product creation or initial Shop stock registration fails
  const prevProducts = products.map((p) => ({ ...p }));
  const prevMovements = movements.map((m) => ({ ...m }));
  const prevUnits = getUnitsSnapshot();

  try {
    products = [
      ...products,
      {
        id,
        name: data.name,
        detail: data.detail?.trim() ?? '',
        type: data.type,
        code,
        barcode,
        costPrice: data.costPrice,
        sellPrice: data.sellPrice,
        minStock: data.minStock,
        storeQty: 0,
        shopQty: 0,
        soldThisWeek: 0,
        imageUrl,
      },
    ];
    save(LS_PRODUCTS, products);

    // The mandatory initial quantity goes to the chosen location only; the other location is untouched.
    moveStock({
      productId: id,
      from: null,
      to: location,
      qty: data.initialShopQty,
      type: 'PURCHASE',
      unitCost: data.costPrice,
      refType: 'stock-in',
      userName: user.name,
    });

    if (data.type === 'phone' && data.imeis.length > 0) {
      registerShopUnits(id, data.imeis, location);
    }

    logAudit(
      user.name,
      'PRODUCT_CREATE',
      id,
      `${data.name}: kununua ${data.costPrice}, kuuza ${data.sellPrice}, stock ya awali ${location === 'STORE' ? 'store' : 'dukani'} ${data.initialShopQty}`,
    );
  } catch (err) {
    products = prevProducts;
    movements = prevMovements;
    save(LS_PRODUCTS, products);
    save('tb3.movements', movements);
    restoreUnitsSnapshot(prevUnits);
    throw err;
  }

  return delay(id);
}

export async function updateProduct(
  user: { name: string; role: Role },
  productId: number,
  input: ProductUpdateInput,
): Promise<void> {
  if (user.role !== 'owner') throw new Error('Huna ruhusa ya kuhariri bidhaa');
  await ensureFresh();
  const target = products.find((p) => p.id === productId);
  if (!target) throw new Error('Bidhaa haipo');
  const parsed = productUpdateSchema.safeParse(input);
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Taarifa za bidhaa si sahihi');
  const data = parsed.data;
  const priceChanged = target.costPrice !== data.costPrice || target.sellPrice !== data.sellPrice;
  if (isRemote()) {
    return write(async () => {
      await rpc('rpc_update_product', {
        payload: {
          id: productId,
          name: data.name,
          detail: data.detail?.trim() ?? target.detail,
          type: data.type,
          code: data.code?.trim() ? data.code.trim().toUpperCase() : target.code,
          barcode: data.barcode?.trim() || undefined,
          costPrice: data.costPrice,
          sellPrice: data.sellPrice,
          minStock: data.minStock,
          imageUrl: data.imageUrl !== undefined ? data.imageUrl.trim() || undefined : target.imageUrl,
        },
      });
      logAudit(user.name, priceChanged ? 'PRICE_CHANGE' : 'PRODUCT_CREATE', productId, `${data.name}: kununua ${data.costPrice}, kuuza ${data.sellPrice}`);
    });
  }
  products = products.map((p) =>
    p.id === productId
      ? {
          ...p,
          name: data.name,
          detail: data.detail?.trim() ?? p.detail,
          type: data.type,
          code: data.code?.trim() ? data.code.trim().toUpperCase() : p.code,
          costPrice: data.costPrice,
          sellPrice: data.sellPrice,
          minStock: data.minStock,
          barcode: data.barcode?.trim() || undefined,
          imageUrl: data.imageUrl !== undefined ? data.imageUrl.trim() || undefined : p.imageUrl,
        }
      : p,
  );
  save(LS_PRODUCTS, products);
  logAudit(
    user.name,
    priceChanged ? 'PRICE_CHANGE' : 'PRODUCT_CREATE',
    productId,
    `${data.name}: kununua ${data.costPrice}, kuuza ${data.sellPrice}`,
  );
  await delay(undefined);
}

export async function deleteProduct(user: { name: string; role: Role }, productId: number): Promise<void> {
  if (user.role !== 'owner') throw new Error('Huna ruhusa ya kufuta bidhaa');
  await ensureFresh();
  const target = products.find((p) => p.id === productId);
  if (!target) throw new Error('Bidhaa haipo');
  if (isRemote()) {
    return write(async () => {
      await rpc('rpc_delete_product', { p_id: productId });
      logAudit(user.name, 'PRODUCT_CREATE', productId, `${target.name}: bidhaa imefutwa`);
    });
  }
  products = products.filter((p) => p.id !== productId);
  save(LS_PRODUCTS, products);
  logAudit(user.name, 'PRODUCT_CREATE', productId, `${target.name}: bidhaa imefutwa`);
  await delay(undefined);
}

export async function updateProductImage(
  user: { name: string; role: Role },
  productId: number,
  imageUrl: string | null,
): Promise<void> {
  if (user.role !== 'owner') throw new Error('Huna ruhusa ya kubadilisha picha ya bidhaa');
  await ensureFresh();
  const target = products.find((p) => p.id === productId);
  if (!target) throw new Error('Bidhaa haipo');
  const cleaned = (imageUrl ?? '').trim() || undefined;
  if (cleaned && cleaned.startsWith('data:') && !/^data:image\/(jpeg|jpg|png|webp|svg\+xml)/i.test(cleaned)) {
    throw new Error('Aina ya faili haikubaliki. Tumia JPG, PNG au WEBP.');
  }
  if (isRemote()) {
    return write(async () => {
      await rpc('rpc_update_product_image', { p_id: productId, p_image_url: cleaned ?? '' });
      logAudit(user.name, 'PRODUCT_CREATE', productId, `${target.name}: ${cleaned ? 'picha imehifadhiwa' : 'picha imeondolewa'}`);
    });
  }
  products = products.map((p) => (p.id === productId ? { ...p, imageUrl: cleaned } : p));
  save(LS_PRODUCTS, products);
  logAudit(
    user.name,
    'PRODUCT_CREATE',
    productId,
    `${target.name}: ${cleaned ? 'picha imehifadhiwa' : 'picha imeondolewa'}`,
  );
  await delay(undefined);
}

/** Hides a product (or brings it back) without touching its sales history or stock. */
export async function archiveProduct(user: { name: string; role: Role }, productId: number, archived: boolean): Promise<void> {
  if (user.role !== 'owner') throw new Error('Huna ruhusa ya kustaafisha bidhaa');
  await ensureFresh();
  const target = products.find((p) => p.id === productId);
  if (!target) throw new Error('Bidhaa haipo');
  if (isRemote()) {
    return write(async () => {
      await rpc('rpc_archive_product', { p_id: productId, p_archived: archived });
    });
  }
  products = products.map((p) => (p.id === productId ? { ...p, archived } : p));
  logAudit(user.name, 'PRODUCT_CREATE', productId, `${target.name}: ${archived ? 'imestaafishwa' : 'imerudishwa'}`);
  await delay(undefined);
}

export async function getSettings(): Promise<Settings> {
  await ensureFresh();
  return delay(settings);
}

export async function saveSettings(user: { name: string; role: Role }, next: Settings): Promise<void> {
  if (user.role !== 'owner') throw new Error('Huna ruhusa ya kubadilisha mipangilio');
  const changed = (Object.keys(next) as (keyof Settings)[]).filter((k) => next[k] !== settings[k]);
  if (isRemote()) {
    await ensureFresh();
    return write(async () => {
      const diff = (Object.keys(next) as (keyof Settings)[]).filter((k) => next[k] !== settings[k]);
      check(
        await supabase
          .from('settings')
          .update({
            shop_name: next.shopName,
            shop_phone: next.shopPhone,
            shop_address: next.shopAddress,
            receipt_footer: next.receiptFooter,
            sms_daily: next.smsDaily,
            sms_purchase: next.smsPurchase,
            sms_debt_payment: next.smsDebtPayment,
            sms_reminders: next.smsReminders,
            daily_time: next.dailyTime,
            owner_phone: next.ownerPhone,
            default_min_stock: next.defaultMinStock,
            printer_width: next.printerWidth,
            max_discount_pct: next.maxDiscountPct,
            updated_at: new Date().toISOString(),
          })
          .eq('id', 1),
      );
      if (diff.length) logAudit(user.name, 'SETTINGS_CHANGE', null, diff.map((k) => `${k}: ${String(settings[k])} → ${String(next[k])}`).join('; '));
    });
  }
  if (changed.length) logAudit(user.name, 'SETTINGS_CHANGE', null, changed.map((k) => `${k}: ${String(settings[k])} → ${String(next[k])}`).join('; '));
  settings = next;
  save(LS_SETTINGS, settings);
  await delay(undefined);
}

export async function listUsers(role: Role) {
  if (role !== 'owner') throw new Error('Huna ruhusa');
  await ensureFresh();
  return localUsers.list();
}

export interface ShopDashboard {
  salesToday: number;
  salesTrendPct: number;
  netProfitToday?: number; // owner only
  profitTrendPct?: number; // owner only
  salesCount: number;
  salesCountDelta: number;
  expensesToday: number;
  totalDebt: number;
  debtorCount: number;
  week: number[];
  weekProfit?: number[];
  weekExpenses?: number[];
  weekTotal: number;
  topProducts: { name: string; sub: string; soldPct: number; sold: number }[];
  debtors: { id: number; name: string; item: string; since: string; amount: number; tag: { kind: string; label: string } }[];
}

export interface StoreDashboard {
  stockValue?: number; // owner only
  itemCount: number;
  phoneCount: number;
  accessoryCount: number;
  receivedValue: number;
  receivedCount: number;
  lowStockCount: number;
  receipts: never[];
  transfers: never[];
}

export async function getStoreDashboard(role: Role): Promise<StoreDashboard> {
  await ensureFresh();
  const phones = products.filter((p) => p.type === 'phone').reduce((s, p) => s + p.storeQty, 0);
  const acc = products.filter((p) => p.type === 'accessory').reduce((s, p) => s + p.storeQty, 0);
  const data: StoreDashboard = {
    itemCount: phones + acc,
    phoneCount: phones,
    accessoryCount: acc,
    // Receipts and transfers now come from the real records (getStoreFeed / listStockEvents); no sample figures here.
    receivedValue: 0,
    receivedCount: 0,
    lowStockCount: products.filter((p) => stockStatus(p.storeQty, p.minStock) !== 'IPO').length,
    receipts: [],
    transfers: [],
  };
  if (role === 'owner') data.stockValue = products.reduce((s, p) => s + p.storeQty * p.costPrice, 0);
  return delay(data);
}

/** Internal (server-side) helpers for the mock sales module. Never returned to the UI as-is. */
export function internalProducts() {
  if (!products) products = load(LS_PRODUCTS, SEED_PRODUCTS);
  return products.map((p) => ({ ...p }));
}

export type Loc = 'STORE' | 'SHOP';
export type MovementType = 'PURCHASE' | 'TRANSFER' | 'SALE' | 'RETURN' | 'ADJUSTMENT' | 'DAMAGE';
export interface Movement {
  id: number;
  at: string;
  productId: number;
  from: Loc | null;
  to: Loc | null;
  qty: number;
  type: MovementType;
  unitCost?: number;
  refType?: string;
  refId?: number;
  userName?: string;
  note?: string;
}
let movements = load<Movement[]>('tb3.movements', []);

/**
 * The only way stock changes: every change is an append-only movement.
 * Throws (and changes nothing) if the source would go below zero.
 */
export function moveStock(m: Omit<Movement, 'id' | 'at'>): void {
  if (!Number.isInteger(m.qty) || m.qty <= 0) throw new Error('Idadi si sahihi');
  const p = products.find((x) => x.id === m.productId);
  if (!p) throw new Error('Bidhaa haipo');
  const field = (l: Loc) => (l === 'STORE' ? 'storeQty' : 'shopQty');
  if (m.from && p[field(m.from)] < m.qty) throw new Error(`${p.name}: stock haitoshi`);
  products = products.map((x) => {
    if (x.id !== m.productId) return x;
    const next = { ...x };
    if (m.from) next[field(m.from)] -= m.qty;
    if (m.to) next[field(m.to)] += m.qty;
    if (m.type === 'PURCHASE' && typeof m.unitCost === 'number' && m.unitCost > 0) {
      next.costPrice = m.unitCost;
    }
    return next;
  });
  movements = [...movements, { ...m, id: movements.length + 1, at: new Date().toISOString() }];
  save(LS_PRODUCTS, products);
  save('tb3.movements', movements);
}

/** Sale (qty > 0) takes from the shop; a restocked return (qty < 0) puts back. */
export function deductShopStock(productId: number, qty: number, refId?: number, userName?: string): void {
  if (qty > 0) moveStock({ productId, from: 'SHOP', to: null, qty, type: 'SALE', refType: 'sale', refId, userName });
  else moveStock({ productId, from: null, to: 'SHOP', qty: -qty, type: 'RETURN', refType: 'sale', refId, userName });
  products = products.map((p) => (p.id === productId ? { ...p, soldThisWeek: Math.max(0, p.soldThisWeek + qty) } : p));
  save(LS_PRODUCTS, products);
}

export async function listMovements(limit = 100): Promise<(Movement & { productName: string })[]> {
  await ensureFresh();
  const names = new Map(products.map((p) => [p.id, p.name]));
  return delay(
    [...movements]
      .reverse()
      .slice(0, limit)
      .map((m) => ({ ...m, productName: names.get(m.productId) ?? '?' })),
  );
}

export function currentSettings(): Settings {
  return settings;
}
