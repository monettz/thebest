import type { ReactElement } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
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

/**
 * Section headings (KUU, BIDHAA…) with one row per screen: icon, label, optional count.
 * Shared by the desktop sidebar and the phone drawer so both look the same.
 */
export function NavSections({
  sections,
  countOf,
  row = 'min-h-[44px]',
  onNavigate,
}: {
  sections: { title: string; items: NavItem[] }[];
  countOf: (it: NavItem) => number;
  row?: string;
  onNavigate?: () => void;
}) {
  return (
    <>
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
                key={it.to + it.label}
                to={it.to}
                end={it.end}
                onClick={onNavigate}
                className={({ isActive }) =>
                  cx(
                    row,
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
    </>
  );
}

/** Badge counts for the menu: customers who owe, and Store products at or under their minimum. */
export function useNavCounts(role: Role | undefined) {
  const { data: debts = 0 } = useQuery({ queryKey: ['debts'], queryFn: getDebtOverview, select: (d) => d.debtorCount, enabled: !!role });
  const { data: products } = useQuery({ queryKey: ['products', role], queryFn: () => listProducts(role!), enabled: !!role });
  const low = products?.filter((p) => p.storeStatus !== 'IPO').length ?? 0;
  return (it: NavItem) => (it.badge === 'debts' ? debts : it.badge === 'lowStock' ? low : 0);
}

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
  const { pathname } = useLocation();
  const { data: debts = 0 } = useQuery({ queryKey: ['debts'], queryFn: getDebtOverview, select: (d) => d.debtorCount });
  const { data: products } = useQuery({ queryKey: ['products', role], queryFn: () => listProducts(role) });
  const low = products?.filter((p) => p.storeStatus !== 'IPO').length ?? 0;
  const sections = sectionsOf(navFor(code, role));

  const countOf = (it: NavItem) => (it.badge === 'debts' ? debts : it.badge === 'lowStock' ? low : 0);

  return (
    // Fixed to the viewport height: header and footer never move, the menu in between is sized to fit.
    <aside className="hidden w-[248px] shrink-0 flex-col overflow-hidden border-r border-line bg-white md:sticky md:top-0 md:flex md:h-dvh [&_*]:box-border">
      <div className="shrink-0 space-y-5 px-4 pb-3 pt-5 [@media(max-height:740px)]:space-y-3 [@media(max-height:740px)]:pt-3">
        <div className="flex min-w-0 items-center gap-2.5 px-1.5">
          <BrandMark size={36} />
          <span className="min-w-0 flex-1 leading-tight">
            <span className="block truncate text-[15px] font-extrabold tracking-[0.02em] text-ink">{tr('THE BEST')}</span>
            <span className="block truncate text-[12px] text-muted">{tr('Msaidizi wako wa POS')}</span>
          </span>
          {/* The dashboard has the bell in its own header. */}
          {pathname !== '/' && <NotificationBell />}
        </div>
        <LocationSwitch value={code} onChange={onSwitch} variant="soft" />
      </div>

      <nav
        className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        aria-label={tr('Menyu kuu')}
      >
        <NavSections sections={sections} countOf={countOf} row={ROW} />
      </nav>

      <div className="shrink-0 space-y-2.5 border-t border-line-soft px-4 pb-4 pt-3 [@media(max-height:740px)]:space-y-2 [@media(max-height:740px)]:pb-3">
        <LanguageSwitch compact className="w-full !rounded-[10px] !bg-[#F1F5F9] [&>button]:!min-h-[30px] [&>button]:!text-[12px]" />
        <div className="flex min-w-0 items-center gap-2.5 rounded-[12px] border border-line p-2.5">
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
