/**
 * Shared Cloudflare R2 helpers for the /api functions. Files whose names start with "_" are not turned into
 * endpoints by Vercel, so this is code only.
 *
 * The bucket is private: nothing in it has a public address. The app stores each file as
 * "/api/file?key=<folder>/<yyyy>/<mm>/<uuid>.<ext>", and /api/file reads it from R2 with the secret keys.
 */
import { AwsClient } from 'aws4fetch';

/** Where app files go. A new kind of file gets its own folder here. */
export const FOLDERS = ['products', 'receipts', 'expenses', 'misc'] as const;
/** Folders anyone with the link may view (product photos show in the POS and lists). */
export const PUBLIC_FOLDERS = ['products'] as const;

export const FILE_PATH = '/api/file?key=';

export interface R2Env {
  R2_ACCOUNT_ID?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  R2_BUCKET?: string;
}

export const r2Configured = (env: R2Env): boolean =>
  Boolean(env.R2_ACCOUNT_ID && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY && env.R2_BUCKET);

export function r2Client(env: R2Env): AwsClient {
  return new AwsClient({ accessKeyId: env.R2_ACCESS_KEY_ID!, secretAccessKey: env.R2_SECRET_ACCESS_KEY!, service: 's3', region: 'auto' });
}

/** The S3-API address of one object in the bucket. */
export function objectUrl(env: R2Env, key: string): string {
  return `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${env.R2_BUCKET}/${key.split('/').map(encodeURIComponent).join('/')}`;
}

/** A key this app could have made: a known folder, no "..", no leading slash, sane characters only. */
export function validKey(key: string): boolean {
  if (!key || key.startsWith('/') || key.includes('..') || key.length > 200) return false;
  if (!/^[a-z]+\/\d{4}\/\d{2}\/[A-Za-z0-9-]+\.(webp|jpg|png|pdf)$/.test(key)) return false;
  return (FOLDERS as readonly string[]).includes(key.split('/')[0]);
}

/** The R2 key inside a stored link ("/api/file?key=…", relative or absolute), or null for anything else. */
export function keyOf(url: string): string | null {
  const at = url.indexOf(FILE_PATH);
  if (at < 0) return null;
  const rest = url.slice(at + FILE_PATH.length).split(/[&#]/)[0];
  let key: string;
  try {
    key = decodeURIComponent(rest);
  } catch {
    return null;
  }
  return validKey(key) ? key : null;
}

export const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
