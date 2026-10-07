/**
 * Shopkeeper vocabulary for the voice parser: Roman Urdu, Urdu script and English.
 * Everything is mapped to one canonical Roman form before parsing.
 */

/** Urdu-script words → canonical Roman token. */
export const URDU_WORDS: Record<string, string> = {
  ایک: 'ek', اک: 'ek', دو: 'do', تین: 'teen', چار: 'char', پانچ: 'panch', چھ: 'chhe', سات: 'saat', آٹھ: 'aath',
  نو: 'nau', دس: 'das', بارہ: 'barah', بیس: 'bees', پچاس: 'pachas', سو: 'sau',
  آدھا: 'aadha', آدھی: 'aadha', ادھا: 'aadha', ڈیڑھ: 'derh', ڈھائی: 'dhai', پاؤ: 'pao', پاو: 'pao', سوا: 'sawa', پونا: 'pauna',
  کلو: 'kilo', گرام: 'gram', لیٹر: 'litre', پیکٹ: 'packet', درجن: 'darjan', بوتل: 'bottle', ڈبہ: 'dabba', ڈبے: 'dabba',
  کارٹن: 'carton', عدد: 'adad', بوری: 'bori',
  ادھار: 'udhaar', ادھارپر: 'udhaar', نقد: 'cash', کیش: 'cash', کریڈٹ: 'credit',
  کھاتے: 'khate', کھاتہ: 'khata', کھاتا: 'khata', نام: 'naam', میں: 'mein', پر: 'par', پہ: 'pe', پے: 'pe',
  کا: 'ka', کے: 'ke', کی: 'ki', کو: 'ko', اور: 'aur', والے: 'wale', والا: 'wala', والی: 'wali', روپے: 'rupay', روپیہ: 'rupay',
  سامان: 'saman', دینا: 'dena', دے: 'de', ہے: 'hai', ہیں: 'hain', چاہیے: 'chahiye', بھائی: 'bhai', جی: 'ji', صاحب: 'sahab',
  چینی: 'cheeni',
  لکھ: 'likh', لکھو: 'likh',
};

/** Spoken number words → value. */
export const NUMBER_WORDS: Record<string, number> = {
  ek: 1, aik: 1, ik: 1, one: 1, do: 2, doo: 2, two: 2, teen: 3, tin: 3, three: 3, char: 4, chaar: 4, four: 4,
  panch: 5, paanch: 5, panj: 5, five: 5, chhe: 6, chay: 6, che: 6, chheh: 6, six: 6, saat: 7, sat: 7, seven: 7,
  aath: 8, aat: 8, eight: 8, nau: 9, nine: 9, das: 10, dus: 10, ten: 10, gyarah: 11, barah: 12, bara: 12, twelve: 12,
  pandrah: 15, bees: 20, pachees: 25, tees: 30, chalees: 40, pachas: 50, pachaas: 50, sau: 100, hazaar: 1000, hazar: 1000, lakh: 100000, laakh: 100000, crore: 10000000,
};

/** Fractions that stand alone as a quantity ("aadha kilo" = 0.5 kg). */
export const FRACTION_WORDS: Record<string, number> = {
  aadha: 0.5, adha: 0.5, aadhi: 0.5, adhi: 0.5, aadhaa: 0.5, half: 0.5,
  derh: 1.5, dedh: 1.5, dairh: 1.5, deadh: 1.5, dhai: 2.5, dhaai: 2.5, dhaee: 2.5,
  pauna: 0.75, quarter: 0.25,
};

export type UnitKey = 'kg' | 'g' | 'l' | 'ml' | 'packet' | 'box' | 'carton' | 'bottle' | 'dozen' | 'piece' | 'sack' | 'pao';

export const UNIT_WORDS: Record<string, UnitKey> = {
  kilo: 'kg', kg: 'kg', kgs: 'kg', kilogram: 'kg', kilograms: 'kg', killo: 'kg',
  gram: 'g', grams: 'g', gm: 'g', gms: 'g', g: 'g', gr: 'g',
  litre: 'l', liter: 'l', litres: 'l', liters: 'l', ltr: 'l', lit: 'l', l: 'l', leter: 'l', letre: 'l',
  ml: 'ml', mili: 'ml', millilitre: 'ml', milliliter: 'ml',
  packet: 'packet', packets: 'packet', pkt: 'packet', pkts: 'packet', paket: 'packet', peket: 'packet', pack: 'packet', packat: 'packet',
  dabba: 'box', dabbe: 'box', dibba: 'box', dibbe: 'box', box: 'box', boxes: 'box',
  carton: 'carton', cartons: 'carton', cartoon: 'carton', peti: 'carton',
  bottle: 'bottle', bottles: 'bottle', botal: 'bottle', botl: 'bottle', bottal: 'bottle',
  darjan: 'dozen', dozen: 'dozen', darjen: 'dozen', darzan: 'dozen',
  piece: 'piece', pieces: 'piece', pc: 'piece', pcs: 'piece', adad: 'piece', dana: 'piece', nag: 'piece',
  bori: 'sack', sack: 'sack',
  pao: 'pao', paao: 'pao', pau: 'pao', paav: 'pao', paaw: 'pao',
};

export const UNIT_DIMENSION: Record<UnitKey, { dim: 'mass' | 'volume' | 'count'; base: number }> = {
  kg: { dim: 'mass', base: 1000 },
  pao: { dim: 'mass', base: 250 },
  g: { dim: 'mass', base: 1 },
  l: { dim: 'volume', base: 1000 },
  ml: { dim: 'volume', base: 1 },
  packet: { dim: 'count', base: 1 },
  box: { dim: 'count', base: 1 },
  carton: { dim: 'count', base: 1 },
  bottle: { dim: 'count', base: 1 },
  dozen: { dim: 'count', base: 12 },
  piece: { dim: 'count', base: 1 },
  sack: { dim: 'count', base: 1 },
};

export const CREDIT_WORDS = new Set(['udhaar', 'udhar', 'udaar', 'udhaaar', 'udhari', 'credit', 'khata', 'khate', 'khatay', 'khaata', 'khaate', 'likh', 'likho', 'likhdo', 'idhaar', 'idhaar', 'idhar', 'udhar', 'udhaar', 'udhari', 'udharay', 'udhaari']);
export const CASH_WORDS = new Set(['cash', 'naqd', 'naqad', 'nakad', 'nakd', 'kash']);
/** Words that mark "price hint" after a number: "50 wale", "50 rupay". */
export const PRICE_MARKERS = new Set(['wale', 'wala', 'wali', 'walay', 'waale', 'waala', 'waali', 'rupay', 'rupaye', 'rupees', 'rupee', 'rs', 'rupe', 'rupia']);
export const POSSESSIVE = new Set(['ka', 'ke', 'ki', 'ko', 'kay']);
export const SEPARATORS = new Set([',', 'aur', 'or', 'and', '&', '+', 'phir', 'saath', 'ilawa', 'sath', 'saath', 'saath mein', 'saath me', 'saath mey', 'saath mey', 'saath mey', 'saath mey', 'saath mey', 'saath mey', 'saath mey', 'saath mey', 'saath mey', 'saath mey', 'saath mey', 'saath mey', 'saath mey', 'saath mey']);
export const AMOUNT_GOODS = new Set(['saman', 'samaan', 'saaman', 'sauda', 'soda', 'cheez', 'cheezein', 'cheezen', 'items', 'goods', 'ration', 'maal', 'maalon', 'maal ka', 'maal ki', 'maal ke', 'maal ko']);

/** Words that carry no product meaning. */
export const FILLERS = new Set([
  'wale', 'wala', 'wali', 'walay', 'waale', 'waala', 'waali', 'ka', 'ke', 'ki', 'ko', 'kay', 'de', 'dedo', 'dena', 'dein', 'dijiye', 'dijie',
  'hai', 'hain', 'he', 'chahiye', 'chahie', 'bhai', 'ji', 'jee', 'please', 'plz', 'sahab', 'sahib', 'saab', 'mujhe', 'hamein', 'zara', 'bhi',
  'pe', 'par', 'pay', 'mein', 'me', 'main', 'se', 'naam', 'name', 'the', 'a', 'an', 'of', 'add', 'karo', 'kar', 'kardo', 'lagao',
  'rupay', 'rupaye', 'rupees', 'rupee', 'rs', 'wo', 'woh', 'yeh', 'ye', 'bill', 'in', 'on', 'to', 'for',
]);

/** Titles ignored when matching customer names. */
export const NAME_TITLES = new Set(['bhai', 'sahab', 'sahib', 'saab', 'ji', 'jee', 'mr', 'mrs', 'haji', 'baji', 'aunty', 'uncle', 'chacha', 'bhabhi']);

/** Category-like words: they can match, but on their own they never pick one brand over another. */
export const GENERIC_WORDS = new Set([
  'biscuit', 'biscuits', 'biskut', 'soap', 'sabun', 'powder', 'detergent', 'oil', 'tel', 'tea', 'chai', 'drink', 'cold',
  'family', 'pack', 'classic', 'small', 'large', 'big', 'chota', 'bara', 'bada', 'regular', 'new', 'masala', 'cream',
  'battery', 'batteries', 'cell', 'cells',
]);

/**
 * Everyday Urdu names for grocery items → English words likely used in product names.
 * Both directions are added to a product's searchable words.
 */
export const SYNONYMS: string[][] = [
  ['sugar', 'cheeni', 'chini', 'cheni', 'ceni', 'چینی'],
  ['rice', 'chawal', 'chawl', 'chaawal', 'chaval', 'چاول'],
  ['milk', 'doodh', 'dudh', 'dood', 'دودھ'],
  ['eggs', 'egg', 'anday', 'ande', 'anda', 'andey', 'انڈے', 'انڈا'],
  ['oil', 'tel', 'تیل'],
  ['salt', 'namak', 'نمک'],
  ['tea', 'chai', 'chae', 'chaye', 'patti', 'pati', 'چائے', 'پتی'],
  ['soap', 'sabun', 'saban', 'صابن'],
  ['daal', 'dal', 'lentil', 'lentils', 'دال'],
  ['flour', 'atta', 'aata', 'آٹا'],
  ['ghee', 'گھی'],
  ['chilli', 'chili', 'mirch', 'mirchi', 'مرچ'],
  ['surf', 'detergent', 'powder'],
  ['biscuit', 'biscuits', 'biskut', 'biskit', 'بسکٹ'],
  ['bread', 'dabal', 'double', 'roti', 'ڈبل'],
  ['coke', 'cola', 'coca'],
  ['yogurt', 'dahi', 'دہی'],
  ['water', 'pani', 'paani', 'پانی'],
  ['battery', 'batteries', 'cell', 'cells'],
];

/** Basic Urdu letter → Roman transliteration, used only for fuzzy matching. */
const URDU_LETTERS: Record<string, string> = {
  ا: 'a', آ: 'a', ب: 'b', پ: 'p', ت: 't', ٹ: 't', ث: 's', ج: 'j', چ: 'ch', ح: 'h', خ: 'kh', د: 'd', ڈ: 'd', ذ: 'z',
  ر: 'r', ڑ: 'r', ز: 'z', ژ: 'zh', س: 's', ش: 'sh', ص: 's', ض: 'z', ط: 't', ظ: 'z', ع: 'a', غ: 'gh', ف: 'f', ق: 'q',
  ک: 'k', گ: 'g', ل: 'l', م: 'm', ن: 'n', ں: 'n', و: 'o', ہ: 'h', ھ: 'h', ء: '', ی: 'i', ے: 'e', ئ: 'i', ة: 'h', ي: 'i', ك: 'k',
};

export function transliterateUrdu(word: string): string {
  let out = '';
  for (const ch of word) out += URDU_LETTERS[ch] ?? (/[؀-ۿ]/.test(ch) ? '' : ch);
  return out;
}

export const hasUrduScript = (s: string) => /[؀-ۿ]/.test(s);
