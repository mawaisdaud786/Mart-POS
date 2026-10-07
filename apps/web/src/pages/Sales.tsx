import { useLiveQuery } from '../lib/store';
import { Ban, Eye, ReceiptText, Undo2 } from 'lucide-react';
import { useState } from 'react';
import { ListControls, compareListValues } from '../components/ListControls';
import { ReceiptModal } from '../components/Receipt';
import { Badge, Button, Card, Empty, Field, Input, Modal, PageHeader, Select, Stat, cx, td, th, useAction } from '../components/ui';
import { ACCOUNT_IDS, db, type Sale } from '../lib/db';
import { salesInRange, salesSummary } from '../lib/reports';
import { dayKey, fmtDateTime, qty, roundQty, rs } from '../lib/format';
import { returnSaleItems, returnValue, voidSale } from '../lib/ops';
import { useSession, useUser } from '../lib/session';

const PAGE = 100;

export function SalesPage() {
  const { can, has } = useSession();
  const user = useUser();
  const [from, setFrom] = useState(dayKey());
  const [to, setTo] = useState(dayKey());
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortBy, setSortBy] = useState<'date' | 'total' | 'invoice' | 'customer'>('date');
  const [view, setView] = useState<Sale | null>(null);
  const [returning, setReturning] = useState<Sale | null>(null);
  const run = useAction();
  const sellerId = has('sales.view_all') ? undefined : user.id;

  const [pageSize, setPageSize] = useState(PAGE);
  const query = q.trim().toLowerCase();
  const searching = query !== '' || statusFilter !== 'all' || sortBy !== 'date';

  // The stat cards are added up by the server over the whole range. The list shows the newest bills a page at a time;
  // only while searching is the whole range loaded (so no match can be missed).
  const data = useLiveQuery(async () => {
    const [list, totals, customers] = await Promise.all([
      salesInRange(from, to, searching ? undefined : pageSize, sellerId),
      salesSummary(from, to, sellerId),
      db.customers.toArray(),
    ]);
    return { sales: list, totals, customers: new Map(customers.map((c) => [c.id, c.name])), more: !searching && list.length >= pageSize };
  }, [from, to, sellerId, searching, pageSize]);

  const sourceSales = data?.sales ?? [];
  const sales = sourceSales
    .filter((sale) => !query || sale.no.toLowerCase().includes(query) || data?.customers.get(sale.customerId ?? '')?.toLowerCase().includes(query))
    .filter((sale) => statusFilter === 'all'
      || (statusFilter === 'returned' ? sale.returnedTotal > 0
        : statusFilter === 'credit' ? sale.credit > 0
          : sale.status === statusFilter))
    .sort((a, b) => sortBy === 'total'
      ? b.total - a.total
      : sortBy === 'invoice'
        ? compareListValues(a.no, b.no)
        : sortBy === 'customer'
          ? compareListValues(data?.customers.get(a.customerId ?? '') ?? 'Walk-in', data?.customers.get(b.customerId ?? '') ?? 'Walk-in')
          : b.date.localeCompare(a.date));
  // With a search the cards describe the matching bills (as before); otherwise the server's totals for the range.
  const completed = sales.filter((s) => s.status === 'completed');
  const billCount = searching ? completed.length : (data?.totals.bills ?? 0);
  const total = searching ? completed.reduce((s, x) => s + x.total, 0) : (data?.totals.total ?? 0);
  const returnsTotal = searching ? sales.reduce((sum, sale) => sum + sale.returnedTotal, 0) : (data?.totals.returns ?? 0);

  return (
    <div>
      <PageHeader title="Sales & Returns" subtitle="Find a bill, reprint it, return items or cancel it" />
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Stat label="Bills" value={billCount} />
        <Stat label="Sales" value={rs(total)} tone="green" />
        <Stat label="Returns" value={rs(returnsTotal)} tone="red" />
      </div>
      <Card>
        <div className="flex flex-wrap items-end gap-2 border-b border-slate-100 p-3">
          <Field label="From">
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="To">
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
        </div>
        <ListControls
          search={q}
          onSearch={setQ}
          placeholder="Search invoice or customer…"
          filters={[{ label: 'Sale status', value: statusFilter, options: [{ value: 'all', label: 'All statuses' }, { value: 'completed', label: 'Completed' }, { value: 'void', label: 'Cancelled' }, { value: 'returned', label: 'Has returns' }, { value: 'credit', label: 'Has udhaar' }], onChange: setStatusFilter }]}
          sortValue={sortBy}
          sortOptions={[{ value: 'date', label: 'Time · newest' }, { value: 'total', label: 'Total · highest' }, { value: 'invoice', label: 'Invoice · A–Z' }, { value: 'customer', label: 'Customer · A–Z' }]}
          onSort={(value) => setSortBy(value as typeof sortBy)}
        />
        {sales.length === 0 ? (
          <Empty icon={<ReceiptText size={40} />} title="No sales in this period" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50">
                <tr>
                  <th className={th}>Invoice</th>
                  <th className={th}>Time</th>
                  <th className={th}>Customer</th>
                  <th className={cx(th, 'text-right')}>Items</th>
                  <th className={cx(th, 'text-right')}>Total</th>
                  <th className={th}>Status</th>
                  <th className={th} />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sales.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-50">
                    <td className={cx(td, 'font-medium')}>{s.no}</td>
                    <td className={cx(td, 'text-slate-600')}>{fmtDateTime(s.date)}</td>
                    <td className={td}>{s.customerId ? data?.customers.get(s.customerId) : <span className="text-slate-400">Walk-in</span>}</td>
                    <td className={cx(td, 'text-right')}>{s.items.length}</td>
                    <td className={cx(td, 'text-right font-medium tabular-nums')}>{rs(s.total)}</td>
                    <td className={td}>
                      {s.status === 'void' ? (
                        <Badge tone="red">Cancelled</Badge>
                      ) : s.returnedTotal > 0 ? (
                        <Badge tone="amber">Returned {rs(s.returnedTotal)}</Badge>
                      ) : s.credit > 0 ? (
                        <Badge tone="blue">Udhaar {rs(s.credit)}</Badge>
                      ) : (
                        <Badge tone="green">Paid</Badge>
                      )}
                    </td>
                    <td className={cx(td, 'whitespace-nowrap text-right')}>
                      <Button size="sm" variant="ghost" onClick={() => setView(s)} title="View / print">
                        <Eye size={15} />
                      </Button>
                      {s.status === 'completed' && has('sales.return') && (
                        <Button size="sm" variant="ghost" onClick={() => setReturning(s)} title="Return items">
                          <Undo2 size={15} />
                        </Button>
                      )}
                      {s.status === 'completed' && s.returnedTotal === 0 && can('void') && (
                        <Button
                          size="sm"
                          variant="ghost"
                          title="Cancel sale"
                          onClick={() => {
                            const reason = prompt(`Cancel ${s.no}? Stock and money will be reversed. Reason:`);
                            if (reason) run(() => voidSale(s.id, reason), 'Sale cancelled');
                          }}
                        >
                          <Ban size={15} className="text-rose-600" />
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data?.more && !searching && (
              <div className="border-t border-slate-100 p-3 text-center">
                <Button variant="secondary" onClick={() => setPageSize((n) => n + PAGE)}>
                  Show older bills
                </Button>
              </div>
            )}
          </div>
        )}
      </Card>
      {view && <ReceiptModal sale={view} onClose={() => setView(null)} />}
      {returning && <ReturnModal sale={returning} onClose={() => setReturning(null)} />}
    </div>
  );
}

function ReturnModal({ sale, onClose }: { sale: Sale; onClose: () => void }) {
  const user = useUser();
  const run = useAction();
  const accounts = useLiveQuery(() => db.accounts.filter((a) => a.active).toArray(), []) ?? [];
  const [qtys, setQtys] = useState<Record<string, string>>({});
  const [refundTo, setRefundTo] = useState<'account' | 'khata'>(sale.customerId && sale.credit > 0 ? 'khata' : 'account');
  const [accountId, setAccountId] = useState<string>(ACCOUNT_IDS.cash);
  const [reason, setReason] = useState('');

  const lines = sale.items.map((i) => ({ item: i, left: roundQty(i.qty - i.returnedQty), q: Number(qtys[i.productId] || 0) }));
  const amount = lines.reduce((s, l) => s + (l.q > 0 ? returnValue(sale, l.item, Math.min(l.q, l.left)) : 0), 0);

  return (
    <Modal
      wide
      title={`Return items — ${sale.no}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="danger"
            disabled={amount <= 0}
            onClick={() =>
              run(async () => {
                await returnSaleItems({
                  saleId: sale.id,
                  lines: lines.filter((l) => l.q > 0).map((l) => ({ productId: l.item.productId, qty: l.q })),
                  refundTo,
                  accountId,
                  reason,
                });
                onClose();
              }, 'Return saved, stock added back')
            }
          >
            Refund {rs(amount)}
          </Button>
        </>
      }
    >
      <table className="mb-4 w-full">
        <thead className="bg-slate-50">
          <tr>
            <th className={th}>Item</th>
            <th className={cx(th, 'text-right')}>Sold</th>
            <th className={cx(th, 'text-right')}>Can return</th>
            <th className={cx(th, 'text-right')}>Return qty</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {lines.map(({ item, left }) => (
            <tr key={item.productId}>
              <td className={td}>{item.name}</td>
              <td className={cx(td, 'text-right')}>{qty(item.qty)}</td>
              <td className={cx(td, 'text-right')}>{qty(left)}</td>
              <td className={cx(td, 'text-right')}>
                <input
                  className="w-20 rounded border border-slate-300 px-2 py-1 text-right text-sm"
                  inputMode="decimal"
                  disabled={left <= 0}
                  value={qtys[item.productId] ?? ''}
                  onChange={(e) => setQtys((x) => ({ ...x, [item.productId]: e.target.value }))}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Refund to">
          <Select value={refundTo} onChange={(e) => setRefundTo(e.target.value as 'account' | 'khata')}>
            <option value="account">Give money back</option>
            {sale.customerId && <option value="khata">Reduce customer udhaar</option>}
          </Select>
        </Field>
        {refundTo === 'account' && (
          <Field label="From">
            <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="Reason">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. expired, damaged" />
        </Field>
      </div>
    </Modal>
  );
}
