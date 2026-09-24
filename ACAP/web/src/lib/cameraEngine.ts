// Camera Engine Bridge for Axis ACAP Embedded Web Environment (100% Local - 0 Cloud - 0 License Lock)
import type { ZoneProfileKey, ProfileFeatures } from './zoneProfiles';
import type { EditableShape } from './zoneEditor';

export interface CameraInfo {
  id: string;
  name: string;
  source_type: string;
  status: string;
  zone_profile?: ZoneProfileKey | null;
}

export interface ConfigVersion {
  id: string;
  version: number;
  comment?: string;
  published_at: string;
  status: "active" | "rolled_back";
  snapshot?: {
    shapes: EditableShape[];
    profile: ZoneProfileKey;
    features: ProfileFeatures;
  };
}

export interface CompiledCameraConfig {
  version: number;
  timestamp: string;
  zone_profile: ZoneProfileKey;
  zones: EditableShape[];
  lines: EditableShape[];
  features: ProfileFeatures;
  cloud_bypass: boolean;
  status: "active";
}

export interface EnrolledTarget {
  target_id: string;
  name: string;
  threshold: number;
  created_at: number;
  thumbnail?: string;
  has_face?: boolean;
}

const STORAGE_KEYS = {
  SHAPES: 'camai_acap_drawings',
  ACTIVE_PROFILE: 'camai_acap_active_profile',
  FEATURES: 'camai_acap_features',
  VERSIONS: 'camai_acap_versions',
  TARGETS: 'camai_acap_targets',
  ACTIVE_COMPILED: 'camai_compiled_active_config',
};

// Stream URL: on Axis camera this resolves to the camera's real MJPEG feed
export function getCameraStreamUrl(): string {
  if (typeof window === 'undefined') return '/axis-cgi/mjpg/video.cgi?resolution=1280x720&compression=30&fps=15';
  return `${window.location.origin}/axis-cgi/mjpg/video.cgi?resolution=1280x720&compression=30&fps=15`;
}

export function getCameraSnapshotUrl(): string {
  if (typeof window === 'undefined') return '/axis-cgi/jpg/image.cgi?resolution=1280x720&compression=30';
  return `${window.location.origin}/axis-cgi/jpg/image.cgi?resolution=1280x720&compression=30`;
}

// Full Unlocked Enterprise Edge License (No License Restrictions)
export function getLicenseStatus(): { licensed: boolean; type: string; tier: string } {
  return {
    licensed: true,
    type: "unlimited_edge",
    tier: "CamAI Enterprise Unlimited",
  };
}

// Load persisted shapes - returns empty array by default (Zero pre-drawn shapes)
export function loadShapesFromStorage(): EditableShape[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.SHAPES);
    if (raw) {
      const parsed: EditableShape[] = JSON.parse(raw);
      // Filter out any legacy dummy shapes so screen starts 100% clean
      return parsed.filter(s => s.id !== 'default_zone_1' && s.id !== 'default_line_1');
    }
  } catch (e) {
    console.error('Failed to load shapes from storage:', e);
  }
  return [];
}


export function saveShapesToStorage(shapes: EditableShape[]): void {
  try {
    localStorage.setItem(STORAGE_KEYS.SHAPES, JSON.stringify(shapes));
  } catch (e) {
    console.error('Failed to save shapes to storage:', e);
  }
}

// Load / save active AI profile
export function loadActiveProfile(): ZoneProfileKey {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.ACTIVE_PROFILE) as ZoneProfileKey;
    if (raw) return raw;
  } catch {}
  return 'traffic';
}

export function saveActiveProfile(profile: ZoneProfileKey): void {
  try {
    localStorage.setItem(STORAGE_KEYS.ACTIVE_PROFILE, profile);
  } catch {}
}

// Load / save features
export function loadFeatures(): ProfileFeatures {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.FEATURES);
    if (raw) return JSON.parse(raw);
  } catch {}
  return {};
}

export function saveFeatures(features: ProfileFeatures): void {
  try {
    localStorage.setItem(STORAGE_KEYS.FEATURES, JSON.stringify(features));
  } catch {}
}

// Load / save publish timeline
export function loadVersions(): ConfigVersion[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.VERSIONS);
    if (raw) return JSON.parse(raw);
  } catch {}
  return [
    {
      id: 'v_init',
      version: 1,
      comment: 'Initial edge camera zone configuration (Local)',
      published_at: new Date().toISOString(),
      status: 'active',
      snapshot: {
        shapes: loadShapesFromStorage(),
        profile: loadActiveProfile(),
        features: loadFeatures(),
      }
    }
  ];
}

export function saveVersions(versions: ConfigVersion[]): void {
  try {
    localStorage.setItem(STORAGE_KEYS.VERSIONS, JSON.stringify(versions));
  } catch {}
}

// Target matcher enrollments
export function loadEnrolledTargets(): EnrolledTarget[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.TARGETS);
    if (raw) return JSON.parse(raw);
  } catch {}
  return [];
}

export function saveEnrolledTargets(targets: EnrolledTarget[]): void {
  try {
    localStorage.setItem(STORAGE_KEYS.TARGETS, JSON.stringify(targets));
  } catch {}
}

// ----------------------------------------------------------------------
// 100% LOCAL PUBLISHING ENGINE (Zero Cloud Dependencies - No Recording)
// ----------------------------------------------------------------------

export async function publishConfigLocally(
  shapes: EditableShape[],
  profile: ZoneProfileKey,
  features: ProfileFeatures,
  comment: string
): Promise<CompiledCameraConfig> {
  const versions = loadVersions();
  const currentVer = versions[0]?.version || 0;
  const newVer = currentVer + 1;

  const compiled: CompiledCameraConfig = {
    version: newVer,
    timestamp: new Date().toISOString(),
    zone_profile: profile,
    zones: shapes.filter(s => s.type !== 'line'),
    lines: shapes.filter(s => s.type === 'line'),
    features,
    cloud_bypass: true,
    status: 'active',
  };

  // 1. Save compiled config to camera memory/localStorage
  localStorage.setItem(STORAGE_KEYS.ACTIVE_COMPILED, JSON.stringify(compiled));
  saveShapesToStorage(shapes);
  saveActiveProfile(profile);
  saveFeatures(features);

  // 2. Add to local publish versions history with snapshot for instant rollback
  const updatedVersions: ConfigVersion[] = [
    {
      id: `v_${Date.now()}`,
      version: newVer,
      comment: comment.trim() || `Local publish v${newVer} (${profile})`,
      published_at: new Date().toISOString(),
      status: 'active',
      snapshot: {
        shapes: JSON.parse(JSON.stringify(shapes)),
        profile,
        features: JSON.parse(JSON.stringify(features)),
      },
    },
    ...versions.map(v => ({ ...v, status: 'rolled_back' as const })),
  ];
  saveVersions(updatedVersions);

  // 3. Post to local camera VAPIX / daemon endpoint (best-effort local loopback)
  try {
    if (typeof window !== 'undefined') {
      const payload = JSON.stringify(compiled);
      fetch('/local/camai_acap/config.cgi', {
        method: 'POST',
        body: payload,
      }).catch(() => { /* offline / embedded sandbox safe */ });

      // Notify any active live view / workspace in real-time
      window.dispatchEvent(new CustomEvent('camai:local_config_published', { detail: compiled }));
    }
  } catch (e) {
    console.warn('Local camera notification:', e);
  }

  return compiled;
}

export function rollbackConfigLocally(versionNum: number): {
  shapes: EditableShape[];
  profile: ZoneProfileKey;
  features: ProfileFeatures;
} | null {
  const versions = loadVersions();
  const target = versions.find(v => v.version === versionNum);
  if (!target || !target.snapshot) return null;

  const { shapes, profile, features } = target.snapshot;
  saveShapesToStorage(shapes);
  saveActiveProfile(profile);
  saveFeatures(features);

  const updatedVersions = versions.map(v => ({
    ...v,
    status: (v.version === versionNum ? 'active' : 'rolled_back') as 'active' | 'rolled_back',
  }));
  saveVersions(updatedVersions);

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('camai:local_config_published', {
      detail: {
        version: versionNum,
        zone_profile: profile,
        zones: shapes.filter(s => s.type !== 'line'),
        lines: shapes.filter(s => s.type === 'line'),
        features,
        status: 'active',
      }
    }));
  }

  return target.snapshot;
}

