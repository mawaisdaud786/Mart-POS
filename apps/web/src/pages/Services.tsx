import { useLiveQuery } from '../lib/store';
import { Smartphone, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ListControls, compareListValues } from '../components/ListControls';
import { Badge, Button, Card, Empty, Field, Input, MoneyInput, PageHeader, Stat, cx, td, th, useAction } from '../components/ui';
import { ACCOUNT_IDS, db, type ServiceType } from '../lib/db';
import { dayKey, fmtDateTime, rs } from '../lib/format';
import { SERVICE_TYPES, addServiceTxn, adjustAccount, deleteServiceTxn, saveClosing } from '../lib/ops';
import { accountBalances, serviceSummary } from '../lib/reports';
import { useSession, useUser } from '../lib/session';
import { defaultServiceFee } from '../lib/service-fees';

/** Easypaisa / JazzCash retailer counter: kept separate from shop sales. */
export function ServicesPage() {
  const user = useUser();
  const { can, settings } = useSession();
  const run = useAction();
  const providers = useLiveQuery(() => db.accounts.filter((a) => !!a.provider && a.active).toArray(), []) ?? [];
  const [provider, setProvider] = useState('Easypaisa');
  const [type, setType] = useState<ServiceType>('cash_in');
  const [amount, setAmount] = useState(0);
  const [fee, setFee] = useState(0);
  const [commission, setCommission] = useState(0);
  const [mobile, setMobile] = useState('');
  const [ref, setRef] = useState('');
  const [counted, setCounted] = useState(0);
  const [txnSearch, setTxnSearch] = useState('');
  const [txnType, setTxnType] = useState('all');
  const [txnSort, setTxnSort] = useState<'date' | 'amount' | 'type'>('date');
  const today = dayKey();

  useEffect(() => {
    setFee(defaultServiceFee(
      type,
      amount,
      settings?.retailerCashInFee,
      settings?.retailerCashOutFee,
      settings?.retailerCashInStep,
      settings?.retailerCashOutStep,
    ));
  }, [type, amount, settings?.retailerCashInFee, settings?.retailerCashInStep, settings?.retailerCashOutFee, settings?.retailerCashOutStep]);

  const data = useLiveQuery(async () => {
    const [summary, month, balances] = await Promise.all([
      serviceSummary(provider, today, today),
      serviceSummary(provider, `${today.slice(0, 7)}-01`, today),
      accountBalances(),
    ]);
    return { summary, month, balances };
  }, [provider, today]);

  const floatAcc = providers.find((p) => p.provider === provider);
  const floatBalance = data?.balances.find((b) => b.id === floatAcc?.id)?.balance ?? 0;
  const cashBalance = data?.balances.find((b) => b.id === ACCOUNT_IDS.cash)?.balance ?? 0;
  const s = data?.summary;
  const t = SERVICE_TYPES[type];
  const txnQuery = txnSearch.trim().toLocaleLowerCase();
  const visibleTxns = [...(s?.txns ?? [])]
    .filter((txn) => txnType === 'all' || txn.type === txnType)
    .filter((txn) => !txnQuery || (txn.mobile ?? '').toLocaleLowerCase().includes(txnQuery) || (txn.ref ?? '').toLocaleLowerCase().includes(txnQuery))
    .sort((a, b) => txnSort === 'amount' ? b.amount - a.amount : txnSort === 'type' ? compareListValues(a.type, b.type) : b.date.localeCompare(a.date));

  const save = () =>
    run(async () => {
      await addServiceTxn({ provider, type, amount, fee, commission, mobile, ref });
      setAmount(0);
      setFee(defaultServiceFee(
        type,
        0,
        settings?.retailerCashInFee,
        settings?.retailerCashOutFee,
        settings?.retailerCashInStep,
        settings?.retailerCashOutStep,
      ));
      setCommission(0);
      setMobile('');
      setRef('');
    }, 'Transaction saved');

  return (
    <div>
      <PageHeader
        title="Easypaisa / JazzCash"
        subtitle="Retailer transactions — kept separate from shop sales"
        actions={
          <div className="flex gap-2">
            {providers.map((p) => (
              <Button key={p.id} variant={provider === p.provider ? 'primary' : 'secondary'} onClick={() => setProvider(p.provider!)}>
                {p.provider}
              </Button>
            ))}
          </div>
        }
      />
      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label={`${provider} balance (books)`}
          value={rs(floatBalance)}
          tone="blue"
          sub={
            can('void') && floatAcc ? (
              <button
                className="text-brand-700 hover:underline"
                onClick={() => {
                  const v = prompt(`Current ${provider} balance in your retailer account (Rs):`, String(floatBalance / 100));
                  if (v !== null && v.trim() !== '' && Number.isFinite(Number(v)))
                    run(() => adjustAccount(floatAcc.id, Math.round(Number(v) * 100) - floatBalance, 'Balance set manually'), 'Balance updated');
                }}
              >
                Set balance
              </button>
            ) : (
              'E-money in your retailer account'
            )
          }
        />
        <Stat label="Today: cash in / out" value={`${rs(s?.cashIn ?? 0)} / ${rs(s?.cashOut ?? 0)}`} sub={`${s?.count ?? 0} transactions · volume ${rs(s?.volume ?? 0)}`} />
        <Stat label="Today's commission + fees" value={rs((s?.commission ?? 0) + (s?.fees ?? 0))} tone="green" />
        <Stat label="This month's commission + fees" value={rs((data?.month.commission ?? 0) + (data?.month.fees ?? 0))} tone="green" />
      </div>

      <div className="grid gap-4 lg:grid-cols-[380px_1fr]">
        <div className="space-y-4">
          <Card title="New transaction">
            <div className="grid gap-3 p-4">
              <div className="grid grid-cols-2 gap-2">
                {(Object.keys(SERVICE_TYPES) as ServiceType[]).map((k) => (
                  <Button key={k} size="sm" variant={type === k ? 'primary' : 'secondary'} onClick={() => setType(k)}>
                    {SERVICE_TYPES[k].label}
                  </Button>
                ))}
              </div>
              <p className="rounded-lg bg-slate-50 p-2 text-xs text-slate-600">
                {t.cashSign > 0
                  ? `Customer gives you cash; your ${provider} balance goes down.`
                  : `You give the customer cash; your ${provider} balance goes up.`}
              </p>
              <Field label="Amount (Rs)">
                <MoneyInput className="text-lg" value={amount} onChange={setAmount} autoFocus />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Fee from customer (cash)" hint={type === 'cash_in'
                  ? `${rs(settings?.retailerCashInFee ?? 1_000)} per started ${rs(settings?.retailerCashInStep ?? 100_000)}`
                  : type === 'cash_out'
                    ? `${rs(settings?.retailerCashOutFee ?? 1_000)} per started ${rs(settings?.retailerCashOutStep ?? 50_000)}`
                    : undefined}>
                  <MoneyInput value={fee} onChange={setFee} />
                </Field>
                <Field label={`Commission from ${provider}`}>
                  <MoneyInput value={commission} onChange={setCommission} />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Mobile no.">
                  <Input value={mobile} onChange={(e) => setMobile(e.target.value)} placeholder="03xx…" />
                </Field>
                <Field label="Transaction ID">
                  <Input value={ref} onChange={(e) => setRef(e.target.value)} />
                </Field>
              </div>
              <Button disabled={amount <= 0} onClick={save}>
                Save {SERVICE_TYPES[type].label}
              </Button>
            </div>
          </Card>
          <Card title="Daily check (reconciliation)">
            <div className="grid gap-3 p-4 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500">Expected {provider} balance</span>
                <b>{rs(floatBalance)}</b>
              </div>
              <Field label={`Actual balance shown in ${provider} app (Rs)`}>
                <MoneyInput value={counted} onChange={setCounted} />
              </Field>
              {counted > 0 && (
                <div className={cx('flex justify-between font-semibold', counted - floatBalance === 0 ? 'text-emerald-600' : 'text-rose-600')}>
                  <span>Difference</span>
                  <span>{rs(counted - floatBalance)}</span>
                </div>
              )}
              <Button
                variant="secondary"
                disabled={counted <= 0 || !floatAcc}
                onClick={() =>
                  run(async () => {
                    const diff = counted - floatBalance;
                    const note = diff !== 0 ? prompt(`Difference of ${rs(diff)}. Explain (optional):`) ?? undefined : undefined;
                    await saveClosing({ accountId: floatAcc!.id, counted, note });
                    setCounted(0);
                  }, 'Reconciliation saved')
                }
              >
                Save reconciliation
              </Button>
              <p className="text-xs text-slate-500">Shop cash drawer (books): {rs(cashBalance)}. Check it on the Cash & Closing page.</p>
            </div>
          </Card>
        </div>

        <Card title={`Today's ${provider} transactions`}>
          <ListControls
            search={txnSearch}
            onSearch={setTxnSearch}
            placeholder="Search mobile or transaction ID…"
            filters={[{ label: 'Transaction type', value: txnType, options: [{ value: 'all', label: 'All types' }, ...Object.entries(SERVICE_TYPES).map(([key, service]) => ({ value: key, label: service.label }))], onChange: setTxnType }]}
            sortValue={txnSort}
            sortOptions={[{ value: 'date', label: 'Time · newest' }, { value: 'amount', label: 'Amount · highest' }, { value: 'type', label: 'Type · A–Z' }]}
            onSort={(value) => setTxnSort(value as typeof txnSort)}
          />
          {!s || s.txns.length === 0 ? (
            <Empty icon={<Smartphone size={40} />} title="No transactions today" />
          ) : visibleTxns.length === 0 ? (
            <Empty title="No matching transactions" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50">
                  <tr>
                    <th className={th}>Time</th>
                    <th className={th}>Type</th>
                    <th className={th}>Mobile / ID</th>
                    <th className={cx(th, 'text-right')}>Amount</th>
                    <th className={cx(th, 'text-right')}>Fee + comm.</th>
                    <th className={th} />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {visibleTxns.map((x) => (
                      <tr key={x.id}>
                        <td className={cx(td, 'whitespace-nowrap text-slate-600')}>{fmtDateTime(x.date)}</td>
                        <td className={td}>
                          <Badge tone={SERVICE_TYPES[x.type].cashSign > 0 ? 'green' : 'amber'}>{SERVICE_TYPES[x.type].label}</Badge>
                        </td>
                        <td className={cx(td, 'text-slate-600')}>
                          {x.mobile}
                          {x.ref && <div className="text-xs">{x.ref}</div>}
                        </td>
                        <td className={cx(td, 'text-right tabular-nums')}>{rs(x.amount)}</td>
                        <td className={cx(td, 'text-right tabular-nums text-emerald-600')}>{rs(x.fee + x.commission)}</td>
                        <td className={td}>
                          {can('void') && (
                            <button
                              className="rounded p-1 text-slate-400 hover:text-rose-600"
                              onClick={() => confirm('Delete this transaction? Balances will be reversed.') && run(() => deleteServiceTxn(x.id), 'Deleted')}
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
