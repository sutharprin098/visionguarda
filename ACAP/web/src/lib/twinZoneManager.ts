import { projectBboxToGround } from "../components/DigitalTwin3DView";
import type { SceneArchetype } from "./autoSceneDetector";

export type TwinZoneType = "road" | "green_area" | "stop_line" | "signal_pole";

export interface TwinCustomZone {
  id: string;
  type: TwinZoneType;
  label: string;
  points: [number, number][]; // normalized [0..1, 0..1] in camera image space
  color?: string;
}

/**
 * Standard winding-free even-odd Point-in-Polygon test
 */
export function pointInPolygon(pt: [number, number], poly: [number, number][]): boolean {
  if (!poly || poly.length < 3) return false;
  const [x, y] = pt;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    const intersects =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + Number.EPSILON) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/**
 * Mathematically snaps a 3D ground point (X, Z) to stay strictly inside the defined road polygon(s).
 * If the point is already inside ANY road polygon, it is returned unmodified.
 * If the point is outside all road polygons, it is orthogonally projected to the closest polygon edge.
 */
export function clampPointToRoadPolygons(
  x: number,
  z: number,
  roadPolygons3D: Array<Array<{ x: number; z: number }>>
): { x: number; z: number } {
  if (!roadPolygons3D || roadPolygons3D.length === 0) {
    return { x, z };
  }

  // 1. Check if point is inside ANY road polygon
  for (const poly of roadPolygons3D) {
    if (poly.length < 3) continue;
    const pts: [number, number][] = poly.map((p) => [p.x, p.z]);
    if (pointInPolygon([x, z], pts)) {
      return { x, z }; // Inside road, no snapping needed
    }
  }

  // 2. Point is outside all road polygons -> Orthogonal projection to nearest segment
  let bestX = x;
  let bestZ = z;
  let minDistSq = Infinity;

  for (const poly of roadPolygons3D) {
    if (poly.length < 2) continue;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const lenSq = dx * dx + dz * dz;
      if (lenSq < 0.00001) continue;

      let t = ((x - a.x) * dx + (z - a.z) * dz) / lenSq;
      t = Math.max(0, Math.min(1, t));

      const projX = a.x + t * dx;
      const projZ = a.z + t * dz;
      const distSq = (x - projX) * (x - projX) + (z - projZ) * (z - projZ);

      if (distSq < minDistSq) {
        minDistSq = distSq;
        bestX = projX;
        bestZ = projZ;
      }
    }
  }

  return { x: bestX, z: bestZ };
}

/**
 * Projects a 2D camera image zone polygon to 3D world ground plane coordinates (X, Z).
 */
export function projectZoneTo3D(
  zone: TwinCustomZone,
  camX: number,
  camY: number,
  camZ: number,
  heading: number,
  pitch: number,
  fov: number
): Array<{ x: number; z: number }> {
  const result: Array<{ x: number; z: number }> = [];

  for (const [u, v] of zone.points) {
    const pt = projectBboxToGround(u, v, camX, camY, camZ, heading, pitch, fov);
    if (pt) {
      result.push({ x: pt.x, z: pt.z });
    }
  }

  return result;
}

/**
 * Reverse projection: Converts 3D world ground plane coordinate (worldX, worldZ) 
 * back to normalized camera viewport coordinate [u, v] in [0..1, 0..1].
 * Returns null if the 3D point is behind the camera or out of view.
 */
export function projectGroundToCamera(
  worldX: number,
  worldZ: number,
  camX: number,
  camY: number,
  camZ: number,
  headingDeg: number,
  pitchDeg: number,
  fovDeg: number
): [number, number] | null {
  const dx = worldX - camX;
  const dy = 0 - camY;
  const dz = worldZ - camZ;

  const headingRad = (headingDeg * Math.PI) / 180;
  const pitchRad = (pitchDeg * Math.PI) / 180;
  const fovYRad = (fovDeg * Math.PI) / 180;
  const aspect = 16 / 9;
  const fovXRad = 2 * Math.atan(Math.tan(fovYRad / 2) * aspect);

  // Inverse Heading rotation (around Y)
  const cosH = Math.cos(headingRad);
  const sinH = Math.sin(headingRad);
  const x1 = cosH * dx - sinH * dz;
  const y1 = dy;
  const z1 = sinH * dx + cosH * dz;

  // Inverse Pitch rotation (around X)
  const cosP = Math.cos(pitchRad);
  const sinP = Math.sin(pitchRad);
  const xCam = x1;
  const yCam = cosP * y1 - sinP * z1;
  const zCam = sinP * y1 + cosP * z1;

  if (zCam >= -0.05) {
    return null; // Behind camera lens
  }

  const tanX = Math.tan(fovXRad / 2);
  const tanY = Math.tan(fovYRad / 2);

  const ndcX = xCam / (-zCam * tanX);
  const ndcY = yCam / (-zCam * tanY);

  const u = (ndcX + 1) / 2;
  const v = (1 - ndcY) / 2;

  return [Math.max(0, Math.min(1, Math.round(u * 1000) / 1000)), Math.max(0, Math.min(1, Math.round(v * 1000) / 1000))];
}


const STORAGE_KEY_PREFIX = "camai_twin_custom_zones_";

/**
 * Load saved custom zones from localStorage for a specific camera.
 */
export function loadCameraTwinZones(camId: string): TwinCustomZone[] {
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY_PREFIX}${camId}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (e) {
    console.warn("Failed to load twin zones from storage:", e);
  }
  return [];
}

/**
 * Save custom zones to localStorage for a specific camera.
 */
export function saveCameraTwinZones(camId: string, zones: TwinCustomZone[]): void {
  try {
    localStorage.setItem(`${STORAGE_KEY_PREFIX}${camId}`, JSON.stringify(zones));
  } catch (e) {
    console.warn("Failed to save twin zones to storage:", e);
  }
}

/**
 * Generates default AI calibrated polygons for a given scene archetype.
 * Perfect for quick 1-click calibration.
 */
export function generateAiDefaultZones(archetype: SceneArchetype): TwinCustomZone[] {
  if (archetype === "curved_arterial_expressway") {
    return [
      {
        id: "ai-friant-road",
        type: "road",
        label: "Friant Expressway (Curved Mainline)",
        color: "#06b6d4",
        points: [
          [0.22, 0.98],
          [0.34, 0.62],
          [0.54, 0.44],
          [0.72, 0.36],
          [0.86, 0.36],
          [0.82, 0.46],
          [0.72, 0.62],
          [0.96, 0.98],
        ],
      },
      {
        id: "ai-shepherd-cross",
        type: "road",
        label: "E Shepherd Ave (Cross Street)",
        color: "#38bdf8",
        points: [
          [0.02, 0.98],
          [0.02, 0.68],
          [0.38, 0.62],
          [0.68, 0.62],
          [0.98, 0.68],
          [0.98, 0.98],
        ],
      },
      {
        id: "ai-woodward-grass-west",
        type: "green_area",
        label: "Woodward Park Grass Verge (West)",
        color: "#10b981",
        points: [
          [0.02, 0.42],
          [0.32, 0.44],
          [0.26, 0.62],
          [0.02, 0.65],
        ],
      },
      {
        id: "ai-center-median",
        type: "green_area",
        label: "Divided Center Median Grass Island",
        color: "#059669",
        points: [
          [0.55, 0.72],
          [0.58, 0.52],
          [0.62, 0.52],
          [0.58, 0.72],
        ],
      },
      {
        id: "ai-signal-mast-pole",
        type: "signal_pole",
        label: "Overhead Cantilever Mast Arm Pole",
        color: "#ef4444",
        points: [
          [0.88, 0.52],
          [0.88, 0.88],
        ],
      },
      {
        id: "ai-shepherd-stop-bar",
        type: "stop_line",
        label: "Shepherd EB Stop Bar",
        color: "#ffffff",
        points: [
          [0.22, 0.78],
          [0.48, 0.78],
        ],
      },
    ];
  }

  // Default urban intersection
  return [
    {
      id: "ai-main-road",
      type: "road",
      label: "Main Roadway Corridor",
      color: "#06b6d4",
      points: [
        [0.15, 0.98],
        [0.32, 0.42],
        [0.68, 0.42],
        [0.85, 0.98],
      ],
    },
    {
      id: "ai-cross-street",
      type: "road",
      label: "Cross Street Corridor",
      color: "#38bdf8",
      points: [
        [0.02, 0.85],
        [0.02, 0.58],
        [0.98, 0.58],
        [0.98, 0.85],
      ],
    },
    {
      id: "ai-stop-line",
      type: "stop_line",
      label: "Intersection Stop Line",
      color: "#ffffff",
      points: [
        [0.25, 0.72],
        [0.75, 0.72],
      ],
    },
  ];
}
