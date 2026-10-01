import {
  BarChart3,
  Boxes,
  CircleDollarSign,
  LayoutDashboard,
  LogOut,
  Menu,
  Package,
  ReceiptText,
  Settings,
  ShoppingCart,
  Smartphone,
  Truck,
  Users,
  Vault,
  Wallet,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, Outlet } from 'react-router';
import { useSession, type Area } from '../lib/session';
import { cx } from './ui';

const NAV: { to: string; label: string; icon: ReactNode; area: Area }[] = [
  { to: '/', label: 'Dashboard', icon: <LayoutDashboard size={18} />, area: 'dashboard' },
  { to: '/pos', label: 'POS / Sale', icon: <ShoppingCart size={18} />, area: 'pos' },
  { to: '/sales', label: 'Sales & Returns', icon: <ReceiptText size={18} />, area: 'sales' },
  { to: '/products', label: 'Products', icon: <Package size={18} />, area: 'products' },
  { to: '/inventory', label: 'Stock & Reorder', icon: <Boxes size={18} />, area: 'inventory' },
  { to: '/customers', label: 'Customers (Udhaar)', icon: <Users size={18} />, area: 'customers' },
  { to: '/suppliers', label: 'Suppliers & Purchases', icon: <Truck size={18} />, area: 'suppliers' },
  { to: '/expenses', label: 'Expenses', icon: <Wallet size={18} />, area: 'expenses' },
  { to: '/services', label: 'Easypaisa / JazzCash', icon: <Smartphone size={18} />, area: 'services' },
  { to: '/cash', label: 'Cash & Closing', icon: <Vault size={18} />, area: 'closing' },
  { to: '/reports', label: 'Reports', icon: <BarChart3 size={18} />, area: 'reports' },
  { to: '/settings', label: 'Settings', icon: <Settings size={18} />, area: 'settings' },
];

function useOnline() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

export function Layout() {
  const { user, settings, logout, can } = useSession();
  const [open, setOpen] = useState(false);
  const online = useOnline();
  const items = NAV.filter((n) => can(n.area));

  return (
    <div className="flex h-full">
      <aside
        className={cx(
          'fixed inset-y-0 left-0 z-40 flex w-64 flex-col bg-slate-900 text-slate-300 transition-transform print:hidden lg:static lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex items-center gap-2 px-5 py-5">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-brand-600 text-white">
            <CircleDollarSign size={20} />
          </div>
          <div className="min-w-0">
            <div className="truncate font-semibold text-white">{settings?.shopName ?? 'RetailOS'}</div>
            <div className="text-xs text-slate-400">RetailOS</div>
          </div>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3">
          {items.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === '/'}
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                cx(
                  'flex items-center gap-3 rounded-lg px-3 py-2 text-sm',
                  isActive ? 'bg-brand-600 text-white' : 'hover:bg-slate-800 hover:text-white',
                )
              }
            >
              {n.icon}
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-slate-800 p-3">
          <div className="flex items-center justify-between rounded-lg px-2 py-2">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-white">{user?.name}</div>
              <div className="text-xs capitalize text-slate-400">{user?.role}</div>
            </div>
            <button onClick={logout} className="rounded p-2 hover:bg-slate-800 hover:text-white" title="Lock / switch user">
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </aside>
      {open && <div className="fixed inset-0 z-30 bg-black/30 lg:hidden" onClick={() => setOpen(false)} />}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-2.5 print:hidden">
          <button className="rounded p-1.5 hover:bg-slate-100 lg:hidden" onClick={() => setOpen(true)} aria-label="Menu">
            <Menu size={20} />
          </button>
          <div className="text-sm text-slate-500">
            {new Date().toLocaleDateString('en-PK', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </div>
          <div
            className={cx(
              'flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium',
              online ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700',
            )}
            title="All data is saved on this computer and works without internet"
          >
            <span className={cx('h-2 w-2 rounded-full', online ? 'bg-emerald-500' : 'bg-amber-500')} />
            {online ? 'Online' : 'Offline — still working'}
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-4 lg:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
