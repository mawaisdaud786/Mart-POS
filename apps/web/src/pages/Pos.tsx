import { Home, Keyboard, Minus, PauseCircle, Plus, Search, ShoppingCart, Star, Trash2 } from 'lucide-react';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { CustomerPicker } from '../components/CustomerPicker';
import { ReceiptModal } from '../components/Receipt';
import { useVoiceAssistant } from '../components/VoiceAssistant';
import { Badge, Button, Empty, Field, Input, Modal, MoneyInput, cx, useAction, useToast } from '../components/ui';
import { ACCOUNT_IDS, db, nowIso, uid, type GharOrder, type Product, type Sale, type SaleItem } from '../lib/db';
import { lineTotal, qty as fmtQty, roundQty, rs } from '../lib/format';
import { OpError, cartSubtotal, completeSale } from '../lib/ops';
import { partyBalances } from '../lib/reports';
import { useSession, useUser } from '../lib/session';
import { useLiveQuery } from '../lib/store';
import { calculatePricing, supportsFractionalSaleQuantity } from '@retailos/domain';
import { quantityForAmount } from '../lib/quantity';
import { DEFAULT_ACTION_SHORTCUTS, POS_ACTIONS, normalizeShortcutKey, shortcutFromKeyboardEvent } from '../lib/pos-shortcuts';

type CartLine = Omit<SaleItem, 'cost' | 'returnedQty'>;
type VoicePayRequest = { mode: 'cash' | 'credit'; resolve: (success: boolean) => void };

function CartQuantityInput({ quantity, allowFractional, disabled, onCommit }: {
  quantity: number;
  allowFractional: boolean;
  disabled: boolean;
  onCommit: (quantity: number) => boolean;
}) {
  const [draft, setDraft] = useState(String(quantity));

  useEffect(() => setDraft(String(quantity)), [quantity]);

  const commit = () => {
    const next = Number(draft);
    if (!draft.trim() || !Number.isFinite(next) || next <= 0) {
      setDraft(String(quantity));
      return;
    }
    const rounded = roundQty(next);
    if (onCommit(rounded)) setDraft(String(rounded));
    else setDraft(String(quantity));
  };

  return (
    <input
      className="w-16 rounded border border-slate-300 px-1 py-0.5 text-center text-sm"
      inputMode={allowFractional ? 'decimal' : 'numeric'}
      step={allowFractional ? '0.001' : '1'}
      value={draft}
      disabled={disabled}
      aria-label="Quantity"
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
      }}
    />
  );
}

function CartAmountInput({ disabled, unitPrice, onCommit, onInvalidAmount }: {
  disabled: boolean;
  unitPrice: number;
  onCommit: (quantity: number) => boolean;
  onInvalidAmount: (message: string) => void;
}) {
  const [draft, setDraft] = useState('');

  const commit = () => {
    if (!draft.trim()) return;
    const amount = Number(draft.replace(/,/g, ''));
    if (!Number.isFinite(amount) || amount <= 0) {
      onInvalidAmount('Enter a valid amount in rupees');
      setDraft('');
      return;
    }
    const amountPaisa = Math.round(amount * 100);
    const nextQuantity = quantityForAmount(amountPaisa, unitPrice);
    if (nextQuantity <= 0) {
      onInvalidAmount('Amount is too small to make 0.001 of this item');
      setDraft('');
      return;
    }
    if (!onCommit(nextQuantity)) {
      setDraft('');
      return;
    }
    setDraft('');
  };

  return (
    <label className="ml-1 inline-flex items-center gap-1 text-xs text-slate-500">
      Rs amount
      <input
        className="w-20 rounded border border-slate-300 px-1 py-0.5 text-right text-xs"
        inputMode="decimal"
        value={draft}
        disabled={disabled}
        placeholder="e.g. 100"
        aria-label="Amount in rupees"
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
        }}
      />
    </label>
  );
}

export function PosPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const user = useUser();
  const { settings, can } = useSession();
  const toast = useToast();
  const run = useAction();
  const products = useLiveQuery(() => db.products.filter((p) => p.active).toArray(), []) ?? [];
  const categories = useLiveQuery(() => db.categories.orderBy('name').toArray(), []) ?? [];
  const held = useLiveQuery(() => db.heldCarts.toArray(), []) ?? [];
  const salesCutoff = useMemo(() => new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(), []);
  const recentSales = useLiveQuery(() => db.sales.where('date').aboveOrEqual(salesCutoff).toArray(), [salesCutoff]) ?? [];
  const posPrefs = useLiveQuery(() => db.prefs.get(`u:${user.id}`), [user.id]);
  const invoiceCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const sale of recentSales) {
      if (sale.status !== 'completed') continue;
      const productIds = new Set(sale.items.map((item) => item.productId));
      for (const productId of productIds) {
        counts.set(productId, (counts.get(productId) ?? 0) + 1);
      }
    }
    return counts;
  }, [recentSales]);

  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string>('all');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [discount, setDiscount] = useState(0);
  const [deliveryFee, setDeliveryFee] = useState(0);
  const [gharOrderId, setGharOrderId] = useState<string | undefined>();
  const [gharQuoteMode, setGharQuoteMode] = useState(false);
  const [homeDelivery, setHomeDelivery] = useState(false);
  const [gharAddress, setGharAddress] = useState('');
  const [gharNote, setGharNote] = useState('');
  const [gharQuoteError, setGharQuoteError] = useState('');
  const [gharQuotePending, setGharQuotePending] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [customerId, setCustomerId] = useState<string | undefined>();
  const [customerFocusRequest, setCustomerFocusRequest] = useState(0);
  const [paying, setPaying] = useState(false);
  const [receipt, setReceipt] = useState<Sale | null>(null);
  const [showHeld, setShowHeld] = useState(false);
  /** Udhaar opens payment with no cash, so the whole bill goes on the customer's khata. */
  const [paymentMode, setPaymentMode] = useState<'cash' | 'credit'>('cash');
  const [removedCreditDiscount, setRemovedCreditDiscount] = useState(0);
  const [voicePayRequest, setVoicePayRequest] = useState<VoicePayRequest | null>(null);
  const handledVoicePayRequest = useRef<VoicePayRequest | null>(null);
  const voicePaymentInFlight = useRef(false);
  const billCustomer = useLiveQuery(() => (customerId ? db.customers.get(customerId) : undefined), [customerId]);
  const specialCustomerPricing = settings?.businessPricingEnabled !== false && billCustomer?.shopkeeperPricing === true;
  const searchRef = useRef<HTMLInputElement>(null);
  const gharQuoteRequest = useRef(0);
  const cartItemsRef = useRef<HTMLDivElement>(null);
  const cartLineRefs = useRef(new Map<string, HTMLLIElement>());
  const [lastAddedProductId, setLastAddedProductId] = useState<string | null>(null);

  const pricing = useMemo(() => {
    if (!settings || gharQuoteMode || gharOrderId || cart.length === 0) return null;
    return calculatePricing({
      lines: cart.map(({ productId, qty, price }) => ({ productId, qty, ...(price !== products.find((product) => product.id === productId)?.salePrice ? { price } : {}) })),
      products: products.map((product) => ({
        id: product.id,
        salePrice: product.salePrice,
        thresholdPrice: product.thresholdPrice,
        wholesalePrice: product.wholesalePrice,
        quantityPrices: product.quantityPrices,
        categoryId: product.categoryId,
      })),
      settings: {
        autoDiscountEnabled: settings.autoDiscountEnabled ?? true,
        threshold: settings.autoDiscountMinOrder,
        defaultPercent: settings.autoDiscountPct,
        maxPercent: settings.autoDiscountMaxPct,
        categoryRules: settings.autoDiscountCategoryRules?.length
          ? settings.autoDiscountCategoryRules
          : settings.autoDiscountCategoryId && settings.autoDiscountCategoryId !== 'all'
            ? [{ categoryId: settings.autoDiscountCategoryId, percent: settings.autoDiscountPct, enabled: true }]
            : [],
        deliveryEnabled: settings.homeDeliveryEnabled ?? true,
        deliveryCharge: settings.deliveryCharge ?? settings.gharDeliveryFee ?? 0,
        freeDeliveryThreshold: settings.freeDeliveryThreshold ?? settings.gharFreeDeliveryThreshold ?? 0,
        businessPricingEnabled: settings.businessPricingEnabled ?? true,
      },
      pricingMode: specialCustomerPricing ? 'business' : 'normal',
      paymentMethod: paymentMode,
      homeDelivery,
    });
  }, [settings, gharQuoteMode, gharOrderId, cart, products, specialCustomerPricing, paymentMode, homeDelivery]);
  const lineDiscountTotal = pricing?.discountAmount ?? 0;
  const subtotal = pricing ? pricing.subtotal : cartSubtotal(cart);
  const rawSubtotal = pricing?.eligibleSubtotal ?? cart.reduce((sum, line) => sum + Math.round(line.price * line.qty), 0);
  const activeDeliveryFee = pricing?.deliveryCharge ?? (gharQuoteMode || gharOrderId ? deliveryFee : 0);
  const total = subtotal - lineDiscountTotal - discount + activeDeliveryFee;
  const pairSuggestions = useMemo(() => {
    if (gharOrderId || gharQuoteMode) return [];
    return (settings?.productPairRules ?? []).flatMap((rule) => {
      if (!rule.enabled || !rule.triggerQuantities.some((quantity) => Math.abs((cart.find((line) => line.productId === rule.triggerProductId)?.qty ?? 0) - quantity) < 0.001)) return [];
      const product = products.find((entry) => entry.id === rule.companionProductId && entry.active);
      if (!product) return [];
      const existingQty = cart.find((line) => line.productId === product.id)?.qty ?? 0;
      if (existingQty >= rule.companionQty) return [];
      return [{ product, qty: roundQty(rule.companionQty - existingQty), triggerName: products.find((entry) => entry.id === rule.triggerProductId)?.name ?? 'Product' }];
    }).slice(0, 3);
  }, [settings?.productPairRules, gharOrderId, gharQuoteMode, cart, products]);

  useEffect(() => {
    if (homeDelivery) {
      const address = billCustomer?.address ?? '';
      setDeliveryAddress(address);
      if (gharQuoteMode) setGharAddress(address);
    }
  }, [gharQuoteMode, homeDelivery, customerId, billCustomer?.address]);

  const visible = useMemo(() => {
    const s = search.trim().toLowerCase();
    let list = products;
    if (s) {
      list = list.filter(
        (p) => p.name.toLowerCase().includes(s) || p.sku.toLowerCase() === s || p.barcode === s || p.nameUr?.includes(search.trim()),
      );
    } else if (category === 'fav') {
      list = list.filter((p) => p.favorite);
      if (list.length === 0) list = products;
    } else if (category !== 'all') {
      list = list.filter((p) => p.categoryId === category);
    }
    if (!s && category === 'all') {
      return [...list]
        .sort((a, b) => (invoiceCounts.get(b.id) ?? 0) - (invoiceCounts.get(a.id) ?? 0) || a.name.localeCompare(b.name))
        .slice(0, 20);
    }
    return [...list].sort((a, b) => a.name.localeCompare(b.name)).slice(0, 60);
  }, [products, search, category, invoiceCounts]);

  const stockVisibleToThisCart = (product: Product) => {
    return product.stock;
  };

  const maxCartQuantity = (product: Product) => {
    if (product.trackStock === false) return Number.POSITIVE_INFINITY;
    return Math.max(0, product.stock);
  };

  const allowsFractionalQuantity = (product: Product) => {
    const categoryName = categories.find((entry) => entry.id === product.categoryId)?.name;
    return supportsFractionalSaleQuantity(categoryName);
  };

  const addProduct = useCallback(
    (p: Product, q = 1) => {
      if (gharOrderId) return false;
      const inCurrentCart = cart.find((line) => line.productId === p.id)?.qty ?? 0;
      const maxQty = maxCartQuantity(p);
      if (inCurrentCart + q > maxQty) {
        toast(`${p.name}: only ${fmtQty(Math.max(0, maxQty - inCurrentCart))} more available`, 'error');
        return false;
      }
      setLastAddedProductId(p.id);
      setCart((c) => {
        const existing = c.find((l) => l.productId === p.id);
        if (existing) return c.map((l) => (l.productId === p.id ? { ...l, qty: roundQty(l.qty + q) } : l));
        return [...c, { productId: p.id, name: p.name, unit: p.unit, qty: q, price: p.salePrice, discount: 0 }];
      });
      return true;
    },
    [gharOrderId, cart, toast],
  );

  /** Enter in the search box: exact barcode/SKU first (USB scanners type the code + Enter), else first match. */
  const onSearchEnter = () => {
    const s = search.trim();
    if (!s) return;
    const exact = products.find((p) => p.barcode === s || p.sku.toLowerCase() === s.toLowerCase());
    const pick = exact ?? (visible.length === 1 ? visible[0] : undefined);
    if (pick) {
      addProduct(pick);
      setSearch('');
    } else if (visible.length === 0) toast(`No product found for "${s}"`, 'error');
  };

  const setLine = (productId: string, patch: Partial<CartLine>) => {
    if (patch.qty !== undefined) {
      const product = products.find((entry) => entry.id === productId);
      if (product && !allowsFractionalQuantity(product) && !Number.isInteger(patch.qty)) {
        toast(`${product.name}: quantity must be a whole number`, 'error');
        return false;
      }
      if (product && patch.qty > maxCartQuantity(product)) {
        toast(`${product.name}: maximum available quantity is ${fmtQty(maxCartQuantity(product))}`, 'error');
        return false;
      }
    }
    setCart((c) => c.map((l) => (l.productId === productId ? { ...l, ...patch } : l)));
    return true;
  };
  const removeLine = (productId: string) => setCart((c) => c.filter((l) => l.productId !== productId));

  useEffect(() => {
    if (!lastAddedProductId || !window.matchMedia('(min-width: 1024px)').matches) return;
    const container = cartItemsRef.current;
    const line = cartLineRefs.current.get(lastAddedProductId);
    if (!container || !line) return;
    const containerBounds = container.getBoundingClientRect();
    const lineBounds = line.getBoundingClientRect();
    if (lineBounds.bottom > containerBounds.bottom) {
      container.scrollTo({ top: container.scrollTop + lineBounds.bottom - containerBounds.bottom, behavior: 'smooth' });
    } else if (lineBounds.top < containerBounds.top) {
      container.scrollTo({ top: container.scrollTop - (containerBounds.top - lineBounds.top), behavior: 'smooth' });
    }
  }, [cart, lastAddedProductId]);

  const selectGharMode = (ghar: boolean) => {
    if (gharOrderId || ghar === gharQuoteMode) return;
    if (ghar) {
      setGharQuoteMode(true);
      setHomeDelivery(false);
      setDiscount(0);
      setPaymentMode('cash');
      setGharAddress('');
      setGharQuoteError('');
      setSearch('');
      return;
    }
    setGharQuoteMode(false);
    setHomeDelivery(false);
    setDeliveryFee(0);
    setGharAddress('');
    setGharNote('');
    setGharQuoteError('');
    setCart((current) => current.map((line) => ({
      ...line,
      price: products.find((product) => product.id === line.productId)?.salePrice ?? line.price,
      discount: 0,
    })));
  };

  const reset = () => {
    setCart([]);
    setDiscount(0);
    setDeliveryFee(0);
    setGharOrderId(undefined);
    setGharQuoteMode(false);
    setHomeDelivery(false);
    setDeliveryAddress('');
    setGharAddress('');
    setGharNote('');
    setGharQuoteError('');
    setGharQuotePending(false);
    setCustomerId(undefined);
    setPaymentMode('cash');
    setSearch('');
    searchRef.current?.focus();
  };

  useEffect(() => {
    const state = location.state as { gharOrder?: GharOrder; gharQuoteMode?: boolean } | null;
    const order = state?.gharOrder;
    if (state?.gharQuoteMode) {
      setCart([]);
      setCustomerId(undefined);
      setDiscount(0);
      setDeliveryFee(0);
      setGharOrderId(undefined);
      setGharQuoteMode(true);
      setHomeDelivery(false);
      setGharAddress('');
      setGharNote('Monthly ration');
      setPaymentMode('cash');
    } else if (order) {
      setCart(order.items.map((item) => ({ productId: item.productId, name: item.name, unit: item.unit, qty: item.qty, price: item.price, discount: 0 })));
      setDiscount(0);
      setCustomerId(order.customerId);
      setDeliveryFee(order.deliveryFee);
      setGharOrderId(order.id);
      setGharQuoteMode(false);
      setHomeDelivery(!!order.address.trim());
      setDeliveryAddress(order.address);
      setGharAddress(order.address);
      setGharNote(order.note ?? '');
      setPaymentMode('cash');
    } else return;
    navigate('/pos', { replace: true, state: null });
  }, [location.state, navigate]);

  useEffect(() => {
    if (!gharQuoteMode || gharOrderId || cart.length === 0) return;
    const request = ++gharQuoteRequest.current;
    setGharQuotePending(true);
    const applyPrices = (lines: Array<{ productId: string; price: number }>, fee: number) => {
      if (request !== gharQuoteRequest.current) return;
      setCart((current) => {
        let changed = false;
        const next = current.map((line) => {
          const quote = lines.find((entry) => entry.productId === line.productId);
          if (!quote || quote.price === line.price) return line;
          changed = true;
          return { ...line, price: quote.price, discount: 0 };
        });
        return changed ? next : current;
      });
      setDeliveryFee(homeDelivery ? fee : 0);
      setGharQuoteError('');
      setGharQuotePending(false);
    };

    const gharPricing = calculatePricing({
      lines: cart.filter((line) => line.qty > 0).map(({ productId, qty }) => ({ productId, qty })),
      products: products.map((product) => ({ id: product.id, salePrice: product.salePrice, thresholdPrice: product.thresholdPrice, wholesalePrice: product.wholesalePrice, categoryId: product.categoryId })),
      settings: {
        autoDiscountEnabled: settings?.autoDiscountEnabled ?? true,
        threshold: settings?.autoDiscountMinOrder ?? settings?.gharFreeDeliveryThreshold ?? 400000,
        defaultPercent: settings?.autoDiscountPct ?? settings?.gharDiscountPct ?? 5,
        maxPercent: settings?.autoDiscountMaxPct ?? 70,
        categoryRules: settings?.autoDiscountCategoryRules?.length
          ? settings.autoDiscountCategoryRules
          : settings?.autoDiscountCategoryId && settings.autoDiscountCategoryId !== 'all'
            ? [{ categoryId: settings.autoDiscountCategoryId, percent: settings.autoDiscountPct ?? 5, enabled: true }]
            : [],
        deliveryEnabled: settings?.homeDeliveryEnabled ?? true,
        deliveryCharge: settings?.deliveryCharge ?? settings?.gharDeliveryFee ?? 15000,
        freeDeliveryThreshold: settings?.freeDeliveryThreshold ?? settings?.gharFreeDeliveryThreshold ?? 400000,
        businessPricingEnabled: settings?.businessPricingEnabled ?? true,
      },
      homeDelivery,
    });
    const minimumMarginPct = Math.min(99, Math.max(0, settings?.gharMinimumMarginPct ?? 10));
    const lines = cart.map((line) => {
      const product = products.find((entry) => entry.id === line.productId);
      if (!product) return { productId: line.productId, price: line.price };
      const calculated = gharPricing.lines.find((entry) => entry.productId === product.id);
      const discountedPrice = calculated ? product.salePrice - calculated.discount / line.qty : product.salePrice;
      const floor = product.cost > 0 ? Math.ceil((product.cost * 100) / (100 - minimumMarginPct)) : 0;
      return { productId: product.id, price: Math.min(product.salePrice, Math.max(Math.round(discountedPrice), floor)) };
    });
    const fee = gharPricing.deliveryCharge;
    applyPrices(lines, fee);
  }, [cart, gharQuoteMode, gharOrderId, homeDelivery, products, settings]);

  const holdCart = async () => {
    if (cart.length === 0) return;
    await db.heldCarts.add({ id: uid(), label: `Bill ${held.length + 1} · ${rs(total)}`, date: nowIso(), customerId, items: cart.map((l) => ({ ...l, cost: 0, returnedQty: 0 })), discount });
    toast('Bill put on hold');
    reset();
  };

  const maxDiscountOk = () => {
    if (user.role !== 'cashier' || subtotal === 0) return true;
    const manualDiscountLimitBase = Math.max(0, subtotal - lineDiscountTotal);
    return manualDiscountLimitBase === 0
      ? discount === 0
      : (discount / manualDiscountLimitBase) * 100 <= (settings?.cashierMaxDiscount ?? 5) + 0.001;
  };

  const startPay = () => {
    if (gharQuoteMode) return;
    if (cart.length === 0) return;
    if (total < 0) return toast('Discount is more than the bill', 'error');
    if (!maxDiscountOk()) return toast(`Cashier discount limit is ${settings?.cashierMaxDiscount}% — ask the manager`, 'error');
    if (paymentMode === 'credit' && !customerId) return toast('Udhaar ke liye customer select karein', 'error');
    if (homeDelivery && (!customerId || !deliveryAddress.trim())) return toast('Home delivery requires a selected customer and delivery address', 'error');
    if (customerId && !billCustomer) return toast('Customer details are still loading. Please try again.', 'error');
    searchRef.current?.blur();
    setPaying(true);
  };

  const saveGharInvoice = () => run(async () => {
    if (!customerId) throw new Error('Select a customer for the monthly ration invoice');
    if (homeDelivery && !gharAddress.trim()) throw new Error('Enter the home delivery address');
    const items = cart.filter((line) => line.qty > 0);
    if (items.length === 0) throw new Error('Add at least one product');
    const id = uid();
    const date = nowIso();
    const customer = await db.customers.get(customerId);
    if (!customer) throw new Error('Customer is not available');
    const order: GharOrder = {
      id,
      no: `GH-${date.slice(2, 7).replace('-', '')}-${id.slice(0, 5).toUpperCase()}`,
      date,
      customerId,
      customerName: customer.name,
      phone: customer.phone,
      address: homeDelivery ? gharAddress.trim() : 'Shop pickup',
      items: items.map((line) => {
        const product = products.find((entry) => entry.id === line.productId);
        return {
          productId: line.productId,
          name: line.name,
          unit: line.unit,
          qty: line.qty,
          price: line.price,
          regularPrice: product?.salePrice ?? line.price,
          cost: product?.cost ?? 0,
        };
      }),
      subtotal,
      deliveryFee,
      total,
      status: 'invoice_draft',
      ...(gharNote.trim() ? { note: gharNote.trim() } : {}),
      userId: user.id,
    };
    await db.gharOrders.add(order);
    navigate('/pos');
  }, 'Monthly ration invoice saved');

  const savePaidSale = async (payments: { accountId: string; amount: number }[], note?: string) => {
    const sale = await completeSale({
      items: cart.filter((line) => line.qty > 0).map((line) => {
        const calculated = pricing?.lines.find((entry) => entry.productId === line.productId);
        return { ...line, price: calculated?.price ?? line.price, discount: calculated?.discount ?? line.discount };
      }),
      discount,
      deliveryFee: activeDeliveryFee,
      ...(homeDelivery ? { deliveryAddress: gharQuoteMode ? gharAddress.trim() : deliveryAddress.trim() } : {}),
      pricingMode: specialCustomerPricing ? 'business' : 'normal',
      paymentMethod: paymentMode,
      homeDelivery,
      ...(gharOrderId ? { gharOrderId } : {}),
      ...(customerId ? { customerId } : {}),
      payments,
      ...(note ? { note } : {}),
    });
    setPaying(false);
    setReceipt(sale);
    reset();
    return sale;
  };

  useEffect(() => searchRef.current?.focus(), []);

  // Voice billing fills this same bill through the same functions as tapping and typing.
  const voice = useVoiceAssistant({
    voiceShortcutKeys: posPrefs?.actionShortcuts?.voice ?? DEFAULT_ACTION_SHORTCUTS.voice,
    cartQty: (id) => cart.find((l) => l.productId === id)?.qty ?? 0,
    customerId,
    addToBill: addProduct,
    setCustomer: setCustomerId,
    setPayment: (mode) => {
      if (mode === 'credit') setRemovedCreditDiscount(pricing?.discountAmount ?? 0);
      else setRemovedCreditDiscount(0);
      setPaymentMode(mode);
    },
    payNow: (mode) => {
      if (voicePaymentInFlight.current) return Promise.resolve(false);
      voicePaymentInFlight.current = true;
      return new Promise((resolve) => {
        setPaymentMode(mode);
        setRemovedCreditDiscount(mode === 'credit' ? pricing?.discountAmount ?? 0 : 0);
        setVoicePayRequest({ mode, resolve });
      });
    },
    searchProduct: (text) => {
      setSearch(text);
      searchRef.current?.focus();
    },
    userId: user.id,
    canKhataAmount: can('void'),
  });
  useEffect(() => {
    if (!voicePayRequest || handledVoicePayRequest.current === voicePayRequest) return;
    const request = voicePayRequest;
    handledVoicePayRequest.current = request;
    setVoicePayRequest(null);
    void run(async () => {
      if (gharQuoteMode) throw new OpError('Monthly ration invoices cannot be paid through voice checkout');
      if (cart.length === 0) throw new OpError('Add at least one product before saying cash');
      if (total < 0) throw new OpError('Discount is more than the bill');
      if (!maxDiscountOk()) throw new OpError(`Cashier discount limit is ${settings?.cashierMaxDiscount}% — ask the manager`);
      if (request.mode === 'credit' && !customerId) throw new OpError('Select a customer to put the bill on udhaar');
      if (homeDelivery && (!customerId || !deliveryAddress.trim())) throw new OpError('Home delivery requires a selected customer and delivery address');
      if (customerId && !billCustomer) throw new OpError('Customer details are still loading. Please try again.');
      await savePaidSale(request.mode === 'cash' ? [{ accountId: ACCOUNT_IDS.cash, amount: total }] : []);
    }, request.mode === 'cash' ? 'Cash sale completed by voice' : 'Udhaar sale saved by voice').then((success) => {
      voicePaymentInFlight.current = false;
      request.resolve(success);
    });
  }, [voicePayRequest, run, gharQuoteMode, cart, total, settings?.cashierMaxDiscount, customerId, homeDelivery, deliveryAddress, billCustomer, savePaidSale]);
  useEffect(() => {
    if (gharOrderId || gharQuoteMode) voice.stopHandsFree();
  }, [gharOrderId, gharQuoteMode, voice.stopHandsFree]);

  // Product quick-add keys always require Shift so plain letters remain safe to type.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector('[data-modal]')) return;
      const key = shortcutFromKeyboardEvent(e);
      const shortcuts = { ...DEFAULT_ACTION_SHORTCUTS, ...posPrefs?.actionShortcuts };
      const matchesAction = (action: keyof typeof DEFAULT_ACTION_SHORTCUTS) =>
        (shortcuts[action] ?? DEFAULT_ACTION_SHORTCUTS[action]).some((binding) =>
          normalizeShortcutKey(binding) === key && !(editingText && /^[a-z]$/i.test(binding)),
        );
      const activeElement = document.activeElement as HTMLElement | null;
      const editingText = !!activeElement && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA' || activeElement.tagName === 'SELECT' || activeElement.isContentEditable);
      if (matchesAction('focusSearch')) {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (matchesAction('customer') && !gharOrderId) {
        e.preventDefault();
        setCustomerFocusRequest((request) => request + 1);
      }
      if (matchesAction('hold') && cart.length > 0 && !gharQuoteMode) {
        e.preventDefault();
        void holdCart();
      }
      if (matchesAction('recall') && held.length > 0 && !gharQuoteMode) {
        e.preventDefault();
        setShowHeld(true);
      }
      if (matchesAction('delivery') && !gharOrderId && settings?.homeDeliveryEnabled !== false) {
        e.preventDefault();
        setHomeDelivery((enabled) => !enabled);
      }
      if (matchesAction('clear') && cart.length > 0) {
        e.preventDefault();
        reset();
      }
      if (matchesAction('ration') && can('ration') && !gharOrderId) {
        e.preventDefault();
        selectGharMode(!gharQuoteMode);
      }
      if (matchesAction('paymentMode') && !gharQuoteMode && !gharOrderId) {
        e.preventDefault();
        setPaymentMode((mode) => mode === 'cash' ? 'credit' : 'cash');
      }
      if (matchesAction('increaseQty') && selectedProductId && !gharOrderId) {
        const line = cart.find((item) => item.productId === selectedProductId);
        if (line) {
          e.preventDefault();
          setLine(line.productId, { qty: roundQty(line.qty + 1) });
        }
      }
      if (matchesAction('decreaseQty') && selectedProductId && !gharOrderId) {
        const line = cart.find((item) => item.productId === selectedProductId);
        if (line) {
          e.preventDefault();
          if (line.qty > 1) setLine(line.productId, { qty: roundQty(line.qty - 1) });
          else removeLine(line.productId);
        }
      }
      if (matchesAction('pay') && !paying) {
        e.preventDefault();
        startPay();
      }
      if (matchesAction('remove') && !editingText && selectedProductId && !gharOrderId) {
        e.preventDefault();
        removeLine(selectedProductId);
        setSelectedProductId(null);
      }
      if (e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey && !gharOrderId) {
        const productShortcut = posPrefs?.productShortcuts?.find((shortcut) => normalizeShortcutKey(shortcut.key) === normalizeShortcutKey(e.key));
        const product = productShortcut ? products.find((entry) => entry.id === productShortcut.productId && entry.active) : undefined;
        if (product) {
          e.preventDefault();
          addProduct(product);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [posPrefs, gharOrderId, settings?.homeDeliveryEnabled, cart, gharQuoteMode, held, paying, selectedProductId, products, addProduct, can]);

  return (
    <div className="-m-4 flex min-h-full flex-col bg-slate-100 p-3 pb-24 sm:p-4 lg:-m-6 lg:h-[calc(100vh-49px)] lg:flex-row lg:gap-4 lg:overflow-hidden lg:p-4 lg:pb-4">
      <section className="flex min-h-[50vh] min-w-0 flex-1 flex-col lg:min-h-0">
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1">
          <Button
            size="sm"
            className="px-2 py-1 text-xs"
            variant={gharQuoteMode ? 'secondary' : 'ghost'}
            disabled={!!gharOrderId || !can('ration')}
            aria-pressed={gharQuoteMode || !!gharOrderId}
            onClick={() => selectGharMode(!gharQuoteMode)}
          >
            <Home size={14} /> {gharQuoteMode ? 'Regular sale' : 'Ration order'}
          </Button>
          <Button size="sm" variant="ghost" className="px-2 py-1" title="Keyboard shortcuts" aria-label="Keyboard shortcuts" onClick={() => setShowShortcuts(true)}>
            <Keyboard size={15} />
          </Button>
          </div>
          <span className="text-[10px] text-slate-500">Live stock</span>
        </div>
        <div className="relative mb-1.5 rounded-lg border border-slate-200 bg-white p-1 shadow-sm">
          <Search size={16} className="absolute top-1/2 left-4 -translate-y-1/2 text-teal-700" />
          <Input
            ref={searchRef}
            className="border-0 py-1.5 pl-8 text-sm shadow-none focus:ring-0"
            placeholder="Scan barcode or search product…  F1"
            value={search}
            disabled={!!gharOrderId}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onSearchEnter()}
          />
        </div>
        <div className="mb-1.5 flex gap-1 overflow-x-auto pb-0.5">
          {[{ id: 'fav', name: '★ Favourites' }, { id: 'all', name: 'Top sellers' }, ...categories].map((c) => (
            <button
              key={c.id}
              disabled={!!gharOrderId}
              onClick={() => {
                setCategory(c.id);
                setSearch('');
              }}
              className={cx(
                'shrink-0 rounded-md border px-2 py-0.5 text-[11px] font-medium transition-colors',
                category === c.id && !search ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-400 hover:text-slate-900',
              )}
            >
              {c.name}
            </button>
          ))}
        </div>
        <div className="grid min-h-0 flex-1 auto-rows-min grid-cols-2 gap-1 overflow-y-auto pr-1 sm:grid-cols-3 xl:grid-cols-4">
          {visible.map((p) => (
            <button
              key={p.id}
              onClick={() => addProduct(p)}
              disabled={!!gharOrderId}
              className="group flex h-[58px] min-h-0 flex-col justify-between rounded-md border border-slate-200 bg-white px-2 py-1.5 text-left transition hover:border-teal-600 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-60"
            >
              <div className="flex items-start justify-between gap-1">
                <span className="line-clamp-1 text-xs font-semibold leading-4 text-slate-800 group-hover:text-teal-800">{p.name}</span>
                {p.favorite && <Star size={12} className="shrink-0 fill-amber-400 text-amber-500" />}
              </div>
              <div className="flex items-end justify-between gap-1">
                <span className="text-xs font-bold tabular-nums text-slate-900">{rs(p.salePrice)}</span>
                <span className={cx('truncate text-[10px]', stockVisibleToThisCart(p) <= 0 ? 'text-rose-600' : stockVisibleToThisCart(p) <= p.minStock ? 'text-amber-600' : 'text-slate-400')}>
                  {fmtQty(stockVisibleToThisCart(p))} {p.unit}
                </span>
              </div>
            </button>
          ))}
          {visible.length === 0 && (
            <div className="col-span-full">
              <Empty icon={<Search size={36} />} title="No products found">
                {can('products') ? 'Add products from the Products page.' : 'Ask the owner to add this product.'}
              </Empty>
            </div>
          )}
        </div>
      </section>

      {/* Cart */}
      <section className="flex min-h-0 w-full flex-col overflow-hidden rounded-lg border border-slate-300 bg-white shadow-lg lg:min-h-0 lg:w-[410px] lg:shrink-0">
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-950 px-3 py-2 text-white">
          <h2 className="flex items-center gap-2 font-semibold">
            <ShoppingCart size={18} className="text-teal-300" /> Current bill <span className="rounded bg-white/10 px-1.5 py-0.5 text-xs font-normal text-slate-300">{cart.length}</span>
          </h2>
          <div className="flex gap-1">
            {!gharOrderId && !gharQuoteMode && held.length > 0 && (
              <Button size="sm" variant="secondary" onClick={() => setShowHeld(true)}>
                Held ({held.length})
              </Button>
            )}
            {!gharOrderId && !gharQuoteMode && <Button size="sm" variant="ghost" onClick={holdCart} disabled={cart.length === 0} title="Hold bill">
              <PauseCircle size={16} /> Hold
            </Button>}
            <Button size="sm" variant="ghost" className="text-slate-300 hover:text-white hover:bg-white/10" onClick={reset} disabled={cart.length === 0} title="Clear">
              <Trash2 size={16} />
            </Button>
          </div>
        </div>
        <div className="border-b border-slate-100 bg-slate-50/70 p-2">
          {gharOrderId ? (
            <div className="rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-sm">
              <div className="font-medium">Ghar se ghar tak · {billCustomer?.name ?? 'Customer'}</div>
              <div className="text-xs text-slate-600">Confirmed delivery order · customer and quoted rates are locked</div>
            </div>
          ) : <CustomerPicker value={customerId} onChange={(id) => {
            setCustomerId(id);
          }} focusRequest={customerFocusRequest} />}
          {!gharOrderId && <div className="mt-1 flex flex-wrap gap-0.5">
            {!gharQuoteMode && billCustomer?.shopkeeperPricing && (
              <span className={cx('rounded-md px-2 py-1 text-xs font-medium', specialCustomerPricing ? 'bg-sky-100 text-sky-800' : 'bg-amber-100 text-amber-800')}>
                {specialCustomerPricing ? 'Special customer rate on' : 'Special customer rate disabled in Settings'}
              </span>
            )}
          </div>}
          {homeDelivery && !gharOrderId && <div className="mt-3">
            <Field label="Delivery address">
              <Input value={gharQuoteMode ? gharAddress : deliveryAddress} onChange={(event) => gharQuoteMode ? setGharAddress(event.target.value) : setDeliveryAddress(event.target.value)} placeholder="Required for home delivery" />
            </Field>
          </div>}
          {gharQuoteMode && <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <Field label="Invoice note"><Input value={gharNote} onChange={(event) => setGharNote(event.target.value)} placeholder="Monthly ration" /></Field>
          </div>}
          {gharQuoteMode && gharQuoteError && <div role="alert" className="mt-2 text-sm text-rose-700">{gharQuoteError}</div>}
        </div>
        {!gharOrderId && voice.panel}
        <div ref={cartItemsRef} className="min-h-0 flex-1 overflow-y-auto">
          {cart.length === 0 ? (
            <Empty icon={<ShoppingCart size={36} />} title="Bill is empty">
              Tap a product or scan a barcode.
            </Empty>
          ) : (
            <ul className="divide-y divide-slate-100">
              {cart.map((l) => {
                const calculated = pricing?.lines.find((line) => line.productId === l.productId);
                const displayPrice = calculated?.price ?? l.price;
                const displayDiscount = calculated?.discount ?? l.discount;
                const product = products.find((entry) => entry.id === l.productId);
                const allowFractional = product ? allowsFractionalQuantity(product) : false;
                return <li ref={(node) => { if (node) cartLineRefs.current.set(l.productId, node); else cartLineRefs.current.delete(l.productId); }} key={l.productId} tabIndex={0} onFocus={() => setSelectedProductId(l.productId)} onClick={() => setSelectedProductId(l.productId)} className={cx('px-2 py-1.5 outline-none focus:bg-sky-50', selectedProductId === l.productId && 'bg-slate-50')}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 text-sm font-medium">{l.name}</div>
                    <div className="text-right text-sm font-semibold tabular-nums">
                      {rs(lineTotal(displayPrice, l.qty) - displayDiscount)}
                      {displayDiscount > 0 && <div className="text-xs font-normal text-emerald-700">-{rs(displayDiscount)} · {calculated?.discountPercent.toFixed(1)}%</div>}
                      {calculated?.rule === 'business' && <div className="text-xs font-normal text-sky-700">Shopkeeper rate</div>}
                      {calculated?.rule === 'quantity-bundle' && <div className="text-xs font-normal text-emerald-700">Bundle rate</div>}
                    </div>
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <button disabled={!!gharOrderId} className="rounded border border-slate-300 p-1 hover:bg-slate-50 disabled:opacity-40" onClick={() => (l.qty > 1 ? setLine(l.productId, { qty: roundQty(l.qty - 1) }) : removeLine(l.productId))}>
                      <Minus size={14} />
                    </button>
                    <CartQuantityInput
                      quantity={l.qty}
                      allowFractional={allowFractional}
                      disabled={!!gharOrderId}
                      onCommit={(qty) => setLine(l.productId, { qty })}
                    />
                    <button disabled={!!gharOrderId} className="rounded border border-slate-300 p-1 hover:bg-slate-50 disabled:opacity-40" onClick={() => setLine(l.productId, { qty: roundQty(l.qty + 1) })}>
                      <Plus size={14} />
                    </button>
                    <span className="text-xs text-slate-500">
                      {l.unit} ×{' '}
                      {can('priceEdit') && !gharOrderId && !gharQuoteMode ? (
                        <input
                          className="w-20 rounded border border-slate-200 px-1 py-0.5 text-right text-xs"
                          inputMode="decimal"
                          defaultValue={l.price / 100}
                          onBlur={(e) => {
                            const v = Math.round(Number(e.target.value) * 100);
                            if (Number.isFinite(v) && v >= 0) setLine(l.productId, { price: v });
                          }}
                          title="Change price"
                        />
                      ) : (
                        rs(displayPrice)
                      )}
                    </span>
                    <button disabled={!!gharOrderId} className="ml-auto rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-40" onClick={() => removeLine(l.productId)} aria-label="Remove">
                      <Trash2 size={14} />
                    </button>
                  </div>
                  {allowFractional && (
                    <div className="mt-2 pl-1">
                      <CartAmountInput
                        disabled={!!gharOrderId}
                        unitPrice={displayPrice}
                        onCommit={(qty) => setLine(l.productId, { qty })}
                        onInvalidAmount={(message) => toast(message, 'error')}
                      />
                    </div>
                  )}
                </li>;
              })}
            </ul>
          )}
        </div>
        {pairSuggestions.length > 0 && (
          <div className="border-t border-teal-100 bg-teal-50 px-3 py-2">
            <p className="mb-1 text-xs font-semibold text-teal-900">Often sold together</p>
            {pairSuggestions.map(({ product, qty, triggerName }) => (
              <div key={product.id} className="flex items-center justify-between gap-2 py-1 text-xs">
                <span className="min-w-0 truncate text-teal-900">{triggerName} with {qty} {product.unit} {product.name}</span>
                <Button size="sm" variant="secondary" onClick={() => addProduct(product, qty)}>Add</Button>
              </div>
            ))}
          </div>
        )}
        <div className="space-y-1.5 border-t border-slate-200 bg-white p-2.5">
          <div className="flex justify-between text-sm text-slate-500"><span>Subtotal</span><span className="tabular-nums text-slate-800">{rs(subtotal)}</span></div>
          {lineDiscountTotal > 0 && <div className="flex justify-between text-sm text-emerald-700"><span>Auto discount · {pricing?.discountPercent.toFixed(1)}%</span><span className="tabular-nums">−{rs(lineDiscountTotal)}</span></div>}
          {paymentMode === 'credit' && removedCreditDiscount > 0 && <div className="flex justify-between text-sm text-amber-700"><span>Discount removed for Udhaar</span><span className="tabular-nums">+{rs(removedCreditDiscount)}</span></div>}
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="flex items-center gap-2 text-slate-500">
              Manual discount
              <MoneyInput className="w-24 py-1 text-right" value={discount} disabled={!!gharOrderId || gharQuoteMode} onChange={setDiscount} />
            </span>
            {activeDeliveryFee > 0 && <span className="text-slate-600">Delivery {rs(activeDeliveryFee)}</span>}
          </div>
          {(homeDelivery || gharOrderId || gharQuoteMode) && <div className="flex justify-between text-sm text-slate-600"><span>{homeDelivery ? 'Home delivery' : 'Collection'}</span><span>{homeDelivery ? (activeDeliveryFee ? rs(activeDeliveryFee) : 'Free') : 'No delivery'}</span></div>}
          <div className="mt-1 flex items-end justify-between border-t border-slate-200 pt-2">
            <span className="text-sm font-semibold text-slate-600">{paymentMode === 'credit' ? 'Total Udhaar' : 'Payable'}</span>
            <span className="text-2xl font-bold tabular-nums text-slate-950">{rs(total)}</span>
          </div>
          {!gharQuoteMode && <div className="grid grid-cols-2 gap-2">
            {(['cash', 'credit'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => {
                  if (m === 'credit') {
                    setRemovedCreditDiscount(pricing?.discountAmount ?? 0);
                  } else {
                    setRemovedCreditDiscount(0);
                    setPaying(false);
                  }
                  setPaymentMode(m);
                }}
                className={cx(
                  'rounded-md border py-2 text-sm font-semibold',
                  paymentMode === m
                    ? m === 'credit'
                      ? 'border-rose-600 bg-rose-600 text-white'
                      : 'border-emerald-600 bg-emerald-600 text-white'
                    : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50',
                )}
              >
                {m === 'cash' ? 'Cash' : 'Udhaar'}
              </button>
            ))}
          </div>}
          {!gharQuoteMode && paymentMode === 'credit' && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm">
              <div>
                Customer: <b>{billCustomer?.name ?? '— select above —'}</b>
              </div>
              <div>
                Total: <b>{rs(total)}</b> · Payment: <b className="text-rose-700">UDHAAR</b>
              </div>
            </div>
          )}
          {specialCustomerPricing && <div className="rounded border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900">Special customer pricing is active. Automatic threshold discounts are not stacked.</div>}
          {homeDelivery && <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">Delivery: {activeDeliveryFee ? rs(activeDeliveryFee) : 'Free'}{(gharQuoteMode ? gharAddress : deliveryAddress).trim() ? ` · ${(gharQuoteMode ? gharAddress : deliveryAddress).trim()}` : ' · address required'}</div>}
          {paymentMode === 'credit' && removedCreditDiscount > 0 && <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">Udhaar removed the automatic discount of {rs(removedCreditDiscount)}. The full remaining bill is recorded on the customer account.</div>}
          {!gharOrderId && !gharQuoteMode && <div className="flex items-center gap-2">
            <div className="w-32 shrink-0">{voice.button}</div>
            <div className="min-w-0 flex-1">{voice.controls}</div>
          </div>}
          {gharQuoteMode ? (
            <Button size="lg" className="w-full" disabled={cart.length === 0 || !customerId || (homeDelivery && !gharAddress.trim()) || !!gharQuoteError || gharQuotePending} onClick={() => void saveGharInvoice()}>
              <ShoppingCart size={17} /> {gharQuotePending ? 'Checking Ghar prices…' : `Save monthly invoice · ${rs(total)}`}
            </Button>
          ) : <Button size="lg" variant={paymentMode === 'credit' ? 'danger' : 'success'} className="w-full rounded-md py-2" disabled={cart.length === 0} onClick={startPay}>
            {paymentMode === 'credit' ? `Save udhaar bill — ${rs(total)} (F9)` : `Pay ${rs(total)} (F9)`}
          </Button>}
        </div>
      </section>

      {paying && (
        <PayModal
          total={total}
          customerId={customerId}
          startOnCredit={paymentMode === 'credit'}
          allowCredit={paymentMode === 'credit'}
          onSwitchToCash={() => {
            setRemovedCreditDiscount(0);
            setPaying(false);
            setPaymentMode('cash');
          }}
          onSwitchToCredit={() => {
            setRemovedCreditDiscount((current) => current || pricing?.discountAmount || 0);
            setPaymentMode('credit');
            if (!customerId) {
              setPaying(false);
              toast('Select a customer, then continue with Udhaar', 'error');
            }
          }}
          onClose={() => setPaying(false)}
          onPaid={async (payments, note) => { await savePaidSale(payments, note); }}
        />
      )}
      {receipt && <ReceiptModal sale={receipt} autoPrint onClose={() => { setReceipt(null); searchRef.current?.focus(); }} />}
      {showShortcuts && <Modal title="POS keyboard shortcuts" onClose={() => setShowShortcuts(false)}>
        <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
          {POS_ACTIONS.map(({ id, label, defaults }) => (
            <Fragment key={id}>
              <span>{(posPrefs?.actionShortcuts?.[id] ?? [...defaults]).join(' / ')}</span><span>{label}</span>
            </Fragment>
          ))}
          {posPrefs?.productShortcuts?.map((shortcut, index) => (
            <Fragment key={`${shortcut.productId}-${index}`}>
              <span>Shift+{shortcut.key.toLocaleUpperCase()}</span>
              <span>Add {products.find((product) => product.id === shortcut.productId)?.name ?? 'product'} · Shift+{shortcut.key.toLocaleUpperCase()} in search</span>
            </Fragment>
          ))}
          <span>Esc</span><span>Close the current dialog</span>
        </div>
        <p className="mt-4 text-xs text-slate-500">Customize POS actions and product letters in Settings → POS shortcuts. Hold a configured voice key to speak.</p>
      </Modal>}
      {!gharOrderId && voice.floatingButton}
      {showHeld && !gharQuoteMode && (
        <Modal title="Held bills" onClose={() => setShowHeld(false)}>
          <ul className="divide-y divide-slate-100">
            {held.map((h) => (
              <li key={h.id} className="flex items-center justify-between py-2">
                <span className="text-sm">{h.label}</span>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={async () => {
                      if (cart.length > 0) await holdCart();
                      setCart(h.items.map(({ cost: _c, returnedQty: _r, ...l }) => l));
                      setDiscount(h.discount);
                      setCustomerId(h.customerId);
                      await db.heldCarts.delete(h.id);
                      setShowHeld(false);
                    }}
                  >
                    Resume
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => db.heldCarts.delete(h.id)}>
                    <Trash2 size={14} />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </Modal>
      )}
    </div>
  );
}

/** Payment: cash with change, wallets/bank, split payment, remainder on udhaar. */
function PayModal({
  total,
  customerId,
  startOnCredit,
  allowCredit,
  onSwitchToCash,
  onSwitchToCredit,
  onClose,
  onPaid,
}: {
  total: number;
  customerId?: string;
  /** Udhaar bill: start with no cash received, so the full amount goes on the khata. */
  startOnCredit?: boolean;
  allowCredit: boolean;
  onSwitchToCash: () => void;
  onSwitchToCredit: () => void;
  onClose: () => void;
  onPaid: (payments: { accountId: string; amount: number }[], note?: string) => Promise<void>;
}) {
  const accounts = useLiveQuery(() => db.accounts.filter((a) => a.active).toArray(), []) ?? [];
  const balances = useLiveQuery(() => partyBalances('customer'), []) ?? new Map<string, number>();
  const customer = useLiveQuery(() => (customerId ? db.customers.get(customerId) : undefined), [customerId]);
  const [amounts, setAmounts] = useState<Record<string, number>>({ [ACCOUNT_IDS.cash]: startOnCredit ? 0 : total });
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const run = useAction();

  const paid = Object.values(amounts).reduce((s, v) => s + (v || 0), 0);
  const change = Math.max(0, paid - total);
  const credit = Math.max(0, total - paid);
  const newBalance = (customerId ? balances.get(customerId) ?? 0 : 0) + credit;
  const overLimit = customer && customer.creditLimit > 0 && credit > 0 && newBalance > customer.creditLimit;

  const set = (id: string, v: number) => setAmounts((a) => ({ ...a, [id]: v }));
  const quick = [total, ...[50000, 100000, 500000].filter((v) => v > total)].slice(0, 4);

  const submit = () =>
    run(async () => {
      if (credit > 0 && !allowCredit) throw new OpError(`Rs. ${rs(credit)} remains unpaid. Switch to Udhaar to put it on a customer account.`);
      if (credit > 0 && !customerId) throw new OpError('Select a customer to put the remaining amount on udhaar');
      setBusy(true);
      try {
        await onPaid(
          Object.entries(amounts).map(([accountId, amount]) => ({ accountId, amount })),
          note || undefined,
        );
      } finally {
        setBusy(false);
      }
    });

  return (
    <Modal
      title={`Payment — ${rs(total)}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Back
          </Button>
          {allowCredit && <Button variant="secondary" onClick={onSwitchToCash}>Switch to Cash</Button>}
          {credit > 0 && !allowCredit ? <Button variant="danger" size="lg" disabled={busy} onClick={onSwitchToCredit}>Switch to Udhaar — {rs(credit)} unpaid</Button>
            : <Button variant="success" size="lg" disabled={busy} onClick={submit}>{credit > 0 ? `Complete — ${rs(credit)} on udhaar` : 'Complete cash sale'}</Button>}
        </>
      }
    >
      <div className="grid gap-4">
        <Field label="Cash received">
          <MoneyInput
            className="py-3 text-lg"
            value={amounts[ACCOUNT_IDS.cash] ?? 0}
            onChange={(v) => set(ACCOUNT_IDS.cash, v)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            autoFocus
            onFocus={(e) => e.currentTarget.select()}
          />
        </Field>
        <div className="flex flex-wrap gap-2">
          {quick.map((v) => (
            <Button key={v} size="sm" variant="secondary" onClick={() => set(ACCOUNT_IDS.cash, v)}>
              {v === total ? 'Exact' : rs(v)}
            </Button>
          ))}
          <Button size="sm" variant="secondary" onClick={() => set(ACCOUNT_IDS.cash, 0)}>
            No cash
          </Button>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {accounts
            .filter((a) => a.id !== ACCOUNT_IDS.cash)
            .map((a) => (
              <Field key={a.id} label={a.name}>
                <MoneyInput value={amounts[a.id] ?? 0} onChange={(v) => set(a.id, v)} />
              </Field>
            ))}
        </div>
        <div className="rounded-lg bg-slate-50 p-3 text-sm">
          <div className="flex justify-between">
            <span>Paid</span>
            <span className="font-medium">{rs(paid)}</span>
          </div>
          {change > 0 && (
            <div className="flex justify-between text-lg font-bold text-emerald-700">
              <span>Change to give</span>
              <span>{rs(change)}</span>
            </div>
          )}
          {credit > 0 && (
            <div className="flex justify-between font-semibold text-rose-600">
              <span>Udhaar (goes to khata)</span>
              <span>{rs(credit)}</span>
            </div>
          )}
          {credit > 0 && !customerId && <p className="mt-1 text-rose-600">Select a customer on the bill for udhaar.</p>}
          {overLimit && (
            <p className="mt-1">
              <Badge tone="amber">Over credit limit</Badge> New balance {rs(newBalance)} / limit {rs(customer!.creditLimit)}
            </p>
          )}
        </div>
        <Field label="Note (optional)">
          <Input value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
