# Staging validation (SoftonHost cPanel / CloudLinux / Passenger)

Goal: prove this exact build works on the real host **before** production. Use a separate subdomain pair
(for example `staging-api.example.com` + `staging-shop.example.com`, same main domain) and a **separate empty
database**. Never point staging at production data; `reports-http-check.mjs` and the parity tests write test data.

## A. What the app requires (from `deployment-cpanel.md`, `package-cpanel.mjs`, `config.ts`)

| Requirement | Detail | Verified where |
|---|---|---|
| Node.js | 20 or newer (bundle target `node20`); tested locally on 24 only | `node -v` in cPanel Terminal |
| Passenger entry | `app.cjs` (CommonJS shim that `import()`s `server.js`); app root outside public folders | Setup Node.js App |
| Native module | `@node-rs/argon2` installed on the server by *Run NPM Install* (CloudLinux CageFS must allow it) | `node -e "require('@node-rs/argon2')"` |
| Database | MySQL 8.0+ or **MariaDB 10.6+** (reports use `JSON_TABLE` with `NESTED PATH`, `FOR ORDINALITY`, column charset/collation, `CAST(.. AS BINARY)`) | `node cli.js doctor` ("Report queries (JSON_TABLE) work") + parity tests |
| DB user | Not `root`; ALL PRIVILEGES on its own database only | doctor / config |
| Env vars | `NODE_ENV=production`, `DATABASE_URL`, `JWT_PRIVATE_KEY`, `APP_ENCRYPTION_KEY`, `CORS_ORIGINS` (https, exact origin); `TRUST_PROXY` unset (=1) | doctor |
| HTTPS | AutoSSL on both hosts; cookie `SameSite=Strict` needs same main domain | security-check |
| Web | static files + `.htaccess` (hidden) | security-check (WEB section) |
| Filesystem | App folder writable by the cPanel user (logs); `KEYS_DIR` not needed in production (keys from env) | `ls -la`, app log |

## B. Previously recorded local checks (historical; not rerun for every checkout)

An earlier local validation record reports checks on MySQL 8.4 / Node 24 / Windows: package typechecks, 137 unit tests, report parity 58/58, HTTP report checks 40/40, smoke checks 100/100, the security check, production bundles, doctor including the `JSON_TABLE` probe, and a clean production dependency audit. It also records doctor/parity/HTTP/smoke/security checks on MariaDB 10.6.28 and 11.8.9.

These are historical results, not evidence that a later working tree or the target cPanel host passed. For the exact current checkout, see [`deployment-audit-2026-10-07.md`](./deployment-audit-2026-10-07.md); its audit run passed direct package builds/tests, but the API database-backed tests were skipped because a verified disposable `REPORTS_TEST_URL` was not available. Re-run the complete checks below against the pinned release candidate and a separate throwaway database before deployment.

**Not done (needs your host):** Node 20/22, CloudLinux CageFS, Passenger restart/idle behaviour, real HTTPS/proxy hops,
memory/connection-pool behaviour under the host's limits.

## C. Commands (run in cPanel > Terminal, inside the staging API folder, after the `source .../activate` line)

```bash
node -v                                   # must be >= 20
node cli.js doctor                        # every line must be OK; "Report queries (JSON_TABLE) work" is the key one
mysql -V                                  # (if available) exact server engine/version
node -e "require('@node-rs/argon2'); console.log('argon2 ok')"
node cli.js migrate
node cli.js create-admin --email you@example.com --name "Staging Admin"
node cli.js create-tenant --name "Staging Mart" --slug staging-mart --owner-name "Owner" --owner-email owner@staging.test
node cli.js create-tenant --name "Other Mart" --slug other-mart --owner-name "Other" --owner-email other@staging.test
node cli.js doctor                        # again: "All checks passed"
```

`doctor` prints the exact database version (`Database connected: ...`); record it.

## D. Checks from your own computer (nothing but staging URLs)

```bash
node apps/api/scripts/security-check.mjs --api https://staging-api.example.com --web https://staging-shop.example.com

OWNER=owner@staging.test OWNER_PW='...' OTHER=other@staging.test OTHER_PW='...' \
API=https://staging-api.example.com/api/v1 node apps/api/scripts/reports-http-check.mjs
```

Expect `All checks passed` and `40/40 checks passed`. (The report check creates a manager, a cashier, 2 products and 3 bills in
the *first* shop; use a fresh staging shop.)

## E. Parity tests against the staging database

The parity test drops/recreates the table `shop_records` in the database it is pointed at. **Use a different, empty database**
(create `cpuser_staging_parity` in cPanel > MySQL Databases and add the user to it). Allow your IP under *Remote MySQL*, then remove
the entry afterwards. Never use the staging app's own database or any production database.

```bash
# on your computer, from the repo root
REPORTS_TEST_URL='mysql://cpuser_user:PASSWORD@YOUR_SERVER:3306/cpuser_staging_parity' pnpm --filter @retailos/api test:db
```
Expected: `58 passed`. A failure names the report and the numbers that differ.

Alternative with no Remote MySQL: run the same on the server (needs the repo + pnpm there; usually not worth it).

## F. Manual functional pass on staging (tick each)

Login/logout; refresh keeps session; wrong password lockout; owner, manager, cashier see only their menus.
Staff: add, change role, reset password, disable. POS sale (cash, udhaar, split); return; cancel. Purchase + pay supplier.
Expense and owner withdrawal; money transfer; cash closing (cashier blind). Khata receive payment. Easypaisa/JazzCash txn.
Inventory reorder list; products import. Backup download and restore (on staging only).

## G. Report validation matrix (compare screen vs. figures you computed by hand)

| Report | How to check |
|---|---|
| Profit / products / top products | Known bills: sales, returns, cost; compare Reports page and Dashboard |
| Daily sales / sales summary | Bills at 23:59 and 00:01 local; cancelled bill excluded; cashier sees only own |
| Sales velocity | POS grid order after sales of different products |
| Expenses / purchases / cash breakdown / services | One entry each at month start and end |
| Khata | Customer over limit appears in Dashboard alert; supplier due |
| Reorder | Product with recent sales and low stock shows "Order now"; check date vs. shop's today |
| Boundaries | Today, yesterday, month first/last day, last-month, a year, a range with nothing |
| Time zone | Browser in Pakistan time vs. server in UTC: "today" must be the shop's day |
| Isolation | Other shop's owner sees zero; cashier gets 403 on profit |

## H. Resilience

Restart from cPanel > Setup Node.js App (Restart); then reload and check Dashboard + a report.
Leave idle 30+ minutes (Passenger may idle-stop), then reload: first request may be slow but must succeed and sign-in must persist
(refresh cookie). Briefly stop/start the database if the host allows and confirm the API recovers without a manual restart
(`/readyz` returns 200 again).

## I. Logs to read and what to look for

cPanel > Setup Node.js App > log path (and `~/logs/`, `stderr.log`): `ER_` database errors, `JSON_TABLE`/syntax errors,
`Unsafe production configuration`, `Too many connections`, `ECONNRESET`, out-of-memory kills (CloudLinux LVE limits: *Resource Usage*
in cPanel), Passenger "App process terminated".

## J. Decision rule

GO only if: doctor all OK on the staging host, parity 58/58 on the host's engine, HTTP report check 40/40, security-check passes,
manual pass has no failures, restart/idle tests pass, logs show no SQL/Passenger/memory errors.
