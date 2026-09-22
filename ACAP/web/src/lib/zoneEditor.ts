// Pure geometry + history for the Zone Studio editor.
//
// Deliberately free of React, DOM and Supabase: every rule that is easy to get
// subtly wrong (hit testing, rectangles staying rectangular, circles keeping
// their radius when dragged by the centre, undo/redo ordering, clamping to the
// frame) lives here where it can be tested directly. AdminStudio is then a thin
// shell that maps pointer events onto these functions and persists the result.
//
// COORDINATES: every point is NORMALISED to the frame, 0..1 on both axes — the
// same space analytics_drawings stores and the engine reads (analytics.py takes
// normalised zone/line points). Normalised space is ANISOTROPIC: 0.01 across a
// 16:9 viewport is ~1.8x more pixels horizontally than vertically. So any
// distance used for hit testing must be computed in PIXELS via a View, never as
// a raw normalised hypot — otherwise grab targets are silently taller than they
// are wide and a circle's radius warps with the window.

export type ShapeType = "polygon" | "rectangle" | "circle" | "line";

export interface EditableShape {
  id: string;
  name: string;
  type: ShapeType;
  points: number[][];
  properties?: Record<string, any>;
}

/** Pixel size of the drawing surface — hit tests are done in pixel space. */
export interface View {
  w: number;
  h: number;
}

export const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

/** Round to the 4dp the rest of the pipeline stores, so a no-op drag can't
 *  produce a "changed" shape that differs only in float noise. */
const q = (n: number): number => Number(n.toFixed(4));

const px = (p: number[], view: View): [number, number] => [p[0] * view.w, p[1] * view.h];

export function distPx(a: number[], b: number[], view: View): number {
  const [ax, ay] = px(a, view);
  const [bx, by] = px(b, view);
  return Math.hypot(ax - bx, ay - by);
}

// ---------------------------------------------------------------------------
// Flags
// ---------------------------------------------------------------------------

export const isLocked = (s: EditableShape): boolean => !!s.properties?.locked;
export const isHidden = (s: EditableShape): boolean => !!s.properties?.hidden;

/** Locked OR hidden shapes are not grab targets. Hidden is not merely a render
 *  filter: an invisible shape that still swallows clicks is indistinguishable
 *  from a broken canvas. */
export const isInteractive = (s: EditableShape): boolean => !isLocked(s) && !isHidden(s);

// ---------------------------------------------------------------------------
// Circle helpers — points[0] is the centre, points[1] a point on the rim.
// The radius is a PIXEL distance (matching how the canvas renders it), which is
// why a circle needs the View to be interpreted at all.
// ---------------------------------------------------------------------------

export function circleRadiusPx(s: EditableShape, view: View): number {
  if (s.points.length < 2) return 0;
  return distPx(s.points[0], s.points[1], view);
}

// ---------------------------------------------------------------------------
// Hit testing
// ---------------------------------------------------------------------------

/** Index of the vertex handle under `pt`, or null. Later vertices win so the
 *  handle drawn on top is the one grabbed. */
export function hitVertex(s: EditableShape, pt: number[], view: View, tolPx = 8): number | null {
  let found: number | null = null;
  for (let i = 0; i < s.points.length; i++) {
    if (distPx(s.points[i], pt, view) <= tolPx) found = i;
  }
  return found;
}

/** Winding-free even-odd point-in-polygon on normalised coords (scale-invariant,
 *  so no View needed). */
export function pointInPolygon(pt: number[], poly: number[][]): boolean {
  if (poly.length < 3) return false;
  const [x, y] = pt;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + Number.EPSILON) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** Perpendicular pixel distance from `pt` to segment a-b. */
export function distToSegmentPx(pt: number[], a: number[], b: number[], view: View): number {
  const [pxx, pyy] = px(pt, view);
  const [ax, ay] = px(a, view);
  const [bx, by] = px(b, view);
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(pxx - ax, pyy - ay);
  let t = ((pxx - ax) * dx + (pyy - ay) * dy) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(pxx - (ax + t * dx), pyy - (ay + t * dy));
}

/** Is `pt` on/inside the shape's body (not its handles)? */
export function hitBody(s: EditableShape, pt: number[], view: View, tolPx = 6): boolean {
  if (s.type === "circle") {
    if (s.points.length < 2) return false;
    return distPx(s.points[0], pt, view) <= circleRadiusPx(s, view);
  }
  if (s.type === "line") {
    if (s.points.length < 2) return false;
    return distToSegmentPx(pt, s.points[0], s.points[1], view) <= tolPx;
  }
  return pointInPolygon(pt, s.points);
}

/** Topmost interactive shape under `pt`. Last drawn = topmost, matching paint
 *  order, so the shape the operator sees on top is the one they grab. */
export function topmostAt(shapes: EditableShape[], pt: number[], view: View, tolPx = 6): EditableShape | null {
  for (let i = shapes.length - 1; i >= 0; i--) {
    const s = shapes[i];
    if (!isInteractive(s)) continue;
    if (hitVertex(s, pt, view) !== null || hitBody(s, pt, view, tolPx)) return s;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Transforms — all return NEW shapes; nothing mutates in place.
// ---------------------------------------------------------------------------

/** Move the whole shape by (dx,dy) in normalised units.
 *
 *  Clamped as a RIGID BODY: the delta is reduced so every point stays in frame,
 *  rather than clamping each point independently — per-point clamping silently
 *  deforms a shape dragged into an edge (the leading points pile up on the
 *  boundary while the trailing ones keep moving). */
export function translateShape(s: EditableShape, dx: number, dy: number): EditableShape {
  const xs = s.points.map((p) => p[0]);
  const ys = s.points.map((p) => p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const adjDx = Math.max(-minX, Math.min(dx, 1 - maxX));
  const adjDy = Math.max(-minY, Math.min(dy, 1 - maxY));
  return { ...s, points: s.points.map(([x, y]) => [q(x + adjDx), q(y + adjDy)]) };
}

/** Axis-aligned rectangle from two diagonal corners, always ordered
 *  [TL, TR, BR, BL]. Re-normalising on every edit means dragging a corner past
 *  its opposite flips the rect instead of turning it into a bow-tie. */
export function rectFromDiagonal(a: number[], b: number[]): number[][] {
  const x0 = q(clamp01(Math.min(a[0], b[0])));
  const x1 = q(clamp01(Math.max(a[0], b[0])));
  const y0 = q(clamp01(Math.min(a[1], b[1])));
  const y1 = q(clamp01(Math.max(a[1], b[1])));
  return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
}

/** Drag vertex `i` to `pt`. Semantics are per-type:
 *   - rectangle: the opposite corner is pinned and the rect is rebuilt, so it
 *     stays axis-aligned (moving one corner freely would shear it into a
 *     quadrilateral the engine's zone maths does not expect).
 *   - circle:  vertex 0 moves the whole circle (centre drag must preserve the
 *              radius); vertex 1 sets the radius.
 *   - polygon/line: the vertex moves alone.
 */
export function moveVertex(s: EditableShape, i: number, pt: number[]): EditableShape {
  const p = [q(clamp01(pt[0])), q(clamp01(pt[1]))];

  if (s.type === "rectangle" && s.points.length === 4) {
    const opposite = s.points[(i + 2) % 4];
    return { ...s, points: rectFromDiagonal(p, opposite) };
  }

  if (s.type === "circle") {
    if (i === 0) {
      const dx = p[0] - s.points[0][0];
      const dy = p[1] - s.points[0][1];
      return translateShape(s, dx, dy);
    }
    return { ...s, points: [s.points[0], p] };
  }

  return { ...s, points: s.points.map((old, idx) => (idx === i ? p : old)) };
}

/** Copy offset slightly so the duplicate is visibly distinct and grabbable,
 *  nudged back inside the frame by translateShape's rigid clamp. */
export function duplicateShape(s: EditableShape, newId: string, offset = 0.03): EditableShape {
  const moved = translateShape(s, offset, offset);
  return {
    ...moved,
    id: newId,
    name: nextCopyName(s.name),
    // A duplicate of a locked shape must not arrive locked: the operator just
    // asked to work on it, and an immediately-unmovable copy reads as a bug.
    properties: { ...(s.properties ?? {}), locked: false },
  };
}

export function nextCopyName(name: string): string {
  const m = name.match(/^(.*) copy(?: (\d+))?$/);
  if (!m) return `${name} copy`;
  return `${m[1]} copy ${m[2] ? Number(m[2]) + 1 : 2}`;
}

// ---------------------------------------------------------------------------
// Undo / redo
// ---------------------------------------------------------------------------

/** Linear undo stack over immutable snapshots.
 *
 *  Snapshot-based rather than command-based: the editor's whole state is a small
 *  array of shapes, so storing copies is cheap and sidesteps the classic
 *  inverse-command bugs (an "unmove" that doesn't exactly invert a clamped move).
 */
export class History<T> {
  private stack: T[];
  private index: number;
  private limit: number;

  constructor(initial: T, limit = 100) {
    this.stack = [initial];
    this.index = 0;
    this.limit = limit;
  }

  get current(): T {
    return this.stack[this.index];
  }
  get canUndo(): boolean {
    return this.index > 0;
  }
  get canRedo(): boolean {
    return this.index < this.stack.length - 1;
  }
  /** Exposed for tests/telemetry; not part of the editing contract. */
  get size(): number {
    return this.stack.length;
  }

  /** Record a new state. Anything previously undone is discarded — the classic
   *  linear-history rule: a fresh edit after an undo forks and abandons the
   *  redo branch. */
  push(next: T): void {
    this.stack = this.stack.slice(0, this.index + 1);
    this.stack.push(next);
    if (this.stack.length > this.limit) this.stack.shift();
    this.index = this.stack.length - 1;
  }

  undo(): T {
    if (this.canUndo) this.index--;
    return this.current;
  }

  redo(): T {
    if (this.canRedo) this.index++;
    return this.current;
  }
}
