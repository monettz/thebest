import { describe, expect, it } from 'vitest';
import { MAX_IMAGE_BYTES, normalizePhone, productSchema, validateImageFile } from '@shared/schemas';
import { changeLineImei, imeiFromBody, pickAvailableImei, type CartLine } from '@shared/sales';
import { formatTZS, formatTZSCompact } from '@/lib/format';
import { createAuthService } from './auth';
import {
  createProduct,
  deleteProduct,
  listMovements,
  listProducts,
  stockStatus,
  updateProduct,
  updateProductImage,
} from './api';
import { createTransfer } from './inventory';
import { completeSale, listPosProducts } from './sales';

describe('auth lockout', () => {
  it('locks the account for 5 minutes after 5 wrong PINs', () => {
    const login = createAuthService();
    const t0 = 1_000_000;
    for (let i = 0; i < 4; i++) expect(login('0712000002', '0000', t0).ok).toBe(false);
    const fifth = login('0712000002', '0000', t0);
    expect(fifth).toMatchObject({ ok: false, reason: 'locked' });
    // correct PIN is rejected while locked
    expect(login('0712000002', '4321', t0 + 60_000)).toMatchObject({ ok: false, reason: 'locked' });
    // and accepted again once the lock expires
    expect(login('0712000002', '4321', t0 + 5 * 60_000 + 1).ok).toBe(true);
  });

  it('accepts both phone formats and returns the role', () => {
    const login = createAuthService();
    const res = login('+255 712 000 001', '1234');
    expect(res.ok && res.user.role).toBe('owner');
  });
});

describe('formatting and validation', () => {
  it('formats TZS', () => {
    expect(formatTZS(1234000)).toBe('TSh 1,234,000');
    expect(formatTZSCompact(48_600_000)).toBe('TSh 48.6M');
    expect(formatTZSCompact(900_000)).toBe('TSh 900,000');
  });
  it('normalises Tanzanian numbers', () => {
    expect(normalizePhone('0712 345 678')).toBe('255712345678');
    expect(normalizePhone('12345')).toBeNull();
  });
  it('rejects a sell price below cost with a Swahili message', () => {
    const r = productSchema.safeParse({ name: 'Test', type: 'phone', costPrice: 100, sellPrice: 50, minStock: 1 });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toMatch(/chini/);
  });
});

describe('POS workflow and stock updates', () => {
  it('completes a sale with auto-assigned phone IMEIs and accessories and updates stock/IMEIs', async () => {
    const before = await listPosProducts();
    const samsung = before.find((p) => p.id === 1)!; // multiple IMEIs
    const iphone = before.find((p) => p.id === 3)!; // 1 IMEI
    const charger = before.find((p) => p.id === 6)!; // accessory

    expect(iphone.imeis.length).toBe(1);
    expect(samsung.imeis.length).toBeGreaterThan(1);

    const lines: CartLine[] = [];

    // 1. Phone with one available IMEI -> auto-assigned
    const iphoneImei = pickAvailableImei(iphone.imeis, lines);
    expect(iphoneImei).toBe(iphone.imeis[0]);
    lines.push({
      productId: iphone.id,
      name: iphone.name,
      type: 'phone',
      unitPrice: iphone.sellPrice,
      qty: 1,
      imei: iphoneImei!,
    });
    // Cannot add a second unit of iPhone 11 when only 1 IMEI exists
    expect(pickAvailableImei(iphone.imeis, lines)).toBeNull();

    // 2 & 5. Phone with multiple available IMEIs -> add 2 units with unique IMEIs
    const samImei1 = pickAvailableImei(samsung.imeis, lines)!;
    lines.push({
      productId: samsung.id,
      name: samsung.name,
      type: 'phone',
      unitPrice: samsung.sellPrice,
      qty: 1,
      imei: samImei1,
    });
    const samImei2 = pickAvailableImei(samsung.imeis, lines)!;
    expect(samImei2).not.toBe(samImei1);
    lines.push({
      productId: samsung.id,
      name: samsung.name,
      type: 'phone',
      unitPrice: samsung.sellPrice,
      qty: 1,
      imei: samImei2,
    });

    // 4. Change assigned IMEI of second Samsung unit to the 3rd available IMEI
    const pool = new Set(before.flatMap((p) => p.imeis));
    const samImei3 = samsung.imeis[2];
    const changed = changeLineImei(lines, 2, samImei3, pool);
    expect(changed.ok).toBe(true);
    const updatedLines = changed.ok ? changed.lines : lines;
    expect(updatedLines[2].imei).toBe(samImei3);

    // 6. Add accessory and increment quantity to 2
    updatedLines.push({
      productId: charger.id,
      name: charger.name,
      type: 'accessory',
      unitPrice: charger.sellPrice,
      qty: 2,
    });

    const total = updatedLines.reduce((s, l) => s + l.unitPrice * l.qty, 0);

    // 7. Complete sale and verify stock and IMEI pool update
    const { saleId } = await completeSale(
      { id: 1, name: 'Mmiliki Mkuu', role: 'owner' },
      {
        lines: updatedLines,
        discount: 0,
        payments: [{ method: 'CASH', amount: total }],
      },
    );
    expect(saleId).toBeGreaterThan(0);

    const after = await listPosProducts();
    const samsungAfter = after.find((p) => p.id === 1)!;
    const iphoneAfter = after.find((p) => p.id === 3)!;
    const chargerAfter = after.find((p) => p.id === 6)!;

    expect(iphoneAfter.shopQty).toBe(iphone.shopQty - 1);
    expect(iphoneAfter.imeis).toHaveLength(0);
    expect(samsungAfter.shopQty).toBe(samsung.shopQty - 2);
    expect(samsungAfter.imeis).not.toContain(samImei1);
    expect(samsungAfter.imeis).not.toContain(samImei3);
    expect(samsungAfter.imeis).toContain(samImei2); // freed when we changed line 2 to samImei3!
    expect(chargerAfter.shopQty).toBe(charger.shopQty - 2);
  });

  it('validates image file formats (JPG, JPEG, PNG, WEBP) and size (max 5 MB)', () => {
    expect(validateImageFile({ name: 'samsung-a15.jpg', type: 'image/jpeg', size: 250_000 })).toBeNull();
    expect(validateImageFile({ name: 'tecno-spark20.png', type: 'image/png', size: 500_000 })).toBeNull();
    expect(validateImageFile({ name: 'iphone-11.webp', type: 'image/webp', size: 1_200_000 })).toBeNull();
    expect(validateImageFile({ name: 'photo.JPEG', type: '', size: 100_000 })).toBeNull();

    const badFormat = validateImageFile({ name: 'doc.pdf', type: 'application/pdf', size: 10_000 });
    expect(badFormat).toMatch(/JPG, PNG au WEBP/);

    const emptyFile = validateImageFile({ name: 'empty.png', type: 'image/png', size: 0 });
    expect(emptyFile).toMatch(/tupu/);

    const tooLarge = validateImageFile({ name: 'huge.jpg', type: 'image/jpeg', size: MAX_IMAGE_BYTES + 1 });
    expect(tooLarge).toMatch(/MB 5/);
  });

  it('uploads, persists, replaces, and removes images for Samsung A15, Tecno Spark 20, and iPhone 11 across Products & Stock and Sales POS', async () => {
    const owner = { name: 'Mmiliki Mkuu', role: 'owner' as const };
    const samsungImg = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/';
    const tecnoImg = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const iphoneImg = 'data:image/webp;base64,UklGRh4AAABXRUJQVlA4TBEAAAAvAAAAAAfQ//73v/+BiOh/AAA=';

    // Upload distinct images for Samsung A15 (id 1), Tecno Spark 20 (id 2), and iPhone 11 (id 3)
    await updateProductImage(owner, 1, samsungImg);
    await updateProductImage(owner, 2, tecnoImg);
    await updateProductImage(owner, 3, iphoneImg);

    const prods = await listProducts('owner');
    expect(prods.find((p) => p.id === 1)?.imageUrl).toBe(samsungImg);
    expect(prods.find((p) => p.id === 2)?.imageUrl).toBe(tecnoImg);
    expect(prods.find((p) => p.id === 3)?.imageUrl).toBe(iphoneImg);

    // Verify each image appears in Sales (POS) product cards and stays associated with the right product
    const posProds = await listPosProducts();
    expect(posProds.find((p) => p.id === 1)?.imageUrl).toBe(samsungImg);
    expect(posProds.find((p) => p.id === 2)?.imageUrl).toBe(tecnoImg);
    expect(posProds.find((p) => p.id === 3)?.imageUrl).toBe(iphoneImg);

    // Replace Samsung A15 image
    const samsungReplacement = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEElEQVR42mNk+M9Qz8DAwAAABgEBAf8/vQAAAABJRU5ErkJggg==';
    await updateProductImage(owner, 1, samsungReplacement);
    expect((await listProducts('owner')).find((p) => p.id === 1)?.imageUrl).toBe(samsungReplacement);

    // Remove Tecno Spark 20 image without deleting the product or its inventory
    const tecnoBefore = prods.find((p) => p.id === 2)!;
    await updateProductImage(owner, 2, null);
    const prodsAfterRemove = await listProducts('owner');
    const tecnoAfter = prodsAfterRemove.find((p) => p.id === 2)!;
    expect(tecnoAfter).toBeDefined();
    expect(tecnoAfter.imageUrl).toBeUndefined();
    expect(tecnoAfter.storeQty).toBe(tecnoBefore.storeQty);
    expect(tecnoAfter.shopQty).toBe(tecnoBefore.shopQty);
  });

  it('supports editing product details and deleting products', async () => {
    const owner = { name: 'Mmiliki Mkuu', role: 'owner' as const };
    await createProduct(owner, {
      name: 'Test Case Cover',
      type: 'accessory',
      detail: 'Silicone Black',
      costPrice: 5000,
      sellPrice: 10000,
      minStock: 2,
      initialShopQty: 1,
    });

    const created = (await listProducts('owner')).find((p) => p.name === 'Test Case Cover')!;
    expect(created).toBeDefined();
    expect(created.shopQty).toBe(1);
    expect(created.storeQty).toBe(0);

    await updateProduct(owner, created.id, {
      name: 'Test Case Cover Pro',
      type: 'accessory',
      detail: 'Matte Black',
      costPrice: 6000,
      sellPrice: 12000,
      minStock: 3,
    });

    const prods = await listProducts('owner');
    const updated = prods.find((p) => p.id === created.id)!;
    expect(updated.name).toBe('Test Case Cover Pro');
    expect(updated.detail).toBe('Matte Black');
    expect(updated.sellPrice).toBe(12000);

    await deleteProduct(owner, created.id);
    const afterDelete = await listProducts('owner');
    expect(afterDelete.find((p) => p.id === created.id)).toBeUndefined();
  });

  it('separates From Store transfers and Add New Stock (new products only with mandatory Initial Shop Quantity, duplicate prevention, IMEI validation, and persistence)', async () => {
    // Provide in-memory localStorage for Node test environment to verify persistence across refresh
    const store = new Map<string, string>();
    const prevStorage = globalThis.localStorage;
    Object.defineProperty(globalThis, 'localStorage', {
      value: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => store.set(k, v),
        removeItem: (k: string) => store.delete(k),
        clear: () => store.clear(),
      },
      configurable: true,
    });

    try {
      const owner = { name: 'Mmiliki Mkuu', role: 'owner' as const };

      // 1. From Store: lists existing products with available Store stock (storeQty > 0) and transfers to Shop
      const before = await listProducts('owner');
      const storeEligible = before.filter((p) => p.storeQty > 0);
      expect(storeEligible.some((p) => p.id === 1)).toBe(true); // Samsung A15 has Store stock
      expect(storeEligible.some((p) => p.id === 8)).toBe(false); // Earbuds has 0 Store stock

      const samsungBefore = before.find((p) => p.id === 1)!;
      const protectorBefore = before.find((p) => p.id === 5)!;
      const transferImei = samsungBefore.storeImeis[0];
      expect(transferImei).toBeDefined();

      await createTransfer(owner, {
        lines: [
          { productId: 1, name: samsungBefore.name, type: 'phone', qty: 1, imeis: [transferImei] },
          { productId: 5, name: protectorBefore.name, type: 'accessory', qty: 5, imeis: [] },
        ],
      });

      const afterTransfer = await listProducts('owner');
      const samsungMid = afterTransfer.find((p) => p.id === 1)!;
      const protectorMid = afterTransfer.find((p) => p.id === 5)!;

      expect(samsungMid.storeQty).toBe(samsungBefore.storeQty - 1);
      expect(samsungMid.shopQty).toBe(samsungBefore.shopQty + 1);
      expect(samsungMid.storeImeis).not.toContain(transferImei);
      expect(samsungMid.shopImeis).toContain(transferImei);
      expect(protectorMid.storeQty).toBe(protectorBefore.storeQty - 5);
      expect(protectorMid.shopQty).toBe(protectorBefore.shopQty + 5);

      // 2. Initial Shop Quantity is mandatory: reject empty, 0, negative, or non-integer quantities
      await expect(
        createProduct(owner, {
          name: 'Invalid Qty Phone',
          type: 'accessory',
          costPrice: 10_000,
          sellPrice: 15_000,
          minStock: 2,
          initialShopQty: '' as unknown as number,
        }),
      ).rejects.toThrow(/idadi ya awali dukani/i);

      await expect(
        createProduct(owner, {
          name: 'Zero Qty Accessory',
          type: 'accessory',
          costPrice: 10_000,
          sellPrice: 15_000,
          minStock: 2,
          initialShopQty: 0,
        }),
      ).rejects.toThrow(/angalau 1/i);

      await expect(
        createProduct(owner, {
          name: 'Negative Qty Accessory',
          type: 'accessory',
          costPrice: 10_000,
          sellPrice: 15_000,
          minStock: 2,
          initialShopQty: -3,
        }),
      ).rejects.toThrow(/angalau 1/i);

      // Ensure no incomplete product record was created on failed validation
      expect((await listProducts('owner')).find((p) => p.name.includes('Qty'))).toBeUndefined();

      // 3. IMEI validation for tracked phones: reject missing IMEIs, invalid Luhn, or existing IMEIs
      const validImei1 = imeiFromBody('35998800000001');
      const validImei2 = imeiFromBody('35998800000002');

      await expect(
        createProduct(owner, {
          name: 'Infinix Hot 40',
          detail: '128GB',
          type: 'phone',
          costPrice: 350_000,
          sellPrice: 430_000,
          minStock: 3,
          initialShopQty: 2,
          imeis: [validImei1, validImei2, imeiFromBody('35998800000003')], // IMEI ni hiari, lakini si zaidi ya idadi (3 kwa qty 2)
        }),
      ).rejects.toThrow(/IMEI zisizidi 2/i);

      await expect(
        createProduct(owner, {
          name: 'Infinix Hot 40',
          detail: '128GB',
          type: 'phone',
          costPrice: 350_000,
          sellPrice: 430_000,
          minStock: 3,
          initialShopQty: 1,
          imeis: ['123456789012345'], // Invalid Luhn
        }),
      ).rejects.toThrow(/si sahihi/i);

      // Ensure failed phone creation left no partial record
      expect((await listProducts('owner')).find((p) => p.name === 'Infinix Hot 40')).toBeUndefined();

      // 4. Create a genuinely new IMEI-tracked phone with Initial Shop Quantity = 2 and Low Stock Alert At = 3
      const newPhoneId = await createProduct(owner, {
        name: 'Infinix Hot 40',
        detail: '128GB',
        type: 'phone',
        code: 'IH40',
        barcode: '6954851234567',
        costPrice: 350_000,
        sellPrice: 430_000,
        minStock: 3,
        initialShopQty: 2,
        imeis: [validImei1, validImei2],
      });

      const createdPhone = (await listProducts('owner')).find((p) => p.id === newPhoneId)!;
      expect(createdPhone).toBeDefined();
      expect(createdPhone.shopQty).toBe(2); // Entered Shop stock directly
      expect(createdPhone.storeQty).toBe(0); // Store stock unchanged
      expect(createdPhone.shopImeis).toEqual([validImei1, validImei2]);
      expect(createdPhone.storeImeis).toEqual([]);
      expect(createdPhone.minStock).toBe(3);
      expect(createdPhone.shopStatus).toBe('CHINI'); // 2 <= Low Stock Alert At (3)

      // 5. Create a genuinely new accessory with Initial Shop Quantity = 15 and Low Stock Alert At = 5
      const newAccId = await createProduct(owner, {
        name: 'Type-C Fast Cable',
        detail: '60W Braided',
        type: 'accessory',
        code: 'TC60',
        barcode: '6954859999999',
        costPrice: 4_000,
        sellPrice: 10_000,
        minStock: 5,
        initialShopQty: 15,
      });

      const createdAcc = (await listProducts('owner')).find((p) => p.id === newAccId)!;
      expect(createdAcc.shopQty).toBe(15);
      expect(createdAcc.storeQty).toBe(0);
      expect(createdAcc.shopStatus).toBe('IPO'); // 15 > Low Stock Alert At (5)
      expect(stockStatus(0, 5)).toBe('IMEISHA');
      expect(stockStatus(5, 5)).toBe('CHINI');
      expect(stockStatus(6, 5)).toBe('IPO');

      // 6. Prevent Duplicate Products (by SKU, barcode, IMEI, or identical product identity)
      // Duplicate SKU
      await expect(
        createProduct(owner, {
          name: 'Another Phone',
          type: 'accessory',
          code: 'IH40',
          costPrice: 10_000,
          sellPrice: 20_000,
          minStock: 2,
          initialShopQty: 1,
        }),
      ).rejects.toThrow(/SKU "IH40" tayari ipo/);

      // Duplicate Barcode
      await expect(
        createProduct(owner, {
          name: 'Another Cable',
          type: 'accessory',
          barcode: '6954859999999',
          costPrice: 5_000,
          sellPrice: 10_000,
          minStock: 2,
          initialShopQty: 1,
        }),
      ).rejects.toThrow(/barcode "6954859999999" tayari ipo/);

      // Duplicate IMEI
      await expect(
        createProduct(owner, {
          name: ' Tecno Camon 30',
          detail: '256GB',
          type: 'phone',
          costPrice: 500_000,
          sellPrice: 600_000,
          minStock: 2,
          initialShopQty: 1,
          imeis: [validImei1],
        }),
      ).rejects.toThrow(/tayari ipo kwenye mfumo/);

      // Duplicate identical product without distinguishing identifiers
      await expect(
        createProduct(owner, {
          name: 'Samsung A15',
          detail: '128GB',
          type: 'phone',
          costPrice: 780_000,
          sellPrice: 900_000,
          minStock: 5,
          initialShopQty: 1,
          imeis: [imeiFromBody('35998800000009')],
        }),
      ).rejects.toThrow(/tayari ipo kwenye mfumo/);

      // Same product name with different model/spec (256GB vs 128GB) is allowed (does not rely on name alone)
      const variantImei = imeiFromBody('35998800000010');
      const variantId = await createProduct(owner, {
        name: 'Samsung A15',
        detail: '256GB',
        type: 'phone',
        code: 'A15-256',
        costPrice: 850_000,
        sellPrice: 980_000,
        minStock: 4,
        initialShopQty: 1,
        imeis: [variantImei],
      });
      expect(variantId).toBeGreaterThan(0);

      // 7. Verify the stock and movement history (durability across refreshes is the database's job, not the browser's)
      const afterRefresh = await listProducts('owner');
      const refreshedPhone = afterRefresh.find((p) => p.id === newPhoneId)!;
      const refreshedAcc = afterRefresh.find((p) => p.id === newAccId)!;
      expect(refreshedPhone.shopQty).toBe(2);
      expect(refreshedPhone.storeQty).toBe(0);
      expect(refreshedPhone.shopImeis).toEqual([validImei1, validImei2]);
      expect(refreshedAcc.shopQty).toBe(15);
      expect(refreshedAcc.storeQty).toBe(0);

      const movements = await listMovements(15);
      expect(movements.some((m) => m.productId === newPhoneId && m.to === 'SHOP' && m.qty === 2)).toBe(true);
      expect(movements.some((m) => m.productId === newAccId && m.to === 'SHOP' && m.qty === 15)).toBe(true);
    } finally {
      Object.defineProperty(globalThis, 'localStorage', { value: prevStorage, configurable: true });
    }
  });
});
