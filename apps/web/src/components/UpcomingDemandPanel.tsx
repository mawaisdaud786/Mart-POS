import { ArrowRight, CalendarDays, Sparkles } from 'lucide-react';
import { Link } from 'react-router';
import { Badge, Card, cx } from './ui';
import { db, type Sale } from '../lib/db';
import { dayKey, rangeIso, qty } from '../lib/format';
import { useSession } from '../lib/session';
import { useLiveQuery } from '../lib/store';
import {
  buildUpcomingDemandInsights,
  getComparableSalesWindow,
  getRecentSalesWindow,
  getUpcomingPakistanEvents,
  type UpcomingDemandInsight,
  type UpcomingEvent,
} from '../lib/upcoming-demand';

function salesInRange(from: string, to: string): Promise<Sale[]> {
  const [start, end] = rangeIso(from, to);
  return db.sales.where('date').between(start, end, true, true).toArray();
}

function eventDate(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString('en-PK', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function EventInsight({ insight }: { insight: UpcomingDemandInsight }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-3.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h4 className="font-semibold text-slate-900">{insight.event.title}</h4>
          <p className="mt-0.5 text-xs text-slate-500">
            {insight.event.kind === 'season' ? 'Planning window starts' : 'Date'}: {eventDate(insight.event.date)}
            {insight.daysUntil === 0 ? ' · today / in season' : ` · ${insight.daysUntil} days`}
          </p>
        </div>
        <Badge tone={insight.event.dateConfidence === 'estimate' ? 'amber' : 'default'}>
          {insight.event.dateConfidence === 'estimate' ? 'Date estimate' : insight.event.kind === 'season' ? 'Season window' : 'Annual date'}
        </Badge>
      </div>
      {insight.event.dateConfidence === 'estimate' && (
        <p className="mt-2 text-xs text-amber-800">{insight.event.dateNote}</p>
      )}

      {insight.productsToReview.length > 0 && (
        <div className="mt-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Existing products · shop evidence</p>
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-100">
            {insight.productsToReview.slice(0, 4).map((item) => (
              <li key={item.product.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <div className="min-w-0">
                  <Link to={`/inventory?focus=product&productId=${encodeURIComponent(item.product.id)}`} className="truncate text-sm font-medium text-brand-800 hover:underline">
                    {item.product.name}
                  </Link>
                  <p className="text-xs text-slate-500">{item.evidence}</p>
                </div>
                <div className="text-right text-xs text-slate-600">
                  <Badge tone={item.confidence === 'strong' ? 'green' : 'blue'}>{item.confidence} evidence</Badge>
                  <p className="mt-1">
                    Stock {qty(item.currentStock)} · advisory top-up <strong>{qty(item.suggestedQty)}</strong> {item.product.unit}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {insight.catalogProductsWithoutSales.length > 0 && (
        <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs font-semibold text-slate-800">Relevant products already in your catalog · no matching sales history</p>
          <p className="mt-1 text-xs text-slate-600">
            These names match the event/season, but the checked sales periods do not support a quantity estimate:
            {' '}{insight.catalogProductsWithoutSales.slice(0, 5).join(', ')}.
          </p>
        </div>
      )}

      {insight.generalOpportunities.length > 0 && (
        <div className="mt-3 rounded-lg bg-amber-50 p-3">
          <p className="text-xs font-semibold text-amber-950">Potential new products · general ideas, not a shop forecast</p>
          <ul className="mt-1 list-inside list-disc text-sm text-amber-900">
            {insight.generalOpportunities.slice(0, 3).map((idea) => <li key={idea}>{idea}</li>)}
          </ul>
        </div>
      )}

      {insight.productsToReview.length === 0 && insight.generalOpportunities.length === 0 && insight.catalogProductsWithoutSales.length === 0 && (
        <p className="mt-3 text-sm text-slate-500">No relevant catalog matches or event-specific new-product ideas were found for this window.</p>
      )}
    </section>
  );
}

export function UpcomingDemandPanel({ compact = false }: { compact?: boolean }) {
  const { has } = useSession();
  const today = dayKey();
  const canReadCatalog = ['inventory.view', 'products.view', 'reports.inventory', 'dashboard.owner'].some(has);
  const canReadSales = ['sales.view_all', 'sales.view_own', 'reports.sales', 'dashboard.owner'].some(has);
  const data = useLiveQuery(async () => {
    const events: UpcomingEvent[] = getUpcomingPakistanEvents(today, 180).slice(0, compact ? 3 : 4);
    const [products, categories, recentSales] = await Promise.all([
      canReadCatalog ? db.products.toArray().catch(() => []) : Promise.resolve([]),
      canReadCatalog ? db.categories.toArray().catch(() => []) : Promise.resolve([]),
      canReadSales
        ? salesInRange(getRecentSalesWindow(today).from, today).catch(() => [])
        : Promise.resolve([]),
    ]);
    const history = canReadSales
      ? await Promise.all(events.map((event) => {
          const window = getComparableSalesWindow(event);
          return salesInRange(window.from, window.to).catch(() => []);
        }))
      : events.map(() => [] as Sale[]);
    const comparableSalesByEvent = Object.fromEntries(events.map((event, index) => [event.id, history[index] ?? []]));
    return {
      events,
      insights: buildUpcomingDemandInsights({ today, events, products, categories, recentSales, comparableSalesByEvent }),
    };
  }, [today, compact, canReadCatalog, canReadSales]);

  const events = data?.events ?? [];
  const insights = data?.insights ?? [];
  const canShowEvidence = canReadSales && canReadCatalog;

  return (
    <Card
      className="overflow-hidden"
      title={<span className="flex items-center gap-2"><span className="grid h-8 w-8 place-items-center rounded-lg bg-amber-50"><CalendarDays size={17} className="text-amber-700" /></span> Upcoming demand & events</span>}
      actions={<span className="text-xs font-medium text-slate-500">Pakistan calendar · next 180 days</span>}
    >
      <div className={cx('grid gap-3 p-4', compact ? 'xl:grid-cols-2' : 'lg:grid-cols-2')}>
        {insights.length > 0 ? insights.map((insight) => <EventInsight key={insight.event.id} insight={insight} />) : (
          <p className="text-sm text-slate-500">No seasonal windows or events are scheduled in the next six months.</p>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 bg-slate-50/70 px-4 py-3 text-xs text-slate-600">
        <span className="inline-flex items-center gap-1.5">
          <Sparkles size={14} className="text-amber-700" />
          {canShowEvidence
            ? 'Rule-based estimates use recent 28-day sales, a comparable prior-year window, catalog matches and current stock.'
            : 'Calendar suggestions are general because this account cannot read both catalog and sales history.'}
          {' '}No AI provider is configured.
        </span>
        <span className="inline-flex items-center gap-1 font-medium text-slate-700">
          Advisory only: no stock, purchase or catalog changes are made. <ArrowRight size={13} />
          Owner approval is required for any changes.
        </span>
      </div>
    </Card>
  );
}
