import { useLiveQuery } from 'dexie-react-hooks';
import { Minus, PauseCircle, Plus, Search, ShoppingCart, Star, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CustomerPicker } from '../components/CustomerPicker';
import { ReceiptModal } from '../components/Receipt';
import { useVoiceAssistant } from '../components/VoiceAssistant';
import { Badge, Button, Empty, Field, Input, Modal, MoneyInput, cx, useAction, useToast } from '../components/ui';
import { ACCOUNT_IDS, db, nowIso, uid, type Product, type Sale, type SaleItem } from '../lib/db';
import { lineTotal, qty as fmtQty, roundQty, rs } from '../lib/format';
import { OpError, cartSubtotal, completeSale } from '../lib/ops';
import { partyBalances } from '../lib/reports';
import { useSession, useUser } from '../lib/session';

type CartLine = Omit<SaleItem, 'cost' | 'returnedQty'>;

export function PosPage() {
  const user = useUser();
  const { settings, can } = useSession();
  const toast = useToast();
  const products = useLiveQuery(() => db.products.filter((p) => p.active).toArray(), []) ?? [];
  const categories = useLiveQuery(() => db.categories.orderBy('name').toArray(), []) ?? [];
  const held = useLiveQuery(() => db.heldCarts.toArray(), []) ?? [];

  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string>('fav');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [discount, setDiscount] = useState(0);
  const [customerId, setCustomerId] = useState<string | undefined>();
  const [paying, setPaying] = useState(false);
  const [receipt, setReceipt] = useState<Sale | null>(null);
  const [showHeld, setShowHeld] = useState(false);
  /** Udhaar opens payment with no cash, so the whole bill goes on the customer's khata. */
  const [paymentMode, setPaymentMode] = useState<'cash' | 'credit'>('cash');
  const billCustomer = useLiveQuery(() => (customerId ? db.customers.get(customerId) : undefined), [customerId]);
  const searchRef = useRef<HTMLInputElement>(null);

  const subtotal = cartSubtotal(cart);
  const total = subtotal - discount;

  const visible = useMemo(() => {
    const s = search.trim().toLowerCase();
    let list = products;
    if (s) {
      list = list.filter(
        (p) => p.name.toLowerCase().includes(s) || p.sku.toLowerCase() === s || p.barcode === s || p.nameUr?.includes(search.trim()),
      );
    } else if (category === 'fav') {
      list = list.filter((p) => p.favorite);
      if (list.length === 0) list = products;
    } else if (category !== 'all') {
      list = list.filter((p) => p.categoryId === category);
    }
    return [...list].sort((a, b) => a.name.localeCompare(b.name)).slice(0, 60);
  }, [products, search, category]);

  const addProduct = useCallback(
    (p: Product, q = 1) => {
      setCart((c) => {
        const existing = c.find((l) => l.productId === p.id);
        if (existing) return c.map((l) => (l.productId === p.id ? { ...l, qty: roundQty(l.qty + q) } : l));
        return [...c, { productId: p.id, name: p.name, unit: p.unit, qty: q, price: p.salePrice, discount: 0 }];
      });
      if (p.stock - q < 0) toast(`${p.name}: stock is ${fmtQty(p.stock)} — selling anyway`, 'error');
    },
    [toast],
  );

  /** Enter in the search box: exact barcode/SKU first (USB scanners type the code + Enter), else first match. */
  const onSearchEnter = () => {
    const s = search.trim();
    if (!s) return;
    const exact = products.find((p) => p.barcode === s || p.sku.toLowerCase() === s.toLowerCase());
    const pick = exact ?? (visible.length === 1 ? visible[0] : undefined);
    if (pick) {
      addProduct(pick);
      setSearch('');
    } else if (visible.length === 0) toast(`No product found for "${s}"`, 'error');
  };

  const setLine = (productId: string, patch: Partial<CartLine>) =>
    setCart((c) => c.map((l) => (l.productId === productId ? { ...l, ...patch } : l)));
  const removeLine = (productId: string) => setCart((c) => c.filter((l) => l.productId !== productId));

  const reset = () => {
    setCart([]);
    setDiscount(0);
    setCustomerId(undefined);
    setPaymentMode('cash');
    setSearch('');
    searchRef.current?.focus();
  };

  const holdCart = async () => {
    if (cart.length === 0) return;
    await db.heldCarts.add({ id: uid(), label: `Bill ${held.length + 1} · ${rs(total)}`, date: nowIso(), customerId, items: cart.map((l) => ({ ...l, cost: 0, returnedQty: 0 })), discount });
    toast('Bill put on hold');
    reset();
  };

  const maxDiscountOk = () => {
    if (user.role !== 'cashier' || subtotal === 0) return true;
    const lineDiscounts = cart.reduce((s, l) => s + l.discount, 0);
    return ((discount + lineDiscounts) / (subtotal + lineDiscounts)) * 100 <= (settings?.cashierMaxDiscount ?? 5) + 0.001;
  };

  const startPay = () => {
    if (cart.length === 0) return;
    if (total < 0) return toast('Discount is more than the bill', 'error');
    if (!maxDiscountOk()) return toast(`Cashier discount limit is ${settings?.cashierMaxDiscount}% — ask the manager`, 'error');
    if (paymentMode === 'credit' && !customerId) return toast('Udhaar ke liye customer select karein', 'error');
    searchRef.current?.blur();
    setPaying(true);
  };

  useEffect(() => searchRef.current?.focus(), []);

  // Voice billing fills this same bill through the same functions as tapping and typing.
  const voice = useVoiceAssistant({
    cartQty: (id) => cart.find((l) => l.productId === id)?.qty ?? 0,
    customerId,
    addToBill: addProduct,
    setCustomer: setCustomerId,
    setPayment: setPaymentMode,
    searchProduct: (text) => {
      setSearch(text);
      searchRef.current?.focus();
    },
    userId: user.id,
    canKhataAmount: can('void'),
  });

  // F2 = search, F9 = pay. Re-registered each render so it sees the current bill.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F2') {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (e.key === 'F9' && !paying) {
        e.preventDefault();
        startPay();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className="flex flex-col gap-4 pb-24 lg:h-[calc(100vh-49px-3rem)] lg:flex-row lg:pb-0">
      {/* Products */}
      <section className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="relative mb-3">
          <Search size={18} className="absolute top-1/2 left-3 -translate-y-1/2 text-slate-400" />
          <Input
            ref={searchRef}
            className="py-3 pl-10 text-base"
            placeholder="Search product, SKU or scan barcode… (F2)"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onSearchEnter()}
          />
        </div>
        <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
          {[{ id: 'fav', name: '★ Favourites' }, { id: 'all', name: 'All' }, ...categories].map((c) => (
            <button
              key={c.id}
              onClick={() => {
                setCategory(c.id);
                setSearch('');
              }}
              className={cx(
                'shrink-0 rounded-full border px-3 py-1.5 text-sm',
                category === c.id && !search ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 bg-white hover:bg-slate-50',
              )}
            >
              {c.name}
            </button>
          ))}
        </div>
        <div className="grid max-h-[60vh] min-h-0 flex-1 auto-rows-min grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3 lg:max-h-none xl:grid-cols-4">
          {visible.map((p) => (
            <button
              key={p.id}
              onClick={() => addProduct(p)}
              className="flex flex-col rounded-xl border border-slate-200 bg-white p-3 text-left shadow-sm transition hover:border-brand-500 hover:shadow"
            >
              <div className="flex items-start justify-between gap-1">
                <span className="line-clamp-2 text-sm font-medium">{p.name}</span>
                {p.favorite && <Star size={14} className="shrink-0 fill-amber-400 text-amber-400" />}
              </div>
              {p.nameUr && <span className="urdu text-xs text-slate-500">{p.nameUr}</span>}
              <div className="mt-auto flex items-end justify-between pt-2">
                <span className="font-semibold text-brand-700">{rs(p.salePrice)}</span>
                <span className={cx('text-xs', p.stock <= 0 ? 'text-rose-600' : p.stock <= p.minStock ? 'text-amber-600' : 'text-slate-400')}>
                  {fmtQty(p.stock)} {p.unit}
                </span>
              </div>
            </button>
          ))}
          {visible.length === 0 && (
            <div className="col-span-full">
              <Empty icon={<Search size={36} />} title="No products found">
                {can('products') ? 'Add products from the Products page.' : 'Ask the owner to add this product.'}
              </Empty>
            </div>
          )}
        </div>
      </section>

      {/* Cart */}
      <section className="flex min-h-0 w-full flex-col rounded-xl border border-slate-200 bg-white shadow-sm lg:w-[400px] lg:shrink-0">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <h2 className="flex items-center gap-2 font-semibold">
            <ShoppingCart size={18} /> Current bill
          </h2>
          <div className="flex gap-1">
            {held.length > 0 && (
              <Button size="sm" variant="secondary" onClick={() => setShowHeld(true)}>
                Held ({held.length})
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={holdCart} disabled={cart.length === 0} title="Hold bill">
              <PauseCircle size={16} /> Hold
            </Button>
            <Button size="sm" variant="ghost" onClick={reset} disabled={cart.length === 0} title="Clear">
              <Trash2 size={16} />
            </Button>
          </div>
        </div>
        <div className="border-b border-slate-100 p-3">
          <CustomerPicker value={customerId} onChange={setCustomerId} />
        </div>
        {voice.panel}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {cart.length === 0 ? (
            <Empty icon={<ShoppingCart size={36} />} title="Bill is empty">
              Tap a product or scan a barcode.
            </Empty>
          ) : (
            <ul className="divide-y divide-slate-100">
              {cart.map((l) => (
                <li key={l.productId} className="px-3 py-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 text-sm font-medium">{l.name}</div>
                    <div className="text-sm font-semibold tabular-nums">{rs(lineTotal(l.price, l.qty) - l.discount)}</div>
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <button className="rounded border border-slate-300 p-1 hover:bg-slate-50" onClick={() => (l.qty > 1 ? setLine(l.productId, { qty: roundQty(l.qty - 1) }) : removeLine(l.productId))}>
                      <Minus size={14} />
                    </button>
                    <input
                      className="w-16 rounded border border-slate-300 px-1 py-0.5 text-center text-sm"
                      inputMode="decimal"
                      value={l.qty}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        if (Number.isFinite(v) && v >= 0) setLine(l.productId, { qty: roundQty(v) });
                      }}
                    />
                    <button className="rounded border border-slate-300 p-1 hover:bg-slate-50" onClick={() => setLine(l.productId, { qty: roundQty(l.qty + 1) })}>
                      <Plus size={14} />
                    </button>
                    <span className="text-xs text-slate-500">
                      {l.unit} ×{' '}
                      {can('void') ? (
                        <input
                          className="w-20 rounded border border-slate-200 px-1 py-0.5 text-right text-xs"
                          inputMode="decimal"
                          defaultValue={l.price / 100}
                          onBlur={(e) => {
                            const v = Math.round(Number(e.target.value) * 100);
                            if (Number.isFinite(v) && v >= 0) setLine(l.productId, { price: v });
                          }}
                          title="Change price"
                        />
                      ) : (
                        rs(l.price)
                      )}
                    </span>
                    <button className="ml-auto rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600" onClick={() => removeLine(l.productId)} aria-label="Remove">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="space-y-2 border-t border-slate-100 p-3">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="text-slate-500">
              Subtotal ({cart.length}) <span className="tabular-nums text-slate-700">{rs(subtotal)}</span>
            </span>
            <span className="flex items-center gap-2 text-slate-500">
              Discount
              <MoneyInput className="w-24 py-1 text-right" value={discount} onChange={setDiscount} />
            </span>
          </div>
          <div className="flex justify-between text-xl font-bold">
            <span>Total</span>
            <span className="tabular-nums">{rs(total)}</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {(['cash', 'credit'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setPaymentMode(m)}
                className={cx(
                  'rounded-lg border py-1.5 text-sm font-medium',
                  paymentMode === m
                    ? m === 'credit'
                      ? 'border-rose-600 bg-rose-600 text-white'
                      : 'border-emerald-600 bg-emerald-600 text-white'
                    : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50',
                )}
              >
                {m === 'cash' ? 'Cash' : 'Udhaar'}
              </button>
            ))}
          </div>
          {paymentMode === 'credit' && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm">
              <div>
                Customer: <b>{billCustomer?.name ?? '— select above —'}</b>
              </div>
              <div>
                Total: <b>{rs(total)}</b> · Payment: <b className="text-rose-700">UDHAAR</b>
              </div>
            </div>
          )}
          {voice.button}
          <Button size="lg" variant={paymentMode === 'credit' ? 'danger' : 'success'} className="w-full" disabled={cart.length === 0} onClick={startPay}>
            {paymentMode === 'credit' ? `Save udhaar bill — ${rs(total)} (F9)` : `Pay ${rs(total)} (F9)`}
          </Button>
        </div>
      </section>

      {paying && (
        <PayModal
          total={total}
          customerId={customerId}
          startOnCredit={paymentMode === 'credit'}
          onClose={() => setPaying(false)}
          onPaid={async (payments, note) => {
            const sale = await completeSale({ items: cart.filter((l) => l.qty > 0), discount, customerId, payments, userId: user.id, note });
            setPaying(false);
            setReceipt(sale);
            reset();
          }}
        />
      )}
      {receipt && <ReceiptModal sale={receipt} autoPrint onClose={() => { setReceipt(null); searchRef.current?.focus(); }} />}
      {voice.floatingButton}
      {showHeld && (
        <Modal title="Held bills" onClose={() => setShowHeld(false)}>
          <ul className="divide-y divide-slate-100">
            {held.map((h) => (
              <li key={h.id} className="flex items-center justify-between py-2">
                <span className="text-sm">{h.label}</span>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={async () => {
                      if (cart.length > 0) await holdCart();
                      setCart(h.items.map(({ cost: _c, returnedQty: _r, ...l }) => l));
                      setDiscount(h.discount);
                      setCustomerId(h.customerId);
                      await db.heldCarts.delete(h.id);
                      setShowHeld(false);
                    }}
                  >
                    Resume
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => db.heldCarts.delete(h.id)}>
                    <Trash2 size={14} />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </Modal>
      )}
    </div>
  );
}

/** Payment: cash with change, wallets/bank, split payment, remainder on udhaar. */
function PayModal({
  total,
  customerId,
  startOnCredit,
  onClose,
  onPaid,
}: {
  total: number;
  customerId?: string;
  /** Udhaar bill: start with no cash received, so the full amount goes on the khata. */
  startOnCredit?: boolean;
  onClose: () => void;
  onPaid: (payments: { accountId: string; amount: number }[], note?: string) => Promise<void>;
}) {
  const accounts = useLiveQuery(() => db.accounts.filter((a) => a.active).toArray(), []) ?? [];
  const balances = useLiveQuery(() => partyBalances('customer'), []) ?? new Map<string, number>();
  const customer = useLiveQuery(() => (customerId ? db.customers.get(customerId) : undefined), [customerId]);
  const [amounts, setAmounts] = useState<Record<string, number>>({ [ACCOUNT_IDS.cash]: startOnCredit ? 0 : total });
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const run = useAction();

  const paid = Object.values(amounts).reduce((s, v) => s + (v || 0), 0);
  const change = Math.max(0, paid - total);
  const credit = Math.max(0, total - paid);
  const newBalance = (customerId ? balances.get(customerId) ?? 0 : 0) + credit;
  const overLimit = customer && customer.creditLimit > 0 && credit > 0 && newBalance > customer.creditLimit;

  const set = (id: string, v: number) => setAmounts((a) => ({ ...a, [id]: v }));
  const quick = [total, ...[50000, 100000, 500000].filter((v) => v > total)].slice(0, 4);

  const submit = () =>
    run(async () => {
      if (credit > 0 && !customerId) throw new OpError('Select a customer to put the remaining amount on udhaar');
      setBusy(true);
      try {
        await onPaid(
          Object.entries(amounts).map(([accountId, amount]) => ({ accountId, amount })),
          note || undefined,
        );
      } finally {
        setBusy(false);
      }
    });

  return (
    <Modal
      title={`Payment — ${rs(total)}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Back
          </Button>
          <Button variant="success" size="lg" disabled={busy} onClick={submit}>
            {credit > 0 ? `Complete — ${rs(credit)} on udhaar` : 'Complete sale'}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <Field label="Cash received">
          <MoneyInput
            className="py-3 text-lg"
            value={amounts[ACCOUNT_IDS.cash] ?? 0}
            onChange={(v) => set(ACCOUNT_IDS.cash, v)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            autoFocus
            onFocus={(e) => e.currentTarget.select()}
          />
        </Field>
        <div className="flex flex-wrap gap-2">
          {quick.map((v) => (
            <Button key={v} size="sm" variant="secondary" onClick={() => set(ACCOUNT_IDS.cash, v)}>
              {v === total ? 'Exact' : rs(v)}
            </Button>
          ))}
          <Button size="sm" variant="secondary" onClick={() => set(ACCOUNT_IDS.cash, 0)}>
            No cash
          </Button>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {accounts
            .filter((a) => a.id !== ACCOUNT_IDS.cash)
            .map((a) => (
              <Field key={a.id} label={a.name}>
                <MoneyInput value={amounts[a.id] ?? 0} onChange={(v) => set(a.id, v)} />
              </Field>
            ))}
        </div>
        <div className="rounded-lg bg-slate-50 p-3 text-sm">
          <div className="flex justify-between">
            <span>Paid</span>
            <span className="font-medium">{rs(paid)}</span>
          </div>
          {change > 0 && (
            <div className="flex justify-between text-lg font-bold text-emerald-700">
              <span>Change to give</span>
              <span>{rs(change)}</span>
            </div>
          )}
          {credit > 0 && (
            <div className="flex justify-between font-semibold text-rose-600">
              <span>Udhaar (goes to khata)</span>
              <span>{rs(credit)}</span>
            </div>
          )}
          {credit > 0 && !customerId && <p className="mt-1 text-rose-600">Select a customer on the bill for udhaar.</p>}
          {overLimit && (
            <p className="mt-1">
              <Badge tone="amber">Over credit limit</Badge> New balance {rs(newBalance)} / limit {rs(customer!.creditLimit)}
            </p>
          )}
        </div>
        <Field label="Note (optional)">
          <Input value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
