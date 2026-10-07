import {
  AMOUNT_GOODS,
  CASH_WORDS,
  CREDIT_WORDS,
  FILLERS,
  FRACTION_WORDS,
  NUMBER_WORDS,
  POSSESSIVE,
  PRICE_MARKERS,
  SEPARATORS,
  UNIT_WORDS,
  URDU_WORDS,
  type UnitKey,
} from './lexicon';

/**
 * Turns what the shopkeeper said into a structured command. It only interprets words;
 * products, prices, stock and customers are decided later against the shop's own database.
 */

export interface ParsedItem {
  /** Product words as spoken, e.g. "sooper classic biscuit". */
  spokenName: string;
  nameTokens: string[];
  quantity: number;
  /** False when no quantity was said ("ek Lux soap" → true, "Lux soap" → false; both mean 1). */
  quantityGiven: boolean;
  unit: UnitKey | null;
  /** Rupee price said with the product: "50 wale" → 50. */
  priceHint: number | null;
  /** Spend amount in rupees: "sugar 100 rs" → 100. */
  spendAmount: number | null;
  /** Pack size said after the quantity: "2 Coke 1.5 litre" → 1.5 l. */
  sizeHint: { value: number; unit: UnitKey } | null;
}

export type Intent = 'ADD_TO_BILL' | 'ADD_AMOUNT_TO_KHATA' | 'SET_BILL_DETAILS' | 'UNKNOWN';

export interface VoiceCommand {
  intent: Intent;
  text: string;
  customerName: string | null;
  items: ParsedItem[];
  /** "500 ka saman" → 500 (rupees). */
  amount: number | null;
  paymentMethod: 'cash' | 'credit' | null;
  /** True only when an explicit checkout command was spoken. */
  payNow: boolean;
}

const PAY_WORDS = new Set(['payment', 'checkout']);
const PAY_VERBS = new Set(['kar', 'karo', 'kro', 'kardo', 'krdo', 'karein', 'karen', 'kardain', 'kardena', 'کر', 'کرو', 'کریں', 'करो']);

const URDU_DIGITS: Record<string, string> = {
  '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9', '٫': '.',
};

export function tokenize(text: string): string[] {
  let s = text.normalize('NFC').toLowerCase();
  s = s.replace(/[۰-۹٠-٩٫]/g, (d) => URDU_DIGITS[d] ?? d);
  s = s.replace(/[،؛]/g, ' , ').replace(/[۔?!؟]/g, ' ');
  // "1.5l" → "1.5 l", "rs50" → "rs 50", "50wale" → "50 wale"
  s = s.replace(/(\d)([^\d\s.,])/g, '$1 $2').replace(/([^\d\s.,])(\d)/g, '$1 $2');
  s = s.replace(/,/g, ' , ').replace(/[^\p{L}\p{N}.,&+\s]/gu, ' ');
  s = s.replace(/\b(?:d?ouble)\s+a\b/g, ' aa ');
  return s
    .split(/\s+/)
    .map((t) => t.replace(/^\.+|\.+$/g, ''))
    .filter(Boolean)
    .map((t) => URDU_WORDS[t] ?? t);
}

function numberValue(t: string): number | null {
  if (/^\d+(\.\d+)?$/.test(t)) return Number(t);
  if (t in NUMBER_WORDS) return NUMBER_WORDS[t]!;
  if (t in FRACTION_WORDS) return FRACTION_WORDS[t]!;
  return null;
}

const isUnit = (t: string | undefined) => t !== undefined && t in UNIT_WORDS;
const isNumberish = (t: string | undefined) => t !== undefined && (numberValue(t) !== null || t === 'sawa' || t === 'pauna' || t === 'pao' || t === 'paao');

/** A word that can be part of a person's name. */
function isNameLike(t: string): boolean {
  return (
    numberValue(t) === null &&
    !isUnit(t) &&
    !SEPARATORS.has(t) &&
    !FILLERS.has(t) &&
    !CREDIT_WORDS.has(t) &&
    !CASH_WORDS.has(t) &&
    !['sawa', 'pauna'].includes(t)
  );
}

/** Is there a product word after position i (before the next separator)? */
function hasNameAhead(tokens: string[], i: number): boolean {
  for (let k = i; k < tokens.length; k++) {
    const t = tokens[k]!;
    if (SEPARATORS.has(t)) return false;
    if (isNumberish(t) || isUnit(t) || FILLERS.has(t) || PRICE_MARKERS.has(t)) continue;
    return true;
  }
  return false;
}

/** "do" is the number 2, unless it's the verb "de do" / "likh do" / "… do" at the end. */
function isVerbDo(tokens: string[], i: number): boolean {
  if (tokens[i] !== 'do') return false;
  const prev = tokens[i - 1];
  const next = tokens[i + 1];
  return prev === 'de' || prev === 'likh' || prev === 'kar' || next === undefined || SEPARATORS.has(next) || (FILLERS.has(next) && !isUnit(next));
}

export function parseCommand(
  text: string,
  options: {
    detectCustomer?: boolean;
    customerPrefixLength?: number;
    shouldStartNewProduct?: (currentNameTokens: string[], nextToken: string) => boolean;
  } = {},
): VoiceCommand {
  const raw = tokenize(text);
  const tokens = raw.filter((_, i) => !isVerbDo(raw, i));
  let payment: VoiceCommand['paymentMethod'] = null;
  let payNow = false;
  const used = new Array(tokens.length).fill(false);

  // 1. Payment words anywhere: "udhaar pe", "credit pe", "cash mein", "khate mein".
  tokens.forEach((t, i) => {
    const spokenPayParticle =
      t === 'pe' &&
      !CREDIT_WORDS.has(tokens[i - 1] ?? '') &&
      !CASH_WORDS.has(tokens[i - 1] ?? '') &&
      (i === tokens.length - 1 || PAY_VERBS.has(tokens[i + 1] ?? ''));
    if (PAY_WORDS.has(t) || spokenPayParticle) {
      payNow = true;
      used[i] = true;
      if (tokens[i - 1] === 'bill') used[i - 1] = true;
      if (tokens[i + 1] === 'bill') used[i + 1] = true;
      if (PAY_VERBS.has(tokens[i + 1] ?? '')) used[i + 1] = true;
    } else if (CREDIT_WORDS.has(t)) {
      payment = 'credit';
      used[i] = true;
    } else if (CASH_WORDS.has(t)) {
      payment = 'cash';
      payNow = true;
      used[i] = true;
    }
  });

  // 2. Customer at the start: "Malik Arif ka …", "Arif ke naam pe …", "Rashid ko …", "Ahmed ke khate mein …"
  let customerName: string | null = null;
  const marker = tokens.findIndex((t, i) => POSSESSIVE.has(t) && i >= 1 && i <= 4);
  if (
    options.detectCustomer !== false &&
    options.customerPrefixLength &&
    options.customerPrefixLength <= tokens.length &&
    tokens.slice(0, options.customerPrefixLength).every(isNameLike)
  ) {
    const prefixLength = options.customerPrefixLength;
    customerName = tokens.slice(0, prefixLength).join(' ');
    for (let k = 0; k < prefixLength; k++) used[k] = true;
    if (POSSESSIVE.has(tokens[prefixLength] ?? '')) {
      used[prefixLength] = true;
      const next = tokens[prefixLength + 1];
      if (next === 'naam' || next === 'khate' || next === 'khata') {
        payment ??= 'credit';
        used[prefixLength + 1] = true;
      }
    }
  } else if (options.detectCustomer !== false && marker > 0 && tokens.slice(0, marker).every(isNameLike)) {
    customerName = tokens.slice(0, marker).join(' ');
    for (let k = 0; k <= marker; k++) used[k] = true;
    const next = tokens[marker + 1];
    if (next === 'naam' || next === 'khate' || next === 'khata') {
      payment ??= 'credit';
      used[marker + 1] = true;
    }
  }

  // 3. "500 ka saman" / "500 rupay ka saman" → an amount, not a product.
  let amount: number | null = null;
  for (let i = 0; i < tokens.length; i++) {
    const v = numberValue(tokens[i]!);
    if (v === null || used[i]) continue;
    let k = i + 1;
    while (k < tokens.length && ['ka', 'ki', 'ke', 'rupay', 'rupaye', 'rupees', 'rs', 'rupee'].includes(tokens[k]!)) k++;
    if (k < tokens.length && AMOUNT_GOODS.has(tokens[k]!)) {
      amount = v;
      for (let j = i; j <= k; j++) used[j] = true;
    }
  }

  // 4. Items, split on "aur" / "," / "and".
  const rest = tokens.filter((_, i) => !used[i]);
  const items: ParsedItem[] = [];
  let cur = newItem();

  const flush = () => {
    if (cur.nameTokens.length > 0) {
      items.push({
        spokenName: cur.nameTokens.join(' '),
        nameTokens: cur.nameTokens,
        quantity: cur.qty ?? 1,
        quantityGiven: cur.qty !== null,
        unit: cur.unit,
        priceHint: cur.priceHint,
        spendAmount: cur.spendAmount,
        sizeHint: cur.sizeHint,
      });
    }
    cur = newItem();
  };

  for (let i = 0; i < rest.length; i++) {
    const t = rest[i]!;
    const next = rest[i + 1];

    if (SEPARATORS.has(t)) {
      flush();
      continue;
    }
    // Explicit currency amounts are budgets; "50 wale" remains a variant price hint.
    if ((t === 'rs' || t === 'rupay' || t === 'rupees') && next !== undefined && numberValue(next) !== null) {
      cur.spendAmount = numberValue(next);
      i++;
      continue;
    }

    // Quantity words, including "sawa do" (2.25), "pauna kilo" (0.75), "pao" (0.25 kg).
    let value = numberValue(t);
    let consumed = 0;
    if (t === 'sawa' || t === 'pauna') {
      const n = next !== undefined ? numberValue(next) : null;
      const delta = t === 'sawa' ? 0.25 : -0.25;
      value = n !== null ? n + delta : 1 + delta;
      consumed = n !== null ? 1 : 0;
    }
    if (value === null && UNIT_WORDS[t] === 'pao') {
      // "pao cheeni" / "ek pao" handled here when no number came before
      if (cur.qty === null) {
        cur.qty = 0.25;
        cur.unit = 'kg';
        continue;
      }
    }

    if (value !== null) {
      const after = rest[i + 1 + consumed];
      if (after && ['rs', 'rupay', 'rupaye', 'rupees', 'rupee', 'rupe', 'rupia'].includes(after)) {
        cur.spendAmount = value;
        i += 1 + consumed;
        continue;
      }
      if (after !== undefined && PRICE_MARKERS.has(after)) {
        cur.priceHint = value;
        i += 1 + consumed;
        continue;
      }
      if (isUnit(after)) {
        const unit = UNIT_WORDS[after!]!;
        const qtyValue = unit === 'pao' ? value * 0.25 : value;
        const qtyUnit: UnitKey = unit === 'pao' ? 'kg' : unit;
        if (cur.qty === null && cur.sizeHint === null) {
          cur.qty = qtyValue;
          cur.unit = qtyUnit;
        } else if (cur.nameTokens.length > 0 && hasNameAhead(rest, i + 2 + consumed)) {
          flush();
          cur.qty = qtyValue;
          cur.unit = qtyUnit;
        } else {
          cur.sizeHint = { value: qtyValue, unit: qtyUnit };
        }
        i += 1 + consumed;
        continue;
      }
      if (cur.qty === null && cur.nameTokens.length === 0) {
        cur.qty = value;
      } else if (cur.qty === null) {
        // "sooper 50" → price; "surf 2" → quantity
        if (value >= 10) cur.priceHint = value;
        else cur.qty = value;
      } else if (cur.nameTokens.length > 0 && hasNameAhead(rest, i + 1 + consumed)) {
        flush();
        cur.qty = value;
      } else {
        cur.priceHint = value;
      }
      i += consumed;
      continue;
    }

    if (isUnit(t)) {
      // Unit without a number: "packet surf" (= 1 packet). Inside a name ("family pack") keep it as a word.
      if (cur.qty === null && cur.nameTokens.length === 0) {
        cur.qty = 1;
        cur.unit = UNIT_WORDS[t]!;
        cur.qtyImplicit = true;
        continue;
      }
      if (cur.unit === null && cur.nameTokens.length === 0) {
        cur.unit = UNIT_WORDS[t]!;
        continue;
      }
      cur.nameTokens.push(t);
      continue;
    }
    if (FILLERS.has(t) || PRICE_MARKERS.has(t)) continue;
    if (cur.nameTokens.length > 0 && options.shouldStartNewProduct?.(cur.nameTokens, t)) flush();
    cur.nameTokens.push(t);
  }
  flush();

  const intent: Intent =
    amount !== null && items.length === 0
      ? 'ADD_AMOUNT_TO_KHATA'
      : items.length > 0
        ? 'ADD_TO_BILL'
        : payment || customerName || payNow
          ? 'SET_BILL_DETAILS'
          : 'UNKNOWN';

  return { intent, text, customerName, items, amount, paymentMethod: payment, payNow };
}

function newItem() {
  return {
    qty: null as number | null,
    qtyImplicit: false,
    unit: null as UnitKey | null,
    nameTokens: [] as string[],
    priceHint: null as number | null,
    spendAmount: null as number | null,
    sizeHint: null as { value: number; unit: UnitKey } | null,
  };
}

/** The command in the documented snake_case format (used for the debug log). */
export function commandToJson(cmd: VoiceCommand) {
  return {
    intent: cmd.intent,
    customer_name: cmd.customerName,
    items: cmd.items.map((i) => ({
      spoken_name: i.spokenName,
      quantity: i.quantity,
      unit: i.unit ?? 'piece',
      ...(i.priceHint !== null ? { variant_hint: `Rs ${i.priceHint}` } : {}),
      ...(i.sizeHint ? { size_hint: `${i.sizeHint.value} ${i.sizeHint.unit}` } : {}),
    })),
    ...(cmd.amount !== null ? { amount: cmd.amount } : {}),
    payment_method: cmd.paymentMethod,
    pay_now: cmd.payNow,
  };
}
