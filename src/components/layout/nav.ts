import type { LocationCode, Role } from '@shared/constants';

export type NavIcon =
  | 'grid' | 'bag' | 'box' | 'inbox' | 'contact' | 'clipboard' | 'wallet' | 'chart' | 'users' | 'settings' | 'transfer' | 'check';

export interface NavItem {
  to: string;
  label: string;
  icon: NavIcon;
  /** Desktop sidebar heading this item sits under; consecutive items share one heading. */
  section?: string;
  end?: boolean;
  ownerOnly?: boolean;
  badge?: 'debts' | 'lowStock';
}

export const SHOP_NAV: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: 'grid', end: true, section: 'Kuu' },
  { to: '/pos', label: 'Mauzo (POS)', icon: 'bag', section: 'Kuu' },
  { to: '/products', label: 'Bidhaa na stock', icon: 'box', section: 'Bidhaa' },
  { to: '/stock-in', label: 'Ingiza stock', icon: 'inbox', section: 'Bidhaa' },
  { to: '/customers', label: 'Wateja', icon: 'contact', section: 'Fedha' },
  { to: '/debts', label: 'Madeni', icon: 'clipboard', badge: 'debts', section: 'Fedha' },
  { to: '/expenses', label: 'Matumizi', icon: 'wallet', section: 'Fedha' },
  { to: '/reports', label: 'Ripoti', icon: 'chart', section: 'Fedha' },
  { to: '/users', label: 'Watumiaji', icon: 'users', ownerOnly: true, section: 'Mfumo' },
  { to: '/settings', label: 'Mipangilio', icon: 'settings', ownerOnly: true, section: 'Mfumo' },
];

/**
 * Suppliers is no longer a menu item: the supplier is an optional field when receiving stock.
 * The page (/store/suppliers) and its data stay, reachable from the receiving form.
 */
export const STORE_NAV: NavItem[] = [
  { to: '/store', label: 'Dashboard', icon: 'grid', end: true, section: 'Kuu' },
  { to: '/store/receive', label: 'Pokea mzigo', icon: 'inbox', section: 'Mzigo' },
  { to: '/products', label: 'Bidhaa za store', icon: 'box', badge: 'lowStock', section: 'Mzigo' },
  { to: '/stock-in', label: 'Hamisha dukani', icon: 'transfer', section: 'Mzigo' },
  { to: '/store/stock-take', label: 'Kuhesabu stock', icon: 'check', section: 'Udhibiti' },
  { to: '/store/movements', label: 'Ripoti za stock', icon: 'chart', section: 'Udhibiti' },
];

/** Consecutive items that share a `section`, in menu order. */
export function sectionsOf(items: NavItem[]): { title: string; items: NavItem[] }[] {
  const out: { title: string; items: NavItem[] }[] = [];
  for (const item of items) {
    const title = item.section ?? '';
    const last = out[out.length - 1];
    if (last && last.title === title) last.items.push(item);
    else out.push({ title, items: [item] });
  }
  return out;
}

export function navFor(code: LocationCode, role: Role): NavItem[] {
  return (code === 'STORE' ? STORE_NAV : SHOP_NAV).filter((i) => !i.ownerOnly || role === 'owner');
}

/**
 * The phone drawer lists everything in one place: the shop sections first, then the Store-only
 * screens (pages already in the shop list are not repeated).
 */
export function drawerGroups(role: Role): { title: string; items: NavItem[] }[] {
  const shop = SHOP_NAV.filter((i) => !i.ownerOnly || role === 'owner');
  const seen = new Set(shop.map((i) => i.to));
  const store = STORE_NAV.filter((i) => (!i.ownerOnly || role === 'owner') && !seen.has(i.to));
  return [
    { title: 'Menyu', items: shop },
    { title: 'Menyu ya store', items: store },
  ];
}
