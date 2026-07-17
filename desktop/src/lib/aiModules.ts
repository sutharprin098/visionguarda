// Which detection classes the operator wants to see, persisted per camera.
//
// IMPORTANT — what this is and is not:
//
// This is an OVERLAY/ALERT FILTER, not a pipeline switch. The engine runs one
// model (yolox_tiny) whose single forward pass emits every class in
// backend.py's COCO_CLASS_MAP at once. Turning "Vehicles" off therefore saves
// exactly ZERO inference time — there is no separate vehicle detector to skip.
// Anything claiming otherwise in the UI would be false.
//
// A real per-module inference saving only exists for a module backed by its own
// model (e.g. a Haar/YuNet face pass). None ship today.

/** Mirrors server/app/analytics.py _object_category() — keep in sync. */
export type ModuleKey = "person" | "vehicle" | "item" | "face";

export interface AiModule {
  key: ModuleKey;
  label: string;
  /** Exactly the COCO_CLASS_MAP names (backend.py:31) in this category, or
   *  "face", which comes from the separate YuNet pass (server/app/ai/face.py). */
  classes: string[];
  /** True when the module has its own model, so switching it off genuinely
   *  skips inference. Everything else shares yolox's single forward pass and
   *  is filter-only — the distinction is surfaced in the UI tooltip rather
   *  than pretending all toggles are equal. */
  ownModel?: boolean;
}

export const AI_MODULES: AiModule[] = [
  { key: "person", label: "Person Detection", classes: ["person"] },
  { key: "vehicle", label: "Vehicle Detection", classes: ["bicycle", "car", "motorcycle", "bus", "truck"] },
  { key: "item", label: "Unattended Items", classes: ["backpack", "umbrella", "handbag", "suitcase"] },
  // Enabled per-camera in the zone-profile editor (face_detection), which is
  // what actually gates the engine-side pass; this entry only controls whether
  // the boxes are drawn.
  { key: "face", label: "Face Detection", classes: ["face"], ownModel: true },
];

export type ModuleState = Record<ModuleKey, boolean>;

export const DEFAULT_MODULES: ModuleState = { person: true, vehicle: true, item: true, face: true };

const KEY = (cameraId: string) => `camai.modules.${cameraId}`;

export function loadModules(cameraId: string): ModuleState {
  try {
    const raw = localStorage.getItem(KEY(cameraId));
    if (!raw) return { ...DEFAULT_MODULES };
    const parsed = JSON.parse(raw);
    // Merge over defaults so a key added in a later version doesn't come back
    // undefined and silently read as "off".
    return { ...DEFAULT_MODULES, ...parsed };
  } catch {
    return { ...DEFAULT_MODULES };
  }
}

export function saveModules(cameraId: string, state: ModuleState): void {
  try { localStorage.setItem(KEY(cameraId), JSON.stringify(state)); } catch { /* private mode */ }
}

const enabledClasses = (state: ModuleState): Set<string> => {
  const out = new Set<string>();
  for (const m of AI_MODULES) if (state[m.key]) m.classes.forEach((c) => out.add(c));
  return out;
};

/** Classes the engine can emit but no module claims (traffic_light, stop_sign).
 *  Shown only when a module owning them is on — never silently dropped without
 *  the operator having asked. */
export function filterDetections<T extends { class: string }>(dets: T[], state: ModuleState): T[] {
  const allow = enabledClasses(state);
  return dets.filter((d) => allow.has(d.class));
}

export function activeModules(state: ModuleState): AiModule[] {
  return AI_MODULES.filter((m) => state[m.key]);
}
