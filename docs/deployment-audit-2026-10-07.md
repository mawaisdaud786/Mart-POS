# Al Noor Mart / RetailOS — Project and deployment audit

**Audit date:** 2026-10-07

**Scope:** Whole repository, deployment documentation/tooling, current local build/typecheck/test/lint results, and release readiness.

**Verdict:** **Not cleared for production release yet.** The cPanel web/API path is documented and both applications build individually, but the current checkout is not a reproducible release candidate and the target-host staging gate remains outstanding. **The Windows desktop release is a no-go** until its startup/API configuration is corrected and tested.

This is a deployment-readiness review, not a penetration test or a verification of the live hosting account. No secrets or values from local environment files are reproduced here.

## 1. Project overview

RetailOS is a pnpm/Turborepo monorepo for Al Noor Mart:

| Part | Location | Purpose |
|---|---|---|
| Shop web application | [`apps/web`](../apps/web/) | React 19/Vite SPA for owner, manager, cashier, and shop staff. |
| API | [`apps/api`](../apps/api/) | Fastify/Node API for authentication, tenant-scoped shop data, reports, staff, and administration. |
| Database package | [`packages/db`](../packages/db/) | Drizzle/MySQL schema, migrations, and tenant database access. |
| Domain package | [`packages/domain`](../packages/domain/) | Shared pricing, quantities, reorder rules, and other business logic. |
| Contracts package | [`packages/contracts`](../packages/contracts/) | Shared request/data validation and types. |
| Windows desktop shell | [`apps/desktop`](../apps/desktop/) | Electron wrapper that starts the API and loads the web UI. This is a separate deployment target from cPanel. |

The documented hosted design is a static web app on a shop hostname plus a Node API on an API hostname, backed by MySQL 8+ or MariaDB 10.6+. cPanel packaging helpers generate web and API upload folders; the API runs outside the public document root. See [`deployment-cpanel.md`](./deployment-cpanel.md) and the [step-by-step cPanel guide](./deployment-guide-cpanel-step-by-step.md).

### Current application screens and features

| Screen | Main capabilities |
|---|---|
| Sign in / first-time setup | Shop account sign-in, tenant selection when applicable, and initial shop profile/opening cash setup. |
| Dashboard | Sales/profit/cash summaries, balances, weekly sales and product graphs, stock/price warnings, owner alerts, and business questions. |
| POS / Sale | Product search and cart, quantities and amount-based sale entry, customer/credit checkout, keyboard shortcuts, and Noor voice assistant workflows. |
| Sales & Returns | Search/filter bills, inspect/reprint receipts, return sale items, and void/cancel where permitted. |
| Products | Catalog, categories, stock/prices/costs, product import/export, voice keywords, and product management tools. |
| Stock & Reorder | Stock position, suggested supplier orders, stock warnings, slow-moving items, and overstock review. |
| Customers (Udhaar / Khata) | Customer records, balances, payments, credit limits, shopkeeper pricing, and customer account history. |
| Suppliers & Purchases | Supplier records, purchases/receiving stock, payable balances, and supplier payments/account history. |
| Expenses | Shop expenses and owner withdrawals with categories, accounts, dates, and notes. |
| Easypaisa / JazzCash | Retailer cash-in/cash-out and related service transactions, fees, balances, and transaction history. |
| Cash & Closing | Account balances and transfers, daily cash count/closing, differences, and account movements. |
| Reports & insights | Sales, gross/net profit, expenses, products, payment breakdowns, stock/reorder, and cash-flow comparisons. |
| Settings | Shop/team/accounts, permissions, backup and restore, service-fee rules, POS shortcuts, voice keywords/logs, product pairs, and shop thresholds. |

The `/ghar-se-ghar-tak` route currently redirects to POS rather than opening a separate delivery screen. The deployment guide also confirms there is **no super-admin web UI**; platform administration is API/CLI-only. Confirm these are intentional product-scope decisions before advertising them as separate screens.

## 2. Audit findings

Severity labels are deployment priorities: **P1 = must resolve before the relevant release; P2 = resolve before broad production use or track as an explicit operational limitation.**

| Priority | Finding | Evidence / impact | Recommended action |
|---|---|---|---|
| **P1 — Desktop** | Desktop API startup configuration is inconsistent with production validation. | [`main.js`](../apps/desktop/main.js) starts the API with `NODE_ENV=production` and localhost HTTP CORS origins. [`config.ts`](../apps/api/src/config.ts) rejects HTTP and localhost production origins, so the backend is expected to exit at startup. Separately, the web client defaults to `/api/v1`, while Electron loads the UI from a local file and the desktop build does not configure an API base URL. | Define a supported desktop-only origin/API-base configuration, keep production validation meaningful, and verify a packaged installer can start the API and complete login/data requests end-to-end. |
| **P1 — Desktop security** | Electron relaxes renderer security. | [`main.js`](../apps/desktop/main.js) sets `webSecurity: false` and `sandbox: false`. The renderer does have context isolation and Node integration disabled, but disabling web security weakens origin protections and should not ship without a narrowly justified, tested requirement. | Remove `webSecurity: false`; enable renderer sandbox where compatible; document and test the minimal required privileges and external navigation policy. |
| **P1 — Release reproducibility** | The checkout is not a pinned/reviewed release candidate. | At audit time, before this report was added, `git status` showed **149 changed, deleted, or untracked entries** on `main`; the deployment guide’s older change count is stale. A release built from this checkout may differ from the committed repository. | Decide the exact intended release contents, review secrets/imports/generated assets, commit and push the intended source, then build from that immutable revision. Do not deploy an unreviewed working tree. |
| **P1 — Hosting validation** | The real cPanel/Passenger target has not passed the documented staging gate. | [`deployment-cpanel.md`](./deployment-cpanel.md) says the host itself has not been tested; [`staging-validation.md`](./staging-validation.md) lists target Node/CloudLinux/CageFS, proxy/HTTPS, Passenger restart/idle, and host database verification as outstanding. Local builds cannot prove these hosting behaviors. | Use a separate staging domain and empty database; complete the doctor, native Argon2, SQL parity, HTTP/security, manual workflow, backup/restore, restart/idle, and log checks before production. |
| **P1 — DB integration tests** | Real-database report integration coverage was not executed in this audit. | Current API test run passed 65 tests and skipped 60 DB-backed checks. The parity suite requires `REPORTS_TEST_URL`; that variable was absent. The parity suite writes/recreates test data and must only target an explicitly disposable database. | Provision a dedicated disposable MySQL/MariaDB database distinct from both production and normal staging, then run the documented parity suite and retain its output. |
| **P2 — Root automation** | The repository-wide Turbo commands did not run in this Windows environment. | `pnpm build`, `pnpm test`, and `pnpm typecheck` all stopped with Turbo’s “Unable to find package manager binary: cannot find binary path”. Individual package build/typecheck/test commands succeeded where available, but the root commands prescribed by the deployment guide are not currently demonstrated here. | Fix/standardize package-manager discovery for Turbo on supported developer/CI environments, and make the exact root release commands a required CI gate. |
| **P2 — Lint / CI** | Linting and automated release gates are missing. | `pnpm lint` fails because ESLint 10 cannot find an `eslint.config.*`; no `.github/workflows` directory was present at audit time. | Add/validate a flat ESLint configuration and CI for frozen install, lint, typecheck, tests, production builds, and cPanel package checks. |
| **P2 — Runtime matrix** | The deployment Node requirements differ and have not been verified on the minimum host version. | Root declares Node `>=22`; cPanel docs and generated API package permit Node `>=20` and the bundle targets Node 20. Local runtime was Node 24.19.0. Documentation says cPanel/Node 20/22 and Passenger behavior remain untested. | Pick and state the supported production Node versions; run package/build/doctor/host checks on the minimum supported version and the actual target’s Node release. |
| **P2 — Online-only operation** | Shop transactions depend on API/network availability. | Current [`store.ts`](../apps/web/src/lib/store.ts) reads/writes through the API; [`security.md`](./security.md) explicitly states the shop cannot sell while internet/server is unavailable. This appears intentional, not an implementation defect, but it is a material trading dependency. | Before go-live, provide reliable primary connectivity and a tested backup connection/recovery procedure, or plan and test offline sales as a separate feature. |
| **P2 — Recovery evidence** | Backup/restore is documented, but a successful target-host restore drill was not established. | [`security.md`](./security.md) calls for scheduled backups and an actual restore test; [`deployment-cpanel.md`](./deployment-cpanel.md) recommends database backups and protecting the signing/encryption keys. | Define retention and off-host copies, record RPO/RTO, and prove a database-plus-key recovery on staging before production. |
| **P2 — Documentation drift** | Operational docs describe incompatible storage models. | [`local-shop-safety.md`](./local-shop-safety.md) says live data is Dexie/IndexedDB and recommends browser-local restore steps; current [`store.ts`](../apps/web/src/lib/store.ts) and [`security.md`](./security.md) describe server/MySQL as the source of shop data. Phase-1 documents are architecture/roadmap material, not current implementation evidence. | Mark old docs as historical or rewrite them to match the server-backed release. Keep one authoritative backup, restore, and offline-behavior guide. |
| **P2 — Product scope** | Some capabilities are API/CLI-only or not standalone screens. | There is no super-admin web app; `/ghar-se-ghar-tak` redirects to POS. | Confirm these scope boundaries with the owner and label roadmap-only functionality clearly in user/deployment documentation. |

## 3. Positive controls and existing deployment assets

- Production API configuration requires signing/encryption keys, enforces HTTPS-only CORS origins and secure cookies, and rejects a MySQL root account. See [`config.ts`](../apps/api/src/config.ts).
- API setup includes Fastify security headers, request validation, rate limits, no-store responses, redacted sensitive logs, `/healthz`, and database-aware `/readyz`. See [`app.ts`](../apps/api/src/app.ts).
- Tenant authorization and tenant-scoped database access are implemented server-side; see [`auth plugin`](../apps/api/src/plugins/auth.ts) and [`tenant database`](../packages/db/src/tenant-db.ts).
- API CLI/doctor and migrations exist; cPanel packaging produces a Passenger entry shim, bundles, dependencies, migrations, and an environment template. See [`cli.ts`](../apps/api/src/cli.ts) and [`package-cpanel.mjs`](../apps/api/scripts/package-cpanel.mjs).
- Web packaging generates a static Vite bundle and `.htaccess` with SPA rewrite, HTTPS redirect, CSP, and security headers. See [`package-cpanel.mjs`](../apps/web/scripts/package-cpanel.mjs) and [`htaccess.template`](../apps/web/deploy/htaccess.template).
- `pnpm audit --prod` reported no known production dependency vulnerabilities on the audit date. This is a point-in-time package advisory check, not a penetration test.
- `.env`, storage, and generated cPanel folders are ignored by Git. The `apps.zip` archive was checked for sensitive-looking **filenames only**; its contents were not extracted or inspected.

## 4. Verification performed for this report

Environment: Windows, Node **24.19.0**, pnpm **10.34.5**.

| Check | Result |
|---|---|
| Web production build (`apps/web`) | **Pass** — TypeScript check and Vite build. |
| API production bundle (`apps/api`) | **Pass** — esbuild output generated. |
| Web tests | **Pass** — 101 tests across 11 files. |
| API tests | **Partial pass** — 65 passed; 60 database-backed tests skipped; 3 test files passed and 1 was skipped. |
| Contracts typecheck/tests | **Pass** — typecheck succeeded; 8 tests passed. |
| Domain typecheck/tests | **Pass** — typecheck succeeded; 49 tests passed. |
| Database package typecheck | **Pass**. Its package test command found no tests. |
| API direct TypeScript check | **Pass**. |
| `pnpm audit --prod` | **Pass** — no known vulnerabilities reported. |
| Root `pnpm build`, `pnpm test`, `pnpm typecheck` | **Blocked in this environment** by Turbo failing to locate the package manager binary. |
| `pnpm lint` | **Fail** — missing ESLint flat config. |
| Target-host/cPanel checks | **Not run** — requires access to the chosen staging host and its disposable database. |
| Desktop installer/runtime | **Not run** — static configuration conflicts above must be resolved first. |

There are **223 passing unit tests across the directly run web/API/contracts/domain suites**, in addition to the 60 skipped API database checks. Do not interpret that as a complete production gate while DB parity and target-host tests remain outstanding.

## 5. Required remaining deployment work

### Before a cPanel web/API production release

1. Review the current worktree and choose the exact source revision; exclude `.env`, `storage/`, local databases, personal imports, and generated bundles unless a release artifact explicitly needs them.
2. Repair root Turbo command discovery and add a valid ESLint flat config; require root lint/typecheck/test/build to pass on CI.
3. Build both cPanel bundles from the pinned revision using the intended API origin; inspect the generated web CSP and hidden `.htaccess` before upload.
4. On a separate staging hostname pair and empty database:
   - Run `node cli.js doctor`; confirm HTTPS production config, MySQL 8+/MariaDB 10.6+, JSON_TABLE, migrations, and native Argon2.
   - Run report parity against a **separate disposable database**; do not use production or a database with shop data.
   - Run the external HTTP/security check against staging.
   - Validate owner/manager/cashier permissions, tenant isolation, POS sale/credit/split payment, returns/voids, purchases/supplier payments, expenses, cash transfer/closing, customer khata, mobile-money transactions, imports, voice, backup, and restore.
   - Test HTTPS cookies/CORS, proxy hops, API readiness, Passenger restart/idle wake-up, and database reconnect; inspect host logs and resource limits.
5. Perform a backup restore drill, document retention/off-host copy, and confirm the rollback method before opening the production domain.

### Before a Windows desktop distribution

1. Correct the production CORS/localhost conflict and explicitly configure the renderer’s API base URL.
2. Remove the `webSecurity: false` relaxation; harden the renderer sandbox/security settings.
3. Define the local database service lifecycle, first-run setup, credentials, migrations, data directory/permissions, backups, API readiness/restart, and user-facing recovery path.
4. Build and install a clean Windows package on a separate test machine/profile; prove startup, login, sales, upgrades, and uninstall/retained-data behavior.
5. Decide installer signing, update distribution, and crash/log collection before public distribution.

## 6. Improvement roadmap

**Release-blocking / near term**

- Make root verification reproducible and add CI as described above.
- Split deployment checks by target: cPanel web/API and Electron desktop have different runtime/config requirements.
- Use a documented release branch/tag and generate versioned, checksummed deploy bundles from that commit.
- Complete staging, tenant-isolation, database-parity, and restore drills before go-live.
- Reconcile current operational docs with the server-backed data model.

**Operational reliability**

- Add an explicit uptime/connectivity contingency because checkout is online-only.
- Define monitored health/readiness alerts, log retention, database connection limits, backup retention, RPO/RTO, and escalation/rollback owners.
- Validate timezone/date boundaries on the real host; keep the report’s date-range and service-fee checks in regression tests.

**Product/maintainability**

- Decide whether a distinct delivery workflow and super-admin web interface are required; currently they are not separate screens.
- Add browser-level smoke/E2E coverage for the critical cashier and owner journeys and for focused Dashboard drill-down links.
- Establish a supported Node/database matrix and rerun package tests at the minimum versions used for production.

## 7. Final decision

**cPanel web/API:** Conditionally viable architecture, but **not production-approved** until the source revision is pinned, root release checks are reliable, DB-backed tests are run safely, and the documented staging gate passes on the actual host.

**Windows desktop:** **No-go** until its API startup and local-file API routing are corrected, renderer security is hardened, and a clean packaged runtime test passes.

No production deployment was performed as part of this audit.
