# 05 — User Roles and Permissions

## Model

- **Permissions** are a fixed global catalog of keys (`module.action[.scope]`).
- **Roles** are per tenant. Five system templates are copied at tenant creation. The Owner role is locked; the others can be edited, and new roles can be created (on the Professional plan, via the `advanced_permissions` feature).
- **Effective access** = role permissions ∧ plan features ∧ branch scope (`membership_branches`).
- Enforced on the server for every route and every synced mutation. The client hides what the user can't do (UX only).
- Permission changes are audited and bump `perms_v`, which invalidates cached tokens on the next refresh.

## Permission catalog

| Module | Keys |
|---|---|
| POS / Sales | `pos.use` · `sales.view_own` · `sales.view_all` · `sales.discount.line` · `sales.discount.order` · `sales.discount.above_limit` · `sales.price_override` · `sales.below_min_price` · `sales.credit` (udhaar sale) · `sales.return` · `sales.return_without_receipt` · `sales.void` · `sales.reprint` |
| Cash | `cash.session.open_close` · `cash.session.view_expected` (see the expected amount before counting; off for cashiers to avoid "matching") · `cash.session.review` · `cash.transfer` · `cash.adjust` |
| Products | `products.view` · `products.create` · `products.edit` · `products.edit_price` · `products.view_cost` · `products.edit_cost` · `products.delete` · `products.import` |
| Inventory | `inventory.view` · `inventory.adjust` · `inventory.count` · `inventory.transfer` · `inventory.view_value` |
| Customers | `customers.view` · `customers.manage` · `customers.view_balance` · `customers.receive_payment` · `customers.set_credit_limit` · `customers.write_off` |
| Suppliers | `suppliers.view` · `suppliers.manage` · `suppliers.view_balance` · `suppliers.pay` |
| Purchasing | `purchasing.view` · `purchasing.create_po` · `purchasing.receive` · `purchasing.return` · `reorder.view` · `reorder.create_orders` |
| Expenses | `expenses.view` · `expenses.create` · `expenses.edit_void` · `expenses.categories` |
| Accounts | `accounts.view_balances` · `accounts.manage` · `owner.drawings` |
| Retailer | `retailer.transact` · `retailer.view_all` · `retailer.reverse` · `retailer.reconcile` · `retailer.configure` (providers, commission rules) · `retailer.view_commission` |
| Reports | `reports.sales` · `reports.profit` · `reports.inventory` · `reports.financial` · `reports.retailer` · `reports.export` · `dashboard.owner` |
| AI | `ai.use` |
| Admin | `users.manage` · `roles.manage` · `settings.manage` · `branding.manage` · `devices.manage` · `billing.view` · `billing.manage` · `audit.view` · `data.export_all` · `sync.discard` |

## Default role matrix

✅ granted · ➖ not granted · 🔸 own/limited

| Area | Owner | Manager | Cashier | Inventory Mgr | Accountant |
|---|:-:|:-:|:-:|:-:|:-:|
| POS sell, receipts | ✅ | ✅ | ✅ | ➖ | ➖ |
| View sales | ✅ all | ✅ all | 🔸 own shift | ➖ | ✅ all |
| Line discount (within limit) | ✅ | ✅ | ✅ (max % setting) | ➖ | ➖ |
| Discount above limit / price override | ✅ | ✅ | ➖ (manager PIN) | ➖ | ➖ |
| Udhaar (credit) sale | ✅ | ✅ | ✅ (within limit) | ➖ | ➖ |
| Returns with receipt | ✅ | ✅ | ✅ | ➖ | ➖ |
| Return without receipt / void sale | ✅ | ✅ | ➖ | ➖ | ➖ |
| Open/close own cash session | ✅ | ✅ | ✅ (blind count) | ➖ | ➖ |
| Review cash discrepancies | ✅ | ✅ | ➖ | ➖ | ✅ |
| Products view | ✅ | ✅ | ✅ (no cost) | ✅ | ✅ |
| Products create/edit | ✅ | ✅ | ➖ | ✅ | ➖ |
| Change sale price | ✅ | ✅ | ➖ | ✅ | ➖ |
| **See / change purchase cost** | ✅ | ✅ | ➖ | ✅ | 🔸 view |
| Stock adjust / count | ✅ | ✅ | ➖ | ✅ | ➖ |
| Receive purchases | ✅ | ✅ | ➖ | ✅ | ➖ |
| Create POs / Today's Orders | ✅ | ✅ | ➖ | ✅ | ➖ |
| Customers manage / receive payment | ✅ | ✅ | 🔸 receive payment | ➖ | ✅ |
| **Supplier balances / pay suppliers** | ✅ | ✅ | ➖ | 🔸 view | ✅ |
| Expenses create | ✅ | ✅ | 🔸 petty (setting) | ➖ | ✅ |
| **Modify / void expenses** | ✅ | ✅ | ➖ | ➖ | ✅ |
| Owner drawings | ✅ | ➖ | ➖ | ➖ | ➖ |
| Easypaisa/JazzCash transact | ✅ | ✅ | ✅ | ➖ | ➖ |
| Retailer reconcile / configure commission | ✅ | ✅ / ➖ | ➖ | ➖ | ✅ / ➖ |
| **Profit, margins, owner dashboard** | ✅ | ✅ | ➖ | ➖ | ✅ |
| Sales/inventory/financial reports | ✅ | ✅ | ➖ | 🔸 inventory | ✅ |
| AI assistant | ✅ | ✅ | ➖ | ➖ | ✅ |
| Users, roles, devices, settings, billing | ✅ | 🔸 devices | ➖ | ➖ | ➖ |
| Audit log | ✅ | ➖ | ➖ | ➖ | ✅ |

The spec's cashier restrictions (§36) all hold: no purchase-price changes, no deleting/voiding sales, no profit view, no expense modification, no supplier balances.

**Manager override:** when a cashier hits a blocked action (big discount, void, return without receipt), a manager enters their PIN on the same device. The action is recorded with both user ids in the audit log and works offline, since PIN hashes are cached.

## Platform admin roles (separate identity)

| Role | Can |
|---|---|
| `super` | Everything, including plans, platform settings and break-glass grants |
| `support` | View tenant metadata/usage, suspend/activate, request break-glass (read) |
| `billing` | Subscriptions, invoices, mark payments, extend trials |
