// Turns the telemetry stream into operator events.
//
// This module DERIVES, it does not detect. Every event it emits is caused by
// something the engine already sent on /ws: a tracked object that was not in
// the previous payload, or an analytics counter that went up. It runs no model,
// invents no class, and cannot produce an event for a camera that is sending
// nothing. If the engine goes quiet, so does this.
//
// TWO SOURCES, BOTH ALREADY IN THE PAYLOAD
//
//  1. detections[]  — one entry per tracked object per AI cycle. A track id
//     appearing for the first time is a new object in the scene: that is an
//     event. The same track in the next 500 payloads is not.
//
//  2. alert_counts{} — analytics.py's cumulative per-type counters (zone
//     intrusion, loitering, wrong way, speeding, falls). A counter going up is
//     the analytic firing, and because it rides the same socket as the boxes,
//     we learn about it in the same tick the pixels are still on screen — which
//     is what makes a real snapshot of it possible at all. Polling /api/alerts
//     would learn about it up to five seconds later, by which time the frame is
//     long gone.
//
// FLOOD CONTROL is not decoration. A single camera on a busy road produces a
// new vehicle track every second or two; a gate at shift change produces twenty
// people in ten seconds. Three limits apply, in order: per-subject cooldown
// (the same object cannot re-alert for 25s), per-camera burst cap (8 cards per
// 10s, the rest counted and reported rather than silently dropped), and a
// single-flight capture queue so snapshot encoding can never stack up.

import type { CameraTelemetry, TelemetryDetection } from "./telemetry";
import {
  defForClass, defForAnalytic, ANALYTIC_SUBJECT_CLASSES,
  SEVERITY_RANK, type EventDef, type Severity,
} from "./alertCatalog";
import { captureDetection, whenIdle, sourceSize, type CaptureMedia } from "./smartCrop";
import { saveEvidence, updateEvidence, type EvidenceMeta, type EvidenceRecord } from "./evidenceStore";
import { TrackLedger, trackKeyOf, type TimelineEntry, type TrackRecord } from "./trackLedger";
import { getDesktopNotificationSettings } from "./notifications";

export interface CameraContext {
  id: string;
  name: string;
  site: string;
}

export interface AlertEvent {
  id: string;
  ts: number;
  cameraId: string;
  cameraName: string;
  siteName: string;
  def: EventDef;
  severity: Severity;
  /** Raw engine key (class name or analytic type) — shown in the modal and
   *  exported verbatim, so the operator can always get back to the source. */
  sourceKey: string;
  confidence: number | null;
  trackId: number | null;
  bbox: { x1: number; y1: number; x2: number; y2: number } | null;
  meta: EvidenceMeta;
  /** Object URLs, filled in a beat after the event when the capture lands. */
  cropUrl: string | null;
  fullUrl: string | null;
  /** Detections in frame at capture time — the modal redraws exactly these. */
  frameDetections: TelemetryDetection[];
  acknowledged: boolean;
  /** Stable key for the subject in the track ledger, when it has one. Null for
   *  scene events with no attributable subject. */
  trackKey: string | null;
  /** Lifecycle rows for the subject, refreshed while the track stays alive. */
  timeline: TimelineEntry[];
  /** True while the subject is still in frame and the crop is being refreshed. */
  live: boolean;
  /** Times the crop has been re-captured since the event fired. */
  refreshes: number;
}

/** Same object cannot raise a second card for this long. */
const SUBJECT_COOLDOWN_MS = 25_000;
/** Rolling burst window and its cap, per camera. */
const BURST_WINDOW_MS = 10_000;
const BURST_LIMIT = 8;
/** A track that vanished for longer than this is a new subject if it returns. */
const TRACK_FORGET_MS = 120_000;

/**
 * Live crop refresh cadence.
 *
 * One second, per the spec. This is a real cost — a crop encode per visible
 * card per second — so three things bound it: only cards the operator can
 * actually SEE are refreshed (the provider reports which), refreshing stops
 * once the subject leaves frame, and it stops unconditionally after
 * LIVE_CROP_MAX_MS so a card left open on a parked car does not encode JPEGs
 * until the app is closed.
 */
const LIVE_CROP_INTERVAL_MS = 1000;
const LIVE_CROP_MAX_MS = 45_000;

let seq = 0;
const nextId = () => `evt_${Date.now().toString(36)}_${(seq++).toString(36)}`;

interface CameraState {
  /** subject key -> last time it raised an event. */
  lastAlert: Map<string, number>;
  /** Baseline of analytics counters; null until the first payload. */
  counts: Record<string, number> | null;
  /** Timestamps of cards raised in the current burst window. */
  burst: number[];
  suppressed: number;
  seeded: boolean;
}

export interface AlertEngineHooks {
  /** Fired the instant an event is derived — before any image exists. */
  onEvent: (e: AlertEvent) => void;
  /** Fired when the snapshot for an event finishes encoding. */
  onCapture: (id: string, cropUrl: string, fullUrl: string, aspect: number) => void;
  /** Fired each time a still-visible subject's crop is re-captured. The old
   *  URL is handed back so the owner can revoke it at the moment it stops
   *  being displayed — revoking it here would race the <img> swap and flash. */
  onCropRefresh?: (id: string, cropUrl: string, aspect: number, refreshes: number) => void;
  /** Fired when the subject leaves frame and live refresh stops. */
  onLiveEnded?: (id: string) => void;
  /** Fired when a tracked subject's lifecycle rows change. */
  onTimeline?: (id: string, timeline: TimelineEntry[]) => void;
  /** Total events dropped by the burst cap, per camera. */
  onSuppressed?: (cameraId: string, total: number) => void;
}

/** One event whose subject is still in frame and whose crop is being kept live. */
interface LiveCrop {
  eventId: string;
  cameraId: string;
  trackKey: string;
  def: EventDef;
  bbox: { x1: number; y1: number; x2: number; y2: number };
  startedAt: number;
  lastRefresh: number;
  refreshes: number;
}

export class AlertEngine {
  private cams = new Map<string, CameraState>();
  private captureQueue: Array<() => Promise<void>> = [];
  private capturing = false;
  private hooks: AlertEngineHooks;
  /** Set once a capture proves the canvas is tainted; stops us re-encoding
   *  frames we can never read. Cards then show without a snapshot rather than
   *  burning CPU per alert forever. */
  private captureBlocked = false;
  /** Object lifecycle, derived from the same payloads. */
  readonly ledger = new TrackLedger();
  /** Events whose crop is being refreshed, keyed by event id. */
  private liveCrops = new Map<string, LiveCrop>();
  /** Event ids the operator can actually see. Refreshing a crop for a card
   *  that is not on screen is pure cost, so the provider reports this and the
   *  refresh loop honours it. */
  private visible = new Set<string>();

  constructor(hooks: AlertEngineHooks) {
    this.hooks = hooks;
  }

  get snapshotsAvailable(): boolean {
    return !this.captureBlocked;
  }

  /** Which cards are currently rendered. Only these get live crop refreshes. */
  setVisible(ids: Iterable<string>): void {
    this.visible = new Set(ids);
  }

  /** Stop refreshing one event (acknowledged, dismissed, or evicted). */
  endLive(id: string): void {
    if (this.liveCrops.delete(id)) this.hooks.onLiveEnded?.(id);
  }

  /**
   * Age out stale live crops on a timer rather than on telemetry.
   *
   * The per-ingest sweep cannot fire when EVERY camera has gone quiet — engine
   * crash, network loss, laptop lid closed — which is exactly the moment stale
   * "Live" badges are most misleading. The provider calls this from its own
   * interval so the sweep does not depend on the thing that may have failed.
   */
  sweep(now = Date.now()): void {
    for (const lc of [...this.liveCrops.values()]) {
      if (now - lc.startedAt > LIVE_CROP_MAX_MS) this.endLive(lc.eventId);
    }
  }

  reset(cameraId?: string): void {
    if (cameraId) {
      this.cams.delete(cameraId);
      this.ledger.reset(cameraId);
      for (const [id, lc] of this.liveCrops) {
        if (lc.cameraId === cameraId) this.endLive(id);
      }
    } else {
      this.cams.clear();
      this.ledger.reset();
      for (const id of [...this.liveCrops.keys()]) this.endLive(id);
    }
  }

  private state(id: string): CameraState {
    let s = this.cams.get(id);
    if (!s) {
      s = { lastAlert: new Map(), counts: null, burst: [], suppressed: 0, seeded: false };
      this.cams.set(id, s);
    }
    return s;
  }

  /**
   * Feed one telemetry payload.
   *
   * `media` is the element the operator is watching, or null when nothing is on
   * screen (a covered tile). Events are still derived without it — an alert
   * whose snapshot failed is still an alert — they simply arrive without an
   * image, and say so.
   */
  ingest(cam: CameraContext, t: CameraTelemetry, media: CaptureMedia | null): void {
    const st = this.state(cam.id);
    const now = Date.now();
    const dets = Array.isArray(t.detections) ? t.detections : [];

    // The ledger sees every payload, including the seeding one, because "what
    // was already in frame when we started looking" is itself something the
    // incident view needs to be able to say.
    this.ledger.observe(cam.id, t, now);
    this.refreshLiveCrops(cam.id, dets, media, now);

    // First payload is a baseline, never an event storm: everything already in
    // frame when the operator opened the tile has been there for a while, and
    // twelve cards on mount is how an alert system teaches people to ignore it.
    if (!st.seeded) {
      st.seeded = true;
      st.counts = { ...(t.alert_counts ?? {}) };
      for (const d of dets) st.lastAlert.set(subjectKey(d), now);
      return;
    }

    this.forgetStale(st, now);

    // --- 1. new tracked objects ---------------------------------------------
    for (const d of dets) {
      const key = subjectKey(d);
      const last = st.lastAlert.get(key);
      if (last != null && now - last < SUBJECT_COOLDOWN_MS) {
        st.lastAlert.set(key, now); // still present — keep the cooldown alive
        continue;
      }
      st.lastAlert.set(key, now);

      // NOTE: there is deliberately no per-detection speeding branch here.
      // An earlier version tested `d.overspeed === true && d.speed_calibrated
      // === true`, which could never fire: pipeline.py builds client_dets
      // field by field and emits neither `overspeed` nor `speed_limit`, so
      // `d.overspeed` is always undefined. `speed_calibrated` is also NOT the
      // calibration flag its name suggests — the engine sets it true for
      // "estimated" readings as well, so only `speed_status === "calibrated"`
      // means measured. Speeding reaches us the way the engine actually raises
      // it: as an entry in alert_counts, handled in section 2 below.
      // Only raise detection-level alerts for genuine immediate threats or if presence alerts are explicitly requested.
      // Normal cars, buses, bikes, pedestrians, traffic lights, and stop signs are regular
      // scene detections (rendered on live overlay & HUD counters), NOT unacknowledged alerts!
      const isCriticalOrThreat = ["weapon", "knife", "gun", "fire", "smoke", "no_helmet", "no_vest"].includes(d.class);
      const isAnimal = ["dog", "cat", "cow", "horse", "bear", "wolf"].includes(d.class);

      let allowPresenceAlert = false;
      try {
        const notifSettings = getDesktopNotificationSettings();
        if (notifSettings.enabled) {
          if (d.class === "person" || d.class === "face") {
            allowPresenceAlert = !!notifSettings.events.person;
          } else if (["car", "truck", "bus", "motorcycle", "bicycle"].includes(d.class)) {
            allowPresenceAlert = !!notifSettings.events.vehicle;
          }
        }
      } catch {
        allowPresenceAlert = false;
      }

      if (!isCriticalOrThreat && !isAnimal && !allowPresenceAlert) {
        continue;
      }

      const def = defForClass(d.class);

      this.raise(cam, st, now, {
        def,
        sourceKey: d.class,
        confidence: typeof d.confidence === "number" ? d.confidence : null,
        trackId: d.track_id ?? null,
        bbox: d.bbox ?? null,
        meta: baseMeta(t, d, "detection"),
        frameDetections: dets,
        trackKey: key,
        timeline: this.ledger.get(cam.id, key)?.timeline ?? [],
      }, media, d.bbox ?? null, def);
    }

    // --- 2. analytics counters ----------------------------------------------
    const counts = t.alert_counts ?? {};
    const prev = st.counts ?? {};
    for (const [type, value] of Object.entries(counts)) {
      const before = prev[type] ?? 0;
      if (typeof value !== "number" || value <= before) continue;
      // Cap the catch-up: a tab that was backgrounded for a minute should not
      // fire forty cards when it wakes.
      const fired = Math.min(value - before, 2);
      const def = defForAnalytic(type);
      const subject = pickSubject(type, dets);
      const subjectKeyStr = subject ? trackKeyOf(subject) : null;
      for (let i = 0; i < fired; i++) {
        this.raise(cam, st, now, {
          def,
          sourceKey: type,
          confidence: subject ? subject.confidence : null,
          trackId: subject?.track_id ?? null,
          bbox: subject?.bbox ?? null,
          meta: baseMeta(t, subject, subject ? "detection" : "scene"),
          frameDetections: dets,
          trackKey: subjectKeyStr,
          timeline: subjectKeyStr
            ? this.ledger.get(cam.id, subjectKeyStr)?.timeline ?? []
            : this.ledger.cameraTimeline(cam.id).slice(-12),
        }, media, subject?.bbox ?? null, def);
      }
    }
    st.counts = { ...counts };
  }

  private forgetStale(st: CameraState, now: number): void {
    if (st.lastAlert.size < 512) {
      // Cheap path: only sweep when the map is big enough to matter.
      if (st.lastAlert.size < 128) return;
    }
    for (const [k, ts] of st.lastAlert) {
      if (now - ts > TRACK_FORGET_MS) st.lastAlert.delete(k);
    }
  }

  private raise(
    cam: CameraContext,
    st: CameraState,
    now: number,
    partial: Omit<AlertEvent, "id" | "ts" | "cameraId" | "cameraName" | "siteName" | "severity" | "cropUrl" | "fullUrl" | "acknowledged" | "live" | "refreshes">,
    media: CaptureMedia | null,
    bbox: { x1: number; y1: number; x2: number; y2: number } | null,
    def: EventDef,
  ): void {
    st.burst = st.burst.filter((ts) => now - ts < BURST_WINDOW_MS);
    if (st.burst.length >= BURST_LIMIT) {
      st.suppressed++;
      this.hooks.onSuppressed?.(cam.id, st.suppressed);
      return;
    }
    st.burst.push(now);

    const event: AlertEvent = {
      ...partial,
      id: nextId(),
      ts: now,
      cameraId: cam.id,
      cameraName: cam.name,
      siteName: cam.site,
      severity: def.severity,
      cropUrl: null,
      fullUrl: null,
      acknowledged: false,
      live: false,
      refreshes: 0,
    };
    this.hooks.onEvent(event);
    this.enqueueCapture(event, media, bbox, def);

    // Keep the crop live while the subject stays in frame. Only for events that
    // actually have a tracked subject — a scene event has nothing to stay
    // locked on to, and re-encoding the same wide shot every second would be
    // cost with no information in it.
    if (partial.trackKey && bbox) {
      this.liveCrops.set(event.id, {
        eventId: event.id,
        cameraId: cam.id,
        trackKey: partial.trackKey,
        def,
        bbox,
        startedAt: now,
        lastRefresh: now,
        refreshes: 0,
      });
      event.live = true;
    }
  }

  /**
   * Re-crop every visible card whose subject is still in frame.
   *
   * The crop stays LOCKED ON THE TRACK, not on the original rectangle: each
   * refresh uses the subject's newest bounding box, so a person walking across
   * the scene stays centred in their own card instead of sliding out of a
   * frozen window. That is the whole point of the feature — a still that no
   * longer contains the object it is captioned with is worse than no still.
   */
  private refreshLiveCrops(
    cameraId: string,
    dets: TelemetryDetection[],
    media: CaptureMedia | null,
    now: number,
  ): void {
    if (this.liveCrops.size === 0) return;

    // Age out entries for ANY camera, not just this one. A camera whose stream
    // drops stops calling ingest altogether, so its live crops would otherwise
    // never be swept — leaving a card permanently badged "Live" against a feed
    // that has been dead for an hour, and holding the entry forever.
    for (const lc of [...this.liveCrops.values()]) {
      if (now - lc.startedAt > LIVE_CROP_MAX_MS) this.endLive(lc.eventId);
    }

    const byKey = new Map<string, TelemetryDetection>();
    for (const d of dets) byKey.set(trackKeyOf(d), d);

    for (const lc of [...this.liveCrops.values()]) {
      if (lc.cameraId !== cameraId) continue;

      const still = byKey.get(lc.trackKey);
      if (!still || now - lc.startedAt > LIVE_CROP_MAX_MS) {
        // Subject gone, or we have been refreshing long enough. Either way the
        // last crop taken stays on the card as the final evidence image.
        this.endLive(lc.eventId);
        continue;
      }
      if (still.bbox) lc.bbox = still.bbox;

      // Lifecycle rows keep flowing even when the crop is not being re-encoded.
      const rec = this.ledger.get(cameraId, lc.trackKey);
      if (rec) this.hooks.onTimeline?.(lc.eventId, rec.timeline);

      if (!this.visible.has(lc.eventId)) continue;
      if (now - lc.lastRefresh < LIVE_CROP_INTERVAL_MS) continue;
      if (!media || this.captureBlocked || !sourceSize(media)) continue;
      // Never let refresh work queue up behind itself; a dropped refresh is
      // invisible (the previous crop is a second old), a backlog is not.
      if (this.captureQueue.length > 1) continue;

      lc.lastRefresh = now;
      const box = lc.bbox;
      const def = lc.def;
      const id = lc.eventId;

      this.captureQueue.push(async () => {
        const shot = await captureDetection(media, box, def.pad);
        if (!shot) return;
        const live = this.liveCrops.get(id);
        if (!live) {
          // Ended while this was encoding — the URL would never be shown.
          return;
        }
        live.refreshes++;
        const url = URL.createObjectURL(shot.crop);
        this.hooks.onCropRefresh?.(id, url, shot.aspect, live.refreshes);
        // The vault keeps the newest crop: it is the best-framed image of the
        // subject, and it is what the operator was actually looking at. Only
        // `crop` is patched — updateEvidence does a shallow merge, so naming
        // any other key here would overwrite it wholesale.
        void updateEvidence(id, { crop: shot.crop });
      });
      if (!this.capturing) this.drain();
    }
  }

  /**
   * Snapshot capture, single-flight and off the paint path.
   *
   * The queue is depth-limited: if four alerts land in one second, the fifth
   * gets a card without an image rather than a backlog of stale frames. A crop
   * of a frame from three seconds ago is not evidence of anything.
   */
  private enqueueCapture(
    event: AlertEvent,
    media: CaptureMedia | null,
    bbox: { x1: number; y1: number; x2: number; y2: number } | null,
    def: EventDef,
  ): void {
    const persistWithout = () => this.persist(event, null, null);

    if (!media || this.captureBlocked || !sourceSize(media)) {
      persistWithout();
      return;
    }
    if (this.captureQueue.length > 3) {
      persistWithout();
      return;
    }

    const job = async () => {
      // Scene events (no owning box) still get a real image: the whole frame,
      // marked as a scene crop so the card never implies an object was isolated.
      const box = bbox ?? { x1: 0, y1: 0, x2: 1, y2: 1 };
      // A scene shot is the frame as it is: no padding, and the frame's own
      // aspect rather than the class's, since there is no object to shape it
      // around. 16:9 is the shape of essentially every camera this ships with.
      const pad = bbox ? def.pad : { x: 0, top: 0, bottom: 0, aspect: 16 / 9 };
      const shot = await captureDetection(media, box, pad);
      if (!shot) {
        // One failure is a frame that wasn't ready; repeated failure on a
        // ready frame means the canvas is tainted and never will not be.
        if (sourceSize(media)) this.captureBlocked = true;
        persistWithout();
        return;
      }
      const cropUrl = URL.createObjectURL(shot.crop);
      const fullUrl = URL.createObjectURL(shot.full);
      event.meta.region = shot.region;
      event.meta.zoom = shot.zoom;
      event.meta.aspect = shot.aspect;
      this.hooks.onCapture(event.id, cropUrl, fullUrl, shot.aspect);
      this.persist(event, shot.crop, shot.full);
    };

    this.captureQueue.push(job);
    if (!this.capturing) this.drain();
  }

  private drain(): void {
    if (this.capturing) return;
    const job = this.captureQueue.shift();
    if (!job) return;
    this.capturing = true;
    whenIdle(() => {
      void job()
        .catch(() => { /* a failed capture must never break the alert */ })
        .finally(() => {
          this.capturing = false;
          if (this.captureQueue.length) this.drain();
        });
    });
  }

  /** Auto-save. Every event lands in the vault whether or not anyone looked. */
  private persist(event: AlertEvent, crop: Blob | null, full: Blob | null): void {
    const rec: EvidenceRecord = {
      id: event.id,
      ts: event.ts,
      cameraId: event.cameraId,
      cameraName: event.cameraName,
      siteName: event.siteName,
      title: event.def.title,
      group: event.def.group,
      severity: event.severity,
      sourceKey: event.sourceKey,
      confidence: event.confidence,
      trackId: event.trackId,
      bbox: event.bbox,
      frameDetections: event.frameDetections,
      meta: event.meta,
      crop,
      full,
      acknowledgedAt: null,
      acknowledgedBy: null,
      timeline: event.timeline.map((e) => ({
        ts: e.ts, kind: e.kind, label: e.label, basis: e.basis, detail: e.detail,
      })),
    };
    saveEvidence(rec);
  }
}

/** Stable identity for "the same subject". Track id when the tracker has one;
 *  plate text when it does not (a plate read twice is the same vehicle); class
 *  alone as the last resort, which the cooldown then rate-limits. */
function subjectKey(d: TelemetryDetection): string {
  if (d.track_id != null) return `${d.class}#${d.track_id}`;
  if (d.plate_text) return `${d.class}@${d.plate_text}`;
  return `${d.class}:anon`;
}

function baseMeta(
  t: CameraTelemetry,
  d: TelemetryDetection | null,
  cropKind: "detection" | "scene",
): EvidenceMeta {
  return {
    plate: d?.plate_text ?? null,
    // The plate DETECTOR's score and the OCR's score are different facts and
    // are kept apart: "the box is certainly a plate, the reading of it is not"
    // is something an operator has to be able to see.
    plateConfidence: (d as any)?.plate_text_confidence ?? null,
    plateFailure: (d as any)?.plate_failure ?? null,
    lane: (d as any)?.lane ?? null,
    // Carried with its provenance, always. A speed with no status next to it is
    // how an estimate gets read as a measurement.
    speed: d?.speed ?? null,
    speedStatus: d?.speed_status ?? null,
    // The engine does not emit an overspeed flag on detections at all; the only
    // honest reading of "over the limit" is a calibrated measurement, and
    // speeding as an EVENT arrives via alert_counts.
    overspeed: d?.speed_status === "calibrated" && d?.speed != null && (t as any)?.speed_limit != null
      ? (d.speed as number) > (t as any).speed_limit
      : false,
    trackStatus: d?.tracking_status ?? null,
    dwellSeconds: d?.dwell_time ?? null,
    direction: d?.direction ?? null,
    fps: t.fps ?? null,
    device: t.device ?? null,
    zoneName: null,
    cropKind,
    region: null,
    zoom: null,
    aspect: null,
    refreshes: 0,
  };
}

/**
 * Which object an analytic alert is about.
 *
 * The counter says "a person entered the zone"; it does not say which person.
 * If exactly one candidate of the right kind is in frame, that is the subject
 * and it gets a real object crop. If there are several, we genuinely do not
 * know which one tripped it — so the event falls back to a scene snapshot of
 * the whole frame, which the card labels as such. Picking the biggest box and
 * calling it the intruder would be a guess presented as a fact.
 */
function pickSubject(type: string, dets: TelemetryDetection[]): TelemetryDetection | null {
  const wanted = ANALYTIC_SUBJECT_CLASSES[type];
  if (!wanted) return null;
  const set = new Set(wanted);
  const candidates = dets.filter((d) => set.has(d.class));
  return candidates.length === 1 ? candidates[0] : null;
}

export function severityAtLeast(s: Severity, floor: Severity): boolean {
  return SEVERITY_RANK[s] >= SEVERITY_RANK[floor];
}
