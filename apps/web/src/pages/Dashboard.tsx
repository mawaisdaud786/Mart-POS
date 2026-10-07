import { AlertTriangle, ArrowRight, CalendarDays, CheckCircle2, FileBarChart2, Lightbulb, Package, ShoppingCart, TrendingDown, TrendingUp, Truck, Users, Wallet } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { Button, Card, cx } from '../components/ui';
import { db } from '../lib/db';
import { dayKey, daysAgo, rangeIso, rs } from '../lib/format';
import { accountBalances, dailySales, partyBalances, productPerformance, profitSummary, reorderReport, salesSummary, stockValue, type ProductPerformance } from '../lib/reports';
import { buildOwnerAlerts } from '../lib/owner-alerts';
import { buildShopRecommendations } from '../lib/shop-advisor';
import { BusinessQuestionPanel } from '../components/BusinessQuestionPanel';
import { UpcomingDemandPanel } from '../components/UpcomingDemandPanel';
import { useSession } from '../lib/session';
import { useLiveQuery } from '../lib/store';

export function Dashboard() {
  const { settings, has } = useSession();
  const [productRank, setProductRank] = useState<'qty' | 'revenue' | 'profit'>('profit');
  const canSeeProductProfit = has('reports.profit') || has('dashboard.owner');
  const canSeeStock = has('inventory.view') || has('reports.inventory') || has('dashboard.owner');
  const canSeeSalesTrend = has('reports.sales') || has('sales.view_all') || has('dashboard.owner');
  const today = dayKey();
  const yesterday = daysAgo(1);
  const sameWeekdayLastWeek = daysAgo(7);
  const data = useLiveQuery(async () => {
    const salesDays = Array.from({ length: 7 }, (_, index) => daysAgo(6 - index));
    const salesRanges = salesDays.map((day) => rangeIso(day, day) as [string, string]);
    const [todayP, yesterdayP, lastWeekdayP, todaySales, weekP, prevWeekP, accounts, receivables, payables, products, reorder, closings, customers, performance, weeklySales] = await Promise.all([
      profitSummary(today, today),
      profitSummary(yesterday, yesterday),
      profitSummary(sameWeekdayLastWeek, sameWeekdayLastWeek),
      salesSummary(today, today),
      profitSummary(daysAgo(6), today),
      profitSummary(daysAgo(13), daysAgo(7)),
      accountBalances(),
      partyBalances('customer'),
      partyBalances('supplier'),
      db.products.toArray(),
      canSeeStock
        ? reorderReport(settings?.leadDays ?? 2, {
            coverDays: settings?.stockReorderCoverDays ?? 7,
            salesVelocityDays: settings?.stockSalesVelocityDays ?? 30,
            safetyStockDays: settings?.stockSafetyDays ?? 2,
            lowStockDaysThreshold: settings?.stockLowDaysThreshold ?? 3,
          })
        : Promise.resolve([]),
      db.closings.where('date').aboveOrEqual(new Date(`${today}T00:00:00`).toISOString()).toArray(),
      db.customers.toArray(),
      canSeeProductProfit
        ? productPerformance(daysAgo(29), today, settings?.minimumMarginPct ?? 5)
        : Promise.resolve([]),
      canSeeSalesTrend ? dailySales(salesRanges) : Promise.resolve([]),
    ]);
    const overLimit = customers.filter((c) => c.creditLimit > 0 && (receivables.get(c.id) ?? 0) > c.creditLimit);
    return { todayP, yesterdayP, lastWeekdayP, todaySales, weekP, prevWeekP, accounts, receivables, payables, products, reorder, closings, overLimit, performance, weeklySales, salesDays };
  }, [today, yesterday, sameWeekdayLastWeek, settings?.leadDays, settings?.minimumMarginPct, canSeeProductProfit, canSeeStock, canSeeSalesTrend, settings?.stockReorderCoverDays, settings?.stockSalesVelocityDays, settings?.stockSafetyDays, settings?.stockLowDaysThreshold]);

  if (!data) return null;
  const { todayP, yesterdayP, lastWeekdayP, todaySales, weekP, prevWeekP, accounts, receivables, payables, products, reorder, closings, overLimit, performance, weeklySales, salesDays } = data;
  const sum = (m: Map<string, number>) => [...m.values()].filter((v) => v > 0).reduce((s, v) => s + v, 0);
  const orderNow = reorder.filter((r) => r.status === 'order_now');
  const soon = reorder.filter((r) => r.status === 'reorder_soon');
  const slowMoving = reorder.filter((r) => r.product.stock > 0 && (r.lastSaleDays === null || (r.lastSaleDays ?? 0) >= (settings?.stockSlowMovingDays ?? 30)));
  const overstock = reorder.filter((r) => r.avgDaily > 0 && r.product.stock > r.avgDaily * (settings?.stockOverstockDays ?? 60));
  const growth = prevWeekP.revenue > 0 ? ((weekP.revenue - prevWeekP.revenue) / prevWeekP.revenue) * 100 : null;
  const cashAcc = accounts.find((a) => a.type === 'cash');

  const negative = products.filter((p) => p.active && p.stock < 0);
  const bigDiff = closings.find((c) => Math.abs(c.difference) >= (settings?.discrepancyLimit ?? 50000));
  const belowCost = performance.filter((product) => product.belowCost);
  const lowMargin = performance.filter((product) => product.lowMargin);
  const alerts = buildOwnerAlerts({
    orderNow: orderNow.length,
    reorderSoon: soon.length,
    slowMoving: slowMoving.length,
    slowMovingDays: settings?.stockSlowMovingDays ?? 30,
    overstock: overstock.length,
    overstockDays: settings?.stockOverstockDays ?? 60,
    negativeStock: negative.length,
    customersOverLimit: overLimit.length,
    supplierPayables: sum(payables),
    cashDifference: bigDiff?.difference ?? null,
    cashDifferenceLimit: settings?.discrepancyLimit ?? 50000,
    cashClosingMissing: closings.length === 0 && new Date().getHours() >= 20,
    weeklySalesGrowth: growth,
    belowCost: belowCost.length,
    lowMargin: lowMargin.length,
    minimumMarginPct: settings?.minimumMarginPct ?? 5,
  });
  const recommendations = buildShopRecommendations({
    urgentRestockCount: canSeeStock ? orderNow.length : 0,
    belowCostCount: canSeeProductProfit ? belowCost.length : 0,
    slowMovingCount: canSeeStock ? slowMoving.length : 0,
    slowMovingDays: settings?.stockSlowMovingDays ?? 30,
    overstockCount: canSeeStock ? overstock.length : 0,
    overstockDays: settings?.stockOverstockDays ?? 60,
    weeklySalesGrowthPct: growth,
    lowMarginCount: canSeeProductProfit ? lowMargin.length : 0,
    minimumMarginPct: settings?.minimumMarginPct ?? 5,
  });
  const changePct = (current: number, previous: number) => previous > 0 ? ((current - previous) / previous) * 100 : null;
  const todayLabel = new Date().toLocaleDateString('en-PK', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const weeklyMax = Math.max(0, ...weeklySales.map((point) => point.total));
  const rankedProducts = [...performance].sort((a, b) => b[productRank] - a[productRank]).slice(0, 5);
  const productGraphMax = Math.max(0, ...rankedProducts.map((product) => Math.max(0, product[productRank])));

  return (
    <div className="mx-auto max-w-[1600px] space-y-5">
      <section className="relative isolate overflow-hidden rounded-3xl bg-gradient-to-br from-[#031a13] via-[#062b1e] to-[#073b28] px-5 py-6 text-white shadow-xl shadow-emerald-950/20 sm:px-8 sm:py-8">
        <div aria-hidden="true" className="absolute -right-16 -top-28 -z-10 h-80 w-80 rounded-full border-[36px] border-white/[0.04]" />
        <div aria-hidden="true" className="absolute right-24 -bottom-40 -z-10 h-72 w-72 rounded-full bg-emerald-200/10 blur-3xl" />
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-medium text-teal-100">
              <CalendarDays size={14} /> {todayLabel}
            </div>
            <h1 className="mt-4 text-2xl font-bold tracking-tight sm:text-3xl">Assalam-o-Alaikum 👋</h1>
            <p className="mt-1 text-sm text-teal-100/80">Your shop at a glance · {settings?.shopName ?? 'RetailOS'}</p>
          </div>
          <div className="flex gap-2">
            <Link to="/pos" className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-brand-900 shadow-sm transition hover:bg-brand-50">
              <ShoppingCart size={16} /> New sale
            </Link>
            <Link to="/reports" className="inline-flex items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-white/15">
              <FileBarChart2 size={16} /> Reports
            </Link>
          </div>
        </div>
        <div className="mt-7 grid gap-5 border-t border-white/15 pt-5 sm:grid-cols-2 lg:grid-cols-4 lg:gap-7">
          <div className="lg:col-span-1">
            <div className="text-sm text-teal-100/80">Net sales today</div>
            <div className="mt-1 text-3xl font-bold tracking-tight tabular-nums sm:text-4xl">{rs(todayP.revenue)}</div>
            <div className="mt-2 text-xs text-teal-100/70">{todaySales.bills} bills · average {rs(todaySales.bills ? todaySales.total / todaySales.bills : 0)} · {todaySales.unitsSold} units</div>
          </div>
          <div className="border-white/15 sm:border-l sm:pl-5 lg:pl-7">
            <div className="text-sm text-teal-100/75">Gross profit</div>
            <div className="mt-2 text-xl font-semibold tabular-nums">{rs(todayP.grossProfit)}</div>
            <div className="mt-1 text-xs text-teal-100/65">After cost of goods</div>
          </div>
          <div className="border-white/15 sm:border-l sm:pl-5 lg:pl-7">
            <div className="text-sm text-teal-100/75">Net profit</div>
            <div className="mt-2 text-xl font-semibold tabular-nums">{rs(todayP.netProfit)}</div>
            <div className="mt-1 text-xs text-teal-100/65">Expenses {rs(todayP.expenses)}</div>
          </div>
          <div className="border-white/15 sm:border-l sm:pl-5 lg:pl-7">
            <div className="flex items-center gap-2 text-sm text-teal-100/75"><Wallet size={14} /> Cash in drawer</div>
            <div className="mt-2 text-xl font-semibold tabular-nums">{rs(cashAcc?.balance ?? 0)}</div>
            <div className="mt-1 text-xs text-teal-100/65">Expected book balance</div>
          </div>
        </div>
      </section>

      <section aria-label="Shop balances and weekly performance" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: 'Customers owe you', value: rs(sum(receivables)), note: 'Total customer credit', icon: <Users size={18} />, tint: 'bg-amber-50 text-amber-700', accent: 'border-l-amber-400', to: '/customers?focus=due' },
          { label: 'You owe suppliers', value: rs(sum(payables)), note: 'Supplier balances', icon: <Truck size={18} />, tint: 'bg-rose-50 text-rose-700', accent: 'border-l-rose-400', to: '/suppliers?focus=payables' },
          { label: 'Money in stock', value: rs(stockValue(products.filter((p) => p.active))), note: 'At average purchase cost', icon: <Package size={18} />, tint: 'bg-sky-50 text-sky-700', accent: 'border-l-sky-400', to: '/inventory?focus=stock-list' },
          {
            label: "This week's sales",
            value: rs(weekP.revenue),
            note: growth === null ? 'No sales last week to compare' : `${growth >= 0 ? '+' : ''}${growth.toFixed(0)}% vs last week`,
            icon: growth !== null && growth < 0 ? <TrendingDown size={18} /> : <TrendingUp size={18} />,
            tint: growth !== null && growth < 0 ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700',
            accent: growth !== null && growth < 0 ? 'border-l-rose-400' : 'border-l-emerald-400',
            to: '/reports?focus=weekly-sales',
          },
          ...accounts.filter((account) => account.type !== 'cash').map((account) => ({
            label: account.name,
            value: rs(account.balance),
            note: 'Account balance',
            icon: <Wallet size={18} />,
            tint: 'bg-indigo-50 text-indigo-700',
            accent: 'border-l-indigo-400',
            to: `/cash?account=${encodeURIComponent(account.id)}`,
          })),
        ].map((metric) => (
          <Link key={metric.label} to={metric.to} className={cx('block rounded-2xl border border-slate-200 border-l-4 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-800', metric.accent)}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-slate-500">{metric.label}</span>
              <span className={cx('grid h-9 w-9 place-items-center rounded-xl', metric.tint)}>{metric.icon}</span>
            </div>
            <div className="mt-3 text-xl font-bold tracking-tight text-slate-900 tabular-nums">{metric.value}</div>
            <div className="mt-1 text-xs text-slate-500">{metric.note}</div>
          </Link>
        ))}
      </section>

      <Card
        className="overflow-hidden"
        title={<span className="flex items-center gap-2"><span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-50"><TrendingUp size={17} className="text-brand-800" /></span> Weekly sales trend</span>}
        actions={<span className="text-xs font-medium text-slate-500">Completed bills · last 7 days</span>}
      >
        {!canSeeSalesTrend ? (
          <p className="p-5 text-sm text-slate-500">Sales-report permission is required to view the weekly trend.</p>
        ) : weeklySales.length === 0 ? (
          <p className="p-5 text-sm text-slate-500">No daily sales data is available for this period.</p>
        ) : (
          <div className="px-4 pb-4 pt-5 sm:px-6">
            <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
              <div>
                <div className="text-2xl font-bold tracking-tight text-slate-900 tabular-nums">{rs(weekP.revenue)}</div>
                <div className="text-xs text-slate-500">Sales total this week</div>
              </div>
              {growth !== null && (
                <span className={cx('inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold', growth >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700')}>
                  {growth >= 0 ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
                  {growth >= 0 ? '+' : ''}{growth.toFixed(0)}% vs last week
                </span>
              )}
            </div>
            <div className="flex h-40 items-end gap-2 border-b border-slate-200 px-1 sm:h-48 sm:gap-4" role="img" aria-label="Daily completed sales totals for the last seven days">
              {weeklySales.map((point, index) => {
                const height = weeklyMax > 0 ? Math.max(point.total > 0 ? 5 : 0, (point.total / weeklyMax) * 100) : 0;
                const dayLabel = new Date(`${salesDays[index]}T12:00:00`).toLocaleDateString('en-PK', { weekday: 'short' });
                return (
                  <Link to={`/reports?focus=sales-day&date=${salesDays[index]}`} aria-label={`Review sales for ${dayLabel}`} key={salesDays[index]} className="group flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-2 rounded-t-lg focus-visible:outline-2 focus-visible:outline-brand-800">
                    <span className="text-center text-[10px] font-medium text-slate-500 sm:text-xs">{point.total > 0 ? rs(point.total) : '—'}</span>
                    <div className="flex h-[68%] w-full items-end justify-center">
                      <div
                        title={`${dayLabel}: ${rs(point.total)} · ${point.count} bills`}
                        className={cx('w-full max-w-14 rounded-t-lg transition-all duration-300 group-hover:brightness-110', index === weeklySales.length - 1 ? 'bg-gradient-to-t from-brand-900 to-brand-600' : 'bg-gradient-to-t from-sky-700 to-cyan-400')}
                        style={{ height: `${height}%`, minHeight: point.total > 0 ? 5 : 0 }}
                      />
                    </div>
                    <span className={cx('pb-2 text-[11px] sm:text-xs', index === weeklySales.length - 1 ? 'font-bold text-brand-900' : 'text-slate-500')}>{dayLabel}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        )}
      </Card>

      <div className="grid items-start gap-5 lg:grid-cols-2">
        <div className="lg:col-span-2">
          <BusinessQuestionPanel
            context={{
              todaySalesPaisa: todayP.revenue,
              yesterdaySalesPaisa: yesterdayP.revenue,
              weekSalesPaisa: weekP.revenue,
              todayNetProfitPaisa: canSeeProductProfit ? todayP.netProfit : null,
              todayGrossProfitPaisa: canSeeProductProfit ? todayP.grossProfit : null,
              weekNetProfitPaisa: canSeeProductProfit ? weekP.netProfit : null,
              weekGrossProfitPaisa: canSeeProductProfit ? weekP.grossProfit : null,
              lowStockCount: canSeeStock ? orderNow.length : null,
              slowMovingCount: canSeeStock ? slowMoving.length : null,
              topProducts: canSeeProductProfit ? performance.map(({ name, qty }) => ({ name, qty })) : null,
            }}
          />
        </div>
        <div className="lg:col-span-2">
          <UpcomingDemandPanel compact />
        </div>
        <Card
          className="overflow-hidden lg:col-span-2"
          title={<span className="flex items-center gap-2"><span className="grid h-8 w-8 place-items-center rounded-lg bg-amber-50"><Lightbulb size={17} className="text-amber-600" /></span> Smart Shop Advisor</span>}
        >
          {recommendations.length === 0 ? (
            <div className="m-4 flex items-center gap-3 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-800">
              <CheckCircle2 size={19} className="shrink-0" />
              <span>There are no recommendations from the available sales and stock data yet.</span>
            </div>
          ) : (
            <ul className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
              {recommendations.map((recommendation) => (
                <li key={recommendation.id} className={cx(
                  'flex min-h-44 flex-col rounded-xl border p-4 transition hover:shadow-sm',
                  recommendation.priority === 'high' ? 'border-rose-200 bg-gradient-to-br from-rose-50/80 to-white' : recommendation.priority === 'medium' ? 'border-amber-200 bg-gradient-to-br from-amber-50/70 to-white' : 'border-emerald-200 bg-gradient-to-br from-emerald-50/70 to-white',
                )}>
                  <span className={cx(
                    'mb-2 inline-flex w-fit items-center rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide',
                    recommendation.priority === 'high' ? 'bg-rose-100 text-rose-800' : recommendation.priority === 'medium' ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800',
                  )}>
                    {recommendation.priority === 'high' ? 'High priority' : recommendation.priority === 'medium' ? 'Review' : 'Positive'}
                  </span>
                  <span className="font-semibold text-slate-900">{recommendation.title}</span>
                  <span className="mt-1.5 text-sm leading-relaxed text-slate-600">{recommendation.evidence}</span>
                  <span className="mt-3 flex-1 border-t border-slate-200/70 pt-3 text-xs leading-relaxed text-slate-500">{recommendation.nextStep}</span>
                  <Link to={recommendation.to} className="mt-3 inline-flex items-center gap-1 self-start text-sm font-semibold text-brand-700 hover:gap-2">
                    Review details <ArrowRight size={14} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <p className="border-t border-slate-100 bg-slate-50/70 px-4 py-2.5 text-xs text-slate-500">
            Recommendations use the shop’s recorded sales, stock, and configured thresholds. They never change prices, stock, or orders automatically.
          </p>
        </Card>
        <Card className="overflow-hidden" title={<span className="flex items-center gap-2"><span className="grid h-8 w-8 place-items-center rounded-lg bg-sky-50"><TrendingUp size={17} className="text-sky-700" /></span> Sales & profit comparison</span>}>
          <div className="grid gap-2 p-4 text-sm sm:grid-cols-3">
            {[
              { label: 'Today', profit: todayP, date: 'Current day', day: today },
            { label: 'Yesterday', profit: yesterdayP, date: changePct(todayP.revenue, yesterdayP.revenue), day: yesterday },
            { label: 'Same weekday last week', profit: lastWeekdayP, date: changePct(todayP.revenue, lastWeekdayP.revenue), day: sameWeekdayLastWeek },
            ].map((row) => (
            <Link key={row.label} to={`/reports?focus=sales-day&date=${row.day}`} className={cx('block rounded-xl border p-3.5 transition hover:border-brand-700 hover:shadow-sm focus-visible:outline-2 focus-visible:outline-brand-800', row.label === 'Today' ? 'border-teal-200 bg-teal-50/70' : 'border-slate-200 bg-slate-50/80')}>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{row.label}</div>
                <div className="mt-2 text-lg font-bold tracking-tight text-slate-900">{rs(row.profit.revenue)}</div>
                <div className="text-xs text-slate-500">Net sales</div>
                <div className="mt-3 flex items-baseline justify-between gap-2 border-t border-slate-200/80 pt-2">
                  <span className="text-xs text-slate-500">Gross profit</span>
                  <span className="text-sm font-semibold text-emerald-700">{rs(row.profit.grossProfit)}</span>
                </div>
                {typeof row.date === 'number' ? (
                  <div className={cx('mt-2 flex items-center gap-1 text-xs font-semibold', row.date >= 0 ? 'text-emerald-700' : 'text-rose-700')}>
                    {row.date >= 0 ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
                    {row.date >= 0 ? '+' : ''}{row.date.toFixed(0)}% sales vs today
                  </div>
                ) : <div className="mt-2 text-xs text-slate-400">Current day</div>}
              </Link>
            ))}
          </div>
        </Card>
        <Card className="overflow-hidden" title={<span className="flex items-center gap-2"><span className="grid h-8 w-8 place-items-center rounded-lg bg-emerald-50"><Package size={17} className="text-emerald-700" /></span> Product performance <span className="text-xs font-normal text-slate-400">30 days</span></span>}>
          <div className="flex flex-wrap gap-2 border-b border-slate-100 bg-slate-50/70 px-4 py-3">
            {([
              ['qty', 'By units'],
              ['revenue', 'By sales'],
              ['profit', 'By profit'],
            ] as const).map(([rank, label]) => (
              <Button key={rank} size="sm" variant={productRank === rank ? 'primary' : 'secondary'} onClick={() => setProductRank(rank)}>
                {label}
              </Button>
            ))}
          </div>
          {performance.length === 0 ? (
            <p className="p-5 text-sm text-slate-500">{canSeeProductProfit ? 'No active products to analyze yet.' : 'Profit-report permission is required for product profit and margin analysis.'}</p>
          ) : (
            <div className="space-y-4 p-4">
              <div className="space-y-3" role="group" aria-label={`Top products ranked by ${productRank}`}>
                {rankedProducts.map((product, index) => {
                  const value = product[productRank];
                  const width = productGraphMax > 0 ? Math.max(value > 0 ? 3 : 0, (Math.max(0, value) / productGraphMax) * 100) : 0;
                  return (
                    <Link key={product.productId} to={`/reports?focus=product-performance&productId=${encodeURIComponent(product.productId)}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 rounded-lg hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-brand-800">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className={cx('grid h-6 w-6 shrink-0 place-items-center rounded-md text-[11px] font-bold', index === 0 ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-500')}>{index + 1}</span>
                        <span className="truncate text-sm font-medium text-slate-800">{product.name}</span>
                      </div>
                      <span className="text-xs font-semibold tabular-nums text-slate-700">{productRank === 'qty' ? `${product.qty} units` : rs(value)}</span>
                      <div className="col-span-2 h-2 overflow-hidden rounded-full bg-slate-100">
                        <div className={cx('h-full rounded-full transition-all', index === 0 ? 'bg-gradient-to-r from-brand-900 to-brand-600' : 'bg-gradient-to-r from-sky-600 to-cyan-400')} style={{ width: `${width}%` }} />
                      </div>
                    </Link>
                  );
                })}
              </div>
              <div className="border-t border-slate-100 pt-3">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Product details</div>
                <ul className="divide-y divide-slate-100">
                  {rankedProducts.slice(0, 3).map((product) => (
                    <li key={product.productId}>
                      <Link to={`/reports?focus=product-performance&productId=${encodeURIComponent(product.productId)}`} className="flex items-center justify-between gap-3 py-2 text-xs hover:text-brand-900">
                      <span className="min-w-0 truncate text-slate-600">{product.name} · {product.qty} sold</span>
                      <span className="shrink-0 font-medium text-slate-700">{product.historicalMarginPercent.toFixed(1)}% margin</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </Card>
        <Card className="overflow-hidden" title={<span className="flex items-center gap-2"><span className="grid h-8 w-8 place-items-center rounded-lg bg-rose-50"><AlertTriangle size={17} className="text-rose-600" /></span> Price & margin review</span>}>
          {!canSeeProductProfit ? (
            <p className="p-5 text-sm text-slate-500">Profit-report permission is required to view price and margin warnings.</p>
          ) : belowCost.length + lowMargin.length === 0 ? (
            <div className="m-4 flex items-center gap-3 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-800"><CheckCircle2 size={18} /> No products are below cost or under the configured margin.</div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {[...belowCost, ...lowMargin.filter((product) => !product.belowCost)].slice(0, 8).map((product: ProductPerformance) => (
                <li key={product.productId}>
                  <Link to={`/products?focus=product&productId=${encodeURIComponent(product.productId)}`} className="flex items-center justify-between gap-3 px-4 py-3 transition hover:bg-slate-50/80">
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{product.name}</span>
                    <span className="text-xs text-slate-500">Cost {rs(product.currentCost)} · sale {rs(product.salePrice)}</span>
                  </span>
                  <span className={cx('shrink-0 rounded-full px-2.5 py-1 text-right text-xs font-bold', product.belowCost ? 'bg-rose-100 text-rose-800' : 'bg-amber-100 text-amber-800')}>
                    {product.belowCost ? `LOSS ${rs(product.currentProfitPerUnit)}/unit` : `${product.currentMarginPercent.toFixed(1)}% margin`}
                  </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <p className="border-t border-slate-100 bg-slate-50/70 px-4 py-2.5 text-xs text-slate-500">Uses current weighted-average product cost and actual 30-day sale history. Review prices manually; nothing changes automatically.</p>
        </Card>
        <Card className="overflow-hidden" title={<span className="flex items-center gap-2"><span className="grid h-8 w-8 place-items-center rounded-lg bg-amber-50"><AlertTriangle size={17} className="text-amber-600" /></span> What needs my attention? {alerts.length > 0 && <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-bold text-rose-700">{alerts.length}</span>}</span>}>
          {alerts.length === 0 ? (
            <div className="m-4 flex items-center gap-3 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-800">
              <CheckCircle2 size={18} /> All good — nothing urgent right now.
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {alerts.map((alert) => (
              <li key={alert.id}>
                <Link to={alert.to} className="group flex items-center gap-3 px-4 py-3 text-sm transition hover:bg-slate-50">
                  <span className={cx(
                    'grid h-8 w-8 shrink-0 place-items-center rounded-lg',
                    alert.severity === 'urgent' ? 'bg-rose-50 text-rose-600' : alert.severity === 'attention' ? 'bg-amber-50 text-amber-600' : 'bg-emerald-50 text-emerald-600',
                  )} />
                  <span className="flex-1">
                    <span className="block font-semibold text-slate-800">{alert.title}</span>
                    <span className="text-xs text-slate-500">{alert.detail}</span>
                  </span>
                  <ArrowRight size={15} className="text-slate-400 transition group-hover:translate-x-1 group-hover:text-brand-700" />
                </Link>
              </li>
              ))}
            </ul>
          )}
        </Card>
        <Card
          className="overflow-hidden"
          title={
            <span className="flex items-center gap-2">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-rose-50"><Package size={17} className="text-rose-600" /></span> Stock to watch
            </span>
          }
          actions={
            <Link to="/inventory?focus=order-now" className="text-sm text-brand-700 hover:underline">
              Order planner
            </Link>
          }
        >
          {orderNow.length + soon.length === 0 ? (
            <p className="p-4 text-sm text-slate-500">            Stock levels look healthy. No products are running low.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {[...orderNow, ...soon].slice(0, 8).map((r) => (
                <li key={r.product.id}>
                  <Link to={`/inventory?focus=product&productId=${encodeURIComponent(r.product.id)}`} className="flex items-center justify-between gap-3 px-4 py-3 transition hover:bg-slate-50/80">
                  <span className="flex min-w-0 items-center gap-3">
                    <span className={cx('h-2.5 w-2.5 shrink-0 rounded-full', r.status === 'order_now' ? 'bg-rose-500' : 'bg-amber-500')} />
                    <span className="truncate font-medium text-slate-800">{r.product.name}</span>
                  </span>
                  <span className="shrink-0 text-right text-xs text-slate-500">
                    {r.product.stock} {r.product.unit} left
                    {r.daysLeft !== null && ` · ~${Math.floor(r.daysLeft)} days`}
                    {r.reorderBy && ` · order ${r.reorderBy}`}
                  </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
