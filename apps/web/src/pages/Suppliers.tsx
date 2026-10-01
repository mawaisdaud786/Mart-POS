import { useLiveQuery } from 'dexie-react-hooks';
import { HandCoins, PackagePlus, Pencil, Plus, Trash2, Truck } from 'lucide-react';
import { useMemo, useState } from 'react';
import { LedgerTable } from '../components/Ledger';
import { Button, Card, Empty, Field, Input, Modal, MoneyInput, PageHeader, Select, Stat, cx, td, th, useAction } from '../components/ui';
import { ACCOUNT_IDS, db, nowIso, uid, type Product, type Supplier } from '../lib/db';
import { fmtDateTime, lineTotal, rs } from '../lib/format';
import { addPartyAdjustment, paySupplier, recordPurchase } from '../lib/ops';
import { partyBalances } from '../lib/reports';

export function SuppliersPage() {
  const suppliers = useLiveQuery(() => db.suppliers.orderBy('name').toArray(), []) ?? [];
  const balances = useLiveQuery(() => partyBalances('supplier'), []) ?? new Map<string, number>();
  const purchases = useLiveQuery(() => db.purchases.orderBy('date').reverse().limit(50).toArray(), []) ?? [];
  const [tab, setTab] = useState<'suppliers' | 'purchases'>('suppliers');
  const [editing, setEditing] = useState<Supplier | 'new' | null>(null);
  const [open, setOpen] = useState<Supplier | null>(null);
  const [buying, setBuying] = useState<string | null>(null);
  const totalDue = [...balances.values()].filter((v) => v > 0).reduce((s, v) => s + v, 0);
  const name = (id: string) => suppliers.find((s) => s.id === id)?.name ?? '—';

  return (
    <div>
      <PageHeader
        title="Suppliers & Purchases"
        subtitle="Stock you buy and money you owe"
        actions={
          <>
            <Button variant="secondary" onClick={() => setEditing('new')}>
              <Plus size={16} /> Add supplier
            </Button>
            <Button onClick={() => setBuying('')} disabled={suppliers.length === 0}>
              <PackagePlus size={16} /> Receive stock (purchase)
            </Button>
          </>
        }
      />
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Stat label="You owe suppliers" value={rs(totalDue)} tone="red" />
        <Stat label="Suppliers" value={suppliers.length} />
        <Stat label="Purchases this month" value={rs(purchases.filter((p) => p.date.slice(0, 7) === nowIso().slice(0, 7)).reduce((s, p) => s + p.total, 0))} />
      </div>
      <div className="mb-3 flex gap-2">
        <Button variant={tab === 'suppliers' ? 'primary' : 'secondary'} onClick={() => setTab('suppliers')}>
          Suppliers
        </Button>
        <Button variant={tab === 'purchases' ? 'primary' : 'secondary'} onClick={() => setTab('purchases')}>
          Recent purchases
        </Button>
      </div>
      <Card>
        {tab === 'suppliers' ? (
          suppliers.length === 0 ? (
            <Empty icon={<Truck size={40} />} title="No suppliers yet" />
          ) : (
            <table className="w-full">
              <thead className="bg-slate-50">
                <tr>
                  <th className={th}>Supplier</th>
                  <th className={th}>Phone</th>
                  <th className={cx(th, 'text-right')}>Delivery days</th>
                  <th className={cx(th, 'text-right')}>You owe</th>
                  <th className={th} />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {suppliers.map((s) => {
                  const bal = balances.get(s.id) ?? 0;
                  return (
                    <tr key={s.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setOpen(s)}>
                      <td className={td}>
                        <div className="font-medium">{s.name}</div>
                        <div className="text-xs text-slate-500">{s.company}</div>
                      </td>
                      <td className={cx(td, 'text-slate-600')}>{s.phone}</td>
                      <td className={cx(td, 'text-right')}>{s.leadDays ?? '—'}</td>
                      <td className={cx(td, 'text-right font-semibold tabular-nums', bal > 0 && 'text-rose-600')}>{rs(bal)}</td>
                      <td className={cx(td, 'whitespace-nowrap text-right')} onClick={(e) => e.stopPropagation()}>
                        <Button size="sm" variant="ghost" onClick={() => setBuying(s.id)} title="Receive stock">
                          <PackagePlus size={15} />
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditing(s)} title="Edit">
                          <Pencil size={15} />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )
        ) : purchases.length === 0 ? (
          <Empty title="No purchases yet" />
        ) : (
          <table className="w-full">
            <thead className="bg-slate-50">
              <tr>
                <th className={th}>No.</th>
                <th className={th}>Date</th>
                <th className={th}>Supplier</th>
                <th className={th}>Items</th>
                <th className={cx(th, 'text-right')}>Total</th>
                <th className={cx(th, 'text-right')}>Paid</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {purchases.map((p) => (
                <tr key={p.id}>
                  <td className={cx(td, 'font-medium')}>
                    {p.no}
                    {p.invoiceNo && <div className="text-xs text-slate-500">Bill {p.invoiceNo}</div>}
                  </td>
                  <td className={cx(td, 'text-slate-600')}>{fmtDateTime(p.date)}</td>
                  <td className={td}>{name(p.supplierId)}</td>
                  <td className={cx(td, 'text-slate-600')}>{p.items.map((i) => `${i.name} ×${i.qty}`).join(', ')}</td>
                  <td className={cx(td, 'text-right tabular-nums')}>{rs(p.total)}</td>
                  <td className={cx(td, 'text-right tabular-nums')}>{rs(p.paid)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      {editing && <SupplierForm supplier={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {open && <SupplierKhata supplier={open} balance={balances.get(open.id) ?? 0} onClose={() => setOpen(null)} />}
      {buying !== null && <PurchaseModal supplierId={buying} suppliers={suppliers} onClose={() => setBuying(null)} />}
    </div>
  );
}

function SupplierForm({ supplier, onClose }: { supplier: Supplier | null; onClose: () => void }) {
  const run = useAction();
  const [f, setF] = useState({ name: supplier?.name ?? '', company: supplier?.company ?? '', phone: supplier?.phone ?? '', leadDays: String(supplier?.leadDays ?? 2) });
  const [opening, setOpening] = useState(0);
  return (
    <Modal
      title={supplier ? 'Edit supplier' : 'Add supplier'}
      onClose={onClose}
      footer={
        <Button
          disabled={!f.name.trim()}
          onClick={() =>
            run(async () => {
              const data = { name: f.name.trim(), company: f.company, phone: f.phone, leadDays: Number(f.leadDays) || undefined };
              if (supplier) await db.suppliers.update(supplier.id, data);
              else {
                const id = uid();
                await db.suppliers.add({ ...data, id, createdAt: nowIso() });
                if (opening) await addPartyAdjustment('supplier', id, opening, 'Opening balance', 'opening');
              }
              onClose();
            }, 'Saved')
          }
        >
          Save
        </Button>
      }
    >
      <div className="grid gap-3">
        <Field label="Name (salesman / distributor)">
          <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus />
        </Field>
        <Field label="Company">
          <Input value={f.company} onChange={(e) => setF({ ...f, company: e.target.value })} />
        </Field>
        <Field label="Phone (for WhatsApp orders)">
          <Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
        </Field>
        <Field label="Days to deliver after order" hint="Used to calculate when to reorder">
          <Input inputMode="numeric" value={f.leadDays} onChange={(e) => setF({ ...f, leadDays: e.target.value })} />
        </Field>
        {!supplier && (
          <Field label="Amount you already owe (Rs)">
            <MoneyInput value={opening} onChange={setOpening} />
          </Field>
        )}
      </div>
    </Modal>
  );
}

function SupplierKhata({ supplier, balance, onClose }: { supplier: Supplier; balance: number; onClose: () => void }) {
  const run = useAction();
  const accounts = useLiveQuery(() => db.accounts.filter((a) => a.active).toArray(), []) ?? [];
  const [amount, setAmount] = useState(0);
  const [accountId, setAccountId] = useState<string>(ACCOUNT_IDS.cash);
  return (
    <Modal wide title={`Supplier account — ${supplier.name}`} onClose={onClose}>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3 rounded-lg bg-slate-50 p-3">
        <div>
          <div className="text-sm text-slate-500">You owe</div>
          <div className={cx('text-2xl font-bold', balance > 0 ? 'text-rose-600' : 'text-emerald-600')}>{rs(balance)}</div>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Pay (Rs)">
            <MoneyInput className="w-36" value={amount} onChange={setAmount} />
          </Field>
          <Field label="From">
            <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </Field>
          <Button
            disabled={amount <= 0}
            onClick={() =>
              run(async () => {
                await paySupplier(supplier.id, amount, accountId);
                setAmount(0);
              }, 'Payment recorded')
            }
          >
            <HandCoins size={16} /> Pay
          </Button>
        </div>
      </div>
      <LedgerTable partyType="supplier" partyId={supplier.id} />
    </Modal>
  );
}

interface Line {
  key: string;
  productId: string;
  /** Quantity in packs or units, depending on `byPack`. */
  qty: string;
  byPack: boolean;
  /** Cost per entered unit (pack or unit), paisa. */
  cost: number;
}

/** Receive stock from a supplier: quantities by unit or carton, cost, and how much was paid now. */
function PurchaseModal({ supplierId, suppliers, onClose }: { supplierId: string; suppliers: Supplier[]; onClose: () => void }) {
  const run = useAction();
  const products = useLiveQuery(() => db.products.filter((p) => p.active).sortBy('name'), []) ?? [];
  const accounts = useLiveQuery(() => db.accounts.filter((a) => a.active).toArray(), []) ?? [];
  const [sid, setSid] = useState(supplierId || suppliers[0]?.id || '');
  const [invoiceNo, setInvoiceNo] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [paid, setPaid] = useState(0);
  const [accountId, setAccountId] = useState<string>(ACCOUNT_IDS.cash);
  const [pick, setPick] = useState('');

  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const supplierProducts = products.filter((p) => p.supplierId === sid);

  const addLine = (p: Product) => {
    if (lines.some((l) => l.productId === p.id)) return;
    const byPack = !!p.packSize && p.packSize > 1;
    setLines((ls) => [...ls, { key: uid(), productId: p.id, qty: '', byPack, cost: byPack ? Math.round(p.cost * p.packSize!) : p.cost }]);
  };

  const units = (l: Line) => {
    const p = byId.get(l.productId);
    const n = Number(l.qty) || 0;
    return l.byPack && p?.packSize ? n * p.packSize : n;
  };
  const unitCost = (l: Line) => {
    const p = byId.get(l.productId);
    return l.byPack && p?.packSize ? Math.round(l.cost / p.packSize) : l.cost;
  };
  const total = lines.reduce((s, l) => s + lineTotal(l.cost, Number(l.qty) || 0), 0);

  return (
    <Modal
      wide
      title="Receive stock (purchase)"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!sid || lines.length === 0}
            onClick={() =>
              run(async () => {
                await recordPurchase({
                  supplierId: sid,
                  invoiceNo,
                  items: lines.map((l) => ({ productId: l.productId, qty: units(l), cost: unitCost(l), total: lineTotal(l.cost, Number(l.qty) || 0) })),
                  paid,
                  accountId: paid > 0 ? accountId : undefined,
                });
                onClose();
              }, 'Stock received and supplier account updated')
            }
          >
            Save purchase — {rs(total)}
          </Button>
        </>
      }
    >
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Field label="Supplier">
          <Select value={sid} onChange={(e) => setSid(e.target.value)}>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Supplier bill no.">
          <Input value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} />
        </Field>
        <Field label="Add product">
          <Select
            value={pick}
            onChange={(e) => {
              const p = byId.get(e.target.value);
              if (p) addLine(p);
              setPick('');
            }}
          >
            <option value="">Choose…</option>
            {supplierProducts.length > 0 && (
              <optgroup label="This supplier's products">
                {supplierProducts.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </optgroup>
            )}
            <optgroup label="All products">
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </optgroup>
          </Select>
        </Field>
      </div>
      {lines.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">Add the products on the supplier's bill.</p>
      ) : (
        <table className="w-full">
          <thead className="bg-slate-50">
            <tr>
              <th className={th}>Product</th>
              <th className={th}>Buy in</th>
              <th className={cx(th, 'text-right')}>Qty</th>
              <th className={cx(th, 'text-right')}>Cost each (Rs)</th>
              <th className={cx(th, 'text-right')}>Line total</th>
              <th className={th} />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {lines.map((l) => {
              const p = byId.get(l.productId)!;
              const update = (patch: Partial<Line>) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, ...patch } : x)));
              return (
                <tr key={l.key}>
                  <td className={td}>
                    {p.name}
                    <div className="text-xs text-slate-500">
                      = {units(l)} {p.unit} @ {rs(unitCost(l))}/{p.unit}
                    </div>
                  </td>
                  <td className={td}>
                    {p.packSize && p.packSize > 1 ? (
                      <select
                        className="rounded border border-slate-300 px-1 py-1 text-sm"
                        value={l.byPack ? 'pack' : 'unit'}
                        onChange={(e) => {
                          const byPack = e.target.value === 'pack';
                          update({ byPack, cost: byPack ? Math.round(l.cost * p.packSize!) : Math.round(l.cost / p.packSize!) });
                        }}
                      >
                        <option value="pack">
                          {p.packName} ({p.packSize})
                        </option>
                        <option value="unit">{p.unit}</option>
                      </select>
                    ) : (
                      p.unit
                    )}
                  </td>
                  <td className={cx(td, 'text-right')}>
                    <input className="w-20 rounded border border-slate-300 px-2 py-1 text-right text-sm" inputMode="decimal" value={l.qty} onChange={(e) => update({ qty: e.target.value })} />
                  </td>
                  <td className={cx(td, 'text-right')}>
                    <MoneyInput className="w-28 py-1 text-right" value={l.cost} onChange={(v) => update({ cost: v })} />
                  </td>
                  <td className={cx(td, 'text-right tabular-nums')}>{rs(lineTotal(l.cost, Number(l.qty) || 0))}</td>
                  <td className={td}>
                    <button className="rounded p-1 text-slate-400 hover:text-rose-600" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <div className="mt-4 grid gap-3 rounded-lg bg-slate-50 p-3 sm:grid-cols-3">
        <div>
          <div className="text-sm text-slate-500">Bill total</div>
          <div className="text-xl font-bold">{rs(total)}</div>
        </div>
        <Field label="Paid now (Rs)" hint={paid < total ? `${rs(total - paid)} will be added to supplier balance` : undefined}>
          <div className="flex gap-2">
            <MoneyInput value={paid} onChange={setPaid} />
            <Button size="sm" variant="secondary" onClick={() => setPaid(total)}>
              Full
            </Button>
          </div>
        </Field>
        <Field label="Paid from">
          <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </Modal>
  );
}
