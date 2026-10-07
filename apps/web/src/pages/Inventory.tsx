import { MessageCircle, Printer } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Badge, Button, Card, Empty, PageHeader, Stat, cx, td, th } from '../components/ui';
import { db, type Supplier } from '../lib/db';
import { lineTotal, qty, rs } from '../lib/format';
import { reorderReport, stockValue, type ReorderRow } from '../lib/reports';
import { UpcomingDemandPanel } from '../components/UpcomingDemandPanel';
import { useSession } from '../lib/session';
import { useLiveQuery } from '../lib/store';

const STATUS: Record<ReorderRow['status'], { label: string; tone: 'red' | 'amber' | 'green' | 'default' }> = {
  order_now: { label: '🔴 Order now', tone: 'red' },
  reorder_soon: { label: '🟠 Reorder soon', tone: 'amber' },
  ok: { label: '🟢 OK', tone: 'green' },
  no_sales: { label: 'No recent sales', tone: 'default' },
};

export function InventoryPage() {
  const { settings, can } = useSession();
  const [searchParams, setSearchParams] = useSearchParams();
  const [focus, setFocus] = useState(() => searchParams.get('focus') ?? '');
  const [tab, setTab] = useState<'orders' | 'slow' | 'overstock' | 'stock' | 'demand'>(() => {
    const initialFocus = searchParams.get('focus');
    if (initialFocus === 'upcoming-demand') return 'demand';
    return initialFocus === 'slow' ? 'slow' : initialFocus === 'overstock' ? 'overstock' : initialFocus === 'negative-stock' || initialFocus === 'product' || initialFocus === 'stock-list' ? 'stock' : 'orders';
  });
  const [filter, setFilter] = useState<'all' | 'low' | 'out'>('low');
  const rows = useLiveQuery(
    () => reorderReport(settings?.leadDays ?? 2, {
      coverDays: settings?.stockReorderCoverDays ?? 7,
      salesVelocityDays: settings?.stockSalesVelocityDays ?? 30,
      safetyStockDays: settings?.stockSafetyDays ?? 2,
      lowStockDaysThreshold: settings?.stockLowDaysThreshold ?? 3,
    }),
    [settings?.leadDays, settings?.stockReorderCoverDays, settings?.stockSalesVelocityDays, settings?.stockSafetyDays, settings?.stockLowDaysThreshold],
  ) ?? [];
  const suppliers = useLiveQuery(() => db.suppliers.toArray(), []) ?? [];
  const showCost = can('cost');

  const products = rows.map((r) => r.product);
  const value = stockValue(products);
  const orderRows = rows.filter((r) => r.suggestedQty > 0);
  const slowRows = rows.filter((r) => r.product.stock > 0 && (r.lastSaleDays === null || (r.lastSaleDays ?? 0) >= (settings?.stockSlowMovingDays ?? 30)));
  const overstockRows = rows.filter((r) => r.avgDaily > 0 && r.product.stock > r.avgDaily * (settings?.stockOverstockDays ?? 60));
  const focusedRows = focus === 'negative-stock'
    ? rows.filter((r) => r.product.stock < 0)
    : focus === 'product'
      ? rows.filter((r) => r.product.id === searchParams.get('productId'))
      : focus === 'slow'
        ? slowRows
        : focus === 'overstock'
          ? overstockRows
          : focus === 'reorder-soon'
            ? rows.filter((r) => r.status === 'reorder_soon')
            : focus === 'order-now'
              ? rows.filter((r) => r.status === 'order_now')
              : rows;
  const clearFocus = () => {
    setFocus('');
    const next = new URLSearchParams(searchParams);
    next.delete('focus');
    next.delete('productId');
    setSearchParams(next, { replace: true });
  };

  return (
    <div>
      <PageHeader title="Stock & Reorder" subtitle="What is in the shop, and what to order from whom" />
      {focus && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          <span>
          Focused view: <strong>{focus === 'negative-stock' ? 'Negative stock' : focus === 'product' ? 'Selected product' : focus === 'stock-list' ? 'Stock list' : focus === 'slow' ? 'Slow-moving stock' : focus === 'overstock' ? 'Overstock' : focus === 'reorder-soon' ? 'Reorder soon' : 'Order now'}</strong>
            {' '}· {focusedRows.length} matching products
          </span>
          <Button size="sm" variant="secondary" onClick={clearFocus}>Clear focus</Button>
        </div>
      )}
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {showCost && <Stat label="Money in stock" value={rs(value)} sub="At average purchase cost" />}
        <Stat label="Order now" value={rows.filter((r) => r.status === 'order_now').length} tone="red" sub="May run out before supplier delivers" />
        <Stat label="Reorder soon" value={rows.filter((r) => r.status === 'reorder_soon').length} tone="amber" />
        <Stat label="Slow-moving stock" value={slowRows.length} tone="amber" sub={`${settings?.stockSlowMovingDays ?? 30}+ days without a sale`} />
      </div>
      <div className="mb-3 flex flex-wrap gap-2">
        <Button variant={tab === 'orders' ? 'primary' : 'secondary'} onClick={() => { clearFocus(); setTab('orders'); }}>
          Next supplier orders
        </Button>
        <Button variant={tab === 'slow' ? 'primary' : 'secondary'} onClick={() => { clearFocus(); setTab('slow'); }}>
          Slow-moving
        </Button>
        <Button variant={tab === 'overstock' ? 'primary' : 'secondary'} onClick={() => { clearFocus(); setTab('overstock'); }}>
          Overstock
        </Button>
        <Button variant={tab === 'stock' ? 'primary' : 'secondary'} onClick={() => { clearFocus(); setTab('stock'); }}>
          Stock list
        </Button>
        <Button variant={tab === 'demand' ? 'primary' : 'secondary'} onClick={() => { clearFocus(); setTab('demand'); }}>
          Upcoming demand
        </Button>
      </div>
      {tab === 'demand' ? (
        <UpcomingDemandPanel />
      ) : tab === 'orders' ? (
        <OrderPlanner rows={focus ? focusedRows : orderRows} suppliers={suppliers} shopName={settings?.shopName ?? ''} showCost={showCost} />
      ) : tab === 'slow' ? (
        <Card title={`Slow-moving stock · no sale for ${settings?.stockSlowMovingDays ?? 30}+ days`}>
          <StockTable rows={focus ? focusedRows : slowRows} suppliers={suppliers} showCost={showCost} />
        </Card>
      ) : tab === 'overstock' ? (
        <Card title={`Overstock · more than ${settings?.stockOverstockDays ?? 60} days of estimated demand`}>
          <StockTable rows={focus ? focusedRows : overstockRows} suppliers={suppliers} showCost={showCost} />
        </Card>
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
            rows={focus ? focusedRows : rows.filter((r) => (filter === 'all' ? true : filter === 'out' ? r.product.stock <= 0 : r.status === 'order_now' || r.status === 'reorder_soon'))}
            suppliers={suppliers}
            showCost={showCost}
          />
        </Card>
      )}
    </div>
  );
}

function StockTable({ rows, suppliers, showCost }: { rows: ReorderRow[]; suppliers: Supplier[]; showCost: boolean }) {
  if (rows.length === 0) return <Empty title="Nothing here">All products have enough stock.</Empty>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead className="bg-slate-50">
          <tr>
            <th className={th}>Product</th>
            <th className={th}>Supplier</th>
            <th className={cx(th, 'text-right')}>Stock</th>
            <th className={cx(th, 'text-right')}>Avg sale / day</th>
            <th className={cx(th, 'text-right')}>Days left</th>
            <th className={cx(th, 'text-right')}>Days since sale</th>
            <th className={cx(th, 'text-right')}>Reorder at</th>
            <th className={th}>Next order</th>
            <th className={th}>Delivery</th>
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
                <td className={td}>{suppliers.find((supplier) => supplier.id === r.product.supplierId)?.name ?? 'Not assigned'}</td>
                <td className={cx(td, 'text-right tabular-nums')}>
                  {qty(r.product.stock)} <span className="text-xs text-slate-400">{r.product.unit}</span>
                </td>
                <td className={cx(td, 'text-right tabular-nums')}>{r.avgDaily ? r.avgDaily.toFixed(1) : '—'}</td>
                <td className={cx(td, 'text-right tabular-nums')}>{r.daysLeft === null ? '—' : r.daysLeft.toFixed(1)}</td>
                <td className={cx(td, 'text-right tabular-nums')}>{r.lastSaleDays === null ? 'No sale recorded' : r.lastSaleDays === undefined ? '—' : r.lastSaleDays}</td>
                <td className={cx(td, 'text-right tabular-nums')}>{Math.ceil(r.reorderPoint)}</td>
                <td className={td}>{r.reorderBy ?? 'Not due'}</td>
                <td className={td}>{r.deliveryOn ?? '—'}</td>
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

/** Recommendations for the next supplier order cycle, grouped, editable, printable, and shareable. */
function OrderPlanner({ rows, suppliers, shopName, showCost }: { rows: ReorderRow[]; suppliers: Supplier[]; shopName: string; showCost: boolean }) {
  const [edits, setEdits] = useState<Record<string, number>>({});
  const groups = useMemo(() => {
    const map = new Map<string, { supplierId: string; items: ReorderRow[] }>();
    for (const r of rows) {
      const key = r.product.supplierId ?? 'none';
      const groupKey = `${key}:${r.reorderBy ?? 'unscheduled'}`;
      const group = map.get(groupKey) ?? { supplierId: key, items: [] };
      group.items.push(r);
      map.set(groupKey, group);
    }
    return [...map.entries()].map(([groupKey, { supplierId, items }]) => ({
      groupKey,
      supplier: suppliers.find((s) => s.id === supplierId),
      supplierId,
      items,
      orderOn: items[0]?.reorderBy,
      deliveryOn: items[0]?.deliveryOn,
    }));
  }, [rows, suppliers]);

  const qtyFor = (r: ReorderRow) => edits[r.product.id] ?? r.suggestedQty;
  const groupTotal = (items: ReorderRow[]) => items.reduce((s, r) => s + lineTotal(r.product.cost, qtyFor(r)), 0);
  const grand = groups.reduce((s, g) => s + groupTotal(g.items), 0);

  const orderText = (supplierName: string, items: ReorderRow[]) =>
    [
      `*${shopName} — Order for ${supplierName}*`,
      `Order: ${items[0]?.reorderBy ?? 'Today'} · Delivery: ${items[0]?.deliveryOn ?? 'To be confirmed'}`,
      '',
      ...items
        .filter((r) => qtyFor(r) > 0)
        .map((r) => {
          const q = qtyFor(r);
          const packs = r.product.packSize && r.product.packSize > 1 ? ` (${+(q / r.product.packSize).toFixed(2)} ${r.product.packName ?? 'pack'})` : '';
          return `• ${r.product.name} — ${q} ${r.product.unit}${packs}`;
        }),
    ].join('\n');

  if (rows.length === 0) return <Card><Empty title="No upcoming supplier orders">No products need a velocity-based top-up in the next order cycle.</Empty></Card>;

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
              Based on the last 30 days of sales, the supplier's next order day, delivery time and 7 days of cover, rounded up to full cartons. Change any quantity before sending.
            </p>
          </div>
        </Card>
      )}
      {groups.map((g) => (
        <Card
          key={g.groupKey}
          title={
            <span className="flex flex-wrap items-baseline gap-x-2">
              {g.supplier?.name ?? 'No supplier set'}
              <span className="text-sm font-normal text-slate-500">· Order {g.orderOn ?? 'today'} · Delivery {g.deliveryOn ?? 'to be confirmed'} · {g.items.length} products{showCost && ` · ${rs(groupTotal(g.items))}`}</span>
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
                <th className={th}>Order by</th>
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
                    <td className={td}>{r.reorderBy ?? 'Today'}</td>
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
