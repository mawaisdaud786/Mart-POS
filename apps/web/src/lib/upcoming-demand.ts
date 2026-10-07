import type { Category, Product, Sale } from './db';

export interface DemandCategorySuggestion {
  label: string;
  keywords: string[];
  newProductIdeas?: DemandProductIdea[];
}

export interface DemandProductIdea {
  name: string;
  keywords: string[];
}

export interface UpcomingEvent {
  id: string;
  title: string;
  date: string;
  endDate: string;
  kind: 'season' | 'event';
  dateConfidence: 'fixed' | 'estimate';
  dateNote: string;
  lunar: boolean;
  categories: DemandCategorySuggestion[];
}

export interface UpcomingProductDemand {
  product: Product;
  recentQty: number;
  comparableQty: number;
  currentStock: number;
  suggestedQty: number;
  confidence: 'moderate' | 'strong';
  evidence: string;
}

export interface UpcomingDemandInsight {
  event: UpcomingEvent;
  daysUntil: number;
  productsToReview: UpcomingProductDemand[];
  generalOpportunities: string[];
  catalogProductsWithoutSales: string[];
  historyAvailable: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const RECENT_DAYS = 28;
const COMPARABLE_DAYS = 21;
const PREPARATION_DAYS = 14;

const idea = (name: string, ...keywords: string[]): DemandProductIdea => ({ name, keywords });

const SUGGESTIONS = {
  Ramadan: [
    { label: 'Dates and iftar drinks', keywords: ['dates', 'khajoor', 'khajur', 'کھجور', 'rooh afza', 'roohafza', 'sharbat', 'شربت'], newProductIdeas: [idea('Dates (khajoor)', 'dates', 'khajoor', 'khajur', 'کھجور'), idea('Rooh Afza or sharbat', 'rooh afza', 'roohafza', 'sharbat', 'شربت')] },
    { label: 'Iftar cooking staples', keywords: ['besan', 'gram flour', 'chickpea', 'chana', 'oil', 'cooking oil', 'آٹا', 'بیسن'], newProductIdeas: [idea('Besan (gram flour)', 'besan', 'gram flour', 'بیسن'), idea('Cooking oil', 'cooking oil')] },
    { label: 'Iftar serving supplies', keywords: ['disposable cup', 'paper cup', 'paper plate', 'disposable plate', 'napkin', 'foil'], newProductIdeas: [idea('Disposable cups and plates', 'disposable cup', 'paper cup', 'paper plate', 'disposable plate')] },
  ],
  'Eid ul-Fitr': [
    { label: 'Sheer khurma ingredients', keywords: ['vermicelli', 'seviyan', 'siwai', 'سیویاں', 'sheer khurma', 'کھویا', 'khoya', 'cream', 'pistachio', 'badam'], newProductIdeas: [idea('Vermicelli (seviyan)', 'vermicelli', 'seviyan', 'siwai', 'سیویاں'), idea('Pistachios and almonds', 'pistachio', 'pistachios', 'almond', 'badam')] },
    { label: 'Eid guest refreshments', keywords: ['tea', 'chai', 'چائے', 'juice', 'biscuit', 'biscuit tin', 'sweets'], newProductIdeas: [idea('Tea and guest biscuits', 'chai', 'tea', 'biscuit tin')] },
  ],
  'Eid ul-Adha': [
    { label: 'Meat cooking staples', keywords: ['meat masala', 'biryani masala', 'garam masala', 'masala', 'spice', 'cooking oil', 'foil'], newProductIdeas: [idea('Meat and biryani masala', 'meat masala', 'biryani masala', 'garam masala')] },
    { label: 'Meat storage supplies', keywords: ['freezer bag', 'zip bag', 'cling film', 'food wrap', 'foil container'], newProductIdeas: [idea('Freezer bags and food wrap', 'freezer bag', 'zip bag', 'cling film', 'food wrap')] },
  ],
  'Ashura (10 Muharram)': [
    { label: 'Water and meal supplies', keywords: ['water bottle', 'mineral water', 'sabeel', 'rice', 'flour', 'atta', 'cooking oil'], newProductIdeas: [idea('Water bottles for sabeel', 'water bottle', 'mineral water')] },
  ],
  'Pakistan Day': [
    { label: 'Pakistan Day celebration items', keywords: ['pakistan flag', 'pakistani flag', '14 august flag', 'green flag', 'flag sticker', 'pakistan sticker', 'pakistan badge', 'pakistan day'], newProductIdeas: [idea('Small Pakistan flags', 'pakistan flag', 'pakistani flag', 'green flag'), idea('Pakistan flag stickers and badges', 'pakistan sticker', 'flag sticker', 'pakistan badge')] },
  ],
  'Independence Day': [
    { label: 'Independence Day celebration items', keywords: ['pakistan flag', 'pakistani flag', '14 august flag', 'green flag', 'flag sticker', 'pakistan sticker', 'pakistan badge', 'independence day'], newProductIdeas: [idea('Small Pakistan flags', 'pakistan flag', 'pakistani flag', 'green flag'), idea('Pakistan flag stickers and badges', 'pakistan sticker', 'flag sticker', 'pakistan badge')] },
    { label: 'Outdoor refreshments', keywords: ['water bottle', 'mineral water', 'juice box', 'disposable cup', 'paper cup'], newProductIdeas: [idea('Chilled water bottles', 'water bottle', 'mineral water')] },
  ],
  'Kashmir Solidarity Day': [
    { label: 'Kashmir solidarity items', keywords: ['kashmir flag', 'kashmir badge', 'kashmir sticker', 'kashmir day'], newProductIdeas: [idea('Kashmir solidarity stickers and badges', 'kashmir badge', 'kashmir sticker')] },
  ],
  'Defence Day': [
    { label: 'Defence Day remembrance items', keywords: ['pakistan flag', 'pakistan badge', 'defence day sticker', 'defence day'], newProductIdeas: [idea('Small flags and Defence Day badges', 'pakistan flag', 'defence day badge', 'defence day sticker')] },
  ],
  'Iqbal Day': [
    { label: 'Iqbal Day school and event items', keywords: ['iqbal day', 'allama iqbal', 'iqbal sticker', 'iqbal poster', 'iqbal badge', 'poetry poster', 'school stationery', 'notebook', 'copy', 'marker', 'chart paper'], newProductIdeas: [idea('Allama Iqbal stickers', 'allama iqbal sticker', 'allama iqbal day sticker', 'iqbal sticker', 'iqbal day sticker'), idea('Iqbal poetry posters', 'iqbal poster', 'poetry poster'), idea('School chart paper and markers', 'chart paper', 'marker')] },
  ],
  'Quaid-e-Azam Day': [
    { label: 'Quaid-e-Azam school and event items', keywords: ['quaid-e-azam', 'quaid azam', 'jinnah sticker', 'jinnah poster', 'quaid badge', 'pakistan flag', 'school stationery'], newProductIdeas: [idea('Quaid-e-Azam stickers and posters', 'quaid sticker', 'jinnah sticker', 'quaid poster', 'jinnah poster'), idea('Small Pakistan flags', 'pakistan flag')] },
  ],
  'Labour Day': [
    { label: 'Outdoor workday essentials', keywords: ['water bottle', 'mineral water', 'ors', 'electrolyte sachet'], newProductIdeas: [idea('Water bottles and ORS sachets', 'water bottle', 'mineral water', 'ors sachet', 'electrolyte sachet')] },
  ],
  'Summer season': [
    { label: 'Cold drinks and hydration', keywords: ['cold drink', 'soft drink', 'water bottle', 'mineral water', 'juice box', 'ors', 'electrolyte'], newProductIdeas: [idea('Chilled water and cold drinks', 'water bottle', 'mineral water', 'cold drink', 'soft drink')] },
    { label: 'Cooling supplies', keywords: ['ice lolly', 'ice pop', 'disposable cup', 'sunscreen'], newProductIdeas: [idea('Ice pops and disposable cups', 'ice lolly', 'ice pop', 'disposable cup')] },
  ],
  'Monsoon season': [
    { label: 'Rain and mosquito protection', keywords: ['umbrella', 'raincoat', 'mosquito repellent', 'mosquito coil', 'machhar coil'], newProductIdeas: [idea('Mosquito coils and repellent', 'mosquito coil', 'mosquito repellent', 'machhar coil')] },
    { label: 'Rainy-day staples', keywords: ['tea', 'chai', 'چائے', 'water purifier', 'water bottle'], newProductIdeas: [idea('Tea and clean drinking water', 'tea', 'chai', 'water purifier', 'water bottle')] },
  ],
  'Winter season': [
    { label: 'Winter snacks and traditional treats', keywords: ['peanut', 'groundnut', 'mongphali', 'moongphali', 'مونگ پھلی', 'rewari', 'rewri', 'ریوڑی', 'gajak', 'گجک', 'chikki', 'roasted chana', 'bhuna chana', 'بھنا چنا', 'popcorn', 'corn snack', 'potato stick', 'chips stick', 'chip stick'], newProductIdeas: [idea('Peanuts (moongphali)', 'peanut', 'groundnut', 'mongphali', 'moongphali', 'مونگ پھلی'), idea('Rewari', 'rewari', 'rewri', 'ریوڑی'), idea('Gajak / chikki', 'gajak', 'گجک', 'chikki'), idea('Roasted chana and popcorn', 'roasted chana', 'bhuna chana', 'بھنا چنا', 'popcorn'), idea('Potato/chip sticks', 'potato stick', 'chips stick', 'chip stick')] },
    { label: 'Warm drinks and soup', keywords: ['tea', 'chai', 'چائے', 'coffee', 'cocoa', 'soup', 'yakhni'], newProductIdeas: [idea('Soup sachets and hot drinks', 'soup sachet', 'soup', 'hot chocolate', 'cocoa')] },
    { label: 'Winter personal care', keywords: ['cold cream', 'winter lotion', 'lip balm', 'moisturizer'], newProductIdeas: [idea('Cold cream and lip balm', 'cold cream', 'lip balm')] },
  ],
} satisfies Record<string, DemandCategorySuggestion[]>;

const FIXED_EVENTS: Array<{ id: string; title: string; month: number; day: number }> = [
  { id: 'kashmir-solidarity-day', title: 'Kashmir Solidarity Day', month: 2, day: 5 },
  { id: 'pakistan-day', title: 'Pakistan Day', month: 3, day: 23 },
  { id: 'labour-day', title: 'Labour Day', month: 5, day: 1 },
  { id: 'independence-day', title: 'Independence Day', month: 8, day: 14 },
  { id: 'defence-day', title: 'Defence Day', month: 9, day: 6 },
  { id: 'iqbal-day', title: 'Iqbal Day', month: 11, day: 9 },
  { id: 'quaid-e-azam-day', title: 'Quaid-e-Azam Day', month: 12, day: 25 },
];

const SEASONS: Array<{
  id: string;
  title: string;
  month: number;
  day: number;
  endMonth: number;
  endDay: number;
}> = [
  { id: 'summer-season', title: 'Summer season', month: 4, day: 1, endMonth: 9, endDay: 30 },
  { id: 'monsoon-season', title: 'Monsoon season', month: 6, day: 15, endMonth: 9, endDay: 15 },
  { id: 'winter-season', title: 'Winter season', month: 10, day: 15, endMonth: 2, endDay: 15 },
];

const LUNAR_EVENTS = [
  { id: 'ramadan', title: 'Ramadan begins', month: 9, day: 1, suggestionKey: 'Ramadan' as const },
  { id: 'eid-ul-fitr', title: 'Eid ul-Fitr', month: 10, day: 1, suggestionKey: 'Eid ul-Fitr' as const },
  { id: 'eid-ul-adha', title: 'Eid ul-Adha', month: 12, day: 10, suggestionKey: 'Eid ul-Adha' as const },
  { id: 'ashura', title: 'Ashura (10 Muharram)', month: 1, day: 10, suggestionKey: 'Ashura (10 Muharram)' as const },
];

function parseDay(day: string): Date {
  return new Date(`${day}T12:00:00.000Z`);
}

function dayKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function addDays(day: string, count: number): string {
  const date = parseDay(day);
  date.setUTCDate(date.getUTCDate() + count);
  return dayKey(date);
}

function dayDifference(from: string, to: string): number {
  return Math.round((parseDay(to).getTime() - parseDay(from).getTime()) / DAY_MS);
}

function fixedDate(year: number, month: number, day: number): string {
  return dayKey(new Date(Date.UTC(year, month - 1, day, 12)));
}

function isInHorizon(today: string, event: UpcomingEvent, horizonDays: number): boolean {
  const daysUntil = dayDifference(today, event.date);
  return event.kind === 'season' && event.date <= today
    ? event.endDate >= today
    : daysUntil >= 0 && daysUntil <= horizonDays;
}

function islamicMonthDay(date: Date, formatter: Intl.DateTimeFormat): { month: number; day: number } | undefined {
  const parts = formatter.formatToParts(date);
  const month = Number(parts.find((part) => part.type === 'month')?.value);
  const day = Number(parts.find((part) => part.type === 'day')?.value);
  return Number.isFinite(month) && Number.isFinite(day) ? { month, day } : undefined;
}

/**
 * Builds a local, date-aware Pakistan calendar. Islamic dates use the browser's calculated
 * Umm al-Qura calendar as an estimate only; Pakistan moon-sighting dates can differ.
 */
export function getUpcomingPakistanEvents(today: string, horizonDays = 180): UpcomingEvent[] {
  const todayDate = parseDay(today);
  const year = todayDate.getUTCFullYear();
  const events: UpcomingEvent[] = [];

  for (const calendarYear of [year, year + 1]) {
    for (const item of FIXED_EVENTS) {
      const date = fixedDate(calendarYear, item.month, item.day);
      events.push({
        id: item.id,
        title: item.title,
        date,
        endDate: date,
        kind: 'event',
        dateConfidence: 'fixed',
        dateNote: 'Fixed annual date',
        lunar: false,
        categories: SUGGESTIONS[item.title as keyof typeof SUGGESTIONS],
      });
    }
    for (const season of SEASONS) {
      const date = fixedDate(calendarYear, season.month, season.day);
      let endYear = calendarYear;
      if (season.endMonth < season.month) endYear += 1;
      const endDate = fixedDate(endYear, season.endMonth, season.endDay);
      events.push({
        id: season.id,
        title: season.title,
        date,
        endDate,
        kind: 'season',
        dateConfidence: 'fixed',
        dateNote: 'Planning window; start/end are approximate seasonal markers',
        lunar: false,
        categories: SUGGESTIONS[season.title as keyof typeof SUGGESTIONS],
      });
    }
  }

  try {
    const formatter = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura-nu-latn', {
      timeZone: 'UTC',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
    });
    for (let offset = 0; offset <= horizonDays; offset += 1) {
      const date = new Date(todayDate.getTime() + offset * DAY_MS);
      const hijri = islamicMonthDay(date, formatter);
      if (!hijri) continue;
      for (const item of LUNAR_EVENTS) {
        if (hijri.month !== item.month || hijri.day !== item.day) continue;
        const dateKey = dayKey(date);
        events.push({
          id: item.id,
          title: item.title,
          date: dateKey,
          endDate: dateKey,
          kind: 'event',
          dateConfidence: 'estimate',
          dateNote: 'Calculated Islamic-calendar estimate (allow about ±1 day); confirm with Pakistan moon-sighting announcement',
          lunar: true,
          categories: SUGGESTIONS[item.suggestionKey],
        });
      }
    }
  } catch {
    // Some older browser runtimes do not include the Islamic calendar. Keep fixed dates and seasons.
  }

  return events
    .filter((event) => isInHorizon(today, event, horizonDays))
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}

export function getRecentSalesWindow(today: string, days = RECENT_DAYS): { from: string; to: string } {
  return { from: addDays(today, -(days - 1)), to: today };
}

/** A 21-day lead-up around last year's corresponding Gregorian or approximate lunar date. */
export function getComparableSalesWindow(event: UpcomingEvent): { from: string; to: string } {
  const date = parseDay(event.date);
  if (event.lunar) date.setUTCDate(date.getUTCDate() - 354);
  else date.setUTCFullYear(date.getUTCFullYear() - 1);
  const anchor = dayKey(date);
  return {
    from: addDays(anchor, -PREPARATION_DAYS),
    to: addDays(anchor, COMPARABLE_DAYS - PREPARATION_DAYS - 1),
  };
}

function soldQty(sales: Sale[], productId: string): number {
  return sales.reduce((total, sale) => {
    if (sale.status !== 'completed') return total;
    return total + sale.items
      .filter((item) => item.productId === productId)
      .reduce((sum, item) => sum + Math.max(0, item.qty - item.returnedQty), 0);
  }, 0);
}

function productText(product: Product, category?: Category): string {
  return `${product.name} ${product.nameUr ?? ''} ${(product.voiceKeywords ?? []).join(' ')} ${category?.name ?? ''}`.toLocaleLowerCase();
}

function matchesSuggestion(text: string, suggestion: DemandCategorySuggestion): boolean {
  const textTokens = text.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(/\s+/).filter(Boolean);
  return suggestion.keywords.some((keyword) => {
    const keywordTokens = keyword.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(/\s+/).filter(Boolean);
    if (keywordTokens.length === 0 || keywordTokens.length > textTokens.length) return false;
    return textTokens.some((_, start) => keywordTokens.every((token, offset) => {
      const textToken = textTokens[start + offset] ?? '';
      return textToken === token || textToken === `${token}s` || textToken === `${token}es`;
    }));
  });
}

export function buildUpcomingDemandInsights(input: {
  today: string;
  events: UpcomingEvent[];
  products: Product[];
  categories: Category[];
  recentSales: Sale[];
  comparableSalesByEvent: Record<string, Sale[]>;
}): UpcomingDemandInsight[] {
  const recentWindow = getRecentSalesWindow(input.today);
  const recentDays = dayDifference(recentWindow.from, recentWindow.to) + 1;

  return input.events.map((event) => {
    const comparableSales = input.comparableSalesByEvent[event.id] ?? [];
    const historyAvailable = comparableSales.some((sale) => sale.status === 'completed');
    const categoryFor = (product: Product) => input.categories.find((category) => category.id === product.categoryId);
    const matchingProducts = input.products
      .filter((product) => product.active && !product.isService && product.trackStock !== false)
      .map((product) => ({ product, text: productText(product, categoryFor(product)) }))
      .filter(({ text }) => event.categories.some((suggestion) => matchesSuggestion(text, suggestion)));

    const productsToReview: UpcomingProductDemand[] = [];
    const catalogProductsWithoutSales: string[] = [];
    for (const { product } of matchingProducts) {
      const recentQty = soldQty(input.recentSales, product.id);
      const comparableQty = soldQty(comparableSales, product.id);
      if (recentQty <= 0 && comparableQty <= 0) {
        catalogProductsWithoutSales.push(product.name);
        continue;
      }
      const recentDaily = recentQty / recentDays;
      const comparableDaily = comparableQty / COMPARABLE_DAYS;
      const daysUntil = Math.max(0, dayDifference(input.today, event.date));
      const coverDays = Math.min(14, Math.max(3, daysUntil + 7));
      const available = Math.max(0, product.stock - (product.reserved ?? 0));
      const suggestedQty = Math.max(0, Math.ceil(Math.max(recentDaily, comparableDaily) * coverDays - available));
      const evidence = [
        recentQty > 0 ? `${recentQty.toFixed(1)} sold in the last ${recentDays} days` : '',
        comparableQty > 0 ? `${comparableQty.toFixed(1)} sold in the comparable prior-year window` : '',
      ].filter(Boolean).join('; ');
      productsToReview.push({
        product,
        recentQty,
        comparableQty,
        currentStock: product.stock,
        suggestedQty,
        confidence: recentQty > 0 && comparableQty > 0 ? 'strong' : 'moderate',
        evidence,
      });
    }

    const activeCatalog = input.products
      .filter((product) => product.active && !product.isService && product.trackStock !== false)
      .map((product) => productText(product, categoryFor(product)));
    const generalOpportunities = event.categories
      .flatMap((suggestion) => suggestion.newProductIdeas ?? [])
      .filter((productIdea) => !activeCatalog.some((text) => matchesSuggestion(text, { label: productIdea.name, keywords: productIdea.keywords })))
      .map((productIdea) => productIdea.name)
      .filter((productIdea, index, ideas) => ideas.indexOf(productIdea) === index);
    productsToReview.sort((a, b) => b.suggestedQty - a.suggestedQty || b.recentQty - a.recentQty);

    return {
      event,
      daysUntil: Math.max(0, dayDifference(input.today, event.date)),
      productsToReview,
      generalOpportunities,
      catalogProductsWithoutSales,
      historyAvailable,
    };
  });
}
