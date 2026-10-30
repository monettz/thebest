import { useLang, type Lang } from '@/i18n';
import { cx } from '@/components/ui';

const OPTIONS: { value: Lang; label: string; short: string }[] = [
  { value: 'sw', label: 'Kiswahili', short: 'SW' },
  { value: 'en', label: 'English', short: 'EN' },
];

/** Language names are shown in their own language so they never need translating. */
export function LanguageSwitch({ compact, className }: { compact?: boolean; className?: string }) {
  const { lang, setLang } = useLang();
  return (
    <div
      role="radiogroup"
      aria-label="Language / Lugha"
      className={cx('inline-grid grid-cols-2 gap-1 rounded-field bg-app p-1', className)}
    >
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={lang === o.value}
          aria-label={o.label}
          onClick={() => lang !== o.value && setLang(o.value)}
          className={cx(
            'rounded-chip px-3 text-[13.5px] font-semibold transition-colors duration-150',
            compact ? 'min-h-[32px]' : 'min-h-[40px] px-5',
            lang === o.value ? 'bg-white text-ink shadow-sm' : 'text-muted hover:text-ink',
          )}
        >
          {compact ? o.short : o.label}
        </button>
      ))}
    </div>
  );
}
