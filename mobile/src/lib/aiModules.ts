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
export type ModuleKey = "person" | "vehicle" | "item" | "animal" | "face";

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
  { key: "animal", label: "Animals & Pets", classes: ["dog", "cat", "cow", "horse", "sheep", "animal"] },
  { key: "item", label: "Unattended Items", classes: ["backpack", "umbrella", "handbag", "suitcase"] },
  // Enabled per-camera in the zone-profile editor (face_detection), which is
  // what actually gates the engine-side pass; this entry only controls whether
  // the boxes are drawn.
  { key: "face", label: "Face Detection", classes: ["face"], ownModel: true },
];

export type ModuleState = Record<ModuleKey, boolean>;

export const DEFAULT_MODULES: ModuleState = { person: true, vehicle: true, animal: true, item: true, face: true };

const KEY = (cameraId: string) => `camai.modules.${cameraId}`;

/**
 * Always the defaults — and the stale key is actively cleaned up.
 *
 * This used to read `camai.modules.<cameraId>` back out of localStorage. The UI
 * that WROTE that key (the camera card's "Active AI" chip row) was deleted when
 * AI-mode configuration moved to Admin Studio and became a server-side,
 * RLS-guarded property of the camera (`cameras.zone_profile`, applied by
 * analytics.PROFILE_CLASSES). Nothing has called saveModules since.
 *
 * So the only value the key could still hold is one written by a since-removed
 * control, and any operator who had switched a module off before that release
 * was left with those detections permanently hidden and NO WAY IN THE PRODUCT
 * to turn them back on — a blank overlay on a working camera, persisted per
 * machine, surviving reinstall of everything but the profile directory.
 *
 * Class narrowing is the server's job now. The client draws what it is sent.
 */
export function loadModules(cameraId: string): ModuleState {
  try { localStorage.removeItem(KEY(cameraId)); } catch { /* private mode */ }
  return { ...DEFAULT_MODULES };
}

const enabledClasses = (state: ModuleState): Set<string> => {
  const out = new Set<string>();
  for (const m of AI_MODULES) if (state[m.key]) m.classes.forEach((c) => out.add(c));
  return out;
};

/** Every class some module in AI_MODULES claims, regardless of on/off state.
 *  A class in here is governed by its module's toggle; a class NOT in here is
 *  governed by nobody and must therefore always be drawn — see below. */
const CLAIMED_CLASSES: ReadonlySet<string> = new Set(AI_MODULES.flatMap((m) => m.classes));

/**
 * Keep the detections whose owning module is switched on.
 *
 * A class no module claims PASSES THROUGH. This is the whole point and it was
 * previously inverted: the filter was a strict allowlist built only from
 * AI_MODULES, so any class outside those four modules was silently discarded
 * before it ever reached the canvas.
 *
 * That quietly deleted every class the traffic build exists to show. The engine
 * can emit `helmet`, `no_helmet` (ai/helmet.py), `number_plate` (ai/plate.py),
 * `traffic_light` and `stop_sign` (COCO_CLASS_MAP) — and analytics.py's
 * PROFILE_CLASSES["traffic"] narrows a traffic camera to exactly
 * {car,bus,truck,motorcycle,bicycle,traffic_light,stop_sign,helmet,no_helmet,
 * number_plate}. None of the last five appeared in any module's `classes`, so
 * on a helmet/ANPR camera the filter returned [] for detections the engine had
 * genuinely produced. Workspace then gated the overlay on
 * `shownDetections.length > 0`, so the canvas did not even mount: no boxes, no
 * labels, no track IDs, no error — indistinguishable from "the AI isn't
 * running". DetectionOverlay already has colours and labels for all of them.
 *
 * The toggles keep working exactly as before for the classes they own; only
 * unowned classes changed behaviour, from "always dropped" to "always drawn".
 */
export function filterDetections<T extends { class: string }>(dets: T[], state: ModuleState): T[] {
  if (!Array.isArray(dets)) return [];
  const allow = enabledClasses(state);
  return dets.filter((d) => d && d.class && (allow.has(d.class) || !CLAIMED_CLASSES.has(d.class)));
}

export function activeModules(state: ModuleState): AiModule[] {
  return AI_MODULES.filter((m) => state[m.key]);
}

// saveModules() was removed along with its only caller (the camera card's
// "Active AI" chip row). Re-adding a per-machine class filter without a visible
// control to reverse it is how the blank-overlay bug happened; if per-operator
// overlay filtering is wanted again, it needs UI next to the video.
