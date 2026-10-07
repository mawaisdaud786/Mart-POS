import { useState } from 'react';
import { db, nowIso, uid, type Product } from '../lib/db';
import { compareListValues } from './ListControls';
import { Button, Card, Empty, Field, Input, MoneyInput, useAction } from './ui';
import { rs } from '../lib/format';
import { useLiveQuery } from '../lib/store';

type RateDraft = { name: string; unit: string; rate: number };

export function ServiceRatesCard() {
  const services = useLiveQuery(() => db.products.filter((product) => product.isService === true).toArray(), []) ?? [];
  const [name, setName] = useState('');
  const [unit, setUnit] = useState('page');
  const [rate, setRate] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, RateDraft>>({});
  const run = useAction();
  const sorted = [...services].sort((a, b) => compareListValues(a.name, b.name));

  const saveNew = () => run(async () => {
    const serviceName = name.trim();
    if (!serviceName) throw new Error('Enter a service name');
    if (!unit.trim()) throw new Error('Enter a billing unit, such as page or photo');
    if (!Number.isSafeInteger(rate) || rate <= 0) throw new Error('Enter a default rate above zero');
    const id = uid();
    const product: Product = {
      id,
      name: serviceName,
      sku: `SRV-${id}`,
      unit: unit.trim(),
      salePrice: rate,
      cost: 0,
      stock: 0,
      trackStock: false,
      isService: true,
      minStock: 0,
      favorite: false,
      active: true,
      createdAt: nowIso(),
    };
    await db.products.add(product);
    setName('');
    setRate(0);
  }, 'Service rate added');

  const draftFor = (service: Product): RateDraft => drafts[service.id] ?? { name: service.name, unit: service.unit, rate: service.salePrice };
  const updateDraft = (service: Product, patch: Partial<RateDraft>) => setDrafts((current) => ({
    ...current,
    [service.id]: { ...draftFor(service), ...patch },
  }));

  return (
    <Card title="Service rates" className="xl:col-span-2">
      <p className="px-4 pt-3 text-sm text-slate-500">Add billable services such as photocopy, printing, or photo printing. Rates appear in POS and can be changed on each bill. Services do not affect stock.</p>
      <div className="grid gap-3 border-b border-slate-100 p-4 sm:grid-cols-[1fr_150px_180px_auto] sm:items-end">
        <Field label="Service name">
          <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Black & white photocopy" />
        </Field>
        <Field label="Unit">
          <Input value={unit} onChange={(event) => setUnit(event.target.value)} placeholder="page" />
        </Field>
        <Field label="Default rate (Rs per unit)">
          <MoneyInput value={rate} onChange={setRate} />
        </Field>
        <Button disabled={!name.trim() || rate <= 0} onClick={() => void saveNew()}>Add service</Button>
      </div>
      {sorted.length === 0 ? (
        <Empty title="No service rates yet">Add your first service above; it will then be available as a line item in POS.</Empty>
      ) : (
        <div className="divide-y divide-slate-100">
          {sorted.map((service) => {
            const draft = draftFor(service);
            return (
              <div key={service.id} className="grid gap-3 p-4 sm:grid-cols-[1fr_140px_180px_auto_auto] sm:items-end">
                <Field label="Service">
                  <Input value={draft.name} onChange={(event) => updateDraft(service, { name: event.target.value })} />
                </Field>
                <Field label="Unit">
                  <Input value={draft.unit} onChange={(event) => updateDraft(service, { unit: event.target.value })} />
                </Field>
                <Field label="Default rate (Rs)">
                  <MoneyInput value={draft.rate} onChange={(value) => updateDraft(service, { rate: value })} />
                </Field>
                <Button
                  variant="secondary"
                  disabled={!draft.name.trim() || !draft.unit.trim() || !Number.isSafeInteger(draft.rate) || draft.rate <= 0}
                  onClick={() => void run(async () => {
                    await db.products.update(service.id, { name: draft.name.trim(), unit: draft.unit.trim(), salePrice: draft.rate });
                    setDrafts((current) => { const next = { ...current }; delete next[service.id]; return next; });
                  }, 'Service rate saved')}
                >
                  Save · {rs(draft.rate)}
                </Button>
                <Button
                  variant={service.active ? 'danger' : 'secondary'}
                  onClick={() => void run(() => db.products.update(service.id, { active: !service.active }), service.active ? 'Service hidden from POS' : 'Service available in POS')}
                >
                  {service.active ? 'Hide' : 'Activate'}
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
