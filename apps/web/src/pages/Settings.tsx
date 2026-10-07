import { useLiveQuery } from '../lib/store';
import { Banknote, Database, Keyboard, Link2, MessageCircle, Mic, Plus, Settings2, ShieldCheck, Store, WalletCards, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ListControls, compareListValues } from '../components/ListControls';
import { Badge, Button, Card, Field, Input, Modal, MoneyInput, Select, Textarea, cx, td, th, useAction } from '../components/ui';
import { db, uid, type Account, type Product, type ProductPairRule, type VoiceLog } from '../lib/db';
import { BackupCard } from '../components/BackupCard';
import { TeamCard } from '../components/TeamCard';
import { ServiceRatesCard } from '../components/ServiceRatesCard';
import { WhatsAppTemplatesCard } from '../components/WhatsAppTemplatesCard';
import { daysAgo, dayKey, rs } from '../lib/format';
import { productPairs } from '../lib/reports';
import { useSession } from '../lib/session';
import { DEFAULT_ACTION_SHORTCUTS, POS_ACTIONS, parseShortcutKeys, validatePosShortcutSettings, type PosActionId, type ProductShortcut } from '../lib/pos-shortcuts';
import { saveVoiceKeywords } from '../lib/ops';
import { DEFAULT_RETAILER_CASH_IN_FEE, DEFAULT_RETAILER_CASH_OUT_FEE } from '../lib/service-fees';

export function SettingsPage() {
  const [section, setSection] = useState<'shop' | 'payments' | 'team' | 'shortcuts' | 'keywords' | 'pairs' | 'whatsapp' | 'tools'>('shop');
  const sections = [
    { id: 'shop' as const, label: 'Shop & checkout', description: 'Shop identity, pricing, delivery and till rules', icon: Store },
    { id: 'payments' as const, label: 'Payments & services', description: 'Accounts, service rates and mobile money fees', icon: WalletCards },
    { id: 'team' as const, label: 'Team & access', description: 'Staff accounts, roles and voice corrections', icon: ShieldCheck },
    { id: 'shortcuts' as const, label: 'POS shortcuts', description: 'Change keyboard actions and product hotkeys', icon: Keyboard },
    { id: 'keywords' as const, label: 'Voice keywords', description: 'Teach Noor product names and nicknames', icon: Mic },
    { id: 'pairs' as const, label: 'Product pairs', description: 'Manage products often sold together', icon: Link2 },
    { id: 'whatsapp' as const, label: 'WhatsApp templates', description: 'Edit invoice and khata messages', icon: MessageCircle },
    { id: 'tools' as const, label: 'Data & tools', description: 'Backups and data recovery', icon: Database },
  ];
  return (
    <div className="mx-auto max-w-7xl">
      <section className="mb-5 overflow-hidden rounded-2xl bg-gradient-to-br from-slate-950 via-slate-900 to-teal-950 px-5 py-6 text-white shadow-lg sm:px-7">
        <div className="flex items-start gap-4">
          <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-teal-400/15 text-teal-300 ring-1 ring-inset ring-teal-300/20"><Settings2 size={23} /></div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-teal-300">Control centre</div>
            <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">Settings</h1>
            <p className="mt-1 max-w-2xl text-sm text-slate-300">Manage how your shop works, how it takes payments, and who can access it.</p>
          </div>
        </div>
      </section>

      <div className="mb-5 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {sections.map(({ id, label, description, icon: Icon }) => (
          <button
            key={id}
            type="button"
            aria-current={section === id ? 'page' : undefined}
            onClick={() => setSection(id)}
            className={cx(
              'group flex min-h-24 items-start gap-3 rounded-xl border p-4 text-left transition',
              section === id ? 'border-teal-700 bg-teal-50 shadow-sm ring-1 ring-teal-700' : 'border-slate-200 bg-white hover:border-teal-300 hover:bg-teal-50/50',
            )}
          >
            <span className={cx('grid h-9 w-9 shrink-0 place-items-center rounded-lg', section === id ? 'bg-teal-800 text-white' : 'bg-slate-100 text-slate-600 group-hover:bg-teal-100 group-hover:text-teal-800')}><Icon size={17} /></span>
            <span>
              <span className={cx('block text-sm font-semibold', section === id ? 'text-teal-950' : 'text-slate-800')}>{label}</span>
              <span className="mt-1 block text-xs leading-relaxed text-slate-500">{description}</span>
            </span>
          </button>
        ))}
      </div>

      <div className="space-y-4">
        {section === 'shop' && <ShopCard />}
        {section === 'payments' && (
          <div className="space-y-4">
            <AccountsCard />
            <ServiceRatesCard />
            <MobileMoneyFeeCard />
          </div>
        )}
        {section === 'team' && (
          <div className="space-y-4">
            <TeamCard />
            <VoiceLogCard />
          </div>
        )}
        {section === 'shortcuts' && <ShortcutsCard />}
        {section === 'keywords' && <VoiceKeywordsCard />}
        {section === 'pairs' && <ProductPairsCard />}
        {section === 'whatsapp' && <WhatsAppTemplatesCard />}
        {section === 'tools' && <BackupCard />}
      </div>
    </div>
  );
}

function ShortcutsCard() {
  const { user } = useSession();
  const run = useAction();
  const pref = useLiveQuery(() => (user ? db.prefs.get(`u:${user.id}`) : undefined), [user?.id]);
  const products = useLiveQuery(() => db.products.filter((product) => product.active).sortBy('name'), []);
  const [actionShortcuts, setActionShortcuts] = useState<Partial<Record<PosActionId, string[]>>>(DEFAULT_ACTION_SHORTCUTS);
  const [productShortcuts, setProductShortcuts] = useState<ProductShortcut[]>([]);
  const [productId, setProductId] = useState('');
  const [productKey, setProductKey] = useState('');

  useEffect(() => {
    setActionShortcuts(pref?.actionShortcuts ?? DEFAULT_ACTION_SHORTCUTS);
    setProductShortcuts(pref?.productShortcuts ?? []);
  }, [pref]);

  const save = () => run(async () => {
    if (!user) throw new Error('Sign in before saving shortcuts');
    const settings = { actionShortcuts, productShortcuts };
    const problem = validatePosShortcutSettings(settings);
    if (problem) throw new Error(problem);
    await db.prefs.put({
      ...pref,
      id: `u:${user.id}`,
      actionShortcuts,
      productShortcuts: productShortcuts.map((shortcut) => ({ ...shortcut, key: shortcut.key.toLocaleLowerCase() })),
    });
  }, 'Shortcuts saved');

  const addProductShortcut = () => {
    if (!productId || !/^[a-z]$/i.test(productKey.trim())) return;
    setProductShortcuts((current) => [...current, { key: productKey.trim().toLocaleLowerCase(), productId }]);
    setProductId('');
    setProductKey('');
  };

  return (
    <Card title="POS keyboard shortcuts">
      <div className="space-y-5 p-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-800">POS actions</h3>
          <p className="mt-1 text-xs text-slate-500">Set a shortcut for each POS action. Separate alternatives with commas; use modifiers like Alt+R or Shift+ArrowUp. Plain letters are ignored while typing.</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {POS_ACTIONS.map((action) => (
              <Field key={action.id} label={action.label}>
                <Input
                  value={(actionShortcuts[action.id] ?? [...action.defaults]).join(', ')}
                  onChange={(event) => setActionShortcuts((current) => ({
                    ...current,
                    [action.id]: parseShortcutKeys(event.target.value),
                  }))}
                  placeholder={action.defaults.join(', ')}
                  aria-label={`${action.label} shortcut keys`}
                />
              </Field>
            ))}
          </div>
        </div>

        <div className="border-t border-slate-200 pt-4">
          <h3 className="text-sm font-semibold text-slate-800">Quick-add product keys</h3>
          <p className="mt-1 text-xs text-slate-500">Use Shift + the assigned letter anywhere on the POS to add one unit. Plain letters always remain available for typing and search.</p>
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <Field label="Product">
              <Select value={productId} onChange={(event) => setProductId(event.target.value)}>
                <option value="">Choose a product</option>
                {(products ?? []).map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
              </Select>
            </Field>
            <Field label="Key (A–Z)">
              <Input className="w-24" value={productKey} maxLength={1} onChange={(event) => setProductKey(event.target.value.toLocaleLowerCase())} placeholder="c" />
            </Field>
            <Button size="sm" variant="secondary" disabled={!productId || !/^[a-z]$/i.test(productKey.trim())} onClick={addProductShortcut}>
              <Plus size={15} /> Add key
            </Button>
          </div>
          {productShortcuts.length > 0 ? (
            <div className="mt-3 divide-y divide-slate-100 rounded-md border border-slate-200">
              {productShortcuts.map((shortcut, index) => (
                <div key={`${shortcut.productId}-${index}`} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <span><kbd className="mr-2 rounded border border-slate-300 bg-slate-50 px-2 py-0.5 font-mono">{shortcut.key.toLocaleUpperCase()}</kbd>{products?.find((product) => product.id === shortcut.productId)?.name ?? 'Unknown product'}</span>
                  <button type="button" className="rounded p-1 text-slate-500 hover:bg-rose-50 hover:text-rose-700" aria-label={`Remove ${shortcut.key} product shortcut`} onClick={() => setProductShortcuts((current) => current.filter((_, row) => row !== index))}>
                    <X size={15} />
                  </button>
                </div>
              ))}
            </div>
          ) : <p className="mt-3 text-sm text-slate-500">No product quick-add keys configured.</p>}
        </div>
        <div className="flex justify-end border-t border-slate-200 pt-4">
          <Button onClick={save}>Save shortcuts</Button>
        </div>
      </div>
    </Card>
  );
}

function VoiceKeywordsCard() {
  const products = useLiveQuery(() => db.products.orderBy('name').toArray(), []) ?? [];
  const [search, setSearch] = useState('');
  const query = search.trim().toLocaleLowerCase();
  const visibleProducts = products.filter((product) =>
    !query || [product.name, product.nameUr, product.sku, ...(product.voiceKeywords ?? [])]
      .some((value) => value?.toLocaleLowerCase().includes(query)),
  );

  return (
    <Card title="Voice product keywords">
      <div className="p-4">
        <p className="mb-3 text-sm text-slate-600">
          Add the names or nicknames Noor should recognize for each product. Separate multiple keywords with commas.
          Product names and Urdu names are already searched automatically.
        </p>
        <Field label="Search products or saved keywords">
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search products…" />
        </Field>
        <div className="mt-4 divide-y divide-slate-100">
          {visibleProducts.map((product) => (
            <VoiceKeywordRow key={product.id} product={product} />
          ))}
          {visibleProducts.length === 0 && <p className="py-8 text-center text-sm text-slate-500">No matching products.</p>}
        </div>
      </div>
    </Card>
  );
}

function VoiceKeywordRow({ product }: { product: Product }) {
  const run = useAction();
  const [keywords, setKeywords] = useState((product.voiceKeywords ?? []).join(', '));
  useEffect(() => setKeywords((product.voiceKeywords ?? []).join(', ')), [product.id, product.voiceKeywords]);

  const save = () => run(async () => {
    const unique = new Map<string, string>();
    for (const keyword of keywords.split(/[;,|]/).map((part) => part.trim()).filter(Boolean)) {
      const normalized = keyword.toLocaleLowerCase();
      if (normalized !== product.name.trim().toLocaleLowerCase()) unique.set(normalized, keyword);
    }
    await saveVoiceKeywords(product.id, [...unique.values()]);
  }, 'Voice keywords saved');

  return (
    <div className="grid gap-2 py-3 sm:grid-cols-[minmax(12rem,0.8fr)_minmax(16rem,1.5fr)_auto] sm:items-center">
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-slate-800">{product.name}</div>
        <div className="truncate text-xs text-slate-500">
          {product.nameUr || product.sku}{!product.active && ' · Inactive'}
        </div>
      </div>
      <Input
        value={keywords}
        onChange={(event) => setKeywords(event.target.value)}
        aria-label={`Voice keywords for ${product.name}`}
        placeholder="e.g. chini, ceni"
      />
      <Button size="sm" variant="secondary" onClick={() => void save()}>Save keywords</Button>
    </div>
  );
}

function ShopCard() {
  const { settings } = useSession();
  const run = useAction();
  const categories = useLiveQuery(() => db.categories.orderBy('name').toArray(), []) ?? [];
  const [f, setF] = useState(settings);
  useEffect(() => setF(settings), [settings]);
  if (!f) return null;
  const save = () => run(async () => {
    const minimumMarginPct = f.minimumMarginPct ?? 5;
    const percentages: [string, number][] = [
      ['Cashier max discount (%)', f.cashierMaxDiscount],
      ['Default automatic discount (%)', f.autoDiscountPct],
      ['Max auto discount (%)', f.autoDiscountMaxPct],
      ['Maximum profit discount (%)', f.autoDiscountMaxProfitPct ?? 30],
      ['Minimum product margin (%)', minimumMarginPct],
      ...(f.autoDiscountCategoryRules ?? []).map((rule): [string, number] => [`Category rule "${categories.find((category) => category.id === rule.categoryId)?.name ?? rule.categoryId}"`, rule.percent]),
    ];
    const bad = percentages.find(([, value]) => !Number.isFinite(value) || value < 0 || value > 100);
    if (bad) throw new Error(`${bad[0]} is ${bad[1]}: discount percentages must be between 0 and 100`);
    if (f.autoDiscountMinOrder < 0 || (f.deliveryCharge ?? 0) < 0 || (f.freeDeliveryThreshold ?? 0) < 0) throw new Error('Thresholds and delivery charges cannot be negative');
    const stockRanges: [string, number, number, number][] = [
      ['Sales velocity period', f.stockSalesVelocityDays ?? 30, 7, 180],
      ['Safety stock days', f.stockSafetyDays ?? 2, 0, 90],
      ['Low-stock alert days', f.stockLowDaysThreshold ?? 3, 1, 90],
      ['Slow-moving threshold', f.stockSlowMovingDays ?? 30, 7, 365],
      ['Overstock threshold', f.stockOverstockDays ?? 60, 7, 365],
      ['Reorder cover days', f.stockReorderCoverDays ?? 7, 1, 60],
    ];
    const invalidStockSetting = stockRanges.find(([, value, min, max]) => !Number.isInteger(value) || value < min || value > max);
    if (invalidStockSetting) throw new Error(`${invalidStockSetting[0]} must be between ${invalidStockSetting[2]} and ${invalidStockSetting[3]} days`);
    const deliveryCharge = f.deliveryCharge ?? f.gharDeliveryFee ?? 15000;
    const freeDeliveryThreshold = f.freeDeliveryThreshold ?? f.gharFreeDeliveryThreshold ?? 400000;
    await db.settings.put({ ...f, minimumMarginPct, autoDiscountCategoryId: 'all', gharDeliveryFee: deliveryCharge, gharFreeDeliveryThreshold: freeDeliveryThreshold });
  }, 'Settings saved');

  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Shop identity" className="xl:col-span-2">
          <div className="grid gap-4 p-4 sm:grid-cols-2">
            <Field label="Shop name"><Input value={f.shopName} onChange={(event) => setF({ ...f, shopName: event.target.value })} /></Field>
            <Field label="Phone"><Input value={f.phone} onChange={(event) => setF({ ...f, phone: event.target.value })} /></Field>
            <Field label="Address" className="sm:col-span-2"><Input value={f.address} onChange={(event) => setF({ ...f, address: event.target.value })} /></Field>
            <Field label="Receipt footer" className="sm:col-span-2"><Textarea rows={2} value={f.receiptFooter} onChange={(event) => setF({ ...f, receiptFooter: event.target.value })} /></Field>
          </div>
        </Card>

        <Card title="Automatic discounts">
          <div className="space-y-4 p-4">
            <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
              <input type="checkbox" checked={f.autoDiscountEnabled ?? true} onChange={(event) => setF({ ...f, autoDiscountEnabled: event.target.checked })} />
              Enable automatic threshold discount
            </label>
            <Field label="Auto discount threshold (Rs)" hint="Eligible subtotal before discount">
              <MoneyInput value={f.autoDiscountMinOrder ?? 5000} onChange={(value) => setF({ ...f, autoDiscountMinOrder: value })} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Default discount (%)"><Input inputMode="decimal" min="0" max="100" value={f.autoDiscountPct ?? 10} onChange={(event) => setF({ ...f, autoDiscountPct: Number(event.target.value) || 0 })} /></Field>
              <Field label="Maximum discount (%)"><Input inputMode="decimal" min="0" max="100" value={f.autoDiscountMaxPct ?? 70} onChange={(event) => setF({ ...f, autoDiscountMaxPct: Number(event.target.value) || 0 })} /></Field>
              <Field label="Maximum share of profit (%)" hint="Automatic threshold discounts cannot use more than this share of each product's gross profit. Default: 30%.">
                <Input inputMode="decimal" min="0" max="100" value={f.autoDiscountMaxProfitPct ?? 30} onChange={(event) => setF({ ...f, autoDiscountMaxProfitPct: Number(event.target.value) || 0 })} />
              </Field>
            </div>
            <p className="text-xs text-slate-500">Discounts apply only when the eligible subtotal reaches the threshold, and never exceed either maximum above. Product-specific threshold prices are also subject to these caps.</p>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Category rules</p>
            <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
              {categories.map((category) => {
                const savedRule = (f.autoDiscountCategoryRules ?? []).find((rule) => rule.categoryId === category.id);
                const isLegacyTarget = f.autoDiscountCategoryId === category.id;
                const enabled = savedRule?.enabled ?? isLegacyTarget;
                const percent = savedRule?.percent ?? (isLegacyTarget ? f.autoDiscountPct : 0);
                const updateRule = (patch: Partial<{ enabled: boolean; percent: number }>) => {
                  const current = f.autoDiscountCategoryRules ?? [];
                  const rule = { categoryId: category.id, enabled, percent, ...patch };
                  setF({ ...f, autoDiscountCategoryRules: [...current.filter((entry) => entry.categoryId !== category.id), rule] });
                };
                return <div key={category.id} className="grid grid-cols-[1fr_110px] items-center gap-3 px-3 py-2">
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={enabled} onChange={(event) => updateRule({ enabled: event.target.checked })} />{category.name}</label>
                  <Input aria-label={`${category.name} discount percentage`} inputMode="decimal" min="0" max="100" value={percent} onChange={(event) => updateRule({ percent: Number(event.target.value) || 0 })} />
                </div>;
              })}
              {categories.length === 0 && <div className="px-3 py-3 text-sm text-slate-500">Add categories to configure category-specific discounts.</div>}
            </div>
          </div>
        </Card>

        <Card title="Profit & margin alerts">
          <div className="space-y-3 p-4">
            <Field label="Minimum acceptable product margin (%)" hint="Products below this margin are flagged for review; prices are never changed automatically. Default: 5%.">
              <Input
                inputMode="decimal"
                min="0"
                max="100"
                value={f.minimumMarginPct ?? 5}
                onChange={(event) => setF({ ...f, minimumMarginPct: Number(event.target.value) || 0 })}
              />
            </Field>
          </div>
        </Card>

        <Card title="Stock intelligence">
          <div className="grid gap-3 p-4 sm:grid-cols-2">
            {([
              ['Sales velocity period (days)', 'stockSalesVelocityDays', 30, 7, 180, 'How many recent days are used to estimate average daily sales.'],
              ['Safety stock (days)', 'stockSafetyDays', 2, 0, 90, 'Extra stock held beyond expected supplier lead time.'],
              ['Low-stock alert threshold (days)', 'stockLowDaysThreshold', 3, 1, 90, 'Flag products when estimated stock coverage falls below this.'],
              ['Slow-moving threshold (days)', 'stockSlowMovingDays', 30, 7, 365, 'Flag stocked products with no sale in this many days.'],
              ['Overstock threshold (days)', 'stockOverstockDays', 60, 7, 365, 'Flag stock exceeding this many days of estimated demand.'],
              ['Reorder cover (days)', 'stockReorderCoverDays', 7, 1, 60, 'Recommended top-up coverage after a supplier delivery.'],
            ] as const).map(([label, key, defaultValue, min, max, hint]) => (
              <Field key={key} label={label} hint={hint}>
                <Input
                  type="number"
                  min={min}
                  max={max}
                  value={f[key] ?? defaultValue}
                  onChange={(event) => setF({ ...f, [key]: Number(event.target.value) })}
                />
              </Field>
            ))}
            <p className="text-xs text-slate-500 sm:col-span-2">These settings only shape alerts and suggested reorder quantities. They never create a purchase order or change stock.</p>
          </div>
        </Card>

        <Card title="Customer & supplier rules">
          <div className="grid gap-4 p-4">
            <Field label="Cashier maximum manual discount (%)"><Input inputMode="decimal" value={f.cashierMaxDiscount} onChange={(event) => setF({ ...f, cashierMaxDiscount: Number(event.target.value) || 0 })} /></Field>
            <Field label="Default supplier delivery days" hint="Used for reorder suggestions"><Input inputMode="numeric" value={f.leadDays} onChange={(event) => setF({ ...f, leadDays: Number(event.target.value) || 0 })} /></Field>
            <label className="flex items-start gap-3 rounded-lg border border-slate-200 p-3 text-sm">
              <input className="mt-0.5" type="checkbox" checked={f.businessPricingEnabled ?? true} onChange={(event) => setF({ ...f, businessPricingEnabled: event.target.checked })} />
              <span><b className="block text-slate-800">Shopkeeper pricing</b><span className="text-xs text-slate-500">Use each product&apos;s saved business rate for special customers.</span></span>
            </label>
          </div>
        </Card>

        <Card title="Home delivery">
          <div className="grid gap-4 p-4">
            <label className="flex items-start gap-3 rounded-lg border border-slate-200 p-3 text-sm">
              <input className="mt-0.5" type="checkbox" checked={f.homeDeliveryEnabled ?? true} onChange={(event) => setF({ ...f, homeDeliveryEnabled: event.target.checked })} />
              <span><b className="block text-slate-800">Enable home delivery</b><span className="text-xs text-slate-500">Show delivery options when making a bill.</span></span>
            </label>
            <Field label="Delivery charge (Rs)"><MoneyInput value={f.deliveryCharge ?? f.gharDeliveryFee ?? 15000} onChange={(value) => setF({ ...f, deliveryCharge: value })} /></Field>
            <Field label="Free delivery threshold (Rs)"><MoneyInput value={f.freeDeliveryThreshold ?? f.gharFreeDeliveryThreshold ?? 400000} onChange={(value) => setF({ ...f, freeDeliveryThreshold: value })} /></Field>
            <Field label="Minimum product margin (%)" hint="Ghar prices stay above this margin over cost"><Input inputMode="decimal" min="0" max="99" value={f.gharMinimumMarginPct ?? 10} onChange={(event) => setF({ ...f, gharMinimumMarginPct: Number(event.target.value) || 0 })} /></Field>
            <Field label="Ghar delivery fee (Rs)"><MoneyInput value={f.gharDeliveryFee ?? 15000} onChange={(value) => setF({ ...f, gharDeliveryFee: value })} /></Field>
            <Field label="Ghar discount/free-delivery threshold (Rs)"><MoneyInput value={f.gharFreeDeliveryThreshold ?? 400000} onChange={(value) => setF({ ...f, gharFreeDeliveryThreshold: value })} /></Field>
          </div>
        </Card>

        <Card title="Cash controls">
          <div className="grid gap-4 p-4">
            <Field label="Cash difference needing explanation (Rs)"><MoneyInput value={f.discrepancyLimit} onChange={(value) => setF({ ...f, discrepancyLimit: value })} /></Field>
            <p className="text-xs text-slate-500">Require a note when a closing count differs from the books by more than this amount.</p>
          </div>
        </Card>
      </div>
      <div className="sticky bottom-3 z-10 flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white/95 p-3 shadow-lg backdrop-blur">
        <span className="hidden text-sm text-slate-500 sm:inline">Save shop and checkout changes</span>
        <Button className="ml-auto min-w-32" onClick={() => void save()}><Banknote size={16} /> Save settings</Button>
      </div>
    </div>
  );
}

function AccountsCard() {
  const accounts = useLiveQuery(() => db.accounts.toArray(), []) ?? [];
  const run = useAction();
  const [name, setName] = useState('');
  const [type, setType] = useState<Account['type']>('bank');
  return (
    <Card title="Payment accounts">
      <ul className="divide-y divide-slate-100">
        {accounts.map((a) => (
          <li key={a.id} className="flex items-center justify-between gap-2 px-4 py-2 text-sm">
            <input
              className="flex-1 rounded px-1 py-0.5 hover:bg-slate-50"
              defaultValue={a.name}
              onBlur={(e) => e.target.value.trim() && db.accounts.update(a.id, { name: e.target.value.trim() })}
            />
            <span className="text-xs capitalize text-slate-500">
              {a.type}
              {a.provider && ' · retailer'}
            </span>
            {a.type !== 'cash' && (
              <label className="flex items-center gap-1 text-xs">
                <input type="checkbox" checked={a.active} onChange={(e) => db.accounts.update(a.id, { active: e.target.checked })} /> Active
              </label>
            )}
          </li>
        ))}
      </ul>
      <div className="flex gap-2 border-t border-slate-100 p-3">
        <Input placeholder="New account, e.g. Meezan Bank" value={name} onChange={(e) => setName(e.target.value)} />
        <Select className="w-32" value={type} onChange={(e) => setType(e.target.value as Account['type'])}>
          <option value="bank">Bank</option>
          <option value="wallet">Wallet</option>
          <option value="cash">Cash</option>
        </Select>
        <Button
          disabled={!name.trim()}
          onClick={() =>
            run(async () => {
              await db.accounts.add({ id: uid(), name: name.trim(), type, active: true });
              setName('');
            }, 'Account added')
          }
        >
          Add
        </Button>
      </div>
    </Card>
  );
}

function MobileMoneyFeeCard() {
  const { settings } = useSession();
  const [cashIn, setCashIn] = useState(settings?.retailerCashInFee ?? DEFAULT_RETAILER_CASH_IN_FEE);
  const [cashInStep, setCashInStep] = useState(settings?.retailerCashInStep ?? 100_000);
  const [cashOut, setCashOut] = useState(settings?.retailerCashOutFee ?? DEFAULT_RETAILER_CASH_OUT_FEE);
  const [cashOutStep, setCashOutStep] = useState(settings?.retailerCashOutStep ?? 50_000);
  const run = useAction();
  useEffect(() => {
    setCashIn(settings?.retailerCashInFee ?? DEFAULT_RETAILER_CASH_IN_FEE);
    setCashInStep(settings?.retailerCashInStep ?? 100_000);
    setCashOut(settings?.retailerCashOutFee ?? DEFAULT_RETAILER_CASH_OUT_FEE);
    setCashOutStep(settings?.retailerCashOutStep ?? 50_000);
  }, [settings?.retailerCashInFee, settings?.retailerCashInStep, settings?.retailerCashOutFee, settings?.retailerCashOutStep]);

  return (
    <Card title="Easypaisa & JazzCash defaults">
      <div className="grid gap-4 p-4 sm:grid-cols-2 xl:grid-cols-[1fr_1fr_1fr_1fr_auto] xl:items-end">
        <Field label="Cash-in fee (Rs)" hint="Per fee step">
          <MoneyInput value={cashIn} onChange={setCashIn} />
        </Field>
        <Field label="Cash-in step (Rs)" hint="Each started step sent to the customer's account">
          <MoneyInput value={cashInStep} onChange={setCashInStep} />
        </Field>
        <Field label="Cash-out fee (Rs)" hint="Per fee step">
          <MoneyInput value={cashOut} onChange={setCashOut} />
        </Field>
        <Field label="Cash-out step (Rs)" hint="Each started step paid out to the customer">
          <MoneyInput value={cashOutStep} onChange={setCashOutStep} />
        </Field>
        <Button onClick={() => void run(async () => {
          if (cashIn < 0 || cashOut < 0) throw new Error('Fees cannot be negative');
          if (cashInStep <= 0 || cashOutStep <= 0) throw new Error('Fee steps must be greater than zero');
          if (!settings) throw new Error('Shop settings are not loaded');
          await db.settings.put({
            ...settings,
            retailerCashInFee: cashIn,
            retailerCashInStep: cashInStep,
            retailerCashOutFee: cashOut,
            retailerCashOutStep: cashOutStep,
          });
        }, 'Mobile money defaults saved')}>Save fees</Button>
      </div>
    </Card>
  );
}

/** Last voice commands, for checking what the assistant heard and understood. */
function ProductPairsCard() {
  const { settings, has } = useSession();
  const run = useAction();
  const products = useLiveQuery(() => db.products.filter((product) => product.active).sortBy('name'), []) ?? [];
  const [rules, setRules] = useState<ProductPairRule[]>(settings?.productPairRules ?? []);
  const [triggerProductId, setTriggerProductId] = useState('');
  const [triggerQuantities, setTriggerQuantities] = useState('1');
  const [companionProductId, setCompanionProductId] = useState('');
  const [companionQty, setCompanionQty] = useState('1');
  const canSeePairHistory = has('reports.sales') || has('sales.view_all') || has('dashboard.owner');
  const pairFrom = daysAgo(89);
  const pairTo = dayKey();
  const discovered = useLiveQuery(
    () => canSeePairHistory ? productPairs(pairFrom, pairTo) : Promise.resolve([]),
    [canSeePairHistory, pairFrom, pairTo],
  ) ?? [];

  useEffect(() => setRules(settings?.productPairRules ?? []), [settings?.productPairRules]);

  const configurePair = (triggerId: string, triggerQty: number, companionId: string, quantity: number) => {
    setTriggerProductId(triggerId);
    setTriggerQuantities(String(triggerQty));
    setCompanionProductId(companionId);
    setCompanionQty(String(quantity));
  };

  const addRule = () => {
    const quantities = [...new Set(triggerQuantities.split(/[;,|]/).map((value) => Number(value.trim())).filter((value) => Number.isFinite(value) && value > 0))];
    const quantity = Number(companionQty);
    if (!triggerProductId || !companionProductId || triggerProductId === companionProductId || !quantities.length || !Number.isFinite(quantity) || quantity <= 0) return;
    setRules((current) => [...current, { id: uid(), triggerProductId, triggerQuantities: quantities, companionProductId, companionQty: quantity, enabled: true }]);
    setTriggerProductId('');
    setTriggerQuantities('1');
    setCompanionProductId('');
    setCompanionQty('1');
  };

  const save = () => run(async () => {
    if (!settings) throw new Error('Shop settings are not loaded');
    const keys = new Set<string>();
    for (const rule of rules) {
      if (rule.triggerProductId === rule.companionProductId) throw new Error('A product cannot be paired with itself');
      if (!rule.triggerQuantities.length || rule.triggerQuantities.some((quantity) => !Number.isFinite(quantity) || quantity <= 0)) throw new Error('Pair trigger quantities must be greater than zero');
      if (!Number.isFinite(rule.companionQty) || rule.companionQty <= 0) throw new Error('Companion quantity must be greater than zero');
      for (const quantity of rule.triggerQuantities) {
        const key = `${rule.triggerProductId}:${quantity}:${rule.companionProductId}`;
        if (keys.has(key)) throw new Error('This product pair and quantity is already configured');
        keys.add(key);
      }
    }
    await db.settings.put({ ...settings, productPairRules: rules });
  }, 'Product pair rules saved');

  return (
    <div className="space-y-4">
      <Card title="Frequently sold together">
        <div className="p-4">
          <p className="mb-3 text-sm text-slate-600">Observed combinations from completed invoices during the last 90 days. Use these as a starting point for POS suggestions; the cashier always chooses whether to add the companion.</p>
          {!canSeePairHistory ? (
            <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">Sales-report permission is required to view invoice-based product pair suggestions.</p>
          ) : discovered.length === 0 ? (
            <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">No product and quantity combinations have appeared together on at least two invoices in this period.</p>
          ) : (
            <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
              {discovered.slice(0, 20).map((pair, index) => (
                <div key={`${pair.productAId}:${pair.productAQty}:${pair.productBId}:${pair.productBQty}:${index}`} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <span className="text-sm"><b>{pair.productAName} × {pair.productAQty}</b> + <b>{pair.productBName} × {pair.productBQty}</b><span className="ml-2 text-xs text-slate-500">on {pair.bills} invoices</span></span>
                  <div className="flex gap-2">
                    <Button size="sm" variant="secondary" onClick={() => configurePair(pair.productAId, pair.productAQty, pair.productBId, pair.productBQty)}>Configure A → B</Button>
                    <Button size="sm" variant="secondary" onClick={() => configurePair(pair.productBId, pair.productBQty, pair.productAId, pair.productAQty)}>Configure B → A</Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>

      <Card title="POS companion suggestions">
        <div className="space-y-4 p-4">
          <p className="text-sm text-slate-600">Set trigger quantities such as 1, 3. When a matching quantity is in the bill, the POS offers the companion; nothing is added automatically.</p>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[1fr_1fr_1fr_1fr_auto] xl:items-end">
            <Field label="Trigger product">
              <Select value={triggerProductId} onChange={(event) => setTriggerProductId(event.target.value)}>
                <option value="">Choose product</option>
                {products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
              </Select>
            </Field>
            <Field label="At quantity" hint="Comma-separated, e.g. 1, 3">
              <Input inputMode="decimal" value={triggerQuantities} onChange={(event) => setTriggerQuantities(event.target.value)} placeholder="1, 3" />
            </Field>
            <Field label="Companion product">
              <Select value={companionProductId} onChange={(event) => setCompanionProductId(event.target.value)}>
                <option value="">Choose product</option>
                {products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
              </Select>
            </Field>
            <Field label="Companion quantity">
              <Input type="number" min="0.001" step="0.001" value={companionQty} onChange={(event) => setCompanionQty(event.target.value)} />
            </Field>
            <Button size="sm" variant="secondary" disabled={!triggerProductId || !companionProductId || triggerProductId === companionProductId} onClick={addRule}><Plus size={15} /> Add rule</Button>
          </div>
          {rules.length === 0 ? (
            <p className="text-sm text-slate-500">No companion rules configured.</p>
          ) : (
            <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
              {rules.map((rule, index) => (
                <div key={rule.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2 text-sm">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={rule.enabled} onChange={(event) => setRules((current) => current.map((item, row) => row === index ? { ...item, enabled: event.target.checked } : item))} />
                    <span>{products.find((product) => product.id === rule.triggerProductId)?.name ?? 'Unknown product'} × {rule.triggerQuantities.join(' or ')} → {products.find((product) => product.id === rule.companionProductId)?.name ?? 'Unknown product'} × {rule.companionQty}</span>
                  </label>
                  <button type="button" className="rounded p-1 text-slate-500 hover:bg-rose-50 hover:text-rose-700" aria-label="Remove product-pair rule" onClick={() => setRules((current) => current.filter((_, row) => row !== index))}><X size={15} /></button>
                </div>
              ))}
            </div>
          )}
          <div className="flex justify-end border-t border-slate-200 pt-3"><Button onClick={() => void save()}>Save pair rules</Button></div>
        </div>
      </Card>
    </div>
  );
}

function VoiceLogCard() {
  const logs = useLiveQuery(() => db.voiceLogs.orderBy('date').reverse().limit(25).toArray(), []) ?? [];
  const products = useLiveQuery(() => db.products.orderBy('name').toArray(), []) ?? [];
  const [correcting, setCorrecting] = useState<VoiceLog | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortBy, setSortBy] = useState<'date' | 'status'>('date');
  const run = useAction();
  const query = search.trim().toLocaleLowerCase();
  const visibleLogs = [...logs]
    .filter((log) => statusFilter === 'all' || log.status === statusFilter)
    .filter((log) => !query || log.spokenText.toLocaleLowerCase().includes(query) || JSON.stringify(log.parsed).toLocaleLowerCase().includes(query))
    .sort((a, b) => sortBy === 'status' ? compareListValues(a.status, b.status) : b.date.localeCompare(a.date));

  const saveCorrection = (corrections: { productId: string; phrase: string }[]) => {
    if (!correcting) return;
    return run(async () => {
      if (corrections.length === 0 || corrections.some((correction) => !correction.phrase.trim() || !correction.productId)) {
        throw new Error('Choose a product and enter its matching phrase for each correction');
      }
      const duplicateProduct = corrections.some((correction, index) => corrections.findIndex((other) => other.productId === correction.productId) !== index);
      if (duplicateProduct) throw new Error('Choose each product only once');
      const duplicatePhrase = corrections.some((correction, index) => corrections.findIndex((other) => other.phrase.trim().toLocaleLowerCase() === correction.phrase.trim().toLocaleLowerCase()) !== index);
      if (duplicatePhrase) throw new Error('Each product needs a unique matching phrase');
      const [log, ...products] = await Promise.all([
        db.voiceLogs.get(correcting.id),
        ...corrections.map((correction) => db.products.get(correction.productId)),
      ]);
      if (!log || products.some((product) => !product)) throw new Error('Product or voice log no longer exists');
      for (const [index, product] of products.entries()) {
        const keyword = corrections[index]!.phrase.trim();
        const keywords = product!.voiceKeywords ?? [];
        if (!keywords.some((saved) => saved.trim().toLocaleLowerCase() === keyword.toLocaleLowerCase())) {
          await saveVoiceKeywords(product!.id, [...keywords, keyword]);
        }
      }
      const first = corrections[0]!;
      await db.voiceLogs.update(log.id, {
        correctedProductId: first.productId,
        correctionPhrase: first.phrase.trim(),
        corrections: corrections.map((correction) => ({ productId: correction.productId, phrase: correction.phrase.trim() })),
        correctedAt: new Date().toISOString(),
        productIds: [...new Set([...log.productIds, ...corrections.map((correction) => correction.productId)])],
      });
      setCorrecting(null);
    }, 'Voice vocabulary improved');
  };

  return (
    <Card title="Voice command log" className="xl:col-span-2">
      {logs.length === 0 ? (
        <p className="p-4 text-sm text-slate-500">No voice commands yet. Audio is never saved — only the recognised text.</p>
      ) : (
        <>
        <ListControls
          search={search}
          onSearch={setSearch}
          placeholder="Search heard phrase or interpretation…"
          filters={[{ label: 'Command result', value: statusFilter, options: [{ value: 'all', label: 'All results' }, { value: 'success', label: 'Successful' }, { value: 'partial', label: 'Partial' }, { value: 'failed', label: 'Failed' }], onChange: setStatusFilter }]}
          sortValue={sortBy}
          sortOptions={[{ value: 'date', label: 'Time · newest' }, { value: 'status', label: 'Result · A–Z' }]}
          onSort={(value) => setSortBy(value as typeof sortBy)}
        />
        {visibleLogs.length === 0 ? <p className="p-4 text-sm text-slate-500">No matching voice commands.</p> : (
        <div className="max-h-96 overflow-y-auto">
          <table className="w-full">
            <thead className="bg-slate-50">
              <tr>
                <th className={th}>Time</th>
                <th className={th}>Heard</th>
                <th className={th}>Understood as</th>
                <th className={th}>Result</th>
                <th className={th} />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visibleLogs.map((l) => {
                const corrections = l.corrections ?? (l.correctedProductId && l.correctionPhrase
                  ? [{ productId: l.correctedProductId, phrase: l.correctionPhrase }]
                  : []);
                return (
                  <tr key={l.id}>
                    <td className={cx(td, 'whitespace-nowrap text-slate-600')}>{new Date(l.date).toLocaleString('en-PK', { dateStyle: 'short', timeStyle: 'short' })}</td>
                    <td className={td}>{l.spokenText}</td>
                    <td className={cx(td, 'font-mono text-xs text-slate-600')}>{JSON.stringify(l.parsed)}</td>
                    <td className={td}>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge tone={l.status === 'success' ? 'green' : l.status === 'partial' ? 'amber' : 'red'}>{l.status}</Badge>
                        {corrections.length > 0 && <Badge tone="blue">{corrections.length} correction{corrections.length === 1 ? '' : 's'} saved</Badge>}
                      </div>
                      {corrections.map((correction) => (
                        <p key={`${correction.productId}:${correction.phrase}`} className="mt-1 text-xs text-slate-600">
                          Meant: <b>{products.find((product) => product.id === correction.productId)?.name ?? 'Product'}</b> · learned “{correction.phrase}”
                        </p>
                      ))}
                    </td>
                    <td className={cx(td, 'text-right')}>
                      <Button size="sm" variant="secondary" onClick={() => setCorrecting(l)}>
                        <Plus size={14} /> {corrections.length ? 'Edit corrections' : 'What did you mean?'}
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        )}
        </>
      )}
      {correcting && (
        <VoiceCorrectionModal
          key={correcting.id}
          log={correcting}
          products={products}
          onClose={() => setCorrecting(null)}
          onSave={saveCorrection}
        />
      )}
    </Card>
  );
}

function VoiceCorrectionModal({
  log,
  products,
  onClose,
  onSave,
}: {
  log: VoiceLog;
  products: Product[];
  onClose: () => void;
  onSave: (corrections: { productId: string; phrase: string }[]) => void;
}) {
  const parsed = log.parsed as { items?: { spoken_name?: string }[] } | null;
  const existing = log.corrections ?? (log.correctedProductId && log.correctionPhrase
    ? [{ productId: log.correctedProductId, phrase: log.correctionPhrase }]
    : []);
  const defaultCorrections = parsed?.items?.flatMap((item) => item.spoken_name ? [{ productId: '', phrase: item.spoken_name }] : []) ?? [];
  const [corrections, setCorrections] = useState(existing.length ? existing : defaultCorrections.length ? defaultCorrections : [{ productId: '', phrase: '' }]);

  return (
    <Modal
      title="Improve voice vocabulary"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button disabled={corrections.length === 0 || corrections.some((correction) => !correction.productId || !correction.phrase.trim())} onClick={() => onSave(corrections)}>
            Save {corrections.length} correction{corrections.length === 1 ? '' : 's'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="rounded-md bg-slate-50 p-3 text-sm">
          <div className="mb-1 text-xs font-semibold uppercase text-slate-500">Voice log heard</div>
          <div>{log.spokenText}</div>
        </div>
        <p className="text-xs text-slate-500">Add one row for each product the command should have matched. Use a short, unique product name or nickname in each phrase.</p>
        <div className="max-h-80 space-y-3 overflow-y-auto">
          {corrections.map((correction, index) => (
            <div key={index} className="grid gap-2 rounded-lg border border-slate-200 p-3 sm:grid-cols-[1fr_1fr_auto]">
              <Field label={`Product ${index + 1}`}>
                <Select value={correction.productId} onChange={(event) => setCorrections((current) => current.map((entry, row) => row === index ? { ...entry, productId: event.target.value } : entry))}>
                  <option value="">Choose product</option>
                  {products.map((product) => <option key={product.id} value={product.id}>{product.name} · {product.sku}</option>)}
                </Select>
              </Field>
              <Field label="Phrase that should match">
                <Input value={correction.phrase} onChange={(event) => setCorrections((current) => current.map((entry, row) => row === index ? { ...entry, phrase: event.target.value } : entry))} autoFocus={index === 0} placeholder="Product name or nickname" />
              </Field>
              <Button size="sm" variant="ghost" aria-label={`Remove correction ${index + 1}`} onClick={() => setCorrections((current) => current.filter((_, row) => row !== index))}><X size={15} /></Button>
            </div>
          ))}
        </div>
        <Button size="sm" variant="secondary" onClick={() => setCorrections((current) => [...current, { productId: '', phrase: '' }])}><Plus size={15} /> Add another product</Button>
      </div>
    </Modal>
  );
}
