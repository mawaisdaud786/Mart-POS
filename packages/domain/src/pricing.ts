export interface CategoryDiscountRule {
  categoryId: string;
  percent: number;
  enabled: boolean;
}

export interface PricingSettings {
  autoDiscountEnabled: boolean;
  threshold: number;
  defaultPercent: number;
  maxPercent: number;
  maxProfitPercent?: number;
  categoryRules: CategoryDiscountRule[];
  deliveryEnabled: boolean;
  deliveryCharge: number;
  freeDeliveryThreshold: number;
  businessPricingEnabled: boolean;
}

export interface PricingProduct {
  id: string;
  salePrice: number;
  cost?: number;
  thresholdPrice?: number | null;
  thresholdDiscountEnabled?: boolean;
  thresholdDiscountAmount?: number | null;
  quantityPrices?: { quantity: number; totalPrice: number }[] | null;
  wholesalePrice?: number | null;
  categoryId?: string | null;
}

export interface PricingLineInput {
  productId: string;
  qty: number;
  price?: number;
}

export interface CalculatedPricingLine {
  productId: string;
  qty: number;
  price: number;
  discount: number;
  originalAmount: number;
  rule: 'business' | 'cost' | 'quantity-bundle' | 'product-special' | 'category' | 'global' | 'none';
  discountPercent: number;
}

export interface PricingResult {
  lines: CalculatedPricingLine[];
  subtotal: number;
  eligibleSubtotal: number;
  discountAmount: number;
  discountPercent: number;
  deliveryCharge: number;
  total: number;
  pricingMode: 'normal' | 'business' | 'cost';
  appliedRules: string[];
}

export function calculatePricing(input: {
  lines: PricingLineInput[];
  products: PricingProduct[];
  settings: PricingSettings;
  pricingMode?: 'normal' | 'business' | 'cost';
  paymentMethod?: 'cash' | 'credit';
  homeDelivery?: boolean;
}): PricingResult {
  const { settings } = input;
  const threshold = Math.max(0, finiteOr(settings.threshold, DEFAULT_PRICING_SETTINGS.threshold));
  const defaultPercent = boundedPercent(settings.defaultPercent, DEFAULT_PRICING_SETTINGS.defaultPercent);
  const maxPercent = boundedPercent(settings.maxPercent, DEFAULT_PRICING_SETTINGS.maxPercent);
  const deliveryChargeSetting = Math.max(0, finiteOr(settings.deliveryCharge, DEFAULT_PRICING_SETTINGS.deliveryCharge));
  const freeDeliveryThreshold = Math.max(0, finiteOr(settings.freeDeliveryThreshold, DEFAULT_PRICING_SETTINGS.freeDeliveryThreshold));
  const categoryRules = Array.isArray(settings.categoryRules) ? settings.categoryRules : [];
  const mode = input.pricingMode === 'cost' ? 'cost' : input.pricingMode === 'business' ? 'business' : 'normal';
  const productById = new Map(input.products.map((product) => [product.id, {
    ...product,
    salePrice: Math.max(0, finiteOr(product.salePrice, 0)),
    cost: product.cost == null ? undefined : Math.max(0, finiteOr(product.cost, 0)),
    thresholdPrice: product.thresholdPrice == null ? product.thresholdPrice : finiteOr(product.thresholdPrice, NaN),
    thresholdDiscountAmount: product.thresholdDiscountAmount == null ? product.thresholdDiscountAmount : Math.max(0, finiteOr(product.thresholdDiscountAmount, 0)),
    quantityPrices: Array.isArray(product.quantityPrices) ? product.quantityPrices : [],
    wholesalePrice: product.wholesalePrice == null ? product.wholesalePrice : Math.max(0, finiteOr(product.wholesalePrice, finiteOr(product.salePrice, 0))),
  }]));
  const productLines = input.lines.map((line) => {
    const product = productById.get(line.productId);
    if (!product) throw new Error(`Product not found: ${line.productId}`);
    if (!Number.isFinite(line.qty) || line.qty <= 0) throw new Error('Quantity must be greater than zero');
    const price = line.price === undefined ? undefined : Math.max(0, finiteOr(line.price, product.salePrice));
    return { line: { ...line, price }, product };
  });
  const basePrice = (line: PricingLineInput, product: PricingProduct) => mode === 'cost'
    ? product.cost ?? 0
    : mode === 'business'
      ? product.cost && product.cost > 0 ? product.cost : product.wholesalePrice ?? product.salePrice
      : line.price ?? product.salePrice;
  const bundleTotal = (line: PricingLineInput, product: PricingProduct) => {
    if (mode !== 'normal' || line.price !== undefined) return undefined;
    const bundle = product.quantityPrices?.find((tier) => tier.quantity === line.qty);
    if (!bundle || !Number.isFinite(bundle.totalPrice) || bundle.totalPrice <= 0) return undefined;
    const regularTotal = Math.round(product.salePrice * line.qty);
    return bundle.totalPrice <= regularTotal ? bundle.totalPrice : undefined;
  };
  const ruleByCategory = new Map(categoryRules.map((rule) => [rule.categoryId, rule]));
  const eligibleLine = (product: PricingProduct) => {
    if (product.thresholdDiscountEnabled === false) return false;
    const hasProductSpecial = product.thresholdPrice != null && product.thresholdPrice >= 0 && product.thresholdPrice < product.salePrice;
    if (hasProductSpecial || product.thresholdDiscountAmount != null) return true;
    if (categoryRules.length === 0) return true;
    const categoryRule = product.categoryId ? ruleByCategory.get(product.categoryId) : undefined;
    return !!categoryRule?.enabled && boundedPercent(categoryRule.percent, 0) > 0;
  };
  const eligibleSubtotal = productLines.reduce((sum, { line, product }) => {
    if (!eligibleLine(product) || bundleTotal(line, product) !== undefined) return sum;
    const base = basePrice(line, product);
    return sum + Math.round(base * line.qty);
  }, 0);
  const deliverySubtotal = productLines.reduce((sum, { line, product }) => sum + (bundleTotal(line, product) ?? Math.round(basePrice(line, product) * line.qty)), 0);
  const thresholdMet = settings.autoDiscountEnabled !== false && eligibleSubtotal >= threshold;
  const allowAutomaticDiscount = thresholdMet && mode === 'normal' && input.paymentMethod !== 'credit';
  const cap = maxPercent;
  const profitCap = boundedPercent(settings.maxProfitPercent, 30);
  const capDiscount = (discount: number, originalAmount: number, price: number, qty: number, cost?: number) => {
    const priceCap = Math.round(originalAmount * cap / 100);
    const profitCapAmount = cost === undefined
      ? Number.POSITIVE_INFINITY
      : Math.round(Math.max(0, price - cost) * qty * profitCap / 100);
    return Math.min(discount, priceCap, profitCapAmount);
  };
  const lines: CalculatedPricingLine[] = productLines.map(({ line, product }) => {
    const normalPrice = mode === 'cost'
      ? product.cost ?? 0
      : mode === 'business'
        ? product.cost && product.cost > 0 ? product.cost : product.wholesalePrice ?? product.salePrice
        : line.price ?? product.salePrice;
    const originalAmount = Math.round(normalPrice * line.qty);
    if (mode === 'cost') {
      return { productId: line.productId, qty: line.qty, price: normalPrice, discount: 0, originalAmount, rule: 'cost', discountPercent: 0 };
    }
    if (mode === 'business') {
      return { productId: line.productId, qty: line.qty, price: normalPrice, discount: 0, originalAmount, rule: 'business', discountPercent: 0 };
    }
    const bundle = bundleTotal(line, product);
    if (bundle !== undefined) {
      const discount = originalAmount - bundle;
      return {
        productId: line.productId,
        qty: line.qty,
        price: normalPrice,
        discount,
        originalAmount,
        rule: 'quantity-bundle',
        discountPercent: originalAmount > 0 ? discount * 100 / originalAmount : 0,
      };
    }
    if (!allowAutomaticDiscount) {
      return { productId: line.productId, qty: line.qty, price: normalPrice, discount: 0, originalAmount, rule: 'none', discountPercent: 0 };
    }
    if (!eligibleLine(product)) {
      return { productId: line.productId, qty: line.qty, price: normalPrice, discount: 0, originalAmount, rule: 'none', discountPercent: 0 };
    }

    const categoryRule = product.categoryId ? ruleByCategory.get(product.categoryId) : undefined;
    if (product.thresholdPrice != null && product.thresholdPrice >= 0 && product.thresholdPrice < normalPrice) {
      const discount = capDiscount(Math.round((normalPrice - product.thresholdPrice) * line.qty), originalAmount, normalPrice, line.qty, product.cost);
      const discountPercent = originalAmount > 0 ? discount * 100 / originalAmount : 0;
      return { productId: line.productId, qty: line.qty, price: normalPrice, discount, originalAmount, rule: discount > 0 ? 'product-special' : 'none', discountPercent };
    }
    if (categoryRule && (!categoryRule.enabled || boundedPercent(categoryRule.percent, 0) <= 0)) {
      return { productId: line.productId, qty: line.qty, price: normalPrice, discount: 0, originalAmount, rule: 'none', discountPercent: 0 };
    }
    if (categoryRules.length > 0 && !categoryRule) {
      return { productId: line.productId, qty: line.qty, price: normalPrice, discount: 0, originalAmount, rule: 'none', discountPercent: 0 };
    }
    const rule = categoryRule ? 'category' : 'global';
    const percent = Math.min(cap, boundedPercent(categoryRule?.percent ?? defaultPercent, defaultPercent));
    const discount = capDiscount(Math.round(originalAmount * percent / 100), originalAmount, normalPrice, line.qty, product.cost);
    return { productId: line.productId, qty: line.qty, price: normalPrice, discount, originalAmount, rule: discount > 0 ? rule : 'none', discountPercent: originalAmount > 0 ? discount * 100 / originalAmount : 0 };
  });
  const subtotal = lines.reduce((sum, line) => sum + line.originalAmount, 0);
  const discountAmount = lines.reduce((sum, line) => sum + line.discount, 0);
  const deliveryEligible = input.homeDelivery && settings.deliveryEnabled;
  const deliveryCharge = deliveryEligible && deliverySubtotal < freeDeliveryThreshold ? deliveryChargeSetting : 0;
  const total = Math.max(0, subtotal - discountAmount + deliveryCharge);
  const discountPercent = subtotal > 0 ? discountAmount * 100 / subtotal : 0;
  const appliedRules = [...new Set(lines.filter((line) => line.discount > 0 || line.rule === 'business').map((line) => line.rule))];
  return { lines, subtotal, eligibleSubtotal, discountAmount, discountPercent, deliveryCharge, total, pricingMode: mode, appliedRules };
}

export const DEFAULT_PRICING_SETTINGS: PricingSettings = {
  autoDiscountEnabled: true,
  threshold: 500_000,
  defaultPercent: 10,
  maxPercent: 70,
  maxProfitPercent: 30,
  categoryRules: [],
  deliveryEnabled: true,
  deliveryCharge: 20_000,
  freeDeliveryThreshold: 500_000,
  businessPricingEnabled: true,
};

function finiteOr(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function boundedPercent(value: unknown, fallback: number): number {
  return Math.min(100, Math.max(0, finiteOr(value, fallback)));
}