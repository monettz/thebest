/**
 * Loads every table from Supabase into the in-memory engine (the cache the business rules run on).
 * Called through ./sync (`ensureFresh` before reads, `commit` after writes). Rows keep the database ids,
 * so ids on screen always match what the server holds.
 */
import type { PaymentMethod, ProductType } from '@shared/constants';
import { todayDar } from '@/lib/dar';
import { supabase } from '@/lib/supabase';
import { userNumId } from '@/lib/ids';
import { DEFAULT_SETTINGS, type Settings } from './seed';
import { hydrateCatalog, type Movement } from './api';
import { hydrateInventory } from './inventory';
import { hydrateSales, type SaleRecord, type Customer } from './sales';
import { hydrateLedger } from './ledger';
import { hydrateStockTakes } from './stocktake';
import { hydrateUsers } from './users';
import { hydrateAudit, type AuditAction } from './audit';
import { hydrateSms } from './sms';
import { setLoader } from './sync';

type Row = Record<string, any>;

const PAGE = 1000;

/** PostgREST returns at most 1000 rows per request, so read pages until one comes back short. */
async function all(table: string, columns: string, order = 'id'): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.from(table).select(columns).order(order, { ascending: true }).range(from, from + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    const rows = (data ?? []) as unknown as Row[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

async function optional(fn: () => Promise<Row[]>): Promise<Row[]> {
  try {
    return await fn();
  } catch {
    return [];
  }
}

function emptyAll(): void {
  hydrateCatalog([], [], DEFAULT_SETTINGS);
  hydrateInventory({ units: [], suppliers: [], purchases: [], payments: [], transfers: [] });
  hydrateSales([], []);
  hydrateLedger([], []);
  hydrateStockTakes([]);
  hydrateUsers([]);
  hydrateAudit([]);
  hydrateSms([]);
}

/** Wipes the in-memory copy (on sign-out, so the next user never sees the previous user's data). */
export const clearAll = emptyAll;

const toSettings = (r: Row | undefined): Settings =>
  r
    ? {
        shopName: r.shop_name,
        shopPhone: r.shop_phone ?? '',
        shopAddress: r.shop_address ?? '',
        receiptFooter: r.receipt_footer ?? '',
        smsDaily: r.sms_daily,
        smsPurchase: r.sms_purchase,
        smsDebtPayment: r.sms_debt_payment,
        smsReminders: r.sms_reminders,
        dailyTime: r.daily_time,
        ownerPhone: r.owner_phone ?? '',
        defaultMinStock: r.default_min_stock,
        printerWidth: r.printer_width === '58' ? '58' : '80',
        maxDiscountPct: r.max_discount_pct,
      }
    : DEFAULT_SETTINGS;

async function loadAll(): Promise<void> {
  const { data: sess } = await supabase.auth.getSession();
  if (!sess.session) {
    emptyAll();
    return;
  }

  const [
    productRows, movementRows, settingsRows, unitRows, supplierRows, paymentRows, transferRows, customerRows,
    saleRows, itemRows, payRows, returnRows, expenseRows, closingRows, takeRows, profileRows, auditRows, smsRows,
    purchasesRes, costsRes,
  ] = await Promise.all([
    all('products_view', 'id,name,detail,type,code,barcode,sell_price,min_stock,image_url,store_qty,shop_qty,archived'),
    all('stock_movements', 'id,product_id,from_location,to_location,qty,type,ref_type,ref_id,user_name,note,created_at'),
    all('settings', '*'),
    all('inventory_units', 'id,imei,product_id,status'),
    all('suppliers', 'id,name,phone,notes'),
    optional(() => all('supplier_payments', 'id,supplier_id,purchase_id,amount,method,user_name,paid_at')),
    all('transfers', 'id,user_name,note,items,created_at'),
    all('customers', 'id,name,phone,area,id_number,notes,created_at'),
    all('sales', 'id,receipt_no,user_name,customer_id,subtotal,discount,total,due_date,status,voided_by,void_reason,voided_at,created_at'),
    all('sale_items', 'id,sale_id,product_id,name,qty,unit_price,imei,returned_qty'),
    all('payments', 'id,sale_id,method,amount,kind,user_name,reference,idempotency_key,paid_at'),
    all('sale_returns', 'id,sale_id,by_user,reason,condition,value,refund_amount,items,created_at'),
    all('expenses', 'id,category,amount,description,method,spent_on,user_name,idempotency_key'),
    all('cash_closings', 'id,closing_date,user_name,expected_cash,counted_cash,difference,note'),
    all('stock_takes', 'id,location,status,created_by,approved_by,approved_at,lines,created_at'),
    all('profiles', 'id,phone,full_name,role,is_active,created_at', 'created_at'),
    optional(() => all('audit_logs', 'id,user_name,action,subject_id,detail,created_at')),
    optional(() => all('sms_logs', 'id,to_phone,body,type,status,dedupe_key,created_at')),
    supabase.rpc('rpc_purchases'),
    supabase.rpc('rpc_owner_costs'), // owner only: a seller gets an error here and simply sees no cost data
  ]);

  const productCost = new Map<number, number>();
  const itemCost = new Map<number, number>();
  if (!costsRes.error && costsRes.data) {
    const c = costsRes.data as { products: [number, number][]; saleItems: [number, number][] };
    for (const [id, cost] of c.products) productCost.set(Number(id), Number(cost));
    for (const [id, cost] of c.saleItems) itemCost.set(Number(id), Number(cost));
  }
  if (purchasesRes.error) throw new Error(`purchases: ${purchasesRes.error.message}`);

  /* ---- customers ---- */
  const customers: Customer[] = customerRows.map((c) => ({
    id: Number(c.id),
    name: c.name,
    phone: c.phone ?? '',
    area: c.area ?? undefined,
    notes: c.notes ?? undefined,
    idNumber: c.id_number ?? undefined,
    createdAt: c.created_at,
  }));

  /* ---- sales (lines, payments, returns) ---- */
  const itemsBySale = new Map<number, Row[]>();
  for (const it of itemRows) (itemsBySale.get(Number(it.sale_id)) ?? itemsBySale.set(Number(it.sale_id), []).get(Number(it.sale_id))!).push(it);
  const paysBySale = new Map<number, Row[]>();
  for (const p of payRows) {
    if (p.sale_id == null) continue;
    (paysBySale.get(Number(p.sale_id)) ?? paysBySale.set(Number(p.sale_id), []).get(Number(p.sale_id))!).push(p);
  }
  const returnsBySale = new Map<number, Row[]>();
  for (const r of returnRows) (returnsBySale.get(Number(r.sale_id)) ?? returnsBySale.set(Number(r.sale_id), []).get(Number(r.sale_id))!).push(r);

  const sales: SaleRecord[] = saleRows.map((s) => {
    const id = Number(s.id);
    const record: SaleRecord = {
      id,
      receiptNo: s.receipt_no,
      createdAt: s.created_at,
      userName: s.user_name,
      customerId: s.customer_id == null ? null : Number(s.customer_id),
      lines: (itemsBySale.get(id) ?? []).map((l) => ({
        productId: Number(l.product_id),
        name: l.name,
        qty: Number(l.qty),
        unitPrice: Number(l.unit_price),
        unitCost: itemCost.get(Number(l.id)) ?? 0,
        imei: l.imei ?? undefined,
      })),
      subtotal: Number(s.subtotal),
      discount: Number(s.discount),
      total: Number(s.total),
      payments: (paysBySale.get(id) ?? []).map((p) => ({
        id: Number(p.id),
        method: p.method as PaymentMethod,
        amount: Number(p.amount),
        paidAt: p.paid_at,
        kind: p.kind,
        userName: p.user_name ?? undefined,
        reference: p.reference ?? undefined,
        key: p.idempotency_key ?? undefined,
      })),
      dueDate: s.due_date ?? null,
      status: s.status,
    };
    const rets = returnsBySale.get(id);
    if (rets?.length) {
      record.returns = rets.map((r) => ({
        id: Number(r.id),
        at: r.created_at,
        by: r.by_user,
        reason: r.reason,
        condition: r.condition,
        items: (r.items ?? []) as { lineIndex: number; qty: number }[],
        value: Number(r.value),
        refund: Number(r.refund_amount),
      }));
    }
    if (s.status === 'VOID') record.voided = { by: s.voided_by ?? '', reason: s.void_reason ?? '', at: s.voided_at ?? s.created_at };
    return record;
  });

  /* ---- products (sold-this-week comes from the sales just built) ---- */
  const weekAgo = todayDar(new Date(Date.now() - 6 * 86_400_000));
  const soldWeek = new Map<number, number>();
  for (const s of sales) {
    if (s.status === 'VOID' || todayDar(new Date(s.createdAt)) < weekAgo) continue;
    for (const l of s.lines) soldWeek.set(l.productId, (soldWeek.get(l.productId) ?? 0) + l.qty);
  }
  const products = productRows.map((p) => ({
    id: Number(p.id),
    name: p.name,
    detail: p.detail ?? '',
    type: p.type as ProductType,
    code: p.code,
    barcode: p.barcode ?? undefined,
    costPrice: productCost.get(Number(p.id)) ?? 0,
    sellPrice: Number(p.sell_price),
    minStock: Number(p.min_stock),
    storeQty: Number(p.store_qty),
    shopQty: Number(p.shop_qty),
    soldThisWeek: soldWeek.get(Number(p.id)) ?? 0,
    imageUrl: p.image_url ?? undefined,
    archived: !!p.archived,
  }));

  const movements: Movement[] = movementRows.map((m) => ({
    id: Number(m.id),
    at: m.created_at,
    productId: Number(m.product_id),
    from: m.from_location,
    to: m.to_location,
    qty: Number(m.qty),
    type: m.type,
    refType: m.ref_type ?? undefined,
    refId: m.ref_id == null ? undefined : Number(m.ref_id),
    userName: m.user_name ?? undefined,
    note: m.note ?? undefined,
  }));

  hydrateCatalog(products, movements, toSettings(settingsRows[0]));

  hydrateInventory({
    units: unitRows.map((u) => ({ imei: u.imei, productId: Number(u.product_id), status: u.status })),
    suppliers: supplierRows.map((s) => ({ id: Number(s.id), name: s.name, phone: s.phone ?? '', notes: s.notes ?? undefined })),
    purchases: ((purchasesRes.data ?? []) as Row[]).map((p) => ({
      id: Number(p.id),
      supplierId: p.supplierId == null ? null : Number(p.supplierId),
      location: p.location,
      invoiceNo: p.invoiceNo,
      date: p.date,
      total: Number(p.total),
      userName: p.userName,
      lines: ((p.lines ?? []) as Row[]).map((l) => ({ productId: Number(l.productId), name: l.name, qty: Number(l.qty), unitCost: Number(l.unitCost ?? 0) })),
    })),
    payments: paymentRows.map((p) => ({
      id: Number(p.id),
      supplierId: Number(p.supplier_id),
      purchaseId: p.purchase_id == null ? null : Number(p.purchase_id),
      amount: Number(p.amount),
      method: p.method as PaymentMethod,
      paidAt: p.paid_at,
      userName: p.user_name,
    })),
    transfers: transferRows.map((t) => ({
      id: Number(t.id),
      at: t.created_at,
      userName: t.user_name,
      note: t.note ?? '',
      items: ((t.items ?? []) as Row[]).map((i) => ({ productId: Number(i.productId), name: i.name, qty: Number(i.qty), imeis: (i.imeis ?? []) as string[] })),
    })),
  });

  hydrateSales(customers, sales);

  hydrateLedger(
    expenseRows.map((e) => ({
      id: Number(e.id),
      category: e.category,
      amount: Number(e.amount),
      description: e.description ?? '',
      method: e.method as PaymentMethod,
      spentOn: e.spent_on,
      userName: e.user_name,
      key: e.idempotency_key ?? undefined,
    })),
    closingRows.map((c) => ({
      id: Number(c.id),
      userName: c.user_name,
      date: c.closing_date,
      expected: Number(c.expected_cash),
      counted: Number(c.counted_cash),
      difference: Number(c.difference),
      note: c.note ?? '',
    })),
  );

  hydrateStockTakes(
    takeRows.map((t) => ({
      id: Number(t.id),
      location: t.location,
      status: t.status,
      createdBy: t.created_by,
      createdAt: t.created_at,
      approvedBy: t.approved_by ?? undefined,
      approvedAt: t.approved_at ?? undefined,
      lines: (t.lines ?? []) as any[],
    })),
  );

  hydrateUsers(
    profileRows.map((u) => ({
      uuid: u.id as string,
      id: userNumId(u.id),
      name: u.full_name,
      phone: u.phone,
      role: u.role,
      isActive: u.is_active,
      createdAt: u.created_at,
    })),
  );

  hydrateAudit(
    auditRows.map((a) => ({
      id: Number(a.id),
      at: a.created_at,
      userName: a.user_name,
      action: a.action as AuditAction,
      subjectId: a.subject_id != null && /^\d+$/.test(a.subject_id) ? Number(a.subject_id) : null,
      detail: a.detail,
    })),
  );

  hydrateSms(
    smsRows.map((l) => ({
      id: Number(l.id),
      to: l.to_phone,
      body: l.body,
      type: l.type,
      status: l.status,
      dedupeKey: l.dedupe_key ?? undefined,
      sentAt: l.created_at,
    })),
  );
}

setLoader(loadAll);
