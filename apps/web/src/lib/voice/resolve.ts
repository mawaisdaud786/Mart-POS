import type { Customer, Product } from '../db';
import { roundQty } from '../format';
import {
  GENERIC_WORDS,
  NAME_TITLES,
  SYNONYMS,
  UNIT_DIMENSION,
  UNIT_WORDS,
  hasUrduScript,
  transliterateUrdu,
  type UnitKey,
} from './lexicon';
import { parseCommand, tokenize, type ParsedItem, type VoiceCommand } from './parse';

/**
 * Matches a parsed voice command against the shop's own products and customers.
 * The database decides the product, price, stock and customer — never the parser.
 */

// ---------- fuzzy word matching ----------

/** Spelling-insensitive key: "Sooper" ≈ "super", "cheeni" ≈ "chini", Urdu script transliterated. */
export function wordKey(word: string): string {
  let w = hasUrduScript(word) ? transliterateUrdu(word) : word.toLowerCase();
  if (/^a{2,3}$/.test(w)) return w;
  w = w
    .replace(/oo/g, 'u')
    .replace(/ee/g, 'i')
    .replace(/aa/g, 'a')
    .replace(/ph/g, 'f')
    .replace(/c(?!h)/g, 'k')
    .replace(/q/g, 'k')
    .replace(/(.)\1+/g, '$1');
  return w;
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]!;
      prev[j] = Math.min(prev[j]! + 1, prev[j - 1]! + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length]!;
}

/** Consonants only: Urdu script usually omits short vowels ("سوپر" → spr ≈ "sooper" → spr). */
function skeleton(key: string): string {
  return key.replace(/x/g, 'ks').replace(/[aeiouyw]/g, '').replace(/(.)\1+/g, '$1');
}

/** 0–1 similarity between two words. */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const ka = wordKey(a);
  const kb = wordKey(b);
  if (ka === kb) return 0.97;
  if (hasUrduScript(a) !== hasUrduScript(b)) {
    const sa = skeleton(ka);
    const sb = skeleton(kb);
    if (sa.length >= 2 && sa === sb) return 0.85;
    if (Math.min(sa.length, sb.length) >= 4) return Math.min(0.84, 1 - levenshtein(sa, sb) / Math.max(sa.length, sb.length));
  }
  if (Math.min(ka.length, kb.length) >= 4 && (ka.startsWith(kb) || kb.startsWith(ka))) return 0.9;
  return 1 - levenshtein(ka, kb) / Math.max(ka.length, kb.length, 1);
}

const MATCH = 0.78;

const SYNONYM_INDEX = new Map<string, string[]>();
for (const group of SYNONYMS) for (const w of group) SYNONYM_INDEX.set(wordKey(w), group);

// ---------- product index ----------

interface Size {
  dim: 'mass' | 'volume';
  base: number;
}

interface IndexedProduct {
  product: Product;
  /** First word of the name — usually the brand ("Surf" Excel, "Brite" Surf). */
  brandKey: string;
  words: string[];
  /** Plain numbers in the name, e.g. "Rs 50" → 50. */
  numbers: number[];
  sizes: Size[];
}

function indexProduct(p: Product): IndexedProduct {
  const words: string[] = [];
  const numbers: number[] = [];
  const sizes: Size[] = [];
  for (const source of [p.name, p.nameUr ?? '', ...(p.voiceKeywords ?? [])]) {
    const toks = tokenize(source);
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i]!;
      if (/^\d+(\.\d+)?$/.test(t)) {
        const unit = UNIT_WORDS[toks[i + 1] ?? ''];
        const dim = unit ? UNIT_DIMENSION[unit] : undefined;
        if (unit && dim && dim.dim !== 'count') {
          sizes.push({ dim: dim.dim, base: Number(t) * dim.base });
          i++;
        } else {
          numbers.push(Number(t));
        }
        continue;
      }
      if (t.length < 2 || t === 'rs') continue;
      words.push(t);
      const syn = SYNONYM_INDEX.get(wordKey(t));
      if (syn) words.push(...syn);
    }
  }
  if (p.sku) words.push(p.sku.toLowerCase());
  const first = tokenize(p.name).find((t) => !/^\d/.test(t)) ?? '';
  return { product: p, brandKey: wordKey(first), words: [...new Set(words)], numbers, sizes };
}

export interface ProductIndex {
  items: IndexedProduct[];
  docFreq: Map<string, number>;
}

export function buildProductIndex(products: Product[], options: { includeInactive?: boolean } = {}): ProductIndex {
  const items = products.filter((p) => options.includeInactive ? !p.active : p.active).map(indexProduct);
  const docFreq = new Map<string, number>();
  for (const it of items) for (const k of new Set(it.words.map(wordKey))) docFreq.set(k, (docFreq.get(k) ?? 0) + 1);
  return { items, docFreq };
}

const isGeneric = (w: string) => GENERIC_WORDS.has(w) || GENERIC_WORDS.has(wordKey(w));

function wordWeight(index: ProductIndex, word: string): number {
  const df = index.docFreq.get(wordKey(word)) ?? 1;
  return (1 / (1 + Math.log2(df))) * (isGeneric(word) ? 0.35 : 1);
}

interface Scored {
  ip: IndexedProduct;
  score: number;
  exact: boolean;
}

/** Products whose name matches the spoken words, best first. */
export function matchProducts(index: ProductIndex, spoken: string[]): Scored[] {
  const words = spoken.filter((w) => w.length >= 2 && !/^\d/.test(w));
  if (words.length === 0) return [];
  const allGeneric = words.every(isGeneric);
  const scored: Scored[] = [];
  for (const ip of index.items) {
    let score = 0;
    let distinctive = false;
    let exact = false;
    for (const w of words) {
      let best = 0;
      let bestWord = '';
      for (const pw of ip.words) {
        const s = similarity(w, pw);
        if (s > best) {
          best = s;
          bestWord = pw;
        }
      }
      if (best >= MATCH) {
        const brandBonus = wordKey(bestWord) === ip.brandKey ? 1.5 : 1;
        score += best * wordWeight(index, bestWord) * brandBonus;
        if (!isGeneric(w)) distinctive = true;
        if (best >= 0.97) exact = true;
      }
    }
    // "Lux soap" must not match "Lifebuoy Soap" just because of the word "soap".
    if (score > 0 && (distinctive || allGeneric)) scored.push({ ip, score, exact });
  }
  scored.sort((a, b) => b.score - a.score || a.ip.product.name.localeCompare(b.ip.product.name));
  if (scored.length === 0) return [];
  if (words.length === 1) {
    const exactMatches = scored.filter((candidate) => candidate.exact);
    if (exactMatches.length > 0) {
      const topExact = exactMatches[0]!.score;
      return exactMatches.filter((candidate) => candidate.score >= topExact * 0.8);
    }
  }
  const top = scored[0]!.score;
  return scored.filter((s) => s.score >= top * 0.8);
}

// ---------- quantities and units ----------

const PRODUCT_UNIT: Record<string, UnitKey> = {
  piece: 'piece', packet: 'packet', box: 'box', bottle: 'bottle', dozen: 'dozen', kg: 'kg', gram: 'g', litre: 'l', ml: 'ml', sack: 'sack', carton: 'carton',
};

export function productUnitKey(p: Product): UnitKey {
  return PRODUCT_UNIT[p.unit.toLowerCase()] ?? 'piece';
}

/** Quantity in the product's own selling unit, or a reason why it needs the shopkeeper to choose. */
export function convertQuantity(item: ParsedItem, ip: IndexedProduct): { qty: number; note?: string } | { ask: string; choices: number[] } {
  const p = ip.product;
  const pu = productUnitKey(p);
  if (item.spendAmount !== null) {
    if (p.salePrice <= 0) return { ask: `${p.name} ki sale price set nahi hai — quantity enter karein.`, choices: [1] };
    const rawQty = (item.spendAmount * 100) / p.salePrice;
    const availableQty = UNIT_DIMENSION[pu].dim === 'count'
      ? Math.floor(rawQty)
      : Math.floor(rawQty * 1000 + 1e-9) / 1000;
    if (availableQty <= 0) return { ask: `Rs ${item.spendAmount} mein ${p.name} ka poora ${p.unit} nahi aa sakta. Kitna ${p.unit}?`, choices: [1] };
    return { qty: availableQty, note: `Rs ${item.spendAmount} ≈ ${availableQty} ${p.unit}` };
  }
  const u = item.unit;
  if (!u) return { qty: item.quantity };
  const pd = UNIT_DIMENSION[pu];
  const sd = UNIT_DIMENSION[u];

  if (sd.dim === 'mass' || sd.dim === 'volume') {
    if (pd.dim === sd.dim) return { qty: roundQty((item.quantity * sd.base) / pd.base) };
    const size = ip.sizes.find((s) => s.dim === sd.dim);
    if (size) {
      const q = (item.quantity * sd.base) / size.base;
      if (Math.abs(q - Math.round(q)) < 0.01 && Math.round(q) >= 1) return { qty: Math.round(q) };
    }
    return { ask: `${p.name} ${p.unit} mein bikta hai — kitne ${p.unit}?`, choices: [1, 2, 3, 5] };
  }
  // Counted units
  if (pd.dim !== 'count') {
    return { ask: `${p.name} ${p.unit} mein bikta hai — kitne ${p.unit}?`, choices: pu === 'kg' || pu === 'l' ? [0.5, 1, 2, 5] : [250, 500, 1000] };
  }
  if (u === 'dozen' && pu !== 'dozen') return { qty: item.quantity * 12 };
  if (pu === 'dozen' && u === 'piece') return { qty: roundQty(item.quantity / 12) };
  if ((u === 'carton' || u === 'box' || u === 'sack') && pu !== u && p.packSize && p.packSize > 1) {
    return { qty: roundQty(item.quantity * p.packSize), note: `${item.quantity} ${p.packName ?? 'pack'} = ${roundQty(item.quantity * p.packSize)} ${p.unit}` };
  }
  return { qty: item.quantity };
}

// ---------- items ----------

export type ItemResolution =
  | { status: 'ok'; item: ParsedItem; product: Product; qty: number; note?: string; warning?: string }
  | { status: 'inactive'; item: ParsedItem; options: Product[]; message: string }
  | { status: 'ambiguous'; item: ParsedItem; options: Product[]; message: string }
  | { status: 'ask_qty'; item: ParsedItem; product: Product; message: string; choices: number[] }
  | { status: 'not_found'; item: ParsedItem; message: string };

function sizeOf(item: ParsedItem): Size | null {
  const hint = item.sizeHint ?? (item.unit && UNIT_DIMENSION[item.unit].dim !== 'count' ? { value: item.quantity, unit: item.unit } : null);
  if (!hint) return null;
  const d = UNIT_DIMENSION[hint.unit];
  return d.dim === 'count' ? null : { dim: d.dim, base: hint.value * d.base };
}

/** Stock check against what is already on the bill. Never blocks: the shop allows selling below zero, with a warning. */
export function stockWarning(p: Product, addQty: number, alreadyInCart: number): string | undefined {
  const available = roundQty(p.stock - alreadyInCart);
  if (available <= 0) return `${p.name} ka stock khatam hai (system mein ${roundQty(p.stock)} ${p.unit}).`;
  if (addQty > available) return `Sirf ${available} ${p.unit} available hain. Aap ${addQty} add kar rahe hain.`;
  return undefined;
}

/** Distinctive spoken words (e.g. a brand like "Brite") that no product in the shop contains. */
function unknownWords(index: ProductIndex, item: ParsedItem): string[] {
  return item.nameTokens.filter(
    (w) => w.length >= 3 && !/^\d/.test(w) && !isGeneric(w) && !index.items.some((ip) => ip.words.some((pw) => similarity(w, pw) >= MATCH)),
  );
}

function isExactProductPhrase(index: ProductIndex, words: string[]): boolean {
  return index.items.some((item) =>
    words.every((word) => item.words.some((productWord) => similarity(word, productWord) >= 0.97)),
  );
}

export function resolveItem(index: ProductIndex, item: ParsedItem, cartQty: (productId: string) => number, inactiveIndex?: ProductIndex): ItemResolution {
  let candidates = matchProducts(index, item.nameTokens);
  if (candidates.length === 0) {
    const inactiveCandidates = inactiveIndex ? matchProducts(inactiveIndex, item.nameTokens) : [];
    if (inactiveCandidates.length > 0) {
      let options = inactiveCandidates;
      if (item.priceHint !== null) {
        const byPrice = options.filter((candidate) => candidate.ip.product.salePrice === Math.round(item.priceHint! * 100) || candidate.ip.numbers.includes(item.priceHint!));
        if (byPrice.length > 0) options = byPrice;
      }
      return {
        status: 'inactive',
        item,
        options: options.slice(0, 8).map((candidate) => candidate.ip.product),
        message: options.length === 1
          ? `${options[0]!.ip.product.name} product list mein inactive hai. Bill se pehle ise activate karein.`
          : `Matching products inactive hain: ${options.slice(0, 8).map((candidate) => candidate.ip.product.name).join(', ')}. Bill se pehle product activate karein.`,
      };
    }
    return { status: 'not_found', item, message: `"${item.spokenName}" nahi mila. Product search karein?` };
  }
  // "Brite Surf" when the shop has no Brite: don't quietly sell Surf Excel instead — ask.
  const unknown = unknownWords(index, item);
  if (unknown.length > 0) {
    return {
      status: 'ambiguous',
      item,
      options: candidates.slice(0, 8).map((c) => c.ip.product),
      message: `"${unknown.join(' ')}" nahi mila — kya inmein se koi?`,
    };
  }

  // Variant hints decide between e.g. "Sooper Rs 20" and "Sooper Rs 50".
  if (item.priceHint !== null) {
    const hint = item.priceHint;
    const byPrice = candidates.filter((c) => c.ip.product.salePrice === Math.round(hint * 100) || c.ip.numbers.includes(hint));
    if (byPrice.length === 0) {
      return { status: 'ambiguous', item, options: candidates.map((c) => c.ip.product), message: `Rs ${hint} wala "${item.spokenName}" nahi mila — select karein.` };
    }
    candidates = byPrice;
  }
  const size = sizeOf(item);
  if (size && candidates.length > 1) {
    const bySize = candidates.filter((c) => c.ip.sizes.some((s) => s.dim === size.dim && Math.abs(s.base - size.base) < 0.001));
    if (bySize.length > 0) candidates = bySize;
    else if (item.sizeHint) {
      return { status: 'ambiguous', item, options: candidates.map((c) => c.ip.product), message: `${item.sizeHint.value} ${item.sizeHint.unit} wala "${item.spokenName}" nahi mila — select karein.` };
    }
  }
  if (item.sizeHint && candidates.length === 1) {
    const only = candidates[0]!.ip;
    const hintSize = sizeOf({ ...item, unit: null });
    if (hintSize && only.sizes.length > 0 && !only.sizes.some((s) => s.dim === hintSize.dim && Math.abs(s.base - hintSize.base) < 0.001)) {
      return { status: 'ambiguous', item, options: [only.product], message: `${item.sizeHint.value} ${item.sizeHint.unit} wala "${item.spokenName}" nahi mila — kya yeh chahiye?` };
    }
  }

  if (candidates.length > 1) {
    return {
      status: 'ambiguous',
      item,
      options: candidates.slice(0, 8).map((c) => c.ip.product),
      message: `${candidates.length} products match ho rahe hain — select karein.`,
    };
  }

  const ip = candidates[0]!.ip;
  const q = convertQuantity(item, ip);
  if ('ask' in q) return { status: 'ask_qty', item, product: ip.product, message: q.ask, choices: q.choices };
  if (q.qty <= 0) return { status: 'ask_qty', item, product: ip.product, message: `${ip.product.name}: quantity samajh nahi aayi — kitne?`, choices: [1, 2, 3, 5] };
  return {
    status: 'ok',
    item,
    product: ip.product,
    qty: q.qty,
    ...(q.note ? { note: q.note } : {}),
    ...(() => {
      const w = stockWarning(ip.product, q.qty, cartQty(ip.product.id));
      return w ? { warning: w } : {};
    })(),
  };
}

/** Quantity for a product the shopkeeper picked from a list. */
export function quantityFor(item: ParsedItem, product: Product): { qty: number } | { ask: string; choices: number[] } {
  const q = convertQuantity(item, indexProduct(product));
  return 'ask' in q ? q : { qty: q.qty };
}

// ---------- customers ----------

export type CustomerResolution =
  | { status: 'none' }
  | { status: 'found'; customer: Customer; spoken: string }
  | { status: 'ambiguous'; options: Customer[]; spoken: string; message: string }
  | { status: 'not_found'; spoken: string; message: string };

export function resolveCustomer(customers: Customer[], spokenName: string | null): CustomerResolution {
  if (!spokenName) return { status: 'none' };
  const spoken = tokenize(spokenName).filter((t) => !NAME_TITLES.has(t));
  if (spoken.length === 0) return { status: 'none' };
  const rows = customers.map((c) => {
    const words = tokenize(c.name).filter((t) => !NAME_TITLES.has(t));
    const matched = spoken.filter((s) => words.some((w) => similarity(s, w) >= 0.8)).length;
    return { c, matched, exact: matched === spoken.length && words.length === spoken.length };
  });
  const full = rows.filter((r) => r.matched === spoken.length);
  if (full.length === 1) return { status: 'found', customer: full[0]!.c, spoken: spokenName };
  if (full.length > 1) {
    const exact = full.filter((r) => r.exact);
    if (exact.length === 1) return { status: 'found', customer: exact[0]!.c, spoken: spokenName };
    return { status: 'ambiguous', options: full.map((r) => r.c).slice(0, 8), spoken: spokenName, message: `"${spokenName}" naam ke ${full.length} customers hain — select karein.` };
  }
  const partial = spoken.length > 1 ? rows.filter((r) => r.matched > 0) : [];
  if (partial.length > 0) {
    return { status: 'ambiguous', options: partial.map((r) => r.c).slice(0, 8), spoken: spokenName, message: `"${spokenName}" exact nahi mila — inmein se koi?` };
  }
  return { status: 'not_found', spoken: spokenName, message: `${titleCase(spokenName)} ka customer record nahi mila.` };
}

const titleCase = (s: string) => s.replace(/\b\p{L}/gu, (c) => c.toUpperCase());

// ---------- whole command ----------

export interface Resolution {
  command: VoiceCommand;
  customer: CustomerResolution;
  items: ItemResolution[];
  paymentMethod: 'cash' | 'credit' | null;
  amount: number | null;
  /** Set when nothing usable was understood. */
  error?: string;
}

export function resolveCommand(
  text: string,
  data: { products: Product[]; customers: Customer[]; index?: ProductIndex; inactiveIndex?: ProductIndex },
  cartQty: (productId: string) => number = () => 0,
): Resolution {
  const index = data.index ?? buildProductIndex(data.products);
  const inactiveIndex = data.inactiveIndex ?? buildProductIndex(data.products, { includeInactive: true });
  const shouldStartNewProduct = (currentNameTokens: string[], nextToken: string) => {
    if (isGeneric(nextToken)) return false;
    const current = matchProducts(index, currentNameTokens);
    const next = matchProducts(index, [nextToken]);
    return current.length === 1 && next.length === 1 &&
      current[0]!.exact && next[0]!.exact &&
      current[0]!.ip.product.id !== next[0]!.ip.product.id;
  };
  const parserOptions = { shouldStartNewProduct };
  let command = parseCommand(text, parserOptions);
  let customer = resolveCustomer(data.customers, command.customerName);

  // "Surf ka packet": the word before "ka" was a product, not a person.
  if (customer.status === 'not_found' && command.customerName && matchProducts(index, tokenize(command.customerName)).length > 0) {
    command = parseCommand(text, { ...parserOptions, detectCustomer: false });
    customer = { status: 'none' };
  }

  // A customer named before the products does not need a possessive marker ("Rashid, 2 Lux").
  if (customer.status === 'none' && command.customerName === null) {
    const tokens = tokenize(text);
    for (let length = Math.min(tokens.length, 4); length > 0; length--) {
      const name = tokens.slice(0, length);
      if (isExactProductPhrase(index, name)) continue;
      const candidateCommand = parseCommand(text, { ...parserOptions, customerPrefixLength: length });
      if (!candidateCommand.customerName) continue;
      const match = resolveCustomer(data.customers, candidateCommand.customerName);
      if (match.status === 'none' || match.status === 'not_found') continue;

      const tail = tokens.slice(length);
      const tailCommand = parseCommand(tail.join(' '), { ...parserOptions, detectCustomer: false });
      const tailHasProduct = tailCommand.items.some((item) => matchProducts(index, item.nameTokens).length > 0);
      if (tail.length > 0 && !tailHasProduct) continue;

      command = candidateCommand;
      customer = resolveCustomer(data.customers, command.customerName);
      break;
    }
  }

  const items = command.items.map((i) => resolveItem(index, i, cartQty, inactiveIndex));
  const result: Resolution = { command, customer, items, paymentMethod: command.paymentMethod, amount: command.amount };
  if (command.intent === 'UNKNOWN') result.error = 'Sorry, command samajh nahi aayi. Dobara bolain.';
  return result;
}
