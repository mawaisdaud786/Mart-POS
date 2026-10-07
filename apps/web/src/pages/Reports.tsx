import { useLiveQuery } from '../lib/store';
import { ArrowDownRight, ArrowUpRight, CalendarDays, ChartNoAxesCombined, ChevronLeft, ChevronRight, Download, Package, ReceiptText, Search, Wallet } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { Button, Card, Empty, Field, Input, Select, Stat, cx, td, th } from '../components/ui';
import { db } from '../lib/db';
import { dayKey, daysAgo, fmtDateTime, qty, rangeIso, rs } from '../lib/format';
import { productSales, profitSummary, salesVelocity as getSalesVelocity, serviceSummary } from '../lib/reports';
import { buildCashFlowInsights, previousDateRange } from '../lib/cash-flow';
import { useSession } from '../lib/session';
import { csvCell } from '../lib/safe';

function monthStart(offset = 0) {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + offset);
  return dayKey(d);
}
function monthEnd(offset = 0) {
  const d = new Date();
  d.setMonth(d.getMonth() + offset + 1, 0);
  return dayKey(d);
}

const PRESETS: { label: string; range: () => [string, string] }[] = [
  { label: 'Today', range: () => [dayKey(), dayKey()] },
  { label: 'Yesterday', range: () => [daysAgo(1), daysAgo(1)] },
  { label: 'Last 7 days', range: () => [daysAgo(6), dayKey()] },
  { label: 'This month', range: () => [monthStart(), dayKey()] },
  { label: 'Last month', range: () => [monthStart(-1), monthEnd(-1)] },
];

function downloadCsv(name: string, rows: (string | number)[][]) {
  const csv = rows.map((r) => r.map(csvCell).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  URL.revokeObjectURL(url);
}

export function ReportsPage() {
  const { has } = useSession();
  const [searchParams, setSearchParams] = useSearchParams();
  const [focus, setFocus] = useState(() => ['sales-decline', 'sales-growth', 'sales-day', 'weekly-sales', 'product-performance'].includes(searchParams.get('focus') ?? '') ? searchParams.get('focus')! : '');
  const initialFocusDate = searchParams.get('date');
  const canSeeCashFlow = has('reports.financial') || has('dashboard.owner');
  const [[from, to], setRange] = useState<[string, string]>(() => focus === 'sales-day' && initialFocusDate
    ? [initialFocusDate, initialFocusDate]
    : ['sales-decline', 'sales-growth', 'weekly-sales'].includes(focus)
      ? [daysAgo(6), dayKey()]
      : focus === 'product-performance'
        ? [daysAgo(29), dayKey()]
      : [monthStart(), dayKey()]);
  const [productQuery, setProductQuery] = useState('');
  const [productSort, setProductSort] = useState<'velocity' | 'profit' | 'revenue' | 'qty' | 'margin'>(() => focus === 'product-performance' ? 'profit' : 'velocity');
  const [productPage, setProductPage] = useState(0);
  const productPageSize = 25;
  const data = useLiveQuery(async () => {
    const velocitySince = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const [previousFrom, previousTo] = previousDateRange(from, to);
    const periodRange = rangeIso(from, to);
    const [p, previousP, transactions, salesProducts, catalogProducts, ep, jc, accounts, velocity] = await Promise.all([
      profitSummary(from, to),
      canSeeCashFlow ? profitSummary(previousFrom, previousTo) : Promise.resolve(null),
      canSeeCashFlow ? db.accountTxns.where('date').between(periodRange[0], periodRange[1], true, true).toArray() : Promise.resolve([]),
      productSales(from, to),
      db.products.toArray(),
      serviceSummary('Easypaisa', from, to),
      serviceSummary('JazzCash', from, to),
      db.accounts.toArray(),
      getSalesVelocity(velocitySince).catch(() => ({} as Record<string, number>)),
    ]);
    const salesByProduct = new Map(salesProducts.map((product) => [product.productId, product]));
    const catalogIds = new Set(catalogProducts.map((product) => product.id));
    const products = [
      ...catalogProducts.map((product) => salesByProduct.get(product.id) ?? {
        productId: product.id,
        name: product.name,
        qty: 0,
        revenue: 0,
        cost: 0,
        profit: 0,
      }),
      ...salesProducts.filter((product) => !catalogIds.has(product.productId)),
    ];
    return {
      p,
      previousP,
      cashFlow: previousP ? buildCashFlowInsights(p, previousP, transactions) : null,
      products,
      ep,
      jc,
      accounts,
      velocity,
      previousRange: [previousFrom, previousTo] as const,
    };
  }, [from, to, canSeeCashFlow]);

  const exportSales = async () => {
    const [s, e] = rangeIso(from, to);
    const sales = await db.sales.where('date').between(s, e, true, true).toArray();
    downloadCsv(`sales_${from}_${to}.csv`, [
      ['Invoice', 'Date', 'Status', 'Items', 'Subtotal', 'Discount', 'Total', 'Udhaar', 'Returned'],
      ...sales.map((x) => [x.no, fmtDateTime(x.date), x.status, x.items.length, x.subtotal / 100, x.discount / 100, x.total / 100, x.credit / 100, x.returnedTotal / 100]),
    ]);
  };

  if (!data) return null;
  const { p, previousP, cashFlow, products, ep, jc, accounts, velocity, previousRange } = data;
  const margin = p.revenue > 0 ? (p.grossProfit / p.revenue) * 100 : 0;
  const selectedPreset = PRESETS.find((preset) => {
    const [presetFrom, presetTo] = preset.range();
    return presetFrom === from && presetTo === to;
  })?.label;
  const expenseRows = Object.entries(p.expensesByCategory).sort((a, b) => b[1] - a[1]);
  const paymentRows = Object.entries(p.byPayment);
  const maxPayment = Math.max(0, ...paymentRows.map(([, amount]) => amount), p.creditSales);
  const maxExpense = Math.max(0, ...expenseRows.map(([, amount]) => amount));
  const query = productQuery.trim().toLocaleLowerCase();
  const productRows = [...products]
    .filter((product) => focus !== 'product-performance' || !searchParams.get('productId') || product.productId === searchParams.get('productId'))
    .filter((product) => !query || product.name.toLocaleLowerCase().includes(query))
    .sort((a, b) => {
      const value = (row: (typeof products)[number]) => {
        if (productSort === 'velocity') return velocity[row.productId] ?? 0;
        if (productSort === 'margin') return row.revenue > 0 ? row.profit / row.revenue : -Infinity;
        return row[productSort];
      };
      return value(b) - value(a) || a.name.localeCompare(b.name);
    });
  const productPageCount = Math.ceil(productRows.length / productPageSize);
  const currentProductPage = Math.min(productPage, Math.max(0, productPageCount - 1));
  const pageProducts = productRows.slice(currentProductPage * productPageSize, (currentProductPage + 1) * productPageSize);

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-2xl bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 text-white shadow-lg">
        <div className="flex flex-col gap-6 p-5 sm:p-7 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-medium text-indigo-100">
              <ChartNoAxesCombined size={14} /> Business overview
            </div>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Reports & insights</h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-300">
              Track sales, profit and shop performance. Profit is based on sales less cost of goods sold and expenses—not purchases.
            </p>
          </div>
          <Button className="shrink-0 border border-white/15 bg-white/10 text-white hover:bg-white/20" onClick={exportSales}>
            <Download size={16} /> Export sales CSV
          </Button>
        </div>
      </section>

      {focus && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          <span>Focused view: <strong>{focus === 'sales-day' ? `Sales for ${from}` : focus === 'weekly-sales' ? 'Weekly sales trend' : focus === 'sales-decline' ? 'Sales decline · last 7 days' : focus === 'sales-growth' ? 'Sales growth · last 7 days' : 'Product performance'}</strong></span>
          <Button size="sm" variant="secondary" onClick={() => { setFocus(''); const next = new URLSearchParams(searchParams); next.delete('focus'); next.delete('date'); next.delete('productId'); setSearchParams(next, { replace: true }); setProductQuery(''); }}>Clear focus</Button>
        </div>
      )}

      <Card className="p-4 sm:p-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-800">
              <CalendarDays size={16} className="text-brand-600" /> Reporting period
            </div>
            <div className="flex flex-wrap gap-2">
              {PRESETS.map((preset) => (
                <Button
                  key={preset.label}
                  size="sm"
                  variant="secondary"
                  className={cx(selectedPreset === preset.label && 'border-brand-600 bg-brand-50 text-brand-700')}
                  onClick={() => setRange(preset.range())}
                >
                  {preset.label}
                </Button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:flex">
            <Field label="From">
              <Input className="min-w-0 sm:w-40" type="date" value={from} max={to} onChange={(event) => setRange([event.target.value, to])} />
            </Field>
            <Field label="To">
              <Input className="min-w-0 sm:w-40" type="date" value={to} min={from} max={dayKey()} onChange={(event) => setRange([from, event.target.value])} />
            </Field>
          </div>
        </div>
      </Card>

      <section aria-label="Key performance indicators" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Net sales" value={rs(p.revenue)} sub={`${p.salesCount} bills · ${rs(p.returns)} returned`} icon={<ReceiptText size={18} className="text-sky-600" />} />
        <Stat label="Gross profit" value={rs(p.grossProfit)} tone="green" sub={`${margin.toFixed(1)}% gross margin`} icon={<ArrowUpRight size={18} className="text-emerald-600" />} />
        <Stat label="Expenses" value={rs(p.expenses)} tone="red" sub="Shop operating expenses" icon={<ArrowDownRight size={18} className="text-rose-600" />} />
        <Stat label="Net profit" value={rs(p.netProfit)} tone={p.netProfit >= 0 ? 'green' : 'red'} sub="After expenses and stock loss" icon={<Wallet size={18} className={p.netProfit >= 0 ? 'text-emerald-600' : 'text-rose-600'} />} />
      </section>

      {canSeeCashFlow && cashFlow && previousP && (
        <section aria-label="Cash flow and expense intelligence" className="space-y-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Cash-flow & expense intelligence</h2>
            <p className="text-sm text-slate-500">
              Recorded account movements and expense trends for {from} to {to}, compared with {previousRange[0]} to {previousRange[1]}.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Stat label="Account inflow entries" value={rs(cashFlow.inflows)} sub="Gross positive operating entries" tone="green" />
            <Stat label="Account outflow entries" value={rs(cashFlow.outflows)} sub="Gross negative operating entries" tone="red" />
            <Stat
              label="Net account movement"
              value={rs(cashFlow.netAccountMovement)}
              tone={cashFlow.netAccountMovement >= 0 ? 'green' : 'red'}
              sub="Transfers and balance adjustments excluded"
            />
            <Stat
              label="Expenses / net sales"
              value={cashFlow.expenseRatioPercent === null ? '—' : `${cashFlow.expenseRatioPercent.toFixed(1)}%`}
              sub={cashFlow.expenseRatioPercent === null ? 'No net sales recorded in this period' : 'Operating expenses ÷ sales after returns'}
            />
          </div>
          <Card title="Expense and profit signals">
            <div className="grid gap-4 p-4 md:grid-cols-2">
              <div>
                <div className="text-sm font-medium text-slate-700">Profit change vs previous period</div>
                <div className={cx('mt-1 text-xl font-bold tabular-nums', cashFlow.netProfitChange >= 0 ? 'text-emerald-700' : 'text-rose-700')}>
                  {cashFlow.netProfitChange >= 0 ? '+' : ''}{rs(cashFlow.netProfitChange)}
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  Net profit: {rs(p.netProfit)} current · {rs(previousP.netProfit)} previous.
                </p>
              </div>
              <div>
                <div className="text-sm font-medium text-slate-700">Largest expense category</div>
                {cashFlow.largestExpense ? (
                  <>
                    <div className="mt-1 text-xl font-bold text-slate-900">{cashFlow.largestExpense.category} · {rs(cashFlow.largestExpense.amount)}</div>
                    <p className="mt-1 text-xs text-slate-500">
                      {cashFlow.largestExpense.change === 0
                        ? 'Unchanged versus the previous period.'
                        : `${cashFlow.largestExpense.change > 0 ? 'Up' : 'Down'} ${rs(Math.abs(cashFlow.largestExpense.change))} versus the previous period.`}
                    </p>
                  </>
                ) : <p className="mt-1 text-sm text-slate-500">No operating expenses recorded for this period.</p>}
              </div>
              {cashFlow.largestExpenseIncrease && (
                <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900 md:col-span-2">
                  <strong>Largest expense increase:</strong> {cashFlow.largestExpenseIncrease.category} rose by {rs(cashFlow.largestExpenseIncrease.change)} compared with the previous period.
                </p>
              )}
            </div>
          </Card>
          <p className="text-xs text-slate-500">
            Ledger movement is not the same as profit. Gross entries may include both sides of retailer cash/float activity; the net sums account movements. Internal transfers, opening balances and adjustments are excluded; credit purchases are not treated as cash out until paid. This is a review aid, not a cash forecast.
          </p>
        </section>
      )}

      <section className="grid items-start gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <Card className="overflow-hidden">
          <div className="border-b border-slate-100 px-4 py-4 sm:px-5">
            <div className="flex items-center gap-2">
              <span className="rounded-lg bg-indigo-50 p-2 text-indigo-700"><ChartNoAxesCombined size={18} /></span>
              <div>
                <h2 className="font-semibold text-slate-900">Profit & loss</h2>
                <p className="text-xs text-slate-500">A clear breakdown for the selected period</p>
              </div>
            </div>
          </div>
          <div className="space-y-3 p-4 text-sm sm:p-5">
            <Line label="Gross sales" value={p.grossSales} />
            <Line label="Returns" value={-p.returns} />
            <Line label="Net revenue" value={p.revenue} bold />
            <div className="my-1 border-t border-dashed border-slate-200" />
            <Line label="Cost of goods sold" value={-p.cogs} />
            <Line label="Gross profit" value={p.grossProfit} bold />
            <Line label="Retailer service commissions & fees" value={p.serviceIncome} />
            <Line label="Shop expenses" value={-p.expenses} />
            <Line label="Damaged / expired / missing stock" value={-p.stockLoss} />
            <div className={cx('mt-2 rounded-xl p-4', p.netProfit >= 0 ? 'bg-emerald-50' : 'bg-rose-50')}>
              <Line label="Net profit" value={p.netProfit} bold big />
            </div>
            <div className="grid gap-2 border-t border-slate-100 pt-3 text-xs text-slate-500 sm:grid-cols-2">
              <Line label="Owner withdrawals (not an expense)" value={-p.drawings} />
              <Line label="Sold on credit" value={p.creditSales} />
            </div>
          </div>
        </Card>

        <div className="space-y-4">
          <Card>
            <div className="border-b border-slate-100 px-4 py-4">
              <h2 className="font-semibold text-slate-900">Sales by payment method</h2>
              <p className="text-xs text-slate-500">How customers paid during this period</p>
            </div>
            <div className="space-y-4 p-4">
              {paymentRows.length === 0 && p.creditSales === 0 ? <p className="text-sm text-slate-500">No payments recorded.</p> : (
                <>
                  {paymentRows.map(([id, amount]) => (
                    <MeterRow key={id} label={accounts.find((account) => account.id === id)?.name ?? id} value={amount} max={maxPayment} tone="blue" />
                  ))}
                  {p.creditSales > 0 && <MeterRow label="Udhaar (credit)" value={p.creditSales} max={maxPayment} tone="amber" />}
                </>
              )}
            </div>
          </Card>

          <Card>
            <div className="border-b border-slate-100 px-4 py-4">
              <h2 className="font-semibold text-slate-900">Expenses by category</h2>
              <p className="text-xs text-slate-500">Largest expenses first</p>
            </div>
            <div className="space-y-4 p-4">
              {expenseRows.length === 0 ? <p className="text-sm text-slate-500">No expenses recorded.</p> : expenseRows.map(([category, amount]) => (
                <MeterRow key={category} label={category} value={amount} max={maxExpense} tone="rose" />
              ))}
            </div>
          </Card>

          <Card>
            <div className="border-b border-slate-100 px-4 py-4">
              <h2 className="font-semibold text-slate-900">Retailer services</h2>
              <p className="text-xs text-slate-500">Commission and fees earned</p>
            </div>
            <div className="space-y-3 p-4 text-sm">
              <Line label={`Easypaisa · ${ep.count} txns · ${rs(ep.volume)} volume`} value={ep.commission + ep.fees} />
              <Line label={`JazzCash · ${jc.count} txns · ${rs(jc.volume)} volume`} value={jc.commission + jc.fees} />
            </div>
          </Card>
        </div>
      </section>

      <Card
        className={cx('overflow-hidden', focus === 'product-performance' && 'ring-2 ring-brand-700 ring-offset-2')}
        title={
          <div className="flex items-center gap-2">
            <span className="rounded-lg bg-sky-50 p-2 text-sky-700"><Package size={17} /></span>
            <div><span className="block">Product performance</span><span className="block text-xs font-normal text-slate-500">All {products.length} catalog products · velocity uses last 30 days</span></div>
          </div>
        }
        actions={
          products.length > 0 && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                downloadCsv(`products_${from}_${to}.csv`, [
                  ['Product', 'Qty in period', 'Units sold last 30 days', 'Avg units per day', 'Revenue', 'Cost of goods sold', 'Profit', 'Margin %'],
                  ...productRows.map((product) => [
                    product.name,
                    product.qty,
                    velocity[product.productId] ?? 0,
                    (velocity[product.productId] ?? 0) / 30,
                    product.revenue / 100,
                    product.cost / 100,
                    product.profit / 100,
                    product.revenue ? (product.profit / product.revenue) * 100 : 0,
                  ]),
                ])
              }
            >
              <Download size={14} /> Export CSV
            </Button>
          )
        }
      >
        <div className="flex flex-col gap-3 border-b border-slate-100 p-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="relative w-full sm:max-w-sm">
            <Search size={16} className="absolute top-1/2 left-3 -translate-y-1/2 text-slate-400" />
            <Input className="pl-9" placeholder="Find a product…" value={productQuery} onChange={(event) => { setProductQuery(event.target.value); setProductPage(0); }} />
          </div>
          <Field label="Sort products">
            <Select value={productSort} onChange={(event) => { setProductSort(event.target.value as typeof productSort); setProductPage(0); }}>
              <option value="velocity">Sales velocity · last 30 days</option>
              <option value="profit">Profit · selected period</option>
              <option value="revenue">Revenue · selected period</option>
              <option value="qty">Units sold · selected period</option>
              <option value="margin">Profit margin · selected period</option>
            </Select>
          </Field>
        </div>
        {products.length === 0 ? (
          <Empty title="No products in the catalog" />
        ) : productRows.length === 0 ? (
          <Empty title="No matching products" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50">
                <tr>
                  <th className={th}>#</th>
                  <th className={th}>Product</th>
                  <th className={cx(th, 'text-right')}>Qty · period</th>
                  <th className={cx(th, 'text-right')}>Qty · 30d</th>
                  <th className={cx(th, 'text-right')}>Avg/day</th>
                  <th className={cx(th, 'text-right')}>Revenue</th>
                  <th className={cx(th, 'text-right')}>COGS</th>
                  <th className={cx(th, 'text-right')}>Profit</th>
                  <th className={cx(th, 'text-right')}>Margin</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pageProducts.map((product, index) => {
                  const velocityQty = velocity[product.productId] ?? 0;
                  return (
                  <tr key={product.productId} className="transition-colors hover:bg-slate-50">
                    <td className={cx(td, 'text-slate-400')}>{currentProductPage * productPageSize + index + 1}</td>
                    <td className={cx(td, 'font-medium text-slate-800')}>{product.name}</td>
                    <td className={cx(td, 'text-right tabular-nums')}>{qty(product.qty)}</td>
                    <td className={cx(td, 'text-right tabular-nums font-medium text-teal-800')}>{qty(velocityQty)}</td>
                    <td className={cx(td, 'text-right tabular-nums text-slate-500')}>{qty(velocityQty / 30)}</td>
                    <td className={cx(td, 'text-right tabular-nums')}>{rs(product.revenue)}</td>
                    <td className={cx(td, 'text-right tabular-nums text-slate-500')}>{rs(product.cost)}</td>
                    <td className={cx(td, 'text-right tabular-nums font-medium', product.profit < 0 ? 'text-rose-600' : 'text-emerald-600')}>{rs(product.profit)}</td>
                    <td className={cx(td, 'text-right tabular-nums')}>{product.revenue ? `${((product.profit / product.revenue) * 100).toFixed(1)}%` : '—'}</td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {productRows.length > 0 && (
          <div className="flex flex-col gap-2 border-t border-slate-100 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-slate-500">
              Showing {currentProductPage * productPageSize + 1}–{Math.min((currentProductPage + 1) * productPageSize, productRows.length)} of {productRows.length} products
            </p>
            <div className="flex items-center justify-end gap-2">
              <Button
                size="sm"
                variant="secondary"
                disabled={currentProductPage === 0}
                onClick={() => setProductPage((page) => Math.max(0, page - 1))}
              >
                <ChevronLeft size={15} /> Previous
              </Button>
              <span className="min-w-16 text-center text-xs tabular-nums text-slate-600">
                {currentProductPage + 1} / {Math.max(1, productPageCount)}
              </span>
              <Button
                size="sm"
                variant="secondary"
                disabled={currentProductPage + 1 >= productPageCount}
                onClick={() => setProductPage((page) => Math.min(productPageCount - 1, page + 1))}
              >
                Next <ChevronRight size={15} />
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

function MeterRow({ label, value, max, tone }: { label: string; value: number; max: number; tone: 'blue' | 'amber' | 'rose' }) {
  const colors = { blue: 'bg-sky-500', amber: 'bg-amber-500', rose: 'bg-rose-500' };
  const width = max > 0 ? Math.max(value > 0 ? 3 : 0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-3 text-sm">
        <span className="truncate text-slate-600">{label}</span>
        <span className="shrink-0 font-semibold tabular-nums text-slate-900">{rs(value)}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-100">
        <div className={cx('h-full rounded-full transition-all', colors[tone])} style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

function Line({ label, value, bold, big }: { label: string; value: number; bold?: boolean; big?: boolean }) {
  return (
    <div className={cx('flex justify-between', bold && 'font-semibold', big && 'text-lg')}>
      <span>{label}</span>
      <span className={cx('tabular-nums', value < 0 && 'text-rose-600')}>{rs(value)}</span>
    </div>
  );
}
