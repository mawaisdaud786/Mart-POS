import { describe, expect, it } from 'vitest';
import { supportsFractionalSaleQuantity } from '@retailos/domain';
import { computeAutoDiscountForLine, isKaryanaCategoryName } from './discount';

describe('isKaryanaCategoryName', () => {
  it('matches Karyana categories without case or surrounding-space sensitivity', () => {
    expect(isKaryanaCategoryName(' KARYANA groceries ')).toBe(true);
    expect(isKaryanaCategoryName('Personal Care')).toBe(false);
    expect(isKaryanaCategoryName(undefined)).toBe(false);
  });
});

describe('supportsFractionalSaleQuantity', () => {
  it('allows fractional quantities for Karyana and Grocery categories only', () => {
    expect(supportsFractionalSaleQuantity('Karyana')).toBe(true);
    expect(supportsFractionalSaleQuantity('Grocery')).toBe(true);
    expect(supportsFractionalSaleQuantity('Biscuits & Confectionery')).toBe(false);
    expect(supportsFractionalSaleQuantity('Biscuits & Snacks')).toBe(false);
    expect(supportsFractionalSaleQuantity('Personal Care')).toBe(false);
    expect(supportsFractionalSaleQuantity(undefined)).toBe(false);
  });
});

describe('computeAutoDiscountForLine', () => {
  it('applies a Karyana-only discount only above the minimum order', () => {
    expect(
      computeAutoDiscountForLine({
        productId: 'p1',
        name: 'Rice',
        unit: 'kg',
        qty: 2,
        price: 250,
        discount: 0,
      }, {
        minOrder: 5000,
        percent: 20,
        maxPercent: 70,
        karyanaOnly: true,
        categoryName: 'Karyana',
      }),
    ).toBe(100);
  });

  it('does not discount non-Karyana products even when the threshold is reached', () => {
    expect(
      computeAutoDiscountForLine({
        productId: 'p2',
        name: 'Soap',
        unit: 'piece',
        qty: 2,
        price: 250,
        discount: 0,
      }, {
        minOrder: 5000,
        percent: 20,
        maxPercent: 70,
        karyanaOnly: true,
        categoryName: 'Personal Care',
      }),
    ).toBe(0);
  });

  it('caps auto discount at the configured maximum percentage', () => {
    expect(
      computeAutoDiscountForLine({
        productId: 'p3',
        name: 'Flour',
        unit: 'kg',
        qty: 10,
        price: 200,
        discount: 0,
      }, {
        minOrder: 1000,
        percent: 80,
        maxPercent: 70,
        karyanaOnly: true,
        categoryName: 'Karyana',
      }),
    ).toBe(1400);
  });
});
