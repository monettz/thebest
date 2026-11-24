import type { ReactElement } from 'react';
import { NavLink } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { LocationCode, Role } from '@shared/constants';
import { ROLE_LABEL } from '@shared/constants';
import { LanguageSwitch } from '@/components/LanguageSwitch';
import { BrandMark } from '@/components/BrandMark';
import { Avatar, Badge, cx } from '@/components/ui';
import {
  BagIcon,
  BoxIcon,
  ChartIcon,
  CheckIcon,
  ClipboardIcon,
  ContactIcon,
  GridIcon,
  InboxIcon,
  LogoutIcon,
  SettingsIcon,
  TransferIcon,
  UsersIcon,
  WalletIcon,
} from '@/components/ui/icons';
import { useAuth } from '@/lib/auth';
import { listProducts } from '@/mock/api';
import { getDebtOverview } from '@/mock/sales';
import type { SessionUser } from '@/mock/auth';
import { LocationSwitch } from './LocationSwitch';
import { NotificationBell } from './NotificationBell';
import { navFor, sectionsOf, type NavIcon, type NavItem } from './nav';
import { tr } from '@/i18n';

const ICON: Record<NavIcon, (p: { width: number; height: number }) => ReactElement> = {
  grid: (p) => <GridIcon {...p} />,
  bag: (p) => <BagIcon {...p} />,
  box: (p) => <BoxIcon {...p} />,
  inbox: (p) => <InboxIcon {...p} />,
  contact: (p) => <ContactIcon {...p} />,
  clipboard: (p) => <ClipboardIcon {...p} />,
  wallet: (p) => <WalletIcon {...p} />,
  chart: (p) => <ChartIcon {...p} />,
  users: (p) => <UsersIcon {...p} />,
  settings: (p) => <SettingsIcon {...p} />,
  transfer: (p) => <TransferIcon {...p} />,
  check: (p) => <CheckIcon {...p} />,
};

// Row heights step down on short screens so the whole menu always fits without scrolling.
const ROW = 'min-h-[40px] [@media(max-height:860px)]:min-h-[36px] [@media(max-height:740px)]:min-h-[32px]';

export function Sidebar({
  code,
  onSwitch,
  user,
}: {
  code: LocationCode;
  onSwitch: (c: LocationCode) => void;
  user: SessionUser;
}) {
  const role: Role = user.role;
  const { logout } = useAuth();
  const { data: debts = 0 } = useQuery({ queryKey: ['debts'], queryFn: getDebtOverview, select: (d) => d.debtorCount });
  const { data: products } = useQuery({ queryKey: ['products', role], queryFn: () => listProducts(role) });
  const low = products?.filter((p) => p.storeStatus !== 'IPO').length ?? 0;
  const sections = sectionsOf(navFor(code, role));

  const countOf = (it: NavItem) => (it.badge === 'debts' ? debts : it.badge === 'lowStock' ? low : 0);

  return (
    // Fixed to the viewport height: header and footer never move, the menu in between is sized to fit.
    <aside className="hidden w-[256px] shrink-0 flex-col overflow-hidden border-r border-line-soft bg-white md:sticky md:top-0 md:flex md:h-dvh [&_*]:box-border">
      <div className="shrink-0 space-y-3 px-4 pb-3 pt-5 [@media(max-height:740px)]:space-y-2 [@media(max-height:740px)]:pt-3">
        <div className="flex min-w-0 items-center gap-3">
          <BrandMark size={40} />
          <span className="min-w-0 flex-1 leading-tight">
            <span className="block truncate text-[15px] font-extrabold tracking-wide text-ink">{tr('THE BEST')}</span>
            <span className="block truncate text-[12.5px] text-muted">{tr('Msaidizi wako wa POS')}</span>
          </span>
          <NotificationBell />
        </div>
        <LocationSwitch value={code} onChange={onSwitch} />
      </div>

      <nav
        className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        aria-label={tr('Menyu kuu')}
      >
        {sections.map((s, si) => (
          <div key={s.title || si} className="flex shrink-0 flex-col gap-0.5">
            {s.title && (
              <span
                className={cx(
                  'px-2.5 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted',
                  si > 0 && 'pt-4 [@media(max-height:860px)]:pt-2.5 [@media(max-height:740px)]:pt-1.5',
                )}
              >
                {tr(s.title)}
              </span>
            )}
            {s.items.map((it) => {
              const count = countOf(it);
              return (
                <NavLink
                  key={it.label}
                  to={it.to}
                  end={it.end}
                  className={({ isActive }) =>
                    cx(
                      ROW,
                      'flex min-w-0 shrink-0 items-center gap-3 rounded-[10px] px-2.5 text-[14px] transition-colors',
                      isActive ? 'bg-primary-tint font-semibold text-primary-link' : 'font-medium text-body hover:bg-app',
                    )
                  }
                >
                  {ICON[it.icon]({ width: 18, height: 18 })}
                  <span className="min-w-0 flex-1 truncate">{tr(it.label)}</span>
                  {count > 0 && (
                    <Badge tone={it.badge === 'lowStock' ? 'bad' : 'warn'} className="min-w-[22px] shrink-0 justify-center">
                      {count}
                    </Badge>
                  )}
                </NavLink>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="shrink-0 space-y-2.5 border-t border-line-soft px-4 pb-4 pt-3 [@media(max-height:740px)]:space-y-2 [@media(max-height:740px)]:pb-3">
        <LanguageSwitch compact className="w-full" />
        <div className="flex min-w-0 items-center gap-3 rounded-field border border-line p-2.5">
          <Avatar name={user.name} size={36} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13.5px] font-bold text-ink" title={user.name}>{user.name}</p>
            <p className="truncate text-[12px] text-muted">{tr(ROLE_LABEL[role])}</p>
          </div>
          <button
            type="button"
            onClick={logout}
            aria-label={tr('Toka')}
            title={tr('Toka')}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted transition hover:bg-app hover:text-bad-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            <LogoutIcon width={18} height={18} />
          </button>
        </div>
      </div>
    </aside>
  );
}
