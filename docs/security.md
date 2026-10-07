# RetailOS security

What protects the system, what was fixed, and what is **not** covered. Read the last section before going live.

## Where the data lives

**Everything is on the shop server, in MySQL. The browser stores nothing**: no localStorage, no sessionStorage, no IndexedDB. The only thing a browser keeps is the sign-in cookie, which is HttpOnly (scripts cannot read it). The short-lived access token lives in page memory and disappears when the tab closes.

The shop's records (products, stock movements, sales, ledgers, settings …) are rows in `shop_records`, one per record, always tied to one shop (`tenant_id`). Every read and write goes through a layer that adds the shop to every query, so one shop can never reach another's records.

## How it is protected

| Area | What is in place | Where |
|---|---|---|
| **Passwords** | Argon2id hashing. At least 10 characters; common passwords, sequences (including wrapping ones like `12345678901`), repeated blocks and passwords containing the person's own email/mobile/name are refused. Maximum 200 characters so a huge "password" cannot burn CPU | `packages/contracts/src/password.ts` |
| **Sign-in** | Email or mobile + password. The same message for "no such user" and "wrong password", and a dummy hash is checked for unknown users, so timing does not reveal which accounts exist. 5 wrong passwords lock the account for 15 minutes, counted per account from any address | `auth/routes.ts` |
| **Sessions** | 15-minute Ed25519-signed access token (algorithm pinned, issuer and audience checked) in memory only. Refresh token in an **HttpOnly, Secure, SameSite=Strict** cookie, stored as a SHA-256 hash and **rotated on every use**; re-using an old one revokes the whole session family. Automatic sign-out after 30 minutes without use | `lib/session.ts`, `lib/tokens.ts`, `lib/session.tsx` |
| **Anti-forgery** | Cookie endpoints also require a custom header, on top of SameSite=Strict | `auth/routes.ts` |
| **Who may do what** | Every request is checked against the person's role permissions, read from the database (cached 30 s, so removing someone takes effect almost at once). The shop comes **only** from the verified token. Details below | `plugins/auth.ts`, `modules/shop/*` |
| **Browser cannot forge records** | Sales, returns, purchases, stock movements, money entries, khata entries, closings and counters can **only** be created by the server's own operations, which take prices, cost, stock and balances from the database. Even the owner's browser cannot write them directly. Product `stock` can never be set by the browser; `cost` only by people allowed to edit cost; prices only by people allowed to change prices | `shop/collections.ts`, `shop/ops.ts` |
| **Data hidden by role** | Cost and profit data is removed from what a cashier receives (products, stock movements, sale lines, receipts). A cashier sees only their own sales, cannot read the money ledger or khata balances, and sees what they counted, not what the books expected (blind cash count). A counter user may see wallet float balances but not the cash drawer | `shop/collections.ts`, `shop/routes.ts` |
| **All-or-nothing** | Each operation (a sale, a return, a purchase …) runs in one database transaction with row locks on the products involved: a failure leaves nothing half-written, and two terminals selling at once never lose a stock update or repeat an invoice number. Verified with 12 simultaneous sales | `shop/store.ts` |
| **Staff** | Owner adds people, changes roles, switches them off and resets passwords from Settings. Everyone can change their own password. Resets and switching off end that person's sessions. Cannot demote or switch off the last owner or yourself; only an owner can add or change owners; an email or mobile already registered anywhere is refused without attaching the account | `shop/users.ts` |
| **Super admin** | Separate identity and token audience, password **and** authenticator code (secret encrypted with AES-256-GCM), account locked after 5 failures, every sign-in and failure audited | `admin/routes.ts` |
| **SQL injection** | All queries use Drizzle with bound parameters; the few hand-written fragments only take bound values or fixed constants (field names for sums are checked against a strict pattern). Every body, query and URL parameter is validated first. Verified by sending injection strings in ids, filters, prefixes and logins | whole API |
| **Input limits** | Strict Zod schemas on everything the browser may write, sane numeric bounds (money as whole paisa), 5 MB request cap (8 MB for operations, 80 MB for restoring a backup) | `shop/schemas.ts` |
| **Rate limiting** | 300 requests/minute overall; login 10/minute; admin login 5/minute; backup restore 5/minute. The client address comes from a **configured number of trusted proxy hops**, so a client cannot fake it | `app.ts`, `config.ts` |
| **Transport and headers** | HTTPS enforced; HSTS; `Cache-Control: no-store` on every API response; CORS only for the configured web address. Website CSP: scripts only from the site itself, no inline or eval, `frame-ancestors 'none'`, connections only to the site and the API | `app.ts`, `apps/web/deploy/htaccess.template` |
| **Secrets** | Signing and encryption keys come from environment variables in production (the app refuses to start without them); `.env` is git-ignored; secrets, cookies and password fields are redacted from logs | `config.ts`, `app.ts` |
| **Start-up checks** | In production the app refuses to start with insecure cookies, `http://`/`localhost`/wildcard CORS origins, missing or wrong-sized keys, or the MySQL `root` user | `config.ts` |
| **Audit trail** | Every operation and every sensitive save (settings, prices, accounts, staff, exports, restores) is written to `audit_logs` with who, what and when | `lib/audit.ts` |
| **Unused endpoints** | The older device/sync/catalog endpoints are not registered, to keep the attack surface small | `app.ts` |

## Fixed in the security passes

| Problem found | Fix |
|---|---|
| **Super-admin sign-in could never succeed** (the encrypted authenticator secret was corrupted when read back), and nothing could create the first admin | Stored as text; `cli.js create-admin` |
| Shop data and offline PINs were kept **in the browser** (PINs in plain text) and the role checks were done by the web page itself | **All data moved to the server.** Roles are enforced by the server on every request. No browser storage; PINs removed entirely |
| **Stored XSS** in the supplier-order print window | HTML-escaped |
| **CSV injection** in exports | Formula-looking text neutralised |
| Client IP trusted from any `X-Forwarded-For`, so limits and lockouts could be dodged | Only the configured number of proxy hops is trusted |
| Cookies not forced HTTPS-only in production; CORS not validated | The app refuses to start unless safe |
| Admin login without lockout or failure audit; weak owner passwords allowed; wrapping sequences like `12345678901` accepted | Lockout, audit, shared password policy tightened |
| Disabled users got a server error instead of a clean 401 | Fixed |
| Computer left signed in | Automatic sign-out after 30 minutes |
| WhatsApp links opened with access to the app window | `noopener,noreferrer` |
| No way to change a password, no production tooling | Settings screens, `cli.js` (`reset-password`, `doctor`, `migrate`, …) |

## Limits: read before going live

1. **The shop cannot sell without the internet.** Nothing is kept on the computer, so if the internet or the server is down the screens cannot load or save, and the top bar says "No internet — cannot save". Use a reliable connection (or a mobile-data backup), and keep the server host's uptime in mind. An offline mode that queues sales is possible but would mean storing data in the browser again, so it was deliberately left out.
2. **Reports are added up by the database**, not the browser: the server runs SUM / GROUP BY queries over the date range and sends back only the finished figures (a few hundred bytes), after checking the caller's permission on every request (cost, profit, expenses and ledger totals are refused to cashiers; sales totals are limited to a person's own bills unless they may see all). A year of ~60 000 bills takes about 0.5 s for the profit report and ~1.5 s for the per-product table on the test machine; a month takes well under 0.2 s. The few lists that stay in the browser are the rows a screen actually shows (one day's money entries, one month's expenses, a page of bills). Needs MySQL 8 or MariaDB 10.6+ (tested: MySQL 8.4.11, MariaDB 10.6.28, MariaDB 11.8.9; big date ranges run roughly 2-5x slower on MariaDB, e.g. a year of 60 000 bills: profit 1.7 s, per-product table 8 s, a month under 1 s) (`node cli.js doctor` checks the `JSON_TABLE` syntax the reports use).
3. **No second factor for shop users**: only the super admin uses an authenticator app.
4. **Revocation is not instant.** Switching someone off or resetting a password ends their sign-in at once, but an already-issued access token works for up to 15 minutes (their role and status are re-checked every 30 seconds, so most actions stop sooner).
5. **A flaky connection can force a re-login.** Re-using a refresh token is treated as theft, with no grace period.
6. **Rate limits are per server process.** If the host runs several copies, each counts separately. Account lockouts are stored in the database, so they are shared.
7. **Two people editing the same product or customer at once: the last save wins.** Money and stock are not affected (they only change through operations).
8. **Voice billing sends audio to the browser's speech service** (Google, in Chrome/Edge). Only the recognised words are used by the app.
9. **Not tested on SoftonHost itself.** Tested here: Node 24, MySQL 8.4, the real production bundle started through the same `app.cjs` entry file, the real web app in a browser. Also tested end to end (58 report-parity tests, 40 report HTTP checks, 100 smoke checks, security check): **MariaDB 10.6.28 and 11.8.9**. Not tested: Passenger, CloudLinux, MySQL 8.0, MariaDB older than 10.6. `cli.js doctor` and `security-check.mjs` exist to catch differences on day one.
10. **Dependencies:** run `pnpm audit --prod` before each release.

## Before go-live checklist

- [ ] HTTPS active on both addresses (AutoSSL)
- [ ] `node cli.js doctor` says "All checks passed"
- [ ] `node apps/api/scripts/security-check.mjs --api ... --web ...` says "All checks passed"
- [ ] Super admin created, authenticator app set up, setup key not kept anywhere else
- [ ] `JWT_PRIVATE_KEY` and `APP_ENCRYPTION_KEY` saved in a password manager, not in email or chat
- [ ] The owner has signed in, done first-time setup, and added each staff member with their own login
- [ ] Any old browser data copied to the server (Settings > Backup) and deleted from the browser
- [ ] Daily database backup scheduled in cPanel; one restore actually tried
- [ ] Windows login and disk encryption (BitLocker) on shop computers
- [ ] `pnpm audit --prod` reviewed

## If something goes wrong

- **Suspected stolen password:** Settings > Staff > Edit > set a new password (ends their sessions), or `node cli.js reset-password --identifier ...`.
- **Suspected stolen signing key or database dump:** replace `JWT_PRIVATE_KEY` (signs everyone out), reset the owner passwords, rotate the database password in cPanel and in `DATABASE_URL`.
- **Look at who did what:** `audit_logs` (shop actions), `platform_audit_logs` (super admin), `login_attempts` (failed sign-ins, kept 30 days).
