# Shop data safety and recovery

## Current storage model

The current web application reads and writes operational shop records through the authenticated RetailOS API. MySQL on the configured shop server is the source of truth. The browser does not maintain a live IndexedDB copy or an offline sales queue. Older browser-only records can be imported once using **Settings → Backup & restore**.

This means checkout requires the shop server and an internet connection. If either is unavailable, do not assume a sale has been saved. Restore connectivity, verify the API is healthy, and confirm the sale in Sales before retrying a payment to avoid accidental duplicate sales.

## Production safety rules

1. Never run automated or destructive database tests against a production shop database.
2. Never point staging or local test tools at production data.
3. Take a database backup before migrations, upgrades, or restores.
4. Only restore a backup after verifying its source and confirming the target shop; restore replaces server records.
5. Keep signing/encryption keys protected and available with database backups according to the deployment recovery procedure.
6. Do not treat a downloaded backup as a substitute for the host's scheduled database backup or a tested restore procedure.

## Owner backup workflow

1. Sign in as an owner and open **Settings → Backup & restore**.
2. Download the RetailOS JSON backup.
3. Store it securely away from the shop server (for example, access-controlled cloud storage or an encrypted external drive).
4. Verify that the hosting provider also takes scheduled database backups and document retention.
5. Test restoration on a separate staging shop/database. Do not use production to test restore.

## Safe restore workflow

1. Identify and verify the backup file and the target shop.
2. Back up the target database before restoring.
3. Prefer restoring into a separate staging environment first.
4. In the app, select **Restore from file**, review the confirmation prompt, and type `RESTORE DATA` only when prepared to replace the target shop's current records.
5. Verify products, customers, balances, sales, purchases, stock, and reports before resuming normal work.

## If service is unavailable

- Check the browser connection and the API health/readiness endpoints.
- Do not enter the same sale repeatedly while the result is unknown; reconnect and check Sales first.
- Follow the host restart/recovery runbook and verify that data persisted before resuming checkout.
- Keep a tested secondary internet connection available. Offline checkout is not currently implemented.

## Legacy browser data

The app can detect old browser-only records from an earlier version and offers an explicit **Copy old data to the server** action. This is a one-time migration path, not the current operational database. Back up the server first, review the confirmation, and verify the copied records before deleting the legacy browser database.
