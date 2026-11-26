/**
 * POST /api/storage — the only place the Cloudflare R2 keys are used. They live in Vercel's environment and
 * never reach the browser.
 *
 *   { action: 'upload', folder, contentType }  → a short-lived URL the browser PUTs one file to, plus the
 *                                                public URL to save in the database
 *   { action: 'delete', url }                  → removes a file this app stored (e.g. a replaced photo)
 *
 * Only a signed-in owner may call it: the caller's Supabase session is checked with public.is_owner().
 */
import { AwsClient } from 'aws4fetch';

/** Where app files go. A new kind of file gets its own folder here. */
export const FOLDERS = ['products', 'receipts', 'expenses', 'misc'] as const;
const TYPES: Record<string, string> = {
  'image/webp': 'webp',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'application/pdf': 'pdf',
};
const UPLOAD_SECONDS = 300;

export interface StorageEnv {
  R2_ACCOUNT_ID?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  R2_BUCKET?: string;
  /** Public base of the bucket, e.g. https://pub-xxxx.r2.dev or https://images.example.com (no trailing slash). */
  R2_PUBLIC_URL?: string;
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

/** True when the bearer token belongs to an active owner. */
async function isOwner(env: StorageEnv, token: string, fetchImpl: typeof fetch): Promise<boolean> {
  const res = await fetchImpl(`${env.SUPABASE_URL}/rest/v1/rpc/is_owner`, {
    method: 'POST',
    headers: { apikey: env.SUPABASE_ANON_KEY!, authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: '{}',
  });
  if (!res.ok) return false;
  return (await res.json()) === true;
}

/** `products/2026/11/<random>.webp` */
function newKey(folder: string, ext: string, now = new Date()): string {
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${folder}/${now.getUTCFullYear()}/${month}/${crypto.randomUUID()}.${ext}`;
}

/** The R2 key of a public URL this app made, or null for anything else. */
export function keyOf(url: string, publicBase: string): string | null {
  const base = publicBase.replace(/\/+$/, '') + '/';
  if (!url.startsWith(base)) return null;
  const key = decodeURIComponent(url.slice(base.length).split(/[?#]/)[0]);
  const folder = key.split('/')[0];
  if (!(FOLDERS as readonly string[]).includes(folder) || key.includes('..')) return null;
  return key;
}

export async function handleStorage(request: Request, env: StorageEnv, fetchImpl: typeof fetch = fetch): Promise<Response> {
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });
  const configured = env.R2_ACCOUNT_ID && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY && env.R2_BUCKET && env.R2_PUBLIC_URL;
  if (!configured || !env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    return json(501, { error: 'Hifadhi ya picha (Cloudflare R2) bado haijawekwa.' });
  }

  const token = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return json(401, { error: 'Ingia tena.' });
  if (!(await isOwner(env, token, fetchImpl))) return json(403, { error: 'Mmiliki tu ndiye anaweza kuhifadhi au kufuta faili.' });

  let body: { action?: string; folder?: string; contentType?: string; url?: string };
  try {
    body = await request.json();
  } catch {
    return json(400, { error: 'Ombi si sahihi.' });
  }

  const r2 = new AwsClient({ accessKeyId: env.R2_ACCESS_KEY_ID!, secretAccessKey: env.R2_SECRET_ACCESS_KEY!, service: 's3', region: 'auto' });
  const objectUrl = (key: string) =>
    `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${env.R2_BUCKET}/${key.split('/').map(encodeURIComponent).join('/')}`;
  const publicBase = env.R2_PUBLIC_URL!.replace(/\/+$/, '');

  if (body.action === 'upload') {
    const folder = body.folder ?? '';
    const ext = TYPES[(body.contentType ?? '').toLowerCase()];
    if (!(FOLDERS as readonly string[]).includes(folder)) return json(400, { error: 'Folda si sahihi.' });
    if (!ext) return json(400, { error: 'Aina ya faili haikubaliki.' });
    const key = newKey(folder, ext);
    const signed = await r2.sign(`${objectUrl(key)}?X-Amz-Expires=${UPLOAD_SECONDS}`, { method: 'PUT', aws: { signQuery: true } });
    return json(200, { uploadUrl: signed.url, publicUrl: `${publicBase}/${key}`, key, expiresIn: UPLOAD_SECONDS });
  }

  if (body.action === 'delete') {
    const key = keyOf(body.url ?? '', publicBase);
    if (!key) return json(400, { error: 'Faili hili si la app hii.' });
    const res = await fetchImpl(await r2.sign(objectUrl(key), { method: 'DELETE' }));
    // R2 answers 204 for a delete, also when the file was already gone.
    if (!res.ok && res.status !== 404) return json(502, { error: 'Imeshindikana kufuta faili.' });
    return json(200, { deleted: key });
  }

  return json(400, { error: 'Kitendo si sahihi.' });
}

/** Vercel function entry: reads the keys from the project's environment variables. */
export async function POST(request: Request): Promise<Response> {
  return handleStorage(request, {
    R2_ACCOUNT_ID: process.env.R2_ACCOUNT_ID,
    R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY,
    R2_BUCKET: process.env.R2_BUCKET,
    R2_PUBLIC_URL: process.env.R2_PUBLIC_URL,
    SUPABASE_URL: process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY,
  });
}
