import { describe, it, expect } from "vitest";
import {
  History,
  circleRadiusPx,
  distToSegmentPx,
  duplicateShape,
  hitBody,
  hitVertex,
  isInteractive,
  moveVertex,
  nextCopyName,
  pointInPolygon,
  rectFromDiagonal,
  topmostAt,
  translateShape,
  type EditableShape,
  type View,
} from "./zoneEditor";

// 16:9 — deliberately NOT square, so any hit test that forgets to convert to
// pixels shows up as an asymmetry between the axes.
const VIEW: View = { w: 1600, h: 900 };

const shape = (over: Partial<EditableShape> = {}): EditableShape => ({
  id: "s1",
  name: "Zone 1",
  type: "polygon",
  points: [[0.2, 0.2], [0.4, 0.2], [0.4, 0.4], [0.2, 0.4]],
  ...over,
});

const rect = (over: Partial<EditableShape> = {}): EditableShape =>
  shape({ type: "rectangle", points: rectFromDiagonal([0.2, 0.2], [0.4, 0.4]), ...over });

const circle = (over: Partial<EditableShape> = {}): EditableShape =>
  shape({ type: "circle", points: [[0.5, 0.5], [0.6, 0.5]], ...over });

const line = (over: Partial<EditableShape> = {}): EditableShape =>
  shape({ type: "line", points: [[0.1, 0.1], [0.9, 0.1]], ...over });

describe("hit testing", () => {
  it("grabs a vertex within the pixel tolerance", () => {
    expect(hitVertex(shape(), [0.2, 0.2], VIEW)).toBe(0);
    expect(hitVertex(shape(), [0.4, 0.4], VIEW)).toBe(2);
  });

  it("misses when the point is outside the tolerance", () => {
    expect(hitVertex(shape(), [0.3, 0.3], VIEW)).toBeNull();
  });

  it("uses a pixel tolerance, not a normalised one", () => {
    // 0.005 normalised = 8px across (w=1600) but only 4.5px down (h=900).
    // A naive normalised hypot would treat these two offsets identically.
    const tol = 8;
    const nearX = hitVertex(shape(), [0.2 + 0.005, 0.2], VIEW, tol); // exactly 8px
    const nearY = hitVertex(shape(), [0.2, 0.2 + 0.005], VIEW, tol); // only 4.5px
    expect(nearX).toBe(0);
    expect(nearY).toBe(0);
    // ...but 0.01 down is 9px -> out of range, while 0.01 across is 16px -> also out.
    expect(hitVertex(shape(), [0.2, 0.2 + 0.01], VIEW, tol)).toBeNull();
  });

  it("finds a point inside a polygon body and rejects one outside", () => {
    expect(hitBody(shape(), [0.3, 0.3], VIEW)).toBe(true);
    expect(hitBody(shape(), [0.9, 0.9], VIEW)).toBe(false);
  });

  it("treats a circle body by its pixel radius", () => {
    const c = circle();
    expect(circleRadiusPx(c, VIEW)).toBeCloseTo(160, 5); // 0.1 * 1600
    expect(hitBody(c, [0.55, 0.5], VIEW)).toBe(true); // 80px from centre
    expect(hitBody(c, [0.7, 0.5], VIEW)).toBe(false); // 320px from centre
  });

  it("hits a line only near the segment", () => {
    expect(hitBody(line(), [0.5, 0.1], VIEW)).toBe(true);
    expect(hitBody(line(), [0.5, 0.3], VIEW)).toBe(false);
  });

  it("does not extend a line hit beyond its endpoints", () => {
    // Same infinite line, but past the end of the segment.
    expect(distToSegmentPx([0.95, 0.1], [0.1, 0.1], [0.9, 0.1], VIEW)).toBeCloseTo(80, 5);
    expect(hitBody(line(), [0.95, 0.1], VIEW)).toBe(false);
  });

  it("rejects a degenerate polygon", () => {
    expect(pointInPolygon([0.5, 0.5], [[0.1, 0.1], [0.2, 0.2]])).toBe(false);
  });
});

describe("topmostAt", () => {
  it("returns the last-drawn shape when shapes overlap", () => {
    const a = shape({ id: "a" });
    const b = shape({ id: "b" });
    expect(topmostAt([a, b], [0.3, 0.3], VIEW)?.id).toBe("b");
  });

  it("skips locked shapes", () => {
    const a = shape({ id: "a" });
    const locked = shape({ id: "b", properties: { locked: true } });
    expect(topmostAt([a, locked], [0.3, 0.3], VIEW)?.id).toBe("a");
  });

  it("skips hidden shapes so an invisible zone cannot swallow clicks", () => {
    const a = shape({ id: "a" });
    const hidden = shape({ id: "b", properties: { hidden: true } });
    expect(topmostAt([a, hidden], [0.3, 0.3], VIEW)?.id).toBe("a");
  });

  it("returns null when nothing is under the point", () => {
    expect(topmostAt([shape()], [0.95, 0.95], VIEW)).toBeNull();
  });

  it("isInteractive gates on both flags", () => {
    expect(isInteractive(shape())).toBe(true);
    expect(isInteractive(shape({ properties: { locked: true } }))).toBe(false);
    expect(isInteractive(shape({ properties: { hidden: true } }))).toBe(false);
  });
});

describe("translateShape", () => {
  it("moves every point by the delta", () => {
    const moved = translateShape(shape(), 0.1, 0.05);
    expect(moved.points).toEqual([[0.3, 0.25], [0.5, 0.25], [0.5, 0.45], [0.3, 0.45]]);
  });

  it("does not mutate the input", () => {
    const s = shape();
    const before = JSON.parse(JSON.stringify(s.points));
    translateShape(s, 0.1, 0.1);
    expect(s.points).toEqual(before);
  });

  it("clamps as a rigid body, preserving shape at the edge", () => {
    // Dragged far past the right edge: must stop flush, still 0.2 wide.
    const moved = translateShape(shape(), 5, 0);
    const xs = moved.points.map((p) => p[0]);
    expect(Math.max(...xs)).toBe(1);
    expect(Math.min(...xs)).toBeCloseTo(0.8, 5);
    // Per-point clamping would have collapsed all four x's onto 1.0.
    expect(new Set(xs).size).toBe(2);
  });

  it("clamps at the origin too", () => {
    const moved = translateShape(shape(), -5, -5);
    expect(Math.min(...moved.points.map((p) => p[0]))).toBe(0);
    expect(Math.min(...moved.points.map((p) => p[1]))).toBe(0);
  });
});

describe("moveVertex", () => {
  it("moves a single polygon vertex only", () => {
    const moved = moveVertex(shape(), 0, [0.1, 0.1]);
    expect(moved.points[0]).toEqual([0.1, 0.1]);
    expect(moved.points[1]).toEqual([0.4, 0.2]);
  });

  it("keeps a rectangle axis-aligned by pinning the opposite corner", () => {
    const moved = moveVertex(rect(), 0, [0.1, 0.15]);
    expect(moved.points).toEqual(rectFromDiagonal([0.1, 0.15], [0.4, 0.4]));
    // Still a rectangle: two distinct x's, two distinct y's.
    expect(new Set(moved.points.map((p) => p[0])).size).toBe(2);
    expect(new Set(moved.points.map((p) => p[1])).size).toBe(2);
  });

  it("flips a rectangle rather than shearing it when dragged past the opposite corner", () => {
    const moved = moveVertex(rect(), 0, [0.9, 0.9]);
    expect(moved.points).toEqual(rectFromDiagonal([0.4, 0.4], [0.9, 0.9]));
    expect(new Set(moved.points.map((p) => p[0])).size).toBe(2);
  });

  it("preserves a circle's radius when dragged by the centre", () => {
    const c = circle();
    const before = circleRadiusPx(c, VIEW);
    const moved = moveVertex(c, 0, [0.3, 0.7]);
    expect(moved.points[0]).toEqual([0.3, 0.7]);
    expect(circleRadiusPx(moved, VIEW)).toBeCloseTo(before, 5);
  });

  it("resizes a circle from the rim handle", () => {
    const moved = moveVertex(circle(), 1, [0.7, 0.5]);
    expect(circleRadiusPx(moved, VIEW)).toBeCloseTo(320, 5);
    expect(moved.points[0]).toEqual([0.5, 0.5]);
  });

  it("clamps a dragged vertex into the frame", () => {
    const moved = moveVertex(shape(), 0, [-3, 9]);
    expect(moved.points[0]).toEqual([0, 1]);
  });
});

describe("duplicateShape", () => {
  it("offsets, re-ids and renames", () => {
    const d = duplicateShape(shape(), "s2");
    expect(d.id).toBe("s2");
    expect(d.name).toBe("Zone 1 copy");
    expect(d.points[0]).toEqual([0.23, 0.23]);
  });

  it("never produces a locked duplicate", () => {
    const d = duplicateShape(shape({ properties: { locked: true, color: "#fff" } }), "s2");
    expect(d.properties?.locked).toBe(false);
    expect(d.properties?.color).toBe("#fff");
  });

  it("keeps a duplicate of an edge-hugging shape inside the frame", () => {
    const atEdge = translateShape(shape(), 1, 1); // flush to bottom-right
    const d = duplicateShape(atEdge, "s2");
    expect(Math.max(...d.points.map((p) => p[0]))).toBeLessThanOrEqual(1);
    expect(Math.max(...d.points.map((p) => p[1]))).toBeLessThanOrEqual(1);
  });

  it("increments repeated copy names instead of stacking suffixes", () => {
    expect(nextCopyName("Zone 1")).toBe("Zone 1 copy");
    expect(nextCopyName("Zone 1 copy")).toBe("Zone 1 copy 2");
    expect(nextCopyName("Zone 1 copy 2")).toBe("Zone 1 copy 3");
  });
});

describe("History", () => {
  it("starts with no undo/redo available", () => {
    const h = new History([1]);
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(false);
    expect(h.current).toEqual([1]);
  });

  it("undoes and redoes in order", () => {
    const h = new History("a");
    h.push("b");
    h.push("c");
    expect(h.current).toBe("c");
    expect(h.undo()).toBe("b");
    expect(h.undo()).toBe("a");
    expect(h.canUndo).toBe(false);
    expect(h.redo()).toBe("b");
    expect(h.redo()).toBe("c");
    expect(h.canRedo).toBe(false);
  });

  it("is a no-op at the ends rather than throwing", () => {
    const h = new History("a");
    expect(h.undo()).toBe("a");
    expect(h.redo()).toBe("a");
  });

  it("discards the redo branch after a fresh edit", () => {
    const h = new History("a");
    h.push("b");
    h.undo(); // -> a
    h.push("c"); // forks; "b" is gone
    expect(h.canRedo).toBe(false);
    expect(h.current).toBe("c");
    expect(h.undo()).toBe("a");
  });

  it("evicts oldest states past the limit but keeps the present", () => {
    const h = new History(0, 3);
    h.push(1);
    h.push(2);
    h.push(3);
    expect(h.size).toBe(3);
    expect(h.current).toBe(3);
    expect(h.undo()).toBe(2);
    expect(h.undo()).toBe(1);
    expect(h.canUndo).toBe(false); // 0 was evicted
  });

  it("round-trips real shape snapshots", () => {
    const h = new History<EditableShape[]>([shape()]);
    h.push([translateShape(shape(), 0.1, 0)]);
    expect(h.current[0].points[0]).toEqual([0.3, 0.2]);
    expect(h.undo()[0].points[0]).toEqual([0.2, 0.2]);
  });
});
