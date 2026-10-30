/**
 * Supabase ndiyo chanzo pekee cha data. Moduli za `src/mock/*` zinashikilia nakala ya kumbukumbu
 * (cache) ya rekodi za DB ili sheria za biashara zifanye kazi kwa kasi; nakala hiyo inapakiwa kutoka
 * Supabase (`ensureFresh`) na kila mabadiliko yanapitia RPC kisha `commit()` inapakia upya.
 * Majaribio (vitest) hayana DB: `isRemote()` ni false na injini inafanya kazi kumbukumbuni.
 */
import { supabase } from '@/lib/supabase';

export const isRemote = (): boolean =>
  !(typeof process !== 'undefined' && (process.env?.NODE_ENV === 'test' || !!process.env?.VITEST));

type Loader = () => Promise<void>;
let loader: Loader | null = null;
let inflight: Promise<void> | null = null;
let loadedAt = 0;
let dirty = true;

export function setLoader(fn: Loader): void {
  loader = fn;
}

/** Marks the cache stale (used by realtime events); the next read reloads it. */
export function invalidate(): void {
  dirty = true;
}

/** Reload now. Waits for a load already in progress so a write is never followed by a stale read. */
export async function refresh(): Promise<void> {
  if (!isRemote() || !loader) return;
  if (inflight) await inflight.catch(() => undefined);
  const run = loader();
  inflight = run.then(() => {
    loadedAt = Date.now();
    dirty = false;
  });
  try {
    await inflight;
  } finally {
    inflight = null;
  }
}

/** Reads call this first: cheap when the cache is fresh, a full reload when it is stale. */
export async function ensureFresh(maxAgeMs = 5000): Promise<void> {
  if (!isRemote() || !loader) return;
  if (inflight) return inflight.catch(() => undefined);
  if (!dirty && Date.now() - loadedAt < maxAgeMs) return;
  await refresh();
}

/* ---------- Log writes (audit, sms) queued during an operation and sent by commit() ---------- */
const queue: Array<() => Promise<unknown>> = [];
export function queueWrite(fn: () => Promise<unknown>): void {
  if (isRemote()) queue.push(fn);
}
async function flushQueue(): Promise<void> {
  const jobs = queue.splice(0, queue.length);
  for (const job of jobs) {
    try {
      await job();
    } catch (e) {
      console.warn('Log write failed:', e);
    }
  }
}

/** Call after every successful write: sends queued logs, then reloads so the UI shows exactly what the DB holds. */
export async function commit(): Promise<void> {
  await flushQueue();
  await refresh();
}

/** Call when a write failed: discards queued logs and reloads so nothing half-applied stays on screen. */
export async function rollback(): Promise<void> {
  queue.splice(0, queue.length);
  await refresh().catch(() => undefined);
}

/* ---------- Errors ---------- */
interface PgError {
  message?: string;
  code?: string;
  details?: string;
}

export function friendlyError(e: PgError | Error | unknown): string {
  const err = (e ?? {}) as PgError;
  const msg = err.message ?? String(e);
  if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) return 'Hakuna mtandao. Jaribu tena.';
  if (err.code === '23505') {
    if (/products_code_key/.test(msg)) return 'Code hii tayari inatumika na bidhaa nyingine';
    if (/products_barcode_key/.test(msg)) return 'Barcode hii tayari inatumika';
    if (/imei/i.test(msg)) return 'IMEI tayari ipo kwenye mfumo';
    if (/suppliers_name_key/.test(msg)) return 'Supplier huyu tayari yupo';
    return 'Rekodi hii tayari ipo';
  }
  if (err.code === '42501') return 'Huna ruhusa ya kufanya hivi. Ingia tena.';
  if (err.code === 'PGRST202' || err.code === '42883') return 'Hitilafu ya mfumo: kazi ya database haipo. Wasiliana na msimamizi.';
  if (err.code === 'PGRST301' || /JWT/i.test(msg)) return 'Muda wa kuingia umeisha. Ingia tena.';
  if (err.code === '23514') return 'Taarifa si sahihi';
  if (err.code === '23503') return 'Rekodi hii inatumika mahali pengine';
  return msg;
}

/** Calls a database function. Throws an Error with a readable message (never swallows it). */
export async function rpc<T = unknown>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(friendlyError(error));
  return data as T;
}

/** Throws a readable Error if a table write failed. */
export function check<T extends { error: PgError | null }>(res: T): T {
  if (res.error) throw new Error(friendlyError(res.error));
  return res;
}

/** Runs a write: on success commit(), on failure rollback() and rethrow, so the UI never shows a write that did not happen. */
export async function write<T>(fn: () => Promise<T>): Promise<T> {
  try {
    const out = await fn();
    await commit();
    return out;
  } catch (e) {
    await rollback();
    throw e instanceof Error ? e : new Error(friendlyError(e));
  }
}
