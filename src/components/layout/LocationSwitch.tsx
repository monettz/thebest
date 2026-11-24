import { LOCATION_LABEL, LOCATIONS, type LocationCode } from '@shared/constants';
import { cx } from '@/components/ui';
import { tr } from '@/i18n';

export function LocationSwitch({
  value,
  onChange,
  className,
  compact,
  variant = 'solid',
}: {
  value: LocationCode;
  onChange: (v: LocationCode) => void;
  className?: string;
  compact?: boolean;
  /** `soft`: white-on-grey segments. `pill`: rounded white track on the canvas, the chosen place in dark. */
  variant?: 'solid' | 'soft' | 'pill';
}) {
  if (variant === 'soft' || variant === 'pill') {
    const pill = variant === 'pill';
    return (
      <div
        className={cx('grid grid-cols-2 gap-1 p-1', pill ? 'rounded-full bg-white' : 'rounded-[12px] bg-app', className)}
        role="tablist"
        aria-label={tr('Eneo')}
      >
        {LOCATIONS.map((l) => {
          const active = value === l;
          return (
            <button
              key={l}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onChange(l)}
              className={cx(
                'min-h-[36px] px-3 text-[13px] transition-all duration-150',
                pill ? 'rounded-full' : 'rounded-[9px]',
                active
                  ? pill
                    ? 'bg-ink font-semibold text-white'
                    : 'bg-white font-semibold text-ink shadow-[0_1px_2px_rgba(15,23,42,0.08)]'
                  : 'font-medium text-muted hover:text-ink',
              )}
            >
              {tr(LOCATION_LABEL[l])}
            </button>
          );
        })}
      </div>
    );
  }
  return (
    <div
      className={cx(
        'grid grid-cols-2 gap-1 rounded-[12px] border border-line bg-app p-1',
        className,
      )}
      role="tablist"
      aria-label={tr('Eneo')}
    >
      {LOCATIONS.map((l) => {
        const active = value === l;
        return (
          <button
            key={l}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(l)}
            className={cx(
              'inline-flex items-center justify-center gap-1.5 rounded-[9px] px-3 text-[13.5px] font-bold transition-all duration-150',
              compact ? 'min-h-[40px]' : 'min-h-[42px]',
              active
                ? 'bg-primary text-white shadow-sm'
                : 'text-body hover:text-ink',
            )}
          >
            <span
              className={cx(
                'h-2 w-2 shrink-0 rounded-full',
                active ? 'bg-white' : 'bg-[#94A3B8]',
              )}
            />
            <span className="truncate">{tr(LOCATION_LABEL[l])}</span>
          </button>
        );
      })}
    </div>
  );
}
