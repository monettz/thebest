import type { LocationCode, Role } from '@shared/constants';

export type NavIcon =
  | 'grid' | 'bag' | 'box' | 'inbox' | 'contact' | 'clipboard' | 'wallet' | 'chart' | 'users' | 'settings' | 'transfer' | 'check';

export interface NavItem {
  to: string;
  label: string;
  icon: NavIcon;
  /** Items that share a group are drawn together under a collapsible heading (desktop sidebar). */
  group?: string;
  end?: boolean;
  ownerOnly?: boolean;
  badge?: 'debts' | 'lowStock';
}

export const SHOP_NAV: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: 'grid', end: true },
  { to: '/pos', label: 'Mauzo (POS)', icon: 'bag' },
  { to: '/products', label: 'Bidhaa na stock', icon: 'box', group: 'Stock' },
  { to: '/stock-in', label: 'Ingiza stock', icon: 'inbox', group: 'Stock' },
  { to: '/customers', label: 'Wateja', icon: 'contact' },
  { to: '/debts', label: 'Madeni', icon: 'clipboard', badge: 'debts' },
  { to: '/expenses', label: 'Matumizi', icon: 'wallet' },
  { to: '/reports', label: 'Ripoti', icon: 'chart' },
  { to: '/users', label: 'Watumiaji', icon: 'users', ownerOnly: true },
  { to: '/settings', label: 'Mipangilio', icon: 'settings', ownerOnly: true },
];

/**
 * Suppliers is no longer a menu item: the supplier is an optional field when receiving stock.
 * The page (/store/suppliers) and its data stay, reachable from the receiving form.
 */
export const STORE_NAV: NavItem[] = [
  { to: '/store', label: 'Dashboard', icon: 'grid', end: true },
  { to: '/store/receive', label: 'Pokea mzigo', icon: 'inbox' },
  { to: '/products', label: 'Bidhaa za store', icon: 'box', badge: 'lowStock' },
  { to: '/stock-in', label: 'Hamisha dukani', icon: 'transfer' },
  { to: '/store/stock-take', label: 'Kuhesabu stock', icon: 'check' },
  { to: '/store/movements', label: 'Ripoti za stock', icon: 'chart' },
];

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
