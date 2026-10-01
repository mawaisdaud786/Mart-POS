# 02 — Offline-First Architecture and Sync Strategy

## 1. Offline-first model

```text
 UI (React)
   │  reads: useLiveQuery(Dexie)          ← always local, instant, works offline
   │  writes: domain command (e.g. completeSale)
   ▼
 Local domain service  (packages/domain, shared with server)
   │  1. validate (Zod + business rules)
   │  2. write document(s) to Dexie             ┐
   │  3. run posting engine → provisional       │  ONE Dexie transaction
   │     movements/ledger rows + projections    │
   │  4. append mutation to sync_queue (outbox) ┘
   ▼
 Sync engine (one leader tab, Web Locks API)
   push outbox ──▶ POST /sync/push  ──▶ server re-validates + re-posts (authoritative)
   pull changes ◀── GET  /sync/pull?cursor=N ◀── server change log
```

What works fully offline: POS sales, returns, hold/resume, customer udhaar and payments, expenses, owner drawings, cash transfers, supplier purchases and payments, stock adjustments, Easypaisa/JazzCash/load transactions, cash closing, and every report computed from local data (with a "based on data up to <last sync>" note).

What needs a connection: first login and device registration, token refresh after the offline window (default 72 h), user/role management, subscription changes, import/export jobs, WhatsApp/email sending (queued until online), and the AI assistant.

## 2. Local database (Dexie)

- DB name: `retailos_<tenantId>_<userId>`, schema versioned with Dexie migrations.
- Local tables mirror the server tables a device needs (see "Data scope" below), plus these local-only tables:

| Local table | Purpose |
|---|---|
| `sync_queue` | Outbox: `{mutationId, entity, op, payload, baseVersion, createdAt, attempts, lastError, status: pending\|in_flight\|failed\|conflict}` |
| `sync_state` | `{lastPulledSeq, lastPushAt, lastSuccessAt, entitlementToken, serverClockOffsetMs}` |
| `sync_log` | Last N sync results for the Sync Center |
| `drafts` | Held/draft POS carts (device-local; optional server sync later) |
| `kv` | Device id, device code, cached PIN hashes, UI prefs |

- Every synced row carries **`sync_status`** locally: `synced | pending | failed | conflict`. `sync_status` exists **only on the client**; the server has no such column.

### Common record fields (all synced entities)

| Field | Notes |
|---|---|
| `id` | **UUIDv7**, generated on the device (time-ordered, index-friendly). Never auto-increment. |
| `tenant_id` | Set locally for convenience; **the server overwrites it** from the token |
| `branch_id` | Where applicable; the server checks the device's branch binding |
| `origin_device_id` | Device that created the record |
| `created_at` / `updated_at` | Device clock, corrected by `serverClockOffsetMs` |
| `created_by` / `updated_by` | User id |
| `version` | Integer, +1 on every accepted server update (optimistic concurrency) |
| `deleted_at` | Tombstone for mutable master data; documents are never deleted, they're voided or reversed |
| `server_seq` | Server change-log position (set by the server, used for pull) |

## 3. Sync protocol

### 3.1 Push: `POST /api/v1/sync/push`

```jsonc
{
  "deviceId": "…",
  "mutations": [
    { "mutationId": "0190…", "entity": "sale", "op": "create",
      "payload": { /* full document incl. items & payments */ } },
    { "mutationId": "0190…", "entity": "product", "op": "update",
      "id": "…", "baseVersion": 7, "changes": { "salePrice": 25000 } }
  ]
}
```

- Batches of up to 100, sent **in order** (FIFO per device). Documents referencing each other (a customer created offline, then a sale to that customer) arrive in causal order.
- For each mutation the server runs one DB transaction: **idempotency check → authorize → validate → apply/post → write change log → record result**.
- **Idempotency:** `sync_mutations(tenant_id, mutation_id)` is a primary key. If it already exists, the server returns the stored result without re-applying. Documents also have a unique `id`, so a sale can never be inserted twice, even if the client retries after a timeout where the server had already committed.
- Response per mutation: `applied` (+ new version / server-assigned fields) · `rejected` (validation or permission; not retryable, shown in the Sync Center) · `conflict` (see §4) · `retry` (transient).
- An `applied` mutation is removed from the outbox. A `rejected` one stays visible with its reason until the user resolves it (edit and resubmit, or discard with an audit entry).

### 3.2 Pull: `GET /api/v1/sync/pull?cursor=<seq>&limit=500`

- The server keeps a **per-tenant monotonic change log** (`sync_changes.server_seq`).
- **Gap-free sequencing:** auto-increment values can commit out of order, so a reader could skip a row. Instead, each writing transaction locks and increments `tenant_sync_counters.last_seq` (`SELECT … FOR UPDATE`, then `UPDATE`) inside the same InnoDB transaction. Changes for one tenant are serialized. For a shop with a few devices that is well within capacity, and it guarantees that "everything ≤ cursor has been seen".
- The response carries changed rows (full current state, filtered to the device's scope) and `nextCursor` + `hasMore`. The client applies them in a Dexie transaction and **replaces** provisional rows with server rows.
- A pull runs after every push, on reconnect, every 30–60 s while online, and on app focus.

### 3.3 Bootstrap and resync

- First login on a device: `GET /sync/snapshot?branch=…` streams the current state of in-scope tables (paged, NDJSON) + the cursor at snapshot time. After that, pulls are incremental.
- If a device is too far behind (cursor older than the change-log retention, e.g. 90 days), the server returns `410 resync_required`. The client pushes its outbox first, then re-snapshots.

### 3.4 Data scope per device

| Data | On device |
|---|---|
| Master data (products, units, categories, suppliers, customers, accounts, providers, settings) | All for the tenant (branch-filtered where branch-specific) |
| Balances/projections (stock on hand, party balances, account balances) | For the device's branch |
| Documents (sales, purchases, expenses, retailer txns) | Device's branch, **last 90 days** (configurable). Older ones are fetched online on demand. |
| Daily aggregates (`product_stats_daily`) | Device's branch, last 180 days. Enough for offline reorder calculation. |

## 4. Conflict handling

Conflicts are designed out wherever possible:

| Data class | Examples | Rule |
|---|---|---|
| **Immutable documents** | sales, returns, payments, expenses, purchases, retailer txns, stock adjustments, cash closings | **Create-only.** Never updated after completion. Corrections = void/return/reversal documents. **No conflicts possible.** |
| **Derived state** | stock on hand, avg cost, customer/supplier/account balances | **Never pushed.** The client computes provisional values locally; server values from pull overwrite them, with local unsynced postings re-applied on top ("optimistic overlay"). |
| **Mutable master data** | product, customer, supplier, settings, categories | **Optimistic concurrency + field-level merge.** The client sends `baseVersion` + changed fields. If the server version equals `baseVersion`, apply. Otherwise, if the changed fields weren't changed since `baseVersion` (tracked in `field_versions` jsonb), auto-merge. Otherwise it's a **conflict**: server state is kept, the client's attempt goes to `sync_conflicts`, and the Sync Center shows a side-by-side "keep mine / keep server" choice. Price and cost fields always need a human decision. |
| **Sequences** | invoice numbers | No global counter offline. Invoice no. = `<branchCode>-<deviceCode>-<seq>` (e.g. `M-A1-004213`), with the per-device counter kept locally. Unique by construction. |

### Business-rule conflicts (accepted, not rejected)

A sale that already happened in the real world must never be rejected by sync. Instead:

- **Negative stock:** accepted; a `stock_negative` alert is raised (default Q6).
- **Credit limit exceeded across two devices:** accepted; a `credit_limit_exceeded` alert is raised.
- **Price changed on the server after an offline sale:** the sale keeps the price actually charged (sale lines store `unit_price`). Below `min_sale_price` → a `price_below_minimum` alert.
- **Product deleted/deactivated on the server:** the sale is still accepted (product rows are soft-deleted, never hard-deleted).
- **Cashier lost permission while offline:** accepted if the permission was valid at `created_at` according to the membership history; otherwise flagged for owner review.

**Only these are rejected:** malformed payloads, tenant/branch mismatch, a revoked device (after its revocation time), and genuine validation failures.

## 5. Deterministic posting (no duplicate ledger rows)

Ledger rows created by the posting engine get **deterministic UUIDs**:
`uuidv5(namespace, "<sourceType>:<sourceId>:<lineNo>:<postingKind>")`.
The device and the server generate identical ids for the same posting. When the pull arrives, the server row upserts over the provisional local row, so there is no double counting.

## 6. Costing across offline devices

The device computes provisional COGS from its local WAC. The server re-posts the sale using the server WAC **at posting time**, and the pull corrects local figures. Late-arriving sales are costed at the WAC when they arrive, not re-costed historically. The difference is small at karyana price movements. A nightly **re-cost job** that replays movements in `occurred_at` order can be added later if accountants need it.

## 7. Clock handling

- The server returns `serverTime` on every sync. The client stores `serverClockOffsetMs` and uses corrected time for `occurred_at`.
- The server also stores `received_at`. Reports use `occurred_at`; a skew of more than 10 minutes raises a device warning ("check the device date/time").

## 8. Reliability details

- **Leader election:** only one tab runs the sync engine (`navigator.locks.request('retailos-sync')`); other tabs see updates via Dexie live queries.
- **Triggers:** `online` event, a 30 s interval while online, app focus, after each local write (debounced 2 s), and Background Sync (Chromium) where available.
- **Retry:** exponential backoff with jitter (2 s → 5 min cap). A mutation with 10 or more failures moves to `failed`, shows in the Sync Center, and stops blocking later independent mutations. Causally dependent ones wait.
- **Storage durability:** `navigator.storage.persist()`; warn in the UI if it isn't granted. Warn when `storage.estimate()` exceeds 80 %. On iOS Safari, installing the PWA is required, because otherwise storage can be evicted after 7 days of disuse. The installer screen says so.
- **Connection state** (header badge): 🟢 Online (outbox empty) · 🟠 Syncing (N pending) · 🔴 Offline (N pending, last sync hh:mm) · ⚠️ Sync errors (N failed). Reachability is measured by `/healthz` pings, not just `navigator.onLine`.

## 9. Sync Center (screen)

- Counters: pending, in flight, synced today, failed, conflicts
- Last successful push/pull time, cursor, device id/code, storage used
- Failed list: entity, time, error message, **Retry**, **View**, **Discard** (owner only, audited)
- Conflicts: side-by-side resolution
- **Sync now**, **Export unsynced data** (rescue file), **Re-download data** (resync)

## 10. Sync tests (must pass in CI)

1. Offline sale → reconnect → exactly one sale, one set of movements and ledger rows on the server.
2. Push timeout after server commit → retry → still exactly one (idempotency).
3. Two devices sell the last unit offline → both accepted, stock −1, alert raised.
4. Concurrent product edits: disjoint fields merge; the same field → conflict recorded.
5. Customer created offline, then a credit sale to that customer → causal order preserved.
6. Tenant A device can never pull tenant B changes (forged cursor, forged ids).
7. Tab closed mid-sale → the Dexie transaction is atomic; no half-written sale.
8. 5,000 queued mutations after a long outage → drains without UI freeze (batching, web worker).
9. Revoked device → push rejected after revocation time; earlier data accepted.
10. Clock skew ±2 h → `occurred_at` corrected; warning shown.
