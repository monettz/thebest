import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cx } from '@/components/ui';

/** Bottom sheet on phones, centred dialog from sm up. Escape and the backdrop close it. */
export default function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Portal to <body>: pages animate inside a stacking context that would otherwise keep the sheet under the bottom navigation.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-navy/50 animate-fade-in sm:items-center sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className={cx(
          'pb-safe max-h-[94dvh] w-full overflow-x-hidden overflow-y-auto overscroll-contain animate-sheet rounded-t-[24px] bg-white p-4 sm:max-h-[92vh] sm:rounded-[24px] sm:p-6',
          wide ? 'sm:max-w-3xl' : 'sm:max-w-md',
        )}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
