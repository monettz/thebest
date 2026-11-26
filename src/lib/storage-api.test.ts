import { describe, expect, it } from 'vitest';
import { handleStorage, keyOf, type StorageEnv } from '../../api/storage';

const env: StorageEnv = {
  R2_ACCOUNT_ID: 'acct123',
  R2_ACCESS_KEY_ID: 'AKIDEXAMPLE',
  R2_SECRET_ACCESS_KEY: 'secret-example',
  R2_BUCKET: 'thebest-images',
  R2_PUBLIC_URL: 'https://pub-test.r2.dev',
  SUPABASE_URL: 'https://proj.supabase.co',
  SUPABASE_ANON_KEY: 'anon',
};

/** Stand-in for the network: Supabase's is_owner answer, and R2's reply to a delete. */
function fakeFetch(owner: boolean, calls: string[] = []): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
    calls.push(`${method} ${url.split('?')[0]}`);
    if (url.includes('/rest/v1/rpc/is_owner')) return new Response(JSON.stringify(owner), { status: 200 });
    return new Response(null, { status: 204 });
  }) as typeof fetch;
}

const post = (body: unknown, token = 'user-jwt') =>
  new Request('https://app.test/api/storage', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('/api/storage (Cloudflare R2)', () => {
  it('says plainly when R2 is not set up yet', async () => {
    const res = await handleStorage(post({ action: 'upload', folder: 'products', contentType: 'image/webp' }), {}, fakeFetch(true));
    expect(res.status).toBe(501);
    expect((await res.json()).error).toMatch(/R2/);
  });

  it('refuses callers who are not signed in or not the owner', async () => {
    const noToken = new Request('https://app.test/api/storage', { method: 'POST', body: '{}' });
    expect((await handleStorage(noToken, env, fakeFetch(true))).status).toBe(401);
    const seller = await handleStorage(post({ action: 'upload', folder: 'products', contentType: 'image/webp' }), env, fakeFetch(false));
    expect(seller.status).toBe(403);
  });

  it('gives an owner a short-lived signed upload link and the public URL to save', async () => {
    const res = await handleStorage(post({ action: 'upload', folder: 'products', contentType: 'image/webp' }), env, fakeFetch(true));
    expect(res.status).toBe(200);
    const body = await res.json();
    const upload = new URL(body.uploadUrl);
    expect(upload.host).toBe('acct123.r2.cloudflarestorage.com');
    expect(upload.pathname).toMatch(/^\/thebest-images\/products\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.webp$/);
    expect(upload.searchParams.get('X-Amz-Expires')).toBe('300');
    expect(upload.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
    expect(upload.searchParams.get('X-Amz-Credential')).toContain('AKIDEXAMPLE/');
    // The secret itself is never sent back.
    expect(JSON.stringify(body)).not.toContain('secret-example');
    expect(body.publicUrl).toBe(`https://pub-test.r2.dev/${upload.pathname.replace('/thebest-images/', '')}`);
  });

  it('rejects unknown folders and file types', async () => {
    expect((await handleStorage(post({ action: 'upload', folder: '../etc', contentType: 'image/webp' }), env, fakeFetch(true))).status).toBe(400);
    expect((await handleStorage(post({ action: 'upload', folder: 'products', contentType: 'text/html' }), env, fakeFetch(true))).status).toBe(400);
  });

  it('deletes only files this app stored', async () => {
    const calls: string[] = [];
    const ok = await handleStorage(post({ action: 'delete', url: 'https://pub-test.r2.dev/products/2026/11/abc.webp' }), env, fakeFetch(true, calls));
    expect(ok.status).toBe(200);
    expect(calls).toContain('DELETE https://acct123.r2.cloudflarestorage.com/thebest-images/products/2026/11/abc.webp');
    const foreign = await handleStorage(post({ action: 'delete', url: 'https://evil.example/products/x.webp' }), env, fakeFetch(true));
    expect(foreign.status).toBe(400);
  });

  it('maps public URLs back to keys safely', () => {
    expect(keyOf('https://pub-test.r2.dev/products/2026/11/a.webp', 'https://pub-test.r2.dev/')).toBe('products/2026/11/a.webp');
    expect(keyOf('https://pub-test.r2.dev/other/a.webp', 'https://pub-test.r2.dev')).toBeNull();
    expect(keyOf('https://pub-test.r2.dev/products/../x', 'https://pub-test.r2.dev')).toBeNull();
    expect(keyOf('data:image/png;base64,AAA', 'https://pub-test.r2.dev')).toBeNull();
  });
});
