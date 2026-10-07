import { describe, expect, it } from 'vitest';
import { calculatePricing, type PricingSettings } from './pricing.js';

const settings: PricingSettings = {
  autoDiscountEnabled: true,
  threshold: 500_000,
  defaultPercent: 5,
  maxPercent: 70,
  categoryRules: [],
  deliveryEnabled: true,
  deliveryCharge: 20_000,
  freeDeliveryThreshold: 500_000,
  businessPricingEnabled: true,
};

describe('calculatePricing', () => {
  it('uses the pre-discount subtotal and qualifies exactly at threshold', () => {
    const result = calculatePricing({
      lines: [{ productId: 'p1', qty: 1 }],
      products: [{ id: 'p1', salePrice: 500_000 }],
      settings,
    });
    expect(result.eligibleSubtotal).toBe(500_000);
    expect(result.discountAmount).toBe(25_000);
    expect(result.total).toBe(475_000);
  });

  it('uses a category rule instead of stacking the global rate', () => {
    const result = calculatePricing({
      lines: [{ productId: 'p1', qty: 1 }],
      products: [{ id: 'p1', salePrice: 600_000, categoryId: 'grocery' }],
      settings: { ...settings, categoryRules: [{ categoryId: 'grocery', percent: 3, enabled: true }] },
    });
    expect(result.discountAmount).toBe(18_000);
  });

  it('limits an automatic threshold discount to the configured share of gross profit', () => {
    const result = calculatePricing({
      lines: [{ productId: 'p1', qty: 1 }],
      products: [{ id: 'p1', salePrice: 10_000, cost: 9_000 }],
      settings: { ...settings, threshold: 0, defaultPercent: 50, maxProfitPercent: 30 },
    });
    expect(result.discountAmount).toBe(300);
    expect(result.total).toBe(9_700);
    expect(result.lines[0]?.discountPercent).toBe(3);
  });

  it('applies both the sale-price cap and profit cap to a product threshold price', () => {
    const result = calculatePricing({
      lines: [{ productId: 'p1', qty: 1 }],
      products: [{ id: 'p1', salePrice: 600_000, cost: 500_000, thresholdPrice: 300_000 }],
      settings: { ...settings, threshold: 0, maxPercent: 70, maxProfitPercent: 30 },
    });
    expect(result.discountAmount).toBe(30_000);
    expect(result.lines[0]?.rule).toBe('product-special');
  });

  it('uses a configured per-product rupee discount and still enforces the profit cap', () => {
    const result = calculatePricing({
      lines: [{ productId: 'p1', qty: 2 }],
      products: [{ id: 'p1', salePrice: 10_000, cost: 9_000, thresholdDiscountAmount: 800 }],
      settings: { ...settings, threshold: 0, maxProfitPercent: 30 },
    });
    expect(result.discountAmount).toBe(600);
    expect(result.total).toBe(19_400);
  });

  it('uses the configured final total for an exact quantity bundle without stacking automatic discounts', () => {
    const product = {
      id: 'p1',
      salePrice: 1_500,
      quantityPrices: [
        { quantity: 1, totalPrice: 1_500 },
        { quantity: 7, totalPrice: 10_000 },
        { quantity: 10, totalPrice: 13_000 },
        { quantity: 20, totalPrice: 25_000 },
      ],
    };
    const seven = calculatePricing({
      lines: [{ productId: 'p1', qty: 7 }],
      products: [product],
      settings: { ...settings, threshold: 0, defaultPercent: 50 },
    });
    expect(seven.total).toBe(10_000);
    expect(seven.lines[0]).toMatchObject({ price: 1_500, discount: 500, rule: 'quantity-bundle' });
    expect(seven.eligibleSubtotal).toBe(0);

    const six = calculatePricing({ lines: [{ productId: 'p1', qty: 6 }], products: [product], settings });
    expect(six.total).toBe(9_000);
    expect(six.lines[0]?.rule).toBe('none');
  });

  it('keeps shopkeeper pricing ahead of quantity bundles', () => {
    const result = calculatePricing({
      lines: [{ productId: 'p1', qty: 7 }],
      products: [{
        id: 'p1',
        salePrice: 1_500,
        cost: 1_000,
        wholesalePrice: 1_200,
        quantityPrices: [{ quantity: 7, totalPrice: 10_000 }],
      }],
      settings,
      pricingMode: 'business',
    });
    expect(result.total).toBe(7_000);
    expect(result.lines[0]?.rule).toBe('business');
  });

  it('does not include products marked as discount-ineligible in qualification or discounts', () => {
    const result = calculatePricing({
      lines: [{ productId: 'p1', qty: 1 }, { productId: 'p2', qty: 1 }],
      products: [
        { id: 'p1', salePrice: 600_000, cost: 500_000, thresholdDiscountEnabled: false },
        { id: 'p2', salePrice: 600_000, cost: 500_000 },
      ],
      settings: { ...settings, threshold: 600_000, defaultPercent: 10, maxProfitPercent: 30 },
    });
    expect(result.eligibleSubtotal).toBe(600_000);
    expect(result.discountAmount).toBe(30_000);
    expect(result.lines[0]?.discount).toBe(0);
  });

  it('keeps an explicitly excluded category at regular price', () => {
    const result = calculatePricing({
      lines: [{ productId: 'p1', qty: 1 }],
      products: [{ id: 'p1', salePrice: 600_000, categoryId: 'drinks' }],
      settings: { ...settings, categoryRules: [{ categoryId: 'drinks', percent: 0, enabled: false }] },
    });
    expect(result.discountAmount).toBe(0);
  });

  it('excludes categories without a configured rule when category rules are active', () => {
    const result = calculatePricing({
      lines: [{ productId: 'p1', qty: 1 }, { productId: 'p2', qty: 1 }],
      products: [
        { id: 'p1', salePrice: 600_000, categoryId: 'grocery' },
        { id: 'p2', salePrice: 1_000_000, categoryId: 'household' },
      ],
      settings: { ...settings, threshold: 500_000, categoryRules: [{ categoryId: 'grocery', percent: 5, enabled: true }] },
    });
    expect(result.eligibleSubtotal).toBe(600_000);
    expect(result.discountAmount).toBe(30_000);
  });

  it('does not let excluded category value trigger the threshold', () => {
    const result = calculatePricing({
      lines: [{ productId: 'p1', qty: 1 }, { productId: 'p2', qty: 1 }],
      products: [
        { id: 'p1', salePrice: 200_000, categoryId: 'grocery' },
        { id: 'p2', salePrice: 1_000_000, categoryId: 'household' },
      ],
      settings: { ...settings, categoryRules: [{ categoryId: 'grocery', percent: 5, enabled: true }] },
    });
    expect(result.eligibleSubtotal).toBe(200_000);
    expect(result.discountAmount).toBe(0);
  });

  it('does not qualify one paisa below threshold', () => {
    const result = calculatePricing({
      lines: [{ productId: 'p1', qty: 1 }],
      products: [{ id: 'p1', salePrice: 499_999 }],
      settings,
    });
    expect(result.discountAmount).toBe(0);
  });

  it('keeps totals finite when older or incomplete settings contain invalid numbers', () => {
    const result = calculatePricing({
      lines: [{ productId: 'p1', qty: 1 }],
      products: [{ id: 'p1', salePrice: 600_000 }],
      settings: {
        ...settings,
        threshold: Number.NaN,
        defaultPercent: Number.NaN,
        maxPercent: Number.NaN,
        categoryRules: undefined,
      } as unknown as PricingSettings,
    });
    expect(Number.isFinite(result.total)).toBe(true);
    expect(result.discountAmount).toBe(60_000);
    expect(result.total).toBe(540_000);
  });

  it('charges delivery below the free-delivery threshold and waives it at threshold', () => {
    const below = calculatePricing({
      lines: [{ productId: 'p1', qty: 1 }],
      products: [{ id: 'p1', salePrice: 499_999 }],
      settings: { ...settings, threshold: 800_000 },
      homeDelivery: true,
    });
    const at = calculatePricing({
      lines: [{ productId: 'p1', qty: 1 }],
      products: [{ id: 'p1', salePrice: 500_000 }],
      settings: { ...settings, threshold: 800_000 },
      homeDelivery: true,
    });
    expect(below.deliveryCharge).toBe(20_000);
    expect(at.deliveryCharge).toBe(0);
  });

  it('uses product special price ahead of category and global rules', () => {
    const result = calculatePricing({
      lines: [{ productId: 'p1', qty: 1 }],
      products: [{ id: 'p1', salePrice: 5_000, thresholdPrice: 4_700, categoryId: 'grocery' }],
      settings: { ...settings, threshold: 5_000, categoryRules: [{ categoryId: 'grocery', percent: 3, enabled: true }] },
    });
    expect(result.lines[0]!.price).toBe(5_000);
    expect(result.lines[0]!.discount).toBe(300);
    expect(result.lines[0]!.rule).toBe('product-special');
  });

  it('removes automatic discount on credit and applies delivery only when opted in', () => {
    const base = { lines: [{ productId: 'p1', qty: 1 }], products: [{ id: 'p1', salePrice: 600_000 }], settings };
    const credit = calculatePricing({ ...base, paymentMethod: 'credit', homeDelivery: false });
    const delivery = calculatePricing({ ...base, homeDelivery: true });
    expect(credit.discountAmount).toBe(0);
    expect(credit.deliveryCharge).toBe(0);
    expect(delivery.deliveryCharge).toBe(0);
  });

  it('does not stack normal threshold discount on business rate', () => {
    const result = calculatePricing({
      lines: [{ productId: 'p1', qty: 1 }],
      products: [{ id: 'p1', salePrice: 600_000, wholesalePrice: 550_000 }],
      settings,
      pricingMode: 'business',
    });
    expect(result.lines[0]!.price).toBe(550_000);
    expect(result.discountAmount).toBe(0);
  });

  it('uses purchase cost as the shopkeeper-rate fallback when no wholesale price is set', () => {
    const result = calculatePricing({
      lines: [{ productId: 'p1', qty: 2 }],
      products: [{ id: 'p1', salePrice: 600_000, cost: 425_000 }],
      settings,
      pricingMode: 'business',
    });
    expect(result.lines[0]).toMatchObject({ price: 425_000, discount: 0, rule: 'business' });
    expect(result.subtotal).toBe(850_000);
    expect(result.discountAmount).toBe(0);
  });

  it('prefers an authorized purchase cost over wholesale price in shopkeeper mode', () => {
    const result = calculatePricing({
      lines: [{ productId: 'p1', qty: 1 }],
      products: [{ id: 'p1', salePrice: 600_000, cost: 425_000, wholesalePrice: 550_000 }],
      settings,
      pricingMode: 'business',
    });
    expect(result.lines[0]!.price).toBe(425_000);
    expect(result.discountAmount).toBe(0);
  });

  it('uses the recorded product cost with no automatic discounts in cost pricing mode', () => {
    const result = calculatePricing({
      lines: [{ productId: 'p1', qty: 2 }],
      products: [{ id: 'p1', salePrice: 600_000, cost: 425_000, wholesalePrice: 550_000 }],
      settings,
      pricingMode: 'cost',
    });
    expect(result.pricingMode).toBe('cost');
    expect(result.lines[0]).toMatchObject({ price: 425_000, discount: 0, rule: 'cost' });
    expect(result.subtotal).toBe(850_000);
    expect(result.discountAmount).toBe(0);
  });
});