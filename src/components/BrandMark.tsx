/** The THE BEST logo as a small rounded tile (same artwork as the app icon and favicon). */
export function BrandMark({ size = 36, className = '' }: { size?: number; className?: string }) {
  return (
    <img
      src="/icon-192.png"
      alt="THE BEST"
      width={size}
      height={size}
      draggable={false}
      className={`shrink-0 rounded-[11px] border border-line-soft bg-white object-contain ${className}`}
      style={{ width: size, height: size }}
    />
  );
}
