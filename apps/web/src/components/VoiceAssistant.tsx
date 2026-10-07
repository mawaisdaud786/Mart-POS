import { useLiveQuery } from '../lib/store';
import { AlertTriangle, Check, Keyboard, Loader2, Mic, Search, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { db, nowIso, uid, type Product } from '../lib/db';
import { qty as fmtQty, rs } from '../lib/format';
import { addPartyAdjustment } from '../lib/ops';
import { confirmationAnswer, speakVoice, spokenNumber, voiceChoiceIndex } from '../lib/voice/interaction';
import { commandToJson } from '../lib/voice/parse';
import { buildProductIndex, quantityFor, resolveCommand, stockWarning, type ItemResolution, type Resolution } from '../lib/voice/resolve';
import { useSpeech, type SpeechLang } from '../lib/voice/speech';
import { useVoiceLang } from '../lib/prefs';
import { DEFAULT_ACTION_SHORTCUTS, shortcutFromKeyboardEvent } from '../lib/pos-shortcuts';
import { Badge, Button, Input, cx, useAction } from './ui';

/**
 * Urdu / Roman Urdu voice billing. Voice only fills the draft bill through the same
 * add-to-cart, customer and payment controls as manual billing; the shopkeeper still
 * reviews and presses Pay to save. Prices, stock and customers come from the database.
 */

export interface VoiceBillingApi {
  purpose?: 'sale' | 'purchase';
  voiceShortcutKeys?: string[];
  /** Quantity of a product already on the bill. */
  cartQty: (productId: string) => number;
  customerId?: string;
  addToBill: (product: Product, qty: number) => boolean;
  setCustomer: (customerId: string) => void;
  setPayment: (mode: 'cash' | 'credit') => void;
  payNow?: (mode: 'cash' | 'credit') => Promise<boolean>;
  searchProduct: (text: string) => void;
  userId: string;
  /** Owner/manager: may add a plain amount to a customer's khata ("500 ka saman"). */
  canKhataAmount: boolean;
}

type ButtonState = 'idle' | 'listening' | 'processing' | 'success' | 'error';

interface Shown {
  res: Resolution;
  /** Item indexes already handled → what happened ("2 × Sooper" or "skipped"). */
  done: Map<number, string>;
  /** An item replaced after a pick, e.g. ambiguous → "how many packets?". */
  overrides: Map<number, ItemResolution>;
  customerDone: boolean;
  amountDone: boolean;
  amountDeclined?: boolean;
  payRequested?: boolean;
  added: string[];
}

type VoiceStep =
  | { kind: 'customer'; key: string; prompt: string; options: { id: string; name: string }[] }
  | { kind: 'product'; key: string; prompt: string; itemIndex: number; resolution: ItemResolution }
  | { kind: 'amount'; key: string; prompt: string; customerId: string; amount: number };

function nextVoiceStep(shown: Shown, canKhataAmount: boolean, purpose: 'sale' | 'purchase' = 'sale'): VoiceStep | null {
  const { res } = shown;
  if (purpose === 'sale' && res.customer.status === 'ambiguous' && !shown.customerDone) {
    const names = res.customer.options.map((customer, index) => `${index + 1}: ${customer.name}`).join('. ');
    return {
      kind: 'customer',
      key: `customer:${names}`,
      prompt: `Kaun sa customer select karoon? ${names}. Jawab mein number ya naam bolain.`,
      options: res.customer.options,
    };
  }
  for (let i = 0; i < res.items.length; i++) {
    if (shown.done.has(i)) continue;
    const resolution = shown.overrides.get(i) ?? res.items[i]!;
    if (resolution.status === 'ambiguous') {
      const names = resolution.options.map((product, index) => `${index + 1}: ${product.name}`).join('. ');
      return {
        kind: 'product',
        key: `product:${i}:${names}`,
        prompt: `Kaun sa ${resolution.item.spokenName}? Product ka naam bolain.`,
        itemIndex: i,
        resolution,
      };
    }
    if (resolution.status === 'ask_qty') {
      return {
        kind: 'product',
        key: `quantity:${i}:${resolution.product.id}`,
        prompt: `${resolution.product.name} kitni ${resolution.product.unit} add karoon? Quantity bolain.`,
        itemIndex: i,
        resolution,
      };
    }
  }
  if (
    purpose === 'sale' &&
    res.command.intent === 'ADD_AMOUNT_TO_KHATA' &&
    res.amount !== null &&
    res.customer.status === 'found' &&
    canKhataAmount &&
    !shown.amountDone &&
    !shown.amountDeclined
  ) {
    return {
      kind: 'amount',
      key: `amount:${res.customer.customer.id}:${res.amount}`,
      prompt: `${res.customer.customer.name} ke khate mein ${rs(res.amount * 100)} add kar doon? Haan ya nahin bolain.`,
      customerId: res.customer.customer.id,
      amount: res.amount,
    };
  }
  return null;
}

function addedItemsMessage(shown: Shown, purpose: 'sale' | 'purchase' = 'sale'): string {
  const lines = shown.res.items.flatMap((item, i) => {
    const result = shown.done.get(i);
    if ((result !== 'added' && !result?.startsWith('✓')) || item.status !== 'ok') return [];
    return [`${fmtQty(item.qty)} ${item.product.unit} ${item.product.name} ${purpose === 'purchase' ? 'purchase mein add ho gaya.' : 'add ho gaya.'}`];
  });
  if (purpose === 'sale' && shown.res.customer.status === 'found') lines.push(`${shown.res.customer.customer.name} customer select ho gaya.`);
  return lines.join(' ');
}

function speakFeedback(shown: Shown, lang: SpeechLang, canKhataAmount: boolean, prefix = '', purpose: 'sale' | 'purchase' = 'sale') {
  const prompt = nextVoiceStep(shown, canKhataAmount, purpose)?.prompt;
  const text = [prefix, prompt].filter(Boolean).join(' ');
  if (text) speakVoice(text, lang);
}

function quantityForPurpose(item: ItemResolution['item'], product: Product, purpose: 'sale' | 'purchase' = 'sale') {
  if (purpose === 'purchase' && item.spendAmount !== null) {
    return { ask: `Purchase ke liye ${product.name} ki quantity bolain.`, choices: [1, 2, 3, 5] };
  }
  return quantityFor(item, product);
}


function isTyping(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable;
}

export function useVoiceAssistant(api: VoiceBillingApi) {
  const run = useAction();
  const products = useLiveQuery(() => db.products.toArray(), []) ?? [];
  const customers = useLiveQuery(() => db.customers.toArray(), []) ?? [];
  const index = useMemo(() => buildProductIndex(products), [products]);
  const inactiveIndex = useMemo(() => buildProductIndex(products, { includeInactive: true }), [products]);
  const [lang, setLang] = useVoiceLang();
  const [urduVoiceAvailable, setUrduVoiceAvailable] = useState(false);
  const [btn, setBtn] = useState<ButtonState>('idle');
  const [message, setMessage] = useState('');
  const [shown, setShown] = useState<Shown | null>(null);
  const [typing, setTyping] = useState(false);
  const apiRef = useRef(api);
  apiRef.current = api;
  const shownRef = useRef(shown);
  shownRef.current = shown;
  const commandHandlerRef = useRef<(text: string) => void>(() => undefined);
  const answerHandlerRef = useRef<(text: string) => void>(() => undefined);
  const flashTimer = useRef<number>(undefined);

  const flash = (state: ButtonState, ms = 1800) => {
    setBtn(state);
    window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setBtn('idle'), ms);
  };

  const tryVoicePayment = (current: Shown) => {
    const a = apiRef.current;
    if (
      a.purpose === 'purchase' ||
      !current.res.command.payNow ||
      current.res.command.intent === 'ADD_AMOUNT_TO_KHATA' ||
      current.payRequested ||
      current.res.items.some((_, i) => !current.done.has(i) || current.done.get(i) === 'not_added') ||
      nextVoiceStep(current, a.canKhataAmount, a.purpose)
    ) return;

    const next = { ...current, payRequested: true };
    shownRef.current = next;
    setShown(next);
    const pay = a.payNow;
    if (!pay) {
      setMessage('Voice payment is not available here.');
      speakVoice('Voice payment is not available here.', lang);
      return;
    }
    void pay(current.res.paymentMethod ?? 'cash').then((success) => {
      speakVoice(success ? 'Payment complete.' : 'Payment could not be completed.', lang);
    });
  };

  /** Interpret text, add everything that is certain, keep the rest for the shopkeeper to pick. */
  const handleText = useCallback(
    (text: string) => {
      const a = apiRef.current;
      const res = resolveCommand(text, { products, customers, index, inactiveIndex }, a.cartQty);
      const done = new Map<number, string>();
      const overrides = new Map<number, ItemResolution>();
      const added: string[] = [];
      const productIds: string[] = [];

      res.items.forEach((r, i) => {
        if (a.purpose === 'purchase' && r.status === 'ok' && r.item.spendAmount !== null) {
          overrides.set(i, {
            status: 'ask_qty',
            item: r.item,
            product: r.product,
            message: `Purchase ke liye ${r.product.name} ki quantity bolain.`,
            choices: [1, 2, 3, 5],
          });
          return;
        }
        if (r.status === 'ok') {
          if (a.addToBill(r.product, r.qty)) {
            done.set(i, 'added');
            added.push(r.product.id);
            productIds.push(r.product.id);
          } else {
            done.set(i, 'not_added');
          }
        }
      });
      let customerDone = a.purpose === 'purchase' || res.customer.status === 'none';
      if (a.purpose !== 'purchase' && res.customer.status === 'found') {
        a.setCustomer(res.customer.customer.id);
        customerDone = true;
      }
      if (a.purpose !== 'purchase' && res.paymentMethod) a.setPayment(res.paymentMethod);

      const handledItems = [...done.values()].filter((result) => result !== 'not_added').length;
      const pending =
        res.items.length - handledItems +
        (a.purpose === 'purchase' || customerDone ? 0 : 1) +
        (a.purpose === 'sale' && res.command.intent === 'ADD_AMOUNT_TO_KHATA' ? 1 : 0);
      const understood = a.purpose === 'purchase'
        ? res.items.length > 0
        : res.items.length > 0 || res.paymentMethod || res.customer.status !== 'none' || res.amount !== null || res.command.payNow;
      const status: 'success' | 'partial' | 'failed' = !understood ? 'failed' : pending === 0 ? 'success' : 'partial';

      void db.voiceLogs.add({
        id: uid(),
        date: nowIso(),
        spokenText: text,
        parsed: commandToJson(res.command),
        productIds,
        ...(res.customer.status === 'found' ? { customerId: res.customer.customer.id } : {}),
        status,
        lang,
        userId: a.userId,
      });
      void pruneLogs();

      const nextShown = { res, done, overrides, customerDone, amountDone: false, added };
      setShown(nextShown);
      setMessage(res.error ? `${res.error} Heard: “${text}”` : '');
      const rejected = res.items.flatMap((item, i) => done.get(i) === 'not_added' && item.status === 'ok' ? [`${item.product.name} add nahin ho saka.`] : []);
      speakFeedback(nextShown, lang, a.canKhataAmount, [addedItemsMessage(nextShown, a.purpose), ...rejected].filter(Boolean).join(' '), a.purpose);
      tryVoicePayment(nextShown);
      if (status === 'failed') flash('error', 2500);
      else if (status === 'success') flash('success');
      else setBtn('idle');
    },
    [products, customers, index, inactiveIndex, lang],
  );

  const handleError = useCallback((msg: string) => {
    setMessage(msg);
    const step = shownRef.current ? nextVoiceStep(shownRef.current, apiRef.current.canKhataAmount, apiRef.current.purpose) : null;
    if (step) {
      speakVoice(step.prompt, lang);
      flash('error', 2500);
      return;
    }
    setShown(null);
    flash('error', 2500);
  }, [lang]);

  const handleAnswer = useCallback(async (text: string) => {
    const current = shownRef.current;
    if (!current) return;
    const step = nextVoiceStep(current, apiRef.current.canKhataAmount, apiRef.current.purpose);
    if (!step) {
      commandHandlerRef.current(text);
      return;
    }
    const retry = () => {
      const help = step.kind === 'amount'
        ? 'Haan ya nahin bolain.'
        : `Jawab mein option number ya naam bolain. ${step.prompt}`;
      setMessage(help);
      speakVoice(help, lang);
    };

    if (step.kind === 'customer') {
      const index = voiceChoiceIndex(text, step.options);
      const customer = index === null ? undefined : current.res.customer.status === 'ambiguous' ? current.res.customer.options[index] : undefined;
      if (!customer) return retry();
      apiRef.current.setCustomer(customer.id);
      const next = { ...current, customerDone: true };
      shownRef.current = next;
      setShown(next);
      setMessage('');
      speakFeedback(next, lang, apiRef.current.canKhataAmount, `${customer.name} customer select ho gaya.`, apiRef.current.purpose);
      tryVoicePayment(next);
      return;
    }

    if (step.kind === 'product' && step.resolution.status === 'ambiguous') {
      const index = voiceChoiceIndex(text, step.resolution.options);
      const product = index === null ? undefined : step.resolution.options[index];
      if (!product) return retry();
      const quantity = quantityForPurpose(step.resolution.item, product, apiRef.current.purpose);
      if ('ask' in quantity) {
        const overrides = new Map(current.overrides).set(step.itemIndex, {
          status: 'ask_qty',
          item: step.resolution.item,
          product,
          message: quantity.ask,
          choices: quantity.choices,
        });
        const next = { ...current, overrides };
        shownRef.current = next;
        setShown(next);
        setMessage('');
        speakFeedback(next, lang, apiRef.current.canKhataAmount, `${product.name} select ho gaya.`, apiRef.current.purpose);
        return;
      }
      if (!apiRef.current.addToBill(product, quantity.qty)) {
        const done = new Map(current.done).set(step.itemIndex, 'not_added');
        const next = { ...current, done };
        shownRef.current = next;
        setShown(next);
        setMessage(`${product.name} add nahi ho saka.`);
        speakFeedback(next, lang, apiRef.current.canKhataAmount, `${product.name} add nahin ho saka.`, apiRef.current.purpose);
        return;
      }
      const done = new Map(current.done).set(step.itemIndex, `✓ ${fmtQty(quantity.qty)} × ${product.name} added`);
      const next = { ...current, done, added: [...current.added, product.id] };
      shownRef.current = next;
      setShown(next);
      setMessage('');
      speakFeedback(next, lang, apiRef.current.canKhataAmount, `${fmtQty(quantity.qty)} ${product.unit} ${product.name} ${apiRef.current.purpose === 'purchase' ? 'purchase mein add ho gaya.' : 'add ho gaya.'}`, apiRef.current.purpose);
      tryVoicePayment(next);
      return;
    }

    if (step.kind === 'product' && step.resolution.status === 'ask_qty') {
      const quantity = spokenNumber(text);
      if (quantity === null || quantity <= 0) return retry();
      if (!apiRef.current.addToBill(step.resolution.product, quantity)) {
        const done = new Map(current.done).set(step.itemIndex, 'not_added');
        const next = { ...current, done };
        shownRef.current = next;
        setShown(next);
        setMessage(`${step.resolution.product.name} add nahi ho saka.`);
        speakFeedback(next, lang, apiRef.current.canKhataAmount, `${step.resolution.product.name} add nahin ho saka.`, apiRef.current.purpose);
        return;
      }
      const done = new Map(current.done).set(step.itemIndex, `✓ ${fmtQty(quantity)} × ${step.resolution.product.name} added`);
      const next = { ...current, done, added: [...current.added, step.resolution.product.id] };
      shownRef.current = next;
      setShown(next);
      setMessage('');
      speakFeedback(next, lang, apiRef.current.canKhataAmount, `${fmtQty(quantity)} ${step.resolution.product.unit} ${step.resolution.product.name} ${apiRef.current.purpose === 'purchase' ? 'purchase mein add ho gaya.' : 'add ho gaya.'}`, apiRef.current.purpose);
      tryVoicePayment(next);
      return;
    }

    if (step.kind === 'amount') {
      const answer = confirmationAnswer(text);
      if (!answer) return retry();
      if (answer === 'no') {
        const next = { ...current, amountDeclined: true };
        shownRef.current = next;
        setShown(next);
        setMessage('');
        speakFeedback(next, lang, apiRef.current.canKhataAmount, 'Theek hai, raqam khate mein add nahin ki.', apiRef.current.purpose);
        return;
      }
      const success = await run(
        () => addPartyAdjustment('customer', step.customerId, Math.round(step.amount * 100), 'Saman — voice entry', 'adjustment'),
        'Khata updated',
      );
      if (!success) return;
      const next = { ...current, amountDone: true };
      shownRef.current = next;
      setShown(next);
      setMessage('');
      speakFeedback(next, lang, apiRef.current.canKhataAmount, `${rs(step.amount * 100)} customer ke khate mein add ho gaye.`, apiRef.current.purpose);
    }
  }, [lang, run]);

  commandHandlerRef.current = handleText;
  answerHandlerRef.current = (text) => { void handleAnswer(text); };
  const handleSpeechText = useCallback((text: string) => {
    const current = shownRef.current;
    if (current && nextVoiceStep(current, apiRef.current.canKhataAmount, apiRef.current.purpose)) answerHandlerRef.current(text);
    else commandHandlerRef.current(text);
  }, []);

  const handleSleep = useCallback(() => {
    setMessage('Command complete. Hands-free standby hai — aglay command ke liye “Noor” bolain.');
  }, []);

  const speech = useSpeech(lang, handleSpeechText, handleError, handleSleep);
  const pendingVoiceStep = shown ? nextVoiceStep(shown, api.canKhataAmount, api.purpose) : null;

  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      setUrduVoiceAvailable(false);
      return;
    }
    const synthesis = window.speechSynthesis;
    const updateVoices = () => setUrduVoiceAvailable(
      synthesis.getVoices().some((voice) => voice.lang.toLowerCase().startsWith('ur')),
    );
    updateVoices();
    synthesis.addEventListener('voiceschanged', updateVoices);
    return () => synthesis.removeEventListener('voiceschanged', updateVoices);
  }, []);

  useEffect(() => {
    if (speech.state === 'listening') setBtn('listening');
    else if (speech.state === 'processing') setBtn('processing');
  }, [speech.state]);
  useEffect(() => () => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
  }, []);

  const begin = useCallback(() => {
    if (speech.handsFree) return;
    setMessage('');
    speech.start();
  }, [speech.handsFree, speech.start]);
  const end = useCallback(() => speech.stop(), [speech]);

  // Keyboard: hold a configured voice key, or Space when not typing in a field.
  useEffect(() => {
    const keys = api.voiceShortcutKeys ?? DEFAULT_ACTION_SHORTCUTS.voice;
    const isKey = (e: KeyboardEvent) => {
      const key = shortcutFromKeyboardEvent(e);
      const isSpace = key === 'SPACE' || e.code === 'Space';
      return keys.includes(key) && (!isSpace || !isTyping());
    };
    const down = (e: KeyboardEvent) => {
      if (!isKey(e) || speech.handsFree || document.querySelector('[data-modal]')) return;
      e.preventDefault();
      if (!e.repeat) begin();
    };
    const up = (e: KeyboardEvent) => {
      if (!isKey(e) && e.code !== 'Space') return;
      if (speech.state === 'listening') {
        e.preventDefault();
        end();
      }
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [api.voiceShortcutKeys, begin, end, speech.handsFree, speech.state]);

  // Press & hold on the button (mouse, touch, pen). A quick tap toggles listening instead.
  const pressStart = useRef(0);
  const pointerHandlers = {
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault();
      if (speech.handsFree) return;
      if (speech.state === 'listening') {
        end();
        pressStart.current = 0;
        return;
      }
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      pressStart.current = Date.now();
      begin();
    },
    onPointerUp: () => {
      if (!pressStart.current) return;
      const held = Date.now() - pressStart.current;
      pressStart.current = 0;
      if (held > 350) end(); // released after holding → process now; a short tap keeps listening until tapped again
    },
    onPointerCancel: () => {
      if (pressStart.current) end();
      pressStart.current = 0;
    },
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  };

  const label: Record<ButtonState, ReactNode> = {
    idle: (
      <>
        <Mic size={20} /> {pendingVoiceStep ? 'Hold to answer' : 'Hold to speak'}
      </>
    ),
    listening: (
      <>
        <span className="h-3 w-3 animate-pulse rounded-full bg-white" /> {speech.handsFree
          ? speech.wakeWordActive ? 'Noor suna — ab bolain' : 'Listening for “Noor”…'
          : `Listening… release to ${pendingVoiceStep ? 'answer' : 'add'}`}
      </>
    ),
    processing: (
      <>
        <Loader2 size={20} className="animate-spin" /> Processing…
      </>
    ),
    success: (
      <>
        <Check size={20} /> Added
      </>
    ),
    error: (
      <>
        <AlertTriangle size={20} /> Try again
      </>
    ),
  };
  const btnClass: Record<ButtonState, string> = {
    idle: 'bg-slate-900 text-white hover:bg-slate-800',
    listening: 'bg-rose-600 text-white ring-4 ring-rose-200',
    processing: 'bg-amber-500 text-white',
    success: 'bg-emerald-600 text-white',
    error: 'bg-amber-600 text-white',
  };

  const voiceButton = (big: boolean) => (
    <button
      type="button"
      {...pointerHandlers}
      aria-label={speech.handsFree ? 'Wake-word listening is active' : `Hold to speak a ${api.purpose === 'purchase' ? 'purchase' : 'billing'} command`}
      className={cx(
        'flex touch-none select-none items-center justify-center gap-2 font-semibold shadow-sm transition-colors',
        big ? 'w-full rounded-lg py-1 text-xs' : 'h-16 w-16 rounded-full text-sm shadow-lg',
        btnClass[btn],
      )}
    >
      {big ? label[btn] : btn === 'listening' ? <span className="h-4 w-4 animate-pulse rounded-full bg-white" /> : btn === 'processing' ? <Loader2 className="animate-spin" /> : <Mic size={26} />}
    </button>
  );

  /** Voice controls live in the POS header; keep the microphone action with the bill. */
  const controls = (
    <div className="flex flex-wrap items-center justify-start gap-x-1 gap-y-0 text-[10px] text-slate-500">
      <span className="sr-only">
        {speech.handsFree
          ? speech.wakeWordActive
            ? 'Noor suna — command bolain, phir “bs”'
            : 'Hands-free on — “Noor” bolain, command ke baad “bs”'
          : <>Hold {api.voiceShortcutKeys?.join(' or ') ?? 'F8 or SPACE'} to {pendingVoiceStep ? 'answer by voice' : 'speak'}</>}
      </span>
      <Button
        size="sm"
        variant={speech.handsFree ? 'secondary' : 'ghost'}
        className="px-1.5 py-0.5 text-[10px]"
        aria-pressed={speech.handsFree}
        aria-label={speech.handsFree ? 'Turn off Noor hands-free' : 'Enable Noor hands-free'}
        disabled={!speech.supported}
        onClick={() => {
          setMessage('');
          if (speech.handsFree) speech.stopHandsFree();
          else speech.startHandsFree();
        }}
      >
        {speech.handsFree ? 'Noor on' : 'Noor hands-free'}
      </Button>
      <span className="flex items-center gap-1">
        {(['ur-PK', 'en-IN'] as SpeechLang[]).map((l) => (
          <button
            key={l}
            type="button"
            disabled={speech.handsFree}
            onClick={() => setLang(l)}
            className={cx('rounded px-1.5 py-0.5 disabled:cursor-not-allowed disabled:opacity-50', lang === l ? 'bg-slate-800 text-white' : 'hover:bg-slate-100')}
            title={l === 'ur-PK' ? 'Urdu speech' : 'Roman Urdu / English speech'}
          >
            {l === 'ur-PK' ? 'اردو' : 'Roman'}
          </button>
        ))}
        <button type="button" className="ml-1 rounded p-0.5 hover:bg-slate-100" title="Type a command instead" onClick={() => setTyping((t) => !t)}>
          <Keyboard size={14} />
        </button>
      </span>
      {lang === 'ur-PK' && !urduVoiceAvailable && <span role="status" className="sr-only">Urdu speech voice is not installed on this device.</span>}
      {typing && <TypedCommand onSubmit={handleText} purpose={api.purpose} />}
    </div>
  );

  const button = (
    <div>{voiceButton(true)}</div>
  );

  /** Floating thumb button for phones/tablets (hidden on desktop where the big button is visible). */
  const floatingButton = <div className="fixed right-4 bottom-4 z-30 print:hidden lg:hidden">{voiceButton(false)}</div>;

  const panel =
    speech.state === 'listening' || speech.state === 'processing' || shown || message ? (
      <VoicePanel
        listening={speech.state === 'listening'}
        handsFree={speech.handsFree}
        wakeWordActive={speech.wakeWordActive}
        interim={speech.interim}
        message={message}
        shown={shown}
        api={api}
        lang={lang}
        onUpdate={setShown}
        onReadyToPay={tryVoicePayment}
        onClose={() => {
          if ('speechSynthesis' in window) window.speechSynthesis.cancel();
          setShown(null);
          setMessage('');
        }}
        onAmount={async (customerId, amount) => {
          const success = await run(
            () => addPartyAdjustment('customer', customerId, Math.round(amount * 100), `Saman — voice entry`, 'adjustment'),
            'Khata updated',
          );
          if (success) setShown((s) => {
            if (!s) return s;
            const next = { ...s, amountDone: true };
            shownRef.current = next;
            speakFeedback(next, lang, apiRef.current.canKhataAmount, `${rs(amount * 100)} customer ke khate mein add ho gaye.`, apiRef.current.purpose);
            return next;
          });
          return success;
        }}
      />
    ) : null;

  return { button, controls, floatingButton, panel, listening: speech.state === 'listening', stopHandsFree: speech.stopHandsFree };
}

async function pruneLogs() {
  const count = await db.voiceLogs.count();
  if (count <= 500) return;
  const old = await db.voiceLogs.orderBy('date').limit(count - 500).primaryKeys();
  await db.voiceLogs.bulkDelete(old);
}

function TypedCommand({ onSubmit, purpose }: { onSubmit: (text: string) => void; purpose?: 'sale' | 'purchase' }) {
  const [text, setText] = useState('');
  return (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (text.trim()) onSubmit(text.trim());
        setText('');
      }}
    >
      <Input value={text} onChange={(e) => setText(e.target.value)} placeholder={purpose === 'purchase' ? 'e.g. 2 carton Sooper aur 5 kg cheeni' : 'e.g. 2 Sooper 50 wale aur aadha kilo cheeni'} />
      <Button type="submit" size="sm">
        Go
      </Button>
    </form>
  );
}

function VoicePanel({
  listening,
  handsFree,
  wakeWordActive,
  interim,
  message,
  shown,
  api,
  lang,
  onUpdate,
  onReadyToPay,
  onClose,
  onAmount,
}: {
  listening: boolean;
  handsFree: boolean;
  wakeWordActive: boolean;
  interim: string;
  message: string;
  shown: Shown | null;
  api: VoiceBillingApi;
  lang: SpeechLang;
  onUpdate: (s: Shown | null) => void;
  onReadyToPay: (s: Shown) => void;
  onClose: () => void;
  onAmount: (customerId: string, amount: number) => Promise<boolean>;
}) {
  const res = shown?.res;
  const pendingStep = shown ? nextVoiceStep(shown, api.canKhataAmount, api.purpose) : null;

  const updateAndSpeak = (next: Shown, message = '') => {
    onUpdate(next);
    speakFeedback(next, lang, api.canKhataAmount, message, api.purpose);
    onReadyToPay(next);
  };
  const markItem = (i: number, what = 'skipped') => {
    if (shown) {
      const next = { ...shown, done: new Map(shown.done).set(i, what) };
      updateAndSpeak(next, what === 'skipped' ? 'Theek hai, is product ko chhor diya.' : '');
    }
  };
  const pick = (i: number, product: Product, qty: number) => {
    if (shown) {
      if (!api.addToBill(product, qty)) {
        const next = { ...shown, done: new Map(shown.done).set(i, 'not_added') };
        updateAndSpeak(next, `${product.name} stock available nahin, bill mein add nahin hua.`);
        return;
      }
      const next = {
        ...shown,
        done: new Map(shown.done).set(i, `✓ ${fmtQty(qty)} × ${product.name} added`),
        added: [...shown.added, product.id],
      };
      updateAndSpeak(next, `${fmtQty(qty)} ${product.unit} ${product.name} ${api.purpose === 'purchase' ? 'purchase mein add ho gaya.' : 'add ho gaya.'}`);
    }
  };

  return (
    <div className="border-b border-slate-100 bg-slate-50 px-3 py-2.5 text-sm" aria-live="polite">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          {listening ? (
            <p className="flex items-center gap-2 font-medium text-rose-600">
              <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-rose-500" />
              {handsFree
                ? wakeWordActive ? 'Command bolain, phir “bs”' : 'Standby: “Noor” bolain'
                : <>Listening… {interim && <span className="text-slate-700">“{interim}”</span>}</>}
              {handsFree && interim && wakeWordActive && <span className="text-slate-700">“{interim}”</span>}
            </p>
          ) : res ? (
            <p className="text-slate-600">
              🎤 <span className="font-medium text-slate-800">“{res.command.text}”</span>
            </p>
          ) : interim ? (
            <p className="text-slate-600">🎤 “{interim}”</p>
          ) : null}
          {message && <p className="mt-1 font-medium text-amber-700">⚠ {message}</p>}
          {pendingStep && <p className="mt-1 text-xs font-medium text-sky-800">Answer by voice: say an option number or name{pendingStep.kind === 'amount' ? ', or say yes/no' : ''}.</p>}
        </div>
        {!listening && (
          <button className="rounded p-1 text-slate-400 hover:bg-white hover:text-slate-600" onClick={onClose} aria-label="Close voice result">
            <X size={16} />
          </button>
        )}
      </div>

      {res && shown && (
        <ul className="mt-2 space-y-1.5">
          {/* Customer */}
          {api.purpose !== 'purchase' && res.customer.status === 'found' && (
            <li className="text-emerald-700">✓ {res.customer.customer.name}</li>
          )}
          {api.purpose !== 'purchase' && res.customer.status === 'not_found' && (
            <li className="text-amber-700">⚠ {res.customer.message} Neeche se customer select ya add karein.</li>
          )}
          {api.purpose !== 'purchase' && res.customer.status === 'ambiguous' && !shown.customerDone && (
            <li>
              <p className="mb-1 font-medium">{res.customer.message}</p>
              <div className="flex flex-wrap gap-1.5">
                {res.customer.options.map((c) => (
                  <Button
                    key={c.id}
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      api.setCustomer(c.id);
                      updateAndSpeak({ ...shown, customerDone: true }, `${c.name} customer select ho gaya.`);
                    }}
                  >
                    {c.name}
                    {c.phone && <span className="text-xs text-slate-400">{c.phone}</span>}
                  </Button>
                ))}
              </div>
            </li>
          )}
          {api.purpose !== 'purchase' && res.customer.status === 'ambiguous' && shown.customerDone && <li className="text-emerald-700">✓ Customer selected</li>}

          {/* Items */}
          {res.items.map((orig, i) => {
            const r = shown.overrides.get(i) ?? orig;
            return (
              <ItemRow
                key={i}
                r={r}
                done={shown.done.get(i)}
                api={api}
                onPick={(p, q) => pick(i, p, q)}
                onChoose={(p) => {
                  // Picked from a list: work out the quantity for that product (e.g. "aadha kilo" of a 1 kg packet → ask).
                  const q = quantityForPurpose(r.item, p, api.purpose);
                  if ('ask' in q) updateAndSpeak(
                    { ...shown, overrides: new Map(shown.overrides).set(i, { status: 'ask_qty', item: r.item, product: p, message: q.ask, choices: q.choices }) },
                    `${p.name} select ho gaya.`,
                  );
                  else pick(i, p, q.qty);
                }}
                onSkip={() => markItem(i)}
              />
            );
          })}

          {/* "500 ka saman" on khata */}
          {api.purpose !== 'purchase' && res.command.intent === 'ADD_AMOUNT_TO_KHATA' && res.amount !== null && (
            <li className="rounded-lg border border-amber-200 bg-amber-50 p-2">
              {shown.amountDone ? (
                <span className="text-emerald-700">✓ {rs(res.amount * 100)} khate mein add ho gaye</span>
              ) : shown.amountDeclined ? (
                <span className="text-slate-500">Raqam khate mein add nahin ki.</span>
              ) : res.customer.status === 'found' ? (
                api.canKhataAmount ? (
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      <b>{res.customer.customer.name}</b> ke khate mein <b>{rs(res.amount * 100)}</b> ka saman likhein? (stock nahi kategi)
                    </span>
                    <Button size="sm" variant="danger" onClick={() => {
                      if (res.customer.status === 'found') void onAmount(res.customer.customer.id, res.amount!);
                    }}>
                      Khate mein add karein
                    </Button>
                  </div>
                ) : (
                  <span>Sirf owner/manager khate mein seedha raqam add kar sakte hain.</span>
                )
              ) : (
                <span>Pehle customer select karein, phir {rs(res.amount * 100)} khate mein add hoga.</span>
              )}
            </li>
          )}

          {/* Payment */}
          {api.purpose !== 'purchase' && res.paymentMethod === 'credit' && (
            <li className="font-medium text-rose-700">
              ✓ Payment: UDHAAR
              {!api.customerId && ' — customer select karna zaroori hai'}
            </li>
          )}
          {api.purpose !== 'purchase' && res.paymentMethod === 'cash' && <li className="font-medium text-emerald-700">✓ Payment: Cash</li>}
        </ul>
      )}
    </div>
  );
}

function ItemRow({
  r,
  done,
  api,
  onPick,
  onChoose,
  onSkip,
}: {
  r: ItemResolution;
  done: string | undefined;
  api: VoiceBillingApi;
  onPick: (p: Product, qty: number) => void;
  onChoose: (p: Product) => void;
  onSkip: () => void;
}) {
  if (done === 'not_added') {
    return <li className="font-medium text-amber-700">⚠ {r.item.spokenName}: add nahin ho saka.</li>;
  }
  if (r.status === 'ok') {
    return (
      <li>
        <span className="text-emerald-700">
          ✓ {fmtQty(r.qty)} × {r.product.name}{' '}
          <span className="text-slate-500">
            ({api.purpose === 'purchase' ? `${rs(r.product.cost)}/${r.product.unit} buy cost` : `${rs(r.product.salePrice)}/${r.product.unit}`})
          </span>
        </span>
        {api.purpose !== 'purchase' && r.note && <span className="ml-1 text-xs text-slate-500">· {r.note}</span>}
        {api.purpose !== 'purchase' && r.warning && <div className="text-xs font-medium text-amber-700">⚠ {r.warning}</div>}
      </li>
    );
  }
  if (done) return <li className={done === 'skipped' ? 'text-slate-400' : 'text-emerald-700'}>{done === 'skipped' ? `${r.item.spokenName} — skipped` : done}</li>;

  if (r.status === 'ambiguous') {
    const q = r.item.quantity;
    return (
      <li>
        <p className="mb-1 font-medium">
          Which {r.item.spokenName}? <span className="font-normal text-slate-500">({r.message})</span>
        </p>
        <div className="flex flex-wrap gap-1.5">
          {r.options.map((p) => {
            const warn = api.purpose === 'purchase' ? undefined : stockWarning(p, q, api.cartQty(p.id));
            return (
              <Button key={p.id} size="sm" variant="secondary" onClick={() => onChoose(p)} title={warn}>
                {p.name} · {api.purpose === 'purchase' ? `${rs(p.cost)}/${p.unit} buy cost` : `${rs(p.salePrice)}/${p.unit} · ${fmtQty(p.stock)} in stock`}
                {api.purpose !== 'purchase' && p.stock <= 0 && <Badge tone="red">0 stock</Badge>}
              </Button>
            );
          })}
          <Button size="sm" variant="ghost" onClick={onSkip}>
            Skip
          </Button>
        </div>
      </li>
    );
  }
  if (r.status === 'inactive') {
    return (
      <li className="flex flex-wrap items-center gap-2 text-amber-700">
        <span>⚠ {r.message}</span>
        <Button size="sm" variant="ghost" onClick={onSkip}>
          Skip
        </Button>
      </li>
    );
  }
  if (r.status === 'ask_qty') {
    return (
      <li>
        <p className="mb-1 font-medium">{r.message}</p>
        <div className="flex flex-wrap gap-1.5">
          {r.choices.map((c) => (
            <Button key={c} size="sm" variant="secondary" onClick={() => onPick(r.product, c)}>
              {fmtQty(c)} {r.product.unit}
            </Button>
          ))}
          <Button size="sm" variant="ghost" onClick={onSkip}>
            Skip
          </Button>
        </div>
      </li>
    );
  }
  return (
    <li className="flex flex-wrap items-center gap-2 text-amber-700">
      ⚠ {r.message}
      <Button
        size="sm"
        variant="secondary"
        onClick={() => {
          api.searchProduct(r.item.spokenName);
          onSkip();
        }}
      >
        <Search size={14} /> Search
      </Button>
    </li>
  );
}
