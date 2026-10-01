import { useLiveQuery } from 'dexie-react-hooks';
import { createContext, useContext, useState, type ReactNode } from 'react';
import { db, type Role, type ShopSettings, type User } from './db';

interface Session {
  /** False until the local database has answered (avoids flashing the login/setup screen). */
  ready: boolean;
  user: User | null;
  settings: ShopSettings | undefined;
  login: (user: User) => void;
  logout: () => void;
  can: (area: Area) => boolean;
}

/** Screens and sensitive data, by role. Cashiers don't see cost, profit or supplier money. */
export type Area =
  | 'dashboard'
  | 'pos'
  | 'sales'
  | 'products'
  | 'inventory'
  | 'customers'
  | 'suppliers'
  | 'purchases'
  | 'expenses'
  | 'services'
  | 'closing'
  | 'reports'
  | 'settings'
  | 'cost'
  | 'void';

const ACCESS: Record<Role, Area[] | 'all'> = {
  owner: 'all',
  manager: ['dashboard', 'pos', 'sales', 'products', 'inventory', 'customers', 'suppliers', 'purchases', 'expenses', 'services', 'closing', 'reports', 'cost', 'void'],
  cashier: ['pos', 'sales', 'customers', 'services', 'closing'],
};

const Ctx = createContext<Session | null>(null);
const KEY = 'retailos.userId';

export function SessionProvider({ children }: { children: ReactNode }) {
  const [userId, setUserId] = useState<string | null>(() => localStorage.getItem(KEY));
  const userQ = useLiveQuery(async () => (userId ? ((await db.users.get(userId)) ?? null) : null), [userId], 'loading' as const);
  const settingsQ = useLiveQuery(async () => (await db.settings.get('shop')) ?? null, [], 'loading' as const);
  const user = userQ === 'loading' ? null : userQ;

  const value: Session = {
    ready: userQ !== 'loading' && settingsQ !== 'loading',
    user: user && user.active ? user : null,
    settings: settingsQ === 'loading' || settingsQ === null ? undefined : settingsQ,
    login(u) {
      localStorage.setItem(KEY, u.id);
      setUserId(u.id);
    },
    logout() {
      localStorage.removeItem(KEY);
      setUserId(null);
    },
    can(area) {
      if (!user) return false;
      const access = ACCESS[user.role];
      return access === 'all' || access.includes(area);
    },
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
