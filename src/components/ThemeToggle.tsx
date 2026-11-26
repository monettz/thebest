import { cx } from '@/components/ui';
import { MoonIcon, SunIcon } from '@/components/ui/icons';
import { useTheme } from '@/lib/theme';
import { tr } from '@/i18n';

/** Sun in dark mode (tap for light), moon in light mode (tap for dark). */
export function ThemeToggle({ className }: { className?: string }) {
  const [theme, setTheme] = useTheme();
  const dark = theme === 'dark';
  const label = dark ? tr('Mwanga') : tr('Giza');
  return (
    <button
      type="button"
      onClick={() => setTheme(dark ? 'light' : 'dark')}
      aria-label={label}
      title={label}
      className={cx('flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-surface text-ink transition-colors hover:bg-surface/70 active:scale-95', className)}
    >
      {dark ? <SunIcon width={19} height={19} /> : <MoonIcon width={19} height={19} />}
    </button>
  );
}
