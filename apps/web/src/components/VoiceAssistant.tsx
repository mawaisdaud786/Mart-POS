import { useLiveQuery } from 'dexie-react-hooks';
import { AlertTriangle, Check, Keyboard, Loader2, Mic, Search, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { db, nowIso, uid, type Product } from '../lib/db';
import { qty as fmtQty, rs } from '../lib/format';
import { addPartyAdjustment } from '../lib/ops';
import { commandToJson } from '../lib/voice/parse';
import { buildProductIndex, quantityFor, resolveCommand, stockWarning, type ItemResolution, type Resolution } from '../lib/voice/resolve';
import { useSpeech, type SpeechLang } from '../lib/voice/speech';
import { Badge, Button, Input, cx, useAction } from './ui';

/**
 * Urdu / Roman Urdu voice billing. Voice only fills the draft bill through the same
 * add-to-cart, customer and payment controls as manual billing; the shopkeeper still
 * reviews and presses Pay to save. Prices, stock and customers come from the database.
 */

export interface VoiceBillingApi {
  /** Quantity of a product already on the bill. */
  cartQty: (productId: string) => number;
  customerId?: string;
  addToBill: (product: Product, qty: number) => void;
  setCustomer: (customerId: string) => void;
  setPayment: (mode: 'cash' | 'credit') => void;
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
  added: string[];
}

const LANG_KEY = 'retailos.voiceLang';

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
  const [lang, setLang] = useState<SpeechLang>(() => (localStorage.getItem(LANG_KEY) as SpeechLang) || 'ur-PK');
  const [btn, setBtn] = useState<ButtonState>('idle');
  const [message, setMessage] = useState('');
  const [shown, setShown] = useState<Shown | null>(null);
  const [typing, setTyping] = useState(false);
  const apiRef = useRef(api);
  apiRef.current = api;
  const flashTimer = useRef<number>(undefined);

  const flash = (state: ButtonState, ms = 1800) => {
    setBtn(state);
    window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setBtn('idle'), ms);
  };

  /** Interpret text, add everything that is certain, keep the rest for the shopkeeper to pick. */
  const handleText = useCallback(
    (text: string) => {
      const a = apiRef.current;
      const res = resolveCommand(text, { products, customers, index }, a.cartQty);
      const done = new Map<number, string>();
      const added: string[] = [];
      const productIds: string[] = [];

      res.items.forEach((r, i) => {
        if (r.status === 'ok') {
          a.addToBill(r.product, r.qty);
          done.set(i, 'added');
          added.push(r.product.id);
          productIds.push(r.product.id);
        }
      });
      let customerDone = res.customer.status === 'none';
      if (res.customer.status === 'found') {
        a.setCustomer(res.customer.customer.id);
        customerDone = true;
      }
      if (res.paymentMethod) a.setPayment(res.paymentMethod);

      const pending =
        res.items.length - done.size +
        (customerDone ? 0 : 1) +
        (res.command.intent === 'ADD_AMOUNT_TO_KHATA' ? 1 : 0);
      const understood = res.items.length > 0 || res.paymentMethod || res.customer.status !== 'none' || res.amount !== null;
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

      setShown({ res, done, overrides: new Map(), customerDone, amountDone: false, added });
      setMessage(res.error ?? '');
      if (status === 'failed') flash('error', 2500);
      else if (status === 'success') flash('success');
      else setBtn('idle');
    },
    [products, customers, index, lang],
  );

  const handleError = useCallback((msg: string) => {
    setMessage(msg);
    setShown(null);
    flash('error', 2500);
  }, []);

  const speech = useSpeech(lang, handleText, handleError);

  useEffect(() => {
    if (speech.state === 'listening') setBtn('listening');
    else if (speech.state === 'processing') setBtn('processing');
  }, [speech.state]);

  const begin = useCallback(() => {
    setMessage('');
    speech.start();
  }, [speech]);
  const end = useCallback(() => speech.stop(), [speech]);

  // Keyboard: hold F8 anywhere, or hold Space when not typing in a field. Ignored while a dialog is open.
  useEffect(() => {
    const isKey = (e: KeyboardEvent) => e.key === 'F8' || (e.code === 'Space' && !isTyping());
    const down = (e: KeyboardEvent) => {
      if (!isKey(e) || document.querySelector('[data-modal]')) return;
      e.preventDefault();
      if (!e.repeat) begin();
    };
    const up = (e: KeyboardEvent) => {
      if (e.key !== 'F8' && e.code !== 'Space') return;
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
  }, [begin, end, speech.state]);

  // Press & hold on the button (mouse, touch, pen). A quick tap toggles listening instead.
  const pressStart = useRef(0);
  const pointerHandlers = {
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault();
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
        <Mic size={20} /> Hold to speak
      </>
    ),
    listening: (
      <>
        <span className="h-3 w-3 animate-pulse rounded-full bg-white" /> Listening… release to add
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
      aria-label="Hold to speak a billing command"
      className={cx(
        'flex touch-none select-none items-center justify-center gap-2 font-semibold shadow-sm transition-colors',
        big ? 'w-full rounded-xl py-2.5 text-base' : 'h-16 w-16 rounded-full text-sm shadow-lg',
        btnClass[btn],
      )}
    >
      {big ? label[btn] : btn === 'listening' ? <span className="h-4 w-4 animate-pulse rounded-full bg-white" /> : btn === 'processing' ? <Loader2 className="animate-spin" /> : <Mic size={26} />}
    </button>
  );

  /** Large button for the bill panel, with language switch and shortcut hint. */
  const button = (
    <div className="space-y-1">
      {voiceButton(true)}
      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>
          Hold <kbd className="rounded border border-slate-300 bg-slate-50 px-1">F8</kbd> or{' '}
          <kbd className="rounded border border-slate-300 bg-slate-50 px-1">Space</kbd>
        </span>
        <span className="flex items-center gap-1">
          {(['ur-PK', 'en-IN'] as SpeechLang[]).map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => {
                setLang(l);
                localStorage.setItem(LANG_KEY, l);
              }}
              className={cx('rounded px-1.5 py-0.5', lang === l ? 'bg-slate-800 text-white' : 'hover:bg-slate-100')}
              title={l === 'ur-PK' ? 'Urdu speech' : 'Roman Urdu / English speech'}
            >
              {l === 'ur-PK' ? 'اردو' : 'Roman'}
            </button>
          ))}
          <button type="button" className="ml-1 rounded p-0.5 hover:bg-slate-100" title="Type a command instead" onClick={() => setTyping((t) => !t)}>
            <Keyboard size={14} />
          </button>
        </span>
      </div>
      {typing && <TypedCommand onSubmit={handleText} />}
    </div>
  );

  /** Floating thumb button for phones/tablets (hidden on desktop where the big button is visible). */
  const floatingButton = <div className="fixed right-4 bottom-4 z-30 print:hidden lg:hidden">{voiceButton(false)}</div>;

  const panel =
    speech.state === 'listening' || speech.state === 'processing' || shown || message ? (
      <VoicePanel
        listening={speech.state === 'listening'}
        interim={speech.interim}
        message={message}
        shown={shown}
        api={api}
        onUpdate={setShown}
        onClose={() => {
          setShown(null);
          setMessage('');
        }}
        onAmount={(customerId, amount) =>
          run(async () => {
            await addPartyAdjustment('customer', customerId, Math.round(amount * 100), `Saman — voice entry`, 'adjustment');
            setShown((s) => (s ? { ...s, amountDone: true } : s));
          }, 'Khata updated')
        }
      />
    ) : null;

  return { button, floatingButton, panel, listening: speech.state === 'listening' };
}

async function pruneLogs() {
  const count = await db.voiceLogs.count();
  if (count <= 500) return;
  const old = await db.voiceLogs.orderBy('date').limit(count - 500).primaryKeys();
  await db.voiceLogs.bulkDelete(old);
}

function TypedCommand({ onSubmit }: { onSubmit: (text: string) => void }) {
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
      <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. 2 Sooper 50 wale aur aadha kilo cheeni" />
      <Button type="submit" size="sm">
        Go
      </Button>
    </form>
  );
}

function VoicePanel({
  listening,
  interim,
  message,
  shown,
  api,
  onUpdate,
  onClose,
  onAmount,
}: {
  listening: boolean;
  interim: string;
  message: string;
  shown: Shown | null;
  api: VoiceBillingApi;
  onUpdate: (s: Shown | null) => void;
  onClose: () => void;
  onAmount: (customerId: string, amount: number) => void;
}) {
  const res = shown?.res;

  const markItem = (i: number, what = 'skipped') => shown && onUpdate({ ...shown, done: new Map(shown.done).set(i, what) });
  const pick = (i: number, product: Product, qty: number) => {
    api.addToBill(product, qty);
    if (shown) onUpdate({ ...shown, done: new Map(shown.done).set(i, `✓ ${fmtQty(qty)} × ${product.name} added`), added: [...shown.added, product.id] });
  };

  return (
    <div className="border-b border-slate-100 bg-slate-50 px-3 py-2.5 text-sm" aria-live="polite">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          {listening ? (
            <p className="flex items-center gap-2 font-medium text-rose-600">
              <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-rose-500" /> Listening… {interim && <span className="text-slate-700">“{interim}”</span>}
            </p>
          ) : res ? (
            <p className="text-slate-600">
              🎤 <span className="font-medium text-slate-800">“{res.command.text}”</span>
            </p>
          ) : interim ? (
            <p className="text-slate-600">🎤 “{interim}”</p>
          ) : null}
          {message && <p className="mt-1 font-medium text-amber-700">⚠ {message}</p>}
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
          {res.customer.status === 'found' && (
            <li className="text-emerald-700">✓ {res.customer.customer.name}</li>
          )}
          {res.customer.status === 'not_found' && (
            <li className="text-amber-700">⚠ {res.customer.message} Neeche se customer select ya add karein.</li>
          )}
          {res.customer.status === 'ambiguous' && !shown.customerDone && (
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
                      onUpdate({ ...shown, customerDone: true });
                    }}
                  >
                    {c.name}
                    {c.phone && <span className="text-xs text-slate-400">{c.phone}</span>}
                  </Button>
                ))}
              </div>
            </li>
          )}
          {res.customer.status === 'ambiguous' && shown.customerDone && <li className="text-emerald-700">✓ Customer selected</li>}

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
                  const q = quantityFor(r.item, p);
                  if ('ask' in q) onUpdate({ ...shown, overrides: new Map(shown.overrides).set(i, { status: 'ask_qty', item: r.item, product: p, message: q.ask, choices: q.choices }) });
                  else pick(i, p, q.qty);
                }}
                onSkip={() => markItem(i)}
              />
            );
          })}

          {/* "500 ka saman" on khata */}
          {res.command.intent === 'ADD_AMOUNT_TO_KHATA' && res.amount !== null && (
            <li className="rounded-lg border border-amber-200 bg-amber-50 p-2">
              {shown.amountDone ? (
                <span className="text-emerald-700">✓ {rs(res.amount * 100)} khate mein add ho gaye</span>
              ) : res.customer.status === 'found' ? (
                api.canKhataAmount ? (
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      <b>{res.customer.customer.name}</b> ke khate mein <b>{rs(res.amount * 100)}</b> ka saman likhein? (stock nahi kategi)
                    </span>
                    <Button size="sm" variant="danger" onClick={() => res.customer.status === 'found' && onAmount(res.customer.customer.id, res.amount!)}>
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
          {res.paymentMethod === 'credit' && (
            <li className="font-medium text-rose-700">
              ✓ Payment: UDHAAR
              {!api.customerId && ' — customer select karna zaroori hai'}
            </li>
          )}
          {res.paymentMethod === 'cash' && <li className="font-medium text-emerald-700">✓ Payment: Cash</li>}
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
  if (r.status === 'ok') {
    return (
      <li>
        <span className="text-emerald-700">
          ✓ {fmtQty(r.qty)} × {r.product.name} <span className="text-slate-500">({rs(r.product.salePrice)}/{r.product.unit})</span>
        </span>
        {r.note && <span className="ml-1 text-xs text-slate-500">· {r.note}</span>}
        {r.warning && <div className="text-xs font-medium text-amber-700">⚠ {r.warning}</div>}
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
            const warn = stockWarning(p, q, api.cartQty(p.id));
            return (
              <Button key={p.id} size="sm" variant="secondary" onClick={() => onChoose(p)} title={warn}>
                {p.name} · {rs(p.salePrice)}
                {p.stock <= 0 && <Badge tone="red">0 stock</Badge>}
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
