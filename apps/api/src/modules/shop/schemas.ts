import { z } from 'zod';

/** Shapes the browser may send. Anything not listed here is dropped; numbers must be sane. */

const MAX_PAISA = 1_000_000_000_000; // Rs 10,000,000,000
export const paisa = z.number().int().min(0).max(MAX_PAISA);
export const signedPaisa = z.number().int().min(-MAX_PAISA).max(MAX_PAISA);
export const quantity = z.number().finite().min(-1_000_000).max(1_000_000);
const positiveQty = z.number().finite().gt(0).max(1_000_000);
const text = (max: number) => z.string().trim().max(max);
const name = (max: number) => z.string().trim().min(1).max(max);
const id = z.string().min(1).max(64).regex(/^[A-Za-z0-9._:-]+$/, 'Invalid id');
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/, 'Use an ISO date-time in UTC');
const optional = <T extends z.ZodType>(t: T) => t.optional();

export const ProductDoc = z.object({
  id,
  name: name(200),
  nameUr: optional(text(200)),
  voiceKeywords: optional(z.array(name(80)).max(60)),
  sku: name(64),
  barcode: optional(text(64)),
  categoryId: optional(id),
  supplierId: optional(id),
  unit: name(30),
  packName: optional(text(40)),
  packSize: optional(z.number().finite().gt(0).max(100_000)),
  salePrice: paisa,
  quantityPrices: optional(z.array(z.object({
    quantity: z.number().int().positive().max(1_000_000),
    totalPrice: paisa.min(1),
  })).max(30)),
  thresholdPrice: optional(paisa),
  thresholdDiscountEnabled: optional(z.boolean()),
  thresholdDiscountAmount: optional(paisa),
  wholesalePrice: optional(paisa),
  cost: paisa,
  stock: quantity,
  minStock: z.number().finite().min(0).max(1_000_000),
  trackStock: optional(z.boolean()),
  isService: optional(z.boolean()),
  favorite: z.boolean(),
  active: z.boolean(),
  createdAt: isoDate,
}).superRefine((product, ctx) => {
  const quantities = new Set<number>();
  for (const [index, tier] of (product.quantityPrices ?? []).entries()) {
    if (quantities.has(tier.quantity)) {
      ctx.addIssue({ code: 'custom', path: ['quantityPrices', index, 'quantity'], message: 'Each bundle quantity must be unique' });
    }
    quantities.add(tier.quantity);
    if (tier.totalPrice > product.salePrice * tier.quantity) {
      ctx.addIssue({ code: 'custom', path: ['quantityPrices', index, 'totalPrice'], message: 'Bundle total cannot exceed the regular price for that quantity' });
    }
  }
});

export const CategoryDoc = z.object({ id, name: name(80) });

export const CustomerDoc = z.object({ id, name: name(120), phone: optional(text(30)), address: optional(text(300)), creditLimit: paisa, shopkeeperPricing: optional(z.boolean()), createdAt: isoDate });

export const SupplierDoc = z.object({
  id,
  name: name(120),
  phone: optional(text(30)),
  company: optional(text(120)),
  orderDay: optional(z.number().int().min(0).max(6)),
  leadDays: optional(z.number().int().min(0).max(365)),
  createdAt: isoDate,
});

export const AccountDoc = z.object({ id, name: name(80), type: z.enum(['cash', 'bank', 'wallet']), provider: optional(text(40)), active: z.boolean() });

const pct = z.number().finite().min(0).max(100);
export const SettingsDoc = z.object({
  id: z.literal('shop'),
  shopName: name(150),
  address: text(300),
  phone: text(30),
  receiptFooter: text(300),
  leadDays: z.number().int().min(0).max(365),
  demoDataLoaded: optional(z.boolean()),
  discrepancyLimit: paisa,
  cashierMaxDiscount: pct,
  autoDiscountMinOrder: paisa,
  autoDiscountPct: pct,
  autoDiscountMaxPct: pct,
  autoDiscountMaxProfitPct: optional(pct),
  autoDiscountCategoryId: id.or(z.literal('all')),
  autoDiscountEnabled: optional(z.boolean()),
  autoDiscountCategoryRules: optional(z.array(z.object({ categoryId: id, percent: pct, enabled: z.boolean() })).max(200)),
  homeDeliveryEnabled: optional(z.boolean()),
  deliveryCharge: optional(paisa),
  freeDeliveryThreshold: optional(paisa),
  businessPricingEnabled: optional(z.boolean()),
  gharDiscountPct: optional(pct),
  gharMinimumMarginPct: optional(pct),
  gharDeliveryFee: optional(paisa),
  gharFreeDeliveryThreshold: optional(paisa),
  minimumMarginPct: optional(pct),
  stockSalesVelocityDays: optional(z.number().int().min(7).max(180)),
  stockSafetyDays: optional(z.number().int().min(0).max(90)),
  stockLowDaysThreshold: optional(z.number().int().min(1).max(90)),
  stockSlowMovingDays: optional(z.number().int().min(7).max(365)),
  stockOverstockDays: optional(z.number().int().min(7).max(365)),
  stockReorderCoverDays: optional(z.number().int().min(1).max(60)),
  productPairRules: optional(z.array(z.object({
    id,
    triggerProductId: id,
    triggerQuantities: z.array(positiveQty).min(1).max(20),
    companionProductId: id,
    companionQty: positiveQty,
    enabled: z.boolean(),
  }).refine((rule) => rule.triggerProductId !== rule.companionProductId, 'Choose two different products')).max(500)),
  retailerCashInFee: optional(paisa),
  retailerCashInStep: optional(paisa),
  retailerCashOutFee: optional(paisa),
  retailerCashOutStep: optional(paisa),
  setupDone: z.boolean(),
});

const SaleItemDoc = z.object({
  productId: id,
  name: name(200),
  unit: name(30),
  qty: positiveQty,
  price: paisa,
  discount: paisa,
  cost: paisa,
  returnedQty: z.number().finite().min(0),
});
export const HeldCartDoc = z.object({
  id,
  label: name(80),
  date: isoDate,
  customerId: optional(id),
  items: z.array(SaleItemDoc).max(300),
  discount: paisa,
});

export const GharOrderDoc = z.object({
  id,
  no: name(30),
  date: isoDate,
  customerId: id,
  saleId: optional(id),
  customerName: name(120),
  phone: optional(text(30)),
  address: name(300),
  items: z
    .array(z.object({ productId: id, name: name(200), unit: name(30), qty: positiveQty, price: paisa, regularPrice: paisa, cost: paisa }))
    .max(300),
  subtotal: paisa,
  deliveryFee: paisa,
  total: paisa,
  status: z.enum(['invoice_draft', 'invoice_sent', 'confirmed', 'packing', 'out_for_delivery', 'delivered', 'cancelled']),
  note: optional(text(500)),
  userId: id,
});

export const VoiceLogDoc = z.object({
  id,
  date: isoDate,
  spokenText: text(500),
  parsed: z.unknown().refine((v) => JSON.stringify(v ?? null).length <= 4000, 'Too large'),
  productIds: z.array(id).max(50),
  customerId: optional(id),
  status: z.enum(['success', 'partial', 'failed']),
  lang: text(10),
  userId: id,
  correctedProductId: optional(id),
  correctionPhrase: optional(text(200)),
  corrections: optional(z.array(z.object({ productId: id, phrase: name(200) })).max(50)),
  correctedAt: optional(isoDate),
});

const posActionShortcuts = z.partialRecord(
  z.enum(['focusSearch', 'customer', 'hold', 'recall', 'delivery', 'pay', 'remove']),
  z.array(z.string().trim().min(1).max(10)).max(10),
).optional();

export const PrefsDoc = z.object({
  id,
  voiceLang: optional(z.enum(['ur-PK', 'en-IN'])),
  actionShortcuts: posActionShortcuts,
  productShortcuts: optional(z.array(z.object({
    key: z.string().trim().regex(/^[a-z]$/i),
    productId: id,
  })).max(100)),
  whatsappTemplates: optional(z.array(z.object({
    id,
    name: name(80),
    language: z.enum(['en', 'ur', 'roman']),
    kind: z.enum(['invoice', 'khata']),
    body: z.string().trim().min(1).max(2000),
    active: z.boolean(),
  })).max(100)),
});

// ------------------------------------------------------------------ operations

const payment = z.object({ accountId: id, amount: paisa });

export const SaleInputSchema = z.object({
  date: optional(isoDate),
  gharOrderId: optional(id),
  deliveryAddress: optional(text(300)),
  pricingMode: optional(z.enum(['normal', 'business', 'cost'])),
  paymentMethod: optional(z.enum(['cash', 'credit'])),
  deliveryFee: optional(paisa),
  items: z.array(z.object({ productId: id, name: optional(text(200)), unit: optional(text(30)), qty: positiveQty, price: paisa, discount: paisa })).min(1).max(300),
  discount: paisa,
  customerId: optional(id),
  payments: z.array(payment).max(10),
  note: optional(text(500)),
  homeDelivery: optional(z.boolean()),
});

export const PricingQuoteSchema = z.object({
  items: z.array(z.object({ productId: id, qty: positiveQty, price: optional(paisa) })).min(1).max(300),
  homeDelivery: optional(z.boolean()),
});

export const OP_INPUTS = {
  saveVoiceKeywords: z.object({
    productId: id,
    voiceKeywords: z.array(name(80)).max(60),
  }),
  completeSale: SaleInputSchema,
  returnSaleItems: z.object({
    saleId: id,
    lines: z.array(z.object({ productId: id, qty: positiveQty })).min(1).max(300),
    refundTo: z.enum(['account', 'khata']),
    accountId: optional(id),
    reason: optional(text(300)),
  }),
  voidSale: z.object({ saleId: id, reason: name(300) }),
  recordPurchase: z.object({
    supplierId: id,
    date: optional(isoDate),
    invoiceNo: optional(text(60)),
    items: z.array(z.object({ productId: id, qty: positiveQty, cost: paisa, previousCost: optional(paisa), total: optional(paisa) })).min(1).max(500),
    payments: z.array(payment).max(10),
    note: optional(text(500)),
  }),
  adjustStock: z.object({
    productId: id,
    qty: quantity,
    type: z.enum(['opening', 'adjust', 'damage', 'expiry']),
    date: optional(isoDate),
    cost: optional(paisa),
    note: optional(text(300)),
  }),
  receiveCustomerPayment: z.object({ customerId: id, amount: paisa, accountId: id, note: optional(text(300)) }),
  paySupplier: z.object({ supplierId: id, amount: paisa, accountId: id, note: optional(text(300)) }),
  addPartyAdjustment: z.object({
    partyType: z.enum(['customer', 'supplier']),
    partyId: id,
    amount: signedPaisa,
    note: text(300),
    type: optional(z.enum(['opening', 'adjustment'])),
    date: optional(isoDate),
  }),
  addExpense: z.object({ kind: z.enum(['expense', 'drawing']), category: name(80), amount: paisa, accountId: id, note: optional(text(300)), date: optional(isoDate) }),
  deleteExpense: z.object({ id }),
  transferMoney: z.object({ fromId: id, toId: id, amount: paisa, note: optional(text(300)) }),
  adjustAccount: z.object({ accountId: id, amount: signedPaisa, note: name(300) }),
  addServiceTxn: z.object({
    provider: name(40),
    type: z.enum(['cash_in', 'cash_out', 'send_money', 'bill', 'load']),
    amount: paisa,
    fee: paisa,
    commission: paisa,
    mobile: optional(text(30)),
    ref: optional(text(60)),
    note: optional(text(300)),
  }),
  deleteServiceTxn: z.object({ id }),
  saveClosing: z.object({ accountId: id, counted: paisa, note: optional(text(300)) }),
  setupShop: z.object({ shopName: name(150), address: text(300), phone: text(30), openingCash: paisa }),
  manageProducts: z.object({
    action: z.enum(['archive', 'activate', 'delete']),
    ids: z.array(id).min(1).max(500).refine((ids) => new Set(ids).size === ids.length, 'Product ids must be unique'),
  }),
  bulkUpdateProducts: z.object({
    ids: z.array(id).min(1).max(500).refine((ids) => new Set(ids).size === ids.length, 'Product ids must be unique'),
    categoryId: id.nullable().optional(),
    supplierId: id.nullable().optional(),
    unit: name(30).optional(),
    thresholdDiscountEnabled: z.boolean().optional(),
    thresholdDiscountAmount: paisa.nullable().optional(),
  }).refine((input) => input.categoryId !== undefined || input.supplierId !== undefined || input.unit !== undefined || input.thresholdDiscountEnabled !== undefined || input.thresholdDiscountAmount !== undefined, 'Choose at least one product field to update'),
  bulkMasterRecords: z.object({
    entity: z.enum(['categories', 'customers', 'suppliers']),
    action: z.enum(['create', 'update', 'delete']),
    ids: z.array(id).min(1).max(500).optional(),
    records: z.array(z.object({ name: name(120) })).min(1).max(500).optional(),
    updates: z.object({
      shopkeeperPricing: optional(z.boolean()),
      phone: optional(text(30)),
      address: optional(text(300)),
      company: optional(text(120)),
      leadDays: optional(z.number().int().min(0).max(365)),
      orderDay: optional(z.number().int().min(0).max(6)),
    }).optional(),
  }).superRefine((input, ctx) => {
    if (input.action === 'create' && !input.records) ctx.addIssue({ code: 'custom', message: 'Records are required for bulk create', path: ['records'] });
    if (input.action !== 'create' && !input.ids) ctx.addIssue({ code: 'custom', message: 'Ids are required for bulk update/delete', path: ['ids'] });
    if (input.action === 'update' && !input.updates) ctx.addIssue({ code: 'custom', message: 'Updates are required for bulk update', path: ['updates'] });
    if (input.entity === 'categories' && input.records?.some((record) => record.name.length > 80)) {
      ctx.addIssue({ code: 'custom', message: 'Category names may not exceed 80 characters', path: ['records'] });
    }
  }),
  importProducts: z.object({
    records: z
      .array(
        z.object({
          sku: name(64),
          name: name(200),
          nameUr: optional(text(200)),
          voiceKeywords: optional(z.array(name(80)).max(60)),
          barcode: optional(text(64)),
          category: optional(text(80)),
          supplier: optional(text(120)),
          unit: name(30),
          packName: optional(text(40)),
          packSize: optional(z.number().finite().gt(0).max(100_000)),
          salePrice: paisa,
          thresholdPrice: optional(paisa),
          wholesalePrice: optional(paisa),
          cost: optional(paisa),
          openingStock: z.number().finite().min(0).max(1_000_000),
          minStock: z.number().finite().min(0).max(1_000_000),
          favorite: z.boolean(),
          active: z.boolean(),
        }),
      )
      .min(1)
      .max(5000),
  }),
} as const;

export type OpName = keyof typeof OP_INPUTS;
