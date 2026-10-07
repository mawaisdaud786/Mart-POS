import { useLiveQuery } from '../lib/store';
import { HandCoins, MessageCircle, Pencil, Plus, Users } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { LedgerTable } from '../components/Ledger';
import { BulkMasterModal } from '../components/BulkMasterModal';
import { WhatsAppMessageModal } from '../components/WhatsAppMessageModal';
import { compareListValues, ListControls } from '../components/ListControls';
import { Badge, Button, Card, Empty, Field, Input, Modal, MoneyInput, PageHeader, Select, Stat, cx, td, th, useAction } from '../components/ui';
import { ACCOUNT_IDS, db, nowIso, uid, type Customer } from '../lib/db';
import { rs } from '../lib/format';
import { addPartyAdjustment, receiveCustomerPayment } from '../lib/ops';
import { partyBalances } from '../lib/reports';
import { useSession } from '../lib/session';

export function CustomersPage() {
  const { can, has } = useSession();
  const [searchParams, setSearchParams] = useSearchParams();
  const [focus, setFocus] = useState(() => ['due', 'over-limit'].includes(searchParams.get('focus') ?? '') ? searchParams.get('focus')! : '');
  const customers = useLiveQuery(() => db.customers.orderBy('name').toArray(), []) ?? [];
  const balances = useLiveQuery(() => partyBalances('customer'), []) ?? new Map<string, number>();
  const [q, setQ] = useState('');
  const [onlyDue, setOnlyDue] = useState(false);
  const [specialFilter, setSpecialFilter] = useState('all');
  const [sortBy, setSortBy] = useState<'balance' | 'name' | 'creditLimit'>('balance');
  const [editing, setEditing] = useState<Customer | 'new' | null>(null);
  const [open, setOpen] = useState<Customer | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [bulkOpen, setBulkOpen] = useState(false);

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return customers
      .filter((c) => !s || c.name.toLowerCase().includes(s) || c.phone?.includes(s))
      .filter((c) => focus === 'over-limit' ? (c.creditLimit > 0 && (balances.get(c.id) ?? 0) > c.creditLimit) : focus !== 'due' || (balances.get(c.id) ?? 0) > 0)
      .filter((c) => !onlyDue || (balances.get(c.id) ?? 0) > 0)
      .filter((customer) => specialFilter === 'all' || (specialFilter === 'special') === (customer.shopkeeperPricing === true))
      .sort((a, b) => sortBy === 'name'
        ? compareListValues(a.name, b.name)
        : sortBy === 'creditLimit'
          ? b.creditLimit - a.creditLimit
          : (balances.get(b.id) ?? 0) - (balances.get(a.id) ?? 0));
  }, [customers, balances, q, onlyDue, specialFilter, sortBy, focus]);
  const visibleIds = list.map((customer) => customer.id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.includes(id));

  const totalDue = [...balances.values()].filter((v) => v > 0).reduce((s, v) => s + v, 0);

  return (
    <div>
      <PageHeader
        title="Customers (Udhaar / Khata)"
        subtitle="Who owes you money"
        actions={
          <div className="flex gap-2">
            {has('customers.manage') && <Button variant="secondary" onClick={() => setBulkOpen(true)}>Bulk tools</Button>}
            {(can('void') || has('customers.manage')) && <Button onClick={() => setEditing('new')}><Plus size={16} /> Add customer</Button>}
          </div>
        }
      />
      {focus && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          <span>Focused view: <strong>{focus === 'over-limit' ? 'Customers over their credit limit' : 'Customers with a balance due'}</strong> · {list.length} matching customers</span>
          <Button size="sm" variant="secondary" onClick={() => { setFocus(''); const next = new URLSearchParams(searchParams); next.delete('focus'); setSearchParams(next, { replace: true }); }}>Clear focus</Button>
        </div>
      )}
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Stat label="Total udhaar" value={rs(totalDue)} tone="amber" />
        <Stat label="Customers with udhaar" value={[...balances.values()].filter((v) => v > 0).length} />
        <Stat label="Over credit limit" value={customers.filter((c) => c.creditLimit > 0 && (balances.get(c.id) ?? 0) > c.creditLimit).length} tone="red" />
      </div>
      <Card>
        <ListControls
          search={q}
          onSearch={setQ}
          placeholder="Search customer name or phone…"
          filters={[
            { label: 'Udhaar status', value: onlyDue ? 'due' : 'all', options: [{ value: 'all', label: 'All balances' }, { value: 'due', label: 'With udhaar' }], onChange: (value) => setOnlyDue(value === 'due') },
            { label: 'Customer type', value: specialFilter, options: [{ value: 'all', label: 'All customers' }, { value: 'special', label: 'Shop owners' }, { value: 'regular', label: 'Regular' }], onChange: setSpecialFilter },
          ]}
          sortValue={sortBy}
          sortOptions={[{ value: 'balance', label: 'Balance · highest' }, { value: 'name', label: 'Name · A–Z' }, { value: 'creditLimit', label: 'Credit limit · highest' }]}
          onSort={(value) => setSortBy(value as typeof sortBy)}
        />
        {list.length === 0 ? (
          <Empty icon={<Users size={40} />} title="No customers" />
        ) : (
          <table className="w-full">
            <thead className="bg-slate-50">
              <tr>
                {has('customers.manage') && <th className={th}><input aria-label="Select all visible customers" type="checkbox" checked={allVisibleSelected} onChange={(event) => setSelected(event.target.checked ? [...new Set([...selected, ...visibleIds])] : selected.filter((id) => !visibleIds.includes(id)))} /></th>}
                <th className={th}>Customer</th>
                <th className={th}>Phone</th>
                <th className={cx(th, 'text-right')}>Credit limit</th>
                <th className={cx(th, 'text-right')}>Balance</th>
                <th className={th} />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {list.map((c) => {
                const bal = balances.get(c.id) ?? 0;
                return (
                  <tr key={c.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setOpen(c)}>
                    {has('customers.manage') && <td className={td} onClick={(event) => event.stopPropagation()}><input aria-label={`Select ${c.name}`} type="checkbox" checked={selected.includes(c.id)} onChange={(event) => setSelected(event.target.checked ? [...selected, c.id] : selected.filter((id) => id !== c.id))} /></td>}
                    <td className={cx(td, 'font-medium')}>
                      {c.name}
                      {c.shopkeeperPricing && <span className="ml-2"><Badge tone="green">Special · shopkeeper rate</Badge></span>}
                    </td>
                    <td className={cx(td, 'text-slate-600')}>{c.phone}</td>
                    <td className={cx(td, 'text-right tabular-nums text-slate-600')}>{c.creditLimit ? rs(c.creditLimit) : '—'}</td>
                    <td className={cx(td, 'text-right font-semibold tabular-nums', bal > 0 ? 'text-rose-600' : 'text-emerald-600')}>
                      {rs(bal)} {c.creditLimit > 0 && bal > c.creditLimit && <Badge tone="red">Over limit</Badge>}
                    </td>
                    <td className={cx(td, 'text-right')}>
                      {(can('void') || has('customers.manage')) && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditing(c);
                          }}
                        >
                          <Pencil size={15} />
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
      {editing && <CustomerForm customer={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {open && <CustomerKhata customer={open} balance={balances.get(open.id) ?? 0} onClose={() => setOpen(null)} />}
      {bulkOpen && <BulkMasterModal entity="customers" ids={selected} onClose={() => { setBulkOpen(false); setSelected([]); }} />}
    </div>
  );
}

function CustomerForm({ customer, onClose }: { customer: Customer | null; onClose: () => void }) {
  const { has } = useSession();
  const run = useAction();
  const [name, setName] = useState(customer?.name ?? '');
  const [phone, setPhone] = useState(customer?.phone ?? '');
  const [address, setAddress] = useState(customer?.address ?? '');
  const [limit, setLimit] = useState(customer?.creditLimit ?? 0);
  const [shopkeeperPricing, setShopkeeperPricing] = useState(customer?.shopkeeperPricing ?? false);
  const [opening, setOpening] = useState(0);
  return (
    <Modal
      title={customer ? 'Edit customer' : 'Add customer'}
      onClose={onClose}
      footer={
        <Button
          disabled={!name.trim()}
          onClick={() =>
            run(async () => {
              if (customer) {
                await db.customers.update(customer.id, { name: name.trim(), phone, address, creditLimit: limit, shopkeeperPricing });
              } else {
                const id = uid();
                await db.customers.add({ id, name: name.trim(), phone, address, creditLimit: limit, shopkeeperPricing, createdAt: nowIso() });
                if (opening) await addPartyAdjustment('customer', id, opening, 'Opening balance', 'opening');
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
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <Field label="Phone (for WhatsApp)">
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="03xx-xxxxxxx" />
        </Field>
        <Field label="Address">
          <Input value={address} onChange={(e) => setAddress(e.target.value)} />
        </Field>
        {has('customers.set_credit_limit') && (
          <Field label="Credit limit (Rs)" hint="0 = no limit">
            <MoneyInput value={limit} onChange={setLimit} />
          </Field>
        )}
        {has('customers.manage') && (
          <label className="flex items-start gap-2 rounded-lg border border-brand-100 bg-brand-50 p-3 text-sm">
            <input type="checkbox" className="mt-0.5" checked={shopkeeperPricing} onChange={(event) => setShopkeeperPricing(event.target.checked)} />
            <span>
              <span className="block font-medium text-slate-800">Special customer / shop owner</span>
              <span className="mt-0.5 block text-xs text-slate-600">Automatically use the purchase/shopkeeper rate whenever this customer is selected at POS.</span>
            </span>
          </label>
        )}
        {!customer && has('customers.manage') && (
          <Field label="Old udhaar already owed (Rs)" hint="From your old register, if any">
            <MoneyInput value={opening} onChange={setOpening} />
          </Field>
        )}
      </div>
    </Modal>
  );
}

function CustomerKhata({ customer, balance, onClose }: { customer: Customer; balance: number; onClose: () => void }) {
  const { settings } = useSession();
  const run = useAction();
  const accounts = useLiveQuery(() => db.accounts.filter((a) => a.active).toArray(), []) ?? [];
  const [amount, setAmount] = useState(0);
  const [accountId, setAccountId] = useState<string>(ACCOUNT_IDS.cash);
  const [share, setShare] = useState<{ paymentAmount?: number; paymentDate?: string; balance: number } | null>(null);
  const [lastPayment, setLastPayment] = useState<{ amount: number; date: string; balance: number } | null>(null);

  return (
    <Modal
      wide
      title={`Khata — ${customer.name}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={() => window.print()}>
            Print
          </Button>
          <Button variant="success" onClick={() => setShare({ balance })}>
            <MessageCircle size={16} /> WhatsApp balance
          </Button>
          {lastPayment && (
            <Button variant="secondary" onClick={() => setShare({ paymentAmount: lastPayment.amount, paymentDate: lastPayment.date, balance: lastPayment.balance })}>
              <MessageCircle size={16} /> WhatsApp payment receipt
            </Button>
          )}
        </>
      }
    >
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3 rounded-lg bg-slate-50 p-3">
        <div>
          <div className="text-sm text-slate-500">Balance due</div>
          <div className={cx('text-2xl font-bold', balance > 0 ? 'text-rose-600' : 'text-emerald-600')}>{rs(balance)}</div>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Receive payment (Rs)">
            <MoneyInput className="w-36" value={amount} onChange={setAmount} />
          </Field>
          <Field label="Into">
            <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </Field>
          <Button
            variant="success"
            disabled={amount <= 0}
            onClick={() =>
              run(async () => {
                const paymentDate = nowIso();
                await receiveCustomerPayment(customer.id, amount, accountId);
                const nextPayment = { amount, date: paymentDate, balance: balance - amount };
                setLastPayment(nextPayment);
                setShare({ paymentAmount: nextPayment.amount, paymentDate: nextPayment.date, balance: nextPayment.balance });
                setAmount(0);
              }, 'Payment received')
            }
          >
            <HandCoins size={16} /> Receive
          </Button>
        </div>
      </div>
      <div id="receipt-print">
        <div className="mb-2 hidden print:block">
          <b>{settings?.shopName}</b> — Statement for {customer.name} — Balance {rs(balance)}
        </div>
        <LedgerTable partyType="customer" partyId={customer.id} />
      </div>
      {share && (
        <WhatsAppMessageModal
          kind="khata"
          customer={customer}
          shop={settings}
          balance={share.balance}
          paymentAmount={share.paymentAmount}
          paymentDate={share.paymentDate}
          onClose={() => setShare(null)}
        />
      )}
    </Modal>
  );
}
