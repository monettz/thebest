const fs = require('fs');

function imeiFromBody(body14) {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    let d = Number(body14[13 - i]);
    if (i % 2 === 0) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  const check = (10 - (sum % 10)) % 10;
  return body14 + String(check);
}

const products = [
  { id: 1, name: 'Samsung A15', detail: '128GB', type: 'phone', code: 'A15', costPrice: 780000, sellPrice: 900000, minStock: 5, storeQty: 24, shopQty: 6 },
  { id: 2, name: 'Tecno Spark 20', detail: '256GB', type: 'phone', code: 'SP', costPrice: 410000, sellPrice: 480000, minStock: 5, storeQty: 18, shopQty: 6 },
  { id: 3, name: 'iPhone 11', detail: '64GB', type: 'phone', code: 'IP', costPrice: 950000, sellPrice: 1150000, minStock: 3, storeQty: 2, shopQty: 1 },
  { id: 4, name: 'Redmi 13', detail: '128GB', type: 'phone', code: 'RM', costPrice: 360000, sellPrice: 420000, minStock: 5, storeQty: 10, shopQty: 4 },
  { id: 5, name: 'Screen protector A15', detail: '', type: 'accessory', code: 'PR', costPrice: 3000, sellPrice: 10000, minStock: 50, storeQty: 420, shopQty: 37 },
  { id: 6, name: 'Charger 25W', detail: '', type: 'accessory', code: 'CH', costPrice: 18000, sellPrice: 35000, minStock: 20, storeQty: 12, shopQty: 18 },
  { id: 7, name: 'Phone cover', detail: '', type: 'accessory', code: 'CV', costPrice: 5000, sellPrice: 15000, minStock: 30, storeQty: 310, shopQty: 42 },
  { id: 8, name: 'Earbuds', detail: '', type: 'accessory', code: 'EB', costPrice: 25000, sellPrice: 45000, minStock: 10, storeQty: 0, shopQty: 9 },
];

let sql = '-- Seed Products\n';
sql += 'INSERT INTO public.products (id, name, detail, type, code, cost_price, sell_price, min_stock) OVERRIDING SYSTEM VALUE VALUES\n';
sql += products.map(p => `  (${p.id}, '${p.name}', '${p.detail}', '${p.type}', '${p.code}', ${p.costPrice}, ${p.sellPrice}, ${p.minStock})`).join(',\n');
sql += '\nON CONFLICT (id) DO NOTHING;\n\n';

sql += '-- Seed Phone Units\n';
const units = [];
for (const p of products.filter(x => x.type === 'phone')) {
  const pid = String(p.id).padStart(2, '0');
  for (let i = 1; i <= p.shopQty; i++) {
    const imei = imeiFromBody('3591' + pid + String(i * 7919).padStart(8, '0').slice(-8));
    units.push({ imei, product_id: p.id, status: 'IN_SHOP' });
  }
  for (let i = 1; i <= p.storeQty; i++) {
    const imei = imeiFromBody('3592' + pid + String(i * 6007).padStart(8, '0').slice(-8));
    units.push({ imei, product_id: p.id, status: 'IN_STORE' });
  }
}
sql += 'INSERT INTO public.inventory_units (imei, product_id, status) VALUES\n';
sql += units.map(u => `  ('${u.imei}', ${u.product_id}, '${u.status}')`).join(',\n');
sql += '\nON CONFLICT (imei) DO NOTHING;\n\n';

sql += '-- Seed Initial Stock Movements for Accessories\n';
const accMovements = [];
for (const p of products.filter(x => x.type === 'accessory')) {
  if (p.storeQty > 0) {
    accMovements.push(`(${p.id}, NULL, 'STORE', ${p.storeQty}, 'PURCHASE', ${p.costPrice}, 'seed', 1, 'Mmiliki Mkuu', 'Initial Store Stock')`);
  }
  if (p.shopQty > 0) {
    accMovements.push(`(${p.id}, NULL, 'SHOP', ${p.shopQty}, 'PURCHASE', ${p.costPrice}, 'seed', 1, 'Mmiliki Mkuu', 'Initial Shop Stock')`);
  }
}
if (accMovements.length) {
  sql += 'INSERT INTO public.stock_movements (product_id, from_location, to_location, qty, type, unit_cost, ref_type, ref_id, user_name, note) VALUES\n';
  sql += '  ' + accMovements.join(',\n  ') + ';\n\n';
}

sql += '-- Seed Suppliers\n';
sql += "INSERT INTO public.suppliers (id, name, phone) OVERRIDING SYSTEM VALUE VALUES (1, 'Supplier A', ''), (2, 'Supplier B', ''), (3, 'Supplier C', ''), (4, 'Supplier D', '') ON CONFLICT (id) DO NOTHING;\n\n";

sql += '-- Seed Customers\n';
const customers = [
  [1, 'Juma Hassan', '255712345678', 'Kariakoo'],
  [2, 'Amina Mussa', '255754221900', 'Mwenge'],
  [3, 'Peter Kimaro', '255689112334', 'Sinza'],
  [4, 'Saida Ngowi', '255745090122', 'Mbezi'],
  [5, 'Grace Lyimo', '255716778410', 'Ubungo'],
  [6, 'Hamisi Mrisho', '255782556001', 'Temeke'],
  [7, 'Omari Juma', '255713000555', 'Kimara'],
];
sql += 'INSERT INTO public.customers (id, name, phone, area) OVERRIDING SYSTEM VALUE VALUES\n';
sql += customers.map(c => `  (${c[0]}, '${c[1]}', '${c[2]}', '${c[3]}')`).join(',\n');
sql += '\nON CONFLICT (id) DO NOTHING;\n';

fs.writeFileSync('./supabase/migrations/002_seed_data.sql', sql);
console.log('Seed SQL written, bytes:', sql.length);

