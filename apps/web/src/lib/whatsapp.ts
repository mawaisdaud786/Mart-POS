import type { Customer, Sale, ShopSettings } from './db';
import { fmtDateTime, lineTotal, qty, rs } from './format';

export type WhatsAppLanguage = 'en' | 'ur' | 'roman';
export type WhatsAppTemplateKind = 'invoice' | 'khata';

export interface WhatsAppTemplate {
  id: string;
  name: string;
  language: WhatsAppLanguage;
  kind: WhatsAppTemplateKind;
  body: string;
  active: boolean;
}

export const DEFAULT_WHATSAPP_TEMPLATES: WhatsAppTemplate[] = [
  {
    id: 'wa-default-en-invoice', name: 'Invoice · English', language: 'en', kind: 'invoice', active: true,
    body: 'Assalam-o-Alaikum {customerName},\nInvoice {invoiceNo} from {shopName} ({date})\n{shopAddress}\n{items}\nSubtotal: {subtotal}\nDiscount: {discount}\nDelivery: {delivery}\nTotal: {total}\nPaid: {paid}\nDue on this invoice: {due}\n{shopPhone}',
  },
  {
    id: 'wa-default-ur-invoice', name: 'انوائس · اردو', language: 'ur', kind: 'invoice', active: true,
    body: 'السلام علیکم {customerName}،\n{shopName} کی انوائس {invoiceNo} ({date})\n{shopAddress}\n{items}\nذیلی رقم: {subtotal}\nرعایت: {discount}\nترسیل: {delivery}\nکل رقم: {total}\nوصول شدہ: {paid}\nاس انوائس کا بقایا: {due}\n{shopPhone}',
  },
  {
    id: 'wa-default-roman-invoice', name: 'Invoice · Roman Urdu', language: 'roman', kind: 'invoice', active: true,
    body: 'Assalam-o-Alaikum {customerName},\n{shopName} invoice {invoiceNo} ({date})\n{shopAddress}\n{items}\nSubtotal: {subtotal}\nDiscount: {discount}\nDelivery: {delivery}\nTotal: {total}\nWasool: {paid}\nIs invoice ka baqaya: {due}\n{shopPhone}',
  },
  {
    id: 'wa-default-en-khata', name: 'Khata · English', language: 'en', kind: 'khata', active: true,
    body: 'Assalam-o-Alaikum {customerName},\nYour balance at {shopName} is {balance}.\n{paymentSummary}\nThank you.{shopPhone}',
  },
  {
    id: 'wa-default-ur-khata', name: 'کھاتہ · اردو', language: 'ur', kind: 'khata', active: true,
    body: 'السلام علیکم {customerName}،\n{shopName} میں آپ کا موجودہ کھاتہ {balance} ہے۔\n{paymentSummary}\nشکریہ۔{shopPhone}',
  },
  {
    id: 'wa-default-roman-khata', name: 'Khata · Roman Urdu', language: 'roman', kind: 'khata', active: true,
    body: 'Assalam-o-Alaikum {customerName},\n{shopName} mein aap ka abhi khata {balance} hai.\n{paymentSummary}\nShukriya.{shopPhone}',
  },
];

export const getWhatsAppTemplates = (saved?: WhatsAppTemplate[]): WhatsAppTemplate[] =>
  saved === undefined ? DEFAULT_WHATSAPP_TEMPLATES.map((template) => ({ ...template })) : saved;

/** Normalize local Pakistani mobile numbers and international E.164-style numbers to wa.me digits. */
export function normalizeWhatsAppPhone(input: string): { valid: boolean; number: string; error?: string } {
  const trimmed = input.trim();
  if (!trimmed) return { valid: false, number: '', error: 'Enter a phone number.' };
  if (!/^[+\d\s().-]+$/.test(trimmed)) return { valid: false, number: '', error: 'Use digits and phone-number separators only.' };

  let digits = trimmed.replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('0') && digits.length === 11) digits = `92${digits.slice(1)}`;
  else if (digits.startsWith('3') && digits.length === 10) digits = `92${digits}`;

  if (digits.length < 8 || digits.length > 15) return { valid: false, number: digits, error: 'Phone number must contain 8–15 international digits.' };
  if (digits.startsWith('92') && (digits.length !== 12 || digits[2] !== '3')) {
    return { valid: false, number: digits, error: 'Enter a valid Pakistan mobile number (03xx… or +923xx…).'};
  }
  return { valid: true, number: digits };
}

export function buildWhatsAppUrl(phone: string, message: string): string | null {
  const normalized = normalizeWhatsAppPhone(phone);
  if (!normalized.valid || !message.trim()) return null;
  return `https://wa.me/${normalized.number}?text=${encodeURIComponent(message)}`;
}

export interface WhatsAppMessageData {
  kind: WhatsAppTemplateKind;
  customer: Pick<Customer, 'name'>;
  shop?: Pick<ShopSettings, 'shopName' | 'phone' | 'address'>;
  sale?: Sale;
  balance?: number;
  paymentAmount?: number;
  paymentDate?: string;
}

function invoiceItems(sale: Sale): string {
  return sale.items.map((item) =>
    `• ${item.name} — ${qty(item.qty)} ${item.unit} × ${rs(item.price)} = ${rs(lineTotal(item.price, item.qty) - item.discount)}`,
  ).join('\n');
}

/** Build invoice values from the saved sale record (amounts are paisa), never from a draft cart. */
export function invoiceValues(sale: Sale): Record<string, string> {
  const totalDiscount = sale.discount + sale.items.reduce((sum, item) => sum + item.discount, 0);
  return {
    invoiceNo: sale.no,
    date: fmtDateTime(sale.date),
    items: invoiceItems(sale),
    subtotal: rs(sale.subtotal),
    discount: rs(totalDiscount),
    delivery: (sale.deliveryFee ?? 0) > 0 ? rs(sale.deliveryFee!) : 'Rs 0',
    total: rs(sale.total),
    paid: rs(sale.paid),
    due: rs(sale.credit),
  };
}

function valuesFor(data: WhatsAppMessageData): Record<string, string> {
  const shopName = data.shop?.shopName?.trim() || 'Shop';
  const phone = data.shop?.phone?.trim() || '';
  const address = data.shop?.address?.trim() || '';
  if (data.kind === 'invoice' && data.sale) {
    return {
      customerName: data.customer.name,
      shopName,
      shopPhone: phone ? `Shop phone: ${phone}` : '',
      shopAddress: address ? `Shop address: ${address}` : '',
      ...invoiceValues(data.sale),
    };
  }
  const paymentSummary = data.paymentAmount && data.paymentAmount > 0
    ? `Payment received: ${rs(data.paymentAmount)}${data.paymentDate ? ` on ${fmtDateTime(data.paymentDate)}` : ''}`
    : '';
  return {
    customerName: data.customer.name,
    shopName,
    shopPhone: phone ? `\nShop phone: ${phone}` : '',
    shopAddress: address ? `Shop address: ${address}` : '',
    balance: rs(data.balance ?? 0),
    paymentSummary,
  };
}

export function interpolateWhatsAppTemplate(template: string, values: Record<string, string>): string {
  return template
    .replace(/\{([A-Za-z][A-Za-z0-9]*)\}/g, (_match, key: string) => values[key] ?? '')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() !== '')
    .join('\n')
    .trim();
}

export function renderWhatsAppMessage(template: WhatsAppTemplate, data: WhatsAppMessageData): string {
  return interpolateWhatsAppTemplate(template.body, valuesFor(data));
}
