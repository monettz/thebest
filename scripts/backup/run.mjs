#!/usr/bin/env node
/**
 * THE BEST POS — nightly backup to Google Drive.
 *
 * Runs at 00:00 Dar (GitHub Actions, see .github/workflows/backup.yml) and keeps the business data safe outside
 * Supabase. Photos are NOT copied: they live in Cloudflare R2 and the backup keeps only their links.
 *
 *   Every night     Kila siku/thebest-YYYY-MM-DD.sql.gz     full restorable backup, kept 30 days
 *   Month end       Kila mwezi/thebest-YYYY-MM.sql.gz       kept 10 years
 *                   Kila mwezi/thebest-YYYY-MM.xlsx         readable copy of the month (no app needed)
 *                   Ripoti/ripoti-YYYY-MM.txt               result of restoring that backup into a test database
 *   31 December     Kila mwaka/thebest-YYYY.sql.gz + .xlsx  kept forever
 *
 * Environment
 *   SUPABASE_DB_URL        Postgres URI of the Supabase "Session pooler" (with the database password)
 *   GDRIVE_CLIENT_ID, GDRIVE_CLIENT_SECRET, GDRIVE_REFRESH_TOKEN   Google OAuth (scope drive.file)
 *   VERIFY_DB_URL          optional: an empty Postgres to restore the month-end backup into, to prove it works
 *   BACKUP_OUT_DIR         optional: write files to this folder instead of Drive (for testing)
 *   BACKUP_DATE            optional: the day being backed up (YYYY-MM-DD); default: the day that just ended in Dar
 *   FORCE_MONTHLY=1        optional: also make the month-end files (for testing)
 */
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync, gunzipSync } from 'node:zlib';
import XLSX from 'xlsx';

const HERE = dirname(fileURLToPath(import.meta.url));
const TZ = 'Africa/Dar_es_Salaam';
export const ROOT_FOLDER = 'THE BEST Backups';
export const FOLDERS = { daily: 'Kila siku', monthly: 'Kila mwezi', yearly: 'Kila mwaka', reports: 'Ripoti' };
export const KEEP_DAILY_DAYS = 30;
export const KEEP_MONTHLY_YEARS = 10;

// ---------- dates ----------

/** The Dar date (YYYY-MM-DD) of a moment. */
export const darDate = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d);

/**
 * The day being backed up. The job starts at 00:00 Dar but GitHub may start it late, so "6 hours ago in Dar"
 * is always the business day that just ended.
 */
export const backupDay = (now = new Date()) => darDate(new Date(now.getTime() - 6 * 3600_000));

export const isMonthEnd = (day) => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.getUTCDate() === 1;
};
export const isYearEnd = (day) => day.endsWith('-12-31');

/** Which Drive files are past their keep-by date, given the day being backed up. */
export function expired(kind, name, day) {
  if (kind === 'daily') {
    const m = name.match(/^thebest-(\d{4}-\d{2}-\d{2})\./);
    if (!m) return false;
    const age = (Date.parse(`${day}T00:00:00Z`) - Date.parse(`${m[1]}T00:00:00Z`)) / 86_400_000;
    return age >= KEEP_DAILY_DAYS; // the last 30 nights, this one included
  }
  if (kind === 'monthly') {
    const m = name.match(/^thebest-(\d{4})-(\d{2})\./);
    if (!m) return false;
    const [y, mo] = day.split('-').map(Number);
    const months = (y - Number(m[1])) * 12 + (mo - Number(m[2]));
    return months > KEEP_MONTHLY_YEARS * 12;
  }
  return false; // yearly backups are never deleted
}

// ---------- postgres ----------

const PG_BIN = process.env.PG_BIN ? (n) => join(process.env.PG_BIN, n) : (n) => n;

function run(cmd, args, { input } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(PG_BIN(cmd), args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const out = [];
    let err = '';
    p.stdout.on('data', (c) => out.push(c));
    p.stderr.on('data', (c) => (err += c));
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve({ stdout: Buffer.concat(out), stderr: err }) : reject(new Error(`${cmd} failed (${code}): ${err.trim().split('\n').slice(-3).join(' | ')}`))));
    if (input) p.stdin.end(input);
    else p.stdin.end();
  });
}

/** One query → rows (via psql's json_agg, no extra driver needed). */
export async function query(dbUrl, sql) {
  const { stdout } = await run('psql', ['-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '--dbname', dbUrl, '-c', `select coalesce(json_agg(t), '[]'::json) from (${sql}) t`]);
  return JSON.parse(stdout.toString().trim() || '[]');
}

/**
 * The whole business database as one SQL file: the app's own data (public schema, structure and rows) plus the
 * sign-in accounts (auth.users and auth.identities, data only, so PINs survive a restore into a new project).
 */
export async function dumpDatabase(dbUrl) {
  const common = ['--no-owner', '--no-privileges', '--dbname', dbUrl];
  let auth = Buffer.from('-- sign-in accounts not included (no read access)\n');
  try {
    auth = (await run('pg_dump', ['--data-only', '--table=auth.users', '--table=auth.identities', ...common])).stdout;
  } catch (e) {
    console.warn('Note: sign-in accounts not included:', e.message);
  }
  const pub = (await run('pg_dump', ['--schema=public', ...common])).stdout;
  const header = Buffer.from(`-- THE BEST POS backup, made ${new Date().toISOString()}\n-- Restore: see docs/BACKUP.md\n\n`);
  return Buffer.concat([header, auth, Buffer.from('\n'), pub]);
}

/** Row counts of the key tables: stored in the report and compared after a test restore. */
export const COUNTED = ['products', 'inventory_units', 'stock_movements', 'transfers', 'customers', 'sales', 'sale_items', 'payments', 'sale_returns', 'expenses', 'cash_closings', 'suppliers', 'purchases', 'stock_takes', 'profiles'];
export async function tableCounts(dbUrl) {
  const sql = COUNTED.map((t) => `select '${t}' as tbl, (select count(*) from public.${t})::int as rows_n`).join(' union all ');
  const rows = await query(dbUrl, sql);
  const counts = Object.fromEntries(rows.map((r) => [r.tbl, r.rows_n]));
  // Never report a backup as good on missing numbers.
  for (const t of COUNTED) if (!Number.isInteger(counts[t])) throw new Error(`Could not count rows of ${t}`);
  return counts;
}

// ---------- readable Excel ----------

const inDar = (col) => `to_char(${col} at time zone '${TZ}', 'YYYY-MM-DD HH24:MI')`;

/** Sheets for a period [from, to] (Dar dates); stock, customers and open debts are as of the backup. */
export function excelSheets(from, to) {
  const salesIn = `(s.created_at at time zone '${TZ}')::date between '${from}' and '${to}'`;
  return {
    Mauzo: `select s.receipt_no as "Risiti", ${inDar('s.created_at')} as "Tarehe", s.user_name as "Muuzaji",
              coalesce(c.name, 'Mteja wa kawaida') as "Mteja", s.subtotal as "Jumla kabla ya punguzo", s.discount as "Punguzo",
              s.total as "Jumla", s.status as "Hali", s.due_date as "Tarehe ya kulipa deni"
            from public.sales s left join public.customers c on c.id = s.customer_id where ${salesIn} order by s.created_at`,
    'Bidhaa zilizouzwa': `select s.receipt_no as "Risiti", ${inDar('s.created_at')} as "Tarehe", i.name as "Bidhaa", i.qty as "Idadi",
              i.unit_price as "Bei", i.qty * i.unit_price as "Jumla", i.returned_qty as "Zilizorudishwa", i.imei as "IMEI"
            from public.sale_items i join public.sales s on s.id = i.sale_id where ${salesIn} order by s.created_at, i.id`,
    Malipo: `select ${inDar('p.paid_at')} as "Tarehe", s.receipt_no as "Risiti", coalesce(c.name, '') as "Mteja", p.method as "Njia",
              p.kind as "Aina", p.amount as "Kiasi", p.user_name as "Aliyepokea", p.reference as "Kumbukumbu"
            from public.payments p left join public.sales s on s.id = p.sale_id left join public.customers c on c.id = p.customer_id
            where (p.paid_at at time zone '${TZ}')::date between '${from}' and '${to}' order by p.paid_at`,
    Matumizi: `select e.spent_on as "Tarehe", e.category as "Aina", e.description as "Maelezo", e.method as "Njia",
              e.amount as "Kiasi", e.user_name as "Aliyerekodi"
            from public.expenses e where e.spent_on between '${from}' and '${to}' order by e.spent_on, e.id`,
    'Madeni (sasa)': `select c.name as "Mteja", c.phone as "Simu", s.receipt_no as "Risiti", ${inDar('s.created_at')} as "Tarehe",
              s.total - coalesce((select sum(value) from public.sale_returns r where r.sale_id = s.id), 0) as "Jumla",
              coalesce((select sum(amount) from public.payments p where p.sale_id = s.id), 0) as "Imelipwa",
              s.total - coalesce((select sum(value) from public.sale_returns r where r.sale_id = s.id), 0)
                - coalesce((select sum(amount) from public.payments p where p.sale_id = s.id), 0) as "Deni",
              s.due_date as "Tarehe ya kulipa"
            from public.sales s left join public.customers c on c.id = s.customer_id where s.status = 'PARTIAL' order by s.created_at`,
    'Stock (sasa)': `select p.code as "Code", p.name as "Bidhaa", p.type as "Aina", p.cost_price as "Bei ya kununua",
              p.sell_price as "Bei ya kuuza", v.store_qty as "Store", v.shop_qty as "Duka", p.min_stock as "Kiwango cha chini",
              case when p.archived then 'Imefichwa' else '' end as "Hali"
            from public.products p join public.products_view v on v.id = p.id order by p.name`,
    'Wateja (sasa)': `select c.name as "Jina", c.phone as "Simu", c.area as "Eneo", c.notes as "Maelezo", ${inDar('c.created_at')} as "Tangu"
            from public.customers c order by c.name`,
  };
}

export async function buildExcel(dbUrl, from, to) {
  const wb = XLSX.utils.book_new();
  for (const [name, sql] of Object.entries(excelSheets(from, to))) {
    const rows = await query(dbUrl, sql);
    const ws = rows.length ? XLSX.utils.json_to_sheet(rows) : XLSX.utils.aoa_to_sheet([['Hakuna rekodi katika kipindi hiki']]);
    XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
  }
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

// ---------- test restore ----------

/**
 * Restores the backup into an empty database and checks every key table has the same number of rows.
 * The empty database gets the few Supabase pieces the backup refers to (auth schema, roles), like a new project.
 */
export async function verifyRestore(gz, expected, verifyUrl) {
  const sql = gunzipSync(gz);
  await run('psql', ['-X', '-q', '--dbname', verifyUrl, '-f', join(HERE, 'supabase-stub.sql')]);
  // Shape the stand-in sign-in tables after the columns the backup actually carries, so those rows load too.
  const authTables = authTablesFor(sql.toString('utf8'));
  if (authTables) await run('psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '--dbname', verifyUrl], { input: Buffer.from(authTables) });
  const { stderr } = await run('psql', ['-X', '-q', '--dbname', verifyUrl], { input: sql });
  const got = await tableCounts(verifyUrl);
  const diffs = COUNTED.filter((t) => got[t] !== expected[t]).map((t) => `${t}: backup ${expected[t]}, imerudishwa ${got[t]}`);
  // "schema public already exists" is expected: every Postgres starts with it.
  const notes = stderr
    .split('\n')
    .filter((l) => /ERROR/.test(l) && !l.includes('schema "public" already exists'))
    .slice(0, 10);
  return { ok: diffs.length === 0, diffs, notes, got };
}

/** CREATE TABLE statements for auth.users / auth.identities matching the COPY column lists in a backup. */
export function authTablesFor(sqlText) {
  const out = [];
  for (const table of ['users', 'identities']) {
    const m = sqlText.match(new RegExp(`^COPY auth\\.${table} \\(([^)]*)\\) FROM stdin;`, 'm'));
    if (!m) continue;
    const cols = m[1].split(',').map((c) => c.trim());
    const defs = cols.map((c) => (c === 'id' ? 'id uuid primary key' : c === 'user_id' ? 'user_id uuid' : `${c} text`));
    out.push(`drop table if exists auth.${table} cascade; create table auth.${table} (${defs.join(', ')});`);
  }
  return out.join('\n');
}

// ---------- Google Drive (REST, scope drive.file) ----------

export function driveClient({ clientId, clientSecret, refreshToken }, fetchImpl = fetch) {
  let token = null;
  const auth = async () => {
    if (token) return token;
    const res = await fetchImpl('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(`Google sign-in failed: ${body.error_description || body.error || res.status}`);
    token = body.access_token;
    return token;
  };
  const api = async (url, init = {}) => {
    const res = await fetchImpl(url, { ...init, headers: { authorization: `Bearer ${await auth()}`, ...(init.headers || {}) } });
    if (!res.ok) throw new Error(`Google Drive ${init.method || 'GET'} failed: ${res.status} ${await res.text()}`);
    return res.status === 204 ? null : res.json();
  };
  const esc = (s) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

  const list = async (q) => {
    const files = [];
    let pageToken = '';
    do {
      const params = new URLSearchParams({ q, fields: 'nextPageToken, files(id, name)', pageSize: '1000', ...(pageToken ? { pageToken } : {}) });
      const page = await api(`https://www.googleapis.com/drive/v3/files?${params}`);
      files.push(...page.files);
      pageToken = page.nextPageToken || '';
    } while (pageToken);
    return files;
  };

  const folder = async (name, parent) => {
    const q = `name = '${esc(name)}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false${parent ? ` and '${parent}' in parents` : ''}`;
    const found = await list(q);
    if (found.length) return found[0].id;
    const made = await api('https://www.googleapis.com/drive/v3/files?fields=id', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', ...(parent ? { parents: [parent] } : {}) }),
    });
    return made.id;
  };

  /** Uploads a file; a file with the same name in that folder is replaced (a re-run never makes duplicates). */
  const upload = async (parent, name, data, mime) => {
    for (const old of await list(`name = '${esc(name)}' and '${parent}' in parents and trashed = false`)) {
      await api(`https://www.googleapis.com/drive/v3/files/${old.id}`, { method: 'DELETE' });
    }
    const boundary = `tb${Date.now()}`;
    const meta = JSON.stringify({ name, parents: [parent] });
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\ncontent-type: ${mime}\r\n\r\n`),
      data,
      Buffer.from(`\r\n--${boundary}--`),
    ]);
    return api('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,size', {
      method: 'POST',
      headers: { 'content-type': `multipart/related; boundary=${boundary}` },
      body,
    });
  };

  const files = (parent) => list(`'${parent}' in parents and trashed = false`);
  const remove = (id) => api(`https://www.googleapis.com/drive/v3/files/${id}`, { method: 'DELETE' });
  return { folder, upload, files, remove };
}

/** Writes into a local folder with the same layout as Drive (testing without Google). */
function localTarget(dir) {
  return {
    async put(sub, name, data) {
      await mkdir(join(dir, sub), { recursive: true });
      await writeFile(join(dir, sub, name), data);
    },
    async prune() {},
  };
}

function driveTarget(drive) {
  const ids = {};
  const sub = async (key) => {
    ids.root ??= await drive.folder(ROOT_FOLDER, null);
    ids[key] ??= await drive.folder(key, ids.root);
    return ids[key];
  };
  return {
    async put(folderName, name, data, mime) {
      await drive.upload(await sub(folderName), name, data, mime);
    },
    async prune(kind, folderName, day) {
      let removed = 0;
      for (const f of await drive.files(await sub(folderName))) {
        if (expired(kind, f.name, day)) {
          await drive.remove(f.id);
          removed++;
        }
      }
      return removed;
    },
  };
}

// ---------- main ----------

const GZ = 'application/gzip';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export async function main(env = process.env) {
  const dbUrl = env.SUPABASE_DB_URL;
  if (!dbUrl) throw new Error('SUPABASE_DB_URL is missing');
  const day = env.BACKUP_DATE || backupDay();
  const monthly = isMonthEnd(day) || env.FORCE_MONTHLY === '1';
  const yearly = isYearEnd(day);
  const [y, m] = day.split('-');

  const target = env.BACKUP_OUT_DIR
    ? localTarget(env.BACKUP_OUT_DIR)
    : driveTarget(driveClient({ clientId: env.GDRIVE_CLIENT_ID, clientSecret: env.GDRIVE_CLIENT_SECRET, refreshToken: env.GDRIVE_REFRESH_TOKEN }));

  console.log(`Backup of ${day}${monthly ? ' (month end)' : ''}${yearly ? ' (year end)' : ''}`);
  const counts = await tableCounts(dbUrl);
  const gz = gzipSync(await dumpDatabase(dbUrl), { level: 9 });
  // Logs of a public repository are public: say nothing about the business here (counts go to the Drive report).
  console.log(`Database backup: ${(gz.length / 1024).toFixed(0)} KB compressed`);

  await target.put(FOLDERS.daily, `thebest-${day}.sql.gz`, gz, GZ);

  if (monthly) {
    await target.put(FOLDERS.monthly, `thebest-${y}-${m}.sql.gz`, gz, GZ);
    await target.put(FOLDERS.monthly, `thebest-${y}-${m}.xlsx`, await buildExcel(dbUrl, `${y}-${m}-01`, day), XLSX_MIME);

    const lines = [`Ripoti ya backup ya ${y}-${m}`, `Imetengenezwa: ${new Date().toISOString()}`, `Ukubwa: ${(gz.length / 1024).toFixed(0)} KB`, '', 'Idadi ya rekodi:'];
    for (const t of COUNTED) lines.push(`  ${t}: ${counts[t]}`);
    if (env.VERIFY_DB_URL) {
      const v = await verifyRestore(gz, counts, env.VERIFY_DB_URL);
      lines.push('', v.ok ? 'Jaribio la kurudisha: ✅ IMEFAULU (rekodi zote zimerudi)' : 'Jaribio la kurudisha: ❌ IMESHINDWA');
      lines.push(...v.diffs.map((d) => `  ${d}`));
      if (v.notes.length) lines.push('', 'Maelezo ya psql:', ...v.notes.map((n) => `  ${n}`));
      await target.put(FOLDERS.reports, `ripoti-${y}-${m}.txt`, Buffer.from(lines.join('\n') + '\n'), 'text/plain');
      if (!v.ok) throw new Error(`Restore test failed: ${v.diffs.join('; ')}`);
      console.log('Restore test: OK');
    } else {
      await target.put(FOLDERS.reports, `ripoti-${y}-${m}.txt`, Buffer.from(lines.join('\n') + '\n'), 'text/plain');
    }
  }

  if (yearly) {
    await target.put(FOLDERS.yearly, `thebest-${y}.sql.gz`, gz, GZ);
    await target.put(FOLDERS.yearly, `thebest-${y}.xlsx`, await buildExcel(dbUrl, `${y}-01-01`, day), XLSX_MIME);
  }

  const removedDaily = await target.prune('daily', FOLDERS.daily, day);
  const removedMonthly = await target.prune('monthly', FOLDERS.monthly, day);
  if (removedDaily || removedMonthly) console.log(`Removed old backups: ${removedDaily || 0} daily, ${removedMonthly || 0} monthly`);
  console.log('Done.');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error('BACKUP FAILED:', e.message);
    process.exit(1);
  });
}
