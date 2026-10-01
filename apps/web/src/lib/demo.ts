import { db, nowIso, uid, type Product } from './db';
import { addPartyAdjustment, adjustStock } from './ops';

/**
 * Optional sample data for trying the software. Only added when the owner ticks the box on
 * first setup; prices are typical but not real quotes.
 */
export async function loadDemoData() {
  const cats = new Map((await db.categories.toArray()).map((c) => [c.name, c.id]));
  const suppliers = [
    { id: uid(), name: 'Peak Freans Distributor', company: 'English Biscuit Manufacturers', phone: '0300-0000001', leadDays: 2 },
    { id: uid(), name: 'Coca-Cola Distributor', company: 'Coca-Cola Pakistan', phone: '0300-0000002', leadDays: 1 },
    { id: uid(), name: 'Unilever Distributor', company: 'Unilever Pakistan', phone: '0300-0000003', leadDays: 3 },
    { id: uid(), name: 'National Foods Distributor', company: 'National Foods', phone: '0300-0000004', leadDays: 3 },
    { id: uid(), name: 'Wholesale Bazaar', company: 'Local wholesale', phone: '0300-0000005', leadDays: 1 },
  ].map((s) => ({ ...s, createdAt: nowIso() }));
  await db.suppliers.bulkAdd(suppliers);
  const [pf, coke, unilever, national, bazaar] = suppliers.map((s) => s.id);

  // name, urdu, category, supplier, unit, sale Rs, cost Rs, opening stock, min, pack name, pack size
  const rows: [string, string, string, string, string, number, number, number, number, string?, number?][] = [
    ['Sooper Biscuit (Ticky Pack)', 'سوپر بسکٹ', 'Biscuits & Snacks', pf, 'Packet', 30, 26, 60, 24, 'Box', 24],
    ['Rio Biscuit', 'ریو بسکٹ', 'Biscuits & Snacks', pf, 'Packet', 20, 17, 40, 24, 'Box', 24],
    ['Gluco Biscuit', 'گلوکو بسکٹ', 'Biscuits & Snacks', pf, 'Packet', 20, 17, 18, 24, 'Box', 24],
    ['Chocolatto', 'چاکلیٹو', 'Biscuits & Snacks', pf, 'Packet', 30, 25.5, 6, 12, 'Box', 12],
    ['Coca-Cola 1.5L', 'کوکا کولا', 'Beverages', coke, 'Bottle', 200, 178, 24, 12, 'Crate', 6],
    ['Sprite 500ml', 'سپرائٹ', 'Beverages', coke, 'Bottle', 100, 88, 30, 12, 'Crate', 12],
    ['Lipton Yellow Label 190g', 'لپٹن چائے', 'Grocery', unilever, 'Packet', 650, 590, 15, 6, 'Carton', 24],
    ['Surf Excel 1kg', 'سرف ایکسل', 'Household', unilever, 'Packet', 690, 625, 10, 5, 'Carton', 12],
    ['Lifebuoy Soap', 'لائف بوائے صابن', 'Personal Care', unilever, 'Piece', 120, 104, 36, 12, 'Carton', 72],
    ['National Salt 800g', 'نیشنل نمک', 'Spices', national, 'Packet', 60, 50, 25, 10, 'Carton', 24],
    ['National Red Chilli 200g', 'لال مرچ', 'Spices', national, 'Packet', 250, 215, 8, 6, 'Carton', 48],
    ['Dalda Cooking Oil 1L', 'ڈالڈا تیل', 'Cooking Oil & Ghee', bazaar, 'Bottle', 590, 555, 20, 10, 'Carton', 12],
    ['Sugar', 'چینی', 'Grocery', bazaar, 'Kg', 160, 148, 50, 20, 'Sack', 50],
    ['Basmati Rice', 'باسمتی چاول', 'Grocery', bazaar, 'Kg', 380, 340, 40, 15, 'Sack', 25],
    ['Daal Chana', 'دال چنا', 'Grocery', bazaar, 'Kg', 320, 285, 20, 10, 'Sack', 40],
    ['Olpers Milk 1L', 'اولپرز دودھ', 'Dairy', bazaar, 'Packet', 330, 305, 24, 12, 'Carton', 12],
    ['Eggs', 'انڈے', 'Dairy', bazaar, 'Dozen', 330, 300, 10, 5, 'Tray', 2.5],
  ];

  let n = 1;
  for (const [name, nameUr, cat, supplierId, unit, sale, cost, stock, min, packName, packSize] of rows) {
    const product: Product = {
      id: uid(),
      name,
      nameUr,
      sku: `P${String(n++).padStart(4, '0')}`,
      categoryId: cats.get(cat),
      supplierId,
      unit,
      ...(packName ? { packName } : {}),
      ...(packSize ? { packSize } : {}),
      salePrice: Math.round(sale * 100),
      cost: 0,
      stock: 0,
      minStock: min,
      favorite: n <= 9,
      active: true,
      createdAt: nowIso(),
    };
    await db.products.add(product);
    await adjustStock({ productId: product.id, qty: stock, type: 'opening', cost: Math.round(cost * 100), note: 'Opening stock (sample)' });
  }

  const customers = [
    { name: 'Ali Raza', phone: '0301-1111111', limit: 20000, opening: 3500 },
    { name: 'Bilal Ahmed', phone: '0302-2222222', limit: 10000, opening: 0 },
    { name: 'Hamza Khan', phone: '0303-3333333', limit: 15000, opening: 7200 },
  ];
  for (const c of customers) {
    const id = uid();
    await db.customers.add({ id, name: c.name, phone: c.phone, creditLimit: c.limit * 100, createdAt: nowIso() });
    if (c.opening) await addPartyAdjustment('customer', id, c.opening * 100, 'Opening balance (sample)', 'opening');
  }
  await addPartyAdjustment('supplier', pf!, 3200000, 'Opening balance (sample)', 'opening');
}
