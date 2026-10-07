import { useLiveQuery } from '../lib/store';
import { Trash2, Wallet } from 'lucide-react';
import { useState } from 'react';
import { ListControls, compareListValues } from '../components/ListControls';
import { Badge, Button, Card, Empty, Field, Input, PageHeader, Select, Stat, MoneyInput, cx, td, th, useAction } from '../components/ui';
import { ACCOUNT_IDS, DEFAULT_EXPENSE_CATEGORIES, db } from '../lib/db';
import { dayKey, fmtDateTime, rangeIso, rs } from '../lib/format';
import { addExpense, deleteExpense } from '../lib/ops';
import { useSession, useUser } from '../lib/session';

export function ExpensesPage() {
  const user = useUser();
  const { can } = useSession();
  const run = useAction();
  const accounts = useLiveQuery(() => db.accounts.filter((a) => a.active).toArray(), []) ?? [];
  const [month, setMonth] = useState(dayKey().slice(0, 7));
  const [kind, setKind] = useState<'expense' | 'drawing'>('expense');
  const [category, setCategory] = useState(DEFAULT_EXPENSE_CATEGORIES[0]);
  const [amount, setAmount] = useState(0);
  const [accountId, setAccountId] = useState<string>(ACCOUNT_IDS.cash);
  const [note, setNote] = useState('');
  const [date, setDate] = useState(dayKey());
  const [search, setSearch] = useState('');
  const [listKind, setListKind] = useState<'all' | 'expense' | 'drawing'>('all');
  const [sortBy, setSortBy] = useState<'date' | 'category' | 'amount'>('date');

  const list =
    useLiveQuery(async () => {
      const last = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();
      const [s, e] = rangeIso(`${month}-01`, `${month}-${String(last).padStart(2, '0')}`);
      return db.expenses.where('date').between(s, e, true, true).reverse().sortBy('date');
    }, [month]) ?? [];

  const expenses = list.filter((e) => e.kind === 'expense');
  const drawings = list.filter((e) => e.kind === 'drawing');
  const query = search.trim().toLocaleLowerCase();
  const visibleEntries = [...list]
    .filter((entry) => listKind === 'all' || entry.kind === listKind)
    .filter((entry) => !query || entry.category.toLocaleLowerCase().includes(query) || (entry.note ?? '').toLocaleLowerCase().includes(query))
    .sort((a, b) => {
      if (sortBy === 'category') return compareListValues(a.category, b.category);
      if (sortBy === 'amount') return b.amount - a.amount;
      return b.date.localeCompare(a.date);
    });
  const byCat = new Map<string, number>();
  for (const e of expenses) byCat.set(e.category, (byCat.get(e.category) ?? 0) + e.amount);
  const accName = (id: string) => accounts.find((a) => a.id === id)?.name ?? '';

  const save = () =>
    run(async () => {
      // Back-dated entries get noon of that day, so they land on the right date in reports.
      const when = date === dayKey() ? undefined : new Date(`${date}T12:00:00`).toISOString();
      await addExpense({ kind, category: kind === 'drawing' ? 'Owner withdrawal' : category, amount, accountId, note, ...(when ? { date: when } : {}) });
      setAmount(0);
      setNote('');
    }, kind === 'drawing' ? 'Owner withdrawal saved' : 'Expense saved');

  return (
    <div>
      <PageHeader title="Expenses" subtitle="Shop running costs and owner withdrawals" />
      <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
        <Card title="Add" className="h-fit">
          <div className="grid gap-3 p-4">
            <div className="flex gap-2">
              <Button size="sm" variant={kind === 'expense' ? 'primary' : 'secondary'} onClick={() => setKind('expense')}>
                Shop expense
              </Button>
              {can('settings') && (
                <Button size="sm" variant={kind === 'drawing' ? 'primary' : 'secondary'} onClick={() => setKind('drawing')}>
                  Owner withdrawal
                </Button>
              )}
            </div>
            {kind === 'drawing' && (
              <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-800">
                Money the owner takes home is not a shop expense, so it does not reduce profit. It does reduce cash.
              </p>
            )}
            {kind === 'expense' && (
              <Field label="Category">
                <Select value={category} onChange={(e) => setCategory(e.target.value)}>
                  {DEFAULT_EXPENSE_CATEGORIES.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </Select>
              </Field>
            )}
            <Field label="Amount (Rs)">
              <MoneyInput value={amount} onChange={setAmount} />
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
            <Field label="Date">
              <Input type="date" value={date} max={dayKey()} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label="Note">
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. October bill" />
            </Field>
            <Button disabled={amount <= 0} onClick={save}>
              Save
            </Button>
          </div>
        </Card>
        <div>
          <div className="mb-3 flex items-end gap-3">
            <Field label="Month">
              <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
            </Field>
          </div>
          <div className="mb-4 grid gap-3 sm:grid-cols-2">
            <Stat label="Expenses this month" value={rs(expenses.reduce((s, e) => s + e.amount, 0))} tone="red" />
            <Stat label="Owner withdrawals" value={rs(drawings.reduce((s, e) => s + e.amount, 0))} tone="amber" sub="Not counted as expense" />
          </div>
          {byCat.size > 0 && (
            <Card className="mb-4 p-4">
              <div className="space-y-2">
                {[...byCat.entries()]
                  .sort((a, b) => b[1] - a[1])
                  .map(([cat, amt]) => {
                    const max = Math.max(...byCat.values());
                    return (
                      <div key={cat} className="flex items-center gap-3 text-sm">
                        <span className="w-32 shrink-0 text-slate-600">{cat}</span>
                        <div className="h-2.5 flex-1 rounded-full bg-slate-100">
                          <div className="h-2.5 rounded-full bg-rose-400" style={{ width: `${(amt / max) * 100}%` }} />
                        </div>
                        <span className="w-28 text-right tabular-nums">{rs(amt)}</span>
                      </div>
                    );
                  })}
              </div>
            </Card>
          )}
          <Card>
            <ListControls
              search={search}
              onSearch={setSearch}
              placeholder="Search category or note…"
              filters={[{ label: 'Entry type', value: listKind, options: [{ value: 'all', label: 'All entries' }, { value: 'expense', label: 'Expenses' }, { value: 'drawing', label: 'Owner withdrawals' }], onChange: (value) => setListKind(value as typeof listKind) }]}
              sortValue={sortBy}
              sortOptions={[{ value: 'date', label: 'Date · newest' }, { value: 'amount', label: 'Amount · highest' }, { value: 'category', label: 'Category · A–Z' }]}
              onSort={(value) => setSortBy(value as typeof sortBy)}
            />
            {list.length === 0 ? (
              <Empty icon={<Wallet size={40} />} title="No expenses this month" />
            ) : visibleEntries.length === 0 ? (
              <Empty title="No matching entries" />
            ) : (
              <table className="w-full">
                <thead className="bg-slate-50">
                  <tr>
                    <th className={th}>Date</th>
                    <th className={th}>Category</th>
                    <th className={th}>Note</th>
                    <th className={th}>From</th>
                    <th className={cx(th, 'text-right')}>Amount</th>
                    <th className={th} />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {visibleEntries.map((e) => (
                    <tr key={e.id}>
                      <td className={cx(td, 'whitespace-nowrap text-slate-600')}>{fmtDateTime(e.date)}</td>
                      <td className={td}>{e.kind === 'drawing' ? <Badge tone="amber">Owner withdrawal</Badge> : e.category}</td>
                      <td className={cx(td, 'text-slate-600')}>{e.note}</td>
                      <td className={cx(td, 'text-slate-600')}>{accName(e.accountId)}</td>
                      <td className={cx(td, 'text-right tabular-nums')}>{rs(e.amount)}</td>
                      <td className={td}>
                        {can('settings') && (
                          <button
                            className="rounded p-1 text-slate-400 hover:text-rose-600"
                            title="Delete"
                            onClick={() => confirm('Delete this entry? The money goes back to the account.') && run(() => deleteExpense(e.id), 'Deleted')}
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
