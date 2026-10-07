import { useLiveQuery } from '../lib/store';
import { UserPlus, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { db, nowIso, uid, type Customer } from '../lib/db';
import { rs } from '../lib/format';
import { partyBalances } from '../lib/reports';
import { useSession } from '../lib/session';
import { Button, Field, Input, Modal, MoneyInput, cx } from './ui';

/** Search-and-pick customer with their current udhaar balance; can add a new customer inline. */
export function CustomerPicker({ value, onChange, canCreate = true, focusRequest = 0 }: { value?: string; onChange: (id?: string) => void; canCreate?: boolean; focusRequest?: number }) {
  const { has } = useSession();
  const showBalance = has('customers.view_balance');
  const customers = useLiveQuery(() => db.customers.orderBy('name').toArray(), []) ?? [];
  const balances = useLiveQuery(() => (showBalance ? partyBalances('customer') : new Map<string, number>()), [showBalance]) ?? new Map<string, number>();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [changing, setChanging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (focusRequest === 0) return;
    setChanging(true);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, [focusRequest]);
  const selected = customers.find((c) => c.id === value);

  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    return customers.filter((c) => !s || c.name.toLowerCase().includes(s) || c.phone?.includes(s)).slice(0, 8);
  }, [customers, q]);

  if (selected && !changing) {
    const bal = balances.get(selected.id) ?? 0;
    return (
      <div className="flex items-center justify-between rounded-lg border border-brand-200 bg-brand-50 px-3 py-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{selected.name}</div>
          <div className="text-xs text-slate-500">
            {selected.shopkeeperPricing ? 'Special customer · shopkeeper rate' : selected.phone ?? ''}
            {selected.shopkeeperPricing && selected.phone ? ` · ${selected.phone}` : ''}
            {showBalance && (
              <>
                {selected.phone || selected.shopkeeperPricing ? ' · ' : ''}Balance: <span className={bal > 0 ? 'text-rose-600' : ''}>{rs(bal)}</span>
                {selected.creditLimit > 0 && <> · Limit {rs(selected.creditLimit)}</>}
              </>
            )}
          </div>
        </div>
        <button className="rounded p-1 text-slate-500 hover:bg-white" onClick={() => { setChanging(true); window.setTimeout(() => inputRef.current?.focus(), 0); }} aria-label="Change customer" title="Change customer">
          <UserPlus size={16} />
        </button>
        <button className="rounded p-1 text-slate-500 hover:bg-white" onClick={() => { onChange(undefined); setChanging(false); }} aria-label="Remove customer">
          <X size={16} />
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="flex gap-2">
        <Input
          ref={inputRef}
          placeholder="Walk-in customer — search name/phone"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
        />
        {canCreate && <Button variant="secondary" onClick={() => setAdding(true)} title="New customer"><UserPlus size={16} /></Button>}
      </div>
      {open && matches.length > 0 && (
        <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
          {matches.map((c) => (
            <button
              key={c.id}
              className={cx('flex w-full justify-between px-3 py-2 text-left text-sm hover:bg-slate-50')}
              onMouseDown={() => {
                onChange(c.id);
                setQ('');
                setChanging(false);
              }}
            >
              <span>
                {c.name} {c.shopkeeperPricing && <span className="text-emerald-700">· Shopkeeper rate</span>} <span className="text-slate-400">{c.phone}</span>
              </span>
              {showBalance && <span className="text-xs text-slate-500">{rs(balances.get(c.id) ?? 0)}</span>}
            </button>
          ))}
        </div>
      )}
      {adding && (
        <QuickCustomer
          initialName={q}
          onClose={() => setAdding(false)}
          onSaved={(customer) => {
            onChange(customer.id);
            setAdding(false);
            setQ('');
          }}
        />
      )}
    </div>
  );
}

function QuickCustomer({ initialName, onClose, onSaved }: { initialName: string; onClose: () => void; onSaved: (customer: Customer) => void }) {
  const { has } = useSession();
  const [name, setName] = useState(initialName);
  const [phone, setPhone] = useState('');
  const [limit, setLimit] = useState(0);
  return (
    <Modal
      title="New customer"
      onClose={onClose}
      footer={
        <Button
          disabled={!name.trim()}
          onClick={async () => {
            const customer: Customer = { id: uid(), name: name.trim(), phone: phone.trim(), creditLimit: has('customers.set_credit_limit') ? limit : 0, createdAt: nowIso() };
            await db.customers.add(customer);
            onSaved(customer);
          }}
        >
          Save customer
        </Button>
      }
    >
      <div className="grid gap-3">
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <Field label="Phone">
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>
        {has('customers.set_credit_limit') && (
          <Field label="Credit limit (Rs)" hint="0 = no limit">
            <MoneyInput value={limit} onChange={setLimit} />
          </Field>
        )}
      </div>
    </Modal>
  );
}
