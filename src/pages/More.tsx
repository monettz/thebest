import { Link } from 'react-router-dom';
import { ROLE_LABEL } from '@shared/constants';
import { useAuth } from '@/lib/auth';
import { LanguageSwitch } from '@/components/LanguageSwitch';
import { Avatar, Button, Card, cx } from '@/components/ui';
import { ChevronRight, LogoutIcon } from '@/components/ui/icons';
import { LANG_PILL } from '@/components/layout/Sidebar';
import { tr } from '@/i18n';

interface Entry { to: string; code: string; title: string; sub: string; ownerOnly?: boolean }

const SECTIONS: { title: string; dark?: boolean; items: Entry[] }[] = [
  {
    title: 'Duka',
    items: [
      { to: '/products', code: 'BD', title: 'Bidhaa na stock', sub: 'Bei na idadi store/dukani' },
      { to: '/sales', code: 'HM', title: 'Historia ya mauzo', sub: 'Rudisha bidhaa au futa mauzo' },
      { to: '/stock-in', code: 'IN', title: 'Ingiza stock', sub: 'Kutoka store au supplier' },
      { to: '/expenses', code: 'MT', title: 'Matumizi', sub: 'Rekodi gharama za duka' },
      { to: '/reports', code: 'RP', title: 'Ripoti', sub: 'Mauzo, faida na madeni' },
    ],
  },
  {
    title: 'Store',
    dark: true,
    items: [
      { to: '/store', code: 'ST', title: 'Store', sub: 'Stock kuu na uhamisho' },
      { to: '/store/receive', code: 'PM', title: 'Pokea mzigo', sub: 'Mzigo mpya kutoka supplier' },
      { to: '/store/suppliers', code: 'SP', title: 'Suppliers', sub: 'Wasambazaji na madeni yao', ownerOnly: true },
      { to: '/store/movements', code: 'RS', title: 'Ripoti za stock', sub: 'Historia ya mabadiliko ya stock' },
      { to: '/store/stock-take', code: 'HS', title: 'Kuhesabu stock', sub: 'Linganisha stock halisi' },
    ],
  },
  {
    title: 'Akaunti',
    items: [
      { to: '/users', code: 'WT', title: 'Watumiaji', sub: 'Ongeza wauzaji na simamia akaunti', ownerOnly: true },
      { to: '/settings', code: 'MP', title: 'Mipangilio', sub: 'Duka, SMS, risiti na stock', ownerOnly: true },
      { to: '/audit', code: 'KM', title: 'Kumbukumbu', sub: 'Matukio nyeti na mabadiliko', ownerOnly: true },
    ],
  },
];

export default function More() {
  const { user, logout } = useAuth();
  const isOwner = user!.role === 'owner';

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="mb-4 text-[24px] font-bold tracking-[-0.02em]">{tr('Zaidi')}</h1>
      <div className="mb-6 flex items-center gap-3.5 rounded-full bg-surface p-2 pr-5">
        <Avatar name={user!.name} size={52} />
        <div className="min-w-0">
          <p className="truncate text-[16px] font-bold text-ink">{user!.name}</p>
          <p className="text-[12.5px] text-muted">{tr(ROLE_LABEL[user!.role])} · THE BEST</p>
        </div>
      </div>

      {SECTIONS.map((sec) => {
        const items = sec.items.filter((i) => !i.ownerOnly || isOwner);
        if (!items.length) return null;
        return (
          <section key={sec.title} className="mb-6">
            <h2 className="mb-2 px-3.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">{tr(sec.title)}</h2>
            <Card className="overflow-hidden divide-y divide-line-soft">
              {items.map((it) => (
                <Link key={it.to} to={it.to} className="flex min-h-[64px] items-center gap-3.5 px-4 py-3 transition-colors hover:bg-app">
                  <span
                    className={cx(
                      'flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[12.5px] font-bold',
                      sec.dark ? 'bg-ink text-app' : 'bg-app text-ink',
                    )}
                  >
                    {it.code}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] font-semibold text-ink">{tr(it.title)}</span>
                    <span className="block text-[13px] text-muted">{tr(it.sub)}</span>
                  </span>
                  <ChevronRight className="text-muted" />
                </Link>
              ))}
            </Card>
          </section>
        );
      })}

      <section className="mb-5">
        <h2 className="mb-2 px-3.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Language / Lugha</h2>
        <LanguageSwitch className={LANG_PILL} />
      </section>

      <Button variant="outline" block onClick={logout} className="rounded-full border-0"><LogoutIcon width={18} height={18} /> {tr('Toka')}</Button>
    </div>
  );
}
