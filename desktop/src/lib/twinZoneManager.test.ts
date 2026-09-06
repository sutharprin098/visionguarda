import { describe, it, expect } from "vitest";
import {
  pointInPolygon,
  clampPointToRoadPolygons,
  generateAiDefaultZones,
  projectGroundToCamera,
} from "./twinZoneManager";

describe("Twin Zone Manager", () => {
  it("determines whether a point is inside a polygon", () => {
    // 10x10 square from 0 to 10
    const square: [number, number][] = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ];

    expect(pointInPolygon([5, 5], square)).toBe(true);
    expect(pointInPolygon([15, 5], square)).toBe(false);
    expect(pointInPolygon([-2, 5], square)).toBe(false);
  });

  it("leaves points inside road polygons untouched", () => {
    const roadPoly = [
      { x: -10, z: -10 },
      { x: 10, z: -10 },
      { x: 10, z: 10 },
      { x: -10, z: 10 },
    ];

    const insidePt = clampPointToRoadPolygons(0, 0, [roadPoly]);
    expect(insidePt.x).toBe(0);
    expect(insidePt.z).toBe(0);

    const insidePt2 = clampPointToRoadPolygons(5, -4, [roadPoly]);
    expect(insidePt2.x).toBe(5);
    expect(insidePt2.z).toBe(-4);
  });

  it("strictly snaps points outside road polygons to the closest road boundary", () => {
    const roadPoly = [
      { x: -10, z: -10 },
      { x: 10, z: -10 },
      { x: 10, z: 10 },
      { x: -10, z: 10 },
    ];

    // Point on the grass at X = 25, Z = 0
    // Nearest road boundary is the segment from (10, -10) to (10, 10)
    // Projected point should be (10, 0)
    const clampedPt = clampPointToRoadPolygons(25, 0, [roadPoly]);
    expect(clampedPt.x).toBeCloseTo(10, 1);
    expect(clampedPt.z).toBeCloseTo(0, 1);

    // Point in the trees at X = -5, Z = 20
    // Nearest road boundary is the segment from (10, 10) to (-10, 10)
    // Projected point should be (-5, 10)
    const clampedPt2 = clampPointToRoadPolygons(-5, 20, [roadPoly]);
    expect(clampedPt2.x).toBeCloseTo(-5, 1);
    expect(clampedPt2.z).toBeCloseTo(10, 1);
  });

  it("generates AI default zones for curved arterial expressway", () => {
    const zones = generateAiDefaultZones("curved_arterial_expressway");
    expect(zones.length).toBeGreaterThanOrEqual(4);

    const roadZones = zones.filter((z) => z.type === "road");
    expect(roadZones.length).toBe(2); // Friant + Shepherd

    const greenZones = zones.filter((z) => z.type === "green_area");
    expect(greenZones.length).toBeGreaterThanOrEqual(1);

    const poleZones = zones.filter((z) => z.type === "signal_pole");
    expect(poleZones.length).toBeGreaterThanOrEqual(1);
  });

  it("projects 3D ground coordinates to normalized camera coordinates", () => {
    // Ground point at (0, 0) with camera at (0, 10, 20), heading 0, pitch 25, fov 55
    const uv = projectGroundToCamera(0, 0, 0, 10, 20, 0, 25, 55);
    expect(uv).not.toBeNull();
    if (uv) {
      expect(uv[0]).toBeGreaterThan(0);
      expect(uv[0]).toBeLessThan(1);
      expect(uv[1]).toBeGreaterThan(0);
      expect(uv[1]).toBeLessThan(1);
      // Center column since X = camX = 0
      expect(uv[0]).toBeCloseTo(0.5, 1);
    }
  });
});

