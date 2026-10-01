import { useLiveQuery } from 'dexie-react-hooks';
import { MessageCircle, Printer } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Badge, Button, Card, Empty, PageHeader, Stat, cx, td, th } from '../components/ui';
import { db, type Supplier } from '../lib/db';
import { lineTotal, qty, rs } from '../lib/format';
import { reorderReport, stockValue, type ReorderRow } from '../lib/reports';
import { useSession } from '../lib/session';

const STATUS: Record<ReorderRow['status'], { label: string; tone: 'red' | 'amber' | 'green' | 'default' }> = {
  order_now: { label: '🔴 Order now', tone: 'red' },
  reorder_soon: { label: '🟠 Reorder soon', tone: 'amber' },
  ok: { label: '🟢 OK', tone: 'green' },
  no_sales: { label: 'No recent sales', tone: 'default' },
};

export function InventoryPage() {
  const { settings, can } = useSession();
  const [tab, setTab] = useState<'orders' | 'stock'>('orders');
  const [filter, setFilter] = useState<'all' | 'low' | 'out'>('low');
  const rows = useLiveQuery(() => reorderReport(settings?.leadDays ?? 2), [settings?.leadDays]) ?? [];
  const suppliers = useLiveQuery(() => db.suppliers.toArray(), []) ?? [];
  const showCost = can('cost');

  const products = rows.map((r) => r.product);
  const value = stockValue(products);
  const needOrder = rows.filter((r) => r.status === 'order_now' || r.status === 'reorder_soon');

  return (
    <div>
      <PageHeader title="Stock & Reorder" subtitle="What is in the shop, and what to order from whom" />
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {showCost && <Stat label="Money in stock" value={rs(value)} sub="At average purchase cost" />}
        <Stat label="Order now" value={rows.filter((r) => r.status === 'order_now').length} tone="red" sub="May run out before supplier delivers" />
        <Stat label="Reorder soon" value={rows.filter((r) => r.status === 'reorder_soon').length} tone="amber" />
        <Stat label="Out of stock" value={products.filter((p) => p.stock <= 0).length} tone="red" />
      </div>
      <div className="mb-3 flex gap-2">
        <Button variant={tab === 'orders' ? 'primary' : 'secondary'} onClick={() => setTab('orders')}>
          Today's orders
        </Button>
        <Button variant={tab === 'stock' ? 'primary' : 'secondary'} onClick={() => setTab('stock')}>
          Stock list
        </Button>
      </div>
      {tab === 'orders' ? (
        <OrderPlanner rows={needOrder} suppliers={suppliers} shopName={settings?.shopName ?? ''} showCost={showCost} />
      ) : (
        <Card>
          <div className="flex gap-2 border-b border-slate-100 p-3">
            {(['low', 'out', 'all'] as const).map((f) => (
              <Button key={f} size="sm" variant={filter === f ? 'primary' : 'secondary'} onClick={() => setFilter(f)}>
                {f === 'low' ? 'Low stock' : f === 'out' ? 'Out of stock' : 'All'}
              </Button>
            ))}
          </div>
          <StockTable
            rows={rows.filter((r) => (filter === 'all' ? true : filter === 'out' ? r.product.stock <= 0 : r.status === 'order_now' || r.status === 'reorder_soon'))}
            showCost={showCost}
          />
        </Card>
      )}
    </div>
  );
}

function StockTable({ rows, showCost }: { rows: ReorderRow[]; showCost: boolean }) {
  if (rows.length === 0) return <Empty title="Nothing here">All products have enough stock.</Empty>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead className="bg-slate-50">
          <tr>
            <th className={th}>Product</th>
            <th className={cx(th, 'text-right')}>Stock</th>
            <th className={cx(th, 'text-right')}>Avg sale / day</th>
            <th className={cx(th, 'text-right')}>Days left</th>
            <th className={cx(th, 'text-right')}>Reorder at</th>
            {showCost && <th className={cx(th, 'text-right')}>Value</th>}
            <th className={th}>Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {[...rows]
            .sort((a, b) => (a.daysLeft ?? 9999) - (b.daysLeft ?? 9999))
            .map((r) => (
              <tr key={r.product.id}>
                <td className={cx(td, 'font-medium')}>{r.product.name}</td>
                <td className={cx(td, 'text-right tabular-nums')}>
                  {qty(r.product.stock)} <span className="text-xs text-slate-400">{r.product.unit}</span>
                </td>
                <td className={cx(td, 'text-right tabular-nums')}>{r.avgDaily ? r.avgDaily.toFixed(1) : '—'}</td>
                <td className={cx(td, 'text-right tabular-nums')}>{r.daysLeft === null ? '—' : r.daysLeft.toFixed(1)}</td>
                <td className={cx(td, 'text-right tabular-nums')}>{Math.ceil(r.reorderPoint)}</td>
                {showCost && <td className={cx(td, 'text-right tabular-nums')}>{rs(r.product.stock > 0 ? lineTotal(r.product.cost, r.product.stock) : 0)}</td>}
                <td className={td}>
                  <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
                </td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}

/** "Generate Today's Orders": recommendations grouped by supplier, editable, printable, shareable. */
function OrderPlanner({ rows, suppliers, shopName, showCost }: { rows: ReorderRow[]; suppliers: Supplier[]; shopName: string; showCost: boolean }) {
  const [edits, setEdits] = useState<Record<string, number>>({});
  const groups = useMemo(() => {
    const map = new Map<string, ReorderRow[]>();
    for (const r of rows) {
      const key = r.product.supplierId ?? 'none';
      map.set(key, [...(map.get(key) ?? []), r]);
    }
    return [...map.entries()].map(([supplierId, items]) => ({ supplier: suppliers.find((s) => s.id === supplierId), supplierId, items }));
  }, [rows, suppliers]);

  const qtyFor = (r: ReorderRow) => edits[r.product.id] ?? r.suggestedQty;
  const groupTotal = (items: ReorderRow[]) => items.reduce((s, r) => s + lineTotal(r.product.cost, qtyFor(r)), 0);
  const grand = groups.reduce((s, g) => s + groupTotal(g.items), 0);

  const orderText = (supplierName: string, items: ReorderRow[]) =>
    [
      `*${shopName} — Order for ${supplierName}*`,
      new Date().toLocaleDateString('en-PK'),
      '',
      ...items
        .filter((r) => qtyFor(r) > 0)
        .map((r) => {
          const q = qtyFor(r);
          const packs = r.product.packSize && r.product.packSize > 1 ? ` (${+(q / r.product.packSize).toFixed(2)} ${r.product.packName ?? 'pack'})` : '';
          return `• ${r.product.name} — ${q} ${r.product.unit}${packs}`;
        }),
    ].join('\n');

  if (rows.length === 0) return <Card><Empty title="Nothing to order today 🎉">All products have enough stock for the next days.</Empty></Card>;

  return (
    <div className="space-y-4">
      {showCost && (
        <Card className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-sm text-slate-500">Total recommended purchase</div>
              <div className="text-2xl font-bold">{rs(grand)}</div>
            </div>
            <p className="max-w-md text-xs text-slate-500">
              Based on the last 30 days of sales, supplier delivery time and 7 days of cover, rounded up to full cartons. Change any quantity before sending.
            </p>
          </div>
        </Card>
      )}
      {groups.map((g) => (
        <Card
          key={g.supplierId}
          title={
            <span>
              {g.supplier?.name ?? 'No supplier set'} <span className="text-sm font-normal text-slate-500">· {g.items.length} products{showCost && ` · ${rs(groupTotal(g.items))}`}</span>
            </span>
          }
          actions={
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  const w = window.open('', '_blank', 'width=480,height=640');
                  if (!w) return;
                  w.document.write(`<pre style="font:14px monospace;white-space:pre-wrap">${orderText(g.supplier?.name ?? 'Supplier', g.items).replace(/\*/g, '')}</pre>`);
                  w.document.close();
                  w.print();
                }}
              >
                <Printer size={14} /> Print
              </Button>
              <Button
                size="sm"
                variant="success"
                onClick={() => {
                  const phone = (g.supplier?.phone ?? '').replace(/\D/g, '').replace(/^0/, '92');
                  window.open(`https://wa.me/${phone}?text=${encodeURIComponent(orderText(g.supplier?.name ?? 'Supplier', g.items))}`, '_blank');
                }}
              >
                <MessageCircle size={14} /> WhatsApp
              </Button>
            </div>
          }
        >
          <table className="w-full">
            <thead className="bg-slate-50">
              <tr>
                <th className={th}>Product</th>
                <th className={cx(th, 'text-right')}>Stock</th>
                <th className={cx(th, 'text-right')}>Sale / day</th>
                <th className={cx(th, 'text-right')}>Order qty</th>
                <th className={cx(th, 'text-right')}>Packs</th>
                {showCost && <th className={cx(th, 'text-right')}>Est. cost</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {g.items.map((r) => {
                const q = qtyFor(r);
                return (
                  <tr key={r.product.id}>
                    <td className={td}>
                      {r.status === 'order_now' ? '🔴' : '🟠'} {r.product.name}
                    </td>
                    <td className={cx(td, 'text-right tabular-nums')}>{qty(r.product.stock)}</td>
                    <td className={cx(td, 'text-right tabular-nums')}>{r.avgDaily ? r.avgDaily.toFixed(1) : '—'}</td>
                    <td className={cx(td, 'text-right')}>
                      <input
                        className="w-20 rounded border border-slate-300 px-2 py-1 text-right text-sm"
                        inputMode="decimal"
                        value={q}
                        onChange={(e) => setEdits((x) => ({ ...x, [r.product.id]: Math.max(0, Number(e.target.value) || 0) }))}
                      />{' '}
                      <span className="text-xs text-slate-400">{r.product.unit}</span>
                    </td>
                    <td className={cx(td, 'text-right tabular-nums text-slate-600')}>
                      {r.product.packSize && r.product.packSize > 1 ? `${+(q / r.product.packSize).toFixed(2)} ${r.product.packName ?? ''}` : '—'}
                    </td>
                    {showCost && <td className={cx(td, 'text-right tabular-nums')}>{rs(lineTotal(r.product.cost, q))}</td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      ))}
    </div>
  );
}
