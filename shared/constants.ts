export const ROLES = ['owner', 'seller'] as const;
export type Role = (typeof ROLES)[number];
export const ROLE_LABEL: Record<Role, string> = { owner: 'Mmiliki', seller: 'Muuzaji' };

export const LOCATIONS = ['SHOP', 'STORE'] as const;
export type LocationCode = (typeof LOCATIONS)[number];
export const LOCATION_LABEL: Record<LocationCode, string> = { SHOP: 'Duka', STORE: 'Store' };

/** The only methods the shop accepts for anything NEW: sales, debt payments, expenses, supplier payments. */
export const PAYMENT_METHODS = ['CASH', 'LIPA_NAMBA', 'BANK'] as const;
/** Methods that exist only in old records. They are still read and reported, never offered. */
export const LEGACY_PAYMENT_METHODS = ['MPESA', 'MIXX', 'AIRTEL'] as const;
export const ALL_PAYMENT_METHODS = [...PAYMENT_METHODS, ...LEGACY_PAYMENT_METHODS] as const;
/** Any method that can appear on a stored record (old or new). */
export type PaymentMethod = (typeof ALL_PAYMENT_METHODS)[number];
export type ShopPaymentMethod = (typeof PAYMENT_METHODS)[number];
export const PAYMENT_LABEL: Record<PaymentMethod, string> = {
  CASH: 'Cash',
  LIPA_NAMBA: 'Lipa Namba',
  BANK: 'Bank',
  MPESA: 'M-Pesa (old)',
  MIXX: 'Mixx (old)',
  AIRTEL: 'Airtel (old)',
};
export const isShopPaymentMethod = (m: string): m is ShopPaymentMethod => (PAYMENT_METHODS as readonly string[]).includes(m);

/** Kept for the POS checkout, which uses the same three. */
export const POS_PAYMENT_METHODS: readonly PaymentMethod[] = PAYMENT_METHODS;

export const PRODUCT_TYPES = ['phone', 'accessory'] as const;
export type ProductType = (typeof PRODUCT_TYPES)[number];

export const STOCK_STATUSES = ['IPO', 'CHINI', 'IMEISHA'] as const;
export type StockStatus = (typeof STOCK_STATUSES)[number];
export const STOCK_STATUS_LABEL: Record<StockStatus, string> = {
  IPO: 'Ipo',
  CHINI: 'Chini',
  IMEISHA: 'Imeisha',
};

export const MAX_FAILED_PINS = 5;
export const LOCK_MINUTES = 5;
export const APP_TIMEZONE = 'Africa/Dar_es_Salaam';
