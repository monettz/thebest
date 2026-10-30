/**
 * Mock stock take: a seller counts and submits, the owner approves.
 * Approval turns each difference into an ADJUSTMENT movement (via moveStock), never an overwrite.
 */
import type { Role } from '@shared/constants';
import {
  COUNT_REASON_LABEL,
  difference,
  planApproval,
  shortageValue,
  validateCount,
  type CountLine,
} from '@shared/stocktake';
import { internalProducts, moveStock, type Loc } from './api';
import { logAudit } from './audit';
import { imeisIn, setUnitStatus } from './inventory';
import { ensureFresh, isRemote, rpc, write } from './sync';

const delay = <T,>(v: T, ms = 120) => (isRemote() ? Promise.resolve(v) : new Promise<T>((r) => setTimeout(() => r(v), ms)));

export type TakeStatus = 'SUBMITTED' | 'APPROVED';
interface StockTake {
  id: number;
  location: Loc;
  status: TakeStatus;
  createdBy: string;
  createdAt: string;
  approvedBy?: string;
  approvedAt?: string;
  lines: CountLine[];
}

let takes: StockTake[] = [];
export function hydrateStockTakes(next: StockTake[]): void {
  takes = next;
}
const persist = () => {
  /* nothing to persist: the database is the source of truth */
};

const qtyAt = (p: { storeQty: number; shopQty: number }, loc: Loc) => (loc === 'STORE' ? p.storeQty : p.shopQty);

/** Every product with what the system says is at this location; counted starts equal to it. */
export async function getCountSheet(location: Loc): Promise<CountLine[]> {
  await ensureFresh();
  return delay(
    internalProducts().filter((p) => !p.archived).map((p) => ({
      productId: p.id,
      name: p.name,
      type: p.type,
      systemQty: qtyAt(p, location),
      countedQty: qtyAt(p, location),
      systemImeis: p.type === 'phone' ? imeisIn(location === 'STORE' ? 'IN_STORE' : 'IN_SHOP', p.id) : undefined,
    })),
    60,
  );
}

export async function submitStockTake(user: { name: string }, req: { location: Loc; lines: CountLine[] }): Promise<{ id: number }> {
  const errors = validateCount(req.lines);
  if (errors.length) {
    await delay(null);
    throw new Error(errors.join('\n'));
  }
  if (isRemote()) {
    return write(async () => {
      const id = await rpc<number>('rpc_submit_stock_take', { payload: { location: req.location, lines: req.lines } });
      return { id: Number(id) };
    });
  }
  const id = Math.max(0, ...takes.map((t) => t.id)) + 1;
  takes = [...takes, { id, location: req.location, status: 'SUBMITTED', createdBy: user.name, createdAt: new Date().toISOString(), lines: req.lines }];
  persist();
  return delay({ id });
}

export interface StockTakeRow {
  id: number;
  location: Loc;
  status: TakeStatus;
  createdBy: string;
  createdAt: string;
  approvedBy?: string;
  differences: number;
  lines: CountLine[]; // only the lines that differ
  shortage?: number; // owner only: value of what is missing, at cost
}

export async function listStockTakes(role: Role): Promise<StockTakeRow[]> {
  await ensureFresh();
  const costs = Object.fromEntries(internalProducts().map((p) => [p.id, p.costPrice]));
  return delay(
    [...takes]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 10)
      .map((t) => {
        const diff = t.lines.filter((l) => difference(l) !== 0);
        const row: StockTakeRow = {
          id: t.id,
          location: t.location,
          status: t.status,
          createdBy: t.createdBy,
          createdAt: t.createdAt,
          approvedBy: t.approvedBy,
          differences: diff.length,
          lines: diff.map(({ systemImeis: _unused, ...l }) => l),
        };
        if (role === 'owner') row.shortage = shortageValue(t.lines, costs);
        return row;
      }),
  );
}

export async function approveStockTake(user: { name: string; role: Role }, id: number): Promise<void> {
  if (user.role !== 'owner') throw new Error('Mmiliki tu ndiye anaweza kuidhinisha');
  await ensureFresh();
  const take = takes.find((t) => t.id === id);
  if (!take) throw new Error('Hesabu haipatikani');
  if (take.status === 'APPROVED') throw new Error('Hesabu hii imeshaidhinishwa');

  const products = internalProducts();
  const current = Object.fromEntries(products.map((p) => [p.id, qtyAt(p, take.location)]));
  const plan = planApproval(take.lines, current);
  if (!plan.ok) {
    await delay(null);
    throw new Error(plan.errors.join('\n'));
  }
  if (isRemote()) {
    return write(async () => {
      await rpc('rpc_approve_stock_take', {
        payload: {
          takeId: take.id,
          adjustments: plan.adjustments.map((a) => ({
            productId: a.productId,
            delta: a.delta,
            note: COUNT_REASON_LABEL[a.reason],
            missingImeis: a.missingImeis,
          })),
        },
      });
    });
  }
  for (const a of plan.adjustments) {
    moveStock({
      productId: a.productId,
      from: a.delta < 0 ? take.location : null,
      to: a.delta > 0 ? take.location : null,
      qty: Math.abs(a.delta),
      type: 'ADJUSTMENT',
      refType: 'stock_take',
      refId: take.id,
      userName: user.name,
      note: COUNT_REASON_LABEL[a.reason],
    });
    if (a.missingImeis.length) setUnitStatus(a.missingImeis, 'DAMAGED');
  }
  take.status = 'APPROVED';
  take.approvedBy = user.name;
  take.approvedAt = new Date().toISOString();
  takes = [...takes];
  persist();
  logAudit(user.name, 'STOCK_TAKE_APPROVED', take.id, `${take.location === 'STORE' ? 'Store' : 'Duka'}: marekebisho ${plan.adjustments.length} (${plan.adjustments.map((a) => `${a.name} ${a.delta > 0 ? '+' : ''}${a.delta}`).join(', ') || 'hakuna tofauti'})`);

  await delay(null);
}
