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
  os_info: Record<string, unknown>;
  last_seen_at: string | null;
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

export interface AppRelease {
  id: string;
  version: string;
  channel: string;
  platform: string;
  storage_path: string;
  sha256: string;
  size_bytes: number;
  release_notes: string;
  min_os: string;
  published_at: string;
}
