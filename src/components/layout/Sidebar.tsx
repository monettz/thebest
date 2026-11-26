import type { ReactElement } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
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
import { ThemeToggle } from '@/components/ThemeToggle';
import { navFor, pageMeta, sectionsOf, type NavIcon, type NavItem } from './nav';
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
 * Section headings (KUU, BIDHAA…) with one rounded row per screen: icon, label, optional count. The current
 * screen is a filled pill in the brand colour. Drawn on the grey-green canvas, so hover lifts a row to white.
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
        <div key={s.title || si} className="flex shrink-0 flex-col gap-1">
          {s.title && (
            <span
              className={cx(
                'px-3.5 pb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted',
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
                    'flex min-w-0 shrink-0 items-center gap-3 rounded-full px-3.5 text-[13.5px] transition-colors',
                    isActive ? 'bg-primary font-semibold text-white' : 'font-medium text-body hover:bg-surface hover:text-ink',
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

/** SW / EN as white pills on the canvas; the chosen one is dark. */
export const LANG_PILL =
  'w-full !gap-1 !rounded-full !bg-surface !p-1 [&>button]:!rounded-full [&>button]:!shadow-none [&>[aria-checked=true]]:!bg-ink [&>[aria-checked=true]]:!text-app';

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
  const countOf = useNavCounts(role);
  const sections = sectionsOf(navFor(code, role));

  return (
    // Fixed, not sticky: index.css sets overflow-x:hidden on html/body/#root, which stops sticky from ever
    // sticking. AppShell keeps a 248px spacer beside it so content is never covered.
    <aside className="hidden w-[248px] flex-col overflow-hidden bg-app md:fixed md:inset-y-0 md:left-0 md:z-30 md:flex md:h-dvh [&_*]:box-border">
      {/* pt-6 and a 48px pill: the logo lines up exactly with the top bar's pills (TopBar: pt-6, h-12). */}
      <div className="shrink-0 space-y-4 px-4 pb-3 pt-6 [@media(max-height:740px)]:space-y-3">
        <Link to={code === 'STORE' ? '/store' : '/'} className="flex h-12 min-w-0 items-center gap-2.5 rounded-full bg-surface pl-1.5 pr-4">
          <BrandMark size={36} className="!rounded-full" />
          <span className="min-w-0 flex-1 leading-tight">
            <span className="block truncate text-[14px] font-bold tracking-[0.02em] text-ink">{tr('THE BEST')}</span>
            <span className="block truncate text-[11.5px] text-muted">{tr('Msaidizi wako wa POS')}</span>
          </span>
        </Link>
        <LocationSwitch value={code} onChange={onSwitch} variant="pill" />
      </div>

      <nav
        className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        aria-label={tr('Menyu kuu')}
      >
        <NavSections sections={sections} countOf={countOf} row={ROW} />
      </nav>

      <div className="shrink-0 space-y-2 px-4 pb-4 pt-3 [@media(max-height:740px)]:pb-3">
        <LanguageSwitch compact className={cx(LANG_PILL, '[&>button]:!min-h-[32px] [&>button]:!text-[12px]')} />
        <button
          type="button"
          onClick={logout}
          className="flex min-h-[40px] w-full items-center gap-3 rounded-full px-3.5 text-[13.5px] font-medium text-body transition-colors hover:bg-surface hover:text-bad-fg"
        >
          <LogoutIcon width={18} height={18} />
          {tr('Toka')}
        </button>
      </div>
    </aside>
  );
}

/**
 * Desktop top bar: a white pill naming the current screen on the left; notifications and the signed-in
 * person on the right. Every screen gets it, so the bell is in one place.
 */
export function TopBar({ code, user }: { code: LocationCode; user: SessionUser }) {
  const { pathname } = useLocation();
  const page = pageMeta(pathname, code);
  return (
    <div className="hidden h-[72px] items-end gap-3 px-8 md:flex lg:px-10">
      <div className="flex h-12 min-w-0 items-center gap-2.5 rounded-full bg-surface pl-1.5 pr-5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-app text-ink">
          {ICON[page.icon]({ width: 17, height: 17 })}
        </span>
        <span className="truncate text-[14px] font-semibold text-ink">{tr(page.label)}</span>
      </div>
      <div className="ml-auto flex items-center gap-3">
        <ThemeToggle className="!h-12 !w-12" />
        <NotificationBell className="!h-12 !w-12 !border-0 !bg-surface !shadow-none hover:!bg-surface/70" />
        <div className="flex h-12 min-w-0 max-w-[260px] items-center gap-2.5 rounded-full bg-surface pl-1.5 pr-5">
          <Avatar name={user.name} size={36} />
          <span className="min-w-0 leading-tight">
            <span className="block truncate text-[13px] font-semibold text-ink" title={user.name}>{user.name}</span>
            <span className="block truncate text-[11.5px] text-muted">{tr(ROLE_LABEL[user.role])}</span>
          </span>
        </div>
      </div>
    </div>
  );
}
