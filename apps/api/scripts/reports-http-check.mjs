/**
 * End-to-end check of the report endpoints against a running API (permissions, shop isolation, numbers).
 * Run it against a throwaway database that has two fresh shops and nothing else:
 *
 *   OWNER=owner@smoke.test OWNER_PW='...' OTHER=other@smoke.test OTHER_PW='...' \
 *   API=http://127.0.0.1:4100/api/v1 node apps/api/scripts/reports-http-check.mjs
 *
 * It creates its own staff, products and bills in the first shop. Never point it at a real shop.
 */
const BASE = process.env.API ?? 'http://127.0.0.1:4100/api/v1';
const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

async function login(identifier, password, ip) {
  const res = await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip }, body: JSON.stringify({ identifier, password }) });
  const j = await res.json();
  if (j.status !== 'ok') throw new Error(`login failed for ${identifier}: ${res.status}`);
  return { token: j.session.accessToken };
}
const api = (who) => async (method, path, body) => {
  const res = await fetch(`${BASE}/shop${path}`, {
    method,
    headers: { authorization: `Bearer ${who.token}`, 'x-requested-with': 'retailos', ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, bytes: text.length };
};

const owner = await login(process.env.OWNER, process.env.OWNER_PW, '10.7.0.1');
const O = api(owner);
const other = api(await login(process.env.OTHER, process.env.OTHER_PW, '10.7.0.9'));

let r = await O('POST', '/ops/setupShop', { shopName: 'Report Mart', address: 'x', phone: '1', openingCash: 100000 });
check('shop set up', r.status === 200, `${r.status}`);
r = await O('POST', '/users', { name: 'Mona Manager', email: 'mgr@report.test', roleKey: 'manager', password: 'orange kettle by the river' });
check('manager created', r.status === 200, `${r.status}`);
r = await O('POST', '/users', { name: 'Chandni Cashier', phone: '03005550000', roleKey: 'cashier', password: 'blue lantern over hills' });
check('cashier created', r.status === 200, `${r.status}`);
const M = api(await login('mgr@report.test', 'orange kettle by the river', '10.7.0.2'));
const C = api(await login('03005550000', 'blue lantern over hills', '10.7.0.3'));
const A = async (method, path, body) => fetch(`${BASE}/shop${path}`, { method, headers: { 'x-requested-with': 'retailos' } }).then((x) => ({ status: x.status }));

const now = new Date().toISOString();
const prod = (id, over = {}) => ({ id, name: `Product ${id}`, sku: `SKU-${id}`, unit: 'Packet', salePrice: 10000, cost: 8000, stock: 0, minStock: 5, favorite: false, active: true, createdAt: now, ...over });
await O('PUT', '/c/products/p1', prod('p1'));
await O('PUT', '/c/products/p2', prod('p2', { salePrice: 5000, cost: 4000 }));
await O('POST', '/ops/adjustStock', { productId: 'p1', qty: 100, type: 'opening', cost: 8000 });
await O('POST', '/ops/adjustStock', { productId: 'p2', qty: 50, type: 'opening', cost: 4000 });
const sale = (call, id, qty, price) => call('POST', '/ops/completeSale', { items: [{ productId: id, qty, price, discount: 0 }], discount: 0, payments: [{ accountId: 'acc-cash', amount: qty * price }] });
const s1 = await sale(C, 'p1', 2, 10000);
await sale(M, 'p2', 1, 5000);
const s3 = await sale(M, 'p1', 1, 10000);
r = await O('POST', '/ops/voidSale', { saleId: s3.json.id, reason: 'test cancel' });
check('one bill cancelled', r.status === 200, `${r.status}`);
r = await O('POST', '/ops/addExpense', { kind: 'expense', category: 'Rent', amount: 3000, accountId: 'acc-cash', note: '' });
check('expense recorded', r.status === 200, `${r.status}`);
await O('POST', '/ops/returnSaleItems', { saleId: s1.json.id, lines: [{ productId: 'p1', qty: 1 }], refundTo: 'account', accountId: 'acc-cash' });

const start = new Date(Date.now() - 86_400_000).toISOString();
const end = new Date(Date.now() + 86_400_000).toISOString();
const rng = `start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`;

// ---- the numbers
r = await O('GET', `/reports/profit?${rng}`);
check('owner: bills counted without the cancelled one', r.status === 200 && r.json.salesCount === 2, JSON.stringify(r.json));
check('owner: sales 25 000 − return 10 000 = revenue 15 000', r.json.grossSales === 25000 && r.json.returns === 10000 && r.json.revenue === 15000, `${r.json.grossSales}/${r.json.returns}/${r.json.revenue}`);
check('owner: cost of goods follows returns (2×8000 + 4000 − 8000)', r.json.cogs === 12000 && r.json.grossProfit === 3000, `${r.json.cogs}/${r.json.grossProfit}`);
check('owner: expense subtracts, net profit exact', r.json.expenses === 3000 && r.json.netProfit === 0, `${r.json.expenses}/${r.json.netProfit}`);

// the same figures worked out by hand from the raw records
const raw = (await O('GET', `/c/sales?from=${encodeURIComponent(start)}&to=${encodeURIComponent(end)}`)).json.items.filter((x) => x.status === 'completed');
check('...equal to adding up the raw bills', raw.reduce((s, x) => s + x.total, 0) === 25000 && raw.length === 2);
r = await O('GET', `/reports/products?${rng}`);
check('owner: per-product report', r.status === 200 && r.json.find((x) => x.productId === 'p1')?.cost === 16000, JSON.stringify(r.json));
r = await O('GET', `/reports/sales-summary?${rng}`);
check('owner: sales summary counts cancelled and returns', r.json.bills === 2 && r.json.cancelled === 1 && r.json.returns === 10000, JSON.stringify(r.json));
r = await O('GET', `/reports/expenses?${rng}`);
check('owner: expenses by category', r.json.expenseTotal === 3000 && r.json.byCategory[0][0] === 'Rent', JSON.stringify(r.json));
r = await O('GET', `/reports/cash-breakdown?${rng}&accountId=acc-cash`);
check('owner: cash breakdown', r.status === 200 && Array.isArray(r.json) && r.json.length > 0);
r = await O('GET', `/reports/khata`);
check('owner: khata totals', r.status === 200 && r.json.customerDue === 0 && r.json.supplierDue === 0, JSON.stringify(r.json));
r = await O('GET', `/reports/reorder?now=${Date.now()}&tz=-300&lead=2&cover=7&rows=0`);
check('owner: stock cards (no rows), value = 98×8000 + 49×4000 − returned', r.status === 200 && r.json.rows.length === 0 && r.json.summary.stockValue === 99 * 8000 + 49 * 4000, JSON.stringify(r.json.summary));
r = await O('GET', `/reports/daily-sales?ranges=${encodeURIComponent(JSON.stringify([[start, end]]))}`);
check('owner: daily bars', r.status === 200 && r.json[0].total === 25000 && r.json[0].count === 2, JSON.stringify(r.json));
r = await O('GET', `/reports/top-products?${rng}&limit=1`);
check('owner: top products limited to 1', r.status === 200 && r.json.length === 1);

// ---- who may see what
for (const path of ['profit', 'products', 'top-products', 'expenses', 'purchases', 'khata', 'cash-breakdown?accountId=acc-cash', `reorder?now=${Date.now()}&tz=0`]) {
  const sep = path.includes('?') ? '&' : '?';
  r = await C('GET', `/reports/${path}${sep}${rng}`);
  check(`cashier is refused /reports/${path.split('?')[0]}`, r.status === 403, `${r.status}`);
}
r = await C('GET', `/reports/daily-sales?ranges=${encodeURIComponent(JSON.stringify([[start, end]]))}`);
check('cashier is refused daily sales totals', r.status === 403, `${r.status}`);
r = await C('GET', `/reports/sales-summary?${rng}`);
check('cashier gets only their own bills in the summary', r.status === 200 && r.json.bills === 1 && r.json.total === 20000, JSON.stringify(r.json));
r = await C('GET', `/reports/sales-velocity?since=${encodeURIComponent(start)}`);
check('cashier gets unit counts for the POS ranking (no money)', r.status === 200 && r.json.p1 === 1 && !JSON.stringify(r.json).includes('cost'), JSON.stringify(r.json));
r = await C('GET', `/reports/services?${rng}&provider=Easypaisa`);
check('cashier may read their own wallet totals', r.status === 200 && r.json.count === 0, `${r.status}`);
r = await M('GET', `/reports/sales-summary?${rng}`);
check('manager sees everyone’s bills', r.status === 200 && r.json.bills === 2, JSON.stringify(r.json));
r = await M('GET', `/reports/reorder?now=${Date.now()}&tz=-300&lead=2&rows=1`);
check('manager sees cost on reorder rows', r.status === 200 && r.json.rows.some((x) => x.product.cost > 0) && r.json.summary.stockValue > 0);
r = await C('GET', `/reports/profit?${rng}`);
check('...and the cashier error leaks no figures', r.status === 403 && !JSON.stringify(r.json).match(/cogs|grossProfit/));

// ---- the one-request dashboard
const dq = `today=${encodeURIComponent(start)}&todayEnd=${encodeURIComponent(end)}&weekStart=${encodeURIComponent(start)}&weekEnd=${encodeURIComponent(end)}&prevStart=${encodeURIComponent(start)}&prevEnd=${encodeURIComponent(start)}&days=${encodeURIComponent(JSON.stringify([[start, end]]))}&now=${Date.now()}&tz=-300&lead=2`;
r = await O('GET', `/reports/dashboard?${dq}`);
check('owner: dashboard in one request (figures equal the separate reports)', r.status === 200 && r.json.todayP.revenue === 15000 && r.json.weekP.salesCount === 2 && r.json.daily[0].total === 25000 && r.json.topProducts.length === 2 && r.json.stock.summary.activeProducts === 2 && r.json.khata.customerDue === 0, JSON.stringify(r.json).slice(0, 300));
r = await C('GET', `/reports/dashboard?${dq}`);
check('cashier is refused the dashboard report', r.status === 403, `${r.status}`);
r = await M('GET', `/reports/dashboard?${dq}`);
check('manager gets the dashboard report', r.status === 200 && r.json.todayP !== null);
{
  const zr = await fetch(`${BASE}/shop/c/products`, { headers: { authorization: `Bearer ${owner.token}`, 'x-requested-with': 'retailos', 'accept-encoding': 'gzip' } });
  const raw = await fetch(`${BASE}/shop/c/products`, { headers: { authorization: `Bearer ${owner.token}`, 'x-requested-with': 'retailos', 'accept-encoding': 'identity' } });
  const small = (await zr.arrayBuffer()).byteLength, big = (await raw.arrayBuffer()).byteLength;
  check('large answers are gzip-compressed when the browser accepts it, and plain otherwise', raw.headers.get('content-encoding') === null && (big < 1024 || (zr.headers.get('content-encoding') === 'gzip' && small < big)), `${big} B -> ${small} B`);
}

// ---- another shop, bad input, no login
r = await other('GET', `/reports/profit?${rng}`);
check('another shop sees none of these figures', r.status === 200 && r.json.salesCount === 0 && r.json.grossSales === 0 && r.json.expenses === 0, JSON.stringify(r.json));
r = await other('GET', `/reports/products?${rng}`);
check('...nor the product report', r.status === 200 && r.json.length === 0);
r = await O('GET', `/reports/profit?start=yesterday&end=today`);
check('malformed dates are refused', r.status === 400, `${r.status}`);
r = await O('GET', `/reports/cash-breakdown?${rng}&accountId=${encodeURIComponent("acc-cash' OR '1'='1")}`);
check('SQL-looking input in a parameter is refused', r.status === 400, `${r.status}`);
r = await O('GET', `/reports/services?${rng}&provider=${encodeURIComponent('x" OR 1=1 --')}`);
check('...also in the provider name', r.status === 400, `${r.status}`);
r = await O('GET', `/reports/daily-sales?ranges=${encodeURIComponent('[["a","b"]]')}`);
check('malformed range list refused', r.status === 400, `${r.status}`);
r = await A('GET', `/reports/profit?${rng}`);
check('no login, no report', r.status === 401, `${r.status}`);

// ---- how much leaves the server
const sizes = [];
for (const path of [`profit?${rng}`, `sales-summary?${rng}`, `top-products?${rng}`, `khata`, `reorder?now=${Date.now()}&tz=0&rows=0`]) sizes.push(`${path.split('?')[0]}: ${(await O('GET', `/reports/${path}`)).bytes} B`);
console.log('response sizes ->', sizes.join(', '));

const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exitCode = failed ? 1 : 0;
