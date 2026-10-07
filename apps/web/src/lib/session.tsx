import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { ApiError, apiRequest, logoutApiSession, refreshApiSession, setAccessToken, type ApiSession } from './api';
import { db, type Role, type ShopSettings, type User } from './db';
import { resetStore, setPermissions, startSync, stopSync, useLiveQuery } from './store';

interface Session {
  /** False until we know whether someone is signed in (avoids flashing the login screen). */
  ready: boolean;
  user: User | null;
  settings: ShopSettings | undefined;
  /** True once the owner has done the first-time shop setup; undefined while we are asking. */
  setupDone: boolean | undefined;
  permissions: ReadonlySet<string>;
  /** Called by the login screen after the server accepts the password. */
  signIn: (session: ApiSession) => void;
  logout: () => void;
  can: (area: Area) => boolean;
  /** Plain permission check for finer decisions (e.g. 'sales.price_override'). */
  has: (permission: string) => boolean;
}

/** Screens and sensitive data. What each person gets is decided by their role's permissions on the server. */
export type Area =
  | 'dashboard'
  | 'pos'
  | 'sales'
  | 'products'
  | 'inventory'
  | 'customers'
  | 'customerBalance'
  | 'customerPayment'
  | 'gharSettings'
  | 'ration'
  | 'suppliers'
  | 'purchases'
  | 'expenses'
  | 'services'
  | 'closing'
  | 'reports'
  | 'settings'
  | 'cost'
  | 'priceEdit'
  | 'void';

/** For each screen: holding any one of these server permissions opens it. */
const AREA_PERMISSIONS: Record<Area, string[]> = {
  dashboard: ['dashboard.owner', 'reports.sales'],
  pos: ['pos.use'],
  sales: ['sales.view_own', 'sales.view_all'],
  products: ['products.view'],
  inventory: ['inventory.view'],
  customers: ['customers.view'],
  customerBalance: ['customers.view_balance'],
  customerPayment: ['customers.receive_payment'],
  gharSettings: ['settings.manage'],
  ration: ['customers.manage'],
  suppliers: ['suppliers.view'],
  purchases: ['purchasing.view'],
  expenses: ['expenses.view'],
  services: ['retailer.transact'],
  closing: ['cash.session.open_close'],
  reports: ['reports.sales', 'reports.profit', 'reports.inventory', 'reports.financial'],
  settings: ['settings.manage'],
  cost: ['products.view_cost', 'reports.profit'],
  priceEdit: ['products.edit_price'],
  void: ['sales.void'],
};

const Ctx = createContext<Session | null>(null);

/** Signed out after this long without a click, key press or touch: a shop computer left unattended must not stay open. */
export const IDLE_LOGOUT_MS = 30 * 60_000;

// Remembered only in memory, to explain on the login screen why someone was signed out.
let signedOutForIdle = false;
export function consumeIdleNotice(): boolean {
  const was = signedOutForIdle;
  signedOutForIdle = false;
  return was;
}

function roleFrom(session: ApiSession): Role {
  const name = session.membership.roleName.toLowerCase();
  if (name.includes('owner') || session.permissions.includes('users.manage')) return 'owner';
  if (name.includes('manager') || session.permissions.includes('sales.view_all')) return 'manager';
  return 'cashier';
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<ApiSession | null>(null);
  const [checked, setChecked] = useState(false);

  // Page reload: the HttpOnly cookie may still hold a valid sign-in.
  useEffect(() => {
    let active = true;
    refreshApiSession()
      .then((s) => {
        if (active) setSession(s);
      })
      .catch(() => setAccessToken(null))
      .finally(() => {
        if (active) setChecked(true);
      });
    return () => {
      active = false;
    };
  }, []);

  // Whenever the signed-in person changes, start with an empty memory and keep up with other terminals.
  const sessionKey = session ? `${session.tenant.id}:${session.user.id}` : '';
  useEffect(() => {
    resetStore();
    if (!sessionKey) return;
    startSync();
    return stopSync;
  }, [sessionKey]);

  const settings = useLiveQuery(() => (session ? db.settings.get('shop') : undefined), [sessionKey]);
  const state = useLiveQuery(() => (session ? apiRequest<{ setupDone: boolean }>('/shop/state') : undefined), [sessionKey, settings?.setupDone]);

  const permissions = new Set(session?.permissions ?? []);
  // Set while rendering so that queries started by this render already know what the person may read.
  setPermissions(permissions);
  const user: User | null = session ? { id: session.user.id, name: session.user.name, role: roleFrom(session), active: true } : null;

  const doLogout = () => {
    setAccessToken(null);
    setSession(null);
    void logoutApiSession();
  };

  const signedIn = !!session;
  const lastActive = useRef(Date.now());
  useEffect(() => {
    if (!signedIn) return;
    lastActive.current = Date.now();
    const bump = () => {
      lastActive.current = Date.now();
    };
    const events = ['pointerdown', 'keydown', 'touchstart', 'wheel'] as const;
    for (const e of events) window.addEventListener(e, bump, { passive: true });
    const timer = setInterval(() => {
      if (Date.now() - lastActive.current < IDLE_LOGOUT_MS) return;
      signedOutForIdle = true;
      doLogout();
    }, 15_000);
    return () => {
      for (const e of events) window.removeEventListener(e, bump);
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn]);

  const value: Session = {
    ready: checked,
    user,
    settings,
    setupDone: session ? state?.setupDone : undefined,
    permissions,
    signIn(s) {
      setAccessToken(s.accessToken);
      setSession(s);
    },
    logout: doLogout,
    can: (area) => AREA_PERMISSIONS[area].some((p) => permissions.has(p)),
    has: (permission) => permissions.has(permission),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): Session {
  const s = useContext(Ctx);
  if (!s) throw new Error('useSession outside provider');
  return s;
}

/** The logged-in user (only call inside screens that require login). */
export function useUser(): User {
  const { user } = useSession();
  if (!user) throw new Error('Not logged in');
  return user;
}

/** Names of the people who work in this shop, by id (for receipts and "sold by"). */
export function usePeopleNames(): Map<string, string> {
  const { user } = useSession();
  const people = useLiveQuery(() => (user ? apiRequest<{ id: string; name: string }[]>('/shop/people') : []), [user?.id]) ?? [];
  return new Map(people.map((p) => [p.id, p.name]));
}

export { ApiError };
