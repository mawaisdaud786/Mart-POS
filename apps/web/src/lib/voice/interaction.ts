import { FRACTION_WORDS, NUMBER_WORDS } from './lexicon';
import { tokenize } from './parse';

export type VoiceLang = 'ur-PK' | 'en-IN';

const WAKE_WORDS = new Set(['noor', 'nour', 'nur', 'nor', 'نور', 'نُور', 'नूर']);
const SLEEP_COMMANDS = [
  'bas',
  'bus',
  'bs',
  'بس',
  'bas karo',
  'bus karo',
  'بس کرو',
  'بس اب',
  'sleep',
  'sleep now',
  'so jao',
  'so jaaye',
  'so jaye',
  'so jaen',
  'so jaiye',
  'sau جاؤ',
  'sau جائیں',
  'sau جائیے',
].map((phrase) => tokenize(phrase));

export function wakeWordRemainder(text: string): string | null {
  const tokens = tokenize(text);
  const index = tokens.findIndex((token) => WAKE_WORDS.has(token));
  return index < 0 ? null : tokens.slice(index + 1).join(' ');
}

export function removeWakeWords(text: string): string {
  return tokenize(text).filter((token) => token !== ',' && !WAKE_WORDS.has(token)).join(' ');
}

export function sleepCommandRemainder(text: string): string | null {
  const tokens = tokenize(removeWakeWords(text));
  for (const phrase of SLEEP_COMMANDS) {
    if (phrase.length <= tokens.length && phrase.every((token, i) => tokens[tokens.length - phrase.length + i] === token)) {
      return tokens.slice(0, tokens.length - phrase.length).join(' ');
    }
  }
  return null;
}

function mergeVoiceParts(...parts: string[]): string {
  const merged: string[] = [];
  for (const part of parts) {
    const next = tokenize(part).filter((token) => token !== ',' && !WAKE_WORDS.has(token));
    if (next.length === 0) continue;
    if (merged.length === 0) {
      merged.push(...next);
      continue;
    }

    const sharedPrefix = Math.min(merged.length, next.length);
    if (merged.slice(0, sharedPrefix).every((token, index) => token === next[index])) {
      if (next.length > merged.length) merged.splice(0, merged.length, ...next);
      continue;
    }
    let overlap = Math.min(merged.length, next.length);
    while (overlap > 0 && !merged.slice(-overlap).every((token, index) => token === next[index])) overlap--;
    merged.push(...next.slice(overlap));
  }
  return merged.join(' ');
}

export function completeWakeCommand(current: string, incoming: string, previousInterim = ''): string | null {
  const incomingRemainder = sleepCommandRemainder(incoming);
  if (incomingRemainder === null) return null;

  const previousRemainder = sleepCommandRemainder(previousInterim);
  const previousCommand = incomingRemainder === ''
    ? previousRemainder ?? previousInterim
    : '';
  return sleepCommandRemainder(mergeVoiceParts(current, previousCommand, incoming));
}

const ORDINALS: Record<string, number> = {
  first: 1, pehla: 1, pehli: 1, pahla: 1, pahli: 1, awal: 1,
  second: 2, dosra: 2, doosra: 2, dusra: 2, doosri: 2, dusri: 2,
  third: 3, teesra: 3, tisra: 3, teesri: 3, tisri: 3,
  fourth: 4, chautha: 4, chauthi: 4,
  fifth: 5, panchwa: 5, panchwi: 5,
  sixth: 6, chhata: 6, chhati: 6,
  seventh: 7, satwan: 7, satwi: 7,
  eighth: 8, aathwan: 8, aathwi: 8,
  پہلا: 1, پہلی: 1, دوسرا: 2, دوسری: 2, تیسرا: 3, تیسری: 3, چوتھا: 4, چوتھی: 4,
  پانچواں: 5, پانچویں: 5, چھٹا: 6, چھٹی: 6, ساتواں: 7, آٹھواں: 8,
};

export function spokenNumber(text: string): number | null {
  const tokens = tokenize(text);
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (/^\d+(\.\d+)?$/.test(token)) return Number(token);
    if (token in NUMBER_WORDS) return NUMBER_WORDS[token]!;
    if (token in FRACTION_WORDS) return FRACTION_WORDS[token]!;
    if (token === 'sawa' || token === 'pauna') {
      const next = tokens[i + 1];
      const value = next !== undefined && next in NUMBER_WORDS ? NUMBER_WORDS[next]! : 1;
      return value + (token === 'sawa' ? 0.25 : -0.25);
    }
  }
  return null;
}

export function voiceChoiceIndex(text: string, choices: { name: string }[]): number | null {
  const tokens = tokenize(text);
  if (tokens.length === 0) return null;

  const ordinal = ORDINALS[tokens[0]!];
  const numeric = tokens.length === 1 || (tokens.length === 2 && ['option', 'number', 'choice', 'no'].includes(tokens[0]!))
    ? spokenNumber(tokens[tokens.length - 1]!)
    : null;
  const index = ordinal ?? (numeric !== null && Number.isInteger(numeric) ? numeric : null);
  if (index !== null) return index >= 1 && index <= choices.length ? index - 1 : null;

  const spoken = new Set(tokens);
  const scores = choices.map((choice) => {
    const words = tokenize(choice.name).filter((word) => word.length > 1);
    return words.filter((word) => spoken.has(word)).length;
  });
  const highest = Math.max(0, ...scores);
  if (highest === 0) return null;
  const matches = scores.flatMap((score, i) => score === highest ? [i] : []);
  return matches.length === 1 ? matches[0]! : null;
}

export function confirmationAnswer(text: string): 'yes' | 'no' | null {
  const normalized = text.normalize('NFC').toLocaleLowerCase();
  const tokens = new Set(tokenize(text));
  if (
    ['نہیں', 'نہ', 'جی نہیں'].some((phrase) => normalized.includes(phrase)) ||
    ['no', 'nope', 'nahin', 'nahi', 'na', 'cancel', 'mat'].some((word) => tokens.has(word))
  ) return 'no';
  if (
    ['ہاں', 'جی ہاں', 'جی'].some((phrase) => normalized.includes(phrase)) ||
    ['yes', 'yeah', 'yep', 'haan', 'han', 'jee', 'ji', 'theek', 'confirm', 'add'].some((word) => tokens.has(word))
  ) return 'yes';
  return null;
}

export function localizeSpeechText(text: string, lang: VoiceLang): string {
  if (lang !== 'ur-PK') return text;
  let localized = text;
  const phrases: Array<[RegExp, string]> = [
    [/Kaun sa customer select karoon\?/gi, 'کون سا کسٹمر منتخب کروں؟'],
    [/Kaun sa (.+?)\?/gi, 'کون سا $1؟'],
    [/Jawab mein option number ya naam bolain\./gi, 'جواب میں آپشن نمبر یا نام بولیں۔'],
    [/Jawab mein option number ya product ka naam bolain\./gi, 'جواب میں آپشن نمبر یا پروڈکٹ کا نام بولیں۔'],
    [/Jawab mein number ya product ka naam bolain\./gi, 'جواب میں نمبر یا پروڈکٹ کا نام بولیں۔'],
    [/Jawab mein number ya naam bolain\./gi, 'جواب میں نمبر یا نام بولیں۔'],
    [/Product ka naam bolain\./gi, 'پروڈکٹ کا نام بولیں۔'],
    [/kitni /gi, 'کتنی '],
    [/ add karoon\? Quantity bolain\./gi, ' شامل کروں؟ مقدار بتائیں۔'],
    [/Quantity bolain\./gi, 'مقدار بتائیں۔'],
    [/ add ho gaya\./gi, ' شامل ہو گیا۔'],
    [/customer select ho gaya\./gi, 'کسٹمر منتخب ہو گیا۔'],
    [/stock available nahin, bill mein add nahin hua\./gi, 'اسٹاک دستیاب نہیں، بل میں شامل نہیں ہوا۔'],
    [/Theek hai, raqam khate mein add nahin ki\./gi, 'ٹھیک ہے، رقم کھاتے میں شامل نہیں کی۔'],
    [/ add kar doon\? Haan ya nahin bolain\./gi, ' شامل کر دوں؟ ہاں یا نہیں بولیں۔'],
    [/customer ke khate mein add ho gaye\./gi, 'کسٹمر کے کھاتے میں شامل ہو گئے۔'],
    [/\b(?:kg|kgs|kilo|kilogram)\b/gi, 'کلو'],
    [/\b(?:piece|pieces|pc|pcs)\b/gi, 'عدد'],
    [/\bpackets?\b/gi, 'پیکٹ'],
    [/\bbox(?:es)?\b/gi, 'ڈبہ'],
    [/\bbottles?\b/gi, 'بوتل'],
    [/\b(?:litre|liter|litres|liters|ltr)\b/gi, 'لیٹر'],
    [/\bgrams?\b/gi, 'گرام'],
    [/Rs\.?\s*([\d,]+(?:\.\d+)?)/gi, '$1 روپے'],
  ];
  for (const [pattern, replacement] of phrases) localized = localized.replace(pattern, replacement);
  return localized.replace(/\d/g, (digit) => String.fromCharCode(0x06f0 + Number(digit)));
}

export function speakVoice(text: string, lang: VoiceLang): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window) || !text.trim()) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(localizeSpeechText(text, lang));
  utterance.lang = lang;
  const voices = window.speechSynthesis.getVoices();
  const preferred = voices.find((voice) => voice.lang.toLowerCase() === lang.toLowerCase())
    ?? voices.find((voice) => voice.lang.toLowerCase().startsWith(lang.slice(0, 2).toLowerCase()));
  if (preferred) utterance.voice = preferred;
  utterance.rate = 0.92;
  window.speechSynthesis.speak(utterance);
}
