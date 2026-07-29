import { describe, it, expect } from "vitest";
import { detectionsRenderEqual, type TelemetryDetection } from "./telemetry";

const det = (over: Partial<TelemetryDetection> = {}): TelemetryDetection => ({
  class: "person",
  confidence: 0.9,
  track_id: 1,
  bbox: { x1: 0.1, y1: 0.1, x2: 0.2, y2: 0.4 },
  ...over,
});

describe("detectionsRenderEqual", () => {
  it("treats two distinct empty arrays as equal", () => {
    // The case that matters most: a camera with no video sends a fresh []
    // on every tick, forever.
    expect(detectionsRenderEqual([], [])).toBe(true);
    expect(detectionsRenderEqual(undefined, [])).toBe(true);
    expect(detectionsRenderEqual(undefined, undefined)).toBe(true);
  });

  it("treats an identical payload as equal across array identities", () => {
    expect(detectionsRenderEqual([det()], [det()])).toBe(true);
  });

  it("detects a count change", () => {
    expect(detectionsRenderEqual([det()], [])).toBe(false);
    expect(detectionsRenderEqual([det()], [det(), det({ track_id: 2 })])).toBe(false);
  });

  it("detects movement", () => {
    const moved = det({ bbox: { x1: 0.15, y1: 0.1, x2: 0.25, y2: 0.4 } });
    expect(detectionsRenderEqual([det()], [moved])).toBe(false);
  });

  it("ignores sub-pixel jitter below the epsilon", () => {
    const jittered = det({ bbox: { x1: 0.100_01, y1: 0.1, x2: 0.2, y2: 0.4 } });
    expect(detectionsRenderEqual([det()], [jittered])).toBe(true);
  });

  it.each([
    ["class", { class: "car" }],
    ["track_id", { track_id: 2 }],
    ["confidence", { confidence: 0.5 }],
    ["speed", { speed: 40 }],
    ["overspeed", { overspeed: true }],
    ["speed_limit", { speed_limit: 30 }],
    ["plate_text", { plate_text: "MH12AB1234" }],
  ])("detects a change in %s (it is drawn)", (_name, patch) => {
    expect(detectionsRenderEqual([det()], [det(patch)])).toBe(false);
  });

  it("ignores fields the overlay never draws", () => {
    // dwell_time ticks up on every single payload. If it were compared, the
    // check would never once return true and the whole optimisation would be
    // silently dead.
    const a = det({ dwell_time: 1.0, direction: "north", tracking_status: "tracked" });
    const b = det({ dwell_time: 92.5, direction: "south", tracking_status: "coasting" });
    expect(detectionsRenderEqual([a], [b])).toBe(true);
  });

  it("fails towards 'changed' when order differs", () => {
    // Reordering is compared positionally rather than by identity: cheaper,
    // and a needless repaint is always safer than a missed one.
    const a = [det({ track_id: 1 }), det({ track_id: 2 })];
    const b = [det({ track_id: 2 }), det({ track_id: 1 })];
    expect(detectionsRenderEqual(a, b)).toBe(false);
  });
});
