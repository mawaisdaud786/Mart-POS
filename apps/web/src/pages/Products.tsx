import { useLiveQuery } from '../lib/store';
import { BulkMasterModal } from '../components/BulkMasterModal';
import { compareListValues, ListControls } from '../components/ListControls';
import { Archive, Boxes, Download, Mic, Package, Pencil, Plus, SkipBack, SkipForward, SlidersHorizontal, Star, Tags, Trash2, Upload, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Badge, Button, Card, Empty, Field, Input, Modal, MoneyInput, PageHeader, Select, cx, td, th, useAction, useToast } from '../components/ui';
import { db, nowIso, uid, UNITS, type Product, type StockMove } from '../lib/db';
import { qty, rs } from '../lib/format';
import { costPerPurchaseUnit, costPerSaleUnit } from '../lib/purchase-cost';
import { adjustStock, bulkUpdateProducts as bulkUpdateProductsOp, importProducts as importProductsOp, manageProducts as manageProductsOp, type ImportRecord } from '../lib/ops';
import { useSession } from '../lib/session';
import { useSpeech, type SpeechLang } from '../lib/voice/speech';
import { speakVoice, spokenNumber } from '../lib/voice/interaction';
import { useVoiceLang } from '../lib/prefs';
import { csvCell } from '../lib/safe';

const PRODUCT_IMPORT_HEADERS = ['Sr', 'Product Name', 'Stock', 'Purchase Unit Price', 'Qty/ Unit', 'Purchase Unit', 'Sale Unit', 'Unit Sale Price', 'Sale Margin', 'Supplier', 'Product Category'];
const IMPORT_HEADER_ALIASES: Record<string, string[]> = {
  sku: ['sku', 'sr'],
  name: ['name', 'product name'],
  category: ['category', 'product category'],
  unit: ['unit', 'sale unit'],
  'pack name': ['pack name', 'purchase unit'],
  'pack size': ['pack size', 'qty unit', 'qty per unit'],
  'sale price (rs)': ['sale price (rs)', 'sale price', 'unit sale price'],
  'threshold price (rs)': ['threshold price (rs)', 'threshold price', 'special price'],
  'wholesale price (rs)': ['wholesale price (rs)', 'wholesale price', 'shopkeeper price'],
  'cost (rs)': ['cost (rs)', 'cost', 'purchase price', 'purchase price (rs)', 'purchase price piece', 'purchase price per piece'],
  'purchase unit price': ['purchase unit price'],
  'opening stock': ['opening stock', 'stock'],
  'minimum stock': ['minimum stock', 'min stock'],
  favorite: ['favorite', 'favourite'],
};

function normalizeHeader(header: string): string {
  const normalized = header.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  for (const [canonical, aliases] of Object.entries(IMPORT_HEADER_ALIASES)) {
    if (aliases.some((alias) => alias.replace(/[^a-z0-9]+/g, ' ').trim() === normalized)) return canonical;
  }
  return normalized;
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const input = text.replace(/^\uFEFF/, '');
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (char === '"') {
      if (quoted && input[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else quoted = !quoted;
    } else if (char === ',' && !quoted) {
      row.push(cell.trim());
      cell = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && input[index + 1] === '\n') index += 1;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = '';
    } else cell += char;
  }
  if (quoted) throw new Error('CSV contains an unclosed quoted field');
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function downloadProducts(products: Product[], categories: { id: string; name: string }[], suppliers: { id: string; name: string }[], showCost: boolean) {
  const costHeaders = new Set(['Purchase Unit Price', 'Sale Margin']);
  const headers = PRODUCT_IMPORT_HEADERS.filter((header) => showCost || !costHeaders.has(header));
  const rows = products.map((product) => {
    const values: Record<string, string | number | boolean | undefined> = {
      Sr: product.sku,
      'Product Name': product.name,
      Stock: product.stock,
      'Purchase Unit Price': costPerPurchaseUnit(product.cost, product.packSize) / 100,
      'Qty/ Unit': product.packSize,
      'Purchase Unit': product.packName,
      'Sale Unit': product.unit,
      'Unit Sale Price': product.salePrice / 100,
      'Sale Margin': product.salePrice > 0 && product.cost > 0 ? ((product.salePrice - product.cost) / product.salePrice) * 100 : '',
      Supplier: suppliers.find((supplier) => supplier.id === product.supplierId)?.name,
      'Product Category': categories.find((category) => category.id === product.categoryId)?.name,
    };
    return headers.map((header) => csvCell(values[header]));
  });
  const csv = [headers.map(csvCell), ...rows].map((row) => row.join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' }));
  const link = Object.assign(document.createElement('a'), { href: url, download: `products-${new Date().toISOString().slice(0, 10)}.csv` });
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ProductsPage() {
  const { can, has, settings } = useSession();
  const [searchParams, setSearchParams] = useSearchParams();
  const products = useLiveQuery(() => db.products.toArray(), []) ?? [];
  const categories = useLiveQuery(() => db.categories.orderBy('name').toArray(), []) ?? [];
  const suppliers = useLiveQuery(() => db.suppliers.orderBy('name').toArray(), []) ?? [];
  const [q, setQ] = useState('');
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [categoryMenuOpen, setCategoryMenuOpen] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const [supplierFilter, setSupplierFilter] = useState('all');
  const [stockFilter, setStockFilter] = useState('all');
  const [focusFilter, setFocusFilter] = useState(() => {
    const focus = searchParams.get('focus');
    return focus === 'low-margin' || focus === 'below-cost' || focus === 'product' ? focus : 'all';
  });
  const [sortBy, setSortBy] = useState<'name' | 'stock' | 'price' | 'margin'>('name');
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState<Product | 'new' | null>(null);
  const [adjusting, setAdjusting] = useState<Product | null>(null);
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const [bulkAction, setBulkAction] = useState<'archive' | 'activate' | 'delete' | null>(null);
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [bulkVoiceProducts, setBulkVoiceProducts] = useState<Product[] | null>(null);
  const [managingCats, setManagingCats] = useState(false);
  const [importSummary, setImportSummary] = useState('');
  const run = useAction();
  const toast = useToast();
  const showCost = can('cost');
  const canBulkArchive = has('products.edit');
  const canBulkDelete = has('products.delete');
  const canBulkImport = has('products.import');
  const canBulkVoice = has('products.edit');
  const effectiveFocusFilter = showCost ? focusFilter : 'all';

  const importProducts = (file: File) =>
    run(async () => {
      const rows = parseCsv(await file.text());
      if (rows.length < 2) throw new Error('CSV must include a header row and at least one product');
      const headers = rows[0].map(normalizeHeader);
      const column = (name: string) => headers.indexOf(name);
      for (const required of ['sku', 'name', 'sale price (rs)']) {
        if (column(required) < 0) throw new Error(`CSV is missing the "${required}" column`);
      }

      const records = rows.slice(1).map((row, index) => {
        const value = (name: string) => (column(name) < 0 ? '' : row[column(name)] ?? '').trim();
        const rowNumber = index + 2;
        const sku = value('sku');
        const name = value('name');
        const priceText = value('sale price (rs)');
        const salePrice = Number(priceText);
        if (!sku || !name) throw new Error(`Row ${rowNumber}: SKU and name are required`);
        if (!priceText || !Number.isFinite(salePrice) || salePrice <= 0) throw new Error(`Row ${rowNumber}: sale price must be greater than zero`);
        const thresholdText = value('threshold price (rs)');
        const thresholdPrice = thresholdText ? Number(thresholdText) : undefined;
        const wholesaleText = value('wholesale price (rs)');
        const wholesalePrice = wholesaleText ? Number(wholesaleText) : undefined;
        if (thresholdPrice !== undefined && (!Number.isFinite(thresholdPrice) || thresholdPrice < 0 || thresholdPrice > salePrice)) throw new Error(`Row ${rowNumber}: threshold price must be between zero and sale price`);
        if (wholesalePrice !== undefined && (!Number.isFinite(wholesalePrice) || wholesalePrice < 0)) throw new Error(`Row ${rowNumber}: wholesale price must be zero or greater`);
        const minStockText = value('minimum stock');
        const packSizeText = value('pack size');
        const minStock = minStockText ? Number(minStockText) : 0;
        const packSize = packSizeText ? Number(packSizeText) : undefined;
        if (!Number.isFinite(minStock) || minStock < 0) throw new Error(`Row ${rowNumber}: minimum stock must be zero or greater`);
        if (packSize !== undefined && (!Number.isFinite(packSize) || packSize <= 0)) throw new Error(`Row ${rowNumber}: pack size must be greater than zero`);
        const openingStockText = value('opening stock');
        const openingStock = openingStockText ? Number(openingStockText) : 0;
        if (!Number.isFinite(openingStock) || openingStock < 0) throw new Error(`Row ${rowNumber}: opening stock must be zero or greater`);
        const costText = value('cost (rs)');
        const purchaseUnitPriceText = value('purchase unit price');
        const purchaseUnitPrice = purchaseUnitPriceText ? Number(purchaseUnitPriceText) : undefined;
        const cost = costText
          ? Number(costText)
          : purchaseUnitPrice === undefined
            ? undefined
            : purchaseUnitPrice / (packSize ?? 1);
        if (cost !== undefined && (!Number.isFinite(cost) || cost < 0)) throw new Error(`Row ${rowNumber}: cost must be zero or greater`);
        const parseFlag = (text: string, fallback: boolean) => {
          if (!text) return fallback;
          if (['true', '1', 'yes'].includes(text.toLowerCase())) return true;
          if (['false', '0', 'no'].includes(text.toLowerCase())) return false;
          throw new Error(`Row ${rowNumber}: use true or false for favorite and active`);
        };
        return {
          rowNumber,
          sku,
          name,
          nameUr: value('urdu name') || undefined,
          voiceKeywords: column('voice keywords') >= 0
            ? value('voice keywords').split(/[;,|]/).map((keyword) => keyword.trim()).filter(Boolean)
            : undefined,
          barcode: value('barcode') || undefined,
          category: value('category'),
          supplier: value('supplier'),
          unit: value('unit') || 'Piece',
          packName: value('pack name') || undefined,
          packSize,
          salePrice: Math.round(salePrice * 100),
          thresholdPrice: thresholdPrice === undefined ? undefined : Math.round(thresholdPrice * 100),
          thresholdDiscountEnabled: true,
          thresholdDiscountAmount: undefined,
          wholesalePrice: wholesalePrice === undefined ? undefined : Math.round(wholesalePrice * 100),
          cost: cost === undefined ? undefined : Math.round(cost * 100),
          openingStock,
          minStock,
          favorite: parseFlag(value('favorite'), false),
          active: parseFlag(value('active'), true),
        };
      });

      const seenSkus = new Set<string>();
      const seenBarcodes = new Set<string>();
      for (const record of records) {
        const normalizedSku = record.sku.toLowerCase();
        if (seenSkus.has(normalizedSku)) throw new Error(`Row ${record.rowNumber}: duplicate SKU ${record.sku} in CSV`);
        seenSkus.add(normalizedSku);
        if (record.barcode) {
          if (seenBarcodes.has(record.barcode)) throw new Error(`Row ${record.rowNumber}: duplicate barcode ${record.barcode} in CSV`);
          seenBarcodes.add(record.barcode);
        }
      }

      if (records.some((record) => record.cost !== undefined) && !has('products.edit_cost')) {
        throw new Error('This CSV includes purchase prices. Ask the owner to grant permission to edit product costs before importing them.');
      }

      // The server matches products by SKU, creates missing categories and suppliers, checks barcodes and
      // records opening stock, all in one step. Cost and price changes need the matching permission there.
      const result = await importProductsOp(records.map(({ rowNumber: _row, ...record }) => record as ImportRecord));
      setImportSummary(`Imported ${result.added} new and updated ${result.updated} products${result.suppliersAdded ? `; added ${result.suppliersAdded} suppliers` : ''}.`);
    }, 'Product import complete');

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return products
      .filter((p) => (showInactive ? true : p.active))
      .filter((p) => effectiveFocusFilter === 'all'
        || (effectiveFocusFilter === 'product'
          ? p.id === searchParams.get('productId')
          : p.salePrice > 0 && !p.isService && (effectiveFocusFilter === 'below-cost'
            ? p.salePrice < p.cost
            : p.salePrice >= p.cost && ((p.salePrice - p.cost) / p.salePrice) * 100 < (settings?.minimumMarginPct ?? 5))))
      .filter((p) => selectedCategories.length === 0 || selectedCategories.includes(p.categoryId ?? ''))
      .filter((p) => supplierFilter === 'all' || p.supplierId === supplierFilter)
      .filter((p) => stockFilter === 'all' || (!p.isService && p.trackStock !== false && (stockFilter === 'out' ? p.stock <= 0 : stockFilter === 'low' ? p.stock > 0 && p.stock <= p.minStock : p.stock > p.minStock)))
      .filter((p) => !s || p.name.toLowerCase().includes(s) || p.sku.toLowerCase().includes(s) || p.barcode?.includes(s) || p.nameUr?.includes(q.trim()))
      .sort((a, b) => sortBy === 'stock'
        ? a.stock - b.stock
        : sortBy === 'price'
          ? b.salePrice - a.salePrice
          : sortBy === 'margin'
            ? ((b.salePrice > 0 ? (b.salePrice - b.cost) / b.salePrice : -Infinity) - (a.salePrice > 0 ? (a.salePrice - a.cost) / a.salePrice : -Infinity))
            : compareListValues(a.name, b.name));
  }, [products, q, selectedCategories, showInactive, supplierFilter, stockFilter, sortBy, effectiveFocusFilter, searchParams, settings?.minimumMarginPct]);

  const pageSize = 25;
  const pageCount = Math.ceil(list.length / pageSize);
  const visiblePage = Math.min(page, Math.max(0, pageCount - 1));
  const pageProducts = list.slice(visiblePage * pageSize, (visiblePage + 1) * pageSize);
  const firstVisible = list.length ? visiblePage * pageSize + 1 : 0;
  const lastVisible = Math.min((visiblePage + 1) * pageSize, list.length);
  const pageProductIds = pageProducts.map((product) => product.id);
  const allPageSelected = pageProductIds.length > 0 && pageProductIds.every((id) => selectedProductIds.includes(id));

  const catName = (id?: string) => categories.find((c) => c.id === id)?.name ?? '—';
  const togglePageSelection = (checked: boolean) => {
    const next = new Set(selectedProductIds);
    if (checked) for (const id of pageProductIds) next.add(id);
    else for (const id of pageProductIds) next.delete(id);
    if (next.size > 500) {
      toast('Select no more than 500 products at a time', 'error');
      return;
    }
    setSelectedProductIds([...next]);
  };
  const toggleProductSelection = (productId: string, checked: boolean) => {
    if (!checked) {
      setSelectedProductIds((current) => current.filter((id) => id !== productId));
      return;
    }
    if (selectedProductIds.includes(productId)) return;
    if (selectedProductIds.length >= 500) {
      toast('Select no more than 500 products at a time', 'error');
      return;
    }
    setSelectedProductIds((current) => [...current, productId]);
  };
  const confirmBulkAction = async () => {
    if (!bulkAction || selectedProductIds.length === 0) return;
    const succeeded = await run(
      () => manageProductsOp(bulkAction, selectedProductIds),
      bulkAction === 'archive'
        ? `${selectedProductIds.length} products archived`
        : bulkAction === 'activate'
          ? `${selectedProductIds.length} products reactivated`
          : `${selectedProductIds.length} products deleted`,
    );
    if (succeeded) {
      setSelectedProductIds([]);
      setBulkAction(null);
    }
  };

  return (
    <div>
      <PageHeader
        title="Products"
        subtitle={`${products.filter((p) => p.active).length} active products`}
        actions={
          <>
            <Button
              variant="secondary"
              onClick={() =>
                run(async () => {
                  const [allProducts, allCategories, allSuppliers] = await Promise.all([
                    db.products.toArray(),
                    db.categories.toArray(),
                    db.suppliers.toArray(),
                  ]);
                  downloadProducts(allProducts, allCategories, allSuppliers, showCost);
                }, 'Product CSV downloaded')
              }
            >
              <Download size={16} /> Export CSV
            </Button>
            {canBulkImport && (
              <label className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                <Upload size={16} /> Bulk add/update
                <input
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = '';
                    if (file) importProducts(file);
                  }}
                />
              </label>
            )}
            <Button variant="secondary" onClick={() => setManagingCats(true)}>
              <Tags size={16} /> Categories
            </Button>
            <Button onClick={() => setEditing('new')}>
              <Plus size={16} /> Add product
            </Button>
          </>
        }
      />
      {showCost && focusFilter !== 'all' && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          <span>
            Focused view: <strong>{effectiveFocusFilter === 'product' ? 'Selected product' : effectiveFocusFilter === 'low-margin' ? `Products below ${settings?.minimumMarginPct ?? 5}% margin` : 'Products priced below cost'}</strong>
            {' '}· {list.length} matching products
          </span>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setFocusFilter('all');
              const next = new URLSearchParams(searchParams);
              next.delete('focus');
              next.delete('productId');
              setSearchParams(next, { replace: true });
              setPage(0);
            }}
          >
            Clear focus
          </Button>
        </div>
      )}
      {importSummary && <p className="mb-3 text-sm text-emerald-700">{importSummary}</p>}
      <Card>
        <ListControls
          search={q}
          onSearch={(value) => { setQ(value); setPage(0); }}
          placeholder="Search name, SKU, barcode…"
          filters={[
            { label: 'Supplier', value: supplierFilter, options: [{ value: 'all', label: 'All suppliers' }, ...suppliers.map((supplier) => ({ value: supplier.id, label: supplier.name }))], onChange: (value) => { setSupplierFilter(value); setPage(0); } },
            { label: 'Stock level', value: stockFilter, options: [{ value: 'all', label: 'All stock' }, { value: 'low', label: 'Low stock' }, { value: 'out', label: 'Out of stock' }, { value: 'in', label: 'In stock' }], onChange: (value) => { setStockFilter(value); setPage(0); } },
            ...(showCost ? [{ label: 'Pricing issue', value: focusFilter, options: [{ value: 'all', label: 'All pricing' }, { value: 'low-margin', label: `Below ${settings?.minimumMarginPct ?? 5}% margin` }, { value: 'below-cost', label: 'Below cost' }], onChange: (value: string) => { setFocusFilter(value); setPage(0); const next = new URLSearchParams(searchParams); next.delete('productId'); if (value === 'all') next.delete('focus'); else next.set('focus', value); setSearchParams(next, { replace: true }); } }] : []),
          ]}
          sortValue={sortBy}
          sortOptions={[{ value: 'name', label: 'Name · A–Z' }, { value: 'stock', label: 'Stock · least' }, { value: 'price', label: 'Sale price · highest' }, ...(showCost ? [{ value: 'margin', label: 'Margin · highest' }] : [])]}
          onSort={(value) => { setSortBy(value as typeof sortBy); setPage(0); }}
        />
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3">
          <div className="relative">
            <Button variant="secondary" aria-expanded={categoryMenuOpen} onClick={() => setCategoryMenuOpen((open) => !open)}>
              <Tags size={16} /> {selectedCategories.length ? `Categories (${selectedCategories.length})` : 'All categories'}
            </Button>
            {categoryMenuOpen && (
              <div className="absolute right-0 z-20 mt-1 max-h-72 w-64 overflow-y-auto rounded-lg border border-slate-200 bg-white p-2 shadow-lg">
                <div className="mb-1 flex items-center justify-between border-b border-slate-100 px-2 py-1.5 text-xs font-semibold text-slate-500">
                  <span>Filter categories</span>
                  {selectedCategories.length > 0 && (
                    <button className="text-brand-700 hover:underline" onClick={() => { setSelectedCategories([]); setPage(0); }}>
                      Clear
                    </button>
                  )}
                </div>
                {categories.map((category) => (
                  <label key={category.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-slate-50">
                    <input
                      type="checkbox"
                      checked={selectedCategories.includes(category.id)}
                      onChange={(event) => {
                        setSelectedCategories((current) => event.target.checked
                          ? [...current, category.id]
                          : current.filter((id) => id !== category.id));
                        setPage(0);
                      }}
                    />
                    <span>{category.name}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={showInactive} onChange={(e) => { setShowInactive(e.target.checked); setPage(0); }} /> Show inactive
          </label>
        </div>
        {(canBulkArchive || canBulkDelete || canBulkVoice) && selectedProductIds.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-slate-50 px-3 py-2">
            <span className="mr-2 text-sm text-slate-600">{selectedProductIds.length} selected</span>
            {canBulkArchive && (
              <Button size="sm" variant="secondary" onClick={() => setBulkEditOpen(true)}>
                <SlidersHorizontal size={15} /> Edit fields
              </Button>
            )}
            {canBulkArchive && (
              <Button size="sm" variant="secondary" onClick={() => setBulkAction('archive')}>
                <Archive size={15} /> Archive selected
              </Button>
            )}
            {canBulkArchive && selectedProductIds.some((id) => products.find((product) => product.id === id)?.active === false) && (
              <Button size="sm" variant="secondary" onClick={() => setBulkAction('activate')}>
                <Package size={15} /> Reactivate selected
              </Button>
            )}
            {canBulkDelete && (
              <Button size="sm" variant="danger" onClick={() => setBulkAction('delete')}>
                <Trash2 size={15} /> Permanently delete
              </Button>
            )}
            {canBulkVoice && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  const selected = selectedProductIds
                    .map((id) => products.find((product) => product.id === id))
                    .filter((product): product is Product => !!product);
                  setBulkVoiceProducts(selected);
                }}
              >
                <Mic size={15} /> Add voice keywords
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => setSelectedProductIds([])}>Clear selection</Button>
          </div>
        )}
        {list.length === 0 ? (
          <Empty icon={<Package size={40} />} title="No products yet">
            Click "Add product" to create your first product.
          </Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50">
                <tr>
                  {(canBulkArchive || canBulkDelete || canBulkVoice) && (
                    <th className={th}>
                      <input
                        type="checkbox"
                        aria-label="Select all products on this page"
                        checked={allPageSelected}
                        onChange={(event) => togglePageSelection(event.target.checked)}
                      />
                    </th>
                  )}
                  <th className={th}>Product</th>
                  <th className={th}>Category</th>
                  <th className={cx(th, 'text-right')}>Sale price</th>
                  {showCost && <th className={cx(th, 'text-right')}>Avg cost / sale unit</th>}
                  {showCost && <th className={cx(th, 'text-right')}>Margin</th>}
                  <th className={cx(th, 'text-right')}>Stock</th>
                  <th className={th} />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pageProducts.map((p) => {
                  const margin = p.salePrice > 0 && p.cost > 0 ? ((p.salePrice - p.cost) / p.salePrice) * 100 : null;
                  return (
                    <tr key={p.id} className={cx('hover:bg-slate-50', !p.active && 'opacity-50')}>
                      {(canBulkArchive || canBulkDelete || canBulkVoice) && (
                        <td className={td}>
                          <input
                            type="checkbox"
                            aria-label={`Select ${p.name}`}
                            checked={selectedProductIds.includes(p.id)}
                            onChange={(event) => toggleProductSelection(p.id, event.target.checked)}
                          />
                        </td>
                      )}
                      <td className={td}>
                        <div className="flex items-center gap-1.5 font-medium">
                          {p.favorite && <Star size={13} className="fill-amber-400 text-amber-400" />}
                          {p.name}
                          {p.isService && <span className="rounded bg-teal-50 px-1.5 py-0.5 text-[10px] font-semibold text-teal-800">Service</span>}
                        </div>
                        <div className="text-xs text-slate-500">
                          {p.sku}
                          {p.barcode && ` · ${p.barcode}`}
                          {p.nameUr && <span className="urdu mr-2"> {p.nameUr}</span>}
                        </div>
                      </td>
                      <td className={cx(td, 'text-slate-600')}>{catName(p.categoryId)}</td>
                      <td className={cx(td, 'text-right tabular-nums')}>
                        {rs(p.salePrice)}
                        <span className="text-xs text-slate-400"> /{p.unit}</span>
                      </td>
                      {showCost && <td className={cx(td, 'text-right tabular-nums text-slate-600')}>{rs(p.cost)} /{p.unit}</td>}
                      {showCost && (
                        <td className={cx(td, 'text-right tabular-nums', margin !== null && margin < 5 ? 'text-rose-600' : 'text-slate-600')}>
                          {margin === null ? '—' : `${margin.toFixed(1)}%`}
                        </td>
                      )}
                      <td className={cx(td, 'text-right tabular-nums')}>
                        {p.isService || p.trackStock === false ? <span className="text-slate-400">Not tracked</span> : <>
                          <span className={cx(p.stock <= 0 ? 'text-rose-600 font-semibold' : p.stock <= p.minStock ? 'text-amber-600 font-semibold' : '')}>
                            {qty(p.stock)}
                          </span>{' '}
                          <span className="text-xs text-slate-400">{p.unit}</span>
                        </>}
                      </td>
                      <td className={cx(td, 'whitespace-nowrap text-right')}>
                        <VoiceKeywordMic
                          productName={p.name}
                          onKeyword={async (keyword) => {
                            const current = await db.products.get(p.id);
                            if (!current) throw new Error('Product no longer exists');
                            const keywords = current.voiceKeywords ?? [];
                            if (keywords.some((saved) => saved.trim().toLocaleLowerCase() === keyword.toLocaleLowerCase())) {
                              return `Already learned for ${p.name}: ${keyword}`;
                            }
                            await db.products.update(p.id, { voiceKeywords: [...keywords, keyword] });
                            return `Learned for ${p.name}: ${keyword}`;
                          }}
                        />
                        <Button
                          size="sm"
                          variant="ghost"
                          title={p.favorite ? 'Remove from favorites' : 'Add to favorites'}
                          aria-label={p.favorite ? `Remove ${p.name} from favorites` : `Add ${p.name} to favorites`}
                          onClick={() => run(() => db.products.update(p.id, { favorite: !p.favorite }), p.favorite ? 'Removed from favorites' : 'Added to favorites')}
                        >
                          <Star size={15} className={p.favorite ? 'fill-amber-400 text-amber-400' : ''} />
                        </Button>
                        {!p.isService && p.trackStock !== false && <Button size="sm" variant="ghost" onClick={() => setAdjusting(p)} title="Adjust stock">
                          <Boxes size={15} />
                        </Button>}
                        <Button size="sm" variant="ghost" onClick={() => setEditing(p)} title="Edit">
                          <Pencil size={15} />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {list.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-3 py-2 text-sm text-slate-600">
            <span>Showing {firstVisible}–{lastVisible} of {list.length} products</span>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="secondary" disabled={visiblePage === 0} onClick={() => setPage(visiblePage - 1)}>
                Previous
              </Button>
              <span className="tabular-nums">Page {visiblePage + 1} of {pageCount}</span>
              <Button size="sm" variant="secondary" disabled={visiblePage >= pageCount - 1} onClick={() => setPage(visiblePage + 1)}>
                Next
              </Button>
            </div>
          </div>
        )}
      </Card>
      {editing && (
        <ProductForm
          product={editing === 'new' ? null : editing}
          categories={categories}
          suppliers={suppliers}
          showCost={showCost}
          canEditPrices={can('priceEdit')}
          onClose={() => setEditing(null)}
        />
      )}
      {adjusting && <StockAdjustModal product={adjusting} onClose={() => setAdjusting(null)} />}
      {managingCats && <CategoriesModal onClose={() => setManagingCats(false)} />}
      {bulkAction && (
        <Modal
          title={bulkAction === 'archive' ? 'Archive selected products?' : bulkAction === 'activate' ? 'Reactivate selected products?' : 'Permanently delete selected products?'}
          onClose={() => setBulkAction(null)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setBulkAction(null)}>Cancel</Button>
              <Button variant={bulkAction === 'delete' ? 'danger' : 'primary'} onClick={() => void confirmBulkAction()}>
                {bulkAction === 'archive' ? 'Archive products' : bulkAction === 'activate' ? 'Reactivate products' : 'Delete products'}
              </Button>
            </>
          }
        >
          {bulkAction === 'archive'
            ? <p>{selectedProductIds.length} selected product(s) will be marked inactive and will remain available in history.</p>
            : bulkAction === 'activate'
              ? <p>{selectedProductIds.length} selected product(s) will be made active and available in the POS.</p>
              : <p>Only products with no stock and no sales, purchases, returns, open carts, or stock history can be permanently deleted. Products with records must be archived instead.</p>}
        </Modal>
      )}
      {bulkVoiceProducts && (
        <BulkVoiceKeywords products={bulkVoiceProducts} onClose={() => setBulkVoiceProducts(null)} />
      )}
      {bulkEditOpen && (
        <BulkProductFieldsModal
          ids={selectedProductIds}
          categories={categories}
          suppliers={suppliers}
          canEditPrices={can('priceEdit')}
          onClose={() => setBulkEditOpen(false)}
          onApply={async (changes) => {
            const succeeded = await run(
              () => bulkUpdateProductsOp(selectedProductIds, changes),
              `${selectedProductIds.length} products updated`,
            );
            if (succeeded) setBulkEditOpen(false);
            return succeeded;
          }}
        />
      )}
    </div>
  );
}

export function ProductForm({
  product,
  categories,
  suppliers,
  showCost,
  canEditPrices,
  initialSupplierId,
  onCreated,
  onClose,
}: {
  product: Product | null;
  categories: { id: string; name: string }[];
  suppliers: { id: string; name: string }[];
  showCost: boolean;
  canEditPrices: boolean;
  initialSupplierId?: string;
  onCreated?: (productId: string) => void | Promise<void>;
  onClose: () => void;
}) {
  const run = useAction();
  const toast = useToast();
  const [voiceKeywordDraft, setVoiceKeywordDraft] = useState('');
  const [f, setF] = useState(() => ({
    name: product?.name ?? '',
    nameUr: product?.nameUr ?? '',
    voiceKeywords: product?.voiceKeywords ?? [],
    sku: product?.sku ?? '',
    barcode: product?.barcode ?? '',
    categoryId: product?.categoryId ?? '',
    supplierId: product?.supplierId ?? initialSupplierId ?? '',
    unit: product?.unit ?? 'Piece',
    packName: product?.packName ?? 'Carton',
    packSize: product?.packSize ? String(product.packSize) : '',
    salePrice: product?.salePrice ?? 0,
    quantityPrices: (product?.quantityPrices ?? []).map((tier) => ({
      quantity: String(tier.quantity),
      totalPrice: String(tier.totalPrice / 100),
    })),
    thresholdDiscountEnabled: product?.thresholdDiscountEnabled ?? true,
    thresholdDiscountAmount: product?.thresholdDiscountAmount != null
      ? String(product.thresholdDiscountAmount / 100)
      : product?.thresholdPrice != null && product.thresholdPrice < product.salePrice
        ? String((product.salePrice - product.thresholdPrice) / 100)
        : '',
    cost: product?.cost ?? 0,
    minStock: product ? String(product.minStock) : '0',
    openingStock: '',
    favorite: product?.favorite ?? false,
    active: product?.active ?? true,
  }));
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const appendVoiceKeywords = (text: string) => {
    const existing = new Set(f.voiceKeywords.map((keyword) => keyword.trim().toLocaleLowerCase()));
    const added: string[] = [];
    for (const keyword of text.split(/[;,|]/).map((part) => part.trim()).filter(Boolean)) {
      const key = keyword.toLocaleLowerCase();
      if (!existing.has(key)) {
        existing.add(key);
        added.push(keyword);
      }
    }
    if (added.length) set('voiceKeywords', [...f.voiceKeywords, ...added]);
    return added;
  };

  const save = () =>
    run(async () => {
      if (!f.name.trim()) throw new Error('Enter product name');
      if (f.salePrice <= 0) throw new Error('Enter sale price');
      const thresholdDiscountAmount = f.thresholdDiscountAmount.trim() ? Math.round(Number(f.thresholdDiscountAmount) * 100) : undefined;
      if (thresholdDiscountAmount !== undefined && (!Number.isFinite(thresholdDiscountAmount) || thresholdDiscountAmount < 0 || thresholdDiscountAmount > f.salePrice)) throw new Error('Product discount must be between zero and the sale price');
      if (!Number.isFinite(f.cost) || f.cost < 0) throw new Error('Purchase cost must be zero or greater');
      const packSize = f.packSize.trim() ? Number(f.packSize) : undefined;
      if (packSize !== undefined && (!Number.isFinite(packSize) || packSize <= 0)) throw new Error('Units per purchase pack must be greater than zero');
      const cost = costPerSaleUnit(f.cost, packSize);
      const salePrice = product && !canEditPrices ? product.salePrice : f.salePrice;
      const quantityPrices = product && !canEditPrices
        ? product.quantityPrices
        : f.quantityPrices.flatMap((tier, index) => {
          if (!tier.quantity.trim() && !tier.totalPrice.trim()) return [];
          const quantity = Number(tier.quantity);
          const totalPrice = Math.round(Number(tier.totalPrice) * 100);
          if (!Number.isInteger(quantity) || quantity <= 0) throw new Error(`Bundle ${index + 1}: quantity must be a whole number greater than zero`);
          if (!Number.isFinite(totalPrice) || totalPrice <= 0) throw new Error(`Bundle ${index + 1}: total price must be greater than zero`);
          if (totalPrice > salePrice * quantity) throw new Error(`Bundle ${index + 1}: total cannot exceed the regular price for that quantity`);
          return [{ quantity, totalPrice }];
        });
      if (quantityPrices && new Set(quantityPrices.map((tier) => tier.quantity)).size !== quantityPrices.length) {
        throw new Error('Bundle quantities must be unique');
      }
      const sku = f.sku.trim() || `P${Date.now().toString().slice(-6)}`;
      const dupe = await db.products.where('sku').equals(sku).first();
      if (dupe && dupe.id !== product?.id) throw new Error(`SKU ${sku} is already used by ${dupe.name}`);
      if (f.barcode.trim()) {
        const b = await db.products.where('barcode').equals(f.barcode.trim()).first();
        if (b && b.id !== product?.id) throw new Error(`Barcode already used by ${b.name}`);
      }
      const data = {
        name: f.name.trim(),
        nameUr: f.nameUr.trim() || undefined,
        voiceKeywords: f.voiceKeywords,
        sku,
        barcode: f.barcode.trim() || undefined,
        categoryId: f.categoryId || undefined,
        supplierId: f.supplierId || undefined,
        unit: f.unit,
        packName: f.packSize ? f.packName : undefined,
        packSize: f.packSize ? Number(f.packSize) : undefined,
        salePrice,
        quantityPrices,
        ...(product && !canEditPrices
          ? {
            thresholdPrice: product.thresholdPrice,
            thresholdDiscountEnabled: product.thresholdDiscountEnabled,
            thresholdDiscountAmount: product.thresholdDiscountAmount,
          }
          : {
            thresholdPrice: undefined,
            thresholdDiscountEnabled: f.thresholdDiscountEnabled,
            thresholdDiscountAmount,
          }),
        minStock: Number(f.minStock) || 0,
        favorite: f.favorite,
        active: f.active,
      };
      if (product) {
        await db.products.update(product.id, { ...data, ...(showCost ? { cost } : {}) });
      } else {
        const id = uid();
        await db.products.add({ ...data, id, cost, stock: 0, createdAt: nowIso() });
        const opening = Number(f.openingStock);
        if (opening > 0) await adjustStock({ productId: id, qty: opening, type: 'opening', cost, note: 'Opening stock' });
        await onCreated?.(id);
      }
      onClose();
    }, product ? 'Product updated' : 'Product added');

  const configuredPackSize = f.packSize.trim() ? Number(f.packSize) : undefined;
  const purchasePackSize = configuredPackSize !== undefined && Number.isFinite(configuredPackSize) && configuredPackSize > 0
    ? configuredPackSize
    : undefined;
  const purchaseUnitLabel = purchasePackSize && purchasePackSize > 1
    ? `${f.packName} (${purchasePackSize} ${f.unit})`
    : f.unit;

  return (
    <Modal
      wide
      title={product ? `Edit ${product.name}` : 'Add product'}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save}>Save</Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Product name *">
          <Input value={f.name} onChange={(e) => set('name', e.target.value)} autoFocus />
        </Field>
        <Field label="Urdu name">
          <Input className="urdu" value={f.nameUr} onChange={(e) => set('nameUr', e.target.value)} />
        </Field>
        <Field label="Voice keywords" hint="Each saved name appears below. Type one or more separated by commas, or record with the mic; Save the product to keep changes." className="sm:col-span-2">
          <div className="flex flex-wrap gap-1.5">
            {f.voiceKeywords.map((keyword, index) => (
              <span key={`${keyword}-${index}`} className="inline-flex max-w-full items-center gap-1 rounded-md border border-sky-200 bg-sky-50 py-0.5 pr-0.5 pl-2 text-sm text-sky-900">
                <span className="break-all">{keyword}</span>
                <button
                  type="button"
                  className="rounded p-1 text-sky-700 hover:bg-sky-100"
                  title={`Remove keyword ${keyword}`}
                  aria-label={`Remove voice keyword ${keyword}`}
                  onClick={() => set('voiceKeywords', f.voiceKeywords.filter((_, itemIndex) => itemIndex !== index))}
                >
                  <X size={13} />
                </button>
              </span>
            ))}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <Input
              className="flex-1"
              value={voiceKeywordDraft}
              onChange={(e) => setVoiceKeywordDraft(e.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  const added = appendVoiceKeywords(voiceKeywordDraft);
                  if (added.length) {
                    setVoiceKeywordDraft('');
                    toast(`Added ${added.length} voice keyword${added.length === 1 ? '' : 's'}. Save the product to keep changes.`);
                  }
                }
              }}
              placeholder="e.g. cheeni, meetha, چینی"
            />
            <Button
              size="sm"
              variant="secondary"
              disabled={!voiceKeywordDraft.trim()}
              title="Add typed voice keyword"
              aria-label="Add typed voice keyword"
              onClick={() => {
                const added = appendVoiceKeywords(voiceKeywordDraft);
                if (added.length) {
                  setVoiceKeywordDraft('');
                  toast(`Added ${added.length} voice keyword${added.length === 1 ? '' : 's'}. Save the product to keep changes.`);
                }
              }}
            >
              <Plus size={16} /> Add
            </Button>
            <VoiceKeywordMic
              productName={f.name || 'this product'}
              onKeyword={(keyword) => {
                const added = appendVoiceKeywords(keyword);
                return added.length ? `Added "${keyword}". Save the product to keep it.` : `Already in the keyword list: ${keyword}`;
              }}
            />
          </div>
        </Field>
        <Field label="SKU / code" hint="Leave empty to generate">
          <Input value={f.sku} onChange={(e) => set('sku', e.target.value)} />
        </Field>
        <Field label="Barcode" hint="Scan with a barcode scanner or type">
          <Input value={f.barcode} onChange={(e) => set('barcode', e.target.value)} />
        </Field>
        <Field label="Category">
          <Select value={f.categoryId} onChange={(e) => set('categoryId', e.target.value)}>
            <option value="">—</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Main supplier">
          <Select value={f.supplierId} onChange={(e) => set('supplierId', e.target.value)}>
            <option value="">—</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Sale unit" hint="Stock is counted in this unit">
          <Select value={f.unit} onChange={(e) => set('unit', e.target.value)}>
            {UNITS.map((u) => (
              <option key={u}>{u}</option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Buying pack">
            <Select value={f.packName} onChange={(e) => set('packName', e.target.value)}>
              {['Carton', 'Box', 'Case', 'Crate', 'Sack', 'Dozen', 'Tray', 'Bundle'].map((u) => (
                <option key={u}>{u}</option>
              ))}
            </Select>
          </Field>
          <Field label={`${f.unit}s per pack`}>
            <Input inputMode="decimal" value={f.packSize} onChange={(e) => set('packSize', e.target.value)} placeholder="e.g. 24" />
          </Field>
        </div>
        <Field label={`Sale price per ${f.unit} (Rs) *`}>
          <MoneyInput value={f.salePrice} onChange={(v) => set('salePrice', v)} disabled={!!product && !canEditPrices} />
        </Field>
        <Field
          label={`Exact quantity bundle prices (${f.unit})`}
          hint={`Set the final total for exact quantities. Example: 7 ${f.unit}s = Rs 100. Bundle total replaces other automatic discounts.`}
          className="sm:col-span-2"
        >
          <div className="space-y-2">
            {f.quantityPrices.map((tier, index) => (
              <div key={`quantity-price-${index}`} className="flex flex-wrap items-center gap-2">
                <Input
                  className="w-28"
                  inputMode="numeric"
                  value={tier.quantity}
                  onChange={(event) => set('quantityPrices', f.quantityPrices.map((row, rowIndex) => rowIndex === index ? { ...row, quantity: event.target.value } : row))}
                  placeholder="Quantity"
                  aria-label={`Bundle ${index + 1} quantity`}
                  disabled={!canEditPrices}
                />
                <span className="text-sm text-slate-500">units total Rs</span>
                <Input
                  className="w-32"
                  inputMode="decimal"
                  value={tier.totalPrice}
                  onChange={(event) => set('quantityPrices', f.quantityPrices.map((row, rowIndex) => rowIndex === index ? { ...row, totalPrice: event.target.value } : row))}
                  placeholder="Bundle total"
                  aria-label={`Bundle ${index + 1} total price`}
                  disabled={!canEditPrices}
                />
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-label={`Remove bundle ${index + 1}`}
                  disabled={!canEditPrices}
                  onClick={() => set('quantityPrices', f.quantityPrices.filter((_, rowIndex) => rowIndex !== index))}
                >
                  <X size={14} />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={!canEditPrices}
              onClick={() => set('quantityPrices', [...f.quantityPrices, { quantity: '', totalPrice: '' }])}
            >
              <Plus size={14} /> Add quantity price
            </Button>
          </div>
        </Field>
        <div className="space-y-3 sm:col-span-2">
          <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
            <input type="checkbox" checked={f.thresholdDiscountEnabled} onChange={(event) => set('thresholdDiscountEnabled', event.target.checked)} disabled={!canEditPrices} />
            Allow automatic discount on a threshold-qualified bill
          </label>
          {f.thresholdDiscountEnabled && (
            <Field label={`Product discount per ${f.unit} (Rs)`} hint="Leave blank to use the shop's percentage discount, limited by its profit cap. A set amount is also subject to the shop's discount caps.">
              <Input inputMode="decimal" min="0" max={f.salePrice / 100} value={f.thresholdDiscountAmount} onChange={(event) => set('thresholdDiscountAmount', event.target.value)} placeholder="Use profit-based default" disabled={!canEditPrices} />
            </Field>
          )}
        </div>
        {(showCost || !product) && (
          <Field label={`Purchase cost per ${purchaseUnitLabel} (Rs)`} hint={`Average cost is stored per ${f.unit}; purchases update it automatically.`}>
            <MoneyInput
              value={costPerPurchaseUnit(f.cost, purchasePackSize)}
              onChange={(value) => set('cost', costPerSaleUnit(value, purchasePackSize))}
            />
          </Field>
        )}
        <Field label="Minimum stock" hint="Alert when stock falls to this level">
          <Input inputMode="decimal" value={f.minStock} onChange={(e) => set('minStock', e.target.value)} />
        </Field>
        {!product && (
          <Field label="Opening stock" hint={`How many ${f.unit}s you have now`}>
            <Input inputMode="decimal" value={f.openingStock} onChange={(e) => set('openingStock', e.target.value)} />
          </Field>
        )}
        <div className="flex items-center gap-6 sm:col-span-2">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={f.favorite} onChange={(e) => set('favorite', e.target.checked)} /> Show in POS favourites
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={f.active} onChange={(e) => set('active', e.target.checked)} /> Active
          </label>
        </div>
      </div>
    </Modal>
  );
}

function BulkProductFieldsModal({
  ids,
  categories,
  suppliers,
  canEditPrices,
  onApply,
  onClose,
}: {
  ids: string[];
  categories: { id: string; name: string }[];
  suppliers: { id: string; name: string }[];
  canEditPrices: boolean;
  onApply: (changes: {
    categoryId?: string | null;
    supplierId?: string | null;
    unit?: string;
    thresholdDiscountEnabled?: boolean;
    thresholdDiscountAmount?: number | null;
  }) => Promise<boolean>;
  onClose: () => void;
}) {
  const [categoryId, setCategoryId] = useState('unchanged');
  const [supplierId, setSupplierId] = useState('unchanged');
  const [unit, setUnit] = useState('unchanged');
  const [discountMode, setDiscountMode] = useState('unchanged');
  const [discountAmount, setDiscountAmount] = useState('');
  const discountValue = discountAmount.trim() ? Number(discountAmount) : undefined;
  const discountInvalid = discountMode === 'amount' && (discountValue === undefined || !Number.isFinite(discountValue) || discountValue < 0);
  const hasChanges = categoryId !== 'unchanged' || supplierId !== 'unchanged' || unit !== 'unchanged' || discountMode !== 'unchanged';

  const apply = () => {
    if (discountInvalid) return;
    const changes = {
      ...(categoryId !== 'unchanged' ? { categoryId: categoryId === 'none' ? null : categoryId } : {}),
      ...(supplierId !== 'unchanged' ? { supplierId: supplierId === 'none' ? null : supplierId } : {}),
      ...(unit !== 'unchanged' ? { unit } : {}),
      ...(discountMode === 'default' ? { thresholdDiscountEnabled: true, thresholdDiscountAmount: null } : {}),
      ...(discountMode === 'disabled' ? { thresholdDiscountEnabled: false, thresholdDiscountAmount: null } : {}),
      ...(discountMode === 'amount' && discountValue !== undefined
        ? { thresholdDiscountEnabled: true, thresholdDiscountAmount: Math.round(discountValue * 100) }
        : {}),
    };
    void onApply(changes);
  };

  return (
    <Modal
      title={`Bulk edit ${ids.length} products`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button disabled={!hasChanges || discountInvalid} onClick={apply}>Apply to selected</Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Category">
          <Select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
            <option value="unchanged">Keep existing category</option>
            <option value="none">No category</option>
            {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
          </Select>
        </Field>
        <Field label="Supplier">
          <Select value={supplierId} onChange={(event) => setSupplierId(event.target.value)}>
            <option value="unchanged">Keep existing supplier</option>
            <option value="none">No supplier</option>
            {suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
          </Select>
        </Field>
        <Field label="Unit">
          <Select value={unit} onChange={(event) => setUnit(event.target.value)}>
            <option value="unchanged">Keep existing unit</option>
            {UNITS.map((option) => <option key={option} value={option}>{option}</option>)}
          </Select>
        </Field>
        {canEditPrices && (
          <Field label="Threshold discount">
            <Select value={discountMode} onChange={(event) => setDiscountMode(event.target.value)}>
              <option value="unchanged">Keep each product's setting</option>
              <option value="default">Allow; use profit-based default</option>
              <option value="disabled">Do not discount these products</option>
              <option value="amount">Allow; set Rs per product unit</option>
            </Select>
          </Field>
        )}
        {canEditPrices && discountMode === 'amount' && (
          <Field label="Discount per product unit (Rs)" hint="The shop's maximum discount and profit caps still apply. Billable services are skipped.">
            <Input inputMode="decimal" min="0" value={discountAmount} onChange={(event) => setDiscountAmount(event.target.value)} placeholder="e.g. 3" />
            {discountInvalid && <span className="text-xs text-rose-600">Enter a discount amount of zero or more.</span>}
          </Field>
        )}
      </div>
      <p className="mt-3 text-xs text-slate-500">Only the fields you change will be applied. Stock and sales history remain unchanged. Discount settings apply only to threshold-qualified bills; billable services are skipped.</p>
    </Modal>
  );
}

function VoiceKeywordMic({ productName, onKeyword }: { productName: string; onKeyword: (keyword: string) => string | void | Promise<string | void> }) {
  const toast = useToast();
  const [lang] = useVoiceLang();
  const speech = useSpeech(
    lang,
    (transcript) => {
      const keyword = transcript.trim();
      if (!keyword) return;
      void Promise.resolve(onKeyword(keyword))
        .then((message) => toast(message ?? `Learned "${keyword}" for ${productName}`))
        .catch((error: unknown) => toast(error instanceof Error ? error.message : 'Could not save voice keyword', 'error'));
    },
    (message) => toast(message, 'error'),
  );
  const listening = speech.state === 'listening' || speech.state === 'processing';

  return (
    <Button
      size="sm"
      variant={listening ? 'danger' : 'ghost'}
      title={listening ? `Stop recording for ${productName}` : `Record a voice name for ${productName}`}
      aria-label={listening ? `Stop recording for ${productName}` : `Record a voice name for ${productName}`}
      disabled={speech.state === 'processing'}
      onClick={() => listening ? speech.stop() : speech.start()}
    >
      <Mic size={16} />
      {listening ? 'Stop' : null}
    </Button>
  );
}

function BulkVoiceKeywords({ products, onClose }: { products: Product[]; onClose: () => void }) {
  const toast = useToast();
  const [lang] = useVoiceLang();
  const [index, setIndex] = useState(0);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const product = products[index];
  const speech = useSpeech(
    lang,
    (transcript) => {
      const keyword = transcript.trim();
      if (!keyword || !product) return;
      setSaving(true);
      setMessage('');
      void (async () => {
        try {
          const current = await db.products.get(product.id);
          if (!current) throw new Error(`${product.name} no longer exists`);
          const existing = current.voiceKeywords ?? [];
          const alreadyAdded = existing.some((saved) => saved.trim().toLocaleLowerCase() === keyword.toLocaleLowerCase());
          if (!alreadyAdded) await db.products.update(product.id, { voiceKeywords: [...existing, keyword] });
          setMessage(alreadyAdded ? `Already saved: “${keyword}”` : `Saved: “${keyword}”`);
          if (index + 1 < products.length) setIndex((currentIndex) => currentIndex + 1);
          else toast('Voice keywords saved for all selected products');
        } catch (error) {
          setMessage(error instanceof Error ? error.message : 'Could not save voice keyword');
        } finally {
          setSaving(false);
        }
      })();
    },
    (error) => setMessage(error),
  );
  const listening = speech.state === 'listening' || speech.state === 'processing';
  const finished = index >= products.length;

  return (
    <Modal
      title="Add voice keywords"
      onClose={() => {
        if (listening) speech.stop();
        onClose();
      }}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Close</Button>
          {!finished && index > 0 && (
            <Button
              variant="secondary"
              disabled={listening || saving}
              onClick={() => {
                setMessage('');
                setIndex((currentIndex) => currentIndex - 1);
              }}
            >
              <SkipBack size={15} /> Previous
            </Button>
          )}
          {!finished && (
            <Button
              variant="secondary"
              disabled={listening || saving}
              onClick={() => {
                setMessage('');
                setIndex((currentIndex) => currentIndex + 1);
              }}
            >
              Skip <SkipForward size={15} />
            </Button>
          )}
        </>
      }
    >
      {finished ? (
        <p className="text-sm text-emerald-700">Finished processing the selected products.</p>
      ) : (
        <div className="grid gap-3">
          <p className="text-sm text-slate-500">Product {index + 1} of {products.length}</p>
          <div className="rounded-lg bg-slate-50 p-3">
            <p className="font-semibold text-slate-900">{product.name}</p>
            <p className="text-sm text-slate-500">SKU: {product.sku}</p>
          </div>
          <p className="text-sm text-slate-600">Say the alternate name customers use for this product. It will be saved before moving to the next product.</p>
          {speech.interim && <p aria-live="polite" className="rounded border border-sky-200 bg-sky-50 p-2 text-sm">{speech.interim}</p>}
          {message && <p role="status" className="text-sm text-slate-600">{message}</p>}
          <div>
            <Button
              variant={listening ? 'danger' : 'primary'}
              disabled={saving || speech.state === 'processing'}
              onClick={() => listening ? speech.stop() : speech.start()}
            >
              <Mic size={16} /> {saving ? 'Saving…' : listening ? 'Stop recording' : 'Record keyword'}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function StockAdjustModal({ product, onClose }: { product: Product; onClose: () => void }) {
  const run = useAction();
  const [lang] = useVoiceLang();
  const [mode, setMode] = useState<'add' | 'remove' | 'set'>('add');
  const [type, setType] = useState<'adjust' | 'damage' | 'expiry'>('adjust');
  const [amount, setAmount] = useState('');
  const [cost, setCost] = useState(product.cost);
  const [note, setNote] = useState('');
  const [voiceMessage, setVoiceMessage] = useState('');
  const speech = useSpeech(
    lang,
    (transcript) => {
      const receivedQty = spokenNumber(transcript);
      if (receivedQty === null || receivedQty <= 0) {
        const message = 'Quantity samajh nahi aayi. Product ki quantity bol kar “bs” kahein.';
        setVoiceMessage(message);
        speakVoice(message, lang);
        return;
      }
      setMode('add');
      setAmount(String(receivedQty));
      setVoiceMessage(`${qty(receivedQty)} ${product.unit} ${product.name} stock mein add ho raha hai.`);
      void run(
        () => adjustStock({
          productId: product.id,
          qty: receivedQty,
          type: 'adjust',
          cost,
          note: 'Voice stock addition',
        }),
        'Stock updated',
      ).then((success) => {
        if (success) speakVoice(`${qty(receivedQty)} ${product.unit} ${product.name} stock mein add ho gaya.`, lang);
      });
    },
    (message) => {
      setVoiceMessage(message);
      speakVoice(message, lang);
    },
  );
  const moves = useLiveQuery(() => db.stockMoves.where('productId').equals(product.id).reverse().sortBy('date'), [product.id]) ?? [];
  const n = Number(amount) || 0;
  const delta = mode === 'add' ? n : mode === 'remove' ? -n : n - product.stock;
  const close = () => {
    speech.stopHandsFree();
    onClose();
  };

  return (
    <Modal
      wide
      title={`Stock — ${product.name}`}
      onClose={close}
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Close
          </Button>
          <Button
            disabled={delta === 0 || !amount}
            onClick={() =>
              run(async () => {
                await adjustStock({
                  productId: product.id,
                  qty: delta,
                  type: delta < 0 ? type : 'adjust',
                  ...(delta > 0 ? { cost } : {}),
                  note: note || (mode === 'set' ? 'Stock count correction' : undefined),
                });
                onClose();
              }, 'Stock updated')
            }
          >
            Save adjustment
          </Button>
        </>
      }
    >
      <p className="mb-3 text-sm text-slate-600">
        Current stock: <b>{qty(product.stock)} {product.unit}</b>. Every change is recorded with a reason.
      </p>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Button
          variant={speech.handsFree ? 'danger' : 'secondary'}
          disabled={!speech.supported}
          aria-pressed={speech.handsFree}
          onClick={() => {
            setVoiceMessage('');
            if (speech.handsFree) speech.stopHandsFree();
            else speech.startHandsFree();
          }}
        >
          <Mic size={16} />
          {speech.handsFree ? 'Turn off voice stock entry' : 'Enable voice stock entry'}
        </Button>
        <span className="text-xs text-slate-500">
          Say “Noor”, the quantity, then “bs” — e.g. “Noor 10 bs”. This product: {product.name}.
        </span>
      </div>
      {speech.handsFree && (
        <p className="mb-3 text-sm font-medium text-sky-700" aria-live="polite">
          {speech.wakeWordActive ? `Command: ${speech.interim || 'quantity bolain, phir “bs”'}` : 'Standby — “Noor” bolain.'}
        </p>
      )}
      {voiceMessage && <p className="mb-3 text-sm text-emerald-700" role="status">{voiceMessage}</p>}
      <div className="mb-3 flex gap-2">
        {(['add', 'remove', 'set'] as const).map((m) => (
          <Button key={m} size="sm" variant={mode === m ? 'primary' : 'secondary'} onClick={() => setMode(m)}>
            {m === 'add' ? 'Add stock' : m === 'remove' ? 'Remove stock' : 'Set counted stock'}
          </Button>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={mode === 'set' ? `Counted ${product.unit}s` : `Quantity (${product.unit})`}>
          <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
        </Field>
        {delta < 0 && (
          <Field label="Reason">
            <Select value={type} onChange={(e) => setType(e.target.value as typeof type)}>
              <option value="adjust">Correction / missing</option>
              <option value="damage">Damaged</option>
              <option value="expiry">Expired</option>
            </Select>
          </Field>
        )}
        {delta > 0 && (
          <Field label="Cost per unit (Rs)">
            <MoneyInput value={cost} onChange={setCost} />
          </Field>
        )}
        <Field label="Note">
          <Input value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
      {delta !== 0 && amount && (
        <p className="mt-2 text-sm">
          Change: <b className={delta > 0 ? 'text-emerald-600' : 'text-rose-600'}>{delta > 0 ? '+' : ''}{qty(delta)}</b> → new stock{' '}
          <b>{qty(product.stock + delta)}</b>
        </p>
      )}
      <h4 className="mt-5 mb-2 text-sm font-semibold">Stock history</h4>
      <MovesTable moves={moves.slice(0, 30)} unit={product.unit} />
    </Modal>
  );
}

const MOVE_LABEL: Record<StockMove['type'], string> = {
  opening: 'Opening',
  sale: 'Sale',
  return: 'Return',
  purchase: 'Purchase',
  purchase_return: 'Purchase return',
  adjust: 'Adjustment',
  damage: 'Damaged',
  expiry: 'Expired',
};

export function MovesTable({ moves, unit }: { moves: StockMove[]; unit: string }) {
  const [search, setSearch] = useState('');
  const [moveType, setMoveType] = useState('all');
  const [sortBy, setSortBy] = useState<'date' | 'quantity'>('date');
  const query = search.trim().toLocaleLowerCase();
  const visibleMoves = [...moves]
    .filter((move) => moveType === 'all' || move.type === moveType)
    .filter((move) => !query || (move.note ?? '').toLocaleLowerCase().includes(query) || MOVE_LABEL[move.type].toLocaleLowerCase().includes(query))
    .sort((a, b) => sortBy === 'quantity' ? Math.abs(b.qty) - Math.abs(a.qty) : b.date.localeCompare(a.date));
  if (moves.length === 0) return <p className="text-sm text-slate-500">No stock movements yet.</p>;
  return (
    <>
    <ListControls
      search={search}
      onSearch={setSearch}
      placeholder="Search movement type or note…"
      filters={[{ label: 'Movement type', value: moveType, options: [{ value: 'all', label: 'All movements' }, ...Object.entries(MOVE_LABEL).map(([value, label]) => ({ value, label }))], onChange: setMoveType }]}
      sortValue={sortBy}
      sortOptions={[{ value: 'date', label: 'Date · newest' }, { value: 'quantity', label: 'Quantity · largest' }]}
      onSort={(value) => setSortBy(value as typeof sortBy)}
    />
    {visibleMoves.length === 0 ? <p className="p-4 text-sm text-slate-500">No matching stock movements.</p> : (
    <table className="w-full text-sm">
      <thead className="bg-slate-50">
        <tr>
          <th className={th}>Date</th>
          <th className={th}>Type</th>
          <th className={cx(th, 'text-right')}>Qty</th>
          <th className={th}>Note</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {visibleMoves.map((m) => (
          <tr key={m.id}>
            <td className={td}>{new Date(m.date).toLocaleString('en-PK', { dateStyle: 'short', timeStyle: 'short' })}</td>
            <td className={td}>
              <Badge tone={m.qty > 0 ? 'green' : m.type === 'sale' ? 'blue' : 'red'}>{MOVE_LABEL[m.type]}</Badge>
            </td>
            <td className={cx(td, 'text-right tabular-nums', m.qty > 0 ? 'text-emerald-600' : 'text-rose-600')}>
              {m.qty > 0 ? '+' : ''}
              {qty(m.qty)} {unit}
            </td>
            <td className={cx(td, 'text-slate-500')}>{m.note}</td>
          </tr>
        ))}
      </tbody>
    </table>
    )}
    </>
  );
}

function CategoriesModal({ onClose }: { onClose: () => void }) {
  const categories = useLiveQuery(() => db.categories.orderBy('name').toArray(), []) ?? [];
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [bulkOpen, setBulkOpen] = useState(false);
  const run = useAction();
  return (
    <Modal title="Categories" onClose={onClose}>
      <div className="mb-3 flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => setBulkOpen(true)}>Bulk tools{selected.length ? ` (${selected.length})` : ''}</Button>
        <label className="flex items-center gap-2 px-2 text-sm text-slate-600">
          <input type="checkbox" aria-label="Select all categories" checked={categories.length > 0 && categories.every((category) => selected.includes(category.id))} onChange={(event) => setSelected(event.target.checked ? categories.map((category) => category.id) : [])} />
          Select all
        </label>
        <Input placeholder="New category" value={name} onChange={(e) => setName(e.target.value)} />
        <Button
          disabled={!name.trim()}
          onClick={async () => {
            await db.categories.add({ id: uid(), name: name.trim() });
            setName('');
          }}
        >
          Add
        </Button>
      </div>
      <ul className="divide-y divide-slate-100">
        {categories.map((c) => (
          <li key={c.id} className="flex items-center justify-between py-2 text-sm">
            <input className="mr-2" type="checkbox" aria-label={`Select ${c.name}`} checked={selected.includes(c.id)} onChange={(event) => setSelected(event.target.checked ? [...selected, c.id] : selected.filter((id) => id !== c.id))} />
            <input
              className="flex-1 rounded px-1 py-0.5 hover:bg-slate-50"
              defaultValue={c.name}
              onBlur={(e) => e.target.value.trim() && db.categories.update(c.id, { name: e.target.value.trim() })}
            />
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                run(async () => {
                  const used = await db.products.where('categoryId').equals(c.id).count();
                  if (used) throw new Error(`${used} products use this category`);
                  await db.categories.delete(c.id);
                })
              }
            >
              <Trash2 size={14} />
            </Button>
          </li>
        ))}
      </ul>
      {bulkOpen && <BulkMasterModal entity="categories" ids={selected} onClose={() => { setBulkOpen(false); setSelected([]); }} />}
    </Modal>
  );
}
