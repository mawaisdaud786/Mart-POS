# 06 — Roadmap, Risks, MVP and Implementation Order

## 1. Development phases (revised)

The original plan puts **offline + sync in Phase 7**. I recommend against that. Every module written before Phase 7 would need rewriting to go local-first: client UUIDs, Dexie reads, outbox writes, and the shared posting engine. Below, the sync *core* ships in Phase 2, and every module is offline-capable from the day it's built. Phase 7 becomes sync **hardening**. The other phases keep your order, with two small moves: cash accounts and cash closing move into Phase 3, because the POS needs them, and Action Center and Cash Flow move to Phase 6, where their inputs exist.

| Phase | Scope | Exit criteria |
|---|---|---|
| **1 — Specification** | This document set | Your approval + answers to Q1–Q10 |
| **2 — Foundation** | Monorepo, CI, native Windows dev env (MySQL 8.4, no Docker) · MySQL schema for platform/identity/org/catalog/inventory + **tenant-scoped query layer** · auth (login, refresh rotation, devices, PIN) · tenant creation + minimal Super Admin (create tenant, plans, suspend) · **sync core** (outbox, push/pull, change log, snapshot, Sync Center v1, connection badge) · PWA shell + i18n shell · products, units, product units, categories, brands, barcodes · inventory ledger (opening stock, adjustments, balances) · CSV import (products + opening stock) | Tenant-isolation suite green · product created offline syncs to a 2nd device · migrations up/down verified |
| **3 — POS and Sales** | Financial accounts + payment methods · POS (search, favourites, quick buttons, keyboard shortcuts, barcode-wedge input, units, discounts, split payment, hold/resume, receipt print 58/80 mm) · sales, returns, void · customers + udhaar ledger + payments + statements · cash sessions + **daily cash closing** · suppliers + supplier ledger · purchases (receive, partial vs PO), purchase returns, supplier payments | Full day of sales offline → sync → ledgers balance to the paisa · cash closing matches |
| **4 — Money and Profit** | Expenses (+ attachments, recurring) · owner drawings · transfers · P&L (revenue/COGS/gross/net) · cash flow basics · owner dashboard v1 · core reports + CSV/PDF export | P&L reconciles to the documents in automated tests |
| **5 — Retailer services** | Generic provider model · Easypaisa + JazzCash + mobile load + bills (same code, different config) · commission rules (slabs) · float/cash dual ledger · daily reconciliation · retailer dashboard + reports | Spec §24 example reproduces with both float and cash sides |
| **6 — Smart ordering and insights** | `product_stats_daily` job · ADS/ROP/recommended qty · supplier order planner · **Generate Today's Orders** · PO print/PDF/WhatsApp share (`wa.me`) · product analytics (fast/normal/slow/dead) · batches/expiry/FEFO alerts · Action Center · Cash Flow Intelligence ("why cash is low") · Reinvestment Advisor | Planner output matches hand-calculated fixtures |
| **7 — Sync hardening** | Conflict resolution UI, field-level merge, resync/410 path, rescue export, 5k-mutation drain, multi-tab, clock skew, chaos E2E (network flapping), storage-eviction warnings | All 10 sync tests in 02 §10 pass in CI |
| **8 — Intelligence and messaging** | Alerts engine + in-app/web push/email notifications · WhatsApp provider layer (message outbox + adapter interface) · daily/weekly report messages · AI assistant (Claude with tenant-scoped tools, "no data → say so") · full Urdu UI + RTL pass | AI eval set: answers match SQL ground truth; refuses when data is missing |
| **9 — SaaS business** | Billing invoices, payment proof, manual/gateway adapter · subscription lifecycle job (trial → past_due → expired read-only) · plan limits enforcement · multi-branch (transfers, consolidated reports, branch switcher) · admin metrics (MRR, churn, sync health) · self-service onboarding wizard + sample data | Lifecycle tests with a time-travel clock |
| **10 — Launch readiness** | Security audit (OWASP ASVS L2 checklist), pen-test of tenant isolation, load test (500 tenants × 3 devices), performance budget (POS search < 50 ms on 20k products, low-end Android), backup/restore drill, runbooks, production deploy, monitoring | Go-live checklist signed off |

**Pilot:** Al Noor Mart can start using the system in the shop **after Phase 5**, or after Phase 4 if Easypaisa can wait, running alongside existing paper records for 1–2 weeks.

At every phase I follow the rule in §57: explain → show architecture → implement → run tests → fix → verify migrations → verify tenant isolation → verify offline behaviour. I report honestly what was and wasn't tested.

## 2. Risks and technical challenges

| # | Risk | Impact | Mitigation |
|---|---|---|---|
| R1 | **Offline sync correctness** (duplicates, lost sales, drift) | Critical: owners stop trusting numbers | Immutable documents, idempotency keys, deterministic posting ids, gap-free change log, automated sync test suite, reconciliation job that recomputes projections from ledgers nightly and alerts on mismatch |
| R2 | **Browser storage eviction** (especially iOS Safari, low-disk Android) | Loss of unsynced data | `storage.persist()`, install-as-PWA requirement on iOS, storage warnings, frequent push, rescue export |
| R3 | **Tenant data leak** | Business-ending | Token-derived tenant, fail-closed `tenantDb` query layer + lint ban on raw DB access (no RLS in MySQL, so this layer and the tests carry the weight), composite FKs, isolation tests in CI, separate admin identity, break-glass audit |
| R4 | **Scope size** (60 sections ≈ a year of work for a small team) | Delay, nothing shipped | Strict MVP (below), a pilot shop early, postpone list |
| R5 | **Thermal printing from a browser** | Receipts misaligned, dialogs slow cashiers | Phase 3: CSS print at 58/80 mm with kiosk-printing guidance (Chrome `--kiosk-printing` for Windows POS). Later: ESC/POS via WebUSB/Web Serial or QZ Tray. |
| R6 | **Urdu on thermal printers** (most ESC/POS fonts lack Urdu) | Blank or garbled Urdu | Render the receipt to a raster image (canvas) for ESC/POS; the browser print path handles Urdu fonts natively |
| R7 | **Catalog onboarding burden** (thousands of SKUs, no barcodes) | Shops abandon setup | CSV/Excel import with validation, quick-add from the POS, "sell unknown item" line, later a shared global product catalog (opt-in) |
| R8 | **Costing accuracy offline** (WAC at posting time) | Small COGS variance | Documented method, optional nightly re-cost, variance report |
| R9 | **Easypaisa semantics** (float vs cash, commission settlement) | Wrong reconciliation | Dual-ledger model, confirm with the owner (Q3), configurable per provider |
| R10 | **Low-end Android performance** with large IndexedDB | Slow POS | Indexed Dexie queries, 90-day document window, in-memory product search index (FlexSearch) built in a web worker, virtualized lists |
| R11 | **Clock skew / wrong device dates** | Sales on wrong day | Server offset correction, skew warnings |
| R12 | **AI cost and hallucination** | Wrong numbers to the owner | Tool-calling only over typed, tenant-scoped functions; answers must cite tool results; "no data" rule; per-tenant monthly AI quota tied to plan |
| R13 | **FBR / tax compliance** for larger retailers | Some prospects can't use it | Tax fields in the schema; FBR POS integration as a later module |
| R14 | **Local dev environment** (no MySQL or pnpm on this PC today; XAMPP folder has no database) | Blocks Phase 2 | Step 2 installs MySQL 8.4 LTS (no-install ZIP, runs as a normal process) + pnpm; no Docker needed |
| R15 | **Support load** from many small shops | Operator burnout | Good empty/error states, in-app help, sample data, remote Sync Center diagnostics |

## 3. Recommended MVP (Al Noor Mart pilot)

Goal: an owner can **sell, buy, pay, collect, reconcile and see real profit**, online or offline, on 1–2 devices.

**In the MVP (Phases 2–5):**
- Single tenant (multi-tenant architecture fully in place), single branch, 1–3 devices
- Auth, roles (5 templates, no custom roles), PIN switching, device registration
- Minimal Super Admin: create tenant, assign plan, suspend, extend (billing manual)
- Products, units + conversions (carton ↔ packet), categories, brands, barcodes, CSV import
- Inventory ledger, opening stock, adjustments (damage/expiry/correction), stock view
- POS: search, favourites, quick buttons, keyboard-wedge barcode support, discounts, split payment, credit sale, hold/resume, returns, void, 80 mm/58 mm receipts
- Customers + udhaar ledger + payments + printable statement + WhatsApp share (`wa.me` link)
- Suppliers + ledger, purchases (cash/credit), partial receive, supplier payments, purchase returns
- Payment accounts (cash, bank, Easypaisa, JazzCash) with separate balances; transfers
- Expenses (categories, attachment photo), owner drawings
- Daily cash closing with discrepancy explanation
- Easypaisa + JazzCash retailer module: transactions, commission rules, dual-ledger reconciliation
- Owner dashboard v1 (today's sales, gross/net profit, cash/bank/wallet balances, receivables, payables, inventory value) + basic alerts (low stock by min level, overdue customers, cash discrepancy)
- Reports: sales (day/month/product/category/payment), P&L, stock valuation, receivables, payables, expenses, Easypaisa commission; CSV export
- Offline for all of the above + Sync Center v1
- English UI with Urdu product names on screen and receipts

**Right after the pilot (Phase 6):** smart reorder, supplier order planner, Generate Today's Orders, Action Center, Cash Flow Intelligence, Reinvestment Advisor. Six phases in, this becomes the product's main selling point.

## 4. Features to postpone

| Feature | Postponed to | Reason |
|---|---|---|
| Smart reorder / order planner | Phase 6 (right after pilot) | Needs 2–4 weeks of real sales history to be meaningful anyway |
| AI assistant | Phase 8 | Needs stable reports/tools underneath; runs on paid API calls |
| WhatsApp **API** provider | Phase 8 | `wa.me` share links cover MVP needs at zero cost |
| Full Urdu UI + RTL | Phase 8 | Strings go through i18n from day one, so translation is additive |
| Payment gateway for SaaS billing | Phase 9 | Manual bank transfer approval is enough for early tenants |
| Multi-branch transfers + consolidation | Phase 9 | Schema supports it now; UI later |
| Custom roles | Phase 9 | 5 templates cover real shops |
| Batch/expiry tracking | Phase 6 | Optional per product; most karyana items don't need it at first |
| Camera barcode scanning, Bluetooth scanner | Post-launch | Keyboard-wedge USB scanners work from Phase 3 |
| ESC/POS direct printing | Post-launch | Browser print first |
| Stock counts (full cycle) | Phase 6 | Adjustments cover MVP |
| Mobile load / bill payment | Phase 5 (config only) | Same generic model, just configuration |
| Public API for Professional plan | Post-launch | Needs API keys, docs and versioning |
| FBR POS integration, native mobile apps, global product catalog | Post-launch | Not needed for the first shops |
| FIFO costing, full double-entry GL | Not planned | WAC + sub-ledgers meet the requirements; a GL can be derived later |

## 5. Exact implementation order

Each step is shipped with tests before the next begins.

**Phase 2: Foundation**
1. `git init`, pnpm + Turborepo monorepo, TS strict, ESLint (incl. no-raw-db rule), Prettier, Vitest, GitHub Actions CI
2. Native dev environment: MySQL 8.4 LTS (Windows ZIP, `utf8mb4`, UTC, binlog on), pnpm via corepack, `.env.example`; emails logged to console in dev, files stored on local disk
3. `packages/domain` basics: money, qty, units, UUIDv7/v5, permissions + features catalogs (unit tested)
4. `packages/db`: Drizzle setup; migrations for platform tables (plans, features, tenants, subscriptions, sync counters)
5. Identity tables + roles/permissions seed; **`tenantDb` scoped query wrapper** (fail-closed) + separate MySQL users for the app, the admin API and migrations
6. Fastify skeleton: config, pino, helmet, CORS, rate limit, problem+json errors, `/healthz`/`/readyz`, OpenAPI
7. Auth: login (argon2id), JWT EdDSA, refresh rotation + reuse detection, logout, `me`; device registration; tenant-context plugin (`tenantDb(ctx)`); permission/feature guards
8. **Tenant-isolation test harness** (two tenants, generic "every route" checker)
9. Admin API + admin app: login + TOTP, create tenant (creates branch, roles, accounts, settings defaults), plans CRUD, suspend/activate
10. Web app shell: router, layout, auth screens, i18n (en + ur scaffold), Tailwind/shadcn, PWA manifest + service worker (app-shell precache)
11. Dexie local DB + repositories + `useLiveQuery` patterns
12. **Sync core:** change-log writer (gap-free counter), `sync_mutations` idempotency, `/sync/push`, `/sync/pull`, `/sync/snapshot`; client engine (outbox, leader lock, backoff, connection badge), Sync Center v1
13. Catalog: units (system seed), categories, brands, products, product units, barcodes: server services + sync handlers + UI (list, form, search)
14. Inventory: movements + balances projection, opening stock, adjustments, stock screen; posting engine v1 (adjustment)
15. CSV import (products, opening stock) with validation preview + template download
16. Phase 2 verification: offline product edit on device A → visible on device B; isolation suite; migration down/up

**Phase 3: POS and Sales**
17. Financial accounts, payment methods, account transactions + balances projection
18. Posting engine: sale, sale return, void (shared, unit tested with fixtures)
19. POS UI: product grid/search (web-worker index), cart, units, qty, discounts, keyboard shortcuts, barcode-wedge listener
20. Payments: cash (change), split, credit (customer picker, limit check), receipt number series per device
21. Receipt templates + print (58/80 mm), reprint
22. Hold/resume/draft (local), cancel
23. Customers + customer ledger + customer payments + statement (print/PDF/WhatsApp link)
24. Cash sessions: open float, blind close, expected vs counted, explanation threshold, review
25. Suppliers + supplier products + supplier ledger
26. Purchases: receive (with/without PO), partial receive, WAC update, credit/cash; purchase returns; supplier payments + allocations
27. Phase 3 verification: full offline day simulation E2E; ledgers reconcile to the paisa

**Phase 4: Money and Profit**
28. Expense categories (seed), expenses + receipt photo upload, recurring expenses, void
29. Owner drawings/injections, account transfers
30. Reporting queries (P&L, sales breakdowns, stock valuation, receivables/payables aging, expenses) + CSV/PDF export
31. Owner dashboard v1 + basic alerts (min stock, overdue, cash discrepancy)

**Phase 5: Retailer services**
32. Provider templates seed; providers, txn types, commission rules (slabs) + preview calculator
33. Posting engine: retailer transactions (float + cash legs, fee, commission accrual), reversals
34. Retailer transaction entry screen (fast, POS-like), dashboard, daily reconciliation (float + cash), commission received
35. Retailer reports → **Al Noor Mart pilot go-live checklist**

**Phase 6 onward** follows the phase table above: stats job → reorder engine → planner/Today's Orders → analytics → expiry → Action Center → cash-flow intelligence → reinvestment advisor; then Phases 7–10.
