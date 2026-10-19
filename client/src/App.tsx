import type { ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Spinner } from './components/ui';
import { useAuth } from './lib/auth';
import { AppDownloadPage } from './pages/AppDownload';
import { DashboardPage } from './pages/Dashboard';
import { LoginPage } from './pages/Login';
import { NotFoundPage } from './pages/NotFound';
import { ProfilePage } from './pages/Profile';
import { WorkOrderDetailPage } from './pages/WorkOrderDetail';
import { WorkOrderFormPage } from './pages/WorkOrderForm';
import { WorkOrderListPage } from './pages/WorkOrderList';

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner />
      </div>
    );
  }
  return user ? children : <Navigate to="/login" replace state={{ from: location.pathname }} />;
}

function RequireRole({ allowed, children }: { allowed: boolean; children: ReactNode }) {
  return allowed ? children : <Navigate to="/transaction/work-order" replace />;
}

export function App() {
  const { can } = useAuth();
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route path="/" element={<Navigate to="/dashboard/work-order" replace />} />
        <Route path="/dashboard/work-order" element={<DashboardPage />} />
        <Route path="/transaction/work-order">
          <Route index element={<WorkOrderListPage />} />
          <Route path="create" element={<RequireRole allowed={can('create')}><WorkOrderFormPage /></RequireRole>} />
          <Route path="update/:id" element={<RequireRole allowed={can('update')}><WorkOrderFormPage /></RequireRole>} />
          <Route path="details/:id" element={<WorkOrderDetailPage />} />
        </Route>
        <Route path="/app/work-order" element={<AppDownloadPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
