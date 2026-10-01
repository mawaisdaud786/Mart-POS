import { useLiveQuery } from 'dexie-react-hooks';
import { Delete, Lock } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cx } from '../components/ui';
import { db, type User } from '../lib/db';
import { useSession } from '../lib/session';

/** Pick a user and enter PIN (works with keyboard too). */
export function Login() {
  const { login, settings } = useSession();
  const users = useLiveQuery(() => db.users.filter((u) => u.active).toArray(), []) ?? [];
  const [selected, setSelected] = useState<User | null>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!selected && users.length === 1) setSelected(users[0]);
  }, [users, selected]);

  useEffect(() => {
    if (!selected || pin.length < selected.pin.length) return;
    if (pin === selected.pin) login(selected);
    else {
      setError('Wrong PIN');
      setPin('');
    }
  }, [pin, selected, login]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) setPin((p) => (p + e.key).slice(0, 6));
      if (e.key === 'Backspace') setPin((p) => p.slice(0, -1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const press = (d: string) => {
    setError('');
    setPin((p) => (p + d).slice(0, 6));
  };

  return (
    <div className="flex min-h-full items-center justify-center bg-slate-900 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-4 text-center">
          <div className="mx-auto mb-2 grid h-12 w-12 place-items-center rounded-full bg-brand-50 text-brand-700">
            <Lock />
          </div>
          <h1 className="text-xl font-bold">{settings?.shopName}</h1>
          <p className="text-sm text-slate-500">{selected ? `Enter PIN for ${selected.name}` : 'Who is using the till?'}</p>
        </div>
        <div className="mb-4 flex flex-wrap justify-center gap-2">
          {users.map((u) => (
            <button
              key={u.id}
              onClick={() => {
                setSelected(u);
                setPin('');
                setError('');
              }}
              className={cx(
                'rounded-full border px-3 py-1.5 text-sm',
                selected?.id === u.id ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 hover:bg-slate-50',
              )}
            >
              {u.name}
            </button>
          ))}
        </div>
        {selected && (
          <>
            <div className="mb-2 flex justify-center gap-3">
              {Array.from({ length: selected.pin.length }).map((_, i) => (
                <span key={i} className={cx('h-3.5 w-3.5 rounded-full', i < pin.length ? 'bg-brand-600' : 'bg-slate-200')} />
              ))}
            </div>
            <p className="mb-3 h-5 text-center text-sm text-rose-600">{error}</p>
            <div className="grid grid-cols-3 gap-2">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
                <button key={d} onClick={() => press(d)} className="rounded-xl bg-slate-100 py-4 text-xl font-semibold hover:bg-slate-200">
                  {d}
                </button>
              ))}
              <span />
              <button onClick={() => press('0')} className="rounded-xl bg-slate-100 py-4 text-xl font-semibold hover:bg-slate-200">
                0
              </button>
              <button onClick={() => setPin((p) => p.slice(0, -1))} className="grid place-items-center rounded-xl py-4 text-slate-500 hover:bg-slate-100" aria-label="Delete">
                <Delete />
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
