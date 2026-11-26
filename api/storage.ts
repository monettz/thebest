/**
 * POST /api/storage — the only place files are written to Cloudflare R2. The R2 keys live in Vercel's
 * environment and never reach the browser; the bucket itself stays private.
 *
 *   { action: 'upload', folder, contentType }  → a short-lived URL the browser PUTs one file to, plus the
 *                                                link to save in the database ("/api/file?key=…")
 *   { action: 'delete', url }                  → removes a file this app stored (e.g. a replaced photo)
 *
 * Only a signed-in owner may call it: the caller's Supabase session is checked with public.is_owner().
 */
import { FILE_PATH, FOLDERS, json, keyOf, objectUrl, r2Client, r2Configured, type R2Env } from './_r2.js';

const TYPES: Record<string, string> = {
  'image/webp': 'webp',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'application/pdf': 'pdf',
};
const UPLOAD_SECONDS = 300;

export interface StorageEnv extends R2Env {
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
}

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

export async function handleStorage(request: Request, env: StorageEnv, fetchImpl: typeof fetch = fetch): Promise<Response> {
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });
  if (!r2Configured(env) || !env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
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

  const r2 = r2Client(env);

  if (body.action === 'upload') {
    const folder = body.folder ?? '';
    const ext = TYPES[(body.contentType ?? '').toLowerCase()];
    if (!(FOLDERS as readonly string[]).includes(folder)) return json(400, { error: 'Folda si sahihi.' });
    if (!ext) return json(400, { error: 'Aina ya faili haikubaliki.' });
    const key = newKey(folder, ext);
    const signed = await r2.sign(`${objectUrl(env, key)}?X-Amz-Expires=${UPLOAD_SECONDS}`, { method: 'PUT', aws: { signQuery: true } });
    return json(200, { uploadUrl: signed.url, publicUrl: `${FILE_PATH}${encodeURIComponent(key)}`, key, expiresIn: UPLOAD_SECONDS });
  }

  if (body.action === 'delete') {
    const key = keyOf(body.url ?? '');
    if (!key) return json(400, { error: 'Faili hili si la app hii.' });
    const res = await fetchImpl(await r2.sign(objectUrl(env, key), { method: 'DELETE' }));
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
    SUPABASE_URL: process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY,
  });
}
