import {
  LayoutDashboard, Building2, Users, ShieldCheck, KeyRound, MonitorSmartphone,
  MonitorCheck, Video, Layers, MapPin, BarChart3, BellRing, Siren,
  FileText, Download, CreditCard, ScrollText, Bell, Settings, LifeBuoy,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  perm?: string;
  superOnly?: boolean;
  end?: boolean;
}

export const NAV: { group: string; items: NavItem[] }[] = [
  {
    group: "Overview",
    items: [
      { to: "/app", label: "Dashboard", icon: LayoutDashboard, end: true },
      { to: "/app/organizations", label: "Organizations", icon: Building2, superOnly: true },
    ],
  },
  {
    group: "Directory",
    items: [
      { to: "/app/users", label: "Users", icon: Users, perm: "users.manage" },
      { to: "/app/roles", label: "Roles & Permissions", icon: ShieldCheck, perm: "roles.manage" },
    ],
  },
  {
    group: "Licensing",
    items: [
      { to: "/app/licenses", label: "Licenses", icon: KeyRound },
      { to: "/app/devices", label: "Devices", icon: MonitorSmartphone },
      { to: "/app/activations", label: "Desktop Activations", icon: MonitorCheck },
    ],
  },
  {
    group: "Surveillance",
    items: [
      { to: "/app/cameras", label: "Cameras", icon: Video },
      { to: "/app/camera-groups", label: "Camera Groups", icon: Layers, perm: "cameras.manage" },
      { to: "/app/sites", label: "Sites", icon: MapPin, perm: "cameras.manage" },
    ],
  },
  {
    group: "Intelligence",
    items: [
      { to: "/app/alerts", label: "Alerts", icon: BellRing, perm: "alerts.view" },
      { to: "/app/incidents", label: "Incidents", icon: Siren, perm: "alerts.view" },
      { to: "/app/reports", label: "Reports", icon: FileText, perm: "reports.view" },
    ],
  },
  {
    group: "Platform",
    items: [
      { to: "/app/downloads", label: "Downloads", icon: Download },
      { to: "/app/billing", label: "Billing", icon: CreditCard, perm: "org.manage" },
      { to: "/app/audit", label: "Audit Logs", icon: ScrollText, perm: "audit.view" },
      { to: "/app/notifications", label: "Notifications", icon: Bell },
      { to: "/app/settings", label: "Settings", icon: Settings },
      { to: "/app/support", label: "Support", icon: LifeBuoy },
    ],
  },
];
