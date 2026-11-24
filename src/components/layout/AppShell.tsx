import { Suspense, useEffect, useState } from 'react';
import { Link, Navigate, Outlet, useLocation } from 'react-router-dom';
import { ROLE_LABEL } from '@shared/constants';
import { useAuth } from '@/lib/auth';
import { useLocationCode } from '@/lib/location';
import { useScheduler } from '@/lib/useScheduler';
import { LanguageSwitch } from '@/components/LanguageSwitch';
import { Avatar, Spinner } from '@/components/ui';
import { LogoutIcon, MenuIcon, PlusIcon } from '@/components/ui/icons';
import { BrandMark } from '@/components/BrandMark';
import { LocationSwitch } from './LocationSwitch';
import { NotificationBell } from './NotificationBell';
import { drawerGroups, sectionsOf } from './nav';
import { NavSections, Sidebar, useNavCounts } from './Sidebar';
import { tr } from '@/i18n';

export function AppShell() {
  const { user, isOwner, logout, ready } = useAuth();
  useScheduler(isOwner);
  const { code, switchTo } = useLocationCode();
  const { pathname } = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const countOf = useNavCounts(user?.role);

  // A new screen starts at the top and closes the drawer.
  useEffect(() => {
    window.scrollTo(0, 0);
    setMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  if (!ready) return <div className="p-6"><Spinner /></div>;
  if (!user) return <Navigate to="/login" replace />;
  // The POS has its own mobile header (with a back button) and cart bar.
  const posMobile = pathname === '/pos';
  // Selling is open to every signed-in role today; gate it here if that rule ever changes.
  const canSell = true;
  // The phone drawer: the shop menu under its section headings, then the Store-only screens.
  const [shopItems, storeItems] = drawerGroups(user.role).map((g) => g.items);
  const drawerSections = [...sectionsOf(shopItems), ...(storeItems.length ? [{ title: 'Store', items: storeItems }] : [])];

  return (
    <div className="min-h-screen bg-white">
      {/* One layout: a fixed-width sidebar and a content area that takes the rest. (It used to sit as a bordered, rounded card
          inside a padded, max-width page, which read as two nested layouts and left empty bands on wide screens.)
          overflow-x-clip, not hidden, so the sidebar below can still be sticky. */}
      <div className="flex min-h-screen w-full max-w-full overflow-x-clip bg-white">
        <Sidebar code={code} onSwitch={switchTo} user={user} />
        <div aria-hidden className="hidden w-[248px] shrink-0 md:block" />

        <div className="flex min-w-0 flex-1 flex-col">
          {/* Phone header: menu on the left, brand, notifications on the right */}
          {!posMobile && (
            <header className="sticky top-0 z-30 flex items-center gap-2.5 border-b border-line bg-white px-3.5 py-2 md:hidden">
              <button
                type="button"
                aria-label={tr('Menyu kuu')}
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen(true)}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] border border-line bg-white text-ink active:scale-[0.98]"
              >
                <MenuIcon width={20} height={20} />
              </button>
              <Link to={code === 'STORE' ? '/store' : '/'} className="flex min-w-0 flex-1 items-center gap-2">
                <BrandMark size={36} />
                <span className="truncate text-[16px] font-extrabold tracking-wide text-ink">{tr('THE BEST')}</span>
              </Link>
              <NotificationBell />
            </header>
          )}

          <main className="flex-1 bg-app px-3.5 pb-28 pt-3.5 sm:px-4 md:px-8 md:py-7 lg:px-10">
            <div key={pathname} className="animate-page-in mx-auto min-w-0 max-w-[1520px]">
              <Suspense fallback={<Spinner />}>
                <Outlet />
              </Suspense>
            </div>
          </main>
        </div>
      </div>

      {/* Floating Sell button (phones): opens the existing POS. Separate from the menu. */}
      {canSell && !posMobile && (
        <Link
          to="/pos"
          aria-label={tr('Uza')}
          className="fixed right-4 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-white shadow-lg ring-4 ring-white active:scale-95 md:hidden"
          style={{ bottom: 'max(20px, env(safe-area-inset-bottom))' }}
        >
          <PlusIcon width={26} height={26} />
        </Link>
      )}

      {/* Phone navigation drawer */}
      {menuOpen && (
        <div className="fixed inset-0 z-50 flex bg-slate-900/35 animate-fade-in md:hidden" onClick={() => setMenuOpen(false)}>
          <aside
            role="dialog"
            aria-label={tr('Menyu kuu')}
            className="flex h-full w-[288px] max-w-[86vw] flex-col bg-white p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-line pb-3.5">
              <div className="flex items-center gap-2.5">
                <BrandMark size={36} />
                <span className="text-[16px] font-extrabold tracking-wide text-ink">{tr('THE BEST')}</span>
              </div>
              <button
                type="button"
                onClick={() => setMenuOpen(false)}
                className="inline-flex h-9 items-center justify-center rounded-[8px] border border-line bg-app px-2.5 text-[12.5px] font-semibold text-muted"
              >
                {tr('Funga')}
              </button>
            </div>

            <div className="mt-4 flex-1 overflow-y-auto overscroll-contain">
              <LocationSwitch value={code} onChange={(c) => { switchTo(c); setMenuOpen(false); }} variant="soft" className="mb-4" />
              <nav className="flex flex-col" aria-label={tr('Menyu kuu')}>
                <NavSections sections={drawerSections} countOf={countOf} onNavigate={() => setMenuOpen(false)} />
              </nav>
            </div>

            <div className="mt-3 space-y-2.5 border-t border-line-soft pt-3">
              <LanguageSwitch compact className="w-full !rounded-[10px] !bg-[#F1F5F9] [&>button]:!min-h-[36px] [&>button]:!text-[12.5px]" />
              <div className="flex items-center gap-2.5 rounded-[12px] border border-line p-2.5">
                <Avatar name={user.name} size={36} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-bold text-ink">{user.name}</p>
                  <p className="truncate text-[11.5px] text-muted">{tr(ROLE_LABEL[user.role])}</p>
                </div>
                <button type="button" onClick={logout} aria-label={tr('Toka')} title={tr('Toka')} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-app hover:text-bad-fg">
                  <LogoutIcon width={18} height={18} />
                </button>
              </div>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
