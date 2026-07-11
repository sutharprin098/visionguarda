import { Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "./contexts/AuthContext";
import AppShell from "./components/AppShell";
import Landing from "./pages/Landing";
import SignIn from "./pages/SignIn";
import SignUp from "./pages/SignUp";
import Dashboard from "./pages/app/Dashboard";
import OrganizationsPage from "./pages/app/Organizations";
import UsersPage from "./pages/app/Users";
import RolesPage from "./pages/app/Roles";
import LicensesPage from "./pages/app/Licenses";
import DevicesPage from "./pages/app/Devices";
import ActivationsPage from "./pages/app/Activations";
import CamerasPage from "./pages/app/Cameras";
import CameraGroupsPage from "./pages/app/CameraGroups";
import SitesPage from "./pages/app/Sites";
import GisPage from "./pages/app/Gis";
import AnalyticsPage from "./pages/app/Analytics";
import AlertsPage from "./pages/app/Alerts";
import IncidentsPage from "./pages/app/Incidents";
import ReportsPage from "./pages/app/Reports";
import DownloadsPage from "./pages/app/Downloads";
import BillingPage from "./pages/app/Billing";
import AuditPage from "./pages/app/Audit";
import NotificationsPage from "./pages/app/Notifications";
import SettingsPage from "./pages/app/Settings";
import SupportPage from "./pages/app/Support";

function Protected({ children }: { children: JSX.Element }) {
  const { session, loading } = useAuth();
  if (loading) {
    return <div className="flex h-screen items-center justify-center text-ink-3">Loading…</div>;
  }
  return session ? children : <Navigate to="/signin" replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/signin" element={<SignIn />} />
      <Route path="/signup" element={<SignUp />} />
      <Route path="/app" element={<Protected><AppShell /></Protected>}>
        <Route index element={<Dashboard />} />
        <Route path="organizations" element={<OrganizationsPage />} />
        <Route path="users" element={<UsersPage />} />
        <Route path="roles" element={<RolesPage />} />
        <Route path="licenses" element={<LicensesPage />} />
        <Route path="devices" element={<DevicesPage />} />
        <Route path="activations" element={<ActivationsPage />} />
        <Route path="cameras" element={<CamerasPage />} />
        <Route path="camera-groups" element={<CameraGroupsPage />} />
        <Route path="sites" element={<SitesPage />} />
        <Route path="gis" element={<GisPage />} />
        <Route path="analytics" element={<AnalyticsPage />} />
        <Route path="alerts" element={<AlertsPage />} />
        <Route path="incidents" element={<IncidentsPage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="downloads" element={<DownloadsPage />} />
        <Route path="billing" element={<BillingPage />} />
        <Route path="audit" element={<AuditPage />} />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="support" element={<SupportPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
