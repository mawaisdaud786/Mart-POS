import { X } from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react';

export function cx(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(' ');
}

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'success';
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-brand-800 text-white shadow-sm shadow-brand-900/20 hover:bg-brand-900 disabled:bg-brand-800/50',
  success: 'bg-brand-800 text-white shadow-sm shadow-brand-900/10 hover:bg-brand-900 disabled:bg-brand-800/50',
  secondary: 'border border-slate-400 bg-white text-slate-900 shadow-sm hover:border-brand-800 hover:bg-brand-50 disabled:opacity-50',
  danger: 'bg-rose-600 text-white hover:bg-rose-700 disabled:bg-rose-600/50',
  ghost: 'text-slate-800 hover:bg-slate-200 disabled:opacity-50',
};

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg' }) {
  return (
    <button
      type="button"
      {...props}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-all duration-150 disabled:cursor-not-allowed',
        size === 'sm' && 'px-2.5 py-1.5 text-sm',
        size === 'md' && 'px-4 py-2 text-sm',
        size === 'lg' && 'px-5 py-3 text-base',
        VARIANTS[variant],
        className,
      )}
    />
  );
}

export function Field({ label, hint, children, className }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={cx('block', className)}>
      <span className="mb-1 block text-sm font-semibold text-slate-800">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

const inputClass =
  'min-h-10 w-full rounded-xl border border-slate-400 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition-shadow placeholder:text-slate-500 focus:border-brand-800 focus:ring-4 focus:ring-brand-100 disabled:bg-slate-100';

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement> & { ref?: React.Ref<HTMLInputElement> }) {
  return <input {...props} className={cx(inputClass, className)} />;
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...props} className={cx(inputClass, className)}>
      {children}
    </select>
  );
}

export function Textarea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cx(inputClass, className)} />;
}

export function Card({ children, className, title, actions }: { children: ReactNode; className?: string; title?: ReactNode; actions?: ReactNode }) {
  return (
    <div className={cx('overflow-hidden rounded-2xl border border-slate-300 bg-white shadow-md shadow-slate-900/[0.07]', className)}>
      {(title || actions) && (
        <div className="flex items-center justify-between gap-2 border-b border-slate-300 bg-gradient-to-r from-white to-brand-50 px-4 py-3.5">
          <h3 className="font-bold tracking-tight text-slate-950">{title}</h3>
          {actions}
        </div>
      )}
      {children}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="border-l-4 border-brand-800 pl-3">
        <h1 className="text-2xl font-extrabold tracking-tight text-slate-950 sm:text-[1.7rem]">{title}</h1>
        {subtitle && <p className="mt-1 text-sm font-medium text-slate-700">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

type Tone = 'default' | 'green' | 'red' | 'amber' | 'blue';
const TONES: Record<Tone, string> = {
  default: 'text-slate-900',
  green: 'text-emerald-600',
  red: 'text-rose-600',
  amber: 'text-amber-600',
  blue: 'text-sky-600',
};

export function Stat({ label, value, sub, tone = 'default', icon }: { label: string; value: ReactNode; sub?: ReactNode; tone?: Tone; icon?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-300 border-l-4 border-l-brand-800 bg-white p-4 shadow-md shadow-slate-900/[0.06]">
      <div className="flex items-center justify-between text-sm text-slate-500">
        <span className="font-semibold text-slate-700">{label}</span>
        {icon}
      </div>
      <div className={cx('mt-1 text-2xl font-bold tabular-nums', TONES[tone])}>{value}</div>
      {sub && <div className="mt-1 text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

const BADGES: Record<Tone, string> = {
  default: 'bg-slate-100 text-slate-700',
  green: 'bg-emerald-100 text-emerald-700',
  red: 'bg-rose-100 text-rose-700',
  amber: 'bg-amber-100 text-amber-800',
  blue: 'bg-sky-100 text-sky-700',
};

export function Badge({ children, tone = 'default' }: { children: ReactNode; tone?: Tone }) {
  return <span className={cx('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', BADGES[tone])}>{children}</span>;
}

export function Modal({
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div data-modal className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 sm:items-center" onMouseDown={onClose}>
      <div
        className={cx('w-full rounded-xl bg-white shadow-xl', wide ? 'max-w-3xl' : 'max-w-lg')}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button className="rounded p-1 text-slate-500 hover:bg-slate-100" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-4 py-14 text-center text-slate-500">
      {icon && <div className="mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-emerald-50 text-emerald-700">{icon}</div>}
      <p className="font-medium text-slate-700">{title}</p>
      {children && <div className="mt-1 text-sm">{children}</div>}
    </div>
  );
}

export const th = 'px-3 py-2 text-left text-xs font-bold uppercase tracking-wide text-slate-800';
export const td = 'px-3 py-2 text-sm';

/** Rupee amount input that reports paisa. */
export function MoneyInput({
  value,
  onChange,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & { value: number; onChange: (paisa: number) => void }) {
  const [text, setText] = useState(value ? String(value / 100) : '');
  useEffect(() => {
    const current = Math.round(Number(text || 0) * 100);
    if (current !== value) setText(value ? String(value / 100) : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <Input
      inputMode="decimal"
      placeholder="0"
      {...props}
      value={text}
      onChange={(e) => {
        const v = e.target.value.replace(/[^\d.]/g, '');
        setText(v);
        onChange(Math.round(Number(v || 0) * 100));
      }}
    />
  );
}

// ---- Toasts ----
type ToastItem = { id: number; text: string; tone: 'ok' | 'error' };
const ToastCtx = createContext<(text: string, tone?: 'ok' | 'error') => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((text: string, tone: 'ok' | 'error' = 'ok') => {
    const id = Date.now() + Math.random();
    setItems((xs) => [...xs, { id, text, tone }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2 print:hidden">
        {items.map((t) => (
          <div
            key={t.id}
            className={cx('rounded-lg px-4 py-2 text-sm text-white shadow-lg', t.tone === 'ok' ? 'bg-slate-900' : 'bg-rose-600')}
          >
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);

/** Run an async action and show success/error toasts. */
export function useAction() {
  const toast = useToast();
  return useCallback(
    async (fn: () => Promise<unknown>, success?: string) => {
      try {
        await fn();
        if (success) toast(success);
        return true;
      } catch (e) {
        toast(e instanceof Error ? e.message : 'Something went wrong', 'error');
        return false;
      }
    },
    [toast],
  );
}
