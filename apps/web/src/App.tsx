import type { ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { Layout } from './components/Layout';
import { useSession, type Area } from './lib/session';
import { CashPage } from './pages/Cash';
import { CustomersPage } from './pages/Customers';
import { Dashboard } from './pages/Dashboard';
import { ExpensesPage } from './pages/Expenses';
import { InventoryPage } from './pages/Inventory';
import { Login } from './pages/Login';
import { PosPage } from './pages/Pos';
import { ProductsPage } from './pages/Products';
import { ReportsPage } from './pages/Reports';
import { SalesPage } from './pages/Sales';
import { ServicesPage } from './pages/Services';
import { SettingsPage } from './pages/Settings';
import { Setup } from './pages/Setup';
import { SuppliersPage } from './pages/Suppliers';

function Guard({ area, children }: { area: Area; children: ReactNode }) {
  const { can } = useSession();
  return can(area) ? <>{children}</> : <Navigate to={can('pos') ? '/pos' : '/'} replace />;
}

export function App() {
  const { ready, settings, user, can } = useSession();
  if (!ready) return null;
  if (!settings?.setupDone) return <Setup />;
  if (!user) return <Login />;

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={can('dashboard') ? <Dashboard /> : <Navigate to="/pos" replace />} />
        <Route path="pos" element={<Guard area="pos"><PosPage /></Guard>} />
        <Route path="sales" element={<Guard area="sales"><SalesPage /></Guard>} />
        <Route path="products" element={<Guard area="products"><ProductsPage /></Guard>} />
        <Route path="inventory" element={<Guard area="inventory"><InventoryPage /></Guard>} />
        <Route path="customers" element={<Guard area="customers"><CustomersPage /></Guard>} />
        <Route path="suppliers" element={<Guard area="suppliers"><SuppliersPage /></Guard>} />
        <Route path="expenses" element={<Guard area="expenses"><ExpensesPage /></Guard>} />
        <Route path="services" element={<Guard area="services"><ServicesPage /></Guard>} />
        <Route path="cash" element={<Guard area="closing"><CashPage /></Guard>} />
        <Route path="reports" element={<Guard area="reports"><ReportsPage /></Guard>} />
        <Route path="settings" element={<Guard area="settings"><SettingsPage /></Guard>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
