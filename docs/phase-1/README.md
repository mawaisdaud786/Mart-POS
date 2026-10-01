# RetailOS — Phase 1 Specification

Working product name: **RetailOS** (configurable, stored in `platform_settings`).
First tenant: **Al Noor Mart**.
Status: **Draft, waiting for approval.** Nothing will be implemented until this is approved.

| # | Deliverable | Where |
|---|---|---|
| 1 | Recommended technology stack | [01-architecture.md §1](01-architecture.md#1-recommended-technology-stack) |
| 2 | Complete system architecture | [01-architecture.md §2](01-architecture.md#2-system-architecture) |
| 3 | Multi-tenant architecture | [01-architecture.md §3](01-architecture.md#3-multi-tenant-architecture) |
| 4 | Offline-first architecture | [02-offline-sync.md §1–2](02-offline-sync.md) |
| 5 | Sync strategy | [02-offline-sync.md §3–9](02-offline-sync.md#3-sync-protocol) |
| 6 | Complete database schema | [03-database.md](03-database.md) |
| 7 | ERD | [03-database.md §ERD](03-database.md#erd) |
| 8 | API structure | [04-api-and-structure.md §1](04-api-and-structure.md#1-api-structure) |
| 9 | Folder structure | [04-api-and-structure.md §2](04-api-and-structure.md#2-folder-structure) |
| 10 | User roles and permissions | [05-roles-permissions.md](05-roles-permissions.md) |
| 11 | SaaS subscription architecture | [01-architecture.md §4](01-architecture.md#4-saas-subscription-architecture) |
| 12 | Security architecture | [01-architecture.md §5](01-architecture.md#5-security-architecture) |
| 13 | Module dependency map | [01-architecture.md §6](01-architecture.md#6-module-dependency-map) |
| 14 | Development phases | [06-roadmap.md §1](06-roadmap.md#1-development-phases-revised) |
| 15 | Risks and technical challenges | [06-roadmap.md §2](06-roadmap.md#2-risks-and-technical-challenges) |
| 16 | Recommended MVP | [06-roadmap.md §3](06-roadmap.md#3-recommended-mvp-al-noor-mart-pilot) |
| 17 | Features to postpone | [06-roadmap.md §4](06-roadmap.md#4-features-to-postpone) |
| 18 | Exact implementation order | [06-roadmap.md §5](06-roadmap.md#5-exact-implementation-order) |

---

## Key decisions (short version)

1. **MySQL 8.4 LTS** (your choice). MySQL has no row-level security, so tenant isolation is enforced by a fail-closed, tenant-scoped query layer, composite foreign keys and an automated isolation test suite in CI. **No Docker and no Redis:** everything runs natively on Windows, and background jobs use a MySQL job table.
2. **One shared database and schema, with `tenant_id` on every row**, enforced in layers: the tenant comes only from the auth token, the `tenantDb` layer adds `tenant_id` to every query, and tests prove shop A can never see shop B. Composite foreign keys `(tenant_id, id)` make a cross-tenant reference impossible.
3. **Offline-first starts on day one, not in Phase 7.** The spec puts offline in Phase 7, but it can't be added later. Client UUIDs, the outbox, and "UI reads from IndexedDB" decide how every module is written. The sync core ships in Phase 2. Phase 7 becomes sync *hardening*.
4. **Business events are immutable documents** (sale, payment, purchase, expense, Easypaisa transaction). They are only ever created, and a correction is a reversal document. That makes offline sync free of conflicts and idempotent, and it gives the traceability the spec asks for in §54.
5. **The same posting engine runs in the browser and on the server.** One TypeScript package turns a sale into its stock movements, account entries and customer-ledger entries. Offline, the device posts provisionally. After sync, the server's posting is the authority. Both sides use deterministic UUIDs, so nothing is duplicated.
6. **Money is stored as integer paisa (`bigint`) and quantity as `numeric(14,3)` in the product's base unit.** No floating-point money, ever.
7. **Owner withdrawal is not an expense.** The spec lists it as an expense category, but it is an equity drawing. Counting it as an expense would understate net profit. It is modelled separately and shown in Cash Flow, not in the P&L.
8. **Easypaisa has two balances, not one:** the e-money *float* (the wallet) and the *physical cash* it moves. A customer "cash-in" **decreases** the float and **increases** the drawer. Reconciliation checks both. **Commission is credited per transaction**, straight into the float. **Customers can also pay for goods by Easypaisa (merchant).** That money is recorded as a sale receipt (shop money), kept separate from retailer money even if it lands in the same wallet.

## Questions and answers

| # | Question | Answer / default in use |
|---|---|---|
| Q1 | Database | ✅ **MySQL 8.4 LTS** (answered 2026-09-27) |
| Q2 | Docker for local dev? | ✅ **Not for now.** Native Windows setup: MySQL ZIP install + Node + pnpm. No Redis. |
| Q3 | Easypaisa | ✅ **Commission per transaction.** Shop works as both **retailer** (cash-in/out) and **merchant** (customers pay for goods). Float and cash both reconciled. |
| Q4 | POS counters | ✅ **One POS.** Printer not specified; default is 80 mm, browser print. |
| Q3b | **Open:** do merchant payments land in the **same Easypaisa account** as the retailer float, or a separate one? | Default: configurable. Both cases are supported; the setup screen asks. |
| Q5 | Loose/weighed goods (daal, sugar by kg)? | Default: yes, decimal quantities |
| Q6 | Allow negative stock at the POS? | Default: allow + alert |
| Q7 | Urdu UI at launch? | Default: English UI + Urdu product names; Urdu UI in Phase 8 |
| Q8 | Production hosting | Default: decided at Phase 10 (a VPS + MySQL + off-site backups) |
| Q9 | GST/FBR POS integration? | Default: not in MVP; tax fields exist |
| Q10 | Git | Default: `git init` at the start of Phase 2 (GitHub push only when you ask) |
