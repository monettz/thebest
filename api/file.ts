/**
 * GET /api/file?key=products/2026/11/<uuid>.webp — shows one stored file from the private R2 bucket.
 *
 * Every upload gets a new, never-reused key, so a file never changes: the response is cached for a year by
 * the browser and by Vercel's CDN, and R2 is read only the first time a photo is seen.
 * Only product photos can be opened by link today; other folders stay private until they get their own
 * signed links.
 */
import { PUBLIC_FOLDERS, json, objectUrl, r2Client, r2Configured, validKey, type R2Env } from './_r2.js';

const MIME: Record<string, string> = { webp: 'image/webp', jpg: 'image/jpeg', png: 'image/png', pdf: 'application/pdf' };

export async function handleFile(request: Request, env: R2Env, fetchImpl: typeof fetch = fetch): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') return json(405, { error: 'Method not allowed' });
  if (!r2Configured(env)) return json(501, { error: 'Hifadhi ya picha (Cloudflare R2) bado haijawekwa.' });

  const key = new URL(request.url).searchParams.get('key') ?? '';
  if (!validKey(key)) return json(400, { error: 'Faili si sahihi.' });
  if (!(PUBLIC_FOLDERS as readonly string[]).includes(key.split('/')[0])) return json(403, { error: 'Faili hili ni binafsi.' });

  const res = await fetchImpl(await r2Client(env).sign(objectUrl(env, key), { method: request.method }));
  if (res.status === 404) return json(404, { error: 'Picha haipo.' });
  if (!res.ok) return json(502, { error: 'Imeshindikana kusoma picha.' });

  const ext = key.split('.').pop() ?? '';
  return new Response(request.method === 'HEAD' ? null : res.body, {
    status: 200,
    headers: {
      'content-type': res.headers.get('content-type') || MIME[ext] || 'application/octet-stream',
      'cache-control': 'public, max-age=31536000, s-maxage=31536000, immutable',
      'x-content-type-options': 'nosniff',
      ...(res.headers.get('content-length') ? { 'content-length': res.headers.get('content-length')! } : {}),
    },
  });
}

/** Vercel function entry. */
export async function GET(request: Request): Promise<Response> {
  return handleFile(request, {
    R2_ACCOUNT_ID: process.env.R2_ACCOUNT_ID,
    R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY,
    R2_BUCKET: process.env.R2_BUCKET,
  });
}
