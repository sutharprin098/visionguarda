import { describe, it, expect } from "vitest";
import { autoDetectSceneAndCalibrate, snapToDetectedScene } from "./autoSceneDetector";

describe("Auto Scene Detector & Solver", () => {
  it("automatically detects urban intersection and calibrates camera pose", () => {
    const camera = { id: "cam-coldwater", name: "Coldwater Intersection" };
    const profile = autoDetectSceneAndCalibrate(camera);

    expect(profile.archetype).toBe("urban_intersection");
    expect(profile.accuracy).toBeGreaterThanOrEqual(99.0);
    expect(profile.mountHeight).toBeGreaterThan(5);
    expect(profile.pitchDeg).toBeGreaterThan(15);
    expect(profile.hasCrosswalks).toBe(true);
    expect(profile.hasTrafficLights).toBe(true);
  });

  it("automatically detects highway when camera name indicates expressway", () => {
    const camera = { id: "cam-hwy", name: "I-80 Highway Northbound" };
    const profile = autoDetectSceneAndCalibrate(camera);

    expect(profile.archetype).toBe("straight_highway");
    expect(profile.accuracy).toBeGreaterThanOrEqual(99.0);
    expect(profile.hasGuardrails).toBe(true);
    expect(profile.hasHighwayGantry).toBe(true);
  });

  it("automatically detects warehouse when camera indicates interior logistics", () => {
    const camera = { id: "cam-wh", name: "Warehouse Bay 4 Logistics" };
    const profile = autoDetectSceneAndCalibrate(camera);

    expect(profile.archetype).toBe("indoor_warehouse");
    expect(profile.hasWarehouseColumns).toBe(true);
  });

  it("automatically detects Friant curved arterial expressway and sets cantilever boom", () => {
    const camera = { id: "637e142c-ecac-4974-8a38-26fbb987dab7", name: "02", source: "https://www.youtube.com/watch?v=sTF-6_xinUU" };
    const profile = autoDetectSceneAndCalibrate(camera);

    expect(profile.archetype).toBe("curved_arterial_expressway");
    expect(profile.accuracy).toBeGreaterThanOrEqual(99.4);
    expect(profile.hasOverheadCantileverBoom).toBe(true);
    expect(profile.hasRoadsideTrees).toBe(true);
    expect(profile.isCurvedRoad).toBe(true);

    // Snapping along curve
    const snappedForeground = snapToDetectedScene(0, 20, profile, false);
    const snappedDistant = snapToDetectedScene(30, -80, profile, false);
    expect(snappedForeground.x).toBeCloseTo(0, 0);
    expect(snappedDistant.x).toBeGreaterThan(15); // Swept rightwards along curve

    // Snapping along Shepherd Ave cross street (does NOT clamp into Friant curve)
    const snappedCrossStreet = snapToDetectedScene(-35, 6, profile, false);
    expect(snappedCrossStreet.x).toBe(-35);
    expect(snappedCrossStreet.z).toBeCloseTo(6, 0);
  });
});
