/** Append-only audit log. Owner reads it; every sensitive change writes one entry. */
import type { Role } from '@shared/constants';
import { supabase } from '@/lib/supabase';
import { check, ensureFresh, isRemote, queueWrite } from './sync';

export type AuditAction =
  | 'SALE_VOID'
  | 'SALE_RETURN'
  | 'SALE_BACKDATED'
  | 'DISCOUNT_OVER_LIMIT'
  | 'SETTINGS_CHANGE'
  | 'PRODUCT_CREATE'
  | 'PRICE_CHANGE'
  | 'CASH_CLOSING'
  | 'STOCK_TAKE_APPROVED'
  | 'DEBT_PAYMENT'
  | 'CUSTOMER_CREATE'
  | 'CUSTOMER_UPDATE'
  | 'USER_CREATE'
  | 'USER_UPDATE';

export const AUDIT_LABEL: Record<AuditAction, string> = {
  SALE_VOID: 'Kufuta mauzo',
  SALE_RETURN: 'Kurudisha bidhaa',
  SALE_BACKDATED: 'Mauzo ya tarehe iliyopita',
  DISCOUNT_OVER_LIMIT: 'Punguzo kubwa',
  SETTINGS_CHANGE: 'Mipangilio',
  PRODUCT_CREATE: 'Bidhaa mpya',
  PRICE_CHANGE: 'Mabadiliko ya bei',
  CASH_CLOSING: 'Kufunga siku',
  STOCK_TAKE_APPROVED: 'Idhini ya kuhesabu stock',
  DEBT_PAYMENT: 'Malipo ya deni',
  CUSTOMER_CREATE: 'Mteja mpya',
  CUSTOMER_UPDATE: 'Kubadilisha mteja',
  USER_CREATE: 'Mtumiaji mpya',
  USER_UPDATE: 'Kubadilisha mtumiaji',
};

export interface AuditEntry {
  id: number;
  at: string;
  userName: string;
  action: AuditAction;
  subjectId: number | null;
  detail: string;
}

/** Actions the database functions already write to audit_logs themselves (never log them twice). */
const LOGGED_BY_DATABASE = new Set<AuditAction>([
  'SALE_VOID',
  'SALE_RETURN',
  'SALE_BACKDATED',
  'DISCOUNT_OVER_LIMIT',
  'CASH_CLOSING',
  'STOCK_TAKE_APPROVED',
  'DEBT_PAYMENT',
  'USER_CREATE',
  'USER_UPDATE',
]);

let entries: AuditEntry[] = [];

export function hydrateAudit(next: AuditEntry[]): void {
  entries = next;
}

export function logAudit(userName: string, action: AuditAction, subjectId: number | null, detail: string): void {
  if (isRemote()) {
    if (LOGGED_BY_DATABASE.has(action)) return;
    queueWrite(async () => {
      check(await supabase.from('audit_logs').insert({ user_name: userName, action, subject_id: subjectId == null ? null : String(subjectId), detail }));
    });
    return;
  }
  entries = [...entries, { id: entries.length + 1, at: new Date().toISOString(), userName, action, subjectId, detail }];
}

export async function listAudit(role: Role): Promise<AuditEntry[]> {
  if (role !== 'owner') throw new Error('Mmiliki tu ndiye anaweza kuona kumbukumbu hizi');
  await ensureFresh();
  return [...entries].reverse();
}
