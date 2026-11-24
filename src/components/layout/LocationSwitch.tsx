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
  /** `soft`: the desktop sidebar's white-on-grey segmented look. */
  variant?: 'solid' | 'soft';
}) {
  if (variant === 'soft') {
    return (
      <div className={cx('grid grid-cols-2 gap-1 rounded-[12px] bg-[#F1F5F9] p-1', className)} role="tablist" aria-label={tr('Eneo')}>
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
                'min-h-[36px] rounded-[9px] px-3 text-[13px] transition-all duration-150',
                active ? 'bg-white font-semibold text-ink shadow-[0_1px_2px_rgba(15,23,42,0.08)]' : 'font-medium text-[#64748B] hover:text-ink',
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
        'grid grid-cols-2 gap-1 rounded-[12px] border border-[#E2E8F0] bg-[#F1F5F9] p-1',
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
                ? 'bg-[#2563EB] text-white shadow-sm'
                : 'text-[#475569] hover:text-[#0F172A]',
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
