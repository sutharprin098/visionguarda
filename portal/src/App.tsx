import { lazy, Suspense } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "./contexts/AuthContext";
import AppShell from "./components/AppShell";
import MarketingLayout from "./components/MarketingLayout";
import Home from "./pages/marketing/Home";
import SignIn from "./pages/SignIn";

import PermissionGuard from "./components/PermissionGuard";

// Everything below is only needed once a visitor goes past the landing page
// or signs in — lazy-loading it keeps the first paint (marketing site, sign
// in) off the 1.4MB bundle that used to ship on every single route.
const Features = lazy(() => import("./pages/marketing/Features"));
const Pricing = lazy(() => import("./pages/marketing/Pricing"));
const About = lazy(() => import("./pages/marketing/About"));
const Contact = lazy(() => import("./pages/marketing/Contact"));
const Privacy = lazy(() => import("./pages/marketing/Privacy"));
const Terms = lazy(() => import("./pages/marketing/Terms"));
const SecurityPolicy = lazy(() => import("./pages/marketing/SecurityPolicy"));
const SignUp = lazy(() => import("./pages/SignUp"));
const ForgotPassword = lazy(() => import("./pages/ForgotPassword"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const Dashboard = lazy(() => import("./pages/app/Dashboard"));
const OrganizationsPage = lazy(() => import("./pages/app/Organizations"));
const UsersPage = lazy(() => import("./pages/app/Users"));
const RolesPage = lazy(() => import("./pages/app/Roles"));
const LicensesPage = lazy(() => import("./pages/app/Licenses"));
const DevicesPage = lazy(() => import("./pages/app/Devices"));
const ActivationsPage = lazy(() => import("./pages/app/Activations"));
const CamerasPage = lazy(() => import("./pages/app/Cameras"));
const CameraGroupsPage = lazy(() => import("./pages/app/CameraGroups"));
const SitesPage = lazy(() => import("./pages/app/Sites"));
const AlertsPage = lazy(() => import("./pages/app/Alerts"));
const IncidentsPage = lazy(() => import("./pages/app/Incidents"));
const ReportsPage = lazy(() => import("./pages/app/Reports"));
const DownloadsPage = lazy(() => import("./pages/app/Downloads"));
const BillingPage = lazy(() => import("./pages/app/Billing"));
const AuditPage = lazy(() => import("./pages/app/Audit"));
const NotificationsPage = lazy(() => import("./pages/app/Notifications"));
const SettingsPage = lazy(() => import("./pages/app/Settings"));
const SupportPage = lazy(() => import("./pages/app/Support"));
const ModelLibraryPage = lazy(() => import("./pages/app/ModelLibrary"));

function Protected({ children }: { children: JSX.Element }) {
  const { session, loading } = useAuth();
  if (loading) {
    return <div className="flex h-screen items-center justify-center text-ink-3">Loading…</div>;
  }
  return session ? children : <Navigate to="/signin" replace />;
}

function RouteFallback() {
  return <div className="flex h-screen items-center justify-center text-ink-3">Loading…</div>;
}

export default function App() {
  return (
    <Suspense fallback={<RouteFallback />}>
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
    </Suspense>
  );
}
