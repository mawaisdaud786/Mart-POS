/**
 * Permission catalog (docs/phase-1/05-roles-permissions.md). Keys are stable identifiers
 * stored in the database; never rename one without a migration.
 */
export const PERMISSIONS = {
  pos: ['pos.use'],
  sales: [
    'sales.view_own',
    'sales.view_all',
    'sales.discount.line',
    'sales.discount.order',
    'sales.discount.above_limit',
    'sales.price_override',
    'sales.below_min_price',
    'sales.credit',
    'sales.return',
    'sales.return_without_receipt',
    'sales.void',
    'sales.reprint',
  ],
  cash: [
    'cash.session.open_close',
    'cash.session.view_expected',
    'cash.session.review',
    'cash.transfer',
    'cash.adjust',
  ],
  products: [
    'products.view',
    'products.create',
    'products.edit',
    'products.edit_price',
    'products.view_cost',
    'products.edit_cost',
    'products.delete',
    'products.import',
  ],
  inventory: ['inventory.view', 'inventory.adjust', 'inventory.count', 'inventory.transfer', 'inventory.view_value'],
  customers: [
    'customers.view',
    'customers.manage',
    'customers.view_balance',
    'customers.receive_payment',
    'customers.set_credit_limit',
    'customers.write_off',
  ],
  suppliers: ['suppliers.view', 'suppliers.manage', 'suppliers.view_balance', 'suppliers.pay'],
  purchasing: [
    'purchasing.view',
    'purchasing.create_po',
    'purchasing.receive',
    'purchasing.return',
    'reorder.view',
    'reorder.create_orders',
  ],
  expenses: ['expenses.view', 'expenses.create', 'expenses.edit_void', 'expenses.categories'],
  accounts: ['accounts.view_balances', 'accounts.manage', 'owner.drawings'],
  retailer: [
    'retailer.transact',
    'retailer.view_all',
    'retailer.reverse',
    'retailer.reconcile',
    'retailer.configure',
    'retailer.view_commission',
  ],
  reports: [
    'reports.sales',
    'reports.profit',
    'reports.inventory',
    'reports.financial',
    'reports.retailer',
    'reports.export',
    'dashboard.owner',
  ],
  ai: ['ai.use'],
  admin: [
    'users.manage',
    'roles.manage',
    'settings.manage',
    'branding.manage',
    'devices.manage',
    'billing.view',
    'billing.manage',
    'audit.view',
    'data.export_all',
    'sync.discard',
  ],
} as const;

export type PermissionModule = keyof typeof PERMISSIONS;
export type Permission = (typeof PERMISSIONS)[PermissionModule][number];

export const ALL_PERMISSIONS: readonly Permission[] = Object.values(PERMISSIONS).flat();

/** Permissions that expose cost/profit or move money; changes to them are always audited. */
export const SENSITIVE_PERMISSIONS: ReadonlySet<Permission> = new Set<Permission>([
  'products.view_cost',
  'products.edit_cost',
  'sales.void',
  'sales.return_without_receipt',
  'cash.adjust',
  'owner.drawings',
  'reports.profit',
  'dashboard.owner',
  'suppliers.pay',
  'users.manage',
  'roles.manage',
  'data.export_all',
  'sync.discard',
]);

export function isPermission(value: string): value is Permission {
  return (ALL_PERMISSIONS as readonly string[]).includes(value);
}

export type SystemRoleKey = 'owner' | 'manager' | 'cashier' | 'inventory_manager' | 'accountant';

const all = (...modules: PermissionModule[]): Permission[] => modules.flatMap((m) => [...PERMISSIONS[m]]);

/** Default role templates copied into every new tenant (docs/phase-1/05 matrix). */
export const SYSTEM_ROLES: Record<SystemRoleKey, { name: string; permissions: readonly Permission[] }> = {
  owner: { name: 'Owner', permissions: ALL_PERMISSIONS },
  manager: {
    name: 'Manager',
    permissions: [
      ...all('pos', 'sales', 'products', 'inventory', 'customers', 'suppliers', 'purchasing', 'expenses', 'reports', 'ai'),
      'cash.session.open_close',
      'cash.session.view_expected',
      'cash.session.review',
      'cash.transfer',
      'accounts.view_balances',
      'retailer.transact',
      'retailer.view_all',
      'retailer.reverse',
      'retailer.reconcile',
      'retailer.view_commission',
      'devices.manage',
    ],
  },
  cashier: {
    name: 'Cashier',
    permissions: [
      'pos.use',
      'sales.view_own',
      'sales.discount.line',
      'sales.credit',
      'sales.return',
      'sales.reprint',
      'cash.session.open_close',
      'products.view',
      'customers.view',
      'customers.receive_payment',
      'retailer.transact',
    ],
  },
  inventory_manager: {
    name: 'Inventory Manager',
    permissions: [
      'products.view',
      'products.create',
      'products.edit',
      'products.edit_price',
      'products.view_cost',
      'products.edit_cost',
      'products.import',
      ...all('inventory'),
      'suppliers.view',
      'suppliers.view_balance',
      'purchasing.view',
      'purchasing.create_po',
      'purchasing.receive',
      'purchasing.return',
      'reorder.view',
      'reorder.create_orders',
      'reports.inventory',
    ],
  },
  accountant: {
    name: 'Accountant',
    permissions: [
      'sales.view_all',
      'cash.session.review',
      'products.view',
      'products.view_cost',
      'inventory.view',
      'inventory.view_value',
      ...all('customers'),
      ...all('suppliers'),
      'purchasing.view',
      ...all('expenses'),
      'accounts.view_balances',
      'retailer.view_all',
      'retailer.reconcile',
      'retailer.view_commission',
      ...all('reports'),
      'ai.use',
      'audit.view',
    ],
  },
};
