// Per-object lifecycle, reconstructed in the renderer from the telemetry stream.
//
// WHAT THIS IS FOR
//
// The engine sends a flat snapshot every AI cycle: "these objects are in frame
// right now, with these attributes". It does not send a history. An operator
// incident view needs the history — "appeared 00:12, entered the zone 00:14,
// stayed 8 seconds, helmet came off, left frame 00:31" — and every one of those
// statements is derivable by watching consecutive payloads. So we watch them.
//
// WHAT IS REAL HERE AND WHAT IS INFERRED
//
// This module is very deliberate about the difference, because this codebase has
// shipped invented telemetry before and the fix was to make the UI a pure
// function of the engine's own output. Every timeline entry therefore carries a
// `basis`:
//
//   "reported"  — the engine stated this. dwell_time, direction, speed,
//                 tracking_status, class, confidence. Printed as fact.
//   "observed"  — we watched it happen across payloads. A track id that was
//                 absent and is now present really did appear; a track whose
//                 class went helmet -> no_helmet really did change class. These
//                 are facts about the STREAM, and they are honest ones.
//   "correlated"— a camera-scope counter moved while this track was in frame.
//                 zone_stats and line_stats are per-ZONE aggregates, not
//                 per-object: the payload never says WHICH object entered. When
//                 exactly one candidate is in frame we attribute it and say so;
//                 when several are, we record it at camera scope and refuse to
//                 name a subject. Guessing would be the fabrication bug again.
//
// The UI renders "correlated" entries visibly differently from "reported" ones.
// An operator must never have to wonder which of the two they are reading.

import type { CameraTelemetry, TelemetryDetection } from "./telemetry";

export type Basis = "reported" | "observed" | "correlated";

export type TimelineKind =
  | "appeared"
  | "class_changed"
  | "dwell"
  | "direction"
  | "zone_entry"
  | "zone_exit"
  | "line_crossing"
  | "speed"
  | "analytic"
  | "lost"
  | "disappeared";

export interface TimelineEntry {
  ts: number;
  kind: TimelineKind;
  /** Operator-facing sentence, already written. */
  label: string;
  basis: Basis;
  /** Track this belongs to, or null for a camera-scope entry we would not
   *  attribute to any single object. */
  trackKey: string | null;
  detail?: string;
}

export interface TrackRecord {
  key: string;
  trackId: number | null;
  cameraId: string;
  /** Current class, and every class this track has ever been reported as. */
  cls: string;
  classHistory: Array<{ cls: string; ts: number }>;
  firstSeen: number;
  lastSeen: number;
  /** Engine-reported seconds in frame. Preferred over our own arithmetic
   *  whenever present — it is the tracker's own book-keeping. */
  reportedDwell: number | null;
  confidence: number;
  peakConfidence: number;
  direction: string | null;
  speed: number | null;
  speedStatus: string | null;
  trackingStatus: string | null;
  plate: string | null;
  lane: string | number | null;
  bbox: { x1: number; y1: number; x2: number; y2: number } | null;
  timeline: TimelineEntry[];
  /** True once the track has been missing longer than the grace window. */
  gone: boolean;
  /** Frames (payloads) this track has been observed in. */
  samples: number;
}

/**
 * A track that vanishes for less than this is still the same track.
 *
 * The tracker re-associates through short occlusions (ByteTracker keeps a lost
 * gallery), so a track id CAN be absent for a payload or two and come back as
 * the same object. Declaring "exited area" on the first missing frame would
 * produce an exit/appear pair every time someone walked behind a pillar. The
 * sibling bug is recorded in the tracker work: analytics needed exactly this
 * grace window or it silently defeated the ID persistence it was built on.
 */
const EXIT_GRACE_MS = 2500;

/** Dwell milestones worth a timeline row. Beyond a minute, nobody is reading
 *  each tick — the record carries the total. */
const DWELL_MILESTONES = [5, 10, 30, 60];

/** Per camera. A busy road can cycle hundreds of tracks an hour; the ledger is
 *  a UI aid, not an archive (the vault is the archive). */
const MAX_TRACKS_PER_CAMERA = 240;
/** Per track. A 20-minute loiter should not grow an unbounded array. */
const MAX_TIMELINE_PER_TRACK = 60;

interface CameraLedger {
  tracks: Map<string, TrackRecord>;
  /** Camera-scope timeline: entries we would not attribute to one object. */
  cameraTimeline: TimelineEntry[];
  zoneCounts: Record<string, { entry: number; exit: number }>;
  lineCounts: Record<string, number>;
  seeded: boolean;
}

export function trackKeyOf(d: TelemetryDetection): string {
  if (d.track_id != null) return `t${d.track_id}`;
  if (d.plate_text) return `p:${d.plate_text}`;
  return `c:${d.class}`;
}

/** zone_stats/line_stats arrive as {id: {...}} from the engine, but the shared
 *  type declares an array. Read both shapes rather than trusting either. */
function entries(v: unknown): Array<[string, any]> {
  if (!v) return [];
  if (Array.isArray(v)) return v.map((x, i) => [String((x as any)?.id ?? i), x]);
  if (typeof v === "object") return Object.entries(v as Record<string, any>);
  return [];
}

const num = (v: unknown): number => (typeof v === "number" && isFinite(v) ? v : 0);

export class TrackLedger {
  private cams = new Map<string, CameraLedger>();

  private ledger(cameraId: string): CameraLedger {
    let l = this.cams.get(cameraId);
    if (!l) {
      l = { tracks: new Map(), cameraTimeline: [], zoneCounts: {}, lineCounts: {}, seeded: false };
      this.cams.set(cameraId, l);
    }
    return l;
  }

  reset(cameraId?: string): void {
    if (cameraId) this.cams.delete(cameraId);
    else this.cams.clear();
  }

  get(cameraId: string, key: string): TrackRecord | null {
    return this.cams.get(cameraId)?.tracks.get(key) ?? null;
  }

  /** Newest-first camera-scope entries, for the incident window's Timeline tab. */
  cameraTimeline(cameraId: string): TimelineEntry[] {
    return this.cams.get(cameraId)?.cameraTimeline ?? [];
  }

  /** Live tracks, most recently seen first. */
  activeTracks(cameraId: string): TrackRecord[] {
    const l = this.cams.get(cameraId);
    if (!l) return [];
    return [...l.tracks.values()].filter((t) => !t.gone).sort((a, b) => b.lastSeen - a.lastSeen);
  }

  /**
   * Feed one payload. Returns the tracks that are new in THIS payload, so the
   * alert engine does not have to diff the same list a second time.
   */
  observe(cameraId: string, t: CameraTelemetry, now: number): TrackRecord[] {
    const l = this.ledger(cameraId);
    const dets = Array.isArray(t.detections) ? t.detections : [];
    const fresh: TrackRecord[] = [];
    const present = new Set<string>();

    for (const d of dets) {
      const key = trackKeyOf(d);
      present.add(key);
      const existing = l.tracks.get(key);

      if (!existing || existing.gone) {
        const rec: TrackRecord = {
          key,
          trackId: d.track_id ?? null,
          cameraId,
          cls: d.class,
          classHistory: [{ cls: d.class, ts: now }],
          firstSeen: now,
          lastSeen: now,
          reportedDwell: typeof d.dwell_time === "number" ? d.dwell_time : null,
          confidence: d.confidence ?? 0,
          peakConfidence: d.confidence ?? 0,
          direction: d.direction ?? null,
          speed: d.speed ?? null,
          speedStatus: d.speed_status ?? null,
          trackingStatus: d.tracking_status ?? null,
          plate: d.plate_text ?? null,
          lane: (d as any).lane ?? null,
          bbox: d.bbox ?? null,
          timeline: [],
          gone: false,
          samples: 1,
        };
        // On the very first payload for a camera, everything in frame has been
        // there for an unknown time — it did not "appear", we just started
        // looking. Saying otherwise would date every object to app start.
        push(rec.timeline, {
          ts: now,
          kind: "appeared",
          label: l.seeded ? `${pretty(d.class)} appeared` : `${pretty(d.class)} already in frame`,
          basis: l.seeded ? "observed" : "reported",
          trackKey: key,
        });
        l.tracks.set(key, rec);
        if (l.seeded) fresh.push(rec);
        continue;
      }

      // --- existing track: fold in this payload ------------------------------
      existing.lastSeen = now;
      existing.samples++;
      existing.confidence = d.confidence ?? existing.confidence;
      if ((d.confidence ?? 0) > existing.peakConfidence) existing.peakConfidence = d.confidence ?? 0;
      existing.bbox = d.bbox ?? existing.bbox;
      existing.trackingStatus = d.tracking_status ?? existing.trackingStatus;
      if (d.plate_text) existing.plate = d.plate_text;
      if (typeof d.dwell_time === "number") existing.reportedDwell = d.dwell_time;

      // Class transition on a STABLE track id is the single most operationally
      // interesting thing in this whole file: the same tracked person going
      // helmet -> no_helmet is PPE being removed on camera, and it is a real
      // observation, not an inference.
      if (d.class !== existing.cls) {
        const from = existing.cls;
        existing.cls = d.class;
        existing.classHistory.push({ cls: d.class, ts: now });
        push(existing.timeline, {
          ts: now,
          kind: "class_changed",
          label: transitionLabel(from, d.class),
          basis: "observed",
          trackKey: key,
          detail: `${from} → ${d.class}`,
        });
      }

      if (d.direction && d.direction !== existing.direction) {
        const prev = existing.direction;
        existing.direction = d.direction;
        // Only worth a row once the object has actually been moving; the first
        // transition out of "stationary" is noise on almost every track.
        if (prev && prev !== "stationary") {
          push(existing.timeline, {
            ts: now,
            kind: "direction",
            label: `Direction changed to ${d.direction}`,
            basis: "reported",
            trackKey: key,
          });
        }
      }

      if (typeof d.speed === "number") {
        existing.speed = d.speed;
        existing.speedStatus = d.speed_status ?? existing.speedStatus;
      }

      // Dwell milestones, driven by the engine's own counter when it has one.
      const dwell = existing.reportedDwell ?? (now - existing.firstSeen) / 1000;
      for (const m of DWELL_MILESTONES) {
        if (dwell >= m && !existing.timeline.some((e) => e.kind === "dwell" && e.detail === `${m}`)) {
          push(existing.timeline, {
            ts: now,
            kind: "dwell",
            label: `Stayed ${m} sec`,
            basis: existing.reportedDwell != null ? "reported" : "observed",
            trackKey: key,
            detail: `${m}`,
          });
        }
      }
    }

    // --- exits ---------------------------------------------------------------
    for (const rec of l.tracks.values()) {
      if (rec.gone || present.has(rec.key)) continue;
      if (now - rec.lastSeen < EXIT_GRACE_MS) continue;
      rec.gone = true;
      const held = Math.round(((rec.reportedDwell ?? (rec.lastSeen - rec.firstSeen) / 1000)) * 10) / 10;
      push(rec.timeline, {
        ts: rec.lastSeen + EXIT_GRACE_MS,
        kind: "disappeared",
        label: `${pretty(rec.cls)} left frame`,
        basis: "observed",
        trackKey: rec.key,
        detail: `in view ${held}s`,
      });
    }

    this.foldZonesAndLines(l, t, now, dets);
    if (!l.seeded) l.seeded = true;
    this.trim(l);
    return fresh;
  }

  /**
   * Zone and line activity.
   *
   * These counters are per-zone and per-line, never per-object — the payload
   * simply does not carry "track 7 is inside zone 2". So attribution is done
   * the only honest way available: if exactly one plausible object is in frame
   * when the counter moves, it was that one, and the entry is marked
   * "correlated" rather than "reported". If two or more are, the entry goes on
   * the camera timeline with no subject at all.
   */
  private foldZonesAndLines(
    l: CameraLedger,
    t: CameraTelemetry,
    now: number,
    dets: TelemetryDetection[],
  ): void {
    const movers = dets.filter((d) => d.track_id != null);
    const sole = movers.length === 1 ? trackKeyOf(movers[0]) : null;

    for (const [zid, z] of entries(t.zone_stats)) {
      const prev = l.zoneCounts[zid] ?? { entry: 0, exit: 0 };
      const entry = num(z?.entry_count);
      const exit = num(z?.exit_count);
      if (l.seeded && entry > prev.entry) {
        this.record(l, sole, {
          ts: now,
          kind: "zone_entry",
          label: sole ? `Entered zone ${zoneName(z, zid)}` : `Entry into zone ${zoneName(z, zid)}`,
          basis: "correlated",
          trackKey: sole,
          detail: sole ? undefined : `${movers.length} objects in frame — subject not attributable`,
        });
      }
      if (l.seeded && exit > prev.exit) {
        this.record(l, sole, {
          ts: now,
          kind: "zone_exit",
          label: sole ? `Exited zone ${zoneName(z, zid)}` : `Exit from zone ${zoneName(z, zid)}`,
          basis: "correlated",
          trackKey: sole,
        });
      }
      l.zoneCounts[zid] = { entry, exit };
    }

    for (const [lid, ln] of entries(t.line_stats)) {
      const total = num(ln?.total_count) || num(ln?.in_count) + num(ln?.out_count);
      const prev = l.lineCounts[lid] ?? 0;
      if (l.seeded && total > prev) {
        this.record(l, sole, {
          ts: now,
          kind: "line_crossing",
          label: sole ? `Crossed line ${lid}` : `Line ${lid} crossed`,
          basis: "correlated",
          trackKey: sole,
          detail: sole ? undefined : `${movers.length} objects in frame — subject not attributable`,
        });
      }
      l.lineCounts[lid] = total;
    }
  }

  private record(l: CameraLedger, trackKey: string | null, entry: TimelineEntry): void {
    push(l.cameraTimeline, entry, 200);
    if (trackKey) {
      const rec = l.tracks.get(trackKey);
      if (rec) push(rec.timeline, entry);
    }
  }

  /** Bounded memory: drop the oldest finished tracks once over the cap. */
  private trim(l: CameraLedger): void {
    if (l.tracks.size <= MAX_TRACKS_PER_CAMERA) return;
    const done = [...l.tracks.values()].filter((t) => t.gone).sort((a, b) => a.lastSeen - b.lastSeen);
    let over = l.tracks.size - MAX_TRACKS_PER_CAMERA;
    for (const t of done) {
      if (over-- <= 0) break;
      l.tracks.delete(t.key);
    }
  }
}

function push(list: TimelineEntry[], entry: TimelineEntry, cap = MAX_TIMELINE_PER_TRACK): void {
  list.push(entry);
  if (list.length > cap) list.splice(0, list.length - cap);
}

export function pretty(cls: string): string {
  return cls.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** The transitions worth naming properly instead of "class changed". */
function transitionLabel(from: string, to: string): string {
  if (from === "helmet" && to === "no_helmet") return "Helmet removed";
  if (from === "no_helmet" && to === "helmet") return "Helmet put on";
  if (from === "vest" && to === "no_vest") return "Safety vest removed";
  if (from === "no_vest" && to === "vest") return "Safety vest put on";
  if (from === "mask" && to === "no_mask") return "Face mask removed";
  return `Reclassified ${pretty(from)} → ${pretty(to)}`;
}

function zoneName(z: any, fallback: string): string {
  const n = z?.name ?? z?.zone_name;
  return typeof n === "string" && n ? n : fallback;
}
