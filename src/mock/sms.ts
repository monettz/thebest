/**
 * SMS service. Uses the same SmsGateway + dispatchSms as the production API. Every send is written to
 * the sms_logs table; sending itself goes through the LogDriver unless an HTTP SMS service is configured.
 */
import type { Role } from '@shared/constants';
import { LogDriver, createGateway, dispatchSms, type DispatchStatus, type SmsLogEntry, type SmsLogStore, type SmsType } from '@shared/sms';
import { supabase } from '@/lib/supabase';
import { ensureFresh, isRemote } from './sync';

export interface StoredSms extends SmsLogEntry {
  id: number;
}

let logs: StoredSms[] = [];

export function hydrateSms(next: StoredSms[]): void {
  logs = next;
}

const store: SmsLogStore = {
  has: (key) => logs.some((l) => l.dedupeKey === key && l.status === 'SENT'),
  add: (entry) => {
    logs = [...logs, { ...entry, id: logs.length + 1 }];
    if (isRemote()) {
      void supabase
        .from('sms_logs')
        .insert({ to_phone: entry.to, body: entry.body, type: entry.type, status: entry.status, dedupe_key: entry.dedupeKey ?? null })
        .then(({ error }) => {
          if (error && error.code !== '23505') console.warn('SMS log write failed:', error.message);
        });
    }
  },
};

/** A real SMS service is configured only when the HTTP driver and its endpoint/key are set in the environment. */
const env = import.meta.env as Record<string, string | undefined>;
export const isSmsConfigured = (): boolean => env.VITE_SMS_DRIVER === 'http' && !!env.VITE_SMS_API_URL && !!env.VITE_SMS_API_KEY;
const gateway = isSmsConfigured()
  ? createGateway({ SMS_DRIVER: 'http', SMS_API_URL: env.VITE_SMS_API_URL, SMS_API_KEY: env.VITE_SMS_API_KEY, SMS_SENDER_ID: env.VITE_SMS_SENDER_ID })
  : new LogDriver();
export const hasSentSms = (dedupeKey: string): boolean => store.has(dedupeKey);

export function sendSms(msg: { to: string; body: string; type: SmsType; dedupeKey?: string }): Promise<DispatchStatus> {
  return dispatchSms(gateway, store, msg);
}

export async function listSmsLogs(role: Role, limit = 12): Promise<StoredSms[]> {
  if (role !== 'owner') throw new Error('Mmiliki tu ndiye anaweza kuona historia ya SMS');
  await ensureFresh();
  return [...logs].reverse().slice(0, limit);
}
