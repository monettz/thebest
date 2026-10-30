import { z } from 'zod';
import { PRODUCT_TYPES } from './constants';

/** TZ mobile numbers: 07XXXXXXXX, 06XXXXXXXX, 2557XXXXXXXX, +2556XXXXXXXX. */
export function normalizePhone(input: string): string | null {
  const d = input.replace(/[\s\-()+]/g, '');
  if (/^0[67]\d{8}$/.test(d)) return '255' + d.slice(1);
  if (/^255[67]\d{8}$/.test(d)) return d;
  return null;
}

export const phoneSchema = z
  .string()
  .trim()
  .min(1, 'Weka namba ya simu')
  .refine((v) => normalizePhone(v) !== null, 'Namba ya simu si sahihi');

export const pinSchema = z.string().regex(/^\d{4}$/, 'PIN lazima iwe tarakimu 4');

export const loginSchema = z.object({
  phone: phoneSchema,
  pin: pinSchema,
  remember: z.boolean().optional(),
});
export type LoginInput = z.infer<typeof loginSchema>;

const optionalPhone = z
  .string()
  .trim()
  .refine((v) => v === '' || normalizePhone(v) !== null, 'Namba ya simu si sahihi');

/** Used by the Customers page AND the POS, so both apply the same rules. Only the name is required. */
export const customerSchema = z.object({
  name: z.string().trim().min(2, 'Weka jina la mteja'),
  phone: optionalPhone.optional().default(''),
  email: z
    .string()
    .trim()
    .refine((v) => v === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), 'Barua pepe si sahihi')
    .optional()
    .default(''),
  area: z.string().trim().max(200, 'Maelezo ni marefu mno').optional().default(''),
  notes: z.string().trim().max(500, 'Maelezo ni marefu mno').optional().default(''),
  idNumber: z.string().trim().optional(),
});
export type CustomerFormValues = z.input<typeof customerSchema>;

const money = (label: string) =>
  z.coerce
    .number({ invalid_type_error: `${label} lazima iwe namba` })
    .int(`${label} lazima iwe namba kamili`)
    .min(0, `${label} haiwezi kuwa hasi`);

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB
export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'] as const;

export function validateImageFile(file: { name: string; type: string; size: number }): string | null {
  const mimeOk = ALLOWED_IMAGE_TYPES.includes(file.type.toLowerCase() as (typeof ALLOWED_IMAGE_TYPES)[number]);
  const extOk = /\.(jpe?g|png|webp)$/i.test(file.name);
  if (!mimeOk && !extOk) {
    return 'Aina ya faili haikubaliki. Tumia JPG, PNG au WEBP.';
  }
  if (file.size <= 0) {
    return 'Faili ya picha ni tupu.';
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return 'Picha ni kubwa kuliko MB 5. Chagua picha ndogo.';
  }
  return null;
}

function isValidImei(digits: string): boolean {
  if (!/^\d{15}$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < 15; i++) {
    let d = Number(digits[14 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

const baseProductShape = {
  name: z.string().trim().min(2, 'Weka jina la bidhaa'),
  detail: z.string().trim().optional(),
  type: z.enum(PRODUCT_TYPES),
  costPrice: money('Bei ya kununua'),
  sellPrice: money('Bei ya kuuza'),
  minStock: money('Kiwango cha chini'),
  code: z.string().trim().optional(),
  barcode: z.string().trim().optional(),
  imageUrl: z.string().trim().optional(),
};

export const productUpdateSchema = z
  .object(baseProductShape)
  .refine((p) => p.sellPrice >= p.costPrice, {
    message: 'Bei ya kuuza iko chini ya bei ya kununua',
    path: ['sellPrice'],
  });
export type ProductUpdateInput = z.infer<typeof productUpdateSchema>;

export const productSchema = z
  .object({
    ...baseProductShape,
    initialShopQty: z.any(),
    imeis: z.array(z.string().trim()).optional().default([]),
  })
  .superRefine((p, ctx) => {
    if (p.sellPrice < p.costPrice) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Bei ya kuuza iko chini ya bei ya kununua',
        path: ['sellPrice'],
      });
    }

    const rawQty = p.initialShopQty;
    const isBlank =
      rawQty === '' ||
      rawQty === null ||
      rawQty === undefined ||
      typeof rawQty === 'boolean' ||
      (typeof rawQty === 'string' && rawQty.trim() === '');
    const numQty = isBlank ? NaN : Number(rawQty);

    if (!Number.isFinite(numQty)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Weka idadi ya awali dukani',
        path: ['initialShopQty'],
      });
      return;
    }
    if (!Number.isInteger(numQty)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Idadi ya awali dukani lazima iwe namba kamili',
        path: ['initialShopQty'],
      });
      return;
    }
    if (numQty < 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Idadi ya awali dukani lazima iwe angalau 1',
        path: ['initialShopQty'],
      });
      return;
    }

    if (p.type === 'phone') {
      const imeis = p.imeis ?? [];
      // IMEI ni hiari: unaweza kuweka 0 hadi idadi ya simu; zisizo na IMEI zinahesabiwa kwa idadi tu.
      if (imeis.length > numQty) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `IMEI zisizidi ${numQty} (umeweka ${imeis.length})`,
          path: ['imeis'],
        });
      }
      const seen = new Set<string>();
      for (const imei of imeis) {
        if (!isValidImei(imei)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `IMEI ${imei} si sahihi`,
            path: ['imeis'],
          });
        } else if (seen.has(imei)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `IMEI ${imei} imerudiwa`,
            path: ['imeis'],
          });
        }
        seen.add(imei);
      }
    }
  })
  .transform((p) => ({
    ...p,
    initialShopQty: Number(p.initialShopQty),
    imeis: p.type === 'phone' ? (p.imeis ?? []) : [],
  }));

export interface ProductFormValues {
  name: string;
  detail?: string;
  type: (typeof PRODUCT_TYPES)[number];
  costPrice: number;
  sellPrice: number;
  minStock: number;
  code?: string;
  barcode?: string;
  imageUrl?: string;
  initialShopQty: number;
  imeis?: string[];
}
export type ProductInput = z.output<typeof productSchema>;
