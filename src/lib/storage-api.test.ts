import { describe, expect, it } from 'vitest';
import { handleStorage, type StorageEnv } from '../../api/storage';
import { handleFile } from '../../api/file';
import { keyOf, validKey } from '../../api/_r2';

const env: StorageEnv = {
  R2_ACCOUNT_ID: 'acct123',
  R2_ACCESS_KEY_ID: 'AKIDEXAMPLE',
  R2_SECRET_ACCESS_KEY: 'secret-example',
  R2_BUCKET: 'thebest-images',
  SUPABASE_URL: 'https://proj.supabase.co',
  SUPABASE_ANON_KEY: 'anon',
};

const KEY = 'products/2026/11/0b6f7d1e-2c3a-4f5b-8c9d-0e1f2a3b4c5d.webp';

/** Stand-in for the network: Supabase's is_owner answer, and R2's replies. */
function fakeFetch(owner: boolean, calls: string[] = [], r2Status = 204): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
    calls.push(`${method} ${url.split('?')[0]}`);
    if (url.includes('/rest/v1/rpc/is_owner')) return new Response(JSON.stringify(owner), { status: 200 });
    if (method === 'GET') return new Response(r2Status === 404 ? null : 'IMAGEBYTES', { status: r2Status === 204 ? 200 : r2Status, headers: { 'content-type': 'image/webp' } });
    return new Response(null, { status: r2Status });
  }) as typeof fetch;
}

const post = (body: unknown, token = 'user-jwt') =>
  new Request('https://app.test/api/storage', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('/api/storage (Cloudflare R2, private bucket)', () => {
  it('says plainly when R2 is not set up yet', async () => {
    const res = await handleStorage(post({ action: 'upload', folder: 'products', contentType: 'image/webp' }), {}, fakeFetch(true));
    expect(res.status).toBe(501);
    expect((await res.json()).error).toMatch(/R2/);
  });

  it('needs only the four R2 keys (no public URL)', async () => {
    const res = await handleStorage(post({ action: 'upload', folder: 'products', contentType: 'image/webp' }), env, fakeFetch(true));
    expect(res.status).toBe(200);
  });

  it('refuses callers who are not signed in or not the owner', async () => {
    const noToken = new Request('https://app.test/api/storage', { method: 'POST', body: '{}' });
    expect((await handleStorage(noToken, env, fakeFetch(true))).status).toBe(401);
    const seller = await handleStorage(post({ action: 'upload', folder: 'products', contentType: 'image/webp' }), env, fakeFetch(false));
    expect(seller.status).toBe(403);
  });

  it('gives an owner a short-lived signed upload link and the app link to save', async () => {
    const res = await handleStorage(post({ action: 'upload', folder: 'products', contentType: 'image/webp' }), env, fakeFetch(true));
    const body = await res.json();
    const upload = new URL(body.uploadUrl);
    expect(upload.host).toBe('acct123.r2.cloudflarestorage.com');
    expect(upload.pathname).toMatch(/^\/thebest-images\/products\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.webp$/);
    expect(upload.searchParams.get('X-Amz-Expires')).toBe('300');
    expect(upload.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
    // The secret itself is never sent back.
    expect(JSON.stringify(body)).not.toContain('secret-example');
    const key = upload.pathname.replace('/thebest-images/', '');
    expect(body.publicUrl).toBe(`/api/file?key=${encodeURIComponent(key)}`);
    expect(keyOf(body.publicUrl)).toBe(key);
  });

  it('rejects unknown folders and file types', async () => {
    expect((await handleStorage(post({ action: 'upload', folder: '../etc', contentType: 'image/webp' }), env, fakeFetch(true))).status).toBe(400);
    expect((await handleStorage(post({ action: 'upload', folder: 'products', contentType: 'text/html' }), env, fakeFetch(true))).status).toBe(400);
  });

  it('deletes only files this app stored', async () => {
    const calls: string[] = [];
    const ok = await handleStorage(post({ action: 'delete', url: `/api/file?key=${encodeURIComponent(KEY)}` }), env, fakeFetch(true, calls));
    expect(ok.status).toBe(200);
    expect(calls).toContain(`DELETE https://acct123.r2.cloudflarestorage.com/thebest-images/${KEY}`);
    const foreign = await handleStorage(post({ action: 'delete', url: 'https://evil.example/products/x.webp' }), env, fakeFetch(true));
    expect(foreign.status).toBe(400);
  });
});

describe('/api/file (serving from the private bucket)', () => {
  const get = (key: string) => new Request(`https://app.test/api/file?key=${encodeURIComponent(key)}`);

  it('streams a product photo with a year-long cache', async () => {
    const calls: string[] = [];
    const res = await handleFile(get(KEY), env, fakeFetch(true, calls));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/webp');
    expect(res.headers.get('cache-control')).toContain('immutable');
    expect(await res.text()).toBe('IMAGEBYTES');
    expect(calls).toContain(`GET https://acct123.r2.cloudflarestorage.com/thebest-images/${KEY}`);
  });

  it('keeps other folders private and rejects odd keys', async () => {
    expect((await handleFile(get(KEY.replace('products', 'receipts')), env, fakeFetch(true))).status).toBe(403);
    expect((await handleFile(get('products/../secret.webp'), env, fakeFetch(true))).status).toBe(400);
    expect((await handleFile(get('products/x.webp'), env, fakeFetch(true))).status).toBe(400);
  });

  it('answers 404 for a photo that is gone and 501 before R2 is set up', async () => {
    expect((await handleFile(get(KEY), env, fakeFetch(true, [], 404))).status).toBe(404);
    expect((await handleFile(get(KEY), {}, fakeFetch(true))).status).toBe(501);
  });

  it('recognises only well-formed keys', () => {
    expect(validKey(KEY)).toBe(true);
    expect(validKey('/products/2026/11/a.webp')).toBe(false);
    expect(validKey('other/2026/11/a.webp')).toBe(false);
    expect(keyOf('data:image/png;base64,AAA')).toBeNull();
  });
});
