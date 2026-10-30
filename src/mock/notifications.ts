/**
 * Notifications (temporary, local).
 *
 * Nothing here is stored as a notification row. Every item is DERIVED from live records (stock levels,
 * receipts, transfers, debts), so the list can never disagree with the pages it links to. Only the
 * "read" flags are saved, per user, in this browser.
 *
 * For the database build: keep `listNotifications` as a query over the same tables, and move
 * `readIds` / `markRead` to a `notification_reads(user_id, notification_id)` table. The UI only uses
 * the functions exported below.
 */
import type { Role } from '@shared/constants';
import { addDays } from '@shared/debts';
import { todayDar } from '@/lib/dar';
import { listProducts } from './api';
import { listStockEvents } from './inventory';
import { getDebtOverview } from './sales';

export type NotificationKind = 'OUT_OF_STOCK' | 'LOW_STOCK' | 'RECEIVED' | 'TRANSFERRED' | 'DEBT_OVERDUE';

export interface AppNotification {
  id: string; // stable: the same situation always gets the same id
  kind: NotificationKind;
  title: string;
  detail: string;
  at: string | null; // ISO time when it happened; null for "current state" alerts
  to: string; // page that explains it
  read: boolean;
}

const key = (userId: number) => `tb7.notif-read.${userId}`;

const memory = new Map<number, Set<string>>(); // used when browser storage is unavailable

function readIds(userId: number): Set<string> {
  const mem = memory.get(userId);
  if (mem) return new Set(mem);
  try {
    const raw = localStorage.getItem(key(userId));
    if (raw) return new Set(JSON.parse(raw) as string[]);
  } catch {
    /* nothing read yet */
  }
  return new Set();
}
function writeIds(userId: number, ids: Set<string>) {
  memory.set(userId, new Set(ids));
  try {
    localStorage.setItem(key(userId), JSON.stringify([...ids].slice(-400)));
  } catch {
    /* kept for this visit only */
  }
}

export function markRead(userId: number, ids: string[]): void {
  const set = readIds(userId);
  for (const id of ids) set.add(id);
  writeIds(userId, set);
}

export async function listNotifications(user: { id: number; role: Role }): Promise<AppNotification[]> {
  const read = readIds(user.id);
  const out: Omit<AppNotification, 'read'>[] = [];

  // Stock alerts. The id carries status and quantity, so a product that is restocked and later runs
  // low again raises a fresh, unread alert.
  const products = await listProducts(user.role);
  for (const p of products) {
    for (const loc of ['STORE', 'SHOP'] as const) {
      const status = loc === 'STORE' ? p.storeStatus : p.shopStatus;
      if (status === 'IPO') continue;
      const qty = loc === 'STORE' ? p.storeQty : p.shopQty;
      const where = loc === 'STORE' ? 'Store' : 'Dukani';
      out.push({
        id: `stock:${loc}:${p.id}:${status}:${qty}`,
        kind: status === 'IMEISHA' ? 'OUT_OF_STOCK' : 'LOW_STOCK',
        title: status === 'IMEISHA' ? `${p.name} imeisha ${where === 'Store' ? 'store' : 'dukani'}` : `${p.name} inaisha ${where === 'Store' ? 'store' : 'dukani'}`,
        detail: status === 'IMEISHA' ? `${where}: 0 · kiwango cha chini ${p.minStock}` : `${where}: zimebaki ${qty} · kiwango cha chini ${p.minStock}`,
        at: null,
        to: loc === 'STORE' ? '/store' : '/products',
      });
    }
  }

  // Overdue debts: only debts that have a recorded due date and are past it.
  const debts = await getDebtOverview();
  const late = debts.rows.filter((r) => r.status === 'OVERDUE');
  if (late.length > 0) {
    out.push({
      id: `debts-overdue:${late.map((r) => `${r.saleId}-${r.balance}`).join(',')}`,
      kind: 'DEBT_OVERDUE',
      title: late.length === 1 ? 'Deni 1 limepita tarehe' : `Madeni ${late.length} yamepita tarehe`,
      detail: `Jumla TSh ${Math.round(debts.overdueTotal).toLocaleString('en-US')}`,
      at: null,
      to: '/debts?filter=overdue',
    });
  }

  // Recent stock movements (last 7 days).
  const since = addDays(todayDar(), -7);
  for (const e of listStockEvents(20)) {
    if (todayDar(new Date(e.at)) < since) continue;
    out.push(
      e.kind === 'RECEIVED'
        ? { id: `recv:${e.id}`, kind: 'RECEIVED', title: `Mzigo umepokelewa ${e.location === 'STORE' ? 'store' : 'dukani'}`, detail: `${e.title} · vipande ${e.qty} · ${e.by}`, at: e.at, to: '/store/movements' }
        : { id: `xfer:${e.id}`, kind: 'TRANSFERRED', title: 'Stock imehamishwa kutoka Store kwenda Dukani', detail: `${e.title} · vipande ${e.qty} · ${e.by}`, at: e.at, to: '/store/movements' },
    );
  }

  const rank: Record<NotificationKind, number> = { OUT_OF_STOCK: 0, DEBT_OVERDUE: 1, LOW_STOCK: 2, RECEIVED: 3, TRANSFERRED: 3 };
  return out
    .map((n) => ({ ...n, read: read.has(n.id) }))
    .sort((a, b) => rank[a.kind] - rank[b.kind] || (b.at ?? '').localeCompare(a.at ?? ''));
}
