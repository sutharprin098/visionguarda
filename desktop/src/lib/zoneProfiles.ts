// ============================================================
// Zone Profiles — enterprise feature catalog (source of truth)
// ------------------------------------------------------------
// The Zone Management UI no longer exposes a flat list of zone
// types. Instead the operator picks one of four *profiles*
// (Traffic / Security / Factory / Custom); each profile is a
// category that dynamically loads an editable tree of AI
// features. This module declares those features and the shape of
// their editable parameters. The chosen values persist to
// public.zone_profile_configs.features as:
//   { "<feature_key>": { "enabled": bool, "params": { ... } } }
// ============================================================

export type ZoneProfileKey = "traffic" | "security" | "factory" | "custom";

export type ParamType =
  | "toggle"
  | "slider"
  | "number"
  | "select"
  | "classes"
  | "schedule";

export interface FeatureParam {
  key: string;
  label: string;
  type: ParamType;
  help?: string;
  // slider / number
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  // select
  options?: { value: string; label: string }[];
  // classes (multi-select of detection classes)
  classOptions?: string[];
  default: unknown;
}

export type FeatureGroup =
  | "Detection"
  | "Tracking & Counting"
  | "Events & Violations"
  | "Analytics"
  | "Recognition"
  | "Safety"
  | "ROI & Zones"
  | "Schedule"
  | "Alerts";

export interface FeatureDef {
  key: string;
  label: string;
  description: string;
  group: FeatureGroup;
  /** Feature needs one or more drawn geometries in the ROI editor to work. */
  requiresGeometry?: "zone" | "line" | "direction";
  /** Enabled by default when a fresh profile config is created. */
  defaultEnabled?: boolean;
  /**
   * Set when NO model in this build can produce what the feature claims, so the
   * toggle cannot do anything. The UI must show this and refuse to enable it.
   *
   * These are not merely "unimplemented" — until 2026-07-17 each was wired to a
   * fabrication that produced confident, wrong output:
   *   - fire/smoke: an HSV colour threshold. Measured on ordinary street
   *     footage containing neither, it raised a smoke alarm on 200/200 frames
   *     (it read concrete pavement as a smoke plume).
   *   - PPE: an HSV check of the top 18% of a person box, emitted at a
   *     hardcoded 0.95 confidence. On people wearing no PPE it invented helmets
   *     on 16% of checks and vests on 22%, flickering frame to frame.
   * Those were removed. Showing an inert switch is honest; showing a switch
   * that cries wolf is not. Real support needs a trained model, and the licence
   * matters as much as the accuracy — nearly every public fire/smoke/PPE model
   * is YOLOv5/v8-derived and therefore AGPL-3.0, which this product moved off
   * deliberately (see LICENSING.md, and app/ai/face.py for the MIT/Apache route
   * taken to make face detection real).
   */
  unavailable?: string;
  /** Special panels rendered by the UI instead of a param card. */
  kind?: "feature" | "roi_editor" | "schedule" | "alerts";
  params: FeatureParam[];
}

export interface ProfileDef {
  key: ZoneProfileKey;
  label: string;
  tagline: string;
  description: string;
  /** Tailwind accent hue used for the profile chrome. */
  accent: string;
  /** Ordered feature groups this profile renders. */
  groupOrder: FeatureGroup[];
  features: FeatureDef[];
}

// ---- shared detection class vocabularies -------------------

export const VEHICLE_CLASSES = ["car", "truck", "bus", "motorcycle", "bicycle", "van", "person"];
export const SECURITY_CLASSES = ["person", "backpack", "handbag", "suitcase", "knife", "gun"];
export const FACTORY_CLASSES = ["person", "helmet", "vest", "gloves", "shoes", "forklift", "no_helmet", "no_vest"];
export const COCO_CLASSES = [
  "person", "bicycle", "car", "motorcycle", "airplane", "bus", "train", "truck",
  "backpack", "handbag", "suitcase", "bottle", "cell phone", "laptop",
];

// ---- reusable param builders -------------------------------

const confidence = (def = 0.4): FeatureParam => ({
  key: "confidence",
  label: "Confidence Threshold",
  type: "slider",
  min: 0.1,
  max: 0.95,
  step: 0.05,
  default: def,
  help: "Minimum model confidence for a detection to count.",
});

const classes = (opts: string[], def: string[]): FeatureParam => ({
  key: "classes",
  label: "Object Classes",
  type: "classes",
  classOptions: opts,
  default: def,
});

const directionParam: FeatureParam = {
  key: "direction",
  label: "Count Direction",
  type: "select",
  options: [
    { value: "both", label: "Both ways" },
    { value: "in", label: "In only" },
    { value: "out", label: "Out only" },
  ],
  default: "both",
};

const seconds = (key: string, label: string, def: number, help?: string): FeatureParam => ({
  key,
  label,
  type: "number",
  min: 1,
  max: 3600,
  step: 1,
  unit: "s",
  default: def,
  help,
});

// Panels shared by every profile that has them.
const roiEditor: FeatureDef = {
  key: "roi_editor",
  label: "ROI Editor",
  description: "Draw the polygons, rectangles, circles and lines this profile's features reference.",
  group: "ROI & Zones",
  kind: "roi_editor",
  defaultEnabled: true,
  params: [],
};

const scheduleFeature: FeatureDef = {
  key: "schedule",
  label: "Schedule",
  description: "Restrict analytics to specific days and hours; outside the window the profile is idle.",
  group: "Schedule",
  kind: "schedule",
  params: [
    {
      key: "mode",
      label: "Active Window",
      type: "select",
      options: [
        { value: "always", label: "Always on (24/7)" },
        { value: "business", label: "Business hours (Mon–Fri 08:00–18:00)" },
        { value: "night", label: "Overnight (18:00–06:00)" },
        { value: "custom", label: "Custom window" },
      ],
      default: "always",
    },
    { key: "start", label: "Start", type: "schedule", default: "08:00" },
    { key: "end", label: "End", type: "schedule", default: "18:00" },
  ],
};

const alertRules: FeatureDef = {
  key: "alert_rules",
  label: "Alert Rules",
  description: "Map feature events to actions: notification, clip recording, or webhook.",
  group: "Alerts",
  kind: "alerts",
  defaultEnabled: true,
  params: [],
};

// ============================================================
// TRAFFIC
// ============================================================
const TRAFFIC: ProfileDef = {
  key: "traffic",
  label: "Traffic",
  tagline: "Roads, intersections & parking",
  description: "Vehicle analytics for roadways, junctions and car parks — flow, violations and enforcement.",
  accent: "sky",
  groupOrder: ["Detection", "Tracking & Counting", "Events & Violations", "Analytics", "ROI & Zones", "Schedule", "Alerts"],
  features: [
    {
      key: "lane_detection", label: "Lane Detection", group: "Detection", requiresGeometry: "zone", defaultEnabled: true,
      // Honest as-is: there is no lane *segmentation* model, and none is needed.
      // analytics._lane_for_point() attributes a vehicle to whichever zone the
      // operator drew with zoneType "lane". Worth stating so the confidence
      // slider isn't read as tuning a model that doesn't exist.
      description: "Attributes each vehicle to whichever zone you drew as a lane. Geometry-based — draw one zone per lane; no lane-segmentation model is involved.",
      params: [confidence(0.4)],
    },
    {
      key: "vehicle_detection", label: "Vehicle Detection", group: "Detection", defaultEnabled: true,
      description: "Detect vehicles across the frame.",
      params: [confidence(0.4), classes(VEHICLE_CLASSES, ["car", "truck", "bus", "motorcycle"])],
    },
    {
      key: "vehicle_classification", label: "Vehicle Classification", group: "Detection",
      description: "Sub-classify detected vehicles (sedan / truck / bus / two-wheeler).",
      params: [confidence(0.45)],
    },
    {
      key: "multi_object_tracking", label: "Multi Object Tracking", group: "Tracking & Counting", defaultEnabled: true,
      description: "Assign persistent IDs across frames for counting, speed and direction.",
      params: [
        { key: "tracker", label: "Tracker", type: "select", default: "bytetrack", options: [
          { value: "bytetrack", label: "ByteTrack" }, { value: "botsort", label: "BoT-SORT" }, { value: "ocsort", label: "OC-SORT" },
        ] },
        { key: "max_age", label: "Max Lost Frames", type: "number", min: 5, max: 300, step: 5, default: 60 },
        { key: "min_hits", label: "Min Hits to Confirm", type: "number", min: 1, max: 10, step: 1, default: 3 },
      ],
    },
    {
      key: "vehicle_counting", label: "Vehicle Counting", group: "Tracking & Counting", requiresGeometry: "line",
      description: "Count vehicles crossing a counting line.",
      params: [directionParam, classes(VEHICLE_CLASSES, ["car", "truck", "bus"])],
    },
    {
      key: "line_crossing", label: "Line Crossing", group: "Events & Violations", requiresGeometry: "line",
      description: "Fire an event whenever a tracked object crosses a line.",
      params: [directionParam],
    },
    {
      key: "wrong_way_detection", label: "Wrong Way Detection", group: "Events & Violations", requiresGeometry: "direction",
      description: "Flag vehicles moving against the permitted direction of travel.",
      params: [
        { key: "allowed_direction", label: "Allowed Direction", type: "select", default: "north", options: [
          { value: "north", label: "Northbound ↑" }, { value: "south", label: "Southbound ↓" },
          { value: "east", label: "Eastbound →" }, { value: "west", label: "Westbound ←" },
        ] },
        { key: "min_speed", label: "Min Speed to Flag", type: "number", min: 0, max: 120, step: 1, unit: "km/h", default: 5 },
      ],
    },
    {
      key: "speed_estimation", label: "Speed Estimation", group: "Events & Violations", requiresGeometry: "line",
      description: "Estimate speed from a calibrated distance and flag over-limit vehicles.",
      params: [
        { key: "speed_limit", label: "Speed Limit", type: "number", min: 5, max: 200, step: 5, unit: "km/h", default: 60 },
        { key: "calibration_m", label: "Calibration Distance", type: "number", min: 1, max: 500, step: 1, unit: "m", default: 20, help: "Real-world distance between the two calibration lines." },
      ],
    },
    {
      key: "queue_length", label: "Queue Length", group: "Analytics", requiresGeometry: "zone",
      description: "Measure standing queue length inside a zone.",
      params: [seconds("stationary_seconds", "Stationary Time", 5, "How long a vehicle must be still to join the queue."),
        { key: "alert_count", label: "Alert Above", type: "number", min: 1, max: 200, step: 1, unit: "veh", default: 10 }],
    },
    {
      key: "traffic_density", label: "Traffic Density", group: "Analytics", requiresGeometry: "zone",
      description: "Report occupancy density of a road segment.",
      params: [{ key: "high_threshold", label: "High Density At", type: "slider", min: 0.1, max: 1, step: 0.05, default: 0.6, unit: "occupancy" }],
    },
    {
      key: "illegal_parking", label: "Illegal Parking", group: "Events & Violations", requiresGeometry: "zone",
      description: "Flag vehicles stopped in a no-parking zone beyond a grace period.",
      params: [seconds("grace_seconds", "Grace Period", 60)],
    },
    {
      key: "stop_line_violation", label: "Stop Line Violation", group: "Events & Violations", requiresGeometry: "line",
      description: "Flag vehicles crossing the stop line on red.",
      params: [{ key: "signal_source", label: "Signal State Source", type: "select", default: "detector", options: [
        { value: "detector", label: "On-frame light detector" }, { value: "manual", label: "External signal input" },
      ] }],
    },
    {
      key: "u_turn_detection", label: "U-Turn Detection", group: "Events & Violations",
      description: "Detect vehicles performing a U-turn.",
      params: [{ key: "min_angle", label: "Min Turn Angle", type: "slider", min: 90, max: 180, step: 5, unit: "°", default: 150 }],
    },
    {
      key: "anpr", label: "ANPR", group: "Recognition", defaultEnabled: false,
      description: "Automatic number plate recognition on detected vehicles.",
      unavailable: "No plate detector or OCR ships in this build — ANPR needs both, and neither exists here. The Plate Region setting has nothing to configure.",
      params: [confidence(0.5), { key: "region", label: "Plate Region", type: "select", default: "auto", options: [
        { value: "auto", label: "Auto" }, { value: "eu", label: "Europe" }, { value: "us", label: "North America" }, { value: "in", label: "India" }, { value: "me", label: "Middle East" },
      ] }],
    },
    {
      key: "traffic_light_violation", label: "Traffic Light Violation", group: "Events & Violations", requiresGeometry: "line",
      description: "Combine signal state and line crossing to flag red-light running.",
      params: [seconds("grace_seconds", "Amber Grace", 2)],
    },
    roiEditor,
    scheduleFeature,
    alertRules,
  ],
};

// ============================================================
// SECURITY
// ============================================================
const SECURITY: ProfileDef = {
  key: "security",
  label: "Security",
  tagline: "Perimeter, intrusion & safety",
  description: "People-centric surveillance — intrusion, loitering, crowd, abandoned objects, face and fire/smoke.",
  accent: "rose",
  groupOrder: ["Detection", "Events & Violations", "Analytics", "Tracking & Counting", "Recognition", "Safety", "ROI & Zones", "Schedule", "Alerts"],
  features: [
    {
      key: "person_detection", label: "Person Detection", group: "Detection", defaultEnabled: true,
      description: "Detect people across the frame.",
      params: [confidence(0.4)],
    },
    {
      key: "intrusion_detection", label: "Intrusion Detection", group: "Events & Violations", requiresGeometry: "zone", defaultEnabled: true,
      description: "Alert when a person enters a protected zone.",
      params: [confidence(0.4), { key: "sensitivity", label: "Sensitivity", type: "select", default: "normal", options: [
        { value: "low", label: "Low" }, { value: "normal", label: "Normal" }, { value: "high", label: "High" },
      ] }],
    },
    {
      key: "restricted_area", label: "Restricted Area", group: "Events & Violations", requiresGeometry: "zone",
      description: "Access-controlled zone — any presence is a violation.",
      params: [classes(SECURITY_CLASSES, ["person"])],
    },
    {
      key: "perimeter_protection", label: "Perimeter Protection", group: "Events & Violations", requiresGeometry: "line",
      description: "Trip-wire crossing on a perimeter fence line.",
      params: [directionParam],
    },
    {
      key: "dwell_time", label: "Dwell Time", group: "Analytics", requiresGeometry: "zone",
      description: "Measure how long people remain in a zone.",
      params: [seconds("dwell_seconds", "Dwell Threshold", 30)],
    },
    {
      key: "loitering", label: "Loitering", group: "Events & Violations", requiresGeometry: "zone",
      description: "Alert when a person lingers beyond a threshold.",
      params: [seconds("loiter_seconds", "Loiter Threshold", 60)],
    },
    {
      key: "crowd_detection", label: "Crowd Detection", group: "Analytics", requiresGeometry: "zone",
      description: "Alert when people-count in a zone exceeds a limit.",
      params: [{ key: "max_people", label: "Crowd Above", type: "number", min: 1, max: 500, step: 1, unit: "ppl", default: 10 }],
    },
    {
      key: "person_counting", label: "Person Counting", group: "Tracking & Counting", requiresGeometry: "line",
      description: "Count people crossing an entry/exit line.",
      params: [directionParam],
    },
    {
      key: "object_left_behind", label: "Object Left Behind", group: "Events & Violations", requiresGeometry: "zone",
      description: "Detect abandoned bags/objects that remain static.",
      params: [seconds("static_seconds", "Abandoned After", 30)],
    },
    {
      key: "object_removed", label: "Object Removed", group: "Events & Violations", requiresGeometry: "zone",
      description: "Detect removal of a monitored asset from a zone.",
      params: [seconds("missing_seconds", "Missing After", 10)],
    },
    {
      key: "face_detection", label: "Face Detection", group: "Recognition",
      description: "Detects faces inside each person box (YuNet). Costs ~35 ms/frame while on, nothing while off.",
      params: [confidence(0.6)],
    },
    {
      key: "face_recognition", label: "Face Recognition", group: "Recognition", defaultEnabled: false,
      unavailable: "Not in this build — face detection works, but identifying who a face belongs to needs an enrolled known-faces database, which does not exist yet.",
      description: "Match detected faces against an enrolled gallery.",
      params: [
        { key: "match_threshold", label: "Match Threshold", type: "slider", min: 0.3, max: 0.95, step: 0.01, default: 0.62 },
        { key: "mode", label: "Watchlist Mode", type: "select", default: "known", options: [
          { value: "known", label: "Alert on known faces" }, { value: "unknown", label: "Alert on unknown faces" },
        ] },
      ],
    },
    {
      key: "fire_detection", label: "Fire Detection", group: "Safety",
      description: "Vision-based fire detection.",
      unavailable: "No fire model ships in this build. The previous colour-threshold implementation was removed — it flagged anything red (a shirt, a sunset, a traffic cone) as fire.",
      params: [confidence(0.5)],
    },
    {
      key: "smoke_detection", label: "Smoke Detection", group: "Safety",
      description: "Vision-based smoke detection.",
      unavailable: "No smoke model ships in this build. The previous colour-threshold implementation was removed — measured on footage with no smoke it alarmed on 200/200 frames, reading concrete pavement as a smoke plume.",
      params: [confidence(0.5)],
    },
    {
      // Was described as "Pose-based" — it never was. analytics.py flags a
      // person whose tracked box becomes wider than tall (w/h > 1.25), which
      // is a real, working heuristic but has no pose model behind it and will
      // not catch a fall that keeps the box upright. Describe what it does.
      key: "fall_detection", label: "Fall Detection", group: "Safety",
      description: "Flags a person whose bounding box becomes wider than tall (lying/collapsed posture).",
      params: [confidence(0.5)],
    },
    roiEditor,
    scheduleFeature,
    alertRules,
  ],
};

// ============================================================
// FACTORY
// ============================================================
const FACTORY: ProfileDef = {
  key: "factory",
  label: "Factory",
  tagline: "Industrial safety & operations",
  description: "PPE compliance, worker safety, machine and hazard-zone monitoring for industrial sites.",
  accent: "amber",
  groupOrder: ["Safety", "Detection", "Tracking & Counting", "Events & Violations", "Analytics", "ROI & Zones", "Alerts"],
  features: [
    {
      // defaultEnabled removed: a compliance feature must not be on by default
      // when nothing can produce a compliance finding.
      key: "ppe_detection", label: "PPE Detection", group: "Safety",
      description: "Verify workers wear the required personal protective equipment.",
      unavailable: "No PPE model ships in this build. The previous colour-threshold implementation was removed — on people wearing no PPE it invented helmets on 16% of checks and vests on 22%, at a hardcoded 0.95 confidence, flickering between compliant and violation frame to frame.",
      params: [confidence(0.45), {
        key: "required_ppe", label: "Required PPE", type: "classes",
        classOptions: ["helmet", "vest", "gloves", "shoes", "mask", "goggles"], default: ["helmet", "vest"],
      }],
    },
    { key: "helmet_detection", label: "Helmet Detection", group: "Safety", description: "Detect hard-hat compliance.",
      unavailable: "No helmet model ships in this build — COCO (and so yolox_tiny) has no helmet class.", params: [confidence(0.45)] },
    { key: "safety_vest", label: "Safety Vest", group: "Safety", description: "Detect hi-vis vest compliance.",
      unavailable: "No hi-vis model ships in this build — COCO (and so yolox_tiny) has no vest class.", params: [confidence(0.45)] },
    { key: "gloves", label: "Gloves", group: "Safety", description: "Detect glove compliance.",
      unavailable: "No glove model ships in this build — COCO (and so yolox_tiny) has no glove class.", params: [confidence(0.45)] },
    { key: "shoes", label: "Safety Shoes", group: "Safety", description: "Detect safety-footwear compliance.", params: [confidence(0.45)] },
    {
      key: "worker_detection", label: "Worker Detection", group: "Detection", defaultEnabled: true,
      description: "Detect workers on the floor.",
      params: [confidence(0.4)],
    },
    {
      key: "worker_counting", label: "Worker Counting", group: "Tracking & Counting", requiresGeometry: "line",
      description: "Count workers entering/leaving an area.",
      params: [directionParam],
    },
    {
      key: "machine_monitoring", label: "Machine Monitoring", group: "Analytics", requiresGeometry: "zone",
      description: "Monitor machine activity / idle state within a zone.",
      params: [seconds("idle_seconds", "Idle Alert After", 120)],
    },
    {
      key: "conveyor_monitoring", label: "Conveyor Monitoring", group: "Analytics", requiresGeometry: "zone",
      description: "Detect conveyor jams or stoppages.",
      params: [seconds("stall_seconds", "Stall Alert After", 15)],
    },
    {
      key: "forklift_detection", label: "Forklift Detection", group: "Detection",
      description: "Detect forklifts and industrial vehicles.",
      unavailable: "No forklift model ships in this build — COCO (and so yolox_tiny) has no forklift class. A forklift is currently detected as 'truck' at best.",
      params: [confidence(0.45)],
    },
    {
      key: "restricted_machine_zone", label: "Restricted Machine Zone", group: "Events & Violations", requiresGeometry: "zone",
      description: "Alert when a worker enters a machine's danger radius.",
      params: [seconds("grace_seconds", "Grace Period", 2)],
    },
    {
      key: "hazard_zone", label: "Hazard Zone", group: "Events & Violations", requiresGeometry: "zone",
      description: "General hazard area — any presence is flagged.",
      params: [classes(FACTORY_CLASSES, ["person"])],
    },
    { key: "fire_detection", label: "Fire Detection", group: "Safety", description: "Vision-based fire detection.",
      unavailable: "No fire model ships in this build. The previous colour-threshold implementation was removed — it flagged anything red as fire.", params: [confidence(0.5)] },
    { key: "smoke_detection", label: "Smoke Detection", group: "Safety", description: "Vision-based smoke detection.",
      unavailable: "No smoke model ships in this build. The previous colour-threshold implementation was removed — it alarmed on 200/200 frames of smoke-free footage, reading concrete as smoke.", params: [confidence(0.5)] },
    roiEditor,
    alertRules,
  ],
};

// ============================================================
// CUSTOM — free-form building blocks, unlimited zones
// ============================================================
const CUSTOM: ProfileDef = {
  key: "custom",
  label: "Custom",
  tagline: "Build your own analytics",
  description: "Compose arbitrary detection/counting zones, geometry and rules with no fixed template.",
  accent: "violet",
  groupOrder: ["Detection", "Events & Violations", "ROI & Zones", "Alerts"],
  features: [
    {
      key: "custom_detection", label: "Detection Zone", group: "Detection", requiresGeometry: "zone", defaultEnabled: true,
      description: "Run object detection inside any drawn zone.",
      params: [confidence(0.4), classes(COCO_CLASSES, ["person"])],
    },
    {
      key: "custom_counting", label: "Counting Zone", group: "Tracking & Counting", requiresGeometry: "line",
      description: "Count any class crossing any drawn line.",
      params: [directionParam, classes(COCO_CLASSES, ["person", "car"])],
    },
    {
      key: "ai_trigger", label: "AI Trigger", group: "Events & Violations",
      description: "Fire when a class appears/disappears anywhere in view.",
      params: [
        classes(COCO_CLASSES, ["person"]),
        { key: "trigger_on", label: "Trigger On", type: "select", default: "appear", options: [
          { value: "appear", label: "Object appears" }, { value: "disappear", label: "Object disappears" }, { value: "count", label: "Count threshold" },
        ] },
        { key: "count_threshold", label: "Count Threshold", type: "number", min: 1, max: 100, step: 1, default: 1 },
      ],
    },
    roiEditor,
    alertRules,
  ],
};

export const ZONE_PROFILES: Record<ZoneProfileKey, ProfileDef> = {
  traffic: TRAFFIC,
  security: SECURITY,
  factory: FACTORY,
  custom: CUSTOM,
};

export const PROFILE_ORDER: ZoneProfileKey[] = ["traffic", "security", "factory", "custom"];

// ---- config value helpers ----------------------------------

export interface FeatureConfigValue {
  enabled: boolean;
  params: Record<string, unknown>;
}
export type ProfileFeatures = Record<string, FeatureConfigValue>;

/** Build a fresh feature tree from catalog defaults for a profile. */
export function buildDefaultFeatures(profile: ZoneProfileKey): ProfileFeatures {
  const out: ProfileFeatures = {};
  for (const f of ZONE_PROFILES[profile].features) {
    const params: Record<string, unknown> = {};
    for (const p of f.params) params[p.key] = p.default;
    out[f.key] = { enabled: !!f.defaultEnabled, params };
  }
  return out;
}

/**
 * Merge a stored feature tree over the catalog defaults so newly-added
 * catalog features/params appear with defaults and removed ones drop off.
 * Keeps persisted values authoritative where they still exist.
 */
export function reconcileFeatures(profile: ZoneProfileKey, stored: ProfileFeatures | null | undefined): ProfileFeatures {
  const base = buildDefaultFeatures(profile);
  if (!stored) return base;
  for (const f of ZONE_PROFILES[profile].features) {
    const s = stored[f.key];
    if (!s) continue;
    base[f.key].enabled = typeof s.enabled === "boolean" ? s.enabled : base[f.key].enabled;
    for (const p of f.params) {
      if (s.params && p.key in s.params) base[f.key].params[p.key] = s.params[p.key];
    }
  }
  return base;
}

export function getProfile(key: ZoneProfileKey): ProfileDef {
  return ZONE_PROFILES[key];
}
