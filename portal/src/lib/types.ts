export interface Organization {
  id: string;
  org_code: string;
  name: string;
  kind: "personal" | "organization";
  plan: string;
  is_active: boolean;
  created_at: string;
}

export interface Profile {
  id: string;
  org_id: string;
  user_code: string;
  full_name: string;
  email: string;
  status: "active" | "suspended" | "locked" | "disabled";
  is_super_admin: boolean;
  created_at: string;
}

export interface Role {
  id: string;
  org_id: string;
  name: string;
  is_system: boolean;
}

export interface License {
  id: string;
  org_id: string;
  user_id: string | null;
  key_hint: string;
  kind: "user" | "admin";
  license_type: "personal" | "enterprise" | "trial" | "lifetime" | "subscription";
  status: "active" | "inactive" | "expired" | "suspended" | "revoked" | "pending";
  max_devices: number;
  expires_at: string | null;
  created_at: string;
}

export interface Device {
  id: string;
  org_id: string;
  user_id: string | null;
  name: string;
  status: "active" | "deactivated" | "removed";
  fingerprint_hash: string;
  os_info: Record<string, unknown>;
  hardware: { cpu?: string; ram_gb?: number; gpu?: string; machine_id?: string };
  is_online: boolean;
  last_ip: string | null;
  country: string;
  last_seen_at: string | null;
  created_at: string;
}

export interface Alert {
  id: string;
  org_id: string;
  camera_id: string | null;
  kind: string;
  severity: "info" | "warning" | "critical";
  title: string;
  detail: Record<string, unknown>;
  snapshot_path: string | null;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
  created_at: string;
}

export interface ThreadEntry {
  by: string;
  by_name: string;
  at: string;
  text: string;
}

export interface Incident {
  id: string;
  org_id: string;
  alert_id: string | null;
  camera_id: string | null;
  title: string;
  description: string;
  severity: "info" | "warning" | "critical";
  status: "open" | "investigating" | "resolved" | "closed";
  assigned_to: string | null;
  notes: ThreadEntry[];
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface SupportTicket {
  id: string;
  org_id: string;
  user_id: string | null;
  subject: string;
  priority: "low" | "normal" | "high" | "urgent";
  status: "open" | "pending" | "closed";
  category: "general" | "bug" | "feature_request";
  thread: ThreadEntry[];
  created_at: string;
  updated_at: string;
}

export interface Report {
  id: string;
  org_id: string;
  name: string;
  kind: "daily" | "weekly" | "monthly" | "custom";
  format: "csv" | "xlsx" | "pdf";
  params: Record<string, unknown>;
  row_count: number;
  storage_path: string;
  created_by: string | null;
  created_at: string;
}

export interface Camera {
  id: string;
  org_id: string;
  name: string;
  source_type: "rtsp" | "usb" | "onvif" | "ip" | "nvr" | "dvr";
  status: "online" | "offline" | "error";
  is_enabled: boolean;
  site_id: string | null;
  created_at: string;
}

export interface AuditLog {
  id: number;
  actor_email: string;
  action: string;
  target_type: string;
  target_id: string;
  ip: string | null;
  detail: Record<string, unknown>;
  created_at: string;
}

export interface GithubRelease {
  version: string;
  tag_name: string;
  name: string;
  release_notes: string;
  published_at: string;
  prerelease: boolean;
  asset_id: number | null;
  asset_name: string | null;
  size_bytes: number;
  content_type: string;
  download_url: string | null;
}
