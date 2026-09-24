// The event catalogue: how one engine detection becomes one operator-facing
// alert — its title, its severity, its icon, and how tightly the evidence
// snapshot should be cropped around it.
//
// THIS FILE INVENTS NOTHING. Every entry is a lookup keyed by a class string
// the engine may emit; an entry whose class no model produces simply never
// fires. That distinction matters here — this codebase has shipped fabricated
// detections before (face/fire/smoke/PPE emitted with hardcoded confidence),
// and the fix was to make the UI a pure function of what the engine actually
// sends. So: `fire`, `smoke`, `weapon` and the animal classes are catalogued
// (a buyer dropping in a model that emits them gets the full treatment for
// free) but NO code path here can produce one on its own.
//
// Classes the shipped engine really emits today:
//   person, bicycle, car, motorcycle, bus, truck, traffic_light, stop_sign,
//   backpack, umbrella, handbag, suitcase   (ai/backend.py COCO_CLASS_MAP)
//   face                                     (ai/face.py, YuNet)
//   helmet, no_helmet                        (helmet model, when configured)
//   number_plate                             (plate detector, when configured)

import {
  AlertTriangle, Bike, Car, Flame, HardHat, PawPrint, ScanFace, ScanLine,
  ShieldAlert, Siren, Package, TrafficCone, Users, User, Gauge, CloudFog,
  Crosshair, Sword, type LucideIcon,
} from "lucide-react";

export type Severity = "critical" | "high" | "medium" | "low";

/** Ordered worst-first — used for sorting and for the "at least this bad" filter. */
export const SEVERITY_RANK: Record<Severity, number> = {
  critical: 3, high: 2, medium: 1, low: 0,
};

/**
 * Crop padding, expressed as multiples of the detection's own box size.
 *
 * Padding is directional because the useful context is directional: a helmet
 * box is a head, and the evidence an operator needs is the head PLUS the body
 * under it (is this a worker on the line, or a visitor?), so `bottom` runs long
 * while `top` stays tight. A plate needs breathing room sideways to stay
 * readable at card size but almost none vertically.
 *
 * `aspect` is the shape the finished crop should be, and it is per-class for a
 * reason worth stating: a single fixed card aspect is what CAUSES background.
 * A standing person is roughly 1:2.5; forcing that into a 16:9 window means
 * roughly four fifths of the resulting image is whatever happened to be beside
 * them. The crop window is corrected by growing the short axis (never
 * stretching), so the only way to keep a person crop free of car park is to
 * tell it a person is portrait-shaped. The card then sizes its image box to
 * whatever aspect came back, so nothing is letterboxed either.
 */
export interface CropPad {
  x: number;
  top: number;
  bottom: number;
  /** Target width/height of the finished crop. */
  aspect: number;
}

export interface EventDef {
  /** Card headline. Written as the event, not the class — "Helmet Not Detected",
   *  not "no_helmet". */
  title: string;
  severity: Severity;
  icon: LucideIcon;
  pad: CropPad;
  /** Short operator-facing category shown under the title. */
  group: string;
}

const TIGHT: CropPad = { x: 0.18, top: 0.18, bottom: 0.18, aspect: 4 / 3 };
const CONTEXT: CropPad = { x: 0.45, top: 0.45, bottom: 0.45, aspect: 4 / 3 };

/** "Show only the face." Barely any padding — enough that the crop does not
 *  clip an ear or a chin, and square, because a face is. */
const FACE: CropPad = { x: 0.12, top: 0.18, bottom: 0.14, aspect: 1 };

/** "Person with 15% padding", read literally, in portrait so the 15% is the
 *  only background in the frame. */
const PERSON: CropPad = { x: 0.15, top: 0.15, bottom: 0.15, aspect: 0.64 };

/** "Head and shoulder." The detection box is a head; one head-height below it
 *  is the shoulder line, and a little over half a head either side is the
 *  shoulder width. Nothing below the chest — that is body, not shoulder. */
const HEAD_AND_SHOULDER: CropPad = { x: 0.55, top: 0.22, bottom: 1.05, aspect: 1.1 };

/** "Full vehicle only." Just enough margin not to shave a bumper. */
const VEHICLE_FULL: CropPad = { x: 0.08, top: 0.1, bottom: 0.08, aspect: 3 / 2 };

/** "Tight, with horizontal padding." A plate is a wide strip and is read, not
 *  looked at, so it gets width for legibility and almost nothing vertically. */
const PLATE: CropPad = { x: 0.45, top: 0.14, bottom: 0.14, aspect: 2.8 };

/** Flame centred; fire grows upward, so slightly more headroom than floor. */
const FIRE: CropPad = { x: 0.3, top: 0.34, bottom: 0.26, aspect: 1.2 };

/** Smoke is a plume: it rises and spreads, so the region above the detection
 *  is the part that shows how bad it is. */
const SMOKE: CropPad = { x: 0.38, top: 0.55, bottom: 0.22, aspect: 1.35 };

/** Weapons are only evidence together with whoever is holding them. */
const SUBJECT_AND_HOLDER: CropPad = { x: 1.6, top: 1.0, bottom: 2.4, aspect: 0.85 };

export const EVENT_CATALOG: Record<string, EventDef> = {
  // --- people ---------------------------------------------------------------
  person: { title: "Person Detected", severity: "low", icon: User, group: "Presence", pad: PERSON },
  face: { title: "Face Detected", severity: "low", icon: ScanFace, group: "Identity", pad: FACE },

  // --- PPE ------------------------------------------------------------------
  no_helmet: { title: "Helmet Not Detected", severity: "critical", icon: HardHat, group: "PPE Compliance", pad: HEAD_AND_SHOULDER },
  helmet: { title: "Helmet Compliant", severity: "low", icon: HardHat, group: "PPE Compliance", pad: HEAD_AND_SHOULDER },
  no_vest: { title: "Safety Vest Missing", severity: "critical", icon: ShieldAlert, group: "PPE Compliance", pad: { x: 0.4, top: 0.3, bottom: 0.9, aspect: 0.9 } },
  no_mask: { title: "Face Mask Missing", severity: "high", icon: ShieldAlert, group: "PPE Compliance", pad: FACE },

  // --- vehicles -------------------------------------------------------------
  car: { title: "Vehicle Detected", severity: "low", icon: Car, group: "Traffic", pad: VEHICLE_FULL },
  truck: { title: "Heavy Vehicle Detected", severity: "low", icon: Car, group: "Traffic", pad: VEHICLE_FULL },
  bus: { title: "Bus Detected", severity: "low", icon: Car, group: "Traffic", pad: VEHICLE_FULL },
  motorcycle: { title: "Two-Wheeler Detected", severity: "low", icon: Bike, group: "Traffic", pad: { x: 0.15, top: 0.2, bottom: 0.1, aspect: 1.2 } },
  bicycle: { title: "Cyclist Detected", severity: "low", icon: Bike, group: "Traffic", pad: { x: 0.15, top: 0.2, bottom: 0.1, aspect: 1.2 } },
  number_plate: { title: "Number Plate Read", severity: "low", icon: ScanLine, group: "ANPR", pad: PLATE },

  // --- static infrastructure ------------------------------------------------
  traffic_light: { title: "Traffic Signal", severity: "low", icon: TrafficCone, group: "Infrastructure", pad: CONTEXT },
  stop_sign: { title: "Stop Sign", severity: "low", icon: TrafficCone, group: "Infrastructure", pad: CONTEXT },

  // --- unattended items -----------------------------------------------------
  backpack: { title: "Bag Detected", severity: "medium", icon: Package, group: "Unattended Item", pad: CONTEXT },
  handbag: { title: "Bag Detected", severity: "medium", icon: Package, group: "Unattended Item", pad: CONTEXT },
  suitcase: { title: "Suitcase Detected", severity: "medium", icon: Package, group: "Unattended Item", pad: CONTEXT },
  umbrella: { title: "Object Detected", severity: "low", icon: Package, group: "Unattended Item", pad: CONTEXT },

  // --- catalogued, but no shipped model emits these. See the header note. ----
  fire: { title: "Fire Detected", severity: "critical", icon: Flame, group: "Hazard", pad: FIRE },
  smoke: { title: "Smoke Detected", severity: "critical", icon: CloudFog, group: "Hazard", pad: SMOKE },
  weapon: { title: "Weapon Detected", severity: "critical", icon: Sword, group: "Threat", pad: SUBJECT_AND_HOLDER },
  knife: { title: "Weapon Detected", severity: "critical", icon: Sword, group: "Threat", pad: SUBJECT_AND_HOLDER },
  gun: { title: "Weapon Detected", severity: "critical", icon: Sword, group: "Threat", pad: SUBJECT_AND_HOLDER },
  dog: { title: "Animal Detected", severity: "medium", icon: PawPrint, group: "Animal", pad: TIGHT },
  cat: { title: "Animal Detected", severity: "medium", icon: PawPrint, group: "Animal", pad: TIGHT },
  cow: { title: "Animal on Site", severity: "medium", icon: PawPrint, group: "Animal", pad: TIGHT },
  horse: { title: "Animal on Site", severity: "medium", icon: PawPrint, group: "Animal", pad: TIGHT },
};

/** Anything the catalogue has no entry for still gets a card — titled from the
 *  class, never dropped silently. A model a buyer adds tomorrow works today. */
export function defForClass(cls: string): EventDef {
  const hit = EVENT_CATALOG[cls];
  if (hit) return hit;
  return {
    title: cls.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
    severity: "low",
    icon: Crosshair,
    group: "Detection",
    pad: TIGHT,
  };
}

/**
 * Analytic alerts — the ones analytics.py raises from geometry rather than from
 * a class: zone entry/intrusion, loitering, wrong way, speeding, falls, crowd.
 *
 * These arrive as counters on the telemetry payload (`alert_counts`), so the
 * keys here are exactly analytics.py's alert `type` strings. A key that engine
 * build never emits simply never appears in the counter map.
 */
export const ANALYTIC_EVENTS: Record<string, EventDef> = {
  // A person-subject analytic gets a person-shaped crop plus a little more
  // margin than a bare `person` event: for a perimeter breach the ground the
  // subject is standing on IS part of the evidence.
  zone_intrusion: { title: "Zone Intrusion", severity: "critical", icon: ShieldAlert, group: "Perimeter", pad: { x: 0.35, top: 0.25, bottom: 0.22, aspect: 0.8 } },
  human_entry: { title: "Person Entered Zone", severity: "high", icon: User, group: "Perimeter", pad: { x: 0.35, top: 0.25, bottom: 0.22, aspect: 0.8 } },
  vehicle_entry: { title: "Vehicle Entered Zone", severity: "medium", icon: Car, group: "Perimeter", pad: VEHICLE_FULL },
  item_entry: { title: "Item Entered Zone", severity: "medium", icon: Package, group: "Perimeter", pad: CONTEXT },
  object_entry: { title: "Object Entered Zone", severity: "medium", icon: Crosshair, group: "Perimeter", pad: CONTEXT },
  infrastructure_present: { title: "Infrastructure in Zone", severity: "low", icon: TrafficCone, group: "Perimeter", pad: CONTEXT },
  loitering: { title: "Loitering Detected", severity: "high", icon: Users, group: "Behaviour", pad: { x: 0.35, top: 0.25, bottom: 0.22, aspect: 0.8 } },
  wrong_way: { title: "Wrong-Way Movement", severity: "high", icon: AlertTriangle, group: "Behaviour", pad: { x: 0.35, top: 0.2, bottom: 0.2, aspect: 1.5 } },
  speed_limit: { title: "Speeding Violation", severity: "high", icon: Gauge, group: "Traffic", pad: VEHICLE_FULL },
  // A fallen person is horizontal — a portrait crop of one is mostly floor.
  fall_alert: { title: "Fall Detected", severity: "critical", icon: Siren, group: "Safety", pad: { x: 0.4, top: 0.4, bottom: 0.4, aspect: 1.6 } },
  crowd_alert: { title: "Crowd Threshold Exceeded", severity: "high", icon: Users, group: "Crowd", pad: { x: 0.8, top: 0.8, bottom: 0.8, aspect: 16 / 9 } },
  crowd: { title: "Crowd Threshold Exceeded", severity: "high", icon: Users, group: "Crowd", pad: { x: 0.8, top: 0.8, bottom: 0.8, aspect: 16 / 9 } },
  face_detection: { title: "Face Detected", severity: "low", icon: ScanFace, group: "Identity", pad: FACE },
  custom_rule: { title: "Custom AI Rule Triggered", severity: "high", icon: Crosshair, group: "Custom Rule", pad: CONTEXT },
  line_crossing: { title: "Line Crossed", severity: "medium", icon: Crosshair, group: "Perimeter", pad: TIGHT },
};

export function defForAnalytic(type: string): EventDef {
  const hit = ANALYTIC_EVENTS[type];
  if (hit) return hit;
  return {
    title: type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
    severity: "medium",
    icon: AlertTriangle,
    group: "Analytics",
    pad: CONTEXT,
  };
}

/** Which detection category an analytic alert is most likely ABOUT — used to
 *  pick the subject to crop when the counter says "someone intruded" but the
 *  counter itself carries no track id. See alertEngine.pickSubject(). */
export const ANALYTIC_SUBJECT_CLASSES: Record<string, string[]> = {
  zone_intrusion: ["person"],
  human_entry: ["person"],
  loitering: ["person"],
  fall_alert: ["person"],
  crowd_alert: ["person"],
  crowd: ["person"],
  face_detection: ["face"],
  vehicle_entry: ["car", "truck", "bus", "motorcycle", "bicycle"],
  speed_limit: ["car", "truck", "bus", "motorcycle"],
  wrong_way: ["car", "truck", "bus", "motorcycle", "person"],
  item_entry: ["backpack", "handbag", "suitcase", "umbrella"],
};

// --- presentation tokens ----------------------------------------------------
// Deliberately desaturated. A control room runs these on a wall for eight hours
// at a stretch; saturated reds and neon greens read as "demo", and worse, they
// stop meaning anything when everything glows. Severity is carried by ONE
// accent per card against a neutral glass surface.

export interface SeverityTheme {
  label: string;
  /** Card accent — border, icon, dot. */
  accent: string;
  /** Very low-alpha wash behind the card header. */
  wash: string;
  /** Text colour for the severity chip. */
  text: string;
  ring: string;
}

export const SEVERITY_THEME: Record<Severity, SeverityTheme> = {
  critical: { label: "Critical", accent: "#e05a52", wash: "rgba(224,90,82,0.14)", text: "#f0938c", ring: "rgba(224,90,82,0.45)" },
  high: { label: "High", accent: "#d99a3c", wash: "rgba(217,154,60,0.12)", text: "#e5b871", ring: "rgba(217,154,60,0.40)" },
  medium: { label: "Medium", accent: "#5b8cff", wash: "rgba(91,140,255,0.10)", text: "#93b1ff", ring: "rgba(91,140,255,0.35)" },
  low: { label: "Low", accent: "#7d8797", wash: "rgba(125,135,151,0.10)", text: "#a8b1bf", ring: "rgba(125,135,151,0.30)" },
};
