# Deploying RetailOS on cPanel (SoftonHost)

The shop server (API) runs as a **Node.js app** and stores data in **MySQL**. The web app is a folder of static files.
Use two addresses on the same domain:

| What | Address (example) | Where it lives |
|---|---|---|
| Web app | `https://shop.example.com` | a normal website folder |
| Shop server (API) | `https://api.example.com` | cPanel > Setup Node.js App |

Keep both on the **same main domain**. The sign-in cookie is `SameSite=Strict`, which only works between addresses of one site; two unrelated domains would sign people out on every page load.

> Everything below was tested on a local MySQL 8 with the production build. It has **not** been run on SoftonHost itself, so
> the first deployment is when `doctor` (step 6) earns its keep. If a step differs on your cPanel, the checks will tell you what is wrong.

## 0. Before you start

- cPanel has **Setup Node.js App** (look under *Software*). If it is missing, ask SoftonHost to enable Node.js; a plan without it cannot run the API.
- Choose Node.js **20 or newer** when creating the app.
- The database must be **MySQL 8+ or MariaDB 10.6+**. cPanel > *MySQL Databases* or phpMyAdmin shows the version. `doctor` checks this too.
- **HTTPS** on both addresses: cPanel > *SSL/TLS Status* > *Run AutoSSL*. Do this before anything else, because the app refuses to work properly without it.

## 1. Create the two addresses

cPanel > *Domains* > create `shop.example.com` and `api.example.com` (subdomains). Run AutoSSL for both.

## 2. Create the database

cPanel > *MySQL® Databases*:

1. Create a database, for example `cpuser_retailos`.
2. Create a user with a **long random password** and no special characters if you can (`@ : / # ? %` must be URL-encoded in the connection string).
3. Add the user to the database with **ALL PRIVILEGES**. Never use an account that can see other databases.

Your connection string is: `mysql://cpuser_retailos_user:PASSWORD@localhost:3306/cpuser_retailos`

## 3. Build on your computer

```bash
pnpm install
pnpm --filter @retailos/api package:cpanel
pnpm --filter @retailos/web package:cpanel -- --api https://api.example.com
```

This creates two folders (both git-ignored):

- `apps/api/cpanel/` is the API: `server.js`, `cli.js`, `app.cjs`, `package.json`, `migrations/`, `env.production.example`
- `apps/web/cpanel/` is the website, including a ready `.htaccess` (HTTPS redirect, security headers, page routing)

## 4. Upload

- **API:** upload the *contents* of `apps/api/cpanel/` to a folder **outside** public web folders, for example `/home/cpuser/retailos-api/`.
- **Web:** upload the *contents* of `apps/web/cpanel/` to the document root of `shop.example.com`. The `.htaccess` file is hidden: in File Manager turn on *Settings > Show Hidden Files*, and make sure it arrived.

## 5. Create the Node.js app

cPanel > *Setup Node.js App* > *Create Application*:

| Field | Value |
|---|---|
| Node.js version | 20 or newer |
| Application mode | **Production** |
| Application root | `retailos-api` |
| Application URL | `api.example.com` |
| Application startup file | `app.cjs` |

Then:

1. Click **Run NPM Install**. This downloads the password-hashing library for the server's own CPU and OS.
2. At the top of the page cPanel shows a line starting `source /home/.../activate`. Open *cPanel > Terminal*, paste that line, and run:
   ```bash
   node cli.js gen-secrets
   ```
   It prints `JWT_PRIVATE_KEY=...` and `APP_ENCRYPTION_KEY=...`. **Save both somewhere safe** (a password manager). Losing the encryption key makes admin authenticator secrets unreadable; changing the signing key signs everybody out.
3. Under *Environment variables*, add (see `env.production.example`):

   | Name | Value |
   |---|---|
   | `NODE_ENV` | `production` |
   | `DATABASE_URL` | your connection string from step 2 |
   | `JWT_PRIVATE_KEY` | from `gen-secrets` (one line, with the `\n` characters as printed) |
   | `APP_ENCRYPTION_KEY` | from `gen-secrets` |
   | `CORS_ORIGINS` | `https://shop.example.com` (exact address, no trailing slash) |

   Leave `TRUST_PROXY` unset (it defaults to 1: cPanel's Apache is one proxy in front of Node). Use `2` only if you also put Cloudflare in front.
4. Click **Restart**.

The app refuses to start in production if cookies are not HTTPS-only, the CORS list contains `http://`, `localhost` or `*`, the keys are missing, or the database user is `root`. The error appears in the app's log file shown on that page.

## 6. Create the tables and the first accounts

In the same Terminal (with the `source ...` line active, inside the app folder):

```bash
node cli.js doctor                 # shows what is wrong; run it any time
node cli.js migrate                # creates tables, plans, permissions
node cli.js create-admin --email you@example.com --name "Your Name"
node cli.js create-tenant --name "Al Noor Mart" --slug al-noor-mart --owner-name "Owner Name" --owner-email owner@example.com
node cli.js doctor                 # should now say "All checks passed"
```

Passwords are typed at a hidden prompt (minimum 10 characters; a sentence works best; common passwords and passwords containing the email or name are refused).

`create-admin` prints a **setup key** once. Enter it in Google Authenticator, Authy or Microsoft Authenticator (*enter a setup key*, time based). Super-admin sign-in needs the password and the 6-digit code.

No Terminal on your plan? Run the same commands on your own computer: in cPanel > *Remote MySQL* allow your computer's IP, put the cPanel server's address instead of `localhost` in a local `.env`, run them, then **remove the Remote MySQL entry again**.

## 7. First sign-in and staff

1. Open `https://shop.example.com` and sign in as the owner (the email and password from `create-tenant`).
2. The first time, the app asks for the shop name, phone, address and opening cash. It creates the payment accounts (cash, bank, Easypaisa, JazzCash) and product categories for you.
3. **Settings > Staff & passwords > Add person** for each cashier or manager. Everyone signs in with their own email or mobile number and password; what they see depends on their role. Tell them to change their password with the key icon at the bottom of the menu.
4. Add products (**Products > Add product** or **Bulk add/update** with a CSV file), then record opening stock. Select products in the Products list to bulk edit category, supplier, or unit; archive or reactivate them; or record alternate voice keywords one product at a time. Permanent deletion is available only when selected products have no stock or transaction history.

**Old data in a browser?** If an earlier version of the app was used on a computer, sign in as the owner on that same computer and browser, open **Settings > Backup & restore**: an "Old data found in this browser" box offers to copy everything to the server (people's old PINs are not copied) and then delete the browser copy. This replaces the records currently on the server, so do it before real work starts.

All data is stored on the server. The shop cannot work without the internet connection to the server, so choose reliable internet for the shop computers.

## 8. Check it from outside

On your computer (needs Node 20+; no passwords involved):

```bash
node apps/api/scripts/security-check.mjs --api https://api.example.com --web https://shop.example.com
```

Everything should say `PASS`. A `FAIL` line names what to fix. It makes about 25 requests, so you may be rate limited for a minute afterwards.

Also open `https://api.example.com/healthz` (should show `{"status":"ok"}`) and `https://shop.example.com`, sign in with the owner email and password.

## Day-to-day operations

| Task | How |
|---|---|
| Update the app | Rebuild (step 3), upload over the old files, *Run NPM Install* only if `package.json` changed, run `node cli.js migrate`, **Restart** |
| Forgot or leaked a password | Owner: **Settings > Staff & passwords > Edit** and set a new one (ends their sessions). If the owner is locked out: `node cli.js reset-password --identifier owner@example.com`. Super admin: `reset-admin-password --email ...` |
| Is everything healthy | `node cli.js doctor` |
| Back up the database | cPanel > *Backup* or phpMyAdmin > *Export*. Do this daily or set up cPanel's scheduled backups. Also keep the two secrets from step 5. The owner can also download a backup file from **Settings > Backup & restore** |
| Change the signing key | Run `gen-secrets`, replace `JWT_PRIVATE_KEY`, Restart. Everyone must sign in again |
| Someone sees "Too many failed attempts" | It lifts by itself after 15 minutes, or run `reset-password` for that user |

## Troubleshooting

- **API page shows an error or "Incomplete response":** open the app's log file (path shown in *Setup Node.js App*). A message starting `Unsafe production configuration` lists exactly which setting to fix.
- **`doctor` says "JSON columns come back as text":** the database engine is too old. Ask SoftonHost for MySQL 8 or MariaDB 10.6+.
- **Sign-in works but the next page load asks to sign in again:** the web and API addresses are on different main domains, or one of them is not HTTPS.
- **White page, console says "Refused to connect":** the web build was made with a different `--api` than the real API address. Rebuild with the right one.
- **Voice billing says microphone not allowed:** the site must be opened over HTTPS, and the browser's microphone permission must be allowed for it.
