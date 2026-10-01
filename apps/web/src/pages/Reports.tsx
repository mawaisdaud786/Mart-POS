import { useLiveQuery } from 'dexie-react-hooks';
import { Download } from 'lucide-react';
import { useState } from 'react';
import { Button, Card, Empty, Field, Input, PageHeader, Stat, cx, td, th } from '../components/ui';
import { db } from '../lib/db';
import { dayKey, daysAgo, fmtDateTime, qty, rangeIso, rs } from '../lib/format';
import { productSales, profitSummary, serviceSummary } from '../lib/reports';

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
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  URL.revokeObjectURL(url);
}

export function ReportsPage() {
  const [[from, to], setRange] = useState<[string, string]>(() => [monthStart(), dayKey()]);
  const data = useLiveQuery(async () => {
    const [p, products, ep, jc, accounts] = await Promise.all([
      profitSummary(from, to),
      productSales(from, to),
      serviceSummary('Easypaisa', from, to),
      serviceSummary('JazzCash', from, to),
      db.accounts.toArray(),
    ]);
    return { p, products, ep, jc, accounts };
  }, [from, to]);

  const exportSales = async () => {
    const [s, e] = rangeIso(from, to);
    const sales = await db.sales.where('date').between(s, e, true, true).toArray();
    downloadCsv(`sales_${from}_${to}.csv`, [
      ['Invoice', 'Date', 'Status', 'Items', 'Subtotal', 'Discount', 'Total', 'Udhaar', 'Returned'],
      ...sales.map((x) => [x.no, fmtDateTime(x.date), x.status, x.items.length, x.subtotal / 100, x.discount / 100, x.total / 100, x.credit / 100, x.returnedTotal / 100]),
    ]);
  };

  if (!data) return null;
  const { p, products, ep, jc, accounts } = data;
  const margin = p.revenue > 0 ? (p.grossProfit / p.revenue) * 100 : 0;

  return (
    <div>
      <PageHeader
        title="Reports"
        subtitle="Profit is calculated as sales − cost of goods sold − expenses (not sales − purchases)"
        actions={
          <Button variant="secondary" onClick={exportSales}>
            <Download size={16} /> Export sales (CSV)
          </Button>
        }
      />
      <Card className="mb-4 p-3">
        <div className="flex flex-wrap items-end gap-2">
          {PRESETS.map((pr) => (
            <Button key={pr.label} size="sm" variant="secondary" onClick={() => setRange(pr.range())}>
              {pr.label}
            </Button>
          ))}
          <Field label="From">
            <Input type="date" value={from} onChange={(e) => setRange([e.target.value, to])} />
          </Field>
          <Field label="To">
            <Input type="date" value={to} onChange={(e) => setRange([from, e.target.value])} />
          </Field>
        </div>
      </Card>

      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Sales (after returns)" value={rs(p.revenue)} sub={`${p.salesCount} bills · returns ${rs(p.returns)}`} />
        <Stat label="Gross profit" value={rs(p.grossProfit)} tone="green" sub={`Margin ${margin.toFixed(1)}%`} />
        <Stat label="Expenses" value={rs(p.expenses)} tone="red" />
        <Stat label="Net profit" value={rs(p.netProfit)} tone={p.netProfit >= 0 ? 'green' : 'red'} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Profit & loss">
          <div className="space-y-2 p-4 text-sm">
            <Line label="Sales" value={p.grossSales} />
            <Line label="− Returns" value={-p.returns} />
            <Line label="= Revenue" value={p.revenue} bold />
            <Line label="− Cost of goods sold" value={-p.cogs} />
            <Line label="= Gross profit" value={p.grossProfit} bold />
            <Line label="+ Easypaisa/JazzCash commission & fees" value={p.serviceIncome} />
            <Line label="− Shop expenses" value={-p.expenses} />
            <Line label="− Damaged / expired / missing stock" value={-p.stockLoss} />
            <Line label="= Net profit" value={p.netProfit} bold big />
            <div className="border-t border-dashed border-slate-200 pt-2 text-slate-500">
              <Line label="Owner withdrawals (not an expense)" value={-p.drawings} />
              <Line label="Sold on udhaar in this period" value={p.creditSales} />
            </div>
          </div>
        </Card>
        <div className="space-y-4">
          <Card title="Sales by payment method">
            <div className="space-y-2 p-4 text-sm">
              {Object.entries(p.byPayment).length === 0 && <p className="text-slate-500">No payments.</p>}
              {Object.entries(p.byPayment).map(([id, amt]) => (
                <Line key={id} label={accounts.find((a) => a.id === id)?.name ?? id} value={amt} />
              ))}
              {p.creditSales > 0 && <Line label="Udhaar (credit)" value={p.creditSales} />}
            </div>
          </Card>
          <Card title="Expenses by category">
            <div className="space-y-2 p-4 text-sm">
              {Object.entries(p.expensesByCategory).length === 0 && <p className="text-slate-500">No expenses.</p>}
              {Object.entries(p.expensesByCategory)
                .sort((a, b) => b[1] - a[1])
                .map(([c, amt]) => (
                  <Line key={c} label={c} value={amt} />
                ))}
            </div>
          </Card>
          <Card title="Retailer services">
            <div className="space-y-2 p-4 text-sm">
              <Line label={`Easypaisa (${ep.count} txns, volume ${rs(ep.volume)})`} value={ep.commission + ep.fees} />
              <Line label={`JazzCash (${jc.count} txns, volume ${rs(jc.volume)})`} value={jc.commission + jc.fees} />
            </div>
          </Card>
        </div>
      </div>

      <Card
        className="mt-4"
        title="Products sold"
        actions={
          products.length > 0 && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                downloadCsv(`products_${from}_${to}.csv`, [
                  ['Product', 'Qty', 'Revenue', 'Cost', 'Profit'],
                  ...products.map((r) => [r.name, r.qty, r.revenue / 100, r.cost / 100, r.profit / 100]),
                ])
              }
            >
              <Download size={14} /> CSV
            </Button>
          )
        }
      >
        {products.length === 0 ? (
          <Empty title="No products sold in this period" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50">
                <tr>
                  <th className={th}>#</th>
                  <th className={th}>Product</th>
                  <th className={cx(th, 'text-right')}>Qty</th>
                  <th className={cx(th, 'text-right')}>Revenue</th>
                  <th className={cx(th, 'text-right')}>Profit</th>
                  <th className={cx(th, 'text-right')}>Margin</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {products.map((r, i) => (
                  <tr key={r.productId}>
                    <td className={cx(td, 'text-slate-400')}>{i + 1}</td>
                    <td className={cx(td, 'font-medium')}>{r.name}</td>
                    <td className={cx(td, 'text-right tabular-nums')}>{qty(r.qty)}</td>
                    <td className={cx(td, 'text-right tabular-nums')}>{rs(r.revenue)}</td>
                    <td className={cx(td, 'text-right tabular-nums', r.profit < 0 ? 'text-rose-600' : 'text-emerald-600')}>{rs(r.profit)}</td>
                    <td className={cx(td, 'text-right tabular-nums')}>{r.revenue ? `${((r.profit / r.revenue) * 100).toFixed(1)}%` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
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
