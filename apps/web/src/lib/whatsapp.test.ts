import { describe, expect, it } from 'vitest';
import type { Sale } from './db';
import {
  DEFAULT_WHATSAPP_TEMPLATES,
  buildWhatsAppUrl,
  interpolateWhatsAppTemplate,
  invoiceValues,
  normalizeWhatsAppPhone,
  renderWhatsAppMessage,
} from './whatsapp';

const sale: Sale = {
  id: 'sale-1',
  no: 'INV-001',
  date: '2026-10-07T00:00:00.000Z',
  customerId: 'customer-1',
  items: [
    { productId: 'product-1', name: 'Rice', unit: 'Kg', qty: 2, price: 25_000, discount: 1_000, cost: 10_000, returnedQty: 0 },
  ],
  subtotal: 50_000,
  discount: 2_000,
  deliveryFee: 500,
  total: 47_500,
  paid: 30_000,
  change: 0,
  credit: 17_500,
  payments: [{ accountId: 'acc-cash', amount: 30_000 }],
  userId: 'user-1',
  status: 'completed',
  returnedTotal: 0,
};

describe('WhatsApp message helpers', () => {
  it.each([
    ['0300-1234567', '923001234567'],
    ['+92 300 1234567', '923001234567'],
    ['0092 (300) 1234567', '923001234567'],
    ['+1 202 555 0123', '12025550123'],
  ])('normalizes %s', (input, expected) => {
    expect(normalizeWhatsAppPhone(input)).toEqual({ valid: true, number: expected });
  });

  it.each(['', '12345', '03xx-1234567', '+92 300 123456'])('rejects invalid phone %s', (input) => {
    expect(normalizeWhatsAppPhone(input).valid).toBe(false);
  });

  it('creates a safely encoded click-to-chat URL only for a valid number', () => {
    expect(buildWhatsAppUrl('0300-1234567', 'Invoice INV 1\nRs 10')).toBe(
      'https://wa.me/923001234567?text=Invoice%20INV%201%0ARs%2010',
    );
    expect(buildWhatsAppUrl('bad number', 'hello')).toBeNull();
  });

  it('interpolates known placeholders and removes empty optional lines', () => {
    expect(interpolateWhatsAppTemplate('Hello {name}\n{optional}\nTotal {total}', { name: 'Sara', total: 'Rs 5' }))
      .toBe('Hello Sara\nTotal Rs 5');
  });

  it('uses persisted sale values for invoice totals and line values', () => {
    const values = invoiceValues(sale);
    expect(values).toMatchObject({
      invoiceNo: 'INV-001',
      items: '• Rice — 2 Kg × Rs 250 = Rs 490',
      subtotal: 'Rs 500',
      discount: 'Rs 30',
      delivery: 'Rs 5',
      total: 'Rs 475',
      paid: 'Rs 300',
      due: 'Rs 175',
    });
  });

  it('renders a multilingual default invoice template using the supplied customer and shop', () => {
    const template = DEFAULT_WHATSAPP_TEMPLATES.find((item) => item.id === 'wa-default-en-invoice')!;
    const text = renderWhatsAppMessage(template, {
      kind: 'invoice',
      customer: { name: 'Sara' },
      shop: { shopName: 'Al Noor Mart', phone: '0300 1112222', address: 'Main road' },
      sale,
    });
    expect(text).toContain('Sara');
    expect(text).toContain('Al Noor Mart');
    expect(text).toContain('INV-001');
    expect(text).toContain('Rs 475');
    expect(text).toContain('Due on this invoice: Rs 175');
  });
});
