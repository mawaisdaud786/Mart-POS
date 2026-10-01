# 04 — API Structure and Folder Structure

## 1. API structure

- Base URLs: `https://api.<domain>/api/v1` (tenant) · `https://api.<domain>/admin/v1` (platform admin, separate JWT audience)
- JSON, Zod-validated, OpenAPI 3.1 generated at `/api/docs` (disabled in production unless the admin is authenticated)
- Auth: `Authorization: Bearer <access>`, plus `X-Device-Id` on device-bound calls
- Tenant is **never** a path/query/body parameter; it comes from the token
- Lists: cursor pagination `?cursor=&limit=`, `?q=` search, `?branchId=` filter (validated against membership)
- Errors: RFC 9457 problem+json `{type, title, status, code, detail, errors[]}` with stable `code` values (e.g. `PLAN_LIMIT_USERS`, `PERMISSION_DENIED`)
- Idempotency: every create accepts a client `id` (UUIDv7); a repeat `POST` with the same id returns the existing resource
- **Offline-capable writes go through `/sync/push`.** REST create endpoints exist for the same documents (used by admin tools, imports and future integrations) and call the *same* application service.

### Tenant API (`/api/v1`)

| Module | Endpoints |
|---|---|
| **auth** | `POST /auth/login` · `POST /auth/refresh` · `POST /auth/logout` · `POST /auth/switch-tenant` · `POST /auth/pin-unlock` · `POST /auth/password/forgot` · `POST /auth/password/reset` · `GET /auth/me` |
| **devices** | `POST /devices/register` · `GET /devices` · `POST /devices/:id/revoke` |
| **sync** | `POST /sync/push` · `GET /sync/pull?cursor=` · `GET /sync/snapshot?branchId=` · `GET /sync/status` · `GET /sync/entitlements` |
| **onboarding** | `GET /onboarding` · `PATCH /onboarding/:step` · `POST /onboarding/sample-data` · `DELETE /onboarding/sample-data` |
| **org** | `GET/PATCH /profile` (branding) · `POST /profile/logo` · `CRUD /branches` · `GET/PUT /settings` |
| **users** | `CRUD /members` (invite, role, branches, disable) · `POST /members/:id/reset-pin` · `CRUD /roles` · `GET /permissions` |
| **catalog** | `CRUD /products` · `GET /products/lookup?barcode=` · `CRUD /products/:id/units` · `CRUD /products/:id/barcodes` · `GET /products/:id/price-history` · `CRUD /categories` · `CRUD /brands` · `GET/POST /units` |
| **inventory** | `GET /inventory` (balances) · `GET /inventory/:productId/movements` · `POST /stock-adjustments` · `CRUD /stock-counts` · `POST /stock-counts/:id/complete` · `CRUD /stock-transfers` · `GET /batches?expiringWithin=` |
| **customers** | `CRUD /customers` · `GET /customers/:id/ledger` · `GET /customers/:id/statement?from=&to=&format=pdf` · `POST /customer-payments` · `GET /receivables/aging` |
| **suppliers** | `CRUD /suppliers` · `CRUD /suppliers/:id/products` · `GET /suppliers/:id/ledger` · `POST /supplier-payments` · `GET /payables/aging` |
| **sales** | `GET /sales` · `GET /sales/:id` · `POST /sales` · `POST /sales/:id/void` · `POST /sale-returns` · `GET /sales/:id/receipt` · `CRUD /cash-sessions` · `POST /cash-sessions/:id/close` |
| **purchasing** | `CRUD /purchase-orders` · `POST /purchase-orders/:id/order` · `/cancel` · `GET /purchase-orders/:id/share` (WhatsApp text/PDF) · `POST /purchases` (receive, incl. partial vs PO) · `POST /purchase-returns` |
| **reorder** | `GET /reorder/recommendations?supplierId=` · `GET /reorder/todays-orders` · `POST /reorder/todays-orders/create-pos` |
| **accounts** | `CRUD /financial-accounts` · `GET /financial-accounts/:id/transactions` · `CRUD /payment-methods` · `POST /account-transfers` · `POST /owner-transactions` |
| **expenses** | `CRUD /expense-categories` · `GET/POST /expenses` · `POST /expenses/:id/void` · `CRUD /recurring-expenses` · `POST /attachments` (presigned upload) |
| **retailer** | `CRUD /service-providers` · `CRUD /service-providers/:id/txn-types` · `CRUD /commission-rules` · `POST /commission-rules/preview` · `GET/POST /retailer-transactions` · `POST /retailer-transactions/:id/reverse` · `GET /retailer/dashboard?providerId=&date=` · `POST /retailer-reconciliations` · `POST /commissions/received` |
| **dashboard** | `GET /dashboard/summary?date=&branchId=` · `GET /action-center` · `GET /cash-flow?from=&to=` · `GET /reinvest?amount=` |
| **alerts** | `GET /alerts` · `POST /alerts/:id/acknowledge` · `/snooze` · `/resolve` |
| **notifications** | `GET /notifications` · `POST /notifications/read` · `GET/PUT /notification-preferences` · `POST /push-subscriptions` |
| **reports** | `GET /reports/sales` (group by day/week/month/product/category/staff/payment-method) · `/reports/profit` · `/reports/product-margin` · `/reports/inventory` (stock/low/out/fast/slow/dead/expiring/valuation) · `/reports/cash-flow` · `/reports/expenses` · `/reports/receivables` · `/reports/payables` · `/reports/owner-drawings` · `/reports/retailer` · `/reports/product-analytics` — all accept `format=json|csv|pdf` |
| **import/export** | `GET /imports/templates/:kind` · `POST /imports` (upload) · `GET /imports/:id` (validation results) · `POST /imports/:id/commit` · `POST /exports` · `GET /exports/:id` |
| **integrations** | `GET/PUT /integrations/:kind` · `POST /integrations/:kind/test` · `POST /messages/whatsapp` (queue) |
| **ai** | `POST /ai/conversations` · `POST /ai/conversations/:id/messages` (SSE stream) · `GET /ai/conversations` |
| **audit** | `GET /audit-logs?entity=&user=&from=&to=` |
| **billing (tenant view)** | `GET /subscription` · `GET /billing/invoices` · `POST /billing/invoices/:id/payment-proof` |

### Admin API (`/admin/v1`)

| Area | Endpoints |
|---|---|
| auth | `POST /auth/login` (+ TOTP) · `POST /auth/refresh` · `POST /auth/logout` |
| dashboard | `GET /metrics` (total/active/trial/expired tenants, MRR, ARR, new signups, churn, active users, storage, sync health) |
| tenants | `GET /tenants` · `POST /tenants` · `GET/PATCH /tenants/:id` · `POST /tenants/:id/suspend` · `/activate` · `/archive` · `GET /tenants/:id/usage` (users, devices, storage, last sync) |
| subscriptions | `GET /tenants/:id/subscription` · `POST …/change-plan` · `POST …/extend` · `POST …/start-trial` · `PATCH …/overrides` |
| plans | `CRUD /plans` · `CRUD /features` |
| billing | `GET /invoices` · `POST /invoices/:id/mark-paid` · `POST /invoices/:id/void` |
| access | `POST /tenants/:id/access-grants` (break-glass, reason required) · `DELETE /access-grants/:id` |
| system | `GET /health/details` · `GET /jobs` (queue stats) · `GET /audit-logs` · `GET/PUT /platform-settings` |

### Request pipeline (Fastify hooks, in order)

`requestId → rateLimit → authenticate(JWT) → loadMembership(cache) → checkSubscription(status/read-only) → checkDevice → tenantDb(ctx) (tenant-scoped query layer + DB transaction) → requirePermission/requireFeature (route config) → zod validate → handler → audit (if the route is marked auditable) → problem+json error mapper`

---

## 2. Folder structure

```text
retailos/
├── apps/
│   ├── web/                          # Tenant PWA (POS + back office)
│   │   ├── public/                   # icons, manifest assets, fonts (Noto Nastaliq Urdu, Inter)
│   │   ├── src/
│   │   │   ├── app/                  # router, providers, layout shell, error boundaries
│   │   │   ├── features/             # one folder per module (screens + hooks + components)
│   │   │   │   ├── auth/  onboarding/  dashboard/  action-center/
│   │   │   │   ├── pos/              # cart, product grid, search, barcode-wedge listener, payments, receipt
│   │   │   │   ├── products/  inventory/  customers/  suppliers/
│   │   │   │   ├── purchasing/  reorder/  expenses/  accounts/  cash-closing/
│   │   │   │   ├── retailer/         # Easypaisa/JazzCash/load dashboards, txn entry, reconciliation
│   │   │   │   ├── reports/  alerts/  notifications/  ai/  settings/  users/
│   │   │   │   └── sync-center/
│   │   │   ├── local-db/             # Dexie schema, migrations, repositories, projections
│   │   │   ├── sync/                 # engine, leader lock, push/pull, backoff, connection state
│   │   │   ├── printing/             # receipt templates (58/80 mm), print adapters (browser, ESC/POS later)
│   │   │   ├── i18n/                 # setup; strings live in packages/i18n
│   │   │   ├── sw.ts                 # service worker (Workbox injectManifest)
│   │   │   └── main.tsx
│   │   └── vite.config.ts
│   ├── admin/                        # Super Admin SPA (online-only)
│   │   └── src/features/{dashboard,tenants,plans,billing,access,system}
│   ├── api/                          # Fastify API
│   │   ├── src/
│   │   │   ├── server.ts  app.ts  config.ts
│   │   │   ├── plugins/              # auth, tenant-context, rbac, rate-limit, helmet, cors, errors, audit, openapi
│   │   │   ├── modules/              # <module>/{routes.ts, service.ts, repo.ts, schemas.ts, *.test.ts}
│   │   │   │   ├── auth/ devices/ org/ users/ catalog/ inventory/ customers/ suppliers/
│   │   │   │   ├── sales/ purchasing/ reorder/ accounts/ expenses/ retailer/
│   │   │   │   ├── dashboard/ reports/ alerts/ notifications/ imports/ exports/ integrations/ ai/ audit/
│   │   │   │   ├── sync/             # push handler → dispatch to module services, pull, snapshot
│   │   │   │   └── admin/            # admin-only routes (separate plugin scope + audience)
│   │   │   └── lib/                  # db (tenant tx), crypto, storage (S3), mailer, events bus
│   │   └── test/                     # integration tests (local MySQL test DB), tenant-isolation suite
│   └── worker/                       # job runner (MySQL job table)
│       └── src/jobs/{daily-stats,alerts-scan,reorder-cache,report-snapshots,notifications,
│                    message-outbox,imports,exports,subscription-lifecycle,backup-verify,changelog-prune}
├── packages/
│   ├── domain/                       # ★ shared by web + api: pure TS, no I/O
│   │   ├── money.ts  qty.ts  units.ts  ids.ts (uuidv7/uuidv5)
│   │   ├── posting/                  # sale, return, purchase, payment, expense, transfer, retailer → postings
│   │   ├── costing/                  # WAC
│   │   ├── pricing/                  # discounts, tiers, rounding, tax
│   │   ├── reorder/                  # ADS, ROP, recommended qty, case rounding
│   │   ├── commission/               # rule matching + fee/commission calc
│   │   ├── finance/                  # P&L, cash flow, reinvestment
│   │   └── permissions.ts  features.ts
│   ├── schemas/                      # Zod schemas for API + sync payloads (shared)
│   ├── db/                           # Drizzle schema (MySQL), migrations, tenantDb wrapper, seeds (system data, demo tenant)
│   ├── sync-protocol/                # push/pull types, error codes, versioning
│   ├── i18n/                         # en.json, ur.json (namespaced per module)
│   ├── ui/                           # shared shadcn components, tokens, RTL-aware primitives
│   └── config/                       # tsconfig, eslint (incl. no-raw-db rule), tailwind preset
├── infra/
│   ├── deploy/                       # PM2 ecosystem file, server setup script (Docker files optional, later)
│   ├── caddy/Caddyfile               # app., admin., api. vhosts + HTTPS
│   ├── backup/                       # mysqldump + binlog shipping scripts, restore scripts, tenant-extract script
│   └── scripts/                      # migrate, seed, create-admin
├── e2e/                              # Playwright: POS flows, offline simulation, multi-device sync
├── docs/                             # this spec, ADRs, runbooks
├── .github/workflows/                # ci.yml, release.yml
├── package.json  pnpm-workspace.yaml  turbo.json  .env.example
```

**Rule:** anything that calculates money, stock, cost, commission, reorder or profit lives in `packages/domain` and has unit tests there. Apps only orchestrate.
