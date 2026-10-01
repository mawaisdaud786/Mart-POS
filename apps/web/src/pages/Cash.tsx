import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowLeftRight } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Badge, Button, Card, Empty, Field, Input, MoneyInput, PageHeader, Select, Stat, cx, td, th, useAction } from '../components/ui';
import { ACCOUNT_IDS, db, type AccountTxn } from '../lib/db';
import { dayKey, fmtDateTime, rangeIso, rs } from '../lib/format';
import { saveClosing, transferMoney } from '../lib/ops';
import { accountBalances } from '../lib/reports';
import { useSession, useUser } from '../lib/session';

const NOTES = [5000, 1000, 500, 100, 50, 20, 10];

const TYPE_LABEL: Record<AccountTxn['type'], string> = {
  opening: 'Opening',
  sale: 'Sales',
  refund: 'Refunds',
  customer_payment: 'Udhaar received',
  purchase: 'Purchases paid',
  supplier_payment: 'Supplier payments',
  expense: 'Expenses',
  drawing: 'Owner withdrawals',
  transfer: 'Transfers',
  service: 'Easypaisa/JazzCash',
  adjustment: 'Closing differences',
};

export function CashPage() {
  const user = useUser();
  const { settings, can } = useSession();
  const run = useAction();
  const balances = useLiveQuery(() => accountBalances(), []) ?? [];
  const [accountId, setAccountId] = useState<string>(ACCOUNT_IDS.cash);
  const [day, setDay] = useState(dayKey());
  const [counts, setCounts] = useState<Record<number, string>>({});
  const [coins, setCoins] = useState(0);
  const [note, setNote] = useState('');
  const [tFrom, setTFrom] = useState<string>(ACCOUNT_IDS.cash);
  const [tTo, setTTo] = useState<string>(ACCOUNT_IDS.bank);
  const [tAmount, setTAmount] = useState(0);

  const txns =
    useLiveQuery(async () => {
      const [s, e] = rangeIso(day, day);
      return (await db.accountTxns.where('date').between(s, e, true, true).toArray()).filter((t) => t.accountId === accountId);
    }, [day, accountId]) ?? [];
  const closings = useLiveQuery(() => db.closings.orderBy('date').reverse().limit(15).toArray(), []) ?? [];

  const balance = balances.find((b) => b.id === accountId)?.balance ?? 0;
  const counted = NOTES.reduce((s, n) => s + n * 100 * (Number(counts[n]) || 0), 0) + coins;
  const diff = counted - balance;
  const needsReason = Math.abs(diff) >= (settings?.discrepancyLimit ?? 50000);
  const accName = (id: string) => balances.find((b) => b.id === id)?.name ?? '';
  // Cashiers count blind: they don't see the expected amount before saving.
  const blind = !can('void');

  const summary = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of txns) map.set(t.type, (map.get(t.type) ?? 0) + t.amount);
    return [...map.entries()];
  }, [txns]);

  return (
    <div>
      <PageHeader title="Cash & Closing" subtitle="Where the money is, and the end-of-day cash count" />
      {!blind && (
        <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {balances.map((b) => (
            <Stat key={b.id} label={b.name} value={rs(b.balance)} tone={b.balance < 0 ? 'red' : b.type === 'cash' ? 'blue' : 'default'} />
          ))}
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-[400px_1fr]">
        <div className="space-y-4">
          <Card title="Daily cash closing">
            <div className="grid gap-3 p-4">
              <Field label="Account">
                <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                  {balances.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </Select>
              </Field>
              {accountId === ACCOUNT_IDS.cash ? (
                <div className="grid grid-cols-2 gap-2">
                  {NOTES.map((n) => (
                    <label key={n} className="flex items-center gap-2 text-sm">
                      <span className="w-16 text-right text-slate-500">Rs {n} ×</span>
                      <input
                        className="w-20 rounded border border-slate-300 px-2 py-1 text-right"
                        inputMode="numeric"
                        value={counts[n] ?? ''}
                        onChange={(e) => setCounts((c) => ({ ...c, [n]: e.target.value.replace(/\D/g, '') }))}
                      />
                    </label>
                  ))}
                  <label className="flex items-center gap-2 text-sm">
                    <span className="w-16 text-right text-slate-500">Coins</span>
                    <MoneyInput className="w-20 py-1 text-right" value={coins} onChange={setCoins} />
                  </label>
                </div>
              ) : (
                <Field label="Actual balance (Rs)">
                  <MoneyInput value={coins} onChange={setCoins} />
                </Field>
              )}
              <div className="rounded-lg bg-slate-50 p-3 text-sm">
                <div className="flex justify-between">
                  <span>Counted</span>
                  <b>{rs(counted)}</b>
                </div>
                {!blind && (
                  <>
                    <div className="flex justify-between">
                      <span>Expected (books)</span>
                      <b>{rs(balance)}</b>
                    </div>
                    <div className={cx('flex justify-between font-semibold', diff === 0 ? 'text-emerald-600' : 'text-rose-600')}>
                      <span>Difference</span>
                      <span>{rs(diff)}</span>
                    </div>
                  </>
                )}
              </div>
              {(needsReason || blind) && (
                <Field label={needsReason ? 'Explain the difference (required)' : 'Note'}>
                  <Input value={note} onChange={(e) => setNote(e.target.value)} />
                </Field>
              )}
              <Button
                disabled={counted <= 0 || (needsReason && !blind && !note.trim())}
                onClick={() =>
                  run(async () => {
                    await saveClosing({ accountId, counted, note, userId: user.id });
                    setCounts({});
                    setCoins(0);
                    setNote('');
                  }, 'Closing saved')
                }
              >
                Save closing
              </Button>
            </div>
          </Card>
          {can('void') && (
            <Card title="Move money between accounts">
              <div className="grid gap-3 p-4">
                <p className="text-xs text-slate-500">E.g. deposit cash in bank, or top up Easypaisa balance with cash.</p>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="From">
                    <Select value={tFrom} onChange={(e) => setTFrom(e.target.value)}>
                      {balances.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="To">
                    <Select value={tTo} onChange={(e) => setTTo(e.target.value)}>
                      {balances.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>
                <Field label="Amount (Rs)">
                  <MoneyInput value={tAmount} onChange={setTAmount} />
                </Field>
                <Button
                  variant="secondary"
                  disabled={tAmount <= 0}
                  onClick={() => run(async () => { await transferMoney(tFrom, tTo, tAmount); setTAmount(0); }, 'Transfer saved')}
                >
                  <ArrowLeftRight size={16} /> Transfer
                </Button>
              </div>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          {!blind && (
            <Card
              title={`${accName(accountId)} — money in and out`}
              actions={<Input type="date" className="w-40" value={day} max={dayKey()} onChange={(e) => setDay(e.target.value)} />}
            >
              {txns.length === 0 ? (
                <Empty title="No movements on this day" />
              ) : (
                <>
                  <div className="grid gap-2 border-b border-slate-100 p-4 sm:grid-cols-2">
                    {summary.map(([type, amt]) => (
                      <div key={type} className="flex justify-between text-sm">
                        <span className="text-slate-600">{TYPE_LABEL[type as AccountTxn['type']]}</span>
                        <span className={cx('tabular-nums font-medium', amt >= 0 ? 'text-emerald-600' : 'text-rose-600')}>{rs(amt)}</span>
                      </div>
                    ))}
                  </div>
                  <table className="w-full">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className={th}>Time</th>
                        <th className={th}>Type</th>
                        <th className={th}>Detail</th>
                        <th className={cx(th, 'text-right')}>Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {[...txns]
                        .sort((a, b) => b.date.localeCompare(a.date))
                        .map((t) => (
                          <tr key={t.id}>
                            <td className={cx(td, 'whitespace-nowrap text-slate-600')}>{fmtDateTime(t.date)}</td>
                            <td className={td}>
                              <Badge>{TYPE_LABEL[t.type]}</Badge>
                            </td>
                            <td className={cx(td, 'text-slate-600')}>{t.note}</td>
                            <td className={cx(td, 'text-right tabular-nums', t.amount >= 0 ? 'text-emerald-600' : 'text-rose-600')}>{rs(t.amount)}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </>
              )}
            </Card>
          )}
          <Card title="Recent closings">
            {closings.length === 0 ? (
              <Empty title="No closings yet" />
            ) : (
              <table className="w-full">
                <thead className="bg-slate-50">
                  <tr>
                    <th className={th}>Date</th>
                    <th className={th}>Account</th>
                    <th className={cx(th, 'text-right')}>Counted</th>
                    {!blind && <th className={cx(th, 'text-right')}>Expected</th>}
                    {!blind && <th className={cx(th, 'text-right')}>Difference</th>}
                    <th className={th}>Note</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {closings.map((c) => (
                    <tr key={c.id}>
                      <td className={cx(td, 'whitespace-nowrap text-slate-600')}>{fmtDateTime(c.date)}</td>
                      <td className={td}>{accName(c.accountId)}</td>
                      <td className={cx(td, 'text-right tabular-nums')}>{rs(c.counted)}</td>
                      {!blind && <td className={cx(td, 'text-right tabular-nums')}>{rs(c.expected)}</td>}
                      {!blind && (
                        <td className={cx(td, 'text-right tabular-nums font-medium', c.difference === 0 ? 'text-emerald-600' : 'text-rose-600')}>{rs(c.difference)}</td>
                      )}
                      <td className={cx(td, 'text-slate-600')}>{c.note}</td>
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
