// Geometry tests for the smart crop window.
//
// cropWindow is pure arithmetic and is the part of the alert system most likely
// to be quietly wrong: an off-by-a-factor in padding still produces a
// plausible-looking picture, just of the wrong thing. These tests pin the
// behaviour the catalogue depends on.

import { describe, it, expect } from "vitest";
import { cropWindow, type CropPadding, type NormalisedBox } from "./smartCrop";

const FRAME = { w: 1920, h: 1080 };

/** A person-shaped box in the middle of frame: 100px wide, 250px tall. */
const PERSON_BOX: NormalisedBox = {
  x1: 910 / 1920, y1: 400 / 1080,
  x2: 1010 / 1920, y2: 650 / 1080,
};

const pad = (o: Partial<CropPadding> = {}): CropPadding =>
  ({ x: 0.15, top: 0.15, bottom: 0.15, aspect: 4 / 3, ...o });

const aspectOf = (r: { w: number; h: number }) => r.w / r.h;

describe("cropWindow", () => {
  it("produces a window at the requested aspect ratio", () => {
    for (const a of [0.64, 1, 1.1, 1.5, 2.8]) {
      const r = cropWindow(PERSON_BOX, pad({ aspect: a }), FRAME);
      // Rounding to whole pixels costs a little precision on small windows.
      expect(aspectOf(r)).toBeCloseTo(a, 1);
    }
  });

  it("keeps a portrait subject portrait instead of forcing it to 16:9", () => {
    const portrait = cropWindow(PERSON_BOX, pad({ aspect: 0.64 }), FRAME);
    const wide = cropWindow(PERSON_BOX, pad({ aspect: 16 / 9 }), FRAME);
    // The whole point of per-class aspect: the portrait window is dramatically
    // narrower, which is background NOT included.
    expect(portrait.w).toBeLessThan(wide.w);
    expect(aspectOf(portrait)).toBeLessThan(1);
  });

  it("never returns a window outside the frame", () => {
    const corners: NormalisedBox[] = [
      { x1: 0, y1: 0, x2: 0.04, y2: 0.06 },            // top-left
      { x1: 0.96, y1: 0, x2: 1, y2: 0.06 },            // top-right
      { x1: 0, y1: 0.94, x2: 0.04, y2: 1 },            // bottom-left
      { x1: 0.96, y1: 0.94, x2: 1, y2: 1 },            // bottom-right
    ];
    for (const box of corners) {
      for (const a of [0.64, 1, 2.8]) {
        const r = cropWindow(box, pad({ aspect: a }), FRAME);
        expect(r.x).toBeGreaterThanOrEqual(0);
        expect(r.y).toBeGreaterThanOrEqual(0);
        expect(r.x + r.w).toBeLessThanOrEqual(FRAME.w);
        expect(r.y + r.h).toBeLessThanOrEqual(FRAME.h);
      }
    }
  });

  it("slides an edge subject inward rather than shrinking its window", () => {
    const centre = cropWindow(PERSON_BOX, pad(), FRAME);
    const atEdge = cropWindow(
      { x1: 0, y1: 400 / 1080, x2: 100 / 1920, y2: 650 / 1080 },
      pad(),
      FRAME,
    );
    // Same requested area, just repositioned — an object against the edge must
    // not silently get a smaller crop than one in the middle.
    expect(atEdge.w).toBe(centre.w);
    expect(atEdge.h).toBe(centre.h);
    expect(atEdge.x).toBe(0);
  });

  it("applies directional padding: head-and-shoulder extends downward", () => {
    const head: NormalisedBox = { x1: 0.45, y1: 0.30, x2: 0.55, y2: 0.40 };
    const headPx = { top: 0.30 * FRAME.h, bottom: 0.40 * FRAME.h };
    const r = cropWindow(head, { x: 0.55, top: 0.22, bottom: 1.05, aspect: 1.1 }, FRAME);
    const belowChin = r.y + r.h - headPx.bottom;
    const aboveCrown = headPx.top - r.y;
    // Substantially more room below the head than above it — that is the
    // shoulders being included and the sky being excluded.
    expect(belowChin).toBeGreaterThan(aboveCrown * 2);
  });

  it("gives a plate horizontal room without vertical bloat", () => {
    const plate: NormalisedBox = { x1: 0.48, y1: 0.60, x2: 0.56, y2: 0.635 };
    const r = cropWindow(plate, { x: 0.45, top: 0.14, bottom: 0.14, aspect: 2.8 }, FRAME);
    expect(aspectOf(r)).toBeCloseTo(2.8, 1);
    expect(r.w).toBeGreaterThan(r.h * 2);
  });

  it("clamps a degenerate aspect instead of producing an unusable sliver", () => {
    const r = cropWindow(PERSON_BOX, pad({ aspect: 40 }), FRAME);
    expect(aspectOf(r)).toBeLessThanOrEqual(3.3);
    const tall = cropWindow(PERSON_BOX, pad({ aspect: 0.01 }), FRAME);
    expect(aspectOf(tall)).toBeGreaterThanOrEqual(0.45);
  });

  it("falls back to a sane aspect for non-finite input", () => {
    const r = cropWindow(PERSON_BOX, pad({ aspect: NaN }), FRAME);
    expect(Number.isFinite(aspectOf(r))).toBe(true);
    expect(r.w).toBeGreaterThan(0);
    expect(r.h).toBeGreaterThan(0);
  });

  it("enforces a minimum window so a distant object is not four pixels", () => {
    const tiny: NormalisedBox = { x1: 0.5, y1: 0.5, x2: 0.505, y2: 0.515 };
    const r = cropWindow(tiny, pad({ aspect: 1 }), FRAME);
    // Must be far larger than the ~10x16px detection itself.
    expect(Math.max(r.w, r.h)).toBeGreaterThan(200);
  });

  it("never exceeds the frame even when padding asks for more", () => {
    const big: NormalisedBox = { x1: 0.05, y1: 0.05, x2: 0.95, y2: 0.95 };
    const r = cropWindow(big, pad({ x: 3, top: 3, bottom: 3, aspect: 1 }), FRAME);
    expect(r.w).toBeLessThanOrEqual(FRAME.w);
    expect(r.h).toBeLessThanOrEqual(FRAME.h);
  });
});
