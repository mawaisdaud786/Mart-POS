import { describe, expect, it } from 'vitest';
import type { Category, Product, Sale } from './db';
import {
  buildUpcomingDemandInsights,
  getComparableSalesWindow,
  getRecentSalesWindow,
  getUpcomingPakistanEvents,
} from './upcoming-demand';

const product: Product = {
  id: 'tea-1',
  name: 'Black Tea',
  sku: 'TEA-1',
  categoryId: 'grocery',
  unit: 'Packet',
  salePrice: 100,
  cost: 70,
  stock: 2,
  reserved: 1,
  minStock: 0,
  favorite: false,
  active: true,
  createdAt: '2025-01-01T00:00:00.000Z',
};

const category: Category = { id: 'grocery', name: 'Grocery' };

function sale(id: string, date: string, qty: number, returnedQty = 0, itemProduct = product): Sale {
  return {
    id,
    no: id,
    date,
    items: [{ productId: itemProduct.id, name: itemProduct.name, unit: itemProduct.unit, qty, price: 100, discount: 0, cost: 70, returnedQty }],
    subtotal: 100,
    discount: 0,
    total: 100,
    paid: 100,
    change: 0,
    credit: 0,
    payments: [],
    userId: 'owner',
    status: 'completed',
    returnedTotal: 0,
  };
}

describe('upcoming demand calendar', () => {
  it('uses the current date for event windows and sorts the next Pakistan seasons/events', () => {
    const events = getUpcomingPakistanEvents('2026-10-07', 90);
    expect(events[0]).toMatchObject({ id: 'winter-season', date: '2026-10-15', kind: 'season', dateConfidence: 'fixed' });
    expect(events.some((event) => event.id === 'iqbal-day' && event.date === '2026-11-09')).toBe(true);
    expect(events.some((event) => event.date.startsWith('2027-'))).toBe(false);
  });

  it('keeps calculated Islamic calendar dates explicitly marked as estimates', () => {
    const events = getUpcomingPakistanEvents('2027-01-01', 180);
    const ramadan = events.find((event) => event.id === 'ramadan');
    expect(ramadan).toMatchObject({
      dateConfidence: 'estimate',
      lunar: true,
    });
    expect(ramadan?.dateNote).toContain('confirm with Pakistan moon-sighting announcement');
  });

  it('builds bounded recent and prior-year comparison windows', () => {
    expect(getRecentSalesWindow('2026-10-07')).toEqual({ from: '2026-09-10', to: '2026-10-07' });
    expect(getComparableSalesWindow({
      id: 'iqbal-day',
      title: 'Iqbal Day',
      date: '2026-11-09',
      endDate: '2026-11-09',
      kind: 'event',
      dateConfidence: 'fixed',
      dateNote: 'Fixed annual date',
      lunar: false,
      categories: [],
    })).toEqual({ from: '2025-10-26', to: '2025-11-15' });
  });
});

describe('upcoming demand recommendations', () => {
  const event = getUpcomingPakistanEvents('2026-10-07', 10).find((item) => item.id === 'winter-season')!;

  it('uses recorded sales and on-hand stock for an advisory existing-product quantity', () => {
    const insight = buildUpcomingDemandInsights({
      today: '2026-10-07',
      events: [{ ...event, date: '2026-10-10' }],
      products: [product],
      categories: [category],
      recentSales: [sale('recent', '2026-10-06', 10, 1)],
      comparableSalesByEvent: { [event.id]: [sale('prior', '2025-10-10', 20)] },
    })[0]!;

    expect(insight.productsToReview[0]).toMatchObject({
      product,
      recentQty: 9,
      comparableQty: 20,
      suggestedQty: 9,
      confidence: 'strong',
    });
    expect(insight.productsToReview[0]?.evidence).toContain('9.0 sold in the last 28 days');
    expect(insight.generalOpportunities).not.toContain('Tea, coffee and warm drinks');
  });

  it('labels a missing sales history as a general seasonal suggestion, not a shop forecast', () => {
    const insight = buildUpcomingDemandInsights({
      today: '2026-10-07',
      events: [event],
      products: [],
      categories: [],
      recentSales: [],
      comparableSalesByEvent: {},
    })[0]!;

    expect(insight.historyAvailable).toBe(false);
    expect(insight.productsToReview).toEqual([]);
    expect(insight.generalOpportunities).toContain('Peanuts (moongphali)');
  });

  it('does not invent sales demand for matching catalog products with no sales', () => {
    const insight = buildUpcomingDemandInsights({
      today: '2026-10-07',
      events: [event],
      products: [product],
      categories: [category],
      recentSales: [],
      comparableSalesByEvent: {},
    })[0]!;

    expect(insight.productsToReview).toEqual([]);
    expect(insight.catalogProductsWithoutSales).toEqual(['Black Tea']);
    expect(insight.generalOpportunities).not.toContain('Tea, coffee and warm drinks');
  });

  it('uses the whole catalog but excludes unrelated products from winter recommendations', () => {
    const peanuts: Product = { ...product, id: 'peanuts', name: 'Moongphali peanuts', stock: 3 };
    const detergent: Product = { ...product, id: 'detergent', name: 'Laundry detergent', stock: 40, categoryId: 'cleaning' };
    const rewari: Product = { ...product, id: 'rewari', name: 'Rewari pack', stock: 0 };
    const insight = buildUpcomingDemandInsights({
      today: '2026-10-07',
      events: [event],
      products: [peanuts, detergent, rewari],
      categories: [category, { id: 'cleaning', name: 'Household cleaning' }],
      recentSales: [sale('recent-peanuts', '2026-10-06', 12, 0, peanuts), sale('recent-detergent', '2026-10-06', 30, 0, detergent)],
      comparableSalesByEvent: { [event.id]: [sale('prior-peanuts', '2025-10-10', 24, 0, peanuts), sale('prior-detergent', '2025-10-10', 50, 0, detergent)] },
    })[0]!;

    expect(insight.productsToReview.map((item) => item.product.id)).toEqual(['peanuts']);
    expect(insight.catalogProductsWithoutSales).toContain('Rewari pack');
    expect(insight.generalOpportunities).not.toContain('Peanuts (moongphali)');
    expect(insight.generalOpportunities).not.toContain('Rewari');
    expect(insight.generalOpportunities).toContain('Gajak / chikki');
    expect(insight.generalOpportunities).toContain('Potato/chip sticks');
  });

  it('suggests Iqbal Day stickers/posters and omits new products already in the catalog', () => {
    const iqbalDay = getUpcomingPakistanEvents('2026-10-07', 60).find((item) => item.id === 'iqbal-day')!;
    const stickers: Product = { ...product, id: 'iqbal-sticker', name: 'Allama Iqbal Day stickers' };
    const insight = buildUpcomingDemandInsights({
      today: '2026-10-07',
      events: [iqbalDay],
      products: [stickers],
      categories: [category],
      recentSales: [],
      comparableSalesByEvent: {},
    })[0]!;

    expect(insight.generalOpportunities).not.toContain('Allama Iqbal stickers');
    expect(insight.generalOpportunities).toContain('Iqbal poetry posters');
    expect(insight.productsToReview).toEqual([]);
    expect(insight.catalogProductsWithoutSales).toEqual(['Allama Iqbal Day stickers']);
  });
});
