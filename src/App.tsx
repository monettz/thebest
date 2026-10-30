import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import { useLang } from '@/i18n';
import { AppShell } from '@/components/layout/AppShell';
import { Spinner } from '@/components/ui';
import { useSupabaseRealtime } from '@/lib/useSupabaseRealtime';

// Each screen is its own chunk, so the first load only downloads what the first screen needs.
const Audit = lazy(() => import('@/pages/Audit'));
const Customers = lazy(() => import('@/pages/Customers'));
const Dashboard = lazy(() => import('@/pages/Dashboard'));
const Debts = lazy(() => import('@/pages/Debts'));
const Expenses = lazy(() => import('@/pages/Expenses'));
const Login = lazy(() => import('@/pages/Login'));
const More = lazy(() => import('@/pages/More'));
const POS = lazy(() => import('@/pages/POS'));
const Products = lazy(() => import('@/pages/Products'));
const Receipt = lazy(() => import('@/pages/Receipt'));
const Reports = lazy(() => import('@/pages/Reports'));
const SaleDetail = lazy(() => import('@/pages/SaleDetail'));
const Sales = lazy(() => import('@/pages/Sales'));
const Settings = lazy(() => import('@/pages/Settings'));
const Users = lazy(() => import('@/pages/Users'));
const StoreDashboard = lazy(() => import('@/pages/StoreDashboard'));
const Movements = lazy(() => import('@/pages/stock/Movements'));
const Receive = lazy(() => import('@/pages/stock/Receive'));
const StockIn = lazy(() => import('@/pages/stock/StockIn'));
const StockTake = lazy(() => import('@/pages/stock/StockTake'));
const Suppliers = lazy(() => import('@/pages/stock/Suppliers'));

function OwnerOnly({ children }: { children: JSX.Element }) {
  const { isOwner } = useAuth();
  return isOwner ? children : <Navigate to="/" replace />;
}

export default function App() {
  // Subscribing here makes the whole route tree re-render when the language changes (tr() reads the current language).
  useLang();
  // Enable live Supabase Realtime synchronization across all tabs and devices
  useSupabaseRealtime();
  return (
    <Suspense fallback={<div className="p-6"><Spinner /></div>}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/receipts/:saleId" element={<Receipt />} />
        <Route element={<AppShell />}>
          <Route index element={<Dashboard />} />
          <Route path="pos" element={<POS />} />
          <Route path="stock-in" element={<StockIn />} />
          <Route path="products" element={<Products />} />
          <Route path="customers" element={<Customers />} />
          <Route path="debts" element={<Debts />} />
          <Route path="sales" element={<Sales />} />
          <Route path="sales/:saleId" element={<SaleDetail />} />
          <Route path="expenses" element={<Expenses />} />
          <Route path="reports" element={<Reports />} />
          <Route path="audit" element={<OwnerOnly><Audit /></OwnerOnly>} />
          <Route path="settings" element={<OwnerOnly><Settings /></OwnerOnly>} />
          <Route path="users" element={<OwnerOnly><Users /></OwnerOnly>} />
          <Route path="more" element={<More />} />
          <Route path="store" element={<StoreDashboard />} />
          <Route path="store/receive" element={<Receive />} />
          <Route path="store/suppliers" element={<OwnerOnly><Suppliers /></OwnerOnly>} />
          <Route path="store/movements" element={<Movements />} />
          <Route path="store/stock-take" element={<StockTake />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
