# Claude Master Prompt — Al Noor Mart Multi-Tenant Retail Management SaaS

## Build a Production-Ready Multi-Tenant Retail Management SaaS for Karyana & General Stores

You are a senior software architect, product designer, full-stack engineer, database architect, and SaaS engineer.

I want you to design and build a **production-ready retail management/POS SaaS platform** initially for **Al Noor Mart**, a Pakistani karyana/general store.

The long-term goal is to offer the same software to **other karyana stores, grocery stores, general stores, mini marts, and small retailers on a monthly/yearly subscription/rental basis**.

This must therefore NOT be hardcoded for Al Noor Mart.

Build it as a **multi-tenant SaaS platform** where each shop/company has its own isolated data, users, settings, inventory, customers, suppliers, accounts, reports, and configuration.

---

## 1. Core Product Vision

The software should solve the real problems faced by Pakistani karyana/general stores:

- Owners don't know their actual daily/monthly profit.
- They cannot easily understand where their money is going.
- Sales, expenses and purchases are not properly tracked.
- Cash shortages are difficult to identify.
- Inventory shortages are discovered too late.
- Owners don't know what products they should reorder.
- They don't know how many boxes/cartons/cases to order from each supplier.
- Customer udhaar is difficult to manage.
- Supplier payments are difficult to track.
- Retailer services such as Easypaisa/JazzCash are often mixed with normal shop cash.
- Owners need simple daily financial and stock alerts.
- Many shops do not currently have barcode scanners.
- Internet connectivity can be unreliable, so the system must work offline.
- The software should eventually support barcode scanners.
- Owners should be able to access the business from phone, tablet, laptop or desktop.
- The owner should receive actionable information rather than only raw reports.

The main philosophy is:

**Sales → Stock → Cost → Profit → Expenses → Cash Flow → Reinvestment → Reordering**

The application should connect these areas intelligently.

---

## 2. Product Name

Use a temporary working name:

**RetailOS**

Do NOT permanently hardcode this name.

The platform must support:

- SaaS/platform name
- Shop/business name
- Shop logo
- Shop branding
- Custom settings

The first tenant should be:

**Al Noor Mart**

---

## 3. SaaS Architecture

Build this as a true:

**Multi-Tenant SaaS Application**

Each business/shop is a tenant.

Example:

```text
Platform
│
├── Tenant: Al Noor Mart
│   ├── Users
│   ├── Products
│   ├── Sales
│   ├── Purchases
│   ├── Customers
│   ├── Suppliers
│   ├── Expenses
│   ├── Cash
│   ├── Easypaisa
│   └── Reports
│
├── Tenant: ABC General Store
│
├── Tenant: City Mart
│
└── Tenant: New Kashmir Store
```

Tenant data MUST be isolated.

One shop must never be able to access another shop's:

- customers
- products
- sales
- expenses
- suppliers
- inventory
- financial information
- users
- reports
- retailer transactions

---

## 4. Platform Admin

Create a separate:

**Super Admin / SaaS Owner Panel**

The SaaS owner should be able to manage all subscribed shops.

Dashboard:

- Total shops
- Active shops
- Trial shops
- Expired subscriptions
- Monthly recurring revenue
- Annual revenue
- New registrations
- Churn
- Active users
- Storage usage
- Sync status
- System health

Tenant management:

- Create shop
- Edit shop
- Suspend shop
- Activate shop
- Delete/archive shop
- View subscription
- Change plan
- Extend subscription
- Trial period
- Payment status
- User count
- Device count

Do NOT allow platform administrators to casually expose tenant data.

Create proper audit logging for sensitive admin access.

---

## 5. Subscription System

The application must support SaaS plans.

Example:

### Starter
- 1 shop
- 2 users
- Basic POS
- Inventory
- Sales
- Expenses
- Basic reports

### Business
- More users
- Advanced inventory
- Supplier ordering
- Customer udhaar
- Financial reports
- WhatsApp reports
- Advanced alerts

### Professional
- AI assistant
- Advanced analytics
- Multiple branches
- Advanced permissions
- API
- More devices

Do not hardcode prices.

Create configurable subscription plans.

Each tenant should have:

- Plan
- Start date
- Expiry date
- Trial status
- Subscription status
- User limit
- Branch limit
- Device limit
- Feature permissions

---

## 6. Online + Offline First Architecture

THIS IS CRITICAL.

The application must work:

**ONLINE AND OFFLINE.**

A shop must be able to continue selling even if the internet goes down.

Use an offline-first architecture.

Recommended approach:

Frontend:

- React
- TypeScript
- Vite
- PWA

Local database:

- IndexedDB
- Prefer Dexie or another robust IndexedDB abstraction

Backend:

- Node.js
- TypeScript
- REST API or well-structured API layer

Database:

- MySQL 8 / PostgreSQL depending on architecture

The system should use:

```text
Cloud Database
       ↑
       ↓
Sync Engine
       ↑
       ↓
Local IndexedDB
       ↑
       ↓
POS / Application
```

When online:

- Sync local changes with server.
- Download new server changes.
- Resolve conflicts.
- Update local database.

When offline:

- POS must continue working.
- Sales must continue.
- Inventory must update locally.
- Expenses can be entered.
- Customer payments can be recorded.
- Supplier purchases can be entered.
- Easypaisa transactions can be recorded.
- Reports based on local data must continue working.

When internet returns:

- Automatically synchronize.

Display connection state clearly:

🟢 Online

🟠 Syncing

🔴 Offline

---

## 7. Offline Sync Requirements

Create a proper sync engine.

Every locally created/updated record should have:

- UUID
- Tenant ID
- Device ID
- Created timestamp
- Updated timestamp
- Version
- Sync status
- Deleted flag / tombstone where appropriate

Example:

```text
id
tenant_id
device_id
created_at
updated_at
version
sync_status
deleted_at
```

Do NOT rely only on auto-increment IDs for offline records.

The system must prevent duplicate sales when synchronization occurs.

Design for:

- Offline sale creation
- Offline stock movement
- Offline expense
- Offline payment
- Offline customer ledger
- Offline supplier ledger
- Offline retailer transaction
- Sync retry
- Failed sync queue
- Conflict handling
- Duplicate prevention

Create a visible:

**Sync Center**

showing:

- Pending changes
- Successfully synced
- Failed syncs
- Last successful sync
- Retry button

---

## 8. POS

Build a fast retail POS.

It must work without barcode scanner initially.

Product can be added through:

- Search
- Product name
- SKU
- Category
- Quick buttons
- Favorites

Later support:

- USB barcode scanner
- Bluetooth scanner
- Camera barcode scanner

Most USB barcode scanners behave like keyboards, so the architecture should support keyboard-style barcode input.

POS features:

- Search products
- Add quantity
- Remove quantity
- Change quantity
- Discounts
- Customer selection
- Cash sale
- Credit/Udhaar sale
- Multiple payment methods
- Split payment
- Sale return
- Item return
- Receipt
- Print receipt
- Thermal printer support
- Hold sale
- Resume sale
- Cancel sale
- Draft sale
- Daily closing

---

## 9. Payment Methods

Support configurable payment accounts:

- Cash
- Bank
- Easypaisa
- JazzCash
- Card
- Other wallet
- Customer credit

Each payment account must maintain its own balance/ledger.

Do NOT mix Easypaisa balance with shop cash.

---

## 10. Product Management

Each product should support:

- Product name
- Urdu name
- SKU
- Barcode
- Brand
- Category
- Subcategory
- Supplier
- Purchase price
- Sale price
- Wholesale price
- Retail price
- Minimum sale price
- Unit
- Purchase unit
- Sale unit
- Conversion factor
- Box/carton quantity
- Current stock
- Minimum stock
- Reorder point
- Safety stock
- Average daily sales
- Lead time
- Expiry tracking
- Batch tracking
- Product image
- Active/inactive
- Tax configuration if required
- Notes

---

## 11. Multiple Units

Karyana stores require different units.

Support:

- Piece
- Packet
- Box
- Carton
- Case
- Dozen
- Kg
- Gram
- Liter
- ML
- Bottle
- Sack

Example:

Purchase:

1 carton = 24 packets

But customer buys:

1 packet

The system must automatically convert inventory correctly.

Support configurable unit conversions.

---

## 12. Smart Inventory

Track inventory using stock movements.

Every stock change should have a reason.

Examples:

- Sale
- Purchase
- Return
- Damage
- Expiry
- Adjustment
- Transfer
- Opening stock
- Manual correction

Never simply overwrite stock without recording the movement.

Create an inventory ledger.

---

## 13. Smart Low Stock System

Do NOT use only fixed minimum stock.

Calculate reorder requirements using:

- Average daily sales
- Recent sales trend
- Current stock
- Reserved stock
- Supplier lead time
- Safety stock
- Minimum order quantity
- Case/box size

Example:

Product:

Cooking Oil 1L

Current stock:

20 bottles

Average daily sale:

7 bottles

Supplier lead time:

3 days

Safety stock:

10 bottles

The system should calculate:

- Estimated days remaining
- Reorder point
- Recommended quantity

Display:

🔴 ORDER NOW

---

## 14. Supplier Order Planner

This is a core feature.

The system must automatically generate recommended supplier orders.

Example:

### Peak Freans

Current situation:

| Product | Stock | Avg Sale | Recommended |
|---|---:|---:|---:|
| Sooper | 3 boxes | 1.2/day | 8 boxes |
| Rio | 2 boxes | 0.6/day | 5 boxes |
| Gluco | 5 boxes | 0.8/day | 7 boxes |
| Chocolatto | 1 box | 0.5/day | 4 boxes |

Generate:

**Peak Freans Recommended Order**

- Sooper — 8 boxes
- Rio — 5 boxes
- Gluco — 7 boxes
- Chocolatto — 4 boxes

Total:

24 boxes

Allow the user to modify quantities.

Buttons:

- Create Order
- Print
- PDF
- WhatsApp Share
- Mark Ordered
- Mark Received
- Cancel

---

## 15. Supplier Order Intelligence

For each supplier maintain:

- Supplier name
- Contact
- Products supplied
- Purchase price
- Last purchase price
- Average purchase price
- Lead time
- Minimum order
- Case size
- Payment terms
- Credit limit
- Outstanding balance

The system should remember supplier-specific ordering rules.

---

## 16. "Generate Today's Orders"

Create a powerful feature:

**Generate Today's Orders**

The system analyzes all inventory and groups recommended purchases by supplier.

Example:

```text
Today's Recommended Purchases

Peak Freans
8 products
Rs. 42,500

Coca-Cola
5 products
Rs. 31,200

Unilever
7 products
Rs. 58,700

National Foods
4 products
Rs. 19,800
```

Show:

**Total Recommended Purchase**

Rs. 152,200

Allow the owner to review before creating orders.

---

## 17. Purchase Management

Support:

- Purchase order
- Purchase invoice
- Receive stock
- Partial receiving
- Purchase return
- Supplier payment
- Credit purchase
- Cash purchase
- Purchase price history

When stock is received:

Inventory must automatically update.

Supplier payable must update.

---

## 18. Customer Udhaar / Khata

Create a complete customer ledger.

Customer:

Ali

Transactions:

- Sale
- Payment
- Return
- Adjustment

Display:

- Total credit
- Total paid
- Outstanding
- Due date
- Aging

Support:

- Partial payments
- Customer statement
- Printable statement
- WhatsApp statement
- Credit limit
- Overdue alerts

---

## 19. Supplier Ledger

For each supplier:

- Purchases
- Payments
- Returns
- Adjustments
- Outstanding payable
- Due dates
- Payment history

---

## 20. Expense Management

Create categories:

- Rent
- Electricity
- Gas
- Internet
- Salary
- Transportation
- Repairs
- Packaging
- Maintenance
- Food
- Miscellaneous
- Owner withdrawal
- Other

Every expense should have:

- Amount
- Category
- Payment account
- Date
- Description
- Attachment/receipt
- User
- Branch

---

## 21. Cash Management

Support:

- Opening cash
- Cash sales
- Cash purchases
- Cash expenses
- Customer payments
- Supplier payments
- Owner withdrawals
- Cash transfers
- Cash adjustments

Create:

**Daily Cash Closing**

Expected cash:

Rs. 48,500

Actual cash:

Rs. 47,800

Difference:

Rs. -700

Require explanation for material discrepancies.

---

## 22. Easypaisa Retailer Module

This must be a separate module.

Do NOT treat Easypaisa as a normal shop sale.

Create:

**Easypaisa Retailer**

Dashboard:

- Opening balance
- Current balance
- Cash in
- Cash out
- Transaction count
- Transaction volume
- Commission earned
- Today's commission
- Monthly commission
- Expected balance
- Actual balance
- Difference

---

## 23. Easypaisa Transaction

Each transaction should support:

- Transaction type
- Cash in
- Cash out
- Customer
- Mobile number if required
- Transaction amount
- Customer fee
- Retailer commission
- Reference/transaction ID
- Payment method
- Date/time
- Staff member
- Status
- Notes

Commission must be configurable.

Do not hardcode commission rates.

---

## 24. Easypaisa Daily Reconciliation

Example:

Opening:

Rs. 50,000

Cash In:

+ Rs. 80,000

Cash Out:

- Rs. 45,000

Expected:

Rs. 85,000

Actual:

Rs. 84,500

Difference:

Rs. -500

Provide reconciliation.

---

## 25. JazzCash Retailer

Architect the retailer module so that JazzCash can be added using the same structure.

Do not duplicate code unnecessarily.

Create a generic:

**Financial Service Provider**

model.

Then providers can include:

- Easypaisa
- JazzCash
- Mobile Load
- Bill Payment
- Other services

---

## 26. Mobile Load / Bill Payment

Prepare architecture for:

- Mobile recharge
- Mobile packages
- Utility bills
- Internet bills
- Other retailer services

Each transaction should track:

- Amount
- Fee
- Commission
- Provider
- Reference
- Status

Actual provider API integrations can be added later.

---

## 27. Profit Calculation

The system must distinguish:

**Revenue**

**COGS**

**Gross Profit**

**Expenses**

**Net Profit**

Example:

Sales:

Rs. 100,000

COGS:

Rs. 75,000

Gross Profit:

Rs. 25,000

Expenses:

Rs. 8,000

Net Profit:

Rs. 17,000

Do NOT calculate profit simply as:

Sales - purchases

because inventory purchases and COGS are different concepts.

---

## 28. Cash Flow Intelligence

Create a dedicated:

**Cash Flow Dashboard**

Show:

- Cash in
- Cash out
- Inventory investment
- Supplier payments
- Customer receivables
- Owner withdrawals
- Expenses
- Current liquid funds
- Upcoming obligations

The system should explain why cash is low.

Example:

"Your cash position is lower because Rs. 120,000 was invested in inventory and Rs. 45,000 in supplier payments."

---

## 29. Reinvestment Advisor

Create:

**Can I Reinvest?**

Calculate:

Available liquid cash

minus:

Upcoming supplier payments

minus:

Upcoming expenses

minus:

Minimum cash reserve

Then compare with:

Recommended inventory purchases.

Show:

🟢 Safe

🟠 Caution

🔴 Do not reinvest yet

This must be presented as financial information/calculation, not guaranteed financial advice.

---

## 30. Dashboard

The owner dashboard should show:

### Today's Sales
Rs. X

### Today's Gross Profit
Rs. X

### Today's Net Profit
Rs. X

### Cash in Hand
Rs. X

### Bank
Rs. X

### Easypaisa
Rs. X

### JazzCash
Rs. X

### Customer Receivables
Rs. X

### Supplier Payables
Rs. X

### Inventory Value
Rs. X

Then:

### Alerts

- Critical low stock
- Reorder required
- Expiring products
- Customer overdue
- Supplier payment due
- Cash discrepancy
- Easypaisa discrepancy

---

## 31. Action Center

Create:

**What Needs My Attention?**

Example:

🔴 3 products may run out within 3 days.

🔴 Rs. 32,000 supplier payment due.

🔴 Rs. 4,200 cash discrepancy.

🟠 12 products below reorder point.

🟠 Rs. 48,000 customer credit overdue.

🟢 Sales increased 12% this week.

The system should prioritize actionable items.

---

## 32. AI Business Assistant

Create an AI assistant interface.

Owner can ask:

"What was today's sale?"

"How much profit did I make this month?"

"Where did my money go?"

"Which products are selling fastest?"

"What should I order from Peak Freans?"

"Which products are low?"

"How much money is tied up in stock?"

"Which supplier do I owe?"

"Who owes me money?"

"Can I afford to purchase Rs. 100,000 stock?"

"Which products have declining sales?"

"How much commission did I earn from Easypaisa?"

The AI must answer based ONLY on the tenant's authorized business data.

Never mix data between tenants.

AI should not invent numbers.

If data is missing, say so.

---

## 33. Reports

Build:

### Sales Reports
- Daily
- Weekly
- Monthly
- Custom range
- Product
- Category
- Staff
- Payment method

### Profit Reports
- Gross profit
- Net profit
- Product margin
- Category margin

### Inventory
- Stock
- Low stock
- Out of stock
- Fast moving
- Slow moving
- Dead stock
- Expiring
- Stock valuation

### Financial
- Cash flow
- Expenses
- Receivables
- Payables
- Owner withdrawals

### Retailer
- Easypaisa transactions
- Commission
- JazzCash
- Mobile load
- Bill payments

---

## 34. Product Analytics

For every product calculate:

- Units sold
- Revenue
- COGS
- Gross profit
- Margin
- Average daily sales
- Average weekly sales
- Average monthly sales
- Stock turnover
- Days of stock remaining
- Recommended reorder
- Sales trend

Classify:

🔥 Fast Moving

🟢 Normal

🟡 Slow Moving

🔴 Dead Stock

---

## 35. Expiry Management

Support:

- Batch
- Expiry date
- Quantity
- Supplier

Alerts:

- Expiring in 30 days
- Expiring in 15 days
- Expiring in 7 days
- Expired

Use FEFO logic where appropriate.

---

## 36. Staff & Permissions

Roles:

### Owner
Full access.

### Manager
Operations + reports.

### Cashier
POS + assigned transactions.

### Inventory Manager
Products + stock + receiving.

### Accountant
Financial reports + expenses.

Permissions must be granular.

Example:

Cashier should NOT be able to:

- Change product purchase price
- Delete sales
- View profit
- Modify expenses
- Access supplier balances

---

## 37. Audit Logs

Track important actions:

- Login
- Logout
- Product price change
- Stock adjustment
- Sale deletion
- Sale return
- Expense creation
- Expense modification
- Supplier payment
- Customer payment
- Cash adjustment
- Permission change
- Admin action

Store:

- User
- Device
- IP where appropriate
- Timestamp
- Action
- Before
- After

---

## 38. Notifications

Support:

- In-app notifications
- Browser notifications
- Email where configured
- WhatsApp integration architecture

Alerts:

- Low stock
- Critical stock
- Expiry
- Supplier due
- Customer overdue
- Cash discrepancy
- Daily report
- Weekly report
- Subscription expiry

---

## 39. WhatsApp

Prepare architecture for WhatsApp notifications.

Examples:

Daily report:

"Al Noor Mart Daily Report..."

Supplier order:

"Peak Freans Order..."

Customer statement:

"Your outstanding balance is..."

Do NOT hardcode a WhatsApp provider.

Create an integration layer so an official WhatsApp API/provider can be connected later.

---

## 40. Multiple Branches

The architecture should support:

Tenant

→ Branches

Example:

Al Noor Mart

├── Main Branch

├── Branch 2

└── Branch 3

Each branch should have:

- Inventory
- POS
- Cash
- Staff
- Expenses

Owner can see:

- Individual branch
- Consolidated business

Do not make multi-branch mandatory for Starter plan.

---

## 41. Security

Implement:

- Secure authentication
- Password hashing
- JWT/session strategy
- Refresh tokens where appropriate
- Tenant authorization middleware
- RBAC
- API authorization
- Input validation
- Rate limiting
- CSRF protection where applicable
- Secure headers
- Encryption for sensitive information
- Audit logs
- Database backups
- Restore strategy

NEVER trust tenant_id sent from the frontend.

Tenant context must be derived securely from authenticated identity/session.

---

## 42. Backup & Recovery

Create automated server backups.

Support:

- Daily backup
- Backup retention
- Database restore strategy
- Tenant-level recovery where possible

Offline data must not be lost if the browser is closed.

---

## 43. PWA

The application should be installable.

Users should be able to install it on:

- Windows
- Android
- Tablet
- Laptop

It should behave like an app.

Support:

- Offline mode
- Service worker
- App shell caching
- IndexedDB
- Background sync where supported

---

## 44. Responsive UI

Design mobile-first but optimize for desktop POS.

Support:

- Desktop
- Laptop
- Tablet
- Mobile

POS should be extremely fast.

Do not create unnecessary animations.

---

## 45. UI/UX

The interface should feel like a modern SaaS product.

Use:

- Clean cards
- Clear typography
- Strong hierarchy
- Simple navigation
- Search
- Keyboard shortcuts
- Responsive tables
- Status badges
- Charts
- Empty states
- Loading states
- Error states
- Confirmation dialogs

Avoid a cluttered traditional accounting-software interface.

The most important information should always be visible.

---

## 46. Pakistan Localization

Support:

- PKR
- Pakistan date formats
- English
- Urdu-ready UI
- Urdu product names
- Right-to-left support where required

Do not hardcode English strings.

Use i18n architecture.

---

## 47. Product Import

Create CSV/Excel import.

Allow shops to import:

- Products
- Opening stock
- Customers
- Suppliers
- Prices

Provide a downloadable template.

Validate data before importing.

Show import errors clearly.

---

## 48. Data Export

Allow tenant owners to export:

- Sales
- Purchases
- Products
- Inventory
- Customers
- Suppliers
- Expenses
- Financial reports

CSV/PDF where appropriate.

---

## 49. Onboarding

When a new shop subscribes:

Step 1:

Business name

Step 2:

Logo

Step 3:

Business type

Step 4:

Branch

Step 5:

Currency

Step 6:

Add products

Step 7:

Import products

Step 8:

Add suppliers

Step 9:

Add opening stock

Step 10:

Add opening cash

Step 11:

Create users

Step 12:

Start selling

The system should provide demo/sample data optionally.

---

## 50. SaaS Tenant Branding

Each tenant should be able to configure:

- Shop name
- Logo
- Primary color
- Receipt header
- Receipt footer
- Phone
- Address
- WhatsApp
- Tax information if applicable

Example:

Al Noor Mart

should see its own branding.

Another shop should see its own branding.

---

## 51. Billing Architecture

Build SaaS billing architecture but keep payment gateway integration modular.

Subscription status:

- Trial
- Active
- Past Due
- Expired
- Suspended
- Cancelled

Grace period should be configurable.

Do not immediately destroy data when a subscription expires.

---

## 52. Technical Requirements

Use a clean modular architecture.

Recommended stack:

Frontend:

- React
- TypeScript
- Vite
- Tailwind CSS or a clean component system
- PWA
- Dexie/IndexedDB

Backend:

- Node.js
- TypeScript
- REST API or modular API architecture

Database:

- MySQL 8 or PostgreSQL

ORM:

Use a mature ORM/query layer.

Authentication:

Secure session/JWT architecture.

Validation:

Zod or equivalent.

Testing:

- Unit tests
- Integration tests
- API tests
- Critical offline-sync tests
- Tenant isolation tests

---

## 53. Database Design

Before writing the full application, design the complete database schema.

Include entities for at minimum:

- tenants
- subscriptions
- plans
- users
- roles
- permissions
- branches
- devices
- products
- categories
- brands
- units
- unit_conversions
- suppliers
- customers
- sales
- sale_items
- purchases
- purchase_items
- purchase_orders
- inventory
- inventory_movements
- batches
- expenses
- cash_accounts
- financial_accounts
- account_transactions
- customer_ledger
- supplier_ledger
- retailer_providers
- retailer_transactions
- commissions
- notifications
- alerts
- audit_logs
- sync_queue
- sync_changes
- settings

Normalize the database properly.

Use indexes carefully.

Use foreign keys where appropriate.

Design for scale.

---

## 54. Accounting / Ledger Principle

Do not create isolated numbers that cannot be reconciled.

Important business events should generate corresponding financial/inventory movements.

Example:

SALE:

→ Sale record

→ Sale items

→ Inventory decrease

→ COGS calculation

→ Revenue

→ Payment account increase

→ Customer receivable if credit

Everything should remain traceable.

Similarly:

PURCHASE:

→ Purchase

→ Inventory increase

→ Supplier payable or cash decrease

This traceability is critical.

---

## 55. No Fake Data in Production

Demo data may be used in development.

But production calculations must always come from real records.

Never generate fake:

- sales
- profit
- inventory
- cash
- commissions
- supplier balances

---

## 56. Development Process

Do NOT immediately start generating thousands of lines of code.

First create:

### Phase 1 — Product Specification

Provide:

1. Complete architecture
2. Module map
3. User roles
4. Database ERD
5. Database schema
6. API architecture
7. Offline sync architecture
8. Tenant isolation strategy
9. Security model
10. Folder structure
11. Development roadmap

Then wait for approval.

After approval:

### Phase 2

Build:

- Authentication
- Tenant creation
- SaaS admin
- Database
- Product management
- Inventory

### Phase 3

Build:

- POS
- Sales
- Customers
- Udhaar
- Purchases
- Suppliers

### Phase 4

Build:

- Expenses
- Cash management
- Profit
- Financial reports

### Phase 5

Build:

- Easypaisa
- JazzCash architecture
- Commission
- Retailer reconciliation

### Phase 6

Build:

- Smart reorder
- Supplier order planner
- Peak Freans-style supplier ordering

### Phase 7

Build:

- Offline mode
- Sync engine
- Conflict resolution

### Phase 8

Build:

- AI assistant
- Notifications
- WhatsApp integration

### Phase 9

Build:

- SaaS billing
- Subscription management
- Multi-branch
- Advanced admin

### Phase 10

Testing, security audit, optimization and deployment.

---

## 57. Important Development Rule

At every phase:

1. Explain what you are going to build.
2. Show the architecture.
3. Implement it.
4. Run tests.
5. Fix errors.
6. Verify database migrations.
7. Verify tenant isolation.
8. Verify offline behavior where relevant.
9. Do not move forward while critical errors remain.

Do not pretend that a feature works if it has not been tested.

---

## 58. Deployment

The final system should be deployable to a cloud/VPS environment.

Prepare:

- Production environment variables
- Docker support
- Database migrations
- Seed scripts
- Backup scripts
- Health checks
- Logging
- Error handling
- Production build
- HTTPS
- Domain configuration

Architecture should allow:

```text
app.example.com
admin.example.com
api.example.com
```

or an equivalent production structure.

---

## 59. Future Mobile App

Do not build a native mobile app initially unless necessary.

Make the web application PWA-ready.

Later it should be possible to create:

- Android app
- iOS app

using the same backend/API.

---

## 60. Final Product Goal

The final application should make a shop owner feel:

> "I don't need to manually calculate my shop anymore."

They should be able to open the dashboard and immediately understand:

### How much did I sell?

### How much did I earn?

### How much did I actually profit?

### Where did my money go?

### How much cash do I have?

### How much money is stuck in stock?

### Who owes me money?

### Who do I owe?

### Which products are running low?

### What should I order?

### How many boxes should I order?

### From which supplier?

### How much should I spend on inventory?

### Can I safely reinvest?

### How much Easypaisa commission did I earn?

### What requires my attention today?

That is the core product.

Do not build merely another POS.

Build a **Retail Business Operating System for Pakistani small shops**.

---

# First Task

Do NOT start coding the complete application yet.

First analyze this specification and produce:

1. Recommended technology stack
2. Complete system architecture
3. Multi-tenant architecture
4. Offline-first architecture
5. Sync strategy
6. Complete database schema
7. ERD
8. API structure
9. Folder structure
10. User roles and permissions
11. SaaS subscription architecture
12. Security architecture
13. Module dependency map
14. Development phases
15. Risks and technical challenges
16. Recommended MVP
17. Features that should be postponed
18. Exact implementation order

Then wait for my approval before implementing Phase 1.
