import { useState, type ReactElement } from 'react';
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
  ChevronDown,
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
import { navFor, type NavIcon, type NavItem } from './nav';
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

type Entry = { kind: 'item'; item: NavItem } | { kind: 'group'; title: string; icon: NavIcon; items: NavItem[] };

/** Consecutive items that share a `group` become one collapsible section. */
function entriesOf(items: NavItem[]): Entry[] {
  const out: Entry[] = [];
  for (const item of items) {
    const last = out[out.length - 1];
    if (item.group && last?.kind === 'group' && last.title === item.group) last.items.push(item);
    else if (item.group) out.push({ kind: 'group', title: item.group, icon: item.icon, items: [item] });
    else out.push({ kind: 'item', item });
  }
  return out;
}

// Row heights step down on short screens so the whole menu always fits without scrolling.
const ROW = 'min-h-[44px] [@media(max-height:860px)]:min-h-[40px] [@media(max-height:740px)]:min-h-[34px]';

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
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const { data: debts = 0 } = useQuery({ queryKey: ['debts'], queryFn: getDebtOverview, select: (d) => d.debtorCount });
  const { data: products } = useQuery({ queryKey: ['products', role], queryFn: () => listProducts(role) });
  const low = products?.filter((p) => p.storeStatus !== 'IPO').length ?? 0;
  const entries = entriesOf(navFor(code, role));

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
        className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-3 py-2 [@media(max-height:740px)]:gap-0.5 [@media(max-height:740px)]:py-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        aria-label={tr('Menyu kuu')}
      >
        {entries.map((e) => {
          if (e.kind === 'item') {
            const it = e.item;
            const count = countOf(it);
            return (
              <NavLink
                key={it.label}
                to={it.to}
                end={it.end}
                className={({ isActive }) =>
                  cx(
                    ROW,
                    'flex min-w-0 shrink-0 items-center gap-3 rounded-[12px] px-3.5 text-[14.5px] font-medium transition-colors',
                    isActive ? 'bg-primary font-semibold text-white shadow-sm' : 'text-body hover:bg-app',
                  )
                }
              >
                {ICON[it.icon]({ width: 20, height: 20 })}
                <span className="min-w-0 flex-1 truncate">{tr(it.label)}</span>
                {count > 0 && (
                  <Badge tone={it.badge === 'lowStock' ? 'bad' : 'warn'} className="min-w-[22px] shrink-0 justify-center">
                    {count}
                  </Badge>
                )}
              </NavLink>
            );
          }

          const childActive = e.items.some((i) => (i.end ? pathname === i.to : pathname === i.to || pathname.startsWith(`${i.to}/`)));
          const open = childActive || !closed[e.title];
          return (
            <div key={e.title} className="shrink-0">
              <button
                type="button"
                aria-expanded={open}
                onClick={() => setClosed((c) => ({ ...c, [e.title]: open }))}
                className={cx(
                  ROW,
                  'flex w-full min-w-0 items-center gap-3 rounded-[12px] px-3.5 text-[14.5px] transition-colors hover:bg-app',
                  childActive ? 'font-bold text-ink' : 'font-medium text-body',
                )}
              >
                <span className={childActive ? 'text-primary' : ''}>{ICON[e.icon]({ width: 20, height: 20 })}</span>
                <span className="min-w-0 flex-1 truncate text-left">{tr(e.title)}</span>
                <span className={cx('transition-transform', open ? 'rotate-180' : '')}>
                  <ChevronDown width={16} height={16} />
                </span>
              </button>
              {open && (
                <div className="mt-0.5 flex flex-col gap-0.5">
                  {e.items.map((it) => {
                    const count = countOf(it);
                    return (
                      <NavLink
                        key={it.label}
                        to={it.to}
                        end={it.end}
                        className={({ isActive }) =>
                          cx(
                            'flex min-h-[36px] min-w-0 items-center gap-2 rounded-[10px] pl-[46px] pr-3.5 text-[13.5px] transition-colors [@media(max-height:740px)]:min-h-[30px]',
                            isActive ? 'font-semibold text-primary-link' : 'text-muted hover:bg-app hover:text-ink',
                          )
                        }
                      >
                        {({ isActive }) => (
                          <>
                            <span className="min-w-0 flex-1 truncate">{tr(it.label)}</span>
                            {count > 0 && (
                              <Badge tone={it.badge === 'lowStock' ? 'bad' : 'warn'} className="min-w-[22px] shrink-0 justify-center">
                                {count}
                              </Badge>
                            )}
                            {isActive && <CheckIcon width={16} height={16} />}
                          </>
                        )}
                      </NavLink>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      <div className="shrink-0 space-y-2.5 border-t border-line-soft px-4 pb-4 pt-3 [@media(max-height:740px)]:space-y-2 [@media(max-height:740px)]:pb-3">
        <LanguageSwitch compact className="w-full" />
        <div className="flex min-w-0 items-center gap-3 rounded-field bg-app p-2.5">
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
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted transition hover:bg-white hover:text-bad-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            <LogoutIcon width={18} height={18} />
          </button>
        </div>
      </div>
    </aside>
  );
}
