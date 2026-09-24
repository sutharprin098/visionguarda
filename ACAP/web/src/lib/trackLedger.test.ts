// The ledger is the one place that turns a stream of stateless snapshots into
// claims about history ("appeared", "helmet removed", "left frame"). Those
// claims end up in an exported incident report, so the line between what was
// reported, observed and merely correlated has to hold under test.

import { describe, it, expect } from "vitest";
import { TrackLedger } from "./trackLedger";
import type { CameraTelemetry, TelemetryDetection } from "./telemetry";

const CAM = "cam-1";

function det(over: Partial<TelemetryDetection> = {}): TelemetryDetection {
  return {
    class: "person",
    confidence: 0.9,
    track_id: 1,
    bbox: { x1: 0.4, y1: 0.4, x2: 0.5, y2: 0.7 },
    ...over,
  };
}

function tel(dets: TelemetryDetection[], over: Partial<CameraTelemetry> = {}): CameraTelemetry {
  return { people: dets.length, vehicles: 0, detections: dets, ...over };
}

describe("TrackLedger", () => {
  it("does not claim objects 'appeared' on the very first payload", () => {
    const l = new TrackLedger();
    l.observe(CAM, tel([det()]), 1000);
    const rec = l.get(CAM, "t1")!;
    expect(rec.timeline[0].label).toMatch(/already in frame/i);
    // We started looking; we did not witness an arrival.
    expect(rec.timeline[0].basis).toBe("reported");
  });

  it("reports a genuinely new track as appeared, and returns it as fresh", () => {
    const l = new TrackLedger();
    l.observe(CAM, tel([det({ track_id: 1 })]), 1000);
    const fresh = l.observe(CAM, tel([det({ track_id: 1 }), det({ track_id: 2 })]), 2000);
    expect(fresh.map((f) => f.key)).toEqual(["t2"]);
    expect(l.get(CAM, "t2")!.timeline[0].basis).toBe("observed");
    expect(l.get(CAM, "t2")!.timeline[0].label).toMatch(/appeared/i);
  });

  it("names a helmet coming off, on a stable track id", () => {
    const l = new TrackLedger();
    l.observe(CAM, tel([det({ class: "helmet" })]), 1000);
    l.observe(CAM, tel([det({ class: "helmet" })]), 2000);
    l.observe(CAM, tel([det({ class: "no_helmet" })]), 3000);
    const rec = l.get(CAM, "t1")!;
    const change = rec.timeline.find((e) => e.kind === "class_changed");
    expect(change?.label).toBe("Helmet removed");
    expect(change?.basis).toBe("observed");
    expect(rec.classHistory.map((c) => c.cls)).toEqual(["helmet", "no_helmet"]);
  });

  it("does not declare an exit during the occlusion grace window", () => {
    const l = new TrackLedger();
    l.observe(CAM, tel([det()]), 1000);
    l.observe(CAM, tel([det()]), 2000);
    l.observe(CAM, tel([]), 3000);          // gone for 1s — behind a pillar
    expect(l.get(CAM, "t1")!.gone).toBe(false);
    l.observe(CAM, tel([det()]), 3500);     // back
    expect(l.get(CAM, "t1")!.gone).toBe(false);
    expect(l.get(CAM, "t1")!.timeline.filter((e) => e.kind === "disappeared")).toHaveLength(0);
  });

  it("declares an exit once the grace window really has passed", () => {
    const l = new TrackLedger();
    l.observe(CAM, tel([det()]), 1000);
    l.observe(CAM, tel([det()]), 2000);
    l.observe(CAM, tel([]), 6000);
    const rec = l.get(CAM, "t1")!;
    expect(rec.gone).toBe(true);
    expect(rec.timeline.some((e) => e.kind === "disappeared")).toBe(true);
  });

  it("records dwell milestones once each, preferring the engine's counter", () => {
    const l = new TrackLedger();
    l.observe(CAM, tel([det({ dwell_time: 0 })]), 1000);
    l.observe(CAM, tel([det({ dwell_time: 6 })]), 2000);
    l.observe(CAM, tel([det({ dwell_time: 7 })]), 3000);
    l.observe(CAM, tel([det({ dwell_time: 11 })]), 4000);
    const rec = l.get(CAM, "t1")!;
    const dwell = rec.timeline.filter((e) => e.kind === "dwell");
    expect(dwell.map((d) => d.label)).toEqual(["Stayed 5 sec", "Stayed 10 sec"]);
    expect(dwell.every((d) => d.basis === "reported")).toBe(true);
  });

  it("attributes a zone entry to the only candidate in frame, marked correlated", () => {
    const l = new TrackLedger();
    const zones = (entry: number) => ({ zone_stats: { z1: { entry_count: entry, exit_count: 0 } } as any });
    l.observe(CAM, tel([det()], zones(0)), 1000);
    l.observe(CAM, tel([det()], zones(1)), 2000);
    const rec = l.get(CAM, "t1")!;
    const entry = rec.timeline.find((e) => e.kind === "zone_entry");
    expect(entry).toBeTruthy();
    // Attribution is inferred from "there was only one candidate", never stated
    // by the engine — the payload has no per-object zone field at all.
    expect(entry!.basis).toBe("correlated");
  });

  it("refuses to name a subject when several could have tripped the counter", () => {
    const l = new TrackLedger();
    const zones = (entry: number) => ({ zone_stats: { z1: { entry_count: entry, exit_count: 0 } } as any });
    const two = [det({ track_id: 1 }), det({ track_id: 2 })];
    l.observe(CAM, tel(two, zones(0)), 1000);
    l.observe(CAM, tel(two, zones(1)), 2000);

    for (const key of ["t1", "t2"]) {
      expect(l.get(CAM, key)!.timeline.some((e) => e.kind === "zone_entry")).toBe(false);
    }
    const cam = l.cameraTimeline(CAM).find((e) => e.kind === "zone_entry");
    expect(cam).toBeTruthy();
    expect(cam!.trackKey).toBeNull();
    expect(cam!.detail).toMatch(/not attributable/i);
  });

  it("counts a line crossing from either the total or the in/out pair", () => {
    const l = new TrackLedger();
    const lines = (inC: number) => ({ line_stats: { l1: { in_count: inC, out_count: 0 } } as any });
    l.observe(CAM, tel([det()], lines(0)), 1000);
    l.observe(CAM, tel([det()], lines(1)), 2000);
    expect(l.get(CAM, "t1")!.timeline.some((e) => e.kind === "line_crossing")).toBe(true);
  });

  it("treats an untracked plate read as the same subject across payloads", () => {
    const l = new TrackLedger();
    const plate = () => det({ class: "number_plate", track_id: null, plate_text: "MH12AB1234" });
    l.observe(CAM, tel([plate()]), 1000);
    const fresh = l.observe(CAM, tel([plate()]), 2000);
    expect(fresh).toHaveLength(0);
    expect(l.get(CAM, "p:MH12AB1234")).toBeTruthy();
  });

  it("keeps per-camera state separate", () => {
    const l = new TrackLedger();
    l.observe("a", tel([det({ track_id: 7 })]), 1000);
    l.observe("b", tel([det({ track_id: 7 })]), 1000);
    expect(l.get("a", "t7")).toBeTruthy();
    expect(l.get("b", "t7")).toBeTruthy();
    // Same id, different cameras, genuinely different objects — the ledger must
    // not merge them, because each camera runs its own tracker.
    expect(l.get("a", "t7")).not.toBe(l.get("b", "t7"));
  });

  it("bounds memory by dropping finished tracks", () => {
    const l = new TrackLedger();
    let t = 1000;
    l.observe(CAM, tel([det({ track_id: 0 })]), t);
    for (let i = 1; i < 400; i++) {
      t += 10_000; // each one ages the previous past the grace window
      l.observe(CAM, tel([det({ track_id: i })]), t);
    }
    expect(l.activeTracks(CAM).length).toBeLessThanOrEqual(2);
    // The cap is on retained records, not on ids ever seen.
    expect(l.get(CAM, "t0")).toBeNull();
  });
});
