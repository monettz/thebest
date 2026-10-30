/**
 * Sample data used until the real database (Neon + Drizzle) is connected.
 * All names, phones and amounts are fake.
 */
import type { ProductType, Role } from '@shared/constants';

export interface SeedUser {
  id: number;
  name: string;
  phone: string; // normalized 255XXXXXXXXX
  pin: string;
  role: Role;
  isActive: boolean;
}

export const SEED_USERS: SeedUser[] = [
  { id: 1, name: 'Mmiliki Mkuu', phone: '255712000001', pin: '1234', role: 'owner', isActive: true },
  { id: 2, name: 'Muuzaji Mmoja', phone: '255712000002', pin: '4321', role: 'seller', isActive: true },
];

export interface SeedProduct {
  id: number;
  name: string;
  detail: string;
  type: ProductType;
  code: string;
  costPrice: number;
  sellPrice: number;
  minStock: number;
  storeQty: number;
  shopQty: number;
  soldThisWeek: number;
  barcode?: string;
  imageUrl?: string;
}

export const SEED_PRODUCTS: SeedProduct[] = [
  { id: 1, name: 'Samsung A15', detail: '128GB', type: 'phone', code: 'A15', costPrice: 780000, sellPrice: 900000, minStock: 5, storeQty: 24, shopQty: 6, soldThisWeek: 14 },
  { id: 2, name: 'Tecno Spark 20', detail: '256GB', type: 'phone', code: 'SP', costPrice: 410000, sellPrice: 480000, minStock: 5, storeQty: 18, shopQty: 6, soldThisWeek: 9 },
  { id: 3, name: 'iPhone 11', detail: '64GB', type: 'phone', code: 'IP', costPrice: 950000, sellPrice: 1150000, minStock: 3, storeQty: 2, shopQty: 1, soldThisWeek: 3 },
  { id: 4, name: 'Redmi 13', detail: '128GB', type: 'phone', code: 'RM', costPrice: 360000, sellPrice: 420000, minStock: 5, storeQty: 10, shopQty: 4, soldThisWeek: 5 },
  { id: 5, name: 'Screen protector A15', detail: '', type: 'accessory', code: 'PR', costPrice: 3000, sellPrice: 10000, minStock: 50, storeQty: 420, shopQty: 37, soldThisWeek: 63 },
  { id: 6, name: 'Charger 25W', detail: '', type: 'accessory', code: 'CH', costPrice: 18000, sellPrice: 35000, minStock: 20, storeQty: 12, shopQty: 18, soldThisWeek: 31 },
  { id: 7, name: 'Phone cover', detail: '', type: 'accessory', code: 'CV', costPrice: 5000, sellPrice: 15000, minStock: 30, storeQty: 310, shopQty: 42, soldThisWeek: 27 },
  { id: 8, name: 'Earbuds', detail: '', type: 'accessory', code: 'EB', costPrice: 25000, sellPrice: 45000, minStock: 10, storeQty: 0, shopQty: 9, soldThisWeek: 7 },
];

/** Last 7 days of sales; last entry is "today". */
export const WEEK_SALES = [1_900_000, 3_100_000, 1_200_000, 2_600_000, 2_200_000, 2_800_000, 3_450_000];

export const SEED_DEBTORS = [
  { id: 1, name: 'Juma Hassan', item: 'Samsung A15', since: '28 Okt', amount: 200000, tag: { kind: 'soon', label: 'Siku 2' } },
  { id: 2, name: 'Amina Mussa', item: 'Tecno Spark 20', since: '20 Okt', amount: 300000, tag: { kind: 'soon', label: 'Siku 10' } },
  { id: 3, name: 'Peter Kimaro', item: 'iPhone 11', since: '2 Okt', amount: 650000, tag: { kind: 'overdue', label: 'Imepita tarehe' } },
  { id: 4, name: 'Saida Ngowi', item: 'Redmi 13', since: '25 Okt', amount: 150000, tag: { kind: 'soon', label: 'Siku 5' } },
] as const;

export const SEED_RECEIPTS = [
  { id: 1, supplier: 'Supplier A', lines: 'Samsung A15 ×10 · Protector ×200', total: 8_400_000, date: '28 Okt' },
  { id: 2, supplier: 'Supplier B', lines: 'Charger 25W ×30 · Cover ×100', total: 1_040_000, date: '26 Okt' },
  { id: 3, supplier: 'Supplier A', lines: 'Tecno Spark 20 ×6', total: 2_460_000, date: '24 Okt' },
];

export const SEED_TRANSFERS = [
  { id: 1, item: 'Screen protector A15', by: 'Na muuzaji', time: '10:24', qty: 20, when: 'Leo' },
  { id: 2, item: 'Samsung A15 (IMEI 2)', by: 'Na muuzaji', time: '09:10', qty: 2, when: 'Leo' },
  { id: 3, item: 'Phone cover', by: 'Na muuzaji', time: '16:45', qty: 15, when: 'Jana' },
];

export const DEFAULT_SETTINGS = {
  shopName: 'THE BEST',
  shopPhone: '',
  shopAddress: '',
  receiptFooter: 'Asante kwa kununua THE BEST',
  smsDaily: true,
  smsPurchase: false,
  smsDebtPayment: true,
  smsReminders: true,
  dailyTime: '21:00',
  ownerPhone: '',
  defaultMinStock: 5,
  printerWidth: '80' as '80' | '58',
  maxDiscountPct: 5,
};
export type Settings = typeof DEFAULT_SETTINGS;
