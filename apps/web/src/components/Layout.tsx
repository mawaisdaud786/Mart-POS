import {
  BarChart3,
  Boxes,
  LayoutDashboard,
  KeyRound,
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
import { Suspense, useEffect, useState, type ReactNode } from 'react';
import { NavLink, Outlet } from 'react-router';
import { useSession, type Area } from '../lib/session';
import { ChangePasswordModal } from './ChangePassword';
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
  const [changingPassword, setChangingPassword] = useState(false);
  const online = useOnline();
  const items = NAV.filter((n) => can(n.area));

  return (
    <div className="flex h-full">
      <aside
        className={cx(
          'fixed inset-y-0 left-0 z-40 flex w-64 flex-col bg-[#073b28] text-emerald-50/80 shadow-2xl shadow-emerald-950/20 transition-transform print:hidden lg:static lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex items-center gap-3 px-5 py-5">
          <div className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-xl bg-white p-0.5 shadow-sm ring-1 ring-white/20">
            <img src="/al-noor-mart-logo.jpeg" alt="Al Noor Mart" className="h-full w-full rounded-lg object-contain" />
          </div>
          <div className="min-w-0">
            <div className="truncate font-semibold text-white">{settings?.shopName ?? 'Al Noor Mart'}</div>
            <div className="text-xs text-emerald-100/65">Smart Shop Manager</div>
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
                  'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors',
                  isActive ? 'bg-white font-semibold text-[#0b4933] shadow-sm ring-1 ring-amber-300/70' : 'hover:bg-white/10 hover:text-white',
                )
              }
            >
              {n.icon}
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-white/10 p-3">
          <div className="flex items-center justify-between rounded-lg px-2 py-2">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-white">{user?.name}</div>
              <div className="text-xs capitalize text-emerald-100/65">{user?.role}</div>
            </div>
            <button onClick={() => setChangingPassword(true)} className="rounded-lg p-2 hover:bg-white/10 hover:text-white" title="Change my password">
              <KeyRound size={18} />
            </button>
            <button onClick={logout} className="rounded-lg p-2 hover:bg-white/10 hover:text-white" title="Sign out">
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </aside>
      {open && <div className="fixed inset-0 z-30 bg-black/30 lg:hidden" onClick={() => setOpen(false)} />}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-3 border-b border-emerald-950/5 bg-white/95 px-4 py-3 shadow-sm shadow-emerald-950/[0.02] backdrop-blur print:hidden lg:px-6">
          <button className="rounded-lg p-2 text-emerald-900 hover:bg-emerald-50 lg:hidden" onClick={() => setOpen(true)} aria-label="Menu">
            <Menu size={20} />
          </button>
          <div className="text-sm font-medium text-slate-600">
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
            {online ? 'Online' : 'No internet — cannot save'}
          </div>
        </header>
        <main className="flex-1 overflow-y-auto bg-[#e8eee9] p-4 lg:p-6">
          <Suspense fallback={<div className="rounded-2xl border border-slate-300 bg-white p-6 text-sm font-medium text-slate-700 shadow-md">Loading…</div>}><Outlet /></Suspense>
          <footer className="mx-auto mt-8 flex max-w-screen-2xl items-center justify-center gap-1.5 border-t border-slate-300 py-4 text-xs font-medium text-slate-600 print:hidden">
            <span>Powered by</span>
            <a href="https://mirwal.pk" target="_blank" rel="noreferrer" className="font-semibold text-emerald-800 transition-colors hover:text-amber-700">mirwal.pk</a>
          </footer>
        </main>
      </div>
      {changingPassword && <ChangePasswordModal onClose={() => setChangingPassword(false)} />}
    </div>
  );
}
