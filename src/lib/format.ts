import { getLang } from '@/i18n';

/** All money is whole TZS shillings. */
export function formatNumber(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

export function formatTZS(n: number): string {
  return `TSh ${formatNumber(n)}`;
}

/** 48,600,000 -> "TSh 48.6M", 1,900,000 -> "TSh 1.9M"; below 1M falls back to full format. */
export function formatTZSCompact(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `TSh ${trim(n / 1_000_000)}M`;
  return formatTZS(n);
}

/** Chart axis label: 3,100,000 -> "3.1M". */
export function formatCompact(n: number): string {
  if (n >= 1_000_000) return `${trim(n / 1_000_000)}M`;
  if (n >= 1_000) return `${trim(n / 1_000)}K`;
  return String(n);
}

function trim(v: number): string {
  return v.toFixed(1).replace(/\.0$/, '');
}

const MONTHS = {
  sw: ['Jan', 'Feb', 'Mac', 'Apr', 'Mei', 'Jun', 'Jul', 'Ago', 'Sep', 'Okt', 'Nov', 'Des'],
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
};
const DAYS = {
  sw: ['Jumapili', 'Jumatatu', 'Jumanne', 'Jumatano', 'Alhamisi', 'Ijumaa', 'Jumamosi'],
  en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
};
const DAYS_SHORT = {
  sw: ['Jp', 'Jt', 'Jn', 'Jt', 'Al', 'Ij', 'Jm'], // Sunday first, matches Date#getDay()
  en: ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'],
};

/** "2026-10" -> "Okt" / "Oct" */
export function monthShort(ym: string): string {
  return MONTHS[getLang()][Number(ym.slice(5, 7)) - 1];
}

/** dd/mm/yyyy */
export function formatDate(d: Date): string {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear()}`;
}

/** "28 Okt" */
export function formatDayMonth(d: Date): string {
  return `${d.getDate()} ${MONTHS[getLang()][d.getMonth()]}`;
}

/** "28 Okt 2026" */
export function formatLongDate(d: Date): string {
  return `${formatDayMonth(d)} ${d.getFullYear()}`;
}

export function dayName(d: Date): string {
  return DAYS[getLang()][d.getDay()];
}

/** Two-letter weekday for the mobile chart (Jp Jt Jn Jt Al Ij Jm / Su Mo Tu We Th Fr Sa). */
export function dayShort(d: Date): string {
  return DAYS_SHORT[getLang()][d.getDay()];
}

export function initials(name: string): string {
  const parts = name.replace(/[\[\]]/g, '').trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? parts[0]?.[1] ?? '')).toUpperCase();
}

/** Format a TZ number for display: 255712345678 -> 0712 345 678 */
export function displayPhone(p: string): string {
  const local = p.startsWith('255') ? '0' + p.slice(3) : p;
  return local.replace(/^(\d{4})(\d{3})(\d{3})$/, '$1 $2 $3');
}
