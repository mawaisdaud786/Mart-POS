import { useLiveQuery } from 'dexie-react-hooks';
import { AlertTriangle, ArrowRight, CheckCircle2, TrendingDown, TrendingUp } from 'lucide-react';
import { Link } from 'react-router';
import { Card, PageHeader, Stat, cx } from '../components/ui';
import { db } from '../lib/db';
import { dayKey, daysAgo, rs } from '../lib/format';
import { accountBalances, partyBalances, profitSummary, reorderReport, stockValue } from '../lib/reports';
import { useSession } from '../lib/session';

export function Dashboard() {
  const { settings } = useSession();
  const today = dayKey();
  const data = useLiveQuery(async () => {
    const [todayP, weekP, prevWeekP, accounts, receivables, payables, products, reorder, closings, customers] = await Promise.all([
      profitSummary(today, today),
      profitSummary(daysAgo(6), today),
      profitSummary(daysAgo(13), daysAgo(7)),
      accountBalances(),
      partyBalances('customer'),
      partyBalances('supplier'),
      db.products.toArray(),
      reorderReport(settings?.leadDays ?? 2),
      db.closings.where('date').aboveOrEqual(new Date(`${today}T00:00:00`).toISOString()).toArray(),
      db.customers.toArray(),
    ]);
    const overLimit = customers.filter((c) => c.creditLimit > 0 && (receivables.get(c.id) ?? 0) > c.creditLimit);
    return { todayP, weekP, prevWeekP, accounts, receivables, payables, products, reorder, closings, overLimit };
  }, [today, settings?.leadDays]);

  if (!data) return null;
  const { todayP, weekP, prevWeekP, accounts, receivables, payables, products, reorder, closings, overLimit } = data;
  const sum = (m: Map<string, number>) => [...m.values()].filter((v) => v > 0).reduce((s, v) => s + v, 0);
  const orderNow = reorder.filter((r) => r.status === 'order_now');
  const soon = reorder.filter((r) => r.status === 'reorder_soon');
  const growth = prevWeekP.revenue > 0 ? ((weekP.revenue - prevWeekP.revenue) / prevWeekP.revenue) * 100 : null;
  const cashAcc = accounts.find((a) => a.type === 'cash');

  const alerts: { tone: 'red' | 'amber' | 'green'; text: string; to: string }[] = [];
  if (orderNow.length) alerts.push({ tone: 'red', text: `${orderNow.length} products need ordering now (may run out soon).`, to: '/inventory' });
  if (soon.length) alerts.push({ tone: 'amber', text: `${soon.length} products are below their reorder point.`, to: '/inventory' });
  const negative = products.filter((p) => p.active && p.stock < 0);
  if (negative.length) alerts.push({ tone: 'red', text: `${negative.length} products show negative stock — check counts.`, to: '/inventory' });
  if (overLimit.length) alerts.push({ tone: 'amber', text: `${overLimit.length} customers are over their credit limit.`, to: '/customers' });
  if (sum(payables) > 0) alerts.push({ tone: 'amber', text: `You owe suppliers ${rs(sum(payables))} in total.`, to: '/suppliers' });
  const bigDiff = closings.find((c) => Math.abs(c.difference) >= (settings?.discrepancyLimit ?? 50000));
  if (bigDiff) alerts.push({ tone: 'red', text: `Cash difference of ${rs(bigDiff.difference)} at today's closing.`, to: '/cash' });
  if (closings.length === 0 && new Date().getHours() >= 20) alerts.push({ tone: 'amber', text: 'Daily cash closing not done yet.', to: '/cash' });
  if (growth !== null && growth > 0) alerts.push({ tone: 'green', text: `Sales up ${growth.toFixed(0)}% this week vs last week.`, to: '/reports' });

  return (
    <div>
      <PageHeader title={`Assalam-o-Alaikum 👋`} subtitle={`Here is ${settings?.shopName ?? 'your shop'} today`} />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Today's sales" value={rs(todayP.revenue)} sub={`${todayP.salesCount} bills · udhaar ${rs(todayP.creditSales)}`} />
        <Stat label="Today's gross profit" value={rs(todayP.grossProfit)} tone="green" sub={`Cost of goods ${rs(todayP.cogs)}`} />
        <Stat
          label="Today's net profit"
          value={rs(todayP.netProfit)}
          tone={todayP.netProfit >= 0 ? 'green' : 'red'}
          sub={`Expenses ${rs(todayP.expenses)} · Easypaisa income ${rs(todayP.serviceIncome)}`}
        />
        <Stat label="Cash in drawer" value={rs(cashAcc?.balance ?? 0)} tone="blue" sub="Expected by the books" />
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {accounts
          .filter((a) => a.type !== 'cash')
          .map((a) => (
            <Stat key={a.id} label={a.name} value={rs(a.balance)} />
          ))}
        <Stat label="Customers owe you" value={rs(sum(receivables))} tone="amber" sub="Total udhaar" />
        <Stat label="You owe suppliers" value={rs(sum(payables))} tone="red" />
        <Stat label="Money in stock" value={rs(stockValue(products.filter((p) => p.active)))} sub="At purchase cost" />
        <Stat
          label="This week's sales"
          value={rs(weekP.revenue)}
          sub={
            growth === null ? (
              'No sales last week to compare'
            ) : (
              <span className={cx('inline-flex items-center gap-1', growth >= 0 ? 'text-emerald-600' : 'text-rose-600')}>
                {growth >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />} {growth.toFixed(0)}% vs last week
              </span>
            )
          }
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="What needs my attention?">
          {alerts.length === 0 ? (
            <div className="flex items-center gap-2 p-4 text-sm text-emerald-700">
              <CheckCircle2 size={18} /> All good — nothing urgent right now.
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {alerts.map((a, i) => (
                <li key={i}>
                  <Link to={a.to} className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-slate-50">
                    <span className={cx('h-2.5 w-2.5 shrink-0 rounded-full', a.tone === 'red' ? 'bg-rose-500' : a.tone === 'amber' ? 'bg-amber-500' : 'bg-emerald-500')} />
                    <span className="flex-1">{a.text}</span>
                    <ArrowRight size={14} className="text-slate-400" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card
          title={
            <span className="flex items-center gap-2">
              <AlertTriangle size={16} className="text-amber-500" /> Low stock
            </span>
          }
          actions={
            <Link to="/inventory" className="text-sm text-brand-700 hover:underline">
              Order planner
            </Link>
          }
        >
          {orderNow.length + soon.length === 0 ? (
            <p className="p-4 text-sm text-slate-500">No products are running low.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {[...orderNow, ...soon].slice(0, 8).map((r) => (
                <li key={r.product.id} className="flex items-center justify-between px-4 py-2 text-sm">
                  <span>
                    {r.status === 'order_now' ? '🔴' : '🟠'} {r.product.name}
                  </span>
                  <span className="text-slate-500">
                    {r.product.stock} {r.product.unit} left
                    {r.daysLeft !== null && ` · ~${Math.floor(r.daysLeft)} days`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
