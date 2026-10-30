/**
 * Two languages: Kiswahili (the source text) and English.
 * The Swahili sentence IS the key: `tr('Mauzo ya leo')` gives "Today's sales" in English and the
 * same text in Swahili, and any sentence missing from the English dictionary simply stays Swahili.
 * Sentences with values inside either use named slots (`tr('Bidhaa {n}', { n: 3 })`) or are matched
 * by pattern, so error messages built elsewhere ("Charger 25W: zilizopo store ni 12") translate too.
 * Switching language remounts the tree, so every screen re-renders in the new language.
 */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { EN } from './en';

export type Lang = 'sw' | 'en';
const KEY = 'tb.lang';

function readLang(): Lang {
  try {
    return localStorage.getItem(KEY) === 'en' ? 'en' : 'sw';
  } catch {
    return 'sw';
  }
}
let current: Lang = readLang();
export const getLang = (): Lang => current;

/** Changes the language (and remembers it). The provider calls this; tests call it directly. */
export function setLanguage(l: Lang): void {
  current = l;
  try {
    localStorage.setItem(KEY, l);
  } catch {
    /* the choice still applies for this visit */
  }
}

type Vars = Record<string, string | number>;
const fill = (s: string, vars?: Vars) => (vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s);

interface Pattern {
  key: string;
  re: RegExp;
  tokens: string[];
}
const patterns: Pattern[] = Object.keys(EN)
  .filter((k) => /\{\w+\}/.test(k))
  .map((key) => {
    const tokens: string[] = [];
    const src = key
      .split(/(\{\w+\})/)
      .map((part) => {
        const m = part.match(/^\{(\w+)\}$/);
        if (m) {
          tokens.push(m[1]);
          return '(.+?)';
        }
        return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      })
      .join('');
    return { key, tokens, re: new RegExp(`^${src}$`, 's') };
  })
  // Longer (more specific) templates first.
  .sort((a, b) => b.key.length - a.key.length);

const missed = new Set<string>();
/** Sentences that reached the translator but have no English yet (used by the language check). */
export const missedTranslations = () => [...missed];
if (import.meta.env.DEV && typeof window !== 'undefined') (window as unknown as { __i18nMissed: () => string[] }).__i18nMissed = missedTranslations;

function one(text: string, vars?: Vars): string {
  if (current === 'sw') return fill(text, vars);
  const hit = EN[text];
  if (hit !== undefined) return fill(hit, vars);
  for (const p of patterns) {
    const m = p.re.exec(text);
    if (m) {
      const found: Vars = {};
      p.tokens.forEach((tok, i) => (found[tok] = EN[m[i + 1]] ?? m[i + 1]));
      return fill(EN[p.key], { ...found, ...vars });
    }
  }
  if (/[A-Za-z]{3}/.test(text)) missed.add(text);
  return fill(text, vars);
}

/** Translate a sentence (multi-line messages are translated line by line). */
export function tr(text: string, vars?: Vars): string {
  if (!text) return text;
  return text.includes('\n') ? text.split('\n').map((l) => one(l, vars)).join('\n') : one(text, vars);
}

interface Ctx {
  lang: Lang;
  setLang: (l: Lang) => void;
}
const LangCtx = createContext<Ctx>({ lang: 'sw', setLang: () => undefined });
export const useLang = () => useContext(LangCtx);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(current);
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  const value = useMemo<Ctx>(
    () => ({
      lang,
      setLang: (l) => {
        setLanguage(l);
        setLangState(l);
      },
    }),
    [lang],
  );
  // No remount on a language change: the tree below simply re-renders, so the page, scroll position,
  // open dialogs and half-filled forms all stay exactly as they were (see `Relocalize` in App).
  return <LangCtx.Provider value={value}>{children}</LangCtx.Provider>;
}
