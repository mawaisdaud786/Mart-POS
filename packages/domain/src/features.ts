/**
 * Plan features (entitlements). Plans are data in the database; this is only the catalog of
 * keys the code checks, plus the default plan seed. Prices are never hardcoded in logic.
 */
export const FEATURES = {
  pos: 'Point of sale',
  inventory: 'Inventory',
  expenses: 'Expenses',
  basic_reports: 'Basic reports',
  udhaar: 'Customer udhaar / khata',
  advanced_inventory: 'Batches, expiry, stock counts',
  supplier_planner: 'Smart reorder and supplier order planner',
  financial_reports: 'Financial reports',
  retailer_services: 'Easypaisa / JazzCash / load / bills',
  whatsapp: 'WhatsApp reports and sharing',
  advanced_alerts: 'Advanced alerts',
  ai_assistant: 'AI business assistant',
  advanced_analytics: 'Advanced analytics',
  multi_branch: 'Multiple branches',
  advanced_permissions: 'Custom roles',
  api_access: 'API access',
} as const;

export type FeatureKey = keyof typeof FEATURES;
export const ALL_FEATURES = Object.keys(FEATURES) as FeatureKey[];

export interface PlanLimits {
  users: number;
  branches: number;
  devices: number;
  products: number;
  storageMb: number;
}

export interface PlanSeed {
  code: string;
  name: string;
  trialDays: number;
  limits: PlanLimits;
  features: readonly FeatureKey[];
}

const STARTER: readonly FeatureKey[] = ['pos', 'inventory', 'expenses', 'basic_reports'];
const BUSINESS: readonly FeatureKey[] = [
  ...STARTER,
  'udhaar',
  'advanced_inventory',
  'supplier_planner',
  'financial_reports',
  'retailer_services',
  'whatsapp',
  'advanced_alerts',
];

/** Initial plans. Prices are set by the platform admin (admin panel), so they are not here. */
export const DEFAULT_PLANS: readonly PlanSeed[] = [
  {
    code: 'starter',
    name: 'Starter',
    trialDays: 14,
    limits: { users: 2, branches: 1, devices: 2, products: 3000, storageMb: 250 },
    features: STARTER,
  },
  {
    code: 'business',
    name: 'Business',
    trialDays: 14,
    limits: { users: 6, branches: 1, devices: 4, products: 20000, storageMb: 1000 },
    features: BUSINESS,
  },
  {
    code: 'professional',
    name: 'Professional',
    trialDays: 14,
    limits: { users: 25, branches: 5, devices: 15, products: 100000, storageMb: 5000 },
    features: ALL_FEATURES,
  },
];

export interface Entitlements {
  features: ReadonlySet<FeatureKey>;
  limits: PlanLimits;
}

/** Plan features + per-tenant overrides → effective entitlements. */
export function resolveEntitlements(
  planFeatures: readonly string[],
  planLimits: PlanLimits,
  overrides?: { features?: Partial<Record<string, boolean>>; limits?: Partial<PlanLimits> } | null,
): Entitlements {
  const features = new Set<FeatureKey>(planFeatures.filter((f): f is FeatureKey => f in FEATURES));
  for (const [key, enabled] of Object.entries(overrides?.features ?? {})) {
    if (!(key in FEATURES)) continue;
    if (enabled) features.add(key as FeatureKey);
    else features.delete(key as FeatureKey);
  }
  return { features, limits: { ...planLimits, ...overrides?.limits } };
}
