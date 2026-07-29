import { Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "./contexts/AuthContext";
import AppShell from "./components/AppShell";
import MarketingLayout from "./components/MarketingLayout";
import Home from "./pages/marketing/Home";
import Features from "./pages/marketing/Features";
import Pricing from "./pages/marketing/Pricing";
import About from "./pages/marketing/About";
import Contact from "./pages/marketing/Contact";
import Privacy from "./pages/marketing/Privacy";
import Terms from "./pages/marketing/Terms";
import SecurityPolicy from "./pages/marketing/SecurityPolicy";
import SignIn from "./pages/SignIn";
import SignUp from "./pages/SignUp";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
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
import AlertsPage from "./pages/app/Alerts";
import IncidentsPage from "./pages/app/Incidents";
import ReportsPage from "./pages/app/Reports";
import DownloadsPage from "./pages/app/Downloads";
import BillingPage from "./pages/app/Billing";
import AuditPage from "./pages/app/Audit";
import NotificationsPage from "./pages/app/Notifications";
import SettingsPage from "./pages/app/Settings";
import SupportPage from "./pages/app/Support";
import ModelLibraryPage from "./pages/app/ModelLibrary";

import PermissionGuard from "./components/PermissionGuard";

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
      <Route element={<MarketingLayout />}>
        <Route path="/" element={<Home />} />
        <Route path="/features" element={<Features />} />
        <Route path="/pricing" element={<Pricing />} />
        <Route path="/about" element={<About />} />
        <Route path="/contact" element={<Contact />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/terms" element={<Terms />} />
        <Route path="/security" element={<SecurityPolicy />} />
      </Route>
      <Route path="/signin" element={<SignIn />} />
      <Route path="/signup" element={<SignUp />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/app" element={<Protected><AppShell /></Protected>}>
        <Route index element={<Dashboard />} />
        <Route path="organizations" element={<PermissionGuard perm="org.manage" moduleName="Organizations"><OrganizationsPage /></PermissionGuard>} />
        <Route path="users" element={<PermissionGuard perm="users.manage" moduleName="User Directory"><UsersPage /></PermissionGuard>} />
        <Route path="roles" element={<PermissionGuard perm="roles.manage" moduleName="Roles & Permissions"><RolesPage /></PermissionGuard>} />
        <Route path="licenses" element={<PermissionGuard perm="licenses.manage" moduleName="License Management"><LicensesPage /></PermissionGuard>} />
        <Route path="devices" element={<PermissionGuard perm="devices.manage" moduleName="Device Management"><DevicesPage /></PermissionGuard>} />
        <Route path="activations" element={<PermissionGuard perm="devices.manage" moduleName="Desktop Activations"><ActivationsPage /></PermissionGuard>} />
        <Route path="cameras" element={<PermissionGuard perm="cameras.manage" moduleName="Cameras Grid"><CamerasPage /></PermissionGuard>} />
        <Route path="camera-groups" element={<PermissionGuard perm="cameras.manage" moduleName="Camera Groups"><CameraGroupsPage /></PermissionGuard>} />
        <Route path="sites" element={<PermissionGuard perm="cameras.manage" moduleName="Site Locations"><SitesPage /></PermissionGuard>} />
        <Route path="models" element={<PermissionGuard perm="ai.configure" moduleName="AI Engine Models"><ModelLibraryPage /></PermissionGuard>} />
        <Route path="alerts" element={<PermissionGuard perm="alerts.view" moduleName="Real-Time Alerts"><AlertsPage /></PermissionGuard>} />
        <Route path="incidents" element={<PermissionGuard perm="alerts.view" moduleName="Incidents Desk"><IncidentsPage /></PermissionGuard>} />
        <Route path="reports" element={<PermissionGuard perm="reports.view" moduleName="System Reports"><ReportsPage /></PermissionGuard>} />
        <Route path="downloads" element={<DownloadsPage />} />
        <Route path="billing" element={<PermissionGuard perm="org.manage" moduleName="Billing & Subscriptions"><BillingPage /></PermissionGuard>} />
        <Route path="audit" element={<PermissionGuard perm="audit.view" moduleName="Audit Logs"><AuditPage /></PermissionGuard>} />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route path="settings" element={<PermissionGuard perm="org.manage" moduleName="Organization Settings"><SettingsPage /></PermissionGuard>} />
        <Route path="support" element={<SupportPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
