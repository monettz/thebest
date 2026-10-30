import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { formatDate } from '@/lib/format';
import { listNotifications, markRead, type AppNotification, type NotificationKind } from '@/mock/notifications';
import { BellIcon, BoxIcon, CoinsIcon, RefreshIcon } from '@/components/ui/icons';
import { ListRowsSkeleton, cx } from '@/components/ui';
import { tr } from '@/i18n';

const ICON: Record<NotificationKind, { Icon: typeof BellIcon; tone: string }> = {
  OUT_OF_STOCK: { Icon: BoxIcon, tone: 'bg-bad-bg text-bad-fg' },
  LOW_STOCK: { Icon: BoxIcon, tone: 'bg-warn-bg text-warn-fg' },
  DEBT_OVERDUE: { Icon: CoinsIcon, tone: 'bg-bad-bg text-bad-fg' },
  RECEIVED: { Icon: BoxIcon, tone: 'bg-ok-bg text-ok-fg' },
  TRANSFERRED: { Icon: RefreshIcon, tone: 'bg-primary-tint text-primary-link' },
};

/** Bell with an unread count and a panel of real alerts. Works the same on the header and the dashboard. */
export function NotificationBell({ className }: { className?: string }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  // Under the ['products'] prefix on purpose: every stock change already invalidates it.
  const { data = [], refetch, isLoading, isError } = useQuery({
    queryKey: ['products', 'notifications', user?.id],
    queryFn: () => listNotifications(user!),
    refetchInterval: 20_000,
    enabled: !!user,
  });
  const unread = data.filter((n) => !n.read);

  useEffect(() => {
    if (!open) return;
    void refetch();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, refetch]);

  const refresh = () => qc.invalidateQueries({ queryKey: ['products', 'notifications'] });
  const openOne = (n: AppNotification) => {
    markRead(user!.id, [n.id]);
    void refresh();
    setOpen(false);
    navigate(n.to);
  };
  const readAll = () => {
    markRead(user!.id, unread.map((n) => n.id));
    void refresh();
  };

  return (
    <>
      <button
        type="button"
        aria-label={unread.length ? `${tr('Arifa')} (${unread.length})` : tr('Arifa')}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={cx('relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-line bg-white text-slate-600 shadow-sm hover:bg-slate-50', className)}
      >
        <BellIcon width={19} height={19} />
        {unread.length > 0 && (
          <span className="absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-500 px-1 text-[10.5px] font-bold leading-none text-white" data-testid="unread-count">
            {unread.length > 99 ? '99+' : unread.length}
          </span>
        )}
      </button>

      {open &&
        createPortal(
          <div className="fixed inset-0 z-[60]" onClick={() => setOpen(false)}>
            <section
              role="dialog"
              aria-label={tr('Arifa')}
              onClick={(e) => e.stopPropagation()}
              className="absolute inset-x-3 top-[60px] flex max-h-[min(78dvh,640px)] flex-col overflow-hidden rounded-2xl border border-line bg-white shadow-xl md:inset-x-auto md:right-8 md:top-[72px] md:w-[400px]"
            >
              <header className="flex items-center justify-between gap-3 border-b border-line-soft px-4 py-3">
                <h2 className="text-[15px] font-extrabold text-ink">
                  {tr('Arifa')} {unread.length > 0 && <span className="ml-1 text-[13px] font-semibold text-muted">· {tr('{n} mpya', { n: unread.length })}</span>}
                </h2>
                <div className="flex items-center gap-1">
                  <button type="button" disabled={unread.length === 0} onClick={readAll} className="min-h-[34px] rounded-lg px-2.5 text-[12.5px] font-semibold text-primary-link hover:bg-primary-tint disabled:text-slate-400 disabled:hover:bg-transparent">
                    {tr('Soma zote')}
                  </button>
                  <button type="button" onClick={() => setOpen(false)} className="min-h-[34px] rounded-lg px-2.5 text-[12.5px] font-semibold text-muted hover:bg-app">{tr('Funga')}</button>
                </div>
              </header>
              {isLoading ? (
                <div role="status" aria-busy="true" aria-label={tr('Inapakia…')}><ListRowsSkeleton rows={4} /></div>
              ) : isError ? (
                <div role="alert" className="px-4 py-8 text-center">
                  <p className="text-[13.5px] text-muted">{tr('Imeshindikana kupakia arifa.')}</p>
                  <button type="button" onClick={() => void refetch()} className="mt-2 min-h-[36px] rounded-lg px-3 text-[13px] font-semibold text-primary-link hover:bg-primary-tint">{tr('Jaribu tena')}</button>
                </div>
              ) : data.length === 0 ? (
                <p className="px-4 py-10 text-center text-[13.5px] text-muted">{tr('Hakuna arifa kwa sasa.')}</p>
              ) : (
                <ul className="divide-y divide-line-soft overflow-y-auto overscroll-contain">
                  {data.map((n) => {
                    const { Icon, tone } = ICON[n.kind];
                    return (
                      <li key={n.id}>
                        <button type="button" onClick={() => openOne(n)} className={cx('flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-app', !n.read && 'bg-primary-tint/40')}>
                          <span className={cx('mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full', tone)}><Icon width={17} height={17} /></span>
                          <span className="min-w-0 flex-1">
                            <span className={cx('block break-words text-[13.5px] leading-snug text-ink', !n.read && 'font-bold')}>{tr(n.title)}</span>
                            <span className="mt-0.5 block break-words text-[12.5px] text-muted">{tr(n.detail)}</span>
                            {n.at && <span className="mt-0.5 block text-[11.5px] text-slate-400">{formatDate(new Date(n.at))}</span>}
                          </span>
                          {!n.read && <span aria-label={tr('Haijasomwa')} className="mt-2 h-2.5 w-2.5 shrink-0 rounded-full bg-primary" />}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </div>,
          document.body,
        )}
    </>
  );
}
