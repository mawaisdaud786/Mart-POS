import { Store } from 'lucide-react';
import { useState } from 'react';
import { Button, Field, Input, MoneyInput, useAction } from '../components/ui';
import { setupShop } from '../lib/db';
import { loadDemoData } from '../lib/demo';

/** First run: create the shop, the owner login and opening cash. */
export function Setup() {
  const [shopName, setShopName] = useState('Al Noor Mart');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [pin, setPin] = useState('');
  const [openingCash, setOpeningCash] = useState(0);
  const [demo, setDemo] = useState(true);
  const run = useAction();

  const valid = shopName.trim() && ownerName.trim() && /^\d{4,6}$/.test(pin);

  return (
    <div className="flex min-h-full items-center justify-center p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-lg">
        <div className="mb-5 flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-xl bg-brand-600 text-white">
            <Store />
          </div>
          <div>
            <h1 className="text-xl font-bold">Welcome to RetailOS</h1>
            <p className="text-sm text-slate-500">Set up your shop. Takes one minute.</p>
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
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Owner name">
              <Input value={ownerName} onChange={(e) => setOwnerName(e.target.value)} />
            </Field>
            <Field label="Owner PIN (4–6 digits)" hint="Used to log in on this computer">
              <Input value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))} type="password" inputMode="numeric" />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={demo} onChange={(e) => setDemo(e.target.checked)} />
            Add sample products, customers and suppliers to try the software (you can delete them later)
          </label>
          <Button
            size="lg"
            disabled={!valid}
            onClick={() =>
              run(async () => {
                await setupShop({ shopName: shopName.trim(), address, phone, ownerName: ownerName.trim(), pin, openingCash });
                if (demo) await loadDemoData();
              }, 'Shop is ready')
            }
          >
            Start using RetailOS
          </Button>
        </div>
      </div>
    </div>
  );
}
