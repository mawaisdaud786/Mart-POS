import { describe, expect, it } from 'vitest';
import type { Customer, Product } from '../db';
import { completeWakeCommand, confirmationAnswer, localizeSpeechText, removeWakeWords, sleepCommandRemainder, spokenNumber, voiceChoiceIndex, wakeWordRemainder } from './interaction';
import { parseCommand } from './parse';
import { resolveCommand } from './resolve';

// Test fixtures only (never written to the shop database).
let n = 0;
const P = (name: string, unit: string, price: number, stock: number, extra: Partial<Product> = {}): Product => ({
  id: `p${++n}`,
  name,
  sku: `T${n}`,
  unit,
  salePrice: price * 100,
  cost: 0,
  stock,
  minStock: 0,
  favorite: false,
  active: true,
  createdAt: '',
  ...extra,
});
const products: Product[] = [
  P('Sooper Classic Rs 20', 'Packet', 20, 50),
  P('Sooper Classic Rs 50', 'Packet', 50, 3),
  P('Sooper Family Pack', 'Packet', 120, 10),
  P('Brite Surf 500g', 'Packet', 190, 12),
  P('Brite Surf 1kg', 'Packet', 370, 8),
  P('Surf Excel 1kg', 'Packet', 690, 10, { nameUr: 'سرف ایکسل' }),
  P('Lux Soap', 'Piece', 120, 30),
  P('Lifebuoy Soap', 'Piece', 110, 30),
  P('Coca-Cola 1.5L', 'Bottle', 200, 24),
  P('Coca-Cola 500ml', 'Bottle', 100, 24),
  P('Sugar', 'Kg', 160, 50, { nameUr: 'چینی' }),
  P('Basmati Rice', 'Kg', 380, 40),
  P('Old Discontinued Tea', 'Packet', 10, 0, { active: false }),
  P('Cocomos Vanilla (Rs 10 pack)', 'Piece', 10, 0, { active: false }),
  P('Cocomos Vanilla (Rs 50 pack)', 'Piece', 50, 0, { active: false }),
];
const C = (id: string, name: string): Customer => ({ id, name, creditLimit: 0, createdAt: '' });
const customers = [C('c1', 'Malik Arif'), C('c2', 'Arif Khan'), C('c3', 'Muhammad Arif'), C('c4', 'Rashid Ali'), C('c5', 'Bilal Ahmed')];

const run = (text: string, cart: Record<string, number> = {}) => resolveCommand(text, { products, customers }, (id) => cart[id] ?? 0);
const batteryProducts = [P('AA Batteries', 'Piece', 40, 23), P('AAA Batteries', 'Piece', 30, 3)];
const runBattery = (text: string) => resolveCommand(text, { products: batteryProducts, customers });
const okItems = (r: ReturnType<typeof run>) =>
  r.items.filter((i) => i.status === 'ok').map((i) => (i.status === 'ok' ? `${i.qty} × ${i.product.name}` : ''));

describe('voice confirmations', () => {
  it('detects the Noor wake word in Roman Urdu or Urdu script', () => {
    expect(wakeWordRemainder('noor')).toBe('');
    expect(wakeWordRemainder('Noor add two Lux soaps')).toBe('add two lux soaps');
    expect(wakeWordRemainder('نور چینی شامل کریں')).toBe('cheeni شامل کریں');
    expect(wakeWordRemainder('add two Lux soaps')).toBeNull();
    expect(removeWakeWords('Noor, add نور sugar')).toBe('add sugar');
  });

  it('ends a command on bas/bs or so jao while preserving the product words', () => {
    expect(sleepCommandRemainder('bs')).toBe('');
    expect(sleepCommandRemainder('Noor, Lux Soap bs')).toBe('lux soap');
    expect(sleepCommandRemainder('Noor, Lux Soap بس')).toBe('lux soap');
    expect(sleepCommandRemainder('Noor, Lux Soap بس کرو')).toBe('lux soap');
    expect(sleepCommandRemainder('Noor, Lux Soap so jao')).toBe('lux soap');
    expect(sleepCommandRemainder('Noor, Lux Soap سو جائیں')).toBe('lux soap');
    expect(sleepCommandRemainder('Lux Soap')).toBeNull();
    const command = sleepCommandRemainder('Noor, ek Lux Soap bs');
    expect(command).not.toBeNull();
    expect(run(command!).items).toMatchObject([{ status: 'ok', product: { name: 'Lux Soap' }, qty: 1 }]);
  });

  it('keeps product words when bs arrives separately after an interim transcript', () => {
    const completed = completeWakeCommand('', 'bs', '2 kg chini');
    expect(completed).toBe('2 kg chini');
    expect(run(completed!).items).toMatchObject([{ status: 'ok', product: { name: 'Sugar' }, qty: 2 }]);
    expect(completeWakeCommand('', '2 kg chini bs', '2 kg chini')).toBe('2 kg chini');
    expect(completeWakeCommand('2 kg chini', 'bs')).toBe('2 kg chini');
    expect(completeWakeCommand('2 kilo ceni pay', 'bs', '2 kilo ceni pay')).toBe('2 kilo ceni pay');
  });

  it('selects choices by spoken number, ordinal, or unique name', () => {
    const choices = [{ name: 'Sooper Rs 20' }, { name: 'Sooper Rs 50' }, { name: 'Lux Soap' }];
    expect(voiceChoiceIndex('doosra', choices)).toBe(1);
    expect(voiceChoiceIndex('دوسرا', choices)).toBe(1);
    expect(voiceChoiceIndex('3', choices)).toBe(2);
    expect(voiceChoiceIndex('option 2', choices)).toBe(1);
    expect(voiceChoiceIndex('Lux Soap', choices)).toBe(2);
    expect(voiceChoiceIndex('Sooper', choices)).toBeNull();
  });

  it('reads spoken quantities and yes/no confirmations in Urdu and Roman Urdu', () => {
    expect(spokenNumber('teen')).toBe(3);
    expect(spokenNumber('آدھا')).toBe(0.5);
    expect(confirmationAnswer('haan add kar do')).toBe('yes');
    expect(confirmationAnswer('جی')).toBe('yes');
    expect(confirmationAnswer('nahin add karo')).toBe('no');
    expect(confirmationAnswer('nahin')).toBe('no');
    expect(confirmationAnswer('نہیں')).toBe('no');
    expect(confirmationAnswer('maybe')).toBeNull();
  });

  it('speaks Urdu responses in Urdu script without translating product names', () => {
    expect(localizeSpeechText('1 Kg Sugar add ho gaya.', 'ur-PK')).toBe('۱ کلو Sugar شامل ہو گیا۔');
    expect(localizeSpeechText('Rs. 500 add kar doon? Haan ya nahin bolain.', 'ur-PK')).toBe('۵۰۰ روپے شامل کر دوں؟ ہاں یا نہیں بولیں۔');
    expect(localizeSpeechText('Kaun sa Lux Soap? Product ka naam bolain.', 'ur-PK')).toBe('کون سا Lux Soap؟ پروڈکٹ کا نام بولیں۔');
    expect(localizeSpeechText('2 Kg Sugar add ho gaya.', 'en-IN')).toBe('2 Kg Sugar add ho gaya.');
  });
});

describe('the six commands from the brief', () => {
  it('2 Sooper Classic biscuit 50 wale', () => {
    const r = run('2 Sooper Classic biscuit 50 wale');
    expect(r.command.items[0]).toMatchObject({ quantity: 2, priceHint: 50 });
    expect(okItems(r)).toEqual(['2 × Sooper Classic Rs 50']);
    expect(r.paymentMethod).toBeNull();
  });

  it('Malik Arif ka aadha kilo Brite Surf udhaar pe', () => {
    const r = run('Malik Arif ka aadha kilo Brite Surf udhaar pe');
    expect(r.command.customerName).toBe('malik arif');
    expect(r.customer).toMatchObject({ status: 'found', customer: { id: 'c1' } });
    expect(r.command.items[0]).toMatchObject({ spokenName: 'brite surf', quantity: 0.5, unit: 'kg' });
    // Brite is sold in packets: half a kilo resolves to the 500 g pack.
    expect(okItems(r)).toEqual(['1 × Brite Surf 500g']);
    expect(r.paymentMethod).toBe('credit');
  });

  it('ek Lux soap — never picks Lifebuoy because of the word "soap"', () => {
    expect(okItems(run('ek Lux soap'))).toEqual(['1 × Lux Soap']);
  });

  it('2 Coke 1.5 litre — size picks the right bottle', () => {
    const r = run('2 Coke 1.5 litre');
    expect(r.command.items[0]).toMatchObject({ quantity: 2, sizeHint: { value: 1.5, unit: 'l' } });
    expect(okItems(r)).toEqual(['2 × Coca-Cola 1.5L']);
  });

  it('aadha kilo cheeni aur ek Surf — two items, Urdu name for sugar', () => {
    const r = run('aadha kilo cheeni aur ek Surf');
    expect(okItems(r)).toEqual(['0.5 × Sugar', '1 × Surf Excel 1kg']);
  });

  it('matches cheeni when duplicate Sugar products exist', () => {
    const duplicateSugar = [
      ...products,
      P('Sugar', 'Piece', 160, 15),
    ];
    const result = resolveCommand('cheeni', { products: duplicateSugar, customers });
    expect(result.items[0]?.status).toBe('ambiguous');
    if (result.items[0]?.status === 'ambiguous') expect(result.items[0].options.map((product) => product.unit)).toEqual(['Kg', 'Piece']);
  });

  it('matches Cheeni in Urdu script to Sugar', () => {
    expect(okItems(run('چینی'))).toEqual(['1 × Sugar']);
  });

  it('does not match Cheeni to Chana or Chilli by consonant skeleton', () => {
    const catalog = [
      P('Sugar', 'Kg', 160, 50, { nameUr: 'چینی' }),
      P('Daal Chana', 'Kg', 320, 20),
      P('National Red Chilli 200g', 'Packet', 250, 8),
    ];
    const result = resolveCommand('چینی', { products: catalog, customers });
    expect(result.items[0]).toMatchObject({ status: 'ok', product: { name: 'Sugar' } });
  });

  it('uses product-specific voice keywords to select the intended product', () => {
    const catalog = [
      P('Brown Sugar', 'Kg', 200, 10, { voiceKeywords: ['mithas', 'meethi cheeni'] }),
      P('Daal Chana', 'Kg', 320, 20),
    ];
    const result = resolveCommand('mithas', { products: catalog, customers });
    expect(result.items[0]).toMatchObject({ status: 'ok', product: { name: 'Brown Sugar' } });
  });

  it('recognizes consecutive product keywords as separate items, with each rupee amount', () => {
    const catalog = [
      P('Brown Sugar', 'Kg', 200, 10, { voiceKeywords: ['mithas'] }),
      P('Daal Chana', 'Kg', 320, 20, { voiceKeywords: ['pulses'] }),
    ];
    const result = resolveCommand('mithas 50 rs pulses 100 rs', { products: catalog, customers });
    expect(result.command.items).toHaveLength(2);
    expect(result.command.items.map((item) => item.spendAmount)).toEqual([50, 100]);
    expect(result.items).toMatchObject([
      { status: 'ok', product: { name: 'Brown Sugar' }, qty: 0.25 },
      { status: 'ok', product: { name: 'Daal Chana' }, qty: 0.312 },
    ]);

    const quantities = resolveCommand('2 mithas 3 pulses', { products: catalog, customers });
    expect(quantities.items).toMatchObject([
      { status: 'ok', product: { name: 'Brown Sugar' }, qty: 2 },
      { status: 'ok', product: { name: 'Daal Chana' }, qty: 3 },
    ]);
  });

  it('converts a rupee budget into a fractional weight quantity', () => {
    expect(okItems(run('sugar 100 rs'))).toEqual(['0.625 × Sugar']);
    expect(run('sugar 100 rs').items[0]).toMatchObject({ status: 'ok', note: 'Rs 100 ≈ 0.625 Kg' });
    expect(okItems(run('sugar of 100 rs'))).toEqual(['0.625 × Sugar']);
    expect(okItems(run('100 rupees sugar'))).toEqual(['0.625 × Sugar']);
  });

  it('uses whole units for countable products when given a rupee budget', () => {
    expect(run('100 rs Lux soap').items[0]).toMatchObject({ status: 'ask_qty', choices: [1] });
    expect(okItems(run('250 rs Lux soap'))).toEqual(['2 × Lux Soap']);
  });

  it('Rashid ke khate mein 500 ka saman — an amount on the khata, not a product', () => {
    const r = run('Rashid ke khate mein 500 ka saman');
    expect(r.command.intent).toBe('ADD_AMOUNT_TO_KHATA');
    expect(r.amount).toBe(500);
    expect(r.customer).toMatchObject({ status: 'found', customer: { id: 'c4' } });
    expect(r.paymentMethod).toBe('credit');
    expect(r.items).toHaveLength(0);
  });
});

describe('matching', () => {
  it('asks which size when only batteries is spoken', () => {
    const item = runBattery('batteries').items[0]!;
    expect(item).toMatchObject({ status: 'ambiguous' });
    if (item.status === 'ambiguous') expect(item.options.map((product) => product.name)).toEqual(['AA Batteries', 'AAA Batteries']);
  });

  it('resolves double A battery to AA Batteries', () => {
    const result = runBattery('double A battery');
    expect(result.command.items[0]?.nameTokens).toEqual(['aa', 'battery']);
    expect(result.items[0]).toMatchObject({ status: 'ok', product: { name: 'AA Batteries' } });
  });

  it('asks which one when several variants match', () => {
    const r = run('Sooper');
    expect(r.items[0]).toMatchObject({ status: 'ambiguous' });
    if (r.items[0]!.status === 'ambiguous') expect(r.items[0]!.options.map((p) => p.name)).toHaveLength(3);
  });

  it('accepts spelling variations: super, sooper 50, 50 wala sooper', () => {
    expect(okItems(run('super 50'))).toEqual(['1 × Sooper Classic Rs 50']);
    expect(okItems(run('50 wala sooper'))).toEqual(['1 × Sooper Classic Rs 50']);
    expect(okItems(run('ek sooper biscuit 20 wala'))).toEqual(['1 × Sooper Classic Rs 20']);
  });

  it('brite alone is ambiguous between pack sizes; brite 1 kilo is not', () => {
    expect(run('brite').items[0]!.status).toBe('ambiguous');
    expect(okItems(run('ek kilo brite'))).toEqual(['1 × Brite Surf 1kg']);
    expect(okItems(run('surf brite aadha kilo'))).toEqual(['1 × Brite Surf 500g']);
  });

  it('never swaps an unknown brand for a different one ("Brite" missing → ask, not Surf Excel)', () => {
    const noBrite = products.filter((p) => !p.name.startsWith('Brite'));
    const r = resolveCommand('aadha kilo Brite Surf', { products: noBrite, customers });
    expect(r.items[0]).toMatchObject({ status: 'ambiguous', message: '"brite" nahi mila — kya inmein se koi?' });
  });

  it('reports unknown products instead of guessing', () => {
    const r = run('2 Tapal Danedar');
    expect(r.items[0]).toMatchObject({ status: 'not_found' });
  });

  it('recognizes inactive products but does not resolve them for sale', () => {
    expect(run('old discontinued tea').items[0]).toMatchObject({
      status: 'inactive',
      options: [{ name: 'Old Discontinued Tea', active: false }],
    });
  });

  it('identifies inactive packaged variants without adding them to the bill', () => {
    expect(run('cocomos vanilla').items[0]).toMatchObject({
      status: 'inactive',
      options: [{ name: 'Cocomos Vanilla (Rs 10 pack)' }, { name: 'Cocomos Vanilla (Rs 50 pack)' }],
    });
  });

  it('a wrong price hint asks instead of picking another variant', () => {
    expect(run('2 sooper classic 30 wale').items[0]!.status).toBe('ambiguous');
  });

  it('keeps valid items when one is ambiguous', () => {
    const r = run('2 Sooper 50 wale, ek Lux soap aur aadha kilo Brite');
    expect(okItems(r)).toEqual(['2 × Sooper Classic Rs 50', '1 × Lux Soap', '1 × Brite Surf 500g']);
    const r2 = run('ek Lux soap aur Sooper');
    expect(okItems(r2)).toEqual(['1 × Lux Soap']);
    expect(r2.items[1]!.status).toBe('ambiguous');
  });
});

describe('quantities and units', () => {
  it('decimal and Urdu fraction quantities', () => {
    expect(okItems(run('pao cheeni'))).toEqual(['0.25 × Sugar']);
    expect(okItems(run('sawa kilo cheeni'))).toEqual(['1.25 × Sugar']);
    expect(okItems(run('dhai kilo chawal'))).toEqual(['2.5 × Basmati Rice']);
    expect(okItems(run('500 gram cheeni'))).toEqual(['0.5 × Sugar']);
    expect(okItems(run('1.5 kg sugar'))).toEqual(['1.5 × Sugar']);
  });

  it('"do packet Surf" — do is the number two', () => {
    expect(okItems(run('do packet Surf'))).toEqual(['2 × Surf Excel 1kg']);
  });

  it('"ek Surf de do" — "de do" is the verb, not two', () => {
    expect(okItems(run('ek Surf de do'))).toEqual(['1 × Surf Excel 1kg']);
  });

  it('5 Coke 1.5 litre', () => {
    expect(okItems(run('5 Coke 1.5 litre'))).toEqual(['5 × Coca-Cola 1.5L']);
  });

  it('asks how many packets when a weight is said for a packet product without that size', () => {
    expect(run('2 kilo lux soap').items[0]!.status).toBe('ask_qty');
  });
});

describe('Urdu script and mixed speech', () => {
  it('Urdu numbers and words', () => {
    expect(okItems(run('دو کلو چینی'))).toEqual(['2 × Sugar']);
    expect(okItems(run('آدھا کلو چاول'))).toEqual(['0.5 × Basmati Rice']);
  });

  it('Urdu customer marker with Roman product', () => {
    const r = run('ملک عارف کا ایک Lux soap ادھار');
    expect(r.paymentMethod).toBe('credit');
    expect(okItems(r)).toEqual(['1 × Lux Soap']);
    // Urdu-script name vs Roman customer record: shown for confirmation rather than guessed.
    expect(['found', 'ambiguous', 'not_found']).toContain(r.customer.status);
  });

  it('Urdu-script brand names match English product names', () => {
    expect(okItems(run('دو سوپر 50 والے'))).toEqual(['2 × Sooper Classic Rs 50']);
    expect(okItems(run('ایک لکس صابن'))).toEqual(['1 × Lux Soap']);
    expect(okItems(run('آدھا کلو برائٹ'))).toEqual(['1 × Brite Surf 500g']);
    expect(run('ملک عارف کا ایک Lux soap ادھار').customer).toMatchObject({ status: 'found', customer: { id: 'c1' } });
  });

  it('Urdu digits', () => {
    expect(okItems(run('۲ سرف ایکسل'))).toEqual(['2 × Surf Excel 1kg']);
  });
});

describe('customers and payment', () => {
  it('Arif alone is ambiguous; Malik Arif is exact', () => {
    const r = run('Arif ke naam pe 2 kilo chawal udhaar');
    expect(r.customer.status).toBe('ambiguous');
    if (r.customer.status === 'ambiguous') expect(r.customer.options).toHaveLength(3);
    expect(okItems(r)).toEqual(['2 × Basmati Rice']);
    expect(r.paymentMethod).toBe('credit');
  });

  it('unknown customer is reported, items still resolve', () => {
    const r = run('Ahmed Raza ka ek Lux soap udhaar');
    expect(r.customer).toMatchObject({ status: 'ambiguous' }); // "Ahmed" partly matches Bilal Ahmed → ask
    const r2 = run('Zubair ka ek Lux soap udhaar');
    expect(r2.customer).toMatchObject({ status: 'not_found', message: 'Zubair ka customer record nahi mila.' });
    expect(okItems(r2)).toEqual(['1 × Lux Soap']);
  });

  it('"Rashid ko ek Surf dena hai"', () => {
    const r = run('Rashid ko ek Surf dena hai');
    expect(r.customer).toMatchObject({ status: 'found', customer: { id: 'c4' } });
    expect(okItems(r)).toEqual(['1 × Surf Excel 1kg']);
  });

  it('adds a spoken customer before products without requiring "ka" or "ko"', () => {
    const r = run('Rashid Ali 2 kilo chawal');
    expect(r.command.customerName).toBe('rashid ali');
    expect(r.customer).toMatchObject({ status: 'found', customer: { id: 'c4' } });
    expect(okItems(r)).toEqual(['2 × Basmati Rice']);
  });

  it('sets a customer when only their name is spoken', () => {
    const r = run('Rashid Ali');
    expect(r.command.customerName).toBe('rashid ali');
    expect(r.customer).toMatchObject({ status: 'found', customer: { id: 'c4' } });
    expect(r.items).toHaveLength(0);
  });

  it('"Surf ka packet" is a product, not a customer called Surf', () => {
    const r = run('Surf ka ek packet');
    expect(r.customer.status).toBe('none');
    expect(okItems(r)).toEqual(['1 × Surf Excel 1kg']);
  });

  it('payment words alone', () => {
    expect(parseCommand('udhaar').paymentMethod).toBe('credit');
    expect(parseCommand('credit pe').paymentMethod).toBe('credit');
    expect(parseCommand('cash mein').paymentMethod).toBe('cash');
    expect(parseCommand('cash')).toMatchObject({ intent: 'SET_BILL_DETAILS', paymentMethod: 'cash', payNow: true });
  });

  it('uses cash or Urdu pay for voice checkout, not English pay', () => {
    expect(parseCommand('pay')).toMatchObject({ payNow: false, items: [], paymentMethod: null });
    expect(parseCommand('2 Lux soap pay')).toMatchObject({
      payNow: false,
      items: [{ spokenName: 'lux soap', quantity: 2 }],
    });
    expect(parseCommand('2 Lux soap cash')).toMatchObject({
      payNow: true,
      paymentMethod: 'cash',
      items: [{ spokenName: 'lux soap', quantity: 2 }],
    });
    expect(parseCommand('2 kilo ceni پے کرو')).toMatchObject({
      payNow: true,
      items: [{ spokenName: 'ceni', quantity: 2 }],
    });
    expect(parseCommand('2 Lux soap udhaar pe')).toMatchObject({
      payNow: false,
      paymentMethod: 'credit',
    });
  });

  it('keeps checkout intent when Noor and the sleep word surround a grocery command', () => {
    const completed = sleepCommandRemainder('noor 2 kilo ceni cash bs');
    expect(completed).toBe('2 kilo ceni cash');
    const result = run(completed!);
    expect(result.command.payNow).toBe(true);
    expect(result.paymentMethod).toBe('cash');
    expect(result.items).toMatchObject([{ status: 'ok', product: { name: 'Sugar' }, qty: 2 }]);
    const separatedSleep = completeWakeCommand('2 kilo ceni cash', 'bs', '2 kilo ceni cash');
    expect(separatedSleep).toBe('2 kilo ceni cash');
    expect(run(separatedSleep!).items).toMatchObject([{ status: 'ok', product: { name: 'Sugar' }, qty: 2 }]);
  });

  it('nonsense is reported', () => {
    expect(run('').error).toBeTruthy();
    expect(run('hmm').items[0]?.status ?? 'none').not.toBe('ok');
  });
});

describe('stock', () => {
  it('warns when asking for more than is in stock, counting what is already on the bill', () => {
    const r = run('5 Sooper 50 wale');
    expect(r.items[0]).toMatchObject({ status: 'ok', warning: 'Sirf 3 Packet available hain. Aap 5 add kar rahe hain.' });
    const r2 = run('2 Sooper 50 wale', { p2: 2 });
    expect(r2.items[0]).toMatchObject({ warning: 'Sirf 1 Packet available hain. Aap 2 add kar rahe hain.' });
  });
});
