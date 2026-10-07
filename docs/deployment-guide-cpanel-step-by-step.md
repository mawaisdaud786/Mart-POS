# RetailOS: step-by-step cPanel deployment guide (SoftonHost / CloudLinux / Passenger)

Written from the actual repository (checked: `apps/api/src/{config,server,cli,app}.ts`, `apps/api/scripts/package-cpanel.mjs`,
`apps/api/deploy/*`, `apps/web/scripts/package-cpanel.mjs`, `apps/web/deploy/htaccess.template`, `apps/web/src/lib/api.ts`,
`docs/deployment-cpanel.md`, `docs/staging-validation.md`, `docs/security.md`). Where something depends on your hosting
configuration it is marked **CHECK IN CPANEL** with what to look for. Nothing here deploys anything by itself.

Placeholders: `CPUSER` = your cPanel username, `example.com` = your main domain, `PASSWORD` = a value you generate.

---

## A. The guide

### 0. What this project actually is (so you do not build things that do not exist)

| Part | Exists? | Where | Deploys as |
|---|---|---|---|
| **API** (Fastify + MySQL, Node.js) | Yes | `apps/api` | cPanel **Setup Node.js App** (Passenger) on `api.example.com` |
| **Shop web app** (React/Vite, one single-page app for owner, manager, cashier) | Yes | `apps/web` | Static files in `shop.example.com`'s folder |
| Storefront / Seller app / Admin web app | **No** | none | Not part of this project. The role "super admin" exists only as API endpoints and `cli.js create-admin`; there is no admin web screen |
| Desktop app | Yes, but not for hosting | `apps/desktop` | Ignore for cPanel |

Roles (owner, manager, cashier, inventory manager, accountant) are all inside the one shop web app; what each sees depends on the role.

**Recommended architecture**

```
https://shop.example.com   -> static website  /home/CPUSER/shop.example.com/   (index.html, assets/, .htaccess)
https://api.example.com    -> Node.js App     app root /home/CPUSER/retailos-api/  (OUTSIDE any public folder)
MySQL/MariaDB database     -> cpuser_retailos  (one dedicated user, this database only)
```

- Both addresses **must be on the same registrable domain** (`example.com`). The login cookie (`rt`) is `HttpOnly`, `Secure`,
  `SameSite=Strict`, path `/api/v1`. The browser only sends it to the API when the page and the API are the *same site*;
  `shop.example.com` + `api.example.com` are. `shop.example.com` + `api.other-domain.net` is **not**: people would be signed out on every reload.
- Build and `pnpm` happen on **your computer**, not on the server. The server only needs Node.js (to run) and `npm install` for one
  native module. This avoids needing pnpm/Node 22 on cPanel.

### 1. Server requirements (check before anything else)

| Check | Needed | How to check |
|---|---|---|
| cPanel "Setup Node.js App" | present | cPanel > Software > **Setup Node.js App**. **CHECK IN CPANEL**: if missing, ask SoftonHost to enable Node.js Selector (CloudLinux feature) |
| Node.js version on the host | **20 or newer** (bundle is built for `node20`; tested on Node 24 only). Pick the newest offered (22 or 24 preferred) | Create-application dialog lists available versions |
| Database | **MySQL 8.0+ or MariaDB 10.6+** (latest patch). Tested: MySQL 8.4.11, MariaDB 10.6.28, MariaDB 11.8.9 | cPanel > Databases > MySQL Databases (version shown), phpMyAdmin footer, or `node cli.js doctor` |
| Terminal/SSH | needed for `cli.js` | cPanel > Advanced > **Terminal** (or SSH). **CHECK IN CPANEL**: if absent, see "no Terminal" note in `deployment-cpanel.md` |
| SSL | AutoSSL on both subdomains | cPanel > Security > **SSL/TLS Status** > Run AutoSSL |
| Apache modules for the web `.htaccess` | `mod_rewrite`, `mod_headers`, `mod_deflate` | **CHECK IN CPANEL** (normally all present; LiteSpeed also works). Test in step 12 |
| PHP | **Not used.** Ignore PHP version/settings | n/a |
| CloudLinux limits | enough RAM/processes/connections | cPanel > Metrics > **Resource Usage**; **CHECK IN CPANEL**: "Max user connections" for MySQL (the API opens up to 10 connections) and RAM (give the app at least 512 MB if the plan allows) |
| Native module | `@node-rs/argon2` installs on the server | step 7; if "Run NPM Install" fails on it, ask SoftonHost whether CageFS allows downloading npm packages |

### 2. Domains / subdomains

cPanel > Domains > Create A New Domain (subdomain):

1. `shop.example.com`, document root `/home/CPUSER/shop.example.com` (cPanel's default). **Frontend.**
2. `api.example.com`, document root `/home/CPUSER/api.example.com` (cPanel's default; stays empty/unused, the Node app answers this host). **API.**
3. Run **AutoSSL** for both (SSL/TLS Status). Wait until both show a green lock.

For the first deployment use staging names instead (`staging-shop.example.com`, `staging-api.example.com`, separate database, see
`docs/staging-validation.md`). The steps below are identical; only the names change. Do the real names only after staging passes.

### 3. Database (use an empty database; no production data on first deployment)

cPanel > MySQL® Databases:

1. **Create New Database**: `retailos` → becomes `CPUSER_retailos`.
2. **MySQL Users > Add New User**: `retailos` → `CPUSER_retailos` (CPUSER is truncated by cPanel if long; copy the exact name it shows). Use the **Password Generator**, tick "Copy", save in a password manager. Prefer letters+digits only.
3. **Add User To Database**: select the user and the database, **ALL PRIVILEGES**. This is all the app needs (`migrate` creates tables, so it needs CREATE/ALTER/INDEX/DROP on this one database). Never use an account that sees other databases.
4. Connection string (host is `localhost` on cPanel; if the connection fails in step 6 try `127.0.0.1`: **CHECK IN CPANEL**):
   ```
   DATABASE_URL=mysql://CPUSER_retailos:PASSWORD@localhost:3306/CPUSER_retailos
   ```
   Special characters in the password must be URL-encoded (`@` → `%40`, `:` → `%3A`, `/` → `%2F`, `#` → `%23`, `?` → `%3F`, `%` → `%25`).
5. Test the connection: step 6 (`node cli.js doctor` prints `Database connected: <version>`).

### 4. Where the code lives, and how it gets there

- **Recommended: build locally, upload the two generated folders** (no Git on the server, no dev tools on the server).
- GitHub repository: `https://github.com/mawaisdaud786/Mart-POS`. At the time of writing, your working copy has **122 uncommitted
  changes** (everything done in this project's recent work), so GitHub does not have this version yet. Commit and push them yourself
  when you are ready; nothing was committed for you. `.env` files and `storage/` are git-ignored; only `.env.example` is tracked (verified with `git ls-files`).
- Never run the Node API from a public folder. The API goes in `/home/CPUSER/retailos-api/` (next to, not inside, `public_html` or the subdomain folders).
- Optional: cPanel > Files > **Git™ Version Control** can clone the repo onto the server, but this repository is a pnpm monorepo
  needing Node 22 + pnpm 10 to build, so a server-side build is **not** recommended; the build step below runs on your computer.

### 5. Build on YOUR computer (Node 22+ required by the repo, pnpm 10.34.5)

```bash
git pull                                   # (or your working copy) at the repository root
corepack enable                            # makes the pnpm version in package.json available
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm --filter @retailos/api package:cpanel
pnpm --filter @retailos/web package:cpanel -- --api https://api.example.com
```

Outputs (both git-ignored, regenerated every time):

| Folder | Contains | Goes to |
|---|---|---|
| `apps/api/cpanel/` | `server.js`, `cli.js`, `app.cjs`, `package.json`, `migrations/`, `env.production.example` | `/home/CPUSER/retailos-api/` |
| `apps/web/cpanel/` | `index.html`, `assets/`, **hidden `.htaccess`** | `/home/CPUSER/shop.example.com/` |

The `--api` value must be the API origin only: `https://` + host, no path, no trailing slash. The script refuses anything else.
(It also writes that origin into the site's Content-Security-Policy in `.htaccess`.)

### 6. Upload and prepare the API folder

1. cPanel > File Manager (or SFTP): create `/home/CPUSER/retailos-api/`.
2. Upload the **contents** of `apps/api/cpanel/` into it (zip → upload → Extract is fastest). `migrations/` is a folder; keep it.
3. **Do not upload `node_modules`.** It does not exist in the bundle.

### 7. Create the Node.js app (Passenger)

cPanel > Setup Node.js App > **Create Application**:

| Field | Value |
|---|---|
| Node.js version | newest available, at least 20 (**CHECK IN CPANEL**) |
| Application mode | **Production** |
| Application root | `retailos-api` (relative to your home directory) |
| Application URL | `api.example.com` (leave the path box empty) |
| Application startup file | **`app.cjs`** (verified: `apps/api/deploy/app.cjs`, a CommonJS loader that `import()`s the ES bundle `server.js`) |
| Passenger log file | leave the default (note the path it shows) |

Then click **Create**, and on the app page:

1. Click **Run NPM Install**. This installs the only runtime dependency, `@node-rs/argon2` (native, per-CPU/OS; that is why it is installed on the server and not shipped). cPanel creates `node_modules` as a link into `~/nodevenv/retailos-api/<ver>/lib/node_modules`. **Never delete that link or the folder when uploading updates.**
2. Copy the line at the top of the page that starts with `source /home/CPUSER/nodevenv/retailos-api/...activate && cd /home/CPUSER/retailos-api`. You use it in every Terminal session.
3. Do **not** click Start/Restart yet.

### 8. Environment variables (every one the code reads; verified in `config.ts`, `server.ts`, `cli.ts`)

**Where to put them.** Create the file `/home/CPUSER/retailos-api/.env` (File Manager > New File; then in Terminal `chmod 600 .env`).
Both the server (`server.ts`) and `cli.js` load `.env` from the app folder, so the same values work for Passenger *and* for Terminal commands.
You may *additionally* enter them under "Environment variables" on the Node.js App page; real environment values win over `.env`.
**CHECK IN CPANEL**: whether variables entered only in the Node.js App page are visible to commands you run in Terminal (it differs between
hosts). The `.env` file removes that doubt, so use it. The app folder is not served by the web server (not a public folder). Never put `.env` in `shop.example.com`.

| Variable | Required | What / where from | Placeholder format | Frontend must never see it |
|---|---|---|---|---|
| `NODE_ENV` | yes | `production` (turns on all safety checks) | `NODE_ENV=production` | n/a |
| `DATABASE_URL` | yes | step 3 | `mysql://CPUSER_retailos:PASSWORD@localhost:3306/CPUSER_retailos` | **never** |
| `JWT_PRIVATE_KEY` | yes | `node cli.js gen-secrets` prints it (Ed25519 PEM on ONE line with literal `\n`) | `JWT_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\nMC4C...\n-----END PRIVATE KEY-----` | **never**. Changing it signs everybody out |
| `APP_ENCRYPTION_KEY` | yes | `node cli.js gen-secrets` (32 random bytes, base64) | `APP_ENCRYPTION_KEY=base64text=` | **never**. Losing it makes admin authenticator secrets unreadable; keep a copy in a password manager |
| `CORS_ORIGINS` | yes | the exact web address(es), `https` only, no trailing slash, no wildcard, no localhost | `CORS_ORIGINS=https://shop.example.com` | not secret, but must be exact |
| `TRUST_PROXY` | no | leave **unset** (defaults to 1: cPanel's Apache is one proxy in front). Use `2` only if Cloudflare is also in front | `TRUST_PROXY=1` | n/a |
| `COOKIE_SECURE` | no | leave **unset** (production = HTTPS-only cookies). `false` makes the app refuse to start | unset | n/a |
| `ACCESS_TOKEN_TTL_SECONDS` | no | default 900 (15 min) | unset | n/a |
| `REFRESH_TOKEN_TTL_DAYS` | no | default 30 | unset | n/a |
| `LOG_LEVEL` | no | default `info` | unset | n/a |
| `DB_COLLATION` | no | leave unset (default `utf8mb4_unicode_ci` works on MySQL 8 and MariaDB) | unset | n/a |
| `HOST`, `PORT` | no | **do not set**. Passenger supplies the socket (see step 11) | unset | n/a |
| `KEYS_DIR`, `APP_ROOT` | no | development only; leave unset | unset | n/a |

Frontend variable: the only one is `VITE_API_BASE_URL`, and **you do not set it by hand**: `package:cpanel -- --api https://api.example.com`
sets it for the build. It is baked into the built files, so **changing the API address requires rebuilding the web app** (and re-uploading). It is not a secret (it is just the API address).
Other `VITE_*` variables: none exist.

Generate the secrets (step 9) and paste them into `.env`. Example `.env` (placeholders only):

```
NODE_ENV=production
DATABASE_URL=mysql://CPUSER_retailos:PASSWORD@localhost:3306/CPUSER_retailos
JWT_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----
APP_ENCRYPTION_KEY=...
CORS_ORIGINS=https://shop.example.com
```

### 9. First commands in cPanel Terminal

```bash
source /home/CPUSER/nodevenv/retailos-api/<NODE_VERSION>/bin/activate && cd /home/CPUSER/retailos-api   # exact line is shown on the app page
node -v                                      # must be v20 or newer
node cli.js gen-secrets                      # copy JWT_PRIVATE_KEY=... and APP_ENCRYPTION_KEY=... into .env, save copies in a password manager
chmod 600 .env
node -e "require('@node-rs/argon2'); console.log('argon2 ok')"
node cli.js doctor
```

`doctor` must show **OK** for: configuration, signing key, encryption key, `Database connected: <version>`, **`Report queries (JSON_TABLE) work`**.
The two "Plans readable / super admin" lines may warn until step 10. A FAIL line states the fix (version too old, wrong credentials, unsafe config).

### 10. Migrate and create the first accounts

```bash
node cli.js migrate        # creates all tables + plans/permissions/units. Safe to repeat; only applies what is missing. Points at DATABASE_URL in .env
node cli.js doctor         # re-check
node cli.js create-admin  --email you@example.com --name "Your Name"      # optional (platform admin API only; no admin screen exists); prints an authenticator setup key ONCE
node cli.js create-tenant --name "Al Noor Mart" --slug al-noor-mart --owner-name "Owner Name" --owner-email owner@example.com
```

- Passwords are typed at a hidden prompt (min. 10 characters; common/weak ones refused). It needs an interactive terminal.
- `migrate` is the only schema command. Verify success: it prints `Migrations applied` and `Reference data ... up to date`, and `doctor` then shows plans readable.
- Nothing here deletes data. (`create-tenant` refuses a slug that already exists.)
- The owner then signs in at the shop address and completes the first-run setup wizard (shop name, opening cash).

### 11. Start the API and test it

1. Node.js App page > **Restart** (or Start). Wait 5-10 seconds.
2. Browser/Terminal:
   ```bash
   curl -s https://api.example.com/healthz     # {"status":"ok"}
   curl -s https://api.example.com/readyz      # {"status":"ok","db":"ok"}
   ```
3. **How Passenger and this app fit (verified from Passenger's own Node loader, `node-loader.js`):** in the default auto-install mode that cPanel uses,
   Passenger replaces `http.Server.listen()` and attaches the *first* HTTP server the app starts to its own socket, whatever host/port the app passes. The API
   starts exactly one server (Fastify) and calls `listen({ host: '127.0.0.1', port: 4000 })`, so Passenger takes it over and port 4000 is never opened. You do not need
   to set `HOST` or `PORT`. Do not add a second HTTP server to the app (Passenger would throw "listen() was called more than once").
   Passenger also reports every client as 127.0.0.1 to Node; the app does not rely on that, it takes the real client address from the `X-Forwarded-For` header (`TRUST_PROXY=1`).
   Only the confirmation on your host remains: **CHECK IN CPANEL** that `/healthz` answers; if it shows 502/503 or a Passenger error page, go to the troubleshooting table and send me the log lines.

### 12. Upload the web app

1. Upload the **contents** of `apps/web/cpanel/` to `/home/CPUSER/shop.example.com/`.
2. **Show hidden files** (File Manager > Settings > Show Hidden Files) and confirm `.htaccess` arrived. Without it there is no HTTPS redirect, no security headers, and page links like `/sales` return 404.
3. Open `https://shop.example.com`, sign in with the owner from step 10.
4. From your computer, with the live addresses:
   ```bash
   node apps/api/scripts/security-check.mjs --api https://api.example.com --web https://shop.example.com
   ```
   Everything must say PASS (about 25 requests; wait a minute before re-running to avoid the rate limit).

### 13. SSL / HTTPS / CORS / cookies: exact production configuration

| Setting | Value | Where it is enforced |
|---|---|---|
| HTTPS | both subdomains valid AutoSSL certificate | cPanel; `.htaccess` redirects http→https; API sends HSTS |
| API origin (as the browser calls it) | `https://api.example.com/api/v1` | baked in at build (`--api`) |
| Frontend origin | `https://shop.example.com` | `CORS_ORIGINS` |
| CORS | exactly that origin; the app refuses to start with `http://`, `localhost`, wildcards, paths, trailing slash | `config.ts` |
| Cookie | name `rt`, `HttpOnly; Secure; SameSite=Strict; Path=/api/v1`, 30 days | `lib/session.ts` |
| Access token | in memory only, 15 min, refreshed automatically via the cookie | `lib/tokens.ts` |
| Idle sign-out | automatic after 30 minutes without activity | web app |
| Proxy trust | 1 hop (Apache in front of Passenger) | `TRUST_PROXY` (default 1) |

Auth works across frontend and API only when: same main domain, both HTTPS, `CORS_ORIGINS` exactly equals the page origin, and the web build used the right `--api`.

### 14. Logs and troubleshooting

| Symptom | Where to look / what to do |
|---|---|
| Passenger errors, app will not start, 502/503 | The **Passenger log file** path shown on the Node.js App page: `tail -n 100 <path>`. Also `~/logs/` and cPanel > Metrics > **Errors** (Apache error log). A line `Unsafe production configuration:` lists exactly which setting is wrong |
| Node errors / API logs | The same Passenger log (the API writes JSON lines to stdout/stderr; passwords, cookies, authorization headers are redacted). `LOG_LEVEL=debug` for more (revert afterwards) |
| Database errors | Lines containing `ER_` or `Failed query` in the app log; run `node cli.js doctor`; cPanel > MySQL Databases (user attached to DB?) ; wrong `DATABASE_URL` host (`localhost` vs `127.0.0.1`) |
| Build errors | On your computer only: `pnpm typecheck` / the `package:cpanel` output. The server never builds |
| 500 errors | App log entry with the request id; reproduce once, `tail -f` the log while you do |
| 502 | App not running or crashed: log, then Restart; `/healthz` |
| White page, console "Refused to connect" | Web build used a different `--api` than the real API: rebuild with the right one; check browser console, and the CSP in `.htaccess` |
| CORS error in the browser console | `CORS_ORIGINS` is not exactly the page's origin (https, no trailing slash); fix `.env`, Restart |
| Signed out on every reload / login works but next page asks to sign in | Web and API on different main domains, or one is HTTP; cookie `rt` missing in browser dev tools > Application > Cookies for the API host |
| "Too many failed attempts" | Lifts by itself after 15 minutes, or `node cli.js reset-password --identifier owner@example.com` |
| App log empty or restarts repeatedly | **CHECK IN CPANEL**: Resource Usage (LVE memory/process limits hit); ask SoftonHost to raise them |

Useful commands: `tail -f <passenger log path>`, `node cli.js doctor`, `curl -i https://api.example.com/readyz`.

### 15. First deployment test (do all of it on staging first)

See Section E. Remember: there is no `/version` endpoint and no public categories endpoint in this project. Product categories are shop
records read at `GET /api/v1/shop/c/categories` **only after login**.

### 16. Updating later (repeatable procedure)

On your computer:

```bash
git pull
pnpm install --frozen-lockfile        # only if package.json / pnpm-lock.yaml changed
pnpm typecheck && pnpm test
pnpm --filter @retailos/api package:cpanel
pnpm --filter @retailos/web package:cpanel -- --api https://api.example.com
```

On the server:

1. **Backup the database first** (cPanel > Backup > Download a MySQL Database Backup, or Terminal: `mysqldump -u CPUSER_retailos -p CPUSER_retailos > ~/backups/retailos-$(date +%F-%H%M).sql`; create `~/backups` once; keep it out of any public folder).
2. Keep a copy of the current app folder: `cp -a ~/retailos-api ~/retailos-api-previous` (and keep the previous `apps/web/cpanel` zip on your computer).
3. Upload the new API files over `/home/CPUSER/retailos-api/` (replace `server.js`, `cli.js`, `app.cjs`, `package.json`, `migrations/`). **Keep `.env` and the `node_modules` link.** If `package.json` dependencies changed: Node.js App page > Run NPM Install.
4. Terminal (after the `source ... activate` line): `node cli.js migrate` (needed only when the release added migrations; harmless otherwise), then `node cli.js doctor`.
5. Upload the new web files over `/home/CPUSER/shop.example.com/` (keep `.htaccess`; the new bundle includes a fresh one).
6. Node.js App page > **Restart**.
7. Verify: `/healthz`, `/readyz`, sign in, open Dashboard + Reports. (Hard-refresh the browser if the old page shows; `index.html` is never cached.)

### 17. Rollback

1. Node.js App page > Stop. Restore the previous app folder files (`~/retailos-api-previous` over `~/retailos-api`, keeping `.env`), restore the previous web bundle, Restart.
2. Database migrations only move forward. If a migration changed data/schema in a way the old code cannot read, restore the dump from step 16.1 (phpMyAdmin > Import, or `mysql -u CPUSER_retailos -p CPUSER_retailos < backup.sql` on an **empty** database; never into a database holding newer data you care about without exporting it first). Releases that add no migration roll back by files alone.
3. Re-run `node cli.js doctor` and the Section E quick tests.

### 18. Security checklist (before pointing the real domain)

Run these; all must pass:

```bash
git ls-files | grep -iE "\.env|\.pem|secret|storage/"        # only .env.example may appear
git grep -nE "mysql://[^ ]*:[^ ]+@" -- ':!*.md' ':!*.example' | head   # no real DB credentials in source (examples/docs excluded)
curl -sI https://shop.example.com/.env       # 403 or 404, never 200
curl -sI https://shop.example.com/.htaccess  # 403
curl -sI https://api.example.com/healthz | grep -i "strict-transport\|cache-control"
node apps/api/scripts/security-check.mjs --api https://api.example.com --web https://shop.example.com
```

Also confirm manually: HTTPS valid on both; `.env` is only in `/home/CPUSER/retailos-api/` with mode 600 (`ls -l .env`); API folder is not inside a
public folder; `NODE_ENV=production` (anything else disables protections; `doctor` shows it); CORS lists only the shop address; DB user has privileges on **this one database** only (cPanel > MySQL Databases > Current Databases);
cashier cannot see cost/profit/ledger (Section E tests 14-16); other shop's owner sees none of your data (staging test with the second tenant);
logs contain no passwords/cookies (`grep -i "password\|rt=" <log>` shows nothing sensitive).

---

## B. Copy-paste command list (in order)

**On your computer (repo root):**
```bash
git pull
corepack enable
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm --filter @retailos/api package:cpanel
pnpm --filter @retailos/web package:cpanel -- --api https://api.example.com
```

**In cPanel Terminal** (after creating the Node.js app, uploading `apps/api/cpanel/*` to `~/retailos-api`, and clicking Run NPM Install):
```bash
source /home/CPUSER/nodevenv/retailos-api/<NODE_VERSION>/bin/activate && cd /home/CPUSER/retailos-api
node -v
node cli.js gen-secrets            # then create .env (see section A.8) with these values
chmod 600 .env
node -e "require('@node-rs/argon2'); console.log('argon2 ok')"
node cli.js doctor
node cli.js migrate
node cli.js create-admin  --email you@example.com --name "Your Name"
node cli.js create-tenant --name "Al Noor Mart" --slug al-noor-mart --owner-name "Owner Name" --owner-email owner@example.com
node cli.js doctor
curl -s https://api.example.com/healthz
curl -s https://api.example.com/readyz
```

**From your computer after the web upload:**
```bash
node apps/api/scripts/security-check.mjs --api https://api.example.com --web https://shop.example.com
```

**Staging only** (fresh shops, writes test data): `OWNER=... OWNER_PW=... OTHER=... OTHER_PW=... API=https://staging-api.example.com/api/v1 node apps/api/scripts/reports-http-check.mjs`
and the parity test against a *separate empty* database: see `docs/staging-validation.md` section E.

---

## C. cPanel settings (concise)

| Place | Setting | Value |
|---|---|---|
| Domains | frontend | `shop.example.com` → `/home/CPUSER/shop.example.com` |
| Domains | API | `api.example.com` → `/home/CPUSER/api.example.com` (unused docroot) |
| SSL/TLS Status | AutoSSL | both subdomains, green lock |
| MySQL Databases | database / user | `CPUSER_retailos` / `CPUSER_retailos`, ALL PRIVILEGES on that DB only |
| Setup Node.js App | Node.js version | newest available (≥ 20) |
| | Application mode | Production |
| | Application root | `retailos-api` |
| | Application URL | `api.example.com` |
| | Startup file | `app.cjs` |
| | Run NPM Install | once after the first upload; again only when `package.json` changes |
| | Environment variables | optional (the `.env` file holds them) |
| File Manager | show hidden files | on (to see `.htaccess`) |
| File permissions | `.env` | `600` |
| Env values | `NODE_ENV` | `production` |
| | `CORS_ORIGINS` | `https://shop.example.com` |
| | `TRUST_PROXY` / `COOKIE_SECURE` / `HOST` / `PORT` | unset |
| Web build | `--api` | `https://api.example.com` |

---

## D. Pre-production checklist (all must pass before the real domain is pointed)

- [ ] Staging done first on separate subdomains + separate empty database, following this guide
- [ ] `node -v` ≥ 20; database version MySQL ≥ 8.0 or MariaDB ≥ 10.6 (latest patch) shown by `doctor`
- [ ] `node cli.js doctor`: all OK, including `Report queries (JSON_TABLE) work`, argon2 loads
- [ ] `/healthz` and `/readyz` OK over HTTPS; app survives Restart and an idle period (reload after 30+ min)
- [ ] `security-check.mjs` all PASS against the live addresses
- [ ] Staging: `reports-http-check.mjs` 40/40; parity test 58/58 on the host's database engine (separate DB)
- [ ] Section E tests all passed on staging; Passenger log has no errors/warnings
- [ ] Secrets saved in a password manager (`JWT_PRIVATE_KEY`, `APP_ENCRYPTION_KEY`, DB password); `.env` mode 600; nothing secret in Git
- [ ] Section A.18 security checks pass
- [ ] Backup procedure tested once (download dump, and Settings > Backup file from the owner account)
- [ ] Rollback tested on staging (previous folder restored + Restart)
- [ ] Source pushed to GitHub (your decision) so the deployed version is reproducible

---

## E. Post-deployment verification

Do on staging first, then repeat the quick set (1-4, 7, 14, 21) on production.

1. `curl https://api.example.com/healthz` → `{"status":"ok"}`; `/readyz` → `db: ok`.
2. API "version": not available (no such endpoint in this project); use `node cli.js doctor` and the file dates instead.
3. Frontend loads at `https://shop.example.com`; direct URL `https://shop.example.com/sales` opens (not 404); http:// redirects to https://.
4. Sign in as owner; reload the page (session persists); sign out (returns to login; `rt` cookie removed).
5. Categories: after login, the Products page shows the categories created by first-run setup (`GET /api/v1/shop/c/categories` needs a login; without one it returns 401).
6. First-run wizard completes; Settings > Staff: add a manager and a cashier (mobile sign-in).
7. Products: create a product; opening stock through Stock adjustment; cashier sees the product **without cost**.
8. Sale as cashier (cash), with change; receipt/invoice prints; stock fell by the sold quantity.
9. Sale on credit (udhaar) to a customer; Customers shows the balance; receive a payment.
10. Return of one item (manager/owner), then cancel (void) another sale; Sales page shows "Returned"/"Cancelled".
11. Purchase from a supplier (Suppliers), pay the supplier; Expenses entry and an owner withdrawal; money transfer; cash closing (cashier counts blind).
12. Easypaisa/JazzCash transaction.
13. Reports (owner): Today, This month, last year range, an empty range; compare against the figures you know (sales − returns = revenue; revenue − cost = gross profit; − expenses = net). Dashboard totals match.
14. Permissions: cashier cannot open Reports, Expenses, Cash balances, Staff (menu hidden **and** direct API calls return 403: `reports-http-check.mjs` verifies this).
15. Cost/profit protection: as cashier, product list shows no cost; the receipt response has no cost.
16. Tenant isolation: owner of the second shop sees none of the first shop's products, sales or reports.
17. Staff management: change a role, reset a password (their old session ends), disable a user (they are refused within about 30 seconds).
18. Session expiration/revocation: leave a signed-in tab idle ~30 minutes → it signs out; after disabling a user, their next action fails.
19. Passenger Restart from the Node.js App page, then reload the app and open Reports: works without signing in again.
20. Idle test: leave the API untouched 30+ minutes, then load the app: first request may be slower but succeeds.
21. Read the Passenger log: no `ER_` database errors, no "Unsafe production configuration", no repeated restarts, no out-of-memory messages.

**Go/no-go:** every box in section D ticked and all of E passed with a clean log.

---

## F. Speed on the live host (added after the first deployment)

- **Keep the API awake.** On shared hosting Passenger puts an idle app to sleep, and the first request afterwards can take 5-15 seconds. cPanel > Advanced > **Cron Jobs** > add (every 5 minutes):
  ```
  */5 * * * * curl -s https://api.example.com/healthz > /dev/null 2>&1
  ```
- **What the build does for speed:** each screen is a separate small file loaded only when opened (first load about half the size); the dashboard asks the server once instead of eleven times; the API compresses large answers with gzip (a 70 KB product list becomes about 13 KB).
- **Still slow?** Open F12 > Network, reload, sort by Time. If every request is slow it is the host (CPU/RAM limits in cPanel > Resource Usage, or a distant server); if one request is slow, report its name.
