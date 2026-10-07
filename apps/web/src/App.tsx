import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { Layout } from './components/Layout';
import { useSession, type Area } from './lib/session';
import { Login } from './pages/Login';
import { Setup } from './pages/Setup';

// Each screen is downloaded when first opened, so the first page loads quickly on a slow phone connection.
const CashPage = lazy(() => import('./pages/Cash').then((m) => ({ default: m.CashPage })));
const CustomersPage = lazy(() => import('./pages/Customers').then((m) => ({ default: m.CustomersPage })));
const Dashboard = lazy(() => import('./pages/Dashboard').then((m) => ({ default: m.Dashboard })));
const ExpensesPage = lazy(() => import('./pages/Expenses').then((m) => ({ default: m.ExpensesPage })));
const InventoryPage = lazy(() => import('./pages/Inventory').then((m) => ({ default: m.InventoryPage })));
const PosPage = lazy(() => import('./pages/Pos').then((m) => ({ default: m.PosPage })));
const ProductsPage = lazy(() => import('./pages/Products').then((m) => ({ default: m.ProductsPage })));
const ReportsPage = lazy(() => import('./pages/Reports').then((m) => ({ default: m.ReportsPage })));
const SalesPage = lazy(() => import('./pages/Sales').then((m) => ({ default: m.SalesPage })));
const ServicesPage = lazy(() => import('./pages/Services').then((m) => ({ default: m.ServicesPage })));
const SettingsPage = lazy(() => import('./pages/Settings').then((m) => ({ default: m.SettingsPage })));
const SuppliersPage = lazy(() => import('./pages/Suppliers').then((m) => ({ default: m.SuppliersPage })));

function Guard({ area, children }: { area: Area; children: ReactNode }) {
  const { can } = useSession();
  return can(area) ? <>{children}</> : <Navigate to={can('pos') ? '/pos' : '/'} replace />;
}

export function App() {
  const { ready, user, can, setupDone, has, logout } = useSession();
  if (!ready) return null;
  if (!user) return <Login />;
  if (setupDone === undefined) return null;
  if (!setupDone) {
    return has('settings.manage') ? (
      <Setup />
    ) : (
      <div className="grid min-h-full place-items-center p-6 text-center">
        <div>
          <h1 className="text-xl font-bold">The shop is not set up yet</h1>
          <p className="mt-2 text-slate-600">Ask the owner to sign in and finish the first-time setup.</p>
          <button className="mt-4 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50" onClick={logout}>
            Sign out
          </button>
        </div>
      </div>
    );
  }

  return (
    <Suspense fallback={<div className="p-6 text-sm text-slate-500">Loading…</div>}>
    <Routes>
      <Route element={<Layout />}>
        <Route index element={can('dashboard') ? <Dashboard /> : <Navigate to="/pos" replace />} />
        <Route path="pos" element={<Guard area="pos"><PosPage /></Guard>} />
        <Route path="sales" element={<Guard area="sales"><SalesPage /></Guard>} />
        <Route path="products" element={<Guard area="products"><ProductsPage /></Guard>} />
        <Route path="inventory" element={<Guard area="inventory"><InventoryPage /></Guard>} />
        <Route path="customers" element={<Guard area="customers"><CustomersPage /></Guard>} />
        <Route path="ghar-se-ghar-tak" element={<Navigate to="/pos" replace />} />
        <Route path="suppliers" element={<Guard area="suppliers"><SuppliersPage /></Guard>} />
        <Route path="expenses" element={<Guard area="expenses"><ExpensesPage /></Guard>} />
        <Route path="services" element={<Guard area="services"><ServicesPage /></Guard>} />
        <Route path="cash" element={<Guard area="closing"><CashPage /></Guard>} />
        <Route path="reports" element={<Guard area="reports"><ReportsPage /></Guard>} />
        <Route path="settings" element={<Guard area="settings"><SettingsPage /></Guard>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
    </Suspense>
  );
}
