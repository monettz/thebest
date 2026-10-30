import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EN } from './en';

/**
 * Guards the root cause of "half English" screens: a Swahili sentence that reaches the UI but has no
 * English entry. It reads the source files, collects every literal passed to tr() and every literal
 * used as a label/title/subtitle/note/placeholder, and requires an English entry for each.
 */
const ROOT = join(__dirname, '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\./.test(name)) out.push(p);
  }
  return out;
}

/** Strings that are the same in both languages or are not interface text. */
const SAME_IN_BOTH = new Set([
  '07XX XXX XXX', 'PIN', 'TSh', 'IMEI', 'IMEI:', 'INV-0231', 'Language / Lugha', 'Kiswahili', 'English',
  // The printed receipt is a document for the customer and stays in Swahili in both languages (see Settings).
  'Risiti ya malipo ya deni', 'Jumla ya mauzo', 'Jumla imelipwa', 'JUMLA', 'DENI LINABAKI',
  'SHOP', 'STORE', 'NONE', 'PAID', 'OVERDUE', 'IPO', 'CHINI', 'IMEISHA', 'SENT', 'FAILED', 'DUPLICATE', 'DISABLED', 'NO_PHONE', 'BEFORE', 'AFTER',
]);

const Q = String.raw`((?:[^'\\]|\\.)*)`;
const PATTERNS = [
  new RegExp(String.raw`\btr\(\s*'${Q}'`, 'g'),
  new RegExp(String.raw`\b(?:label|title|subtitle|sub|note|placeholder)\s*:\s*'${Q}'`, 'g'),
  /\b(?:label|title|subtitle|note|placeholder|aria-label)="([^"{}<>]+)"/g,
];

describe('every interface sentence has an English version', () => {
  const missing: string[] = [];
  for (const file of walk(ROOT)) {
    const rel = file.slice(ROOT.length + 1).replace(/\\/g, '/');
    if (rel.startsWith('i18n/') || rel.startsWith('mock/seed')) continue;
    const src = readFileSync(file, 'utf8');
    for (const re of PATTERNS) {
      for (const m of src.matchAll(re)) {
        const key = m[1].replace(/\\'/g, "'").trim();
        if (key.length < 3 || !/[A-Za-z]{3}/.test(key) || SAME_IN_BOTH.has(key)) continue;
        if (/^[a-z0-9_.\-/:]+$/.test(key)) continue; // identifiers, routes, class-like tokens
        if (!(key in EN)) missing.push(`${rel}: ${key}`);
      }
    }
  }
  it('has no tr() / label literal without an English entry', () => {
    expect([...new Set(missing)]).toEqual([]);
  });
});
