import { useLiveQuery } from 'dexie-react-hooks';
import { HandCoins, MessageCircle, Pencil, Plus, Search, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { LedgerTable } from '../components/Ledger';
import { Badge, Button, Card, Empty, Field, Input, Modal, MoneyInput, PageHeader, Select, Stat, cx, td, th, useAction } from '../components/ui';
import { ACCOUNT_IDS, db, nowIso, uid, type Customer } from '../lib/db';
import { rs } from '../lib/format';
import { addPartyAdjustment, receiveCustomerPayment } from '../lib/ops';
import { partyBalances } from '../lib/reports';
import { useSession } from '../lib/session';

export function CustomersPage() {
  const { can } = useSession();
  const customers = useLiveQuery(() => db.customers.orderBy('name').toArray(), []) ?? [];
  const balances = useLiveQuery(() => partyBalances('customer'), []) ?? new Map<string, number>();
  const [q, setQ] = useState('');
  const [onlyDue, setOnlyDue] = useState(false);
  const [editing, setEditing] = useState<Customer | 'new' | null>(null);
  const [open, setOpen] = useState<Customer | null>(null);

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return customers
      .filter((c) => !s || c.name.toLowerCase().includes(s) || c.phone?.includes(s))
      .filter((c) => !onlyDue || (balances.get(c.id) ?? 0) > 0)
      .sort((a, b) => (balances.get(b.id) ?? 0) - (balances.get(a.id) ?? 0));
  }, [customers, balances, q, onlyDue]);

  const totalDue = [...balances.values()].filter((v) => v > 0).reduce((s, v) => s + v, 0);

  return (
    <div>
      <PageHeader
        title="Customers (Udhaar / Khata)"
        subtitle="Who owes you money"
        actions={
          can('void') && (
            <Button onClick={() => setEditing('new')}>
              <Plus size={16} /> Add customer
            </Button>
          )
        }
      />
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Stat label="Total udhaar" value={rs(totalDue)} tone="amber" />
        <Stat label="Customers with udhaar" value={[...balances.values()].filter((v) => v > 0).length} />
        <Stat label="Over credit limit" value={customers.filter((c) => c.creditLimit > 0 && (balances.get(c.id) ?? 0) > c.creditLimit).length} tone="red" />
      </div>
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3">
          <div className="relative min-w-[220px] flex-1">
            <Search size={16} className="absolute top-1/2 left-3 -translate-y-1/2 text-slate-400" />
            <Input className="pl-9" placeholder="Search name or phone" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={onlyDue} onChange={(e) => setOnlyDue(e.target.checked)} /> Only with udhaar
          </label>
        </div>
        {list.length === 0 ? (
          <Empty icon={<Users size={40} />} title="No customers" />
        ) : (
          <table className="w-full">
            <thead className="bg-slate-50">
              <tr>
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
                    <td className={cx(td, 'font-medium')}>{c.name}</td>
                    <td className={cx(td, 'text-slate-600')}>{c.phone}</td>
                    <td className={cx(td, 'text-right tabular-nums text-slate-600')}>{c.creditLimit ? rs(c.creditLimit) : '—'}</td>
                    <td className={cx(td, 'text-right font-semibold tabular-nums', bal > 0 ? 'text-rose-600' : 'text-emerald-600')}>
                      {rs(bal)} {c.creditLimit > 0 && bal > c.creditLimit && <Badge tone="red">Over limit</Badge>}
                    </td>
                    <td className={cx(td, 'text-right')}>
                      {can('void') && (
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
    </div>
  );
}

function CustomerForm({ customer, onClose }: { customer: Customer | null; onClose: () => void }) {
  const run = useAction();
  const [name, setName] = useState(customer?.name ?? '');
  const [phone, setPhone] = useState(customer?.phone ?? '');
  const [address, setAddress] = useState(customer?.address ?? '');
  const [limit, setLimit] = useState(customer?.creditLimit ?? 0);
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
                await db.customers.update(customer.id, { name: name.trim(), phone, address, creditLimit: limit });
              } else {
                const id = uid();
                await db.customers.add({ id, name: name.trim(), phone, address, creditLimit: limit, createdAt: nowIso() });
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
        <Field label="Credit limit (Rs)" hint="0 = no limit">
          <MoneyInput value={limit} onChange={setLimit} />
        </Field>
        {!customer && (
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

  const reminder = () => {
    const phone = (customer.phone ?? '').replace(/\D/g, '').replace(/^0/, '92');
    const text = `Assalam-o-Alaikum ${customer.name},\nYour outstanding balance at ${settings?.shopName} is ${rs(balance)}.\nShukriya!`;
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, '_blank');
  };

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
          {customer.phone && (
            <Button variant="success" onClick={reminder}>
              <MessageCircle size={16} /> WhatsApp reminder
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
                await receiveCustomerPayment(customer.id, amount, accountId);
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
    </Modal>
  );
}
