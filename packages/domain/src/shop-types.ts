import type { CategoryDiscountRule } from './pricing.js';

/**
 * The shop's record shapes, shared by the server (which stores and validates them) and the web app
 * (which shows them). Money is whole paisa (Rs 1 = 100); quantities are rounded to 3 decimals.
 */

export type AccountType = 'cash' | 'bank' | 'wallet';

export interface ShopSettings {
  id: 'shop';
  shopName: string;
  address: string;
  phone: string;
  receiptFooter: string;
  /** Default supplier lead time (days) for reorder suggestions. */
  leadDays: number;
  /** True after the optional sample catalog and activity have been added. */
  demoDataLoaded?: boolean;
  /** Cash difference (paisa) above which closing needs an explanation. */
  discrepancyLimit: number;
  /** Max discount % a cashier may give. */
  cashierMaxDiscount: number;
  /** Auto discount applies when the bill reaches this amount. */
  autoDiscountMinOrder: number;
  /** Auto discount percentage applied to the selected category above the minimum order. */
  autoDiscountPct: number;
  /** Maximum allowed auto discount percentage. */
  autoDiscountMaxPct: number;
  /** Maximum share of gross profit that an automatic threshold discount may consume. */
  autoDiscountMaxProfitPct?: number;
  /** Auto discount target category. Use 'all' to apply to every category. */
  autoDiscountCategoryId: string;
  autoDiscountEnabled?: boolean;
  autoDiscountCategoryRules?: CategoryDiscountRule[];
  homeDeliveryEnabled?: boolean;
  deliveryCharge?: number;
  freeDeliveryThreshold?: number;
  businessPricingEnabled?: boolean;
  gharDiscountPct?: number;
  gharMinimumMarginPct?: number;
  gharDeliveryFee?: number;
  gharFreeDeliveryThreshold?: number;
  /** Products below this current gross margin are flagged for owner review. */
  minimumMarginPct?: number;
  stockSalesVelocityDays?: number;
  stockSafetyDays?: number;
  stockLowDaysThreshold?: number;
  stockSlowMovingDays?: number;
  stockOverstockDays?: number;
  stockReorderCoverDays?: number;
  productPairRules?: ProductPairRule[];
  retailerCashInFee?: number;
  retailerCashInStep?: number;
  retailerCashOutFee?: number;
  retailerCashOutStep?: number;
  setupDone: boolean;
}

export interface ProductPairRule {
  id: string;
  triggerProductId: string;
  triggerQuantities: number[];
  companionProductId: string;
  companionQty: number;
  enabled: boolean;
}

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  /** Set for Easypaisa/JazzCash retailer float accounts. */
  provider?: string;
  active: boolean;
}

export interface AccountTxn {
  id: string;
  accountId: string;
  date: string;
  /** + money in, − money out (paisa). */
  amount: number;
  type:
    | 'opening'
    | 'sale'
    | 'refund'
    | 'customer_payment'
    | 'purchase'
    | 'supplier_payment'
    | 'expense'
    | 'drawing'
    | 'transfer'
    | 'service'
    | 'adjustment';
  refId?: string;
  note?: string;
}

export interface Category {
  id: string;
  name: string;
}

export function isKaryanaCategoryName(categoryName?: string): boolean {
  return !!categoryName && categoryName.trim().toLowerCase().includes('karyana');
}

export function supportsFractionalSaleQuantity(categoryName?: string): boolean {
  const normalizedName = categoryName?.trim().toLowerCase();
  return !!normalizedName && (normalizedName.includes('karyana') || normalizedName.includes('grocery'));
}

export interface Product {
  id: string;
  name: string;
  nameUr?: string;
  voiceKeywords?: string[];
  sku: string;
  barcode?: string;
  categoryId?: string;
  supplierId?: string;
  /** Unit the product is sold and counted in (piece, packet, kg…). */
  unit: string;
  /** Pack used when buying from the supplier, e.g. Carton of 24. */
  packName?: string;
  packSize?: number;
  salePrice: number;
  /** Separate promoted unit price when a qualifying bill threshold is reached. */
  thresholdPrice?: number;
  /** Final line totals for exact quantities, such as 7 units for Rs 100. */
  quantityPrices?: { quantity: number; totalPrice: number }[];
  /** Whether this product may receive an automatic discount on a qualifying bill. Defaults to true. */
  thresholdDiscountEnabled?: boolean;
  /** Preferred automatic discount per unit in paisa; still subject to shop discount caps. */
  thresholdDiscountAmount?: number;
  wholesalePrice?: number;
  /** Weighted average cost per unit (paisa). */
  cost: number;
  stock: number;
  /** Current server reservations from other open POS carts. */
  reserved?: number;
  trackStock?: boolean;
  /** A billable service with a saved default rate rather than tracked inventory. */
  isService?: boolean;
  minStock: number;
  favorite: boolean;
  active: boolean;
  createdAt: string;
}

export interface StockMove {
  id: string;
  productId: string;
  date: string;
  /** + stock in, − stock out. */
  qty: number;
  type: 'opening' | 'sale' | 'return' | 'purchase' | 'purchase_return' | 'adjust' | 'damage' | 'expiry';
  /** Cost per unit at the time (paisa). */
  cost: number;
  refId?: string;
  note?: string;
}

export interface Customer {
  id: string;
  name: string;
  phone?: string;
  address?: string;
  creditLimit: number;
  shopkeeperPricing?: boolean;
  createdAt: string;
}

export interface Supplier {
  id: string;
  name: string;
  phone?: string;
  company?: string;
  /** Weekly day when the supplier accepts orders (0 = Sunday). */
  orderDay?: number;
  leadDays?: number;
  createdAt: string;
}

export interface PartyEntry {
  id: string;
  partyType: 'customer' | 'supplier';
  partyId: string;
  date: string;
  /**
   * Customer: + they owe us more (credit sale), − they paid / returned.
   * Supplier: + we owe them more (credit purchase), − we paid / returned.
   */
  amount: number;
  type: 'opening' | 'sale' | 'purchase' | 'payment' | 'return' | 'adjustment';
  refId?: string;
  note?: string;
}

export interface SaleItem {
  productId: string;
  name: string;
  unit: string;
  qty: number;
  price: number;
  /** Line discount (paisa, whole line). */
  discount: number;
  /** Average cost per unit when sold (for profit). */
  cost: number;
  returnedQty: number;
}

export interface Payment {
  accountId: string;
  amount: number;
}

export interface Sale {
  id: string;
  no: string;
  date: string;
  customerId?: string;
  gharOrderId?: string;
  deliveryAddress?: string;
  pricingMode?: 'normal' | 'business' | 'cost';
  paymentMethod?: 'cash' | 'credit';
  items: SaleItem[];
  subtotal: number;
  discount: number;
  deliveryFee?: number;
  total: number;
  /** Paid now across payment accounts. */
  paid: number;
  /** Cash handed back. */
  change: number;
  /** Unpaid part added to the customer's khata. */
  credit: number;
  payments: Payment[];
  userId: string;
  status: 'completed' | 'void';
  /** Total refunded/credited back through returns. */
  returnedTotal: number;
  note?: string;
}

export interface SaleReturn {
  id: string;
  saleId: string;
  saleNo: string;
  date: string;
  items: { productId: string; name: string; qty: number; amount: number; cost: number }[];
  amount: number;
  /** Where the money went back: an account (cash refund) or the customer's khata. */
  refundTo: 'account' | 'khata';
  accountId?: string;
  reason?: string;
  userId: string;
}

export interface Purchase {
  id: string;
  no: string;
  date: string;
  supplierId: string;
  invoiceNo?: string;
  items: { productId: string; name: string; qty: number; cost: number; previousCost?: number }[];
  total: number;
  paid: number;
  /** Account payments made at receipt time. Any uncovered remainder is supplier credit. */
  payments?: { accountId: string; amount: number }[];
  accountId?: string;
  note?: string;
}

export interface Expense {
  id: string;
  date: string;
  /** 'expense' counts against profit; 'drawing' is owner withdrawal (not an expense). */
  kind: 'expense' | 'drawing';
  category: string;
  amount: number;
  accountId: string;
  note?: string;
  userId: string;
}

export type ServiceType = 'cash_in' | 'cash_out' | 'send_money' | 'bill' | 'load';

export interface ServiceTxn {
  id: string;
  date: string;
  provider: string;
  type: ServiceType;
  amount: number;
  /** Fee charged to the customer in cash. */
  fee: number;
  /** Commission credited to the float by the provider. */
  commission: number;
  mobile?: string;
  ref?: string;
  note?: string;
  userId: string;
}

export interface Closing {
  id: string;
  date: string;
  accountId: string;
  expected: number;
  counted: number;
  difference: number;
  note?: string;
  userId: string;
}

export interface HeldCart {
  id: string;
  label: string;
  date: string;
  customerId?: string;
  items: SaleItem[];
  discount: number;
}

export type GharOrderStatus = 'invoice_draft' | 'invoice_sent' | 'confirmed' | 'packing' | 'out_for_delivery' | 'delivered' | 'cancelled';

export interface GharOrder {
  id: string;
  no: string;
  date: string;
  customerId: string;
  saleId?: string;
  customerName: string;
  phone?: string;
  address: string;
  items: { productId: string; name: string; unit: string; qty: number; price: number; regularPrice: number; cost: number }[];
  subtotal: number;
  deliveryFee: number;
  total: number;
  status: GharOrderStatus;
  note?: string;
  userId: string;
}

/** Lightweight debug record of voice commands (no audio is stored). */
export interface VoiceLog {
  id: string;
  date: string;
  spokenText: string;
  parsed: unknown;
  productIds: string[];
  customerId?: string;
  status: 'success' | 'partial' | 'failed';
  lang: string;
  userId: string;
  correctedProductId?: string;
  correctionPhrase?: string;
  corrections?: { productId: string; phrase: string }[];
  correctedAt?: string;
}

export interface Counter {
  id: string;
  value: number;
}
