import { supabase } from '@/lib/supabase';

/**
 * Files in Cloudflare R2. The browser never holds the R2 keys: it asks /api/storage (a Vercel function, owner
 * only) for a short-lived upload link, PUTs the file straight to R2, and the database keeps only the public URL.
 */

export type StorageFolder = 'products' | 'receipts' | 'expenses' | 'misc';

const MAX_SIDE = 1200;
const QUALITY = 0.82;

async function authHeader(): Promise<Record<string, string>> {
  const token = (await supabase.auth.getSession()).data.session?.access_token;
  if (!token) throw new Error('Ingia tena ili kuhifadhi picha.');
  return { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
}

async function callStorage<T>(body: Record<string, unknown>): Promise<T> {
  let res: Response;
  try {
    res = await fetch('/api/storage', { method: 'POST', headers: await authHeader(), body: JSON.stringify(body) });
  } catch {
    throw new Error('Hakuna mtandao. Jaribu tena.');
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string } & T;
  if (!res.ok) throw new Error(data.error || 'Imeshindikana kuhifadhi picha. Jaribu tena.');
  return data;
}

/**
 * Shrinks a photo to at most 1200 px on its longer side and re-encodes it as WebP (JPEG where the browser
 * cannot write WebP). A 5 MB phone photo becomes a few hundred KB, so product lists stay fast.
 */
export async function compressImage(dataUrl: string): Promise<Blob> {
  const img = new Image();
  img.decoding = 'async';
  img.src = dataUrl;
  await img.decode();
  const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Imeshindikana kusoma picha.');
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const toBlob = (type: string) => new Promise<Blob | null>((r) => canvas.toBlob(r, type, QUALITY));
  const webp = await toBlob('image/webp');
  const blob = webp && webp.type === 'image/webp' ? webp : await toBlob('image/jpeg');
  if (!blob) throw new Error('Imeshindikana kusoma picha.');
  return blob;
}

/** Uploads a file to R2 and returns its public URL. */
export async function uploadFile(file: Blob, folder: StorageFolder): Promise<string> {
  const { uploadUrl, publicUrl } = await callStorage<{ uploadUrl: string; publicUrl: string }>({
    action: 'upload',
    folder,
    contentType: file.type,
  });
  const put = await fetch(uploadUrl, { method: 'PUT', headers: { 'content-type': file.type }, body: file }).catch(() => null);
  if (!put || !put.ok) throw new Error('Imeshindikana kupakia picha kwenda kwenye hifadhi. Jaribu tena.');
  return publicUrl;
}

/** A picked photo (data URL) → compressed → uploaded; anything already a link is returned as it is. */
export async function storeImage(value: string | undefined, folder: StorageFolder): Promise<string | undefined> {
  if (!value || !value.startsWith('data:')) return value;
  return uploadFile(await compressImage(value), folder);
}

/**
 * Removes a file this app stored, e.g. the old photo after a replace. Best effort: a failure never blocks the
 * change the owner made, and links that are not ours (or photos kept in the database) are ignored.
 */
export async function deleteStoredFile(url: string | undefined): Promise<void> {
  if (!url || !/^https:\/\//i.test(url)) return;
  await callStorage({ action: 'delete', url }).catch(() => undefined);
}
