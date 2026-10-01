import { useLiveQuery } from 'dexie-react-hooks';
import { Boxes, Package, Pencil, Plus, Search, Star, Tags, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Badge, Button, Card, Empty, Field, Input, Modal, MoneyInput, PageHeader, Select, cx, td, th, useAction } from '../components/ui';
import { db, nowIso, uid, UNITS, type Product, type StockMove } from '../lib/db';
import { qty, rs } from '../lib/format';
import { adjustStock } from '../lib/ops';
import { useSession } from '../lib/session';

export function ProductsPage() {
  const { can } = useSession();
  const products = useLiveQuery(() => db.products.toArray(), []) ?? [];
  const categories = useLiveQuery(() => db.categories.orderBy('name').toArray(), []) ?? [];
  const suppliers = useLiveQuery(() => db.suppliers.orderBy('name').toArray(), []) ?? [];
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<Product | 'new' | null>(null);
  const [adjusting, setAdjusting] = useState<Product | null>(null);
  const [managingCats, setManagingCats] = useState(false);
  const showCost = can('cost');

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return products
      .filter((p) => (showInactive ? true : p.active))
      .filter((p) => !cat || p.categoryId === cat)
      .filter((p) => !s || p.name.toLowerCase().includes(s) || p.sku.toLowerCase().includes(s) || p.barcode?.includes(s) || p.nameUr?.includes(q.trim()))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [products, q, cat, showInactive]);

  const catName = (id?: string) => categories.find((c) => c.id === id)?.name ?? '—';

  return (
    <div>
      <PageHeader
        title="Products"
        subtitle={`${products.filter((p) => p.active).length} active products`}
        actions={
          <>
            <Button variant="secondary" onClick={() => setManagingCats(true)}>
              <Tags size={16} /> Categories
            </Button>
            <Button onClick={() => setEditing('new')}>
              <Plus size={16} /> Add product
            </Button>
          </>
        }
      />
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3">
          <div className="relative min-w-[220px] flex-1">
            <Search size={16} className="absolute top-1/2 left-3 -translate-y-1/2 text-slate-400" />
            <Input className="pl-9" placeholder="Search name, SKU, barcode…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <Select className="w-48" value={cat} onChange={(e) => setCat(e.target.value)}>
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Show inactive
          </label>
        </div>
        {list.length === 0 ? (
          <Empty icon={<Package size={40} />} title="No products yet">
            Click "Add product" to create your first product.
          </Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50">
                <tr>
                  <th className={th}>Product</th>
                  <th className={th}>Category</th>
                  <th className={cx(th, 'text-right')}>Sale price</th>
                  {showCost && <th className={cx(th, 'text-right')}>Avg cost</th>}
                  {showCost && <th className={cx(th, 'text-right')}>Margin</th>}
                  <th className={cx(th, 'text-right')}>Stock</th>
                  <th className={th} />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {list.map((p) => {
                  const margin = p.salePrice > 0 && p.cost > 0 ? ((p.salePrice - p.cost) / p.salePrice) * 100 : null;
                  return (
                    <tr key={p.id} className={cx('hover:bg-slate-50', !p.active && 'opacity-50')}>
                      <td className={td}>
                        <div className="flex items-center gap-1.5 font-medium">
                          {p.favorite && <Star size={13} className="fill-amber-400 text-amber-400" />}
                          {p.name}
                        </div>
                        <div className="text-xs text-slate-500">
                          {p.sku}
                          {p.barcode && ` · ${p.barcode}`}
                          {p.nameUr && <span className="urdu mr-2"> {p.nameUr}</span>}
                        </div>
                      </td>
                      <td className={cx(td, 'text-slate-600')}>{catName(p.categoryId)}</td>
                      <td className={cx(td, 'text-right tabular-nums')}>
                        {rs(p.salePrice)}
                        <span className="text-xs text-slate-400"> /{p.unit}</span>
                      </td>
                      {showCost && <td className={cx(td, 'text-right tabular-nums text-slate-600')}>{rs(p.cost)}</td>}
                      {showCost && (
                        <td className={cx(td, 'text-right tabular-nums', margin !== null && margin < 5 ? 'text-rose-600' : 'text-slate-600')}>
                          {margin === null ? '—' : `${margin.toFixed(1)}%`}
                        </td>
                      )}
                      <td className={cx(td, 'text-right tabular-nums')}>
                        <span className={cx(p.stock <= 0 ? 'text-rose-600 font-semibold' : p.stock <= p.minStock ? 'text-amber-600 font-semibold' : '')}>
                          {qty(p.stock)}
                        </span>{' '}
                        <span className="text-xs text-slate-400">{p.unit}</span>
                      </td>
                      <td className={cx(td, 'whitespace-nowrap text-right')}>
                        <Button size="sm" variant="ghost" onClick={() => setAdjusting(p)} title="Adjust stock">
                          <Boxes size={15} />
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditing(p)} title="Edit">
                          <Pencil size={15} />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {editing && (
        <ProductForm
          product={editing === 'new' ? null : editing}
          categories={categories}
          suppliers={suppliers}
          showCost={showCost}
          onClose={() => setEditing(null)}
        />
      )}
      {adjusting && <StockAdjustModal product={adjusting} onClose={() => setAdjusting(null)} />}
      {managingCats && <CategoriesModal onClose={() => setManagingCats(false)} />}
    </div>
  );
}

function ProductForm({
  product,
  categories,
  suppliers,
  showCost,
  onClose,
}: {
  product: Product | null;
  categories: { id: string; name: string }[];
  suppliers: { id: string; name: string }[];
  showCost: boolean;
  onClose: () => void;
}) {
  const run = useAction();
  const [f, setF] = useState(() => ({
    name: product?.name ?? '',
    nameUr: product?.nameUr ?? '',
    sku: product?.sku ?? '',
    barcode: product?.barcode ?? '',
    categoryId: product?.categoryId ?? '',
    supplierId: product?.supplierId ?? '',
    unit: product?.unit ?? 'Piece',
    packName: product?.packName ?? 'Carton',
    packSize: product?.packSize ? String(product.packSize) : '',
    salePrice: product?.salePrice ?? 0,
    cost: product?.cost ?? 0,
    minStock: product ? String(product.minStock) : '0',
    openingStock: '',
    favorite: product?.favorite ?? false,
    active: product?.active ?? true,
  }));
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  const save = () =>
    run(async () => {
      if (!f.name.trim()) throw new Error('Enter product name');
      if (f.salePrice <= 0) throw new Error('Enter sale price');
      const sku = f.sku.trim() || `P${Date.now().toString().slice(-6)}`;
      const dupe = await db.products.where('sku').equals(sku).first();
      if (dupe && dupe.id !== product?.id) throw new Error(`SKU ${sku} is already used by ${dupe.name}`);
      if (f.barcode.trim()) {
        const b = await db.products.where('barcode').equals(f.barcode.trim()).first();
        if (b && b.id !== product?.id) throw new Error(`Barcode already used by ${b.name}`);
      }
      const data = {
        name: f.name.trim(),
        nameUr: f.nameUr.trim() || undefined,
        sku,
        barcode: f.barcode.trim() || undefined,
        categoryId: f.categoryId || undefined,
        supplierId: f.supplierId || undefined,
        unit: f.unit,
        packName: f.packSize ? f.packName : undefined,
        packSize: f.packSize ? Number(f.packSize) : undefined,
        salePrice: f.salePrice,
        minStock: Number(f.minStock) || 0,
        favorite: f.favorite,
        active: f.active,
      };
      if (product) {
        await db.products.update(product.id, { ...data, ...(showCost ? { cost: f.cost } : {}) });
      } else {
        const id = uid();
        await db.products.add({ ...data, id, cost: f.cost, stock: 0, createdAt: nowIso() });
        const opening = Number(f.openingStock);
        if (opening > 0) await adjustStock({ productId: id, qty: opening, type: 'opening', cost: f.cost, note: 'Opening stock' });
      }
      onClose();
    }, product ? 'Product updated' : 'Product added');

  return (
    <Modal
      wide
      title={product ? `Edit ${product.name}` : 'Add product'}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save}>Save</Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Product name *">
          <Input value={f.name} onChange={(e) => set('name', e.target.value)} autoFocus />
        </Field>
        <Field label="Urdu name">
          <Input className="urdu" value={f.nameUr} onChange={(e) => set('nameUr', e.target.value)} />
        </Field>
        <Field label="SKU / code" hint="Leave empty to generate">
          <Input value={f.sku} onChange={(e) => set('sku', e.target.value)} />
        </Field>
        <Field label="Barcode" hint="Scan with a barcode scanner or type">
          <Input value={f.barcode} onChange={(e) => set('barcode', e.target.value)} />
        </Field>
        <Field label="Category">
          <Select value={f.categoryId} onChange={(e) => set('categoryId', e.target.value)}>
            <option value="">—</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Main supplier">
          <Select value={f.supplierId} onChange={(e) => set('supplierId', e.target.value)}>
            <option value="">—</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Sale unit" hint="Stock is counted in this unit">
          <Select value={f.unit} onChange={(e) => set('unit', e.target.value)}>
            {UNITS.map((u) => (
              <option key={u}>{u}</option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Buying pack">
            <Select value={f.packName} onChange={(e) => set('packName', e.target.value)}>
              {['Carton', 'Box', 'Case', 'Crate', 'Sack', 'Dozen', 'Tray', 'Bundle'].map((u) => (
                <option key={u}>{u}</option>
              ))}
            </Select>
          </Field>
          <Field label={`${f.unit}s per pack`}>
            <Input inputMode="decimal" value={f.packSize} onChange={(e) => set('packSize', e.target.value)} placeholder="e.g. 24" />
          </Field>
        </div>
        <Field label={`Sale price per ${f.unit} (Rs) *`}>
          <MoneyInput value={f.salePrice} onChange={(v) => set('salePrice', v)} />
        </Field>
        {(showCost || !product) && (
          <Field label={`Purchase cost per ${f.unit} (Rs)`} hint={product ? 'Updated automatically by purchases' : undefined}>
            <MoneyInput value={f.cost} onChange={(v) => set('cost', v)} />
          </Field>
        )}
        <Field label="Minimum stock" hint="Alert when stock falls to this level">
          <Input inputMode="decimal" value={f.minStock} onChange={(e) => set('minStock', e.target.value)} />
        </Field>
        {!product && (
          <Field label="Opening stock" hint={`How many ${f.unit}s you have now`}>
            <Input inputMode="decimal" value={f.openingStock} onChange={(e) => set('openingStock', e.target.value)} />
          </Field>
        )}
        <div className="flex items-center gap-6 sm:col-span-2">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={f.favorite} onChange={(e) => set('favorite', e.target.checked)} /> Show in POS favourites
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={f.active} onChange={(e) => set('active', e.target.checked)} /> Active
          </label>
        </div>
      </div>
    </Modal>
  );
}

function StockAdjustModal({ product, onClose }: { product: Product; onClose: () => void }) {
  const run = useAction();
  const [mode, setMode] = useState<'add' | 'remove' | 'set'>('add');
  const [type, setType] = useState<'adjust' | 'damage' | 'expiry'>('adjust');
  const [amount, setAmount] = useState('');
  const [cost, setCost] = useState(product.cost);
  const [note, setNote] = useState('');
  const moves = useLiveQuery(() => db.stockMoves.where('productId').equals(product.id).reverse().sortBy('date'), [product.id]) ?? [];
  const n = Number(amount) || 0;
  const delta = mode === 'add' ? n : mode === 'remove' ? -n : n - product.stock;

  return (
    <Modal
      wide
      title={`Stock — ${product.name}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button
            disabled={delta === 0 || !amount}
            onClick={() =>
              run(async () => {
                await adjustStock({
                  productId: product.id,
                  qty: delta,
                  type: delta < 0 ? type : 'adjust',
                  ...(delta > 0 ? { cost } : {}),
                  note: note || (mode === 'set' ? 'Stock count correction' : undefined),
                });
                onClose();
              }, 'Stock updated')
            }
          >
            Save adjustment
          </Button>
        </>
      }
    >
      <p className="mb-3 text-sm text-slate-600">
        Current stock: <b>{qty(product.stock)} {product.unit}</b>. Every change is recorded with a reason.
      </p>
      <div className="mb-3 flex gap-2">
        {(['add', 'remove', 'set'] as const).map((m) => (
          <Button key={m} size="sm" variant={mode === m ? 'primary' : 'secondary'} onClick={() => setMode(m)}>
            {m === 'add' ? 'Add stock' : m === 'remove' ? 'Remove stock' : 'Set counted stock'}
          </Button>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={mode === 'set' ? `Counted ${product.unit}s` : `Quantity (${product.unit})`}>
          <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
        </Field>
        {delta < 0 && (
          <Field label="Reason">
            <Select value={type} onChange={(e) => setType(e.target.value as typeof type)}>
              <option value="adjust">Correction / missing</option>
              <option value="damage">Damaged</option>
              <option value="expiry">Expired</option>
            </Select>
          </Field>
        )}
        {delta > 0 && (
          <Field label="Cost per unit (Rs)">
            <MoneyInput value={cost} onChange={setCost} />
          </Field>
        )}
        <Field label="Note">
          <Input value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
      {delta !== 0 && amount && (
        <p className="mt-2 text-sm">
          Change: <b className={delta > 0 ? 'text-emerald-600' : 'text-rose-600'}>{delta > 0 ? '+' : ''}{qty(delta)}</b> → new stock{' '}
          <b>{qty(product.stock + delta)}</b>
        </p>
      )}
      <h4 className="mt-5 mb-2 text-sm font-semibold">Stock history</h4>
      <MovesTable moves={moves.slice(0, 30)} unit={product.unit} />
    </Modal>
  );
}

const MOVE_LABEL: Record<StockMove['type'], string> = {
  opening: 'Opening',
  sale: 'Sale',
  return: 'Return',
  purchase: 'Purchase',
  purchase_return: 'Purchase return',
  adjust: 'Adjustment',
  damage: 'Damaged',
  expiry: 'Expired',
};

export function MovesTable({ moves, unit }: { moves: StockMove[]; unit: string }) {
  if (moves.length === 0) return <p className="text-sm text-slate-500">No stock movements yet.</p>;
  return (
    <table className="w-full text-sm">
      <thead className="bg-slate-50">
        <tr>
          <th className={th}>Date</th>
          <th className={th}>Type</th>
          <th className={cx(th, 'text-right')}>Qty</th>
          <th className={th}>Note</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {moves.map((m) => (
          <tr key={m.id}>
            <td className={td}>{new Date(m.date).toLocaleString('en-PK', { dateStyle: 'short', timeStyle: 'short' })}</td>
            <td className={td}>
              <Badge tone={m.qty > 0 ? 'green' : m.type === 'sale' ? 'blue' : 'red'}>{MOVE_LABEL[m.type]}</Badge>
            </td>
            <td className={cx(td, 'text-right tabular-nums', m.qty > 0 ? 'text-emerald-600' : 'text-rose-600')}>
              {m.qty > 0 ? '+' : ''}
              {qty(m.qty)} {unit}
            </td>
            <td className={cx(td, 'text-slate-500')}>{m.note}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function CategoriesModal({ onClose }: { onClose: () => void }) {
  const categories = useLiveQuery(() => db.categories.orderBy('name').toArray(), []) ?? [];
  const [name, setName] = useState('');
  const run = useAction();
  return (
    <Modal title="Categories" onClose={onClose}>
      <div className="mb-3 flex gap-2">
        <Input placeholder="New category" value={name} onChange={(e) => setName(e.target.value)} />
        <Button
          disabled={!name.trim()}
          onClick={async () => {
            await db.categories.add({ id: uid(), name: name.trim() });
            setName('');
          }}
        >
          Add
        </Button>
      </div>
      <ul className="divide-y divide-slate-100">
        {categories.map((c) => (
          <li key={c.id} className="flex items-center justify-between py-2 text-sm">
            <input
              className="flex-1 rounded px-1 py-0.5 hover:bg-slate-50"
              defaultValue={c.name}
              onBlur={(e) => e.target.value.trim() && db.categories.update(c.id, { name: e.target.value.trim() })}
            />
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                run(async () => {
                  const used = await db.products.where('categoryId').equals(c.id).count();
                  if (used) throw new Error(`${used} products use this category`);
                  await db.categories.delete(c.id);
                })
              }
            >
              <Trash2 size={14} />
            </Button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
