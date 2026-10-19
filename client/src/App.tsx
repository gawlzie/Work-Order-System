import type { ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Spinner } from './components/ui';
import { useAuth } from './lib/auth';
import { AppDownloadPage } from './pages/AppDownload';
import { DashboardPage } from './pages/Dashboard';
import { EmployeeMasterPage } from './pages/master/EmployeeMaster';
import { RoleMasterPage } from './pages/master/RoleMaster';
import { StepMasterPage } from './pages/master/StepMaster';
import { CategoryMasterPage } from './pages/master/CategoryMaster';
import { UnitMasterPage } from './pages/master/UnitMaster';
import { AccountPage } from './pages/mechanic/AccountPage';
import { JobPage } from './pages/mechanic/JobPage';
import { JobsPage } from './pages/mechanic/JobsPage';
import { MechanicLayout } from './pages/mechanic/MechanicLayout';
import { NewJobPage } from './pages/mechanic/NewJobPage';
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

function RequireRole({ allowed, children, fallback = '/transaction/work-order' }: { allowed: boolean; children: ReactNode; fallback?: string }) {
  return allowed ? children : <Navigate to={fallback} replace />;
}

export function App() {
  const { can } = useAuth();
  // Field users (progress steps but do not approve) start in the mechanic web app; admins start on the dashboard.
  const home = can('wo.progress') && !can('wo.approve') ? '/m' : '/dashboard/work-order';
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/m"
        element={
          <RequireAuth>
            <MechanicLayout />
          </RequireAuth>
        }
      >
        <Route index element={<JobsPage />} />
        <Route path="wo/:id" element={<JobPage />} />
        <Route path="new" element={<RequireRole allowed={can('wo.create')} fallback="/m"><NewJobPage /></RequireRole>} />
        <Route path="account" element={<AccountPage />} />
        <Route path="*" element={<Navigate to="/m" replace />} />
      </Route>
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route path="/" element={<Navigate to={home} replace />} />
        <Route path="/dashboard/work-order" element={<DashboardPage />} />
        <Route path="/transaction/work-order">
          <Route index element={<WorkOrderListPage />} />
          <Route path="create" element={<RequireRole allowed={can('wo.create')}><WorkOrderFormPage /></RequireRole>} />
          <Route path="update/:id" element={<RequireRole allowed={can('wo.update')}><WorkOrderFormPage /></RequireRole>} />
          <Route path="details/:id" element={<WorkOrderDetailPage />} />
        </Route>
        <Route path="/master/unit" element={<RequireRole allowed={can('master.unit')}><UnitMasterPage /></RequireRole>} />
        <Route path="/master/employee" element={<RequireRole allowed={can('master.employee')}><EmployeeMasterPage /></RequireRole>} />
        <Route path="/master/role" element={<RequireRole allowed={can('master.role')}><RoleMasterPage /></RequireRole>} />
        <Route path="/master/step" element={<RequireRole allowed={can('master.step')}><StepMasterPage /></RequireRole>} />
        <Route path="/master/category" element={<RequireRole allowed={can('master.category')}><CategoryMasterPage /></RequireRole>} />
        <Route path="/app/work-order" element={<AppDownloadPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
