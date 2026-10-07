import { useState } from 'react';
import { Button, Field, Input, MoneyInput, useAction } from '../components/ui';
import { setupShop } from '../lib/ops';

/** First run: save the shop profile and opening cash for the signed-in owner. */
export function Setup() {
  const [shopName, setShopName] = useState('Al Noor Mart');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [openingCash, setOpeningCash] = useState(0);
  const run = useAction();

  const valid = shopName.trim();

  return (
    <div className="flex min-h-full items-center justify-center bg-[#073b28] p-4 sm:p-8">
      <div className="w-full max-w-xl rounded-[1.75rem] border border-white/70 bg-white p-6 shadow-2xl shadow-emerald-950/30 sm:p-8">
        <div className="mb-6 flex items-center gap-4">
          <div className="grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-2xl bg-white p-0.5 shadow-sm ring-1 ring-emerald-900/10">
            <img src="/al-noor-mart-logo.jpeg" alt="Al Noor Mart logo" className="h-full w-full rounded-xl object-contain" />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-bold tracking-tight text-emerald-950">Welcome to Al Noor Mart</h1>
            <p className="mt-1 text-sm text-slate-500">Set up your shop. Takes one minute.</p>
          </div>
        </div>
        <div className="grid gap-4">
          <Field label="Shop name">
            <Input value={shopName} onChange={(e) => setShopName(e.target.value)} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Phone">
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="03xx-xxxxxxx" />
            </Field>
            <Field label="Opening cash in drawer (Rs)">
              <MoneyInput value={openingCash} onChange={setOpeningCash} />
            </Field>
          </div>
          <Field label="Address">
            <Input value={address} onChange={(e) => setAddress(e.target.value)} />
          </Field>
          <Button
            size="lg"
            disabled={!valid}
            onClick={() =>
              run(() => setupShop({ shopName: shopName.trim(), address, phone, openingCash }), 'Shop is ready')
            }
          >
            Start using Al Noor Mart
          </Button>
        </div>
        <p className="mt-6 text-center text-xs font-medium text-slate-400">Powered by <a href="https://mirwal.pk" target="_blank" rel="noreferrer" className="text-emerald-800 hover:text-amber-700">mirwal.pk</a></p>
      </div>
    </div>
  );
}
