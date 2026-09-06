import React, { useEffect, useRef, useState, useMemo, useCallback } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { 
  Box, 
  Layers, 
  Eye, 
  Car, 
  Users, 
  Activity, 
  RefreshCw, 
  Video, 
  Sliders,
  Sparkles,
  Tv,
  Crosshair,
  Plus,
  Compass,
  Maximize2,
  Minimize2,
  Play,
  CheckCircle2,
  X,
  Gauge,
  Sun,
  Moon,
  Volume2,
  VolumeX,
  Navigation,
  PenTool
} from "lucide-react";
import clsx from "clsx";
import type { CameraTelemetry, TelemetryDetection } from "../lib/telemetry";
import { TelemetrySession } from "../lib/telemetry";
import { mjpegStreamUrl, controlHeaders } from "../lib/localEngine";
import {
  autoDetectSceneAndCalibrate,
  snapToDetectedScene,
  type DetectedSceneProfile,
  type SceneArchetype
} from "../lib/autoSceneDetector";
import {
  type TwinCustomZone,
  loadCameraTwinZones,
  saveCameraTwinZones,
  projectZoneTo3D,
  clampPointToRoadPolygons,
} from "../lib/twinZoneManager";
import { TwinZoneEditorModal } from "./TwinZoneEditorModal";

export { snapToDetectedScene, type DetectedSceneProfile, type SceneArchetype };

export type CameraSlot = "north" | "south" | "east" | "west" | "custom";

export interface CameraSpatialConfig {
  id: string;
  name: string;
  slot: CameraSlot;
  spatial_sync: boolean;
  heading: number; // 0 to 360 degrees
  pitch: number;   // 10 to 80 degrees tilt down
  height: number;  // 3 to 25 meters mount height
  fov: number;     // 40 to 90 degrees
  posX?: number;   // Camera position X in meters
  posZ?: number;   // Camera position Z in meters
  videoOpacity?: number; // 0.0 to 1.0 ground video projection opacity
}

interface DigitalTwin3DViewProps {
  cameras: any[];
  telemetryMap?: Record<string, CameraTelemetry>;
  spatialConfigs?: Record<string, CameraSpatialConfig>;
  onUpdateSpatialConfig?: (camId: string, updates: Partial<CameraSpatialConfig>) => void;
  selectedCameraId?: string | null;
  onSelectCamera?: (camId: string) => void;
  onCameraAdded?: () => void;
  initialConfiguratorMode?: "closed" | "split" | "floating" | "modal";
}

interface RealTrackedEntity3D {
  id: string;
  class_name: string;
  x: number;
  z: number;
  targetX: number;
  targetZ: number;
  speed: number;
  confidence: number;
  track_id?: number | null;
  lastSeen: number;
  fusedCameras: string[];
  color: number;
  meshGroup?: THREE.Group;
  heading: number;
  trailPoints: THREE.Vector3[];
  trailLine?: THREE.Line;
}

// -------------------------------------------------------------
// Shared Pre-allocated 3D Assets for High-FPS Vehicle Rendering
// -------------------------------------------------------------
function markShared<T extends { userData: Record<string, any> }>(asset: T): T {
  asset.userData = asset.userData || {};
  asset.userData.isShared = true;
  return asset;
}

const SHARED_GEOS = {
  carBody: markShared(new THREE.BoxGeometry(2.0, 1.35 * 0.55, 4.4)),
  carCabin: markShared(new THREE.BoxGeometry(2.0 * 0.88, 1.35 * 0.5, 4.4 * 0.55)),
  truckBody: markShared(new THREE.BoxGeometry(2.4, 1.8 * 0.55, 5.6)),
  truckCabin: markShared(new THREE.BoxGeometry(2.4 * 0.88, 1.8 * 0.5, 5.6 * 0.45)),
  busBody: markShared(new THREE.BoxGeometry(2.8, 3.0 * 0.55, 8.8)),
  busCabin: markShared(new THREE.BoxGeometry(2.8 * 0.88, 3.0 * 0.5, 8.8 * 0.85)),
  wheel: markShared(new THREE.CylinderGeometry(0.35, 0.35, 0.25, 12)),
  headlight: markShared(new THREE.BoxGeometry(0.35, 0.15, 0.1)),
  personBody: markShared(new THREE.CylinderGeometry(0.24, 0.24, 1.4, 10)),
  personHead: markShared(new THREE.SphereGeometry(0.2, 10, 10)),
  personRing: markShared(new THREE.RingGeometry(0.3, 0.55, 12)),
  carCage: markShared(new THREE.EdgesGeometry(new THREE.BoxGeometry(2.3, 1.75, 4.7))),
  truckCage: markShared(new THREE.EdgesGeometry(new THREE.BoxGeometry(2.7, 2.2, 5.9))),
  busCage: markShared(new THREE.EdgesGeometry(new THREE.BoxGeometry(3.1, 3.4, 9.1))),
};

const SHARED_MATS = {
  cabin: markShared(new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.1, metalness: 0.9 })),
  wheel: markShared(new THREE.MeshStandardMaterial({ color: 0x090d16, roughness: 0.8 })),
  headlight: markShared(new THREE.MeshBasicMaterial({ color: 0xffffff })),
  taillight: markShared(new THREE.MeshBasicMaterial({ color: 0xef4444 })),
  personBody: markShared(new THREE.MeshStandardMaterial({ color: 0x818cf8, roughness: 0.35 })),
  personHead: markShared(new THREE.MeshBasicMaterial({ color: 0xc7d2fe })),
  personRing: markShared(new THREE.MeshBasicMaterial({ color: 0x818cf8, side: THREE.DoubleSide })),
  cageCyan: markShared(new THREE.LineBasicMaterial({ color: 0x06b6d4, transparent: true, opacity: 0.75 })),
  cageGreen: markShared(new THREE.LineBasicMaterial({ color: 0x10b981, transparent: true, opacity: 0.85 })),
  // Vehicle body materials by category
  matCyan: markShared(new THREE.MeshStandardMaterial({ color: 0x06b6d4, roughness: 0.25, metalness: 0.8 })),
  matIndigo: markShared(new THREE.MeshStandardMaterial({ color: 0x818cf8, roughness: 0.25, metalness: 0.8 })),
  matAmber: markShared(new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.25, metalness: 0.8 })),
  matRose: markShared(new THREE.MeshStandardMaterial({ color: 0xf43f5e, roughness: 0.25, metalness: 0.8 })),
  matPurple: markShared(new THREE.MeshStandardMaterial({ color: 0xa855f7, roughness: 0.25, metalness: 0.8 })),
};

// -------------------------------------------------------------
// Cleanly release WebGL GPU memory to prevent memory leaks and GC stalls
// -------------------------------------------------------------
export function disposeHierarchy(obj: THREE.Object3D) {
  obj.traverse((child: any) => {
    if (child.userData?.isShared) return;
    if (child.geometry && !child.geometry.userData?.isShared) {
      child.geometry.dispose();
    }
    if (child.material && !child.material.userData?.isShared) {
      if (Array.isArray(child.material)) {
        child.material.forEach((m: any) => {
          if (m.map && !m.map.userData?.isShared) m.map.dispose();
          if (!m.userData?.isShared) m.dispose();
        });
      } else {
        if (child.material.map && !child.material.map.userData?.isShared) child.material.map.dispose();
        child.material.dispose();
      }
    }
  });
}

// -------------------------------------------------------------
// Inverse Perspective Mapping (Ground Plane Raycasting)
// Converts normalized bbox ground contact point (cx, bottom) into 3D world (X, 0, Z)
// -------------------------------------------------------------
export function snapToRoad(worldX: number, worldZ: number, isPerson: boolean = false): { x: number; z: number } {
  const halfRoad = 10.2; // 22m asphalt road boundary with curb margin
  const box = 11.5;      // 4-way intersection interior junction box

  // 1. Inside 4-way intersection box: completely free movement in all directions
  if (Math.abs(worldX) <= box && Math.abs(worldZ) <= box) {
    return { x: worldX, z: worldZ };
  }

  // 2. Along North-South Avenue (|worldZ| > |worldX|)
  if (Math.abs(worldZ) > Math.abs(worldX)) {
    let x = worldX;
    if (!isPerson) {
      x = Math.max(-halfRoad, Math.min(halfRoad, x));
    }
    const z = Math.max(-105, Math.min(32, worldZ));
    return { x, z };
  }

  // 3. Along East-West Cross Street (|worldX| > |worldZ|)
  let z = worldZ;
  if (!isPerson) {
    z = Math.max(-halfRoad, Math.min(halfRoad, z));
  }
  const x = Math.max(-95, Math.min(95, worldX));
  return { x, z };
}

export function projectBboxToGround(
  cx: number,
  bottomY: number,
  camX: number,
  camY: number,
  camZ: number,
  headingDeg: number,
  pitchDeg: number,
  fovDeg: number
): { x: number; z: number } | null {
  // Normalize if pixel coordinates or clamped bounds
  let normCx = cx > 1.0 ? cx / 640 : cx;
  let normBottomY = bottomY > 1.0 ? bottomY / 360 : bottomY;
  normCx = Math.max(0.01, Math.min(0.99, normCx));
  normBottomY = Math.max(0.01, Math.min(0.99, normBottomY));

  const headingRad = (headingDeg * Math.PI) / 180;
  const pitchRad = (pitchDeg * Math.PI) / 180;
  const fovYRad = (fovDeg * Math.PI) / 180;
  const aspect = 16 / 9;
  const fovXRad = 2 * Math.atan(Math.tan(fovYRad / 2) * aspect);

  // Normalized Device Coordinates (-1 to +1)
  const ndcX = (normCx - 0.5) * 2;
  const ndcY = (0.5 - normBottomY) * 2;

  // Ray in local camera coordinate frame
  const tanX = ndcX * Math.tan(fovXRad / 2);
  const tanY = ndcY * Math.tan(fovYRad / 2);
  const vLocal = new THREE.Vector3(tanX, tanY, -1).normalize();

  // Rotate ray by Pitch (X-axis tilt down) then Heading (Y-axis rotation)
  const rotEuler = new THREE.Euler(-pitchRad, -headingRad, 0, "YXZ");
  const rayDir = vLocal.applyEuler(rotEuler).normalize();

  // Raycast to Ground Plane Y = 0
  if (rayDir.y < -0.005) {
    const t = -camY / rayDir.y;
    if (t > 0 && t < 260) {
      const worldX = camX + t * rayDir.x;
      const worldZ = camZ + t * rayDir.z;
      return { x: worldX, z: worldZ };
    }
  }

  // Graceful road-aligned perspective fallback if detection is near/at the horizon
  const horizonFraction = Math.max(0.01, normBottomY - 0.22);
  const distForward = Math.min(120, Math.max(6, (1.0 / horizonFraction) * (camY * 0.48)));
  const distLateral = (normCx - 0.5) * (distForward * 0.55 + 4);
  const dX = distForward * Math.sin(headingRad) + distLateral * Math.cos(headingRad);
  const dZ = -distForward * Math.cos(headingRad) + distLateral * Math.sin(headingRad);
  return { x: camX + dX, z: camZ + dZ };
}

// -------------------------------------------------------------
// Procedural 3D Environment Generator
// Dynamically builds the 3D surroundings based on the detected camera scene:
// - Urban 4-way intersection (roads, crosswalks, traffic lights, downtown buildings)
// - Straight highway (6 lanes, center jersey barrier, guardrails, signage gantry, lights)
// - Arterial boulevard (4 lanes, sidewalks, curbs, trees, streetlamps, shops)
// - Commercial parking lot (parking stalls, driving aisles, floodlight towers, fencing)
// - Industrial warehouse (polished concrete, safety markings, columns, roof trusses)
// - Indoor corridor (tiled floor, drywall walls, doors, suspended ceiling, LED troffers)
// -------------------------------------------------------------
// Helper to construct seamless parametric ribbon strips along a CatmullRom 3D curve
function createCurvedRibbon(
  curve: THREE.CatmullRomCurve3,
  width: number,
  offsetLateral: number,
  yHeight: number,
  steps: number = 80
): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const pt = curve.getPointAt(t);
    const tangent = curve.getTangentAt(t).normalize();
    // Normal vector perpendicular to tangent in horizontal plane
    const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();

    const center = pt.clone().add(normal.clone().multiplyScalar(offsetLateral));
    const half = width / 2;
    const pLeft = center.clone().add(normal.clone().multiplyScalar(-half));
    const pRight = center.clone().add(normal.clone().multiplyScalar(half));

    positions.push(pLeft.x, yHeight, pLeft.z);
    positions.push(pRight.x, yHeight, pRight.z);

    uvs.push(0, t);
    uvs.push(1, t);

    if (i < steps) {
      const base = i * 2;
      indices.push(base, base + 1, base + 2);
      indices.push(base + 1, base + 3, base + 2);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

export function buildProceduralEnvironment(
  g: THREE.Group,
  profile: DetectedSceneProfile,
  isDayTime: boolean,
  customZones?: TwinCustomZone[],
  camSpatial?: CameraSpatialConfig | null,
  isExplicitOverride: boolean = false
) {
  while (g.children.length > 0) {
    const child = g.children[0];
    disposeHierarchy(child);
    g.remove(child);
  }

  const isCurvedExpressway = profile.archetype === "curved_arterial_expressway";
  const isHighway = profile.archetype === "straight_highway";
  const isArterial = profile.archetype === "arterial_road";
  const isParking = profile.archetype === "parking_lot";
  const isWarehouse = profile.archetype === "indoor_warehouse";
  const isCorridor = profile.archetype === "indoor_corridor";

  // 1. Base Terrain Ground Plane
  const terrainGeo = new THREE.PlaneGeometry(380, 380);
  const terrainColor = (isHighway || isCurvedExpressway)
    ? (isDayTime ? 0x142b1c : 0x09150d) // Grass roadside verge
    : (isWarehouse || isCorridor)
    ? (isDayTime ? 0x182030 : 0x0f1520) // Indoor substrate
    : (isDayTime ? 0x0b1120 : 0x04060a); // Dark city terrain
  const terrainMat = new THREE.MeshStandardMaterial({
    color: terrainColor,
    roughness: 0.95,
    metalness: 0.05,
  });
  const terrain = new THREE.Mesh(terrainGeo, terrainMat);
  terrain.rotation.x = -Math.PI / 2;
  terrain.position.y = -0.05;
  terrain.receiveShadow = true;
  g.add(terrain);

  // Metric grid reference
  const grid = new THREE.GridHelper(260, 65, 0x0284c7, 0x1e293b);
  grid.position.y = 0.01;
  (grid.material as THREE.Material).opacity = isWarehouse || isCorridor ? 0.32 : 0.22;
  (grid.material as THREE.Material).transparent = true;
  g.add(grid);

  // Materials
  const asphaltMat = new THREE.MeshStandardMaterial({
    color: isHighway || isCurvedExpressway ? 0x121724 : 0x181f2f,
    roughness: 0.78,
    metalness: 0.14,
  });
  const yellowLineMat = new THREE.MeshBasicMaterial({ color: 0xf59e0b });
  const whiteLineMat = new THREE.MeshBasicMaterial({ color: 0xe2e8f0 });
  const curbMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.85 });
  const metalMat = new THREE.MeshStandardMaterial({ color: 0x64748b, metalness: 0.85, roughness: 0.2 });
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.8, roughness: 0.25 });
  const bldgMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.85, metalness: 0.15 });

  // Render Custom User-Mapped 3D Zones if present
  if (customZones && customZones.length > 0 && camSpatial) {
    const cX = camSpatial.posX ?? 0;
    const cY = camSpatial.height ?? 10.5;
    const cZ = camSpatial.posZ ?? 24;

    customZones.forEach((zone) => {
      const pts3D = projectZoneTo3D(
        zone,
        cX,
        cY,
        cZ,
        camSpatial.heading,
        camSpatial.pitch,
        camSpatial.fov
      );

      if (zone.type === "road" && pts3D.length >= 3) {
        // Physical Custom Asphalt Road Mesh
        const shape = new THREE.Shape();
        shape.moveTo(pts3D[0].x, -pts3D[0].z);
        for (let i = 1; i < pts3D.length; i++) {
          shape.lineTo(pts3D[i].x, -pts3D[i].z);
        }
        shape.closePath();

        const roadGeo = new THREE.ShapeGeometry(shape);
        const roadMesh = new THREE.Mesh(roadGeo, asphaltMat);
        roadMesh.rotation.x = -Math.PI / 2;
        roadMesh.position.y = 0.024;
        roadMesh.receiveShadow = true;
        g.add(roadMesh);

        // Cyan Boundary Guidance Outline
        const linePts = pts3D.map((p) => new THREE.Vector3(p.x, 0.035, p.z));
        linePts.push(new THREE.Vector3(pts3D[0].x, 0.035, pts3D[0].z));
        const lineGeo = new THREE.BufferGeometry().setFromPoints(linePts);
        const lineMat = new THREE.LineBasicMaterial({ color: 0x06b6d4, linewidth: 2 });
        g.add(new THREE.Line(lineGeo, lineMat));
      } else if (zone.type === "green_area" && pts3D.length >= 3) {
        // Physical Custom Green Grass Patch
        const shape = new THREE.Shape();
        shape.moveTo(pts3D[0].x, -pts3D[0].z);
        for (let i = 1; i < pts3D.length; i++) {
          shape.lineTo(pts3D[i].x, -pts3D[i].z);
        }
        shape.closePath();

        const greenGeo = new THREE.ShapeGeometry(shape);
        const greenMat = new THREE.MeshStandardMaterial({ color: 0x1e4620, roughness: 0.9 });
        const greenMesh = new THREE.Mesh(greenGeo, greenMat);
        greenMesh.rotation.x = -Math.PI / 2;
        greenMesh.position.y = 0.026;
        g.add(greenMesh);
      } else if (zone.type === "stop_line" && pts3D.length >= 2) {
        // Physical Custom Stop Bar
        const p1 = new THREE.Vector3(pts3D[0].x, 0.038, pts3D[0].z);
        const p2 = new THREE.Vector3(pts3D[1].x, 0.038, pts3D[1].z);
        const len = p1.distanceTo(p2);
        const stopGeo = new THREE.PlaneGeometry(0.65, Math.max(0.5, len));
        const stopMesh = new THREE.Mesh(stopGeo, whiteLineMat);
        stopMesh.rotation.x = -Math.PI / 2;
        const mid = p1.clone().add(p2).multiplyScalar(0.5);
        stopMesh.position.set(mid.x, 0.038, mid.z);
        stopMesh.rotation.z = Math.atan2(p2.x - p1.x, -(p2.z - p1.z));
        g.add(stopMesh);
      } else if (zone.type === "signal_pole" && pts3D.length >= 1) {
        // Physical Traffic Mast Pole
        const poleG = new THREE.Group();
        poleG.position.set(pts3D[0].x, 0, pts3D[0].z);
        const mastPole = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.28, 7.5, 12), metalMat);
        mastPole.position.y = 3.75;
        poleG.add(mastPole);

        const sigHousing = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.2, 0.3), poleMat);
        sigHousing.position.set(0, 6.2, 0);
        poleG.add(sigHousing);

        const redGlow = new THREE.Mesh(
          new THREE.SphereGeometry(0.14, 8, 8),
          new THREE.MeshBasicMaterial({ color: 0xef4444 })
        );
        redGlow.position.set(0, 6.55, 0.16);
        poleG.add(redGlow);

        g.add(poleG);
      }
    });

    // Clean user-drawn 3D world: do not render pre-baked hardcoded roads or trees!
    return;
  }

  // Clean 3D scene: If no custom zones drawn and no explicit preset requested, keep scene clean!
  if (!isExplicitOverride) {
    return;
  }

  if (isCurvedExpressway) {
    // -------------------------------------------------------------
    // CURVED ARTERIAL EXPRESSWAY (FRIANT ROAD & SHEPHERD INTERSECTION)
    // Modeled precisely matching the real camera:
    // - Parametric Catmull-Rom asphalt road sweeping rightwards (R ~ 140m)
    // - Curved double-yellow centerlines & white dashed lane lines
    // - Massive overhead cantilever curved tubular mast arm spanning across lanes with 4 traffic lights
    // - Center curbed median island
    // - California roadside trees (pines, eucalyptuses) & grass hillside (NO skyscrapers!)
    // -------------------------------------------------------------
    const curvePoints = [
      new THREE.Vector3(0, 0, 36),
      new THREE.Vector3(1.2, 0, 18),
      new THREE.Vector3(3.8, 0, 0),
      new THREE.Vector3(8.2, 0, -22),
      new THREE.Vector3(14.5, 0, -48),
      new THREE.Vector3(23.0, 0, -80),
      new THREE.Vector3(34.0, 0, -125),
    ];
    const roadSpline = new THREE.CatmullRomCurve3(curvePoints);

    // Main Curved Asphalt Surface (24m wide)
    const roadGeo = createCurvedRibbon(roadSpline, 24.0, 0, 0.02, 100);
    const roadMesh = new THREE.Mesh(roadGeo, asphaltMat);
    roadMesh.receiveShadow = true;
    g.add(roadMesh);

    // 2. Shepherd Avenue Asphalt Cross Street (East-West across X from -95 to +50, Z centered at 6.0, width 17.5m)
    const shepherdGeo = new THREE.PlaneGeometry(145, 17.5);
    const shepherdRoad = new THREE.Mesh(shepherdGeo, asphaltMat);
    shepherdRoad.rotation.x = -Math.PI / 2;
    shepherdRoad.position.set(-22.5, 0.021, 6.0);
    shepherdRoad.receiveShadow = true;
    g.add(shepherdRoad);

    // 3. Double Yellow Centerlines:
    // Friant Rd Curved Double Yellow Centerlines
    const yLine1 = new THREE.Mesh(createCurvedRibbon(roadSpline, 0.22, -0.25, 0.035, 100), yellowLineMat);
    const yLine2 = new THREE.Mesh(createCurvedRibbon(roadSpline, 0.22, 0.25, 0.035, 100), yellowLineMat);
    g.add(yLine1);
    g.add(yLine2);

    // Shepherd Ave Double Yellow Centerlines along Z = 6.0
    // West approach: X in [-95, -13.5]
    const syLineW1 = new THREE.Mesh(new THREE.PlaneGeometry(81.5, 0.22), yellowLineMat);
    syLineW1.rotation.x = -Math.PI / 2;
    syLineW1.position.set(-54.25, 0.034, 5.85);
    g.add(syLineW1);
    const syLineW2 = syLineW1.clone();
    syLineW2.position.z = 6.15;
    g.add(syLineW2);

    // East approach: X in [14.0, 50]
    const syLineE1 = new THREE.Mesh(new THREE.PlaneGeometry(36, 0.22), yellowLineMat);
    syLineE1.rotation.x = -Math.PI / 2;
    syLineE1.position.set(32.0, 0.034, 5.85);
    g.add(syLineE1);
    const syLineE2 = syLineE1.clone();
    syLineE2.position.z = 6.15;
    g.add(syLineE2);

    // 4. White Dashed Lane Lines for Friant Rd (4-6 travel lanes)
    const laneOffsets = [-4.5, -8.5, 4.5, 8.5];
    laneOffsets.forEach(off => {
      for (let i = 0; i <= 36; i++) {
        const tStart = i / 36;
        const tEnd = (i + 0.45) / 36;
        if (tEnd > 1.0) break;
        const pt1 = roadSpline.getPointAt(tStart);
        // Omit dashes inside the central intersection box (Z in [-2, 14])
        if (pt1.z > -2 && pt1.z < 14) continue;

        const tan1 = roadSpline.getTangentAt(tStart).normalize();
        const norm1 = new THREE.Vector3(-tan1.z, 0, tan1.x).normalize();
        const p1 = pt1.clone().add(norm1.multiplyScalar(off));

        const pt2 = roadSpline.getPointAt(tEnd);
        const tan2 = roadSpline.getTangentAt(tEnd).normalize();
        const norm2 = new THREE.Vector3(-tan2.z, 0, tan2.x).normalize();
        const p2 = pt2.clone().add(norm2.multiplyScalar(off));

        const dashLen = p1.distanceTo(p2);
        const dashGeo = new THREE.PlaneGeometry(0.18, dashLen);
        const dash = new THREE.Mesh(dashGeo, whiteLineMat);
        dash.rotation.x = -Math.PI / 2;
        const mid = p1.clone().add(p2).multiplyScalar(0.5);
        dash.position.set(mid.x, 0.033, mid.z);
        dash.rotation.z = Math.atan2(p2.x - p1.x, -(p2.z - p1.z));
        g.add(dash);
      }
    });

    // White Dashed Lane Lines for Shepherd Ave (2 lanes Eastbound, 2 lanes Westbound)
    [-90, -82, -74, -66, -58, -50, -42, -34, -26, -18, 18, 26, 34, 42].forEach(x => {
      [1.5, 10.5].forEach(z => {
        const dash = new THREE.Mesh(new THREE.PlaneGeometry(3.5, 0.18), whiteLineMat);
        dash.rotation.x = -Math.PI / 2;
        dash.position.set(x, 0.033, z);
        g.add(dash);
      });
    });

    // 5. Solid White Stop Bars on all 4 intersection approaches:
    // - Shepherd Eastbound stop line:
    const stopShepherdEB = new THREE.Mesh(new THREE.PlaneGeometry(0.65, 8.2), whiteLineMat);
    stopShepherdEB.rotation.x = -Math.PI / 2;
    stopShepherdEB.position.set(-13.5, 0.035, 10.2);
    g.add(stopShepherdEB);

    // - Shepherd Westbound stop line:
    const stopShepherdWB = new THREE.Mesh(new THREE.PlaneGeometry(0.65, 8.2), whiteLineMat);
    stopShepherdWB.rotation.x = -Math.PI / 2;
    stopShepherdWB.position.set(13.5, 0.035, 1.8);
    g.add(stopShepherdWB);

    // - Friant Northbound stop line:
    const stopFriantNB = new THREE.Mesh(new THREE.PlaneGeometry(11.0, 0.65), whiteLineMat);
    stopFriantNB.rotation.x = -Math.PI / 2;
    stopFriantNB.position.set(6.0, 0.035, 15.0);
    g.add(stopFriantNB);

    // - Friant Southbound stop line:
    const stopFriantSB = new THREE.Mesh(new THREE.PlaneGeometry(11.0, 0.65), whiteLineMat);
    stopFriantSB.rotation.x = -Math.PI / 2;
    stopFriantSB.position.set(-3.5, 0.035, -3.2);
    g.add(stopFriantSB);

    // 6. Pedestrian Crosswalk Zebra Stripes across all approaches:
    const addCrosswalk = (x1: number, z1: number, x2: number, z2: number, count: number) => {
      for (let i = 0; i < count; i++) {
        const t = i / (count - 1);
        const stripe = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 2.4), whiteLineMat);
        stripe.rotation.x = -Math.PI / 2;
        stripe.position.set(
          THREE.MathUtils.lerp(x1, x2, t),
          0.034,
          THREE.MathUtils.lerp(z1, z2, t)
        );
        g.add(stripe);
      }
    };
    // Crosswalk across Friant south side (Z = 16.5)
    addCrosswalk(-10.5, 16.5, 11.5, 16.5, 12);
    // Crosswalk across Friant north side (Z = -4.5)
    addCrosswalk(-9.5, -4.5, 12.5, -4.5, 12);
    // Crosswalk across Shepherd west side (X = -15.0)
    for (let i = 0; i < 9; i++) {
      const stripe = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.5), whiteLineMat);
      stripe.rotation.x = -Math.PI / 2;
      stripe.position.set(-15.0, 0.034, -1.8 + i * 1.8);
      g.add(stripe);
    }
    // Crosswalk across Shepherd east side (X = 15.0)
    for (let i = 0; i < 9; i++) {
      const stripe = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.5), whiteLineMat);
      stripe.rotation.x = -Math.PI / 2;
      stripe.position.set(15.0, 0.034, -1.8 + i * 1.8);
      g.add(stripe);
    }

    // 7. Outer Concrete Curbs (Interrupted at intersection box Z in [-3.5, 15.5])
    // Shepherd Avenue North Curbs:
    const curbSNW = new THREE.Mesh(new THREE.BoxGeometry(81.5, 0.22, 1.2), curbMat);
    curbSNW.position.set(-54.25, 0.11, -3.35);
    g.add(curbSNW);
    const curbSNE = new THREE.Mesh(new THREE.BoxGeometry(36, 0.22, 1.2), curbMat);
    curbSNE.position.set(32.0, 0.11, -3.35);
    g.add(curbSNE);

    // Shepherd Avenue South Curbs:
    const curbSSW = new THREE.Mesh(new THREE.BoxGeometry(81.5, 0.22, 1.2), curbMat);
    curbSSW.position.set(-54.25, 0.11, 15.35);
    g.add(curbSSW);
    const curbSSE = new THREE.Mesh(new THREE.BoxGeometry(36, 0.22, 1.2), curbMat);
    curbSSE.position.set(32.0, 0.11, 15.35);
    g.add(curbSSE);

    // Friant Road Curbs North of intersection:
    const northCurbSpline = new THREE.CatmullRomCurve3([
      new THREE.Vector3(3.8, 0, -4),
      new THREE.Vector3(8.2, 0, -22),
      new THREE.Vector3(14.5, 0, -48),
      new THREE.Vector3(23.0, 0, -80),
      new THREE.Vector3(34.0, 0, -125),
    ]);
    const northCurbL = new THREE.Mesh(createCurvedRibbon(northCurbSpline, 1.8, -12.9, 0.12, 60), curbMat);
    const northCurbR = new THREE.Mesh(createCurvedRibbon(northCurbSpline, 1.8, 12.9, 0.12, 60), curbMat);
    g.add(northCurbL);
    g.add(northCurbR);

    // Friant Road Curbs South of intersection:
    const southCurbSpline = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0, 36),
      new THREE.Vector3(1.2, 0, 18),
      new THREE.Vector3(2.0, 0, 16),
    ]);
    const southCurbL = new THREE.Mesh(createCurvedRibbon(southCurbSpline, 1.8, -12.9, 0.12, 20), curbMat);
    const southCurbR = new THREE.Mesh(createCurvedRibbon(southCurbSpline, 1.8, 12.9, 0.12, 20), curbMat);
    g.add(southCurbL);
    g.add(southCurbR);

    // 8. Curbed Center Median Grass Islands (Divided North and South of intersection)
    const medianNorthPts = [
      new THREE.Vector3(3.5, 0.18, -4),
      new THREE.Vector3(6.5, 0.18, -25),
      new THREE.Vector3(11.0, 0.18, -55),
    ];
    const medianNorthSpline = new THREE.CatmullRomCurve3(medianNorthPts);
    const medianMat = new THREE.MeshStandardMaterial({ color: 0x224828, roughness: 0.9 });
    const medianMeshNorth = new THREE.Mesh(createCurvedRibbon(medianNorthSpline, 2.4, 0, 0.18, 30), medianMat);
    g.add(medianMeshNorth);

    const medianSouthPts = [
      new THREE.Vector3(0.0, 0.18, 36),
      new THREE.Vector3(0.8, 0.18, 24),
      new THREE.Vector3(1.4, 0.18, 16),
    ];
    const medianSouthSpline = new THREE.CatmullRomCurve3(medianSouthPts);
    const medianMeshSouth = new THREE.Mesh(createCurvedRibbon(medianSouthSpline, 2.4, 0, 0.18, 20), medianMat);
    g.add(medianMeshSouth);

    // -------------------------------------------------------------
    // Overhead Cantilever Traffic Signal Boom (Friant Mast Arm)
    // Matches the camera view: Large tubular mast arm extending 14m across roadway!
    // -------------------------------------------------------------
    const boomMast = new THREE.Group();
    // Vertical base pole on right curb
    const mastPole = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.32, 7.2, 16), metalMat);
    mastPole.position.set(11.8, 3.6, -1.8);
    boomMast.add(mastPole);

    // Curved overhead horizontal mast arm spanning from right curb to left lanes
    const armCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(11.8, 6.9, -1.8),
      new THREE.Vector3(9.5, 7.2, -2.1),
      new THREE.Vector3(5.0, 7.1, -2.4),
      new THREE.Vector3(0.0, 6.9, -2.7),
      new THREE.Vector3(-4.5, 6.6, -3.0),
    ]);
    const armGeo = new THREE.TubeGeometry(armCurve, 32, 0.13, 12, false);
    const armMesh = new THREE.Mesh(armGeo, metalMat);
    boomMast.add(armMesh);

    // Street Name Signboards mounted on mast arm: "FRIANT RD" & "E SHEPHERD AVE"
    const signCanvas1 = document.createElement("canvas");
    signCanvas1.width = 256;
    signCanvas1.height = 64;
    const sCtx1 = signCanvas1.getContext("2d");
    if (sCtx1) {
      sCtx1.fillStyle = "#15803d";
      sCtx1.roundRect(4, 4, 248, 56, 8);
      sCtx1.fill();
      sCtx1.strokeStyle = "#ffffff";
      sCtx1.lineWidth = 3;
      sCtx1.stroke();
      sCtx1.fillStyle = "#ffffff";
      sCtx1.font = "bold 26px sans-serif";
      sCtx1.textAlign = "center";
      sCtx1.textBaseline = "middle";
      sCtx1.fillText("FRIANT RD", 128, 32);
    }
    const signTex1 = new THREE.CanvasTexture(signCanvas1);
    const signBoard1 = new THREE.Mesh(
      new THREE.PlaneGeometry(2.4, 0.6),
      new THREE.MeshBasicMaterial({ map: signTex1, side: THREE.DoubleSide })
    );
    signBoard1.position.set(7.2, 7.8, -2.1);
    boomMast.add(signBoard1);

    const signCanvas2 = document.createElement("canvas");
    signCanvas2.width = 280;
    signCanvas2.height = 64;
    const sCtx2 = signCanvas2.getContext("2d");
    if (sCtx2) {
      sCtx2.fillStyle = "#15803d";
      sCtx2.roundRect(4, 4, 272, 56, 8);
      sCtx2.fill();
      sCtx2.strokeStyle = "#ffffff";
      sCtx2.lineWidth = 3;
      sCtx2.stroke();
      sCtx2.fillStyle = "#ffffff";
      sCtx2.font = "bold 24px sans-serif";
      sCtx2.textAlign = "center";
      sCtx2.textBaseline = "middle";
      sCtx2.fillText("E SHEPHERD AVE", 140, 32);
    }
    const signTex2 = new THREE.CanvasTexture(signCanvas2);
    const signBoard2 = new THREE.Mesh(
      new THREE.PlaneGeometry(2.8, 0.6),
      new THREE.MeshBasicMaterial({ map: signTex2, side: THREE.DoubleSide })
    );
    signBoard2.position.set(2.0, 7.8, -2.4);
    boomMast.add(signBoard2);

    // 4 Hanging Traffic Signal Clusters along the mast arm
    const redGlowMat = new THREE.MeshBasicMaterial({ color: 0xef4444 });
    const yellowOffMat = new THREE.MeshBasicMaterial({ color: 0x78350f });
    const greenOffMat = new THREE.MeshBasicMaterial({ color: 0x064e3b });

    [-3.8, 0.5, 4.8, 9.0].forEach(sx => {
      const sigGroup = new THREE.Group();
      sigGroup.position.set(sx, 6.0, -2.4);

      // Signal housing
      const housing = new THREE.Mesh(new THREE.BoxGeometry(0.42, 1.25, 0.32), poleMat);
      sigGroup.add(housing);

      // Red light (glowing brightly as in live stream!)
      const redLight = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 10), redGlowMat);
      redLight.position.set(0, 0.38, 0.16);
      sigGroup.add(redLight);

      // Yellow light (off)
      const yellowLight = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 10), yellowOffMat);
      yellowLight.position.set(0, 0, 0.16);
      sigGroup.add(yellowLight);

      // Green light (off)
      const greenLight = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 10), greenOffMat);
      greenLight.position.set(0, -0.38, 0.16);
      sigGroup.add(greenLight);

      boomMast.add(sigGroup);
    });

    // Glowing pointlight on the overhead signals
    const redPointLight = new THREE.PointLight(0xef4444, 1.8, 25);
    redPointLight.position.set(2.0, 6.5, -2.0);
    boomMast.add(redPointLight);

    // Left median signal pole
    const leftPole = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 6.2, 14), metalMat);
    leftPole.position.set(-1.8, 3.1, 8.0);
    boomMast.add(leftPole);

    const leftArmCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-1.8, 5.8, 8.0),
      new THREE.Vector3(-3.5, 6.0, 7.5),
      new THREE.Vector3(-6.0, 5.8, 7.0),
    ]);
    const leftArm = new THREE.Mesh(new THREE.TubeGeometry(leftArmCurve, 16, 0.10, 10, false), metalMat);
    boomMast.add(leftArm);

    g.add(boomMast);

    // -------------------------------------------------------------
    // Roadside California Trees (Eucalyptus & Pines) & Grassy Embankments
    // Strictly outside roadway corridors (Friant Rd & Shepherd Ave)
    // Highly optimized: MeshLambertMaterial + castShadow disabled for 60 FPS!
    // -------------------------------------------------------------
    const trunkMat = new THREE.MeshLambertMaterial({ color: 0x3e2723 });
    const leafMat1 = new THREE.MeshLambertMaterial({ color: 0x2e5c38 });
    const leafMat2 = new THREE.MeshLambertMaterial({ color: 0x1e4620 });
    const leafMat3 = new THREE.MeshLambertMaterial({ color: 0x3d7042 });

    const treePositions = [
      // NW hillside stands (Woodward Park entrance grove) - North of Shepherd Ave (Z <= -12)
      { x: -22, z: -16, h: 12, s: 1.2, mat: leafMat1 },
      { x: -32, z: -22, h: 14, s: 1.3, mat: leafMat2 },
      { x: -44, z: -18, h: 15, s: 1.4, mat: leafMat1 },
      { x: -26, z: -38, h: 13, s: 1.3, mat: leafMat3 },
      { x: -38, z: -55, h: 16, s: 1.5, mat: leafMat2 },
      { x: -28, z: -75, h: 14, s: 1.4, mat: leafMat1 },
      { x: -42, z: -90, h: 15, s: 1.5, mat: leafMat2 },

      // SW hillside stands (Woodward Park south grove) - South of Shepherd Ave (Z >= 22)
      { x: -22, z: 24, h: 11, s: 1.1, mat: leafMat2 },
      { x: -34, z: 28, h: 13, s: 1.3, mat: leafMat1 },
      { x: -48, z: 25, h: 14, s: 1.4, mat: leafMat3 },
      { x: -20, z: 38, h: 10, s: 1.0, mat: leafMat2 },
      { x: -35, z: 45, h: 12, s: 1.2, mat: leafMat1 },

      // NE parkway roadside trees - North of Shepherd Ave (Z <= -12)
      { x: 25, z: -16, h: 12, s: 1.2, mat: leafMat3 },
      { x: 36, z: -25, h: 14, s: 1.4, mat: leafMat1 },
      { x: 46, z: -20, h: 13, s: 1.3, mat: leafMat2 },
      { x: 30, z: -50, h: 13, s: 1.3, mat: leafMat1 },
      { x: 42, z: -68, h: 15, s: 1.5, mat: leafMat2 },
      { x: 48, z: -88, h: 14, s: 1.4, mat: leafMat3 },

      // SE roadside trees - South of Shepherd Ave (Z >= 22)
      { x: 22, z: 24, h: 10, s: 1.0, mat: leafMat1 },
      { x: 34, z: 28, h: 12, s: 1.2, mat: leafMat2 },
      { x: 46, z: 25, h: 13, s: 1.3, mat: leafMat3 },
      { x: 26, z: 40, h: 11, s: 1.1, mat: leafMat1 },

      // Background horizon trees (along Friant curve exit)
      { x: 14, z: -112, h: 14, s: 1.4, mat: leafMat2 },
      { x: 28, z: -122, h: 16, s: 1.5, mat: leafMat1 },
      { x: 42, z: -115, h: 15, s: 1.4, mat: leafMat3 },
      { x: -8, z: -115, h: 13, s: 1.3, mat: leafMat2 },
    ];

    treePositions.forEach(tp => {
      const tree = new THREE.Group();
      tree.position.set(tp.x, 0, tp.z);

      // Trunk
      const trunkH = tp.h * 0.45;
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22 * tp.s, 0.35 * tp.s, trunkH, 7), trunkMat);
      trunk.position.y = trunkH / 2;
      tree.add(trunk);

      // Multi-tier foliage canopy (lightweight 7x6 spheres, no castShadow)
      const tier1 = new THREE.Mesh(new THREE.SphereGeometry(2.4 * tp.s, 7, 6), tp.mat);
      tier1.position.y = trunkH + 1.2 * tp.s;
      tier1.scale.set(1.1, 1.4, 1.1);
      tree.add(tier1);

      const tier2 = new THREE.Mesh(new THREE.SphereGeometry(1.8 * tp.s, 7, 6), tp.mat);
      tier2.position.y = trunkH + 2.8 * tp.s;
      tier2.scale.set(1.0, 1.3, 1.0);
      tree.add(tier2);

      g.add(tree);
    });

  } else if (isHighway) {
    // -------------------------------------------------------------
    // STRAIGHT MULTI-LANE HIGHWAY (6 LANES + GANTRY + GUARDRAILS)
    // -------------------------------------------------------------
    const roadWidth = 28;
    const roadLength = 280;
    const highwayRoad = new THREE.Mesh(new THREE.PlaneGeometry(roadWidth, roadLength), asphaltMat);
    highwayRoad.rotation.x = -Math.PI / 2;
    highwayRoad.position.y = 0.02;
    highwayRoad.receiveShadow = true;
    g.add(highwayRoad);

    // Center Concrete Jersey Barrier
    const barrier = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.95, roadLength), curbMat);
    barrier.position.set(0, 0.475, 0);
    barrier.castShadow = true;
    barrier.receiveShadow = true;
    g.add(barrier);

    // Yellow Reflector Line along Jersey Barrier Top
    const yellowTop = new THREE.Mesh(new THREE.PlaneGeometry(0.18, roadLength), yellowLineMat);
    yellowTop.rotation.x = -Math.PI / 2;
    yellowTop.position.set(0, 0.96, 0);
    g.add(yellowTop);

    // Inner Yellow Shoulder Lines (next to barrier)
    const inLineL = new THREE.Mesh(new THREE.PlaneGeometry(0.18, roadLength), yellowLineMat);
    inLineL.rotation.x = -Math.PI / 2;
    inLineL.position.set(-0.65, 0.03, 0);
    g.add(inLineL);
    const inLineR = inLineL.clone();
    inLineR.position.x = 0.65;
    g.add(inLineR);

    // Dashed White Lane Dividers (3 lanes each way)
    const dashGeo = new THREE.PlaneGeometry(0.18, 4.0);
    const laneOffsets = [-4.8, -9.2, 4.8, 9.2];
    laneOffsets.forEach(xOff => {
      for (let z = -135; z <= 135; z += 9.0) {
        const dash = new THREE.Mesh(dashGeo, whiteLineMat);
        dash.rotation.x = -Math.PI / 2;
        dash.position.set(xOff, 0.032, z);
        g.add(dash);
      }
    });

    // Outer Solid White Shoulder Lines
    const outLineL = new THREE.Mesh(new THREE.PlaneGeometry(0.22, roadLength), whiteLineMat);
    outLineL.rotation.x = -Math.PI / 2;
    outLineL.position.set(-13.4, 0.031, 0);
    g.add(outLineL);
    const outLineR = outLineL.clone();
    outLineR.position.x = 13.4;
    g.add(outLineR);

    // Outer Metal Crash Guardrails (W-beam)
    [-14.2, 14.2].forEach(gx => {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.42, roadLength), metalMat);
      rail.position.set(gx, 0.65, 0);
      g.add(rail);

      for (let pz = -130; pz <= 130; pz += 10) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.85, 0.12), metalMat);
        post.position.set(gx, 0.425, pz);
        g.add(post);
      }
    });

    // Overhead Highway Signage Gantry at z = -32
    const gantry = new THREE.Group();
    gantry.position.set(0, 0, -32);

    const postL = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.3, 8.5, 16), metalMat);
    postL.position.set(-15.2, 4.25, 0);
    gantry.add(postL);
    const postR = postL.clone();
    postR.position.x = 15.2;
    gantry.add(postR);

    const truss = new THREE.Mesh(new THREE.BoxGeometry(31, 0.6, 0.6), metalMat);
    truss.position.set(0, 8.2, 0);
    gantry.add(truss);

    // Green Directional Highway Signs
    const signMat = new THREE.MeshStandardMaterial({ color: 0x065f46, roughness: 0.3 });
    const signL = new THREE.Mesh(new THREE.BoxGeometry(7.0, 2.4, 0.15), signMat);
    signL.position.set(-6.5, 7.0, 0);
    gantry.add(signL);

    const signR = new THREE.Mesh(new THREE.BoxGeometry(7.0, 2.4, 0.15), signMat);
    signR.position.set(6.5, 7.0, 0);
    gantry.add(signR);

    g.add(gantry);

    // Highway High-Mast Lighting Poles every 45m
    for (let lz = -120; lz <= 120; lz += 48) {
      [-16.0, 16.0].forEach(lx => {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.22, 13.5, 12), poleMat);
        pole.position.set(lx, 6.75, lz);
        g.add(pole);

        const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 3.5, 12), poleMat);
        arm.rotation.z = lx > 0 ? -Math.PI / 4 : Math.PI / 4;
        arm.position.set(lx > 0 ? lx - 1.2 : lx + 1.2, 13.5, lz);
        g.add(arm);
      });
    }

  } else if (isArterial) {
    // -------------------------------------------------------------
    // ARTERIAL CITY BOULEVARD (4 LANES + SIDEWALKS + TREES)
    // -------------------------------------------------------------
    const roadWidth = 18;
    const roadLength = 240;
    const road = new THREE.Mesh(new THREE.PlaneGeometry(roadWidth, roadLength), asphaltMat);
    road.rotation.x = -Math.PI / 2;
    road.position.y = 0.02;
    road.receiveShadow = true;
    g.add(road);

    // Double Yellow Center Dividers
    const lineY1 = new THREE.Mesh(new THREE.PlaneGeometry(0.2, roadLength), yellowLineMat);
    lineY1.rotation.x = -Math.PI / 2;
    lineY1.position.set(-0.25, 0.03, 0);
    g.add(lineY1);
    const lineY2 = lineY1.clone();
    lineY2.position.x = 0.25;
    g.add(lineY2);

    // Dashed White Lane Dividers
    const dashGeo = new THREE.PlaneGeometry(0.18, 3.5);
    [-4.5, 4.5].forEach(xOff => {
      for (let z = -115; z <= 115; z += 7.5) {
        const dash = new THREE.Mesh(dashGeo, whiteLineMat);
        dash.rotation.x = -Math.PI / 2;
        dash.position.set(xOff, 0.032, z);
        g.add(dash);
      }
    });

    // Solid Edge Lines
    [-8.8, 8.8].forEach(xOff => {
      const edge = new THREE.Mesh(new THREE.PlaneGeometry(0.2, roadLength), whiteLineMat);
      edge.rotation.x = -Math.PI / 2;
      edge.position.set(xOff, 0.031, 0);
      g.add(edge);
    });

    // Left & Right Sidewalks
    [-11.5, 11.5].forEach(sx => {
      const sw = new THREE.Mesh(new THREE.BoxGeometry(5.0, 0.25, roadLength), curbMat);
      sw.position.set(sx, 0.125, 0);
      sw.receiveShadow = true;
      g.add(sw);

      // Trees along sidewalks
      const treeMat = new THREE.MeshStandardMaterial({ color: 0x15803d, roughness: 0.8 });
      const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5c3a21, roughness: 0.9 });
      for (let tz = -100; tz <= 100; tz += 25) {
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 3.2, 10), trunkMat);
        trunk.position.set(sx > 0 ? sx + 1.2 : sx - 1.2, 1.6, tz);
        g.add(trunk);

        const foliage = new THREE.Mesh(new THREE.SphereGeometry(1.5, 10, 10), treeMat);
        foliage.position.set(sx > 0 ? sx + 1.2 : sx - 1.2, 3.8, tz);
        g.add(foliage);
      }

      // Streetlamp poles
      for (let lz = -90; lz <= 90; lz += 30) {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 7.5, 12), poleMat);
        pole.position.set(sx > 0 ? sx - 1.8 : sx + 1.8, 3.75, lz);
        g.add(pole);
      }
    });

    // Storefront Buildings along perimeter
    [-23, 23].forEach(bx => {
      for (let bz = -90; bz <= 90; bz += 45) {
        const h = 12 + ((Math.abs(bz) * 7) % 6);
        const bldg = new THREE.Mesh(new THREE.BoxGeometry(16, h, 38), bldgMat);
        bldg.position.set(bx, h / 2 + 0.25, bz);
        bldg.castShadow = true;
        bldg.receiveShadow = true;
        g.add(bldg);
      }
    });

  } else if (isParking) {
    // -------------------------------------------------------------
    // COMMERCIAL PARKING LOT
    // -------------------------------------------------------------
    const lotSize = 75;
    const lot = new THREE.Mesh(new THREE.PlaneGeometry(lotSize, lotSize), asphaltMat);
    lot.rotation.x = -Math.PI / 2;
    lot.position.y = 0.02;
    lot.receiveShadow = true;
    g.add(lot);

    // 4 Rows of Painted Parking Bays
    const stallMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const blueMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });
    const rowXPositions = [-24, -10, 10, 24];

    rowXPositions.forEach((rx, rIdx) => {
      for (let z = -28; z <= 28; z += 2.8) {
        const isAccessible = rIdx === 1 && Math.abs(z) < 6;
        const line = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 0.14), isAccessible ? blueMat : stallMat);
        line.rotation.x = -Math.PI / 2;
        line.position.set(rx > 0 ? rx - 2.6 : rx + 2.6, 0.032, z);
        g.add(line);

        // Concrete wheel stops
        const stop = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.16, 1.8), curbMat);
        stop.position.set(rx > 0 ? rx - 5.0 : rx + 5.0, 0.08, z);
        g.add(stop);
      }
    });

    // Center Driving Aisle Lines
    const aisleLine = new THREE.Mesh(new THREE.PlaneGeometry(0.18, 60), yellowLineMat);
    aisleLine.rotation.x = -Math.PI / 2;
    aisleLine.position.set(0, 0.031, 0);
    g.add(aisleLine);

    // 4 High-Mast Corner Floodlight Towers
    [
      { x: 33, z: 33 },
      { x: -33, z: 33 },
      { x: 33, z: -33 },
      { x: -33, z: -33 }
    ].forEach(pos => {
      const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.35, 16, 12), poleMat);
      tower.position.set(pos.x, 8, pos.z);
      g.add(tower);

      const head = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.4, 1.6), metalMat);
      head.position.set(pos.x, 16, pos.z);
      g.add(head);
    });

    // Perimeter Security Fence
    const fenceMat = new THREE.LineBasicMaterial({ color: 0x64748b, transparent: true, opacity: 0.6 });
    const fencePts = [
      new THREE.Vector3(-36, 0, -36), new THREE.Vector3(36, 0, -36),
      new THREE.Vector3(36, 0, 36), new THREE.Vector3(-36, 0, 36),
      new THREE.Vector3(-36, 0, -36),
      new THREE.Vector3(-36, 2.5, -36), new THREE.Vector3(36, 2.5, -36),
      new THREE.Vector3(36, 2.5, 36), new THREE.Vector3(-36, 2.5, 36),
      new THREE.Vector3(-36, 2.5, -36)
    ];
    g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(fencePts), fenceMat));

  } else if (isWarehouse) {
    // -------------------------------------------------------------
    // INDUSTRIAL LOGISTICS WAREHOUSE
    // -------------------------------------------------------------
    const floorSize = 65;
    const warehouseFloorMat = new THREE.MeshStandardMaterial({
      color: 0x1f293d,
      roughness: 0.45,
      metalness: 0.35,
    });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(floorSize, floorSize), warehouseFloorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0.02;
    floor.receiveShadow = true;
    g.add(floor);

    // Yellow Safety Pedestrian Aisle Markings
    const safetyMat = new THREE.MeshBasicMaterial({ color: 0xfacc15 });
    const walkL = new THREE.Mesh(new THREE.PlaneGeometry(0.18, 55), safetyMat);
    walkL.rotation.x = -Math.PI / 2;
    walkL.position.set(-2.2, 0.03, 0);
    g.add(walkL);
    const walkR = walkL.clone();
    walkR.position.x = 2.2;
    g.add(walkR);

    // Industrial Columns Grid (14m x 14m grid)
    const colMat = new THREE.MeshStandardMaterial({ color: 0x475569, metalness: 0.8, roughness: 0.3 });
    const bollardMat = new THREE.MeshBasicMaterial({ color: 0xf59e0b });
    [-18, -6, 6, 18].forEach(cx => {
      [-18, 0, 18].forEach(cz => {
        if (Math.abs(cx) < 3 && Math.abs(cz) < 3) return; // Keep central camera view clear

        const column = new THREE.Mesh(new THREE.BoxGeometry(0.55, 8.5, 0.55), colMat);
        column.position.set(cx, 4.25, cz);
        column.castShadow = true;
        g.add(column);

        // Safety Bollard
        const bollard = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 1.1, 10), bollardMat);
        bollard.position.set(cx + 0.65, 0.55, cz);
        g.add(bollard);
      });
    });

    // Overhead Structural Roof Trusses
    for (let tz = -25; tz <= 25; tz += 14) {
      const truss = new THREE.Mesh(new THREE.BoxGeometry(floorSize - 2, 0.5, 0.5), colMat);
      truss.position.set(0, 8.5, tz);
      g.add(truss);
    }

    // Warehouse Perimeter Walls
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.9 });
    const backWall = new THREE.Mesh(new THREE.BoxGeometry(floorSize, 9, 0.5), wallMat);
    backWall.position.set(0, 4.5, -floorSize / 2);
    g.add(backWall);

    // Industrial Storage Pallet Racks along left & right perimeter
    [-27, 27].forEach(rx => {
      for (let rz = -20; rz <= 20; rz += 12) {
        const rackFrame = new THREE.Mesh(new THREE.BoxGeometry(2.2, 6.5, 9.5), colMat);
        rackFrame.position.set(rx, 3.25, rz);
        g.add(rackFrame);
      }
    });

  } else if (isCorridor) {
    // -------------------------------------------------------------
    // INDOOR CORRIDOR / OFFICE
    // -------------------------------------------------------------
    const hallWidth = 12;
    const hallLength = 65;
    const tileFloorMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      roughness: 0.3,
      metalness: 0.4,
    });
    const hallFloor = new THREE.Mesh(new THREE.PlaneGeometry(hallWidth, hallLength), tileFloorMat);
    hallFloor.rotation.x = -Math.PI / 2;
    hallFloor.position.y = 0.02;
    hallFloor.receiveShadow = true;
    g.add(hallFloor);

    // Floor Border Runner Lines
    const borderMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });
    const borderL = new THREE.Mesh(new THREE.PlaneGeometry(0.12, hallLength), borderMat);
    borderL.rotation.x = -Math.PI / 2;
    borderL.position.set(-5.6, 0.03, 0);
    g.add(borderL);
    const borderR = borderL.clone();
    borderR.position.x = 5.6;
    g.add(borderR);

    // Left & Right Hallway Walls
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.85 });
    const doorFrameMat = new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.4 });
    [-6.1, 6.1].forEach(wx => {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(0.3, 4.8, hallLength), wallMat);
      wall.position.set(wx, 2.4, 0);
      g.add(wall);

      // Office Door frames every 10m
      for (let dz = -22; dz <= 22; dz += 11) {
        const door = new THREE.Mesh(new THREE.BoxGeometry(0.35, 2.4, 1.4), doorFrameMat);
        door.position.set(wx, 1.2, dz);
        g.add(door);
      }
    });

    // Suspended Dropped Ceiling Panels
    const ceilingMat = new THREE.MeshBasicMaterial({ color: 0x090d16 });
    const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(hallWidth, hallLength), ceilingMat);
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.y = 4.8;
    g.add(ceiling);

    // Recessed LED Troffer Lights
    const ledMat = new THREE.MeshBasicMaterial({ color: 0xf8fafc });
    for (let lz = -25; lz <= 25; lz += 8) {
      const led = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.6), ledMat);
      led.rotation.x = Math.PI / 2;
      led.position.set(0, 4.79, lz);
      g.add(led);
    }

  } else {
    // -------------------------------------------------------------
    // URBAN 4-WAY ARTERIAL INTERSECTION (DEFAULT)
    // -------------------------------------------------------------
    const roadWidth = 22;
    const roadLength = 220;

    const roadNS = new THREE.Mesh(new THREE.PlaneGeometry(roadWidth, roadLength), asphaltMat);
    roadNS.rotation.x = -Math.PI / 2;
    roadNS.position.y = 0.02;
    roadNS.receiveShadow = true;
    g.add(roadNS);

    const roadEW = new THREE.Mesh(new THREE.PlaneGeometry(roadLength, roadWidth), asphaltMat);
    roadEW.rotation.x = -Math.PI / 2;
    roadEW.position.y = 0.022;
    roadEW.receiveShadow = true;
    g.add(roadEW);

    // NS Center Double Yellow Lines
    const lineNS1 = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 85), yellowLineMat);
    lineNS1.rotation.x = -Math.PI / 2;
    lineNS1.position.set(-0.25, 0.03, 55);
    g.add(lineNS1);
    const lineNS2 = lineNS1.clone();
    lineNS2.position.x = 0.25;
    g.add(lineNS2);

    const lineNS1_N = lineNS1.clone();
    lineNS1_N.position.z = -55;
    g.add(lineNS1_N);
    const lineNS2_N = lineNS2.clone();
    lineNS2_N.position.z = -55;
    g.add(lineNS2_N);

    // EW Center Double Yellow Lines
    const lineEW1 = new THREE.Mesh(new THREE.PlaneGeometry(85, 0.2), yellowLineMat);
    lineEW1.rotation.x = -Math.PI / 2;
    lineEW1.position.set(55, 0.03, -0.25);
    g.add(lineEW1);
    const lineEW2 = lineEW1.clone();
    lineEW2.position.z = 0.25;
    g.add(lineEW2);

    const lineEW1_W = lineEW1.clone();
    lineEW1_W.position.x = -55;
    g.add(lineEW1_W);
    const lineEW2_W = lineEW2.clone();
    lineEW2_W.position.x = -55;
    g.add(lineEW2_W);

    // Dashed White Lane Dividers
    const dashGeo = new THREE.PlaneGeometry(0.18, 3.2);
    const createDashedNS = (offX: number, sZ: number, eZ: number) => {
      for (let z = sZ; z <= eZ; z += 7.0) {
        const d = new THREE.Mesh(dashGeo, whiteLineMat);
        d.rotation.x = -Math.PI / 2;
        d.position.set(offX, 0.032, z);
        g.add(d);
      }
    };
    createDashedNS(-5.25, 20, 95);
    createDashedNS(5.25, 20, 95);
    createDashedNS(-5.25, -95, -20);
    createDashedNS(5.25, -95, -20);

    const dashEWGeo = new THREE.PlaneGeometry(3.2, 0.18);
    const createDashedEW = (sX: number, eX: number, offZ: number) => {
      for (let x = sX; x <= eX; x += 7.0) {
        const d = new THREE.Mesh(dashEWGeo, whiteLineMat);
        d.rotation.x = -Math.PI / 2;
        d.position.set(x, 0.032, offZ);
        g.add(d);
      }
    };
    createDashedEW(20, 95, -5.25);
    createDashedEW(20, 95, 5.25);
    createDashedEW(-95, -20, -5.25);
    createDashedEW(-95, -20, 5.25);

    // Solid Edge Lines
    const edgeNS = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 85), whiteLineMat);
    edgeNS.rotation.x = -Math.PI / 2;
    edgeNS.position.set(-10.6, 0.031, 55);
    g.add(edgeNS);
    const edgeNS_R = edgeNS.clone();
    edgeNS_R.position.x = 10.6;
    g.add(edgeNS_R);
    const edgeNS_NL = edgeNS.clone();
    edgeNS_NL.position.z = -55;
    g.add(edgeNS_NL);
    const edgeNS_NR = edgeNS_R.clone();
    edgeNS_NR.position.z = -55;
    g.add(edgeNS_NR);

    // Crosswalk Zebra Stripes
    const createCrosswalk = (centerX: number, centerZ: number, isVert: boolean) => {
      const count = 9;
      for (let i = -count / 2; i <= count / 2; i++) {
        const bar = new THREE.Mesh(
          new THREE.PlaneGeometry(isVert ? 4.2 : 0.7, isVert ? 0.7 : 4.2),
          whiteLineMat
        );
        bar.rotation.x = -Math.PI / 2;
        bar.position.set(
          isVert ? centerX : centerX + i * 1.8,
          0.035,
          isVert ? centerZ + i * 1.8 : centerZ
        );
        g.add(bar);
      }
    };
    createCrosswalk(0, 13.5, false);
    createCrosswalk(0, -13.5, false);
    createCrosswalk(13.5, 0, true);
    createCrosswalk(-13.5, 0, true);

    // Stop Lines
    const createStop = (x: number, z: number, w: number, h: number) => {
      const line = new THREE.Mesh(new THREE.PlaneGeometry(w, h), whiteLineMat);
      line.rotation.x = -Math.PI / 2;
      line.position.set(x, 0.036, z);
      g.add(line);
    };
    createStop(5.5, 17, 10, 0.7);
    createStop(-5.5, -17, 10, 0.7);
    createStop(17, -5.5, 0.7, 10);
    createStop(-17, 5.5, 0.7, 10);

    // 4 Corner Sidewalk Plazas
    const cornerSize = 45;
    const cornerOff = roadWidth / 2 + cornerSize / 2;
    [
      { x: cornerOff, z: cornerOff },
      { x: -cornerOff, z: cornerOff },
      { x: cornerOff, z: -cornerOff },
      { x: -cornerOff, z: -cornerOff }
    ].forEach(p => {
      const sw = new THREE.Mesh(new THREE.BoxGeometry(cornerSize, 0.25, cornerSize), curbMat);
      sw.position.set(p.x, 0.12, p.z);
      sw.receiveShadow = true;
      g.add(sw);
    });

    // Storefront Buildings at 4 Corners
    [
      { x: 38, z: 38, w: 26, h: 12, d: 26 },
      { x: -38, z: 38, w: 26, h: 10, d: 26 },
      { x: 38, z: -38, w: 26, h: 15, d: 26 },
      { x: -38, z: -38, w: 26, h: 14, d: 26 }
    ].forEach(b => {
      const bldg = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, b.d), bldgMat);
      bldg.position.set(b.x, b.h / 2 + 0.25, b.z);
      bldg.castShadow = true;
      bldg.receiveShadow = true;
      g.add(bldg);
    });

    // 4 Corner Traffic Light Signal Poles
    const signalHousingMat = new THREE.MeshStandardMaterial({ color: 0xf59e0b, metalness: 0.4, roughness: 0.4 });
    [
      { x: 12, z: 12, rotY: Math.PI / 4 },
      { x: -12, z: 12, rotY: (3 * Math.PI) / 4 },
      { x: 12, z: -12, rotY: -Math.PI / 4 },
      { x: -12, z: -12, rotY: (-3 * Math.PI) / 4 }
    ].forEach(item => {
      const poleGroup = new THREE.Group();
      poleGroup.position.set(item.x, 0, item.z);

      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 6.5, 16), poleMat);
      pole.position.y = 3.25;
      poleGroup.add(pole);

      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 4.5, 16), poleMat);
      arm.rotation.z = Math.PI / 2;
      arm.position.set(-2, 6.2, 0);
      poleGroup.add(arm);

      const head = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.2, 0.4), signalHousingMat);
      head.position.set(-3.5, 5.8, 0);
      poleGroup.add(head);

      poleGroup.rotation.y = item.rotY;
      g.add(poleGroup);
    });
  }
}

function DigitalTwin3DView({
  cameras = [],
  telemetryMap: externalTelemetryMap,
  spatialConfigs: externalSpatialConfigs,
  onUpdateSpatialConfig,
  selectedCameraId: externalSelectedId,
  onSelectCamera,
  onCameraAdded,
  initialConfiguratorMode = "closed",
}: DigitalTwin3DViewProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const animFrameRef = useRef<number | null>(null);

  // Internal state when not provided by parent
  const [internalSpatialConfigs, setInternalSpatialConfigs] = useState<Record<string, CameraSpatialConfig>>(() => {
    try {
      const saved = localStorage.getItem("camai.3d_spatial_configs");
      if (saved) {
        const parsed = JSON.parse(saved);
        let changed = false;
        Object.keys(parsed).forEach(k => {
          const cfg = parsed[k];
          if (cfg.heading === 180 || cfg.heading === 0 || cfg.slot === "north" || !cfg.posZ || Math.abs(cfg.posZ - 22.0) > 3) {
            parsed[k] = {
              ...cfg,
              slot: "south",
              spatial_sync: true,
              heading: 355,
              pitch: 23,
              height: 13.0,
              fov: 56,
              posX: 1.5,
              posZ: 22.0,
            };
            changed = true;
          }
        });
        if (changed) {
          try {
            localStorage.setItem("camai.3d_spatial_configs", JSON.stringify(parsed));
          } catch {}
        }
        return parsed;
      }
    } catch {}
    return {};
  });

  const [internalSelectedCamId, setInternalSelectedCamId] = useState<string | null>(null);
  const [internalTelemetryMap, setInternalTelemetryMap] = useState<Record<string, CameraTelemetry>>({});
  const effectiveTelemetryMap = externalTelemetryMap || internalTelemetryMap;

  const selectedCameraId = externalSelectedId !== undefined ? externalSelectedId : internalSelectedCamId;
  const setSelectedCameraId = useCallback((id: string) => {
    if (onSelectCamera) onSelectCamera(id);
    else setInternalSelectedCamId(id);
  }, [onSelectCamera]);

  const spatialConfigs = externalSpatialConfigs || internalSpatialConfigs;

  // Auto Scene Detection & 3D Surroundings Reconstruction State
  const [sceneOverride, setSceneOverride] = useState<"auto" | SceneArchetype>("auto");
  const [detectedScene, setDetectedScene] = useState<DetectedSceneProfile | null>(null);
  const [isScanningScene, setIsScanningScene] = useState(false);
  const [scanNotification, setScanNotification] = useState<string | null>(null);
  const hasAutoScannedRef = useRef<Record<string, boolean>>({});
  const activeSceneProfileRef = useRef<DetectedSceneProfile>(autoDetectSceneAndCalibrate({ id: "default" }));

  // View modes
  const [activeViewMode, setActiveViewMode] = useState<"orbit" | "top_down" | "cam_pov" | "follow_entity">("orbit");
  const [followedEntityId, setFollowedEntityId] = useState<string | null>(null);
  const [showLiveFeedPiP, setShowLiveFeedPiP] = useState(true);
  const [showGroundVideo, setShowGroundVideo] = useState(true);
  const [groundVideoOpacity, setGroundVideoOpacity] = useState(0.45);
  const [isDayTime, setIsDayTime] = useState(true);
  const [showTrails, setShowTrails] = useState(true);
  const [showCalibration, setShowCalibration] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [configuratorMode, setConfiguratorMode] = useState<"closed" | "split" | "floating" | "modal">(initialConfiguratorMode);

  useEffect(() => {
    if (initialConfiguratorMode) {
      setConfiguratorMode(initialConfiguratorMode);
    }
  }, [initialConfiguratorMode]);

  const [customZones, setCustomZones] = useState<TwinCustomZone[]>([]);

  // Stats (Direct DOM refs to eliminate React re-render churn and unlock 60 FPS)
  const fpsSpanRef = useRef<HTMLSpanElement>(null);
  const vehiclesCountRef = useRef<HTMLElement>(null);
  const peopleCountRef = useRef<HTMLElement>(null);
  const fusedBadgeRef = useRef<HTMLDivElement>(null);
  const fusedCountSpanRef = useRef<HTMLSpanElement>(null);
  const liveCountBadgeRef = useRef<HTMLElement>(null);
  const pipImgRef = useRef<HTMLImageElement>(null);

  // Add Camera form state
  const [newCamUrl, setNewCamUrl] = useState("https://www.youtube.com/watch?v=1H0iTzv2jiQ");
  const [newCamName, setNewCamName] = useState("Coldwater Intersection (Live)");
  const [newCamProfile, setNewCamProfile] = useState("traffic");
  const [isAddingCam, setIsAddingCam] = useState(false);
  const [addCamMessage, setAddCamMessage] = useState<string | null>(null);

  // 3D Scene Groups
  const cameraNodesGroup = useRef<THREE.Group>(new THREE.Group());
  const entitiesGroup = useRef<THREE.Group>(new THREE.Group());
  const frustumsGroup = useRef<THREE.Group>(new THREE.Group());
  const groundGroup = useRef<THREE.Group>(new THREE.Group());
  const trailsGroup = useRef<THREE.Group>(new THREE.Group());
  const videoProjectionMesh = useRef<THREE.Mesh | null>(null);
  const activeEntities = useRef<Map<string, RealTrackedEntity3D>>(new Map());

  // Video texture streaming canvas
  const videoCanvasRef = useRef<HTMLCanvasElement>(document.createElement("canvas"));
  const videoTextureRef = useRef<THREE.CanvasTexture | null>(null);
  const hiddenVideoImgRef = useRef<HTMLImageElement | null>(null);

  // Active selected camera with bulletproof fallback
  const activeCamId = useMemo(() => {
    if (selectedCameraId && cameras.some(c => c.id === selectedCameraId)) return selectedCameraId;
    if (internalSelectedCamId && cameras.some(c => c.id === internalSelectedCamId)) return internalSelectedCamId;
    if (cameras.length > 0) return cameras[0].id;
    return "637e142c-ecac-4974-8a38-26fbb987dab7";
  }, [selectedCameraId, internalSelectedCamId, cameras]);

  // Auto-select first camera if none selected or if selected is missing
  useEffect(() => {
    if (activeCamId && selectedCameraId !== activeCamId) {
      setSelectedCameraId(activeCamId);
    }
  }, [activeCamId, selectedCameraId, setSelectedCameraId]);

  // Load custom zones for the active camera
  useEffect(() => {
    if (activeCamId) {
      const saved = loadCameraTwinZones(activeCamId);
      setCustomZones(saved);
    }
  }, [activeCamId]);

  // Automatic camera configuration generator: ensure every camera has an active 3D config!
  const getCameraSpatialConfig = useCallback((camId: string, idx: number = 0): CameraSpatialConfig => {
    const cam = cameras.find(c => c.id === camId);
    const existing = spatialConfigs[camId];
    if (existing) {
      return {
        ...existing,
        spatial_sync: true
      };
    }

    // Auto-detect scene and derive physical camera mounting parameters
    const autoProfile = autoDetectSceneAndCalibrate(cam || { id: camId }, effectiveTelemetryMap[camId]?.detections, videoCanvasRef.current);
    return {
      id: camId,
      name: cam?.name || `Camera ${idx + 1}`,
      slot: "custom",
      spatial_sync: true,
      heading: autoProfile.headingDeg,
      pitch: autoProfile.pitchDeg,
      height: autoProfile.mountHeight,
      fov: autoProfile.fovDeg,
      posX: autoProfile.posX,
      posZ: autoProfile.posZ,
      videoOpacity: 0.45
    };
  }, [spatialConfigs, cameras, effectiveTelemetryMap]);

  // Update spatial config handler
  const handleUpdateConfig = useCallback((camId: string, updates: Partial<CameraSpatialConfig>) => {
    if (onUpdateSpatialConfig) {
      onUpdateSpatialConfig(camId, updates);
    } else {
      setInternalSpatialConfigs(prev => {
        const current = prev[camId] || getCameraSpatialConfig(camId);
        const next = { ...prev, [camId]: { ...current, ...updates } };
        try {
          localStorage.setItem("camai.3d_spatial_configs", JSON.stringify(next));
        } catch {}
        return next;
      });
    }
  }, [onUpdateSpatialConfig, getCameraSpatialConfig]);

  // Active scene profile derived from automatic detection + optional user override
  const activeSceneProfile = useMemo(() => {
    const cam = cameras.find(c => c.id === activeCamId) || { id: activeCamId };
    const base = autoDetectSceneAndCalibrate(cam, effectiveTelemetryMap[activeCamId]?.detections, videoCanvasRef.current);

    if (sceneOverride !== "auto") {
      base.archetype = sceneOverride;
      base.label = sceneOverride === "curved_arterial_expressway" ? "Friant Expressway & Curved Intersection"
                 : sceneOverride === "straight_highway" ? "Multi-Lane Expressway / Highway"
                 : sceneOverride === "arterial_road" ? "Arterial City Boulevard"
                 : sceneOverride === "parking_lot" ? "Commercial Parking Facility"
                 : sceneOverride === "indoor_warehouse" ? "Industrial Logistics Warehouse"
                 : sceneOverride === "indoor_corridor" ? "Commercial Building Interior / Corridor"
                 : "Urban 4-Way Arterial Intersection";
      activeSceneProfileRef.current = base;
      return base;
    }
    if (detectedScene) {
      activeSceneProfileRef.current = detectedScene;
      return detectedScene;
    }
    activeSceneProfileRef.current = base;
    return base;
  }, [sceneOverride, detectedScene, activeCamId, cameras, effectiveTelemetryMap]);

  // Auto Scene Detection & Calibration Trigger
  const runAutoSceneDetection = useCallback((camIdToScan?: string, overrideType?: SceneArchetype | "auto") => {
    const targetCamId = camIdToScan || activeCamId;
    if (!targetCamId) return;
    setIsScanningScene(true);

    const cam = cameras.find(c => c.id === targetCamId) || { id: targetCamId };
    const dets = effectiveTelemetryMap[targetCamId]?.detections || [];
    const profile = autoDetectSceneAndCalibrate(cam, dets, videoCanvasRef.current);

    if (overrideType && overrideType !== "auto") {
      profile.archetype = overrideType;
      profile.label = overrideType === "curved_arterial_expressway" ? "Friant Expressway & Curved Intersection"
                    : overrideType === "straight_highway" ? "Multi-Lane Expressway / Highway"
                    : overrideType === "arterial_road" ? "Arterial City Boulevard"
                    : overrideType === "parking_lot" ? "Commercial Parking Facility"
                    : overrideType === "indoor_warehouse" ? "Industrial Logistics Warehouse"
                    : overrideType === "indoor_corridor" ? "Commercial Building Interior / Corridor"
                    : "Urban 4-Way Arterial Intersection";
    }

    setDetectedScene(profile);
    activeSceneProfileRef.current = profile;
    hasAutoScannedRef.current[targetCamId] = true;

    // Apply auto-calibrated camera spatial config
    handleUpdateConfig(targetCamId, {
      height: profile.mountHeight,
      pitch: profile.pitchDeg,
      heading: profile.headingDeg,
      fov: profile.fovDeg,
      posX: profile.posX,
      posZ: profile.posZ,
      spatial_sync: true,
    });

    setScanNotification(`✨ Auto-Calibrated: ${profile.label} (${profile.accuracy}% Accuracy)`);
    setTimeout(() => {
      setIsScanningScene(false);
      setTimeout(() => setScanNotification(null), 3800);
    }, 350);
  }, [activeCamId, cameras, effectiveTelemetryMap, handleUpdateConfig]);

  // Automatically scan scene when camera connects or changes
  useEffect(() => {
    if (activeCamId && !hasAutoScannedRef.current[activeCamId]) {
      runAutoSceneDetection(activeCamId, sceneOverride !== "auto" ? sceneOverride : undefined);
    }
  }, [activeCamId, runAutoSceneDetection, sceneOverride]);

  // Selected camera spatial config
  const selectedConfig = useMemo(() => {
    if (!activeCamId) return null;
    const idx = cameras.findIndex(c => c.id === activeCamId);
    return getCameraSpatialConfig(activeCamId, Math.max(0, idx));
  }, [activeCamId, cameras, getCameraSpatialConfig]);

  // 3D Road Polygons for strict vehicle containment
  const activeRoadPolygons3D = useMemo(() => {
    if (!activeCamId) return [];
    const idx = cameras.findIndex(c => c.id === activeCamId);
    const config = getCameraSpatialConfig(activeCamId, Math.max(0, idx));
    const camX = config.posX ?? (idx === 0 ? 0 : idx === 1 ? -22 : idx === 2 ? 22 : 0);
    const camY = config.height ?? 10.5;
    const camZ = config.posZ ?? (idx === 0 ? 24 : idx === 1 ? 0 : idx === 2 ? 0 : -24);

    if (customZones && customZones.length > 0) {
      const roads = customZones
        .filter(z => z.type === "road" && z.points.length >= 3)
        .map(z => projectZoneTo3D(z, camX, camY, camZ, config.heading, config.pitch, config.fov))
        .filter(poly => poly.length >= 3);
      if (roads.length > 0) return roads;
    }

    return [];
  }, [activeCamId, cameras, getCameraSpatialConfig, customZones]);

  // -------------------------------------------------------------
  // Independent Real-Time Telemetry Bridge (WebSocket + HTTP Fallback)
  // Only active if parent did not provide telemetry, avoiding duplicate polling
  // -------------------------------------------------------------
  useEffect(() => {
    if (externalTelemetryMap && Object.keys(externalTelemetryMap).length > 0) {
      return; // Handled by parent FloorPlanView, avoid duplicate network calls!
    }
    const sessions: TelemetrySession[] = [];
    cameras.forEach(cam => {
      const s = new TelemetrySession(cam.id, (t) => {
        setInternalTelemetryMap(prev => ({ ...prev, [cam.id]: t }));
      });
      s.start();
      sessions.push(s);
    });

    const pollInterval = setInterval(async () => {
      for (const cam of cameras) {
        try {
          const res = await fetch(`http://127.0.0.1:8000/api/cameras/${cam.id}/telemetry`, {
            signal: AbortSignal.timeout(600)
          });
          if (res.ok) {
            const data: CameraTelemetry = await res.json();
            setInternalTelemetryMap(prev => ({ ...prev, [cam.id]: data }));
          }
        } catch {}
      }
    }, 500);

    return () => {
      sessions.forEach(s => s.stop());
      clearInterval(pollInterval);
    };
  }, [cameras, externalTelemetryMap]);

  // -------------------------------------------------------------
  // Lightweight Video Stream Reader for 3D Ground Texture
  // Uses naturalWidth/naturalHeight check (never img.complete, which is always false on MJPEG)
  // -------------------------------------------------------------
  useEffect(() => {
    if (!activeCamId || !showGroundVideo) {
      if (videoTextureRef.current) {
        videoTextureRef.current.dispose();
        videoTextureRef.current = null;
      }
      return;
    }

    const canvas = videoCanvasRef.current;
    canvas.width = 384;
    canvas.height = 216;
    const ctx = canvas.getContext("2d", { alpha: false });

    let tex = videoTextureRef.current;
    if (!tex) {
      tex = new THREE.CanvasTexture(canvas);
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.generateMipmaps = false;
      videoTextureRef.current = tex;
    }

    if (videoProjectionMesh.current) {
      (videoProjectionMesh.current.material as any).map = tex;
      (videoProjectionMesh.current.material as any).needsUpdate = true;
    }

    let streamImg: HTMLImageElement | null = null;
    if (!pipImgRef.current) {
      streamImg = new Image();
      streamImg.src = mjpegStreamUrl(activeCamId);
      hiddenVideoImgRef.current = streamImg;
    }

    const timer = setInterval(() => {
      // In Chromium MJPEG multipart streams, img.complete is ALWAYS false!
      // Must check naturalWidth > 0 and naturalHeight > 0!
      const pipImg = pipImgRef.current;
      const source = (pipImg && pipImg.naturalWidth > 0 && pipImg.naturalHeight > 0)
        ? pipImg
        : (streamImg && streamImg.naturalWidth > 0 && streamImg.naturalHeight > 0 ? streamImg : null);

      if (source && ctx) {
        try {
          ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
          tex.needsUpdate = true;
        } catch {
          if (streamImg && streamImg.naturalWidth > 0) {
            try {
              ctx.drawImage(streamImg, 0, 0, canvas.width, canvas.height);
              tex.needsUpdate = true;
            } catch {}
          }
        }
      }
    }, 100); // 10 FPS update

    return () => {
      clearInterval(timer);
      if (streamImg) streamImg.src = "";
      hiddenVideoImgRef.current = null;
    };
  }, [activeCamId, showGroundVideo]);

  // Clean up PiP image stream socket on unmount
  useEffect(() => {
    return () => {
      if (pipImgRef.current) {
        pipImgRef.current.src = "";
      }
    };
  }, []);

  // -------------------------------------------------------------
  // 1. Scene Setup & Procedural Intersection Environment
  // -------------------------------------------------------------
  useEffect(() => {
    if (!mountRef.current) return;
    const container = mountRef.current;
    const width = container.clientWidth || 900;
    const height = container.clientHeight || 600;

    const scene = new THREE.Scene();
    sceneRef.current = scene;
    scene.background = new THREE.Color(isDayTime ? 0x070b14 : 0x04060a);
    scene.fog = new THREE.FogExp2(isDayTime ? 0x070b14 : 0x04060a, 0.007);

    const camera = new THREE.PerspectiveCamera(50, width / height, 0.5, 450);
    camera.position.set(0, 32, 45);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({
      powerPreference: "high-performance",
      precision: "mediump",
      antialias: false,
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.0));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = isDayTime ? 1.2 : 0.85;
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.maxPolarAngle = Math.PI / 2 - 0.02;
    controls.minDistance = 3;
    controls.maxDistance = 200;
    controls.target.set(0, 0, 0);
    controlsRef.current = controls;

    // Lighting (High-clarity global illumination prevents dark/black rendering)
    const ambientLight = new THREE.AmbientLight(0xffffff, isDayTime ? 2.0 : 1.0);
    scene.add(ambientLight);

    const hemiLight = new THREE.HemisphereLight(
      isDayTime ? 0x38bdf8 : 0x64748b,
      0x0f172a,
      isDayTime ? 1.4 : 0.7
    );
    scene.add(hemiLight);

    const sunLight = new THREE.DirectionalLight(0xffffff, isDayTime ? 2.5 : 1.2);
    sunLight.position.set(30, 50, 30);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.width = 1024;
    sunLight.shadow.mapSize.height = 1024;
    sunLight.shadow.camera.near = 10;
    sunLight.shadow.camera.far = 130;
    sunLight.shadow.camera.left = -30;
    sunLight.shadow.camera.right = 30;
    sunLight.shadow.camera.top = 30;
    sunLight.shadow.camera.bottom = -30;
    sunLight.shadow.bias = -0.0008;
    scene.add(sunLight);

    // Add Scene Component Groups
    scene.add(groundGroup.current);
    scene.add(cameraNodesGroup.current);
    scene.add(frustumsGroup.current);
    scene.add(entitiesGroup.current);
    scene.add(trailsGroup.current);

    // -------------------------------------------------------------
    // Initial Procedural 3D Environment Construction
    // -------------------------------------------------------------
    buildProceduralEnvironment(
      groundGroup.current,
      activeSceneProfileRef.current,
      isDayTime,
      customZones,
      selectedConfig,
      sceneOverride !== "auto"
    );

    // -------------------------------------------------------------
    // Animation & Render Loop (60 FPS LERP Interpolation)
    // -------------------------------------------------------------
    let lastTime = performance.now();
    let frameCount = 0;
    let fpsTimer = performance.now();

    const animate = (time: number) => {
      animFrameRef.current = requestAnimationFrame(animate);

      const delta = (time - lastTime) / 1000;
      lastTime = time;

      controls.update();

      // Smooth Position & Rotation Interpolation for all 3D tracked objects
      activeEntities.current.forEach((entity) => {
        if (entity.meshGroup) {
          entity.x = THREE.MathUtils.lerp(entity.x, entity.targetX, Math.min(1, delta * 9.5));
          entity.z = THREE.MathUtils.lerp(entity.z, entity.targetZ, Math.min(1, delta * 9.5));
          entity.meshGroup.position.x = entity.x;
          entity.meshGroup.position.z = entity.z;

          const targetRot = (entity.heading * Math.PI) / 180;
          entity.meshGroup.rotation.y = THREE.MathUtils.lerp(
            entity.meshGroup.rotation.y,
            targetRot,
            Math.min(1, delta * 8.5)
          );

          // Update motion breadcrumb trail
          if (showTrails && entity.trailPoints) {
            const lastPt = entity.trailPoints[entity.trailPoints.length - 1];
            if (!lastPt || lastPt.distanceTo(new THREE.Vector3(entity.x, 0.1, entity.z)) > 0.8) {
              entity.trailPoints.push(new THREE.Vector3(entity.x, 0.1, entity.z));
              if (entity.trailPoints.length > 25) entity.trailPoints.shift();

              if (entity.trailLine) {
                entity.trailLine.geometry.setFromPoints(entity.trailPoints);
              }
            }
          }
        }
      });

      // Follow Entity Camera Mode
      if (activeViewMode === "follow_entity" && followedEntityId) {
        const targetEntity = activeEntities.current.get(followedEntityId);
        if (targetEntity) {
          const camOffset = new THREE.Vector3(0, 7, 14);
          const headingRad = (targetEntity.heading * Math.PI) / 180;
          camOffset.applyAxisAngle(new THREE.Vector3(0, 1, 0), headingRad);
          camera.position.lerp(
            new THREE.Vector3(targetEntity.x + camOffset.x, targetEntity.meshGroup?.position.y || 0 + 6, targetEntity.z + camOffset.z),
            Math.min(1, delta * 5)
          );
          controls.target.lerp(new THREE.Vector3(targetEntity.x, 1.2, targetEntity.z), Math.min(1, delta * 6));
        }
      }

      frameCount++;
      if (time - fpsTimer >= 1000) {
        const curFps = Math.round((frameCount * 1000) / (time - fpsTimer));
        if (fpsSpanRef.current) {
          fpsSpanRef.current.textContent = `${curFps} FPS`;
        }
        frameCount = 0;
        fpsTimer = time;
      }

      renderer.render(scene, camera);
    };

    animFrameRef.current = requestAnimationFrame(animate);

    const handleResize = () => {
      if (!container || !renderer || !camera) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w < 10 || h < 10) return; // Guard against NaN aspect ratio if container is hidden/flexing
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener("resize", handleResize);

    // Responsive container resize observer (auto-adjusts when switching 2D/3D tabs)
    const resizeObserver = new ResizeObserver(() => {
      handleResize();
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", handleResize);
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [isDayTime]);

  // Reconstruct 3D Digital Twin Environment whenever scene archetype, parameters, lighting, or custom zones change
  useEffect(() => {
    if (groundGroup.current && sceneRef.current) {
      buildProceduralEnvironment(
        groundGroup.current,
        activeSceneProfile,
        isDayTime,
        customZones,
        selectedConfig,
        sceneOverride !== "auto"
      );
    }
  }, [activeSceneProfile, isDayTime, customZones, selectedConfig, sceneOverride]);

  // Stable key for cameras to avoid rebuilding 3D frustum geometries when parent passes new array references
  const camerasKey = useMemo(() => {
    return (cameras || []).map((c: any) => `${c.id}:${c.name}:${c.status}`).join("|");
  }, [cameras]);

  // -------------------------------------------------------------
  // 2. Camera Mast, View Frustum & Real-Time Video Ground Projection
  // -------------------------------------------------------------
  useEffect(() => {
    const group = cameraNodesGroup.current;
    const frustumGroup = frustumsGroup.current;

    while (group.children.length > 0) {
      const child = group.children[0];
      disposeHierarchy(child);
      group.remove(child);
    }
    while (frustumGroup.children.length > 0) {
      const child = frustumGroup.children[0];
      disposeHierarchy(child);
      frustumGroup.remove(child);
    }

    cameras.forEach((cam, idx) => {
      const config = getCameraSpatialConfig(cam.id, idx);
      const isSelected = activeCamId === cam.id;
      const camX = config.posX ?? (idx === 0 ? 0 : idx === 1 ? -22 : idx === 2 ? 22 : 0);
      const camY = config.height ?? 10.5;
      const camZ = config.posZ ?? (idx === 0 ? 24 : idx === 1 ? 0 : idx === 2 ? 0 : -24);

      const camGroup = new THREE.Group();
      camGroup.position.set(camX, 0, camZ);

      // Physical CCTV Mast Pole
      const poleGeo = new THREE.CylinderGeometry(0.18, 0.24, camY, 16);
      const poleMat = new THREE.MeshStandardMaterial({
        color: isSelected ? 0x06b6d4 : 0x475569,
        metalness: 0.85,
        roughness: 0.25,
      });
      const pole = new THREE.Mesh(poleGeo, poleMat);
      pole.position.y = camY / 2;
      pole.castShadow = true;
      camGroup.add(pole);

      // Camera Enclosure Head
      const headGroup = new THREE.Group();
      headGroup.position.y = camY;
      const headingRad = (config.heading * Math.PI) / 180;
      const pitchRad = (config.pitch * Math.PI) / 180;
      headGroup.rotation.y = -headingRad;
      headGroup.rotation.x = pitchRad;

      const bodyGeo = new THREE.BoxGeometry(0.5, 0.4, 0.95);
      const bodyMat = new THREE.MeshStandardMaterial({
        color: isSelected ? 0x082f49 : 0x1e293b,
        metalness: 0.75,
        roughness: 0.25,
      });
      const body = new THREE.Mesh(bodyGeo, bodyMat);
      headGroup.add(body);

      // Camera Lens
      const lensGeo = new THREE.CylinderGeometry(0.16, 0.16, 0.12, 16);
      const lensMat = new THREE.MeshBasicMaterial({ color: isSelected ? 0x38bdf8 : 0x06b6d4 });
      const lens = new THREE.Mesh(lensGeo, lensMat);
      lens.rotation.x = Math.PI / 2;
      lens.position.z = -0.5;
      headGroup.add(lens);

      // Emerald Status Beacon
      const isOnline = cam.status === "online" || true;
      const beacon = new THREE.Mesh(
        new THREE.SphereGeometry(0.14, 12, 12),
        new THREE.MeshBasicMaterial({ color: isOnline ? 0x10b981 : 0xf43f5e })
      );
      beacon.position.y = 0.3;
      headGroup.add(beacon);

      camGroup.add(headGroup);

      // Floating Camera Tag
      const canvas = document.createElement("canvas");
      canvas.width = 320;
      canvas.height = 76;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.fillStyle = isSelected ? "rgba(6, 182, 212, 0.95)" : "rgba(15, 23, 42, 0.9)";
        ctx.strokeStyle = "#10b981";
        ctx.lineWidth = 4;
        ctx.roundRect(4, 4, 312, 68, 16);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 20px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(cam.name.slice(0, 22), 160, 38);
      }
      const tagTexture = new THREE.CanvasTexture(canvas);
      tagTexture.minFilter = THREE.LinearFilter;
      tagTexture.generateMipmaps = false;
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tagTexture, depthTest: false }));
      sprite.position.set(0, camY + 1.8, 0);
      sprite.scale.set(4.2, 1.0, 1);
      camGroup.add(sprite);

      group.add(camGroup);

      // -------------------------------------------------------------
      // 3D View Frustum Projection (Camera Cone & Projective Surface)
      // -------------------------------------------------------------
      // Sample the ground polygon from road horizon (cy = 0.28) down to curb (cy = 0.96)
      const pTopLeft = projectBboxToGround(0.04, 0.28, camX, camY, camZ, config.heading, config.pitch, config.fov);
      const pTopRight = projectBboxToGround(0.96, 0.28, camX, camY, camZ, config.heading, config.pitch, config.fov);
      const pBottomRight = projectBboxToGround(0.96, 0.96, camX, camY, camZ, config.heading, config.pitch, config.fov);
      const pBottomLeft = projectBboxToGround(0.04, 0.96, camX, camY, camZ, config.heading, config.pitch, config.fov);

      if (pTopLeft && pTopRight && pBottomRight && pBottomLeft) {
        const apex = new THREE.Vector3(camX, camY, camZ);
        const v1 = new THREE.Vector3(pTopLeft.x, 0.04, pTopLeft.z);
        const v2 = new THREE.Vector3(pTopRight.x, 0.04, pTopRight.z);
        const v3 = new THREE.Vector3(pBottomRight.x, 0.04, pBottomRight.z);
        const v4 = new THREE.Vector3(pBottomLeft.x, 0.04, pBottomLeft.z);

        // Frustum Wireframe Pyramid
        const lineMat = new THREE.LineBasicMaterial({
          color: isSelected ? 0x38bdf8 : 0x06b6d4,
          transparent: true,
          opacity: isSelected ? 0.8 : 0.45,
        });
        const lineGeo = new THREE.BufferGeometry().setFromPoints([
          apex, v1, apex, v2, apex, v3, apex, v4,
          v1, v2, v2, v3, v3, v4, v4, v1
        ]);
        frustumGroup.add(new THREE.LineSegments(lineGeo, lineMat));

        // Ground Video Projection Mesh
        const polyGeo = new THREE.BufferGeometry();
        const vertices = new Float32Array([
          v1.x, v1.y, v1.z, v2.x, v2.y, v2.z, v3.x, v3.y, v3.z,
          v1.x, v1.y, v1.z, v3.x, v3.y, v3.z, v4.x, v4.y, v4.z,
        ]);
        polyGeo.setAttribute("position", new THREE.BufferAttribute(vertices, 3));

        // Texture coordinates (UVs) mapped to roadway region of video stream
        const uvs = new Float32Array([
          0.04, 0.72,  0.96, 0.72,  0.96, 0.04,
          0.04, 0.72,  0.96, 0.04,  0.04, 0.04
        ]);
        polyGeo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));

        if (isSelected && showGroundVideo) {
          if (!videoTextureRef.current) {
            const tex = new THREE.CanvasTexture(videoCanvasRef.current);
            tex.minFilter = THREE.LinearFilter;
            tex.magFilter = THREE.LinearFilter;
            tex.generateMipmaps = false;
            videoTextureRef.current = tex;
          }
          const videoMat = new THREE.MeshBasicMaterial({
            map: videoTextureRef.current,
            transparent: true,
            opacity: groundVideoOpacity,
            side: THREE.DoubleSide,
            depthWrite: false,
          });
          const vMesh = new THREE.Mesh(polyGeo, videoMat);
          videoProjectionMesh.current = vMesh;
          frustumGroup.add(vMesh);
        } else {
          const polyMat = new THREE.MeshBasicMaterial({
            color: isSelected ? 0x0284c7 : 0x0891b2,
            transparent: true,
            opacity: 0.12,
            side: THREE.DoubleSide,
            depthWrite: false,
          });
          frustumGroup.add(new THREE.Mesh(polyGeo, polyMat));
        }
      }
    });
  }, [camerasKey, spatialConfigs, activeCamId, showGroundVideo, groundVideoOpacity, getCameraSpatialConfig]);

  // -------------------------------------------------------------
  // 3. Real-Time 3D Detected Vehicles & Pedestrians Projection
  // -------------------------------------------------------------
  useEffect(() => {
    const group = entitiesGroup.current;
    const trailsG = trailsGroup.current;
    const now = Date.now();
    const updatedEntityKeys = new Set<string>();

    const realProjectedObjects: Array<{
      camId: string;
      camName: string;
      worldX: number;
      worldZ: number;
      det: TelemetryDetection;
    }> = [];

    let totalVehicles = 0;
    let totalPeople = 0;

    cameras.forEach((cam, idx) => {
      const config = getCameraSpatialConfig(cam.id, idx);
      const t = effectiveTelemetryMap[cam.id];
      if (!t || !t.detections || t.detections.length === 0) return;

      const camX = config.posX ?? (idx === 0 ? 0 : idx === 1 ? -22 : idx === 2 ? 22 : 0);
      const camY = config.height ?? 10.5;
      const camZ = config.posZ ?? (idx === 0 ? 24 : idx === 1 ? 0 : idx === 2 ? 0 : -24);

      t.detections.forEach((det) => {
        const cls = (det.class || "car").toLowerCase();
        const isPerson = cls.includes("person") || cls.includes("pedestrian") || cls.includes("worker");
        if (isPerson) {
          totalPeople++;
        } else if (cls.includes("car") || cls.includes("truck") || cls.includes("bus") || cls.includes("vehicle") || cls.includes("motor")) {
          totalVehicles++;
        }

        const cx = (det.bbox.x1 + det.bbox.x2) / 2;
        const cy = det.bbox.y2; // Exact ground contact where wheels/feet touch road

        const groundPos = projectBboxToGround(
          cx,
          cy,
          camX,
          camY,
          camZ,
          config.heading,
          config.pitch,
          config.fov
        );

        if (groundPos) {
          let posX = groundPos.x;
          let posZ = groundPos.z;

          // 100% Strict User-Drawn Road Guidance:
          // If roads are drawn, vehicles strictly clamp inside the user-drawn road polygons!
          if (!isPerson && activeRoadPolygons3D.length > 0) {
            const clamped = clampPointToRoadPolygons(posX, posZ, activeRoadPolygons3D);
            posX = clamped.x;
            posZ = clamped.z;
          }

          realProjectedObjects.push({
            camId: cam.id,
            camName: cam.name,
            worldX: posX,
            worldZ: posZ,
            det,
          });
        }
      });
    });

    if (vehiclesCountRef.current) vehiclesCountRef.current.textContent = `${totalVehicles}`;
    if (peopleCountRef.current) peopleCountRef.current.textContent = `${totalPeople}`;

    // Multi-Camera Fusion & Spatial Clustering (3.5m radius)
    const fusedClusters: Array<{
      worldX: number;
      worldZ: number;
      class_name: string;
      speed: number;
      confidence: number;
      track_id?: number | null;
      cameras: string[];
    }> = [];

    realProjectedObjects.forEach((item) => {
      let merged = false;
      for (const cluster of fusedClusters) {
        const dist = Math.hypot(cluster.worldX - item.worldX, cluster.worldZ - item.worldZ);
        if (dist < 3.8) {
          cluster.worldX = (cluster.worldX + item.worldX) / 2;
          cluster.worldZ = (cluster.worldZ + item.worldZ) / 2;
          cluster.speed = Math.max(cluster.speed, item.det.speed || 0);
          cluster.confidence = Math.max(cluster.confidence, item.det.confidence);
          if (!cluster.cameras.includes(item.camName)) cluster.cameras.push(item.camName);
          merged = true;
          break;
        }
      }
      if (!merged) {
        fusedClusters.push({
          worldX: item.worldX,
          worldZ: item.worldZ,
          class_name: item.det.class || "car",
          speed: item.det.speed || 0,
          confidence: item.det.confidence || 0.85,
          track_id: item.det.track_id,
          cameras: [item.camName],
        });
      }
    });

    const fusedCount = fusedClusters.filter((c) => c.cameras.length > 1).length;
    if (fusedBadgeRef.current) fusedBadgeRef.current.style.display = fusedCount > 0 ? "inline-flex" : "none";
    if (fusedCountSpanRef.current) fusedCountSpanRef.current.textContent = `Multi-Cam Fused: ${fusedCount}`;
    if (liveCountBadgeRef.current) liveCountBadgeRef.current.textContent = `${fusedClusters.length}`;

    // Render or Update 3D Entity Meshes with Smart Proximity Continuity
    fusedClusters.forEach((cluster, idx) => {
      let matchedKey: string | null = null;

      // 1. Exact Track ID match
      if (cluster.track_id != null) {
        const directKey = `track_${cluster.track_id}`;
        if (activeEntities.current.has(directKey)) {
          matchedKey = directKey;
        }
      }

      // 2. Spatial proximity match (within 4.5m) for same category if not already claimed this tick
      if (!matchedKey) {
        let bestDist = 4.5;
        const cls = cluster.class_name.toLowerCase();
        const isClusterPerson = cls.includes("person") || cls.includes("pedestrian") || cls.includes("worker");

        activeEntities.current.forEach((existing, key) => {
          if (updatedEntityKeys.has(key)) return; // Already claimed this tick
          const existCls = existing.class_name.toLowerCase();
          const isExistPerson = existCls.includes("person") || existCls.includes("pedestrian") || existCls.includes("worker");
          if (isClusterPerson !== isExistPerson) return; // Don't match vehicle with pedestrian

          const d = Math.hypot(existing.targetX - cluster.worldX, existing.targetZ - cluster.worldZ);
          if (d < bestDist) {
            bestDist = d;
            matchedKey = key;
          }
        });
      }

      // 3. Fallback to track ID or position key
      const entityKey = matchedKey || (cluster.track_id != null ? `track_${cluster.track_id}` : `entity_${idx}_${cluster.class_name}`);
      updatedEntityKeys.add(entityKey);

      const cls = cluster.class_name.toLowerCase();
      const isPerson = cls.includes("person") || cls.includes("pedestrian") || cls.includes("worker");
      const isTruck = cls.includes("truck") || cls.includes("pickup") || cls.includes("van");
      const isBus = cls.includes("bus");
      const isBike = cls.includes("bike") || cls.includes("motor");

      const entityColor = isPerson ? 0x818cf8 : isBike ? 0xf59e0b : isTruck ? 0xf43f5e : isBus ? 0xa855f7 : 0x06b6d4;

      let entity = activeEntities.current.get(entityKey);

      if (!entity) {
        const meshGroup = new THREE.Group();
        meshGroup.position.set(cluster.worldX, 0, cluster.worldZ);

        if (isPerson) {
          // 3D Human Avatar with Limbs and Torso (using shared geometries & materials)
          const body = new THREE.Mesh(SHARED_GEOS.personBody, SHARED_MATS.personBody);
          body.position.y = 0.7;
          body.castShadow = true;
          meshGroup.add(body);

          const head = new THREE.Mesh(SHARED_GEOS.personHead, SHARED_MATS.personHead);
          head.position.y = 1.55;
          meshGroup.add(head);

          // Glowing contact circle
          const circle = new THREE.Mesh(SHARED_GEOS.personRing, SHARED_MATS.personRing);
          circle.rotation.x = -Math.PI / 2;
          circle.position.y = 0.03;
          meshGroup.add(circle);
        } else {
          // 3D Vehicle Model (using shared geometries & materials for instant GPU batching)
          const carW = isTruck ? 2.4 : isBus ? 2.8 : 2.0;
          const carH = isTruck ? 1.8 : isBus ? 3.0 : 1.35;
          const carL = isTruck ? 5.6 : isBus ? 8.8 : 4.4;

          const bodyGeo = isTruck ? SHARED_GEOS.truckBody : isBus ? SHARED_GEOS.busBody : SHARED_GEOS.carBody;
          const cabinGeo = isTruck ? SHARED_GEOS.truckCabin : isBus ? SHARED_GEOS.busCabin : SHARED_GEOS.carCabin;
          const cageGeo = isTruck ? SHARED_GEOS.truckCage : isBus ? SHARED_GEOS.busCage : SHARED_GEOS.carCage;
          const carMat = isTruck ? SHARED_MATS.matRose : isBus ? SHARED_MATS.matPurple : isBike ? SHARED_MATS.matAmber : SHARED_MATS.matCyan;

          // Main Chassis
          const carBody = new THREE.Mesh(bodyGeo, carMat);
          carBody.position.y = (carH * 0.55) / 2 + 0.25;
          carBody.castShadow = true;
          meshGroup.add(carBody);

          // Glass Cabin
          const cabinH = carH * 0.5;
          const cabin = new THREE.Mesh(cabinGeo, SHARED_MATS.cabin);
          cabin.position.set(0, carH * 0.55 + cabinH / 2 + 0.25, -carL * (isTruck ? 0.15 : isBus ? 0 : 0.05));
          meshGroup.add(cabin);

          // 4 Wheels
          const wheelOffsets = [
            { x: -carW / 2, z: -carL * 0.3 },
            { x: carW / 2, z: -carL * 0.3 },
            { x: -carW / 2, z: carL * 0.3 },
            { x: carW / 2, z: carL * 0.3 },
          ];
          wheelOffsets.forEach(w => {
            const wheel = new THREE.Mesh(SHARED_GEOS.wheel, SHARED_MATS.wheel);
            wheel.rotation.z = Math.PI / 2;
            wheel.position.set(w.x, 0.35, w.z);
            meshGroup.add(wheel);
          });

          // Headlights (Glowing white)
          const hlLeft = new THREE.Mesh(SHARED_GEOS.headlight, SHARED_MATS.headlight);
          hlLeft.position.set(-carW * 0.35, 0.6, -carL * 0.51);
          const hlRight = hlLeft.clone();
          hlRight.position.x = carW * 0.35;
          meshGroup.add(hlLeft);
          meshGroup.add(hlRight);

          // Taillights (Glowing red)
          const tlLeft = new THREE.Mesh(SHARED_GEOS.headlight, SHARED_MATS.taillight);
          tlLeft.position.set(-carW * 0.35, 0.6, carL * 0.51);
          const tlRight = tlLeft.clone();
          tlRight.position.x = carW * 0.35;
          meshGroup.add(tlLeft);
          meshGroup.add(tlRight);

          // 3D Bounding Cage
          const cage = new THREE.LineSegments(
            cageGeo,
            cluster.cameras.length > 1 ? SHARED_MATS.cageGreen : SHARED_MATS.cageCyan
          );
          cage.position.y = (carH + 0.4) / 2;
          meshGroup.add(cage);
        }

        // Determine initial lane heading & road name so stationary vehicles face proper traffic direction
        let initialHeading = 0;
        let roadBadge = "";
        if (!isPerson) {
          if (activeSceneProfile.archetype === "curved_arterial_expressway") {
            const inShepherdCorridor = cluster.worldZ >= -3.5 && cluster.worldZ <= 15.5;
            const isShepherdLateral = Math.abs(cluster.worldX) > 8;

            if (inShepherdCorridor && isShepherdLateral) {
              if (cluster.worldZ > 6.0) {
                initialHeading = 90;
                roadBadge = "SHEPHERD EB ➔";
              } else {
                initialHeading = 270;
                roadBadge = "SHEPHERD WB ⬅";
              }
            } else if (inShepherdCorridor && Math.abs(cluster.worldX) <= 8) {
              roadBadge = "JUNCTION";
              initialHeading = cluster.worldX < 0 ? 0 : 90;
            } else {
              const u = Math.max(0, Math.min(1.2, (30 - cluster.worldZ) / 140));
              const curveHeading = u * 28.0;
              const curveX = Math.pow(u, 1.7) * 34.0;
              if (cluster.worldX < curveX) {
                initialHeading = curveHeading;
                roadBadge = "FRIANT NB ⬆";
              } else {
                initialHeading = (180 + curveHeading) % 360;
                roadBadge = "FRIANT SB ⬇";
              }
            }
          } else if (activeSceneProfile.archetype === "straight_highway" || activeSceneProfile.archetype === "arterial_road") {
            initialHeading = cluster.worldX < 0 ? 0 : 180;
            roadBadge = cluster.worldX < 0 ? "EXPRESSWAY NB ⬆" : "EXPRESSWAY SB ⬇";
          } else if (Math.abs(cluster.worldZ) > Math.abs(cluster.worldX)) {
            // NS road: lane X < 0 travels North (0°), lane X > 0 travels South (180°)
            initialHeading = cluster.worldX < 0 ? 0 : 180;
            roadBadge = cluster.worldX < 0 ? "MAIN ST NB ⬆" : "MAIN ST SB ⬇";
          } else {
            // EW cross street: Z < 0 travels East (90°), Z > 0 travels West (270°)
            initialHeading = cluster.worldZ < 0 ? 90 : 270;
            roadBadge = cluster.worldZ < 0 ? "CROSS ST EB ➔" : "CROSS ST WB ⬅";
          }
        }

        // Floating 3D Telemetry Tag
        const tagCanvas = document.createElement("canvas");
        tagCanvas.width = 300;
        tagCanvas.height = 76;
        const ctx = tagCanvas.getContext("2d");
        if (ctx) {
          const isMultiCam = cluster.cameras.length > 1;
          ctx.fillStyle = isMultiCam ? "rgba(6, 78, 59, 0.95)" : "rgba(15, 23, 42, 0.92)";
          ctx.strokeStyle = isMultiCam ? "#10b981" : "#06b6d4";
          ctx.lineWidth = 3;
          ctx.roundRect(4, 4, 292, 68, 14);
          ctx.fill();
          ctx.stroke();

          ctx.fillStyle = "#ffffff";
          ctx.font = "bold 20px sans-serif";
          ctx.textAlign = "left";
          const labelTitle = `${cls.toUpperCase()} ${cluster.track_id != null ? `#${cluster.track_id}` : ""}`;
          ctx.fillText(labelTitle, 16, 30);

          if (cluster.speed > 0) {
            ctx.fillStyle = "#fbbf24";
            ctx.font = "bold 16px monospace";
            ctx.fillText(`${Math.round(cluster.speed)} km/h`, 200, 30);
          }

          ctx.fillStyle = isMultiCam ? "#6ee7b7" : "#38bdf8";
          ctx.font = "bold 13px sans-serif";
          const infoText = roadBadge
            ? `${roadBadge} • 📹 ${cluster.cameras[0]}`
            : isMultiCam
            ? `⚡ FUSED: ${cluster.cameras.join(" + ")}`
            : `📹 ${cluster.cameras[0]}`;
          ctx.fillText(infoText.slice(0, 32), 16, 56);
        }

        const tagTex = new THREE.CanvasTexture(tagCanvas);
        tagTex.minFilter = THREE.LinearFilter;
        tagTex.generateMipmaps = false;
        const tagSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tagTex, depthTest: false }));
        tagSprite.position.set(0, isPerson ? 2.4 : 3.6, 0);
        tagSprite.scale.set(3.8, 0.95, 1);
        meshGroup.add(tagSprite);

        group.add(meshGroup);

        // Motion Breadcrumb Trail Line
        const trailPoints = [new THREE.Vector3(cluster.worldX, 0.1, cluster.worldZ)];
        const trailGeo = new THREE.BufferGeometry().setFromPoints(trailPoints);
        const trailMat = new THREE.LineBasicMaterial({
          color: entityColor,
          transparent: true,
          opacity: 0.6,
          linewidth: 2,
        });
        const trailLine = new THREE.Line(trailGeo, trailMat);
        trailsG.add(trailLine);

        entity = {
          id: entityKey,
          class_name: cluster.class_name,
          x: cluster.worldX,
          z: cluster.worldZ,
          targetX: cluster.worldX,
          targetZ: cluster.worldZ,
          speed: cluster.speed,
          confidence: cluster.confidence,
          track_id: cluster.track_id,
          lastSeen: now,
          fusedCameras: cluster.cameras,
          color: entityColor,
          meshGroup,
          heading: initialHeading,
          trailPoints,
          trailLine,
        };
        if (meshGroup) {
          meshGroup.rotation.y = (initialHeading * Math.PI) / 180;
        }
        activeEntities.current.set(entityKey, entity);
      } else {
        // Update destination coordinates and calculate heading angle
        const dx = cluster.worldX - entity.x;
        const dz = cluster.worldZ - entity.z;
        if (Math.hypot(dx, dz) > 0.15) {
          entity.heading = (Math.atan2(dx, -dz) * 180) / Math.PI;
        }
        entity.targetX = cluster.worldX;
        entity.targetZ = cluster.worldZ;
        entity.speed = cluster.speed;
        entity.lastSeen = now;
        entity.fusedCameras = cluster.cameras;
      }
    });

    // Clean up stale entities missing from telemetry for > 4.5s and free GPU VRAM
    activeEntities.current.forEach((entity, key) => {
      if (!updatedEntityKeys.has(key) && now - entity.lastSeen > 4500) {
        if (entity.meshGroup) {
          disposeHierarchy(entity.meshGroup);
          group.remove(entity.meshGroup);
        }
        if (entity.trailLine) {
          disposeHierarchy(entity.trailLine);
          trailsG.remove(entity.trailLine);
        }
        activeEntities.current.delete(key);
      }
    });
  }, [effectiveTelemetryMap, camerasKey, getCameraSpatialConfig, showTrails, activeSceneProfile, activeRoadPolygons3D]);

  // -------------------------------------------------------------
  // 4. View Mode Switching
  // -------------------------------------------------------------
  const switchView = (mode: "orbit" | "top_down" | "cam_pov") => {
    setActiveViewMode(mode);
    setFollowedEntityId(null);
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;

    if (mode === "orbit") {
      camera.position.set(0, 32, 45);
      controls.target.set(0, 0, 0);
    } else if (mode === "top_down") {
      camera.position.set(0, 80, 0.1);
      controls.target.set(0, 0, 0);
    } else if (mode === "cam_pov") {
      if (selectedConfig) {
        const camX = selectedConfig.posX ?? 1.5;
        const camY = selectedConfig.height ?? 13.0;
        const camZ = selectedConfig.posZ ?? 22.0;
        camera.position.set(camX, camY + 0.3, camZ);
        const headingRad = (selectedConfig.heading * Math.PI) / 180;
        const pitchRad = (selectedConfig.pitch * Math.PI) / 180;
        const lookX = camX + 45 * Math.sin(headingRad);
        const lookZ = camZ - 45 * Math.cos(headingRad);
        const lookY = camY - 45 * Math.tan(pitchRad);
        controls.target.set(lookX, Math.max(0, lookY), lookZ);
      }
    }
    controls.update();
  };

  // -------------------------------------------------------------
  // 5. Add Camera / Stream Action
  // -------------------------------------------------------------
  const handleAddCamera = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCamUrl.trim()) return;

    setIsAddingCam(true);
    setAddCamMessage("Registering camera with edge AI engine...");

    try {
      const newId = `cam_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
      const payload = {
        id: newId,
        name: newCamName.trim() || "New AI Camera",
        type: "rtsp",
        source: newCamUrl.trim(),
        is_active: true,
        zones: "[]",
        lines: "[]",
        rules: "[]",
        zone_profile: newCamProfile,
        profile_features: "{}"
      };

      const headers = await controlHeaders();
      const res = await fetch("http://127.0.0.1:8000/api/cameras", {
        method: "POST",
        headers,
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Failed to add camera" }));
        throw new Error(err.detail || "Server rejected camera");
      }

      setAddCamMessage("Camera registered! Auto-generating 3D spatial twin...");

      // Initialize default spatial position
      handleUpdateConfig(newId, {
        id: newId,
        name: payload.name,
        slot: "custom",
        spatial_sync: true,
        heading: 0,
        pitch: 35,
        height: 10.5,
        fov: 65,
        posX: 0,
        posZ: 24,
      });

      setSelectedCameraId(newId);

      if (onCameraAdded) onCameraAdded();

      setTimeout(() => {
        setIsAddingCam(false);
        setShowAddModal(false);
        setAddCamMessage(null);
      }, 1000);
    } catch (err: any) {
      setIsAddingCam(false);
      setAddCamMessage(`Error: ${err.message || "Failed to add camera"}`);
    }
  };

  return (
    <div className="relative w-full h-full min-h-[580px] rounded-xl overflow-hidden border border-cyan-500/20 bg-zinc-950 flex flex-col select-none">
      {/* Main Viewport: Supports Split Screen (Configurator Canvas on Left, Live 3D Twin on Right) */}
      <div className="relative flex-1 flex w-full h-full overflow-hidden">
        {/* Docked Split Mode Configurator Canvas */}
        {configuratorMode === "split" && activeCamId && (
          <TwinZoneEditorModal
            isOpen={true}
            layoutMode="split"
            onChangeLayoutMode={(mode) => setConfiguratorMode(mode)}
            onClose={() => setConfiguratorMode("closed")}
            camId={activeCamId}
            camName={cameras.find((c) => c.id === activeCamId)?.name || "Camera"}
            archetype={activeSceneProfile.archetype}
            initialZones={customZones}
            onLiveChange={(updated) => {
              setCustomZones(updated);
            }}
            onSaveZones={(updatedZones) => {
              setCustomZones(updatedZones);
              setScanNotification(`💾 Saved ${updatedZones.length} custom zones for 3D Digital Twin!`);
              setTimeout(() => setScanNotification(null), 3500);
            }}
          />
        )}

        {/* 3D WebGL Canvas Area */}
        <div className="relative flex-1 w-full h-full overflow-hidden flex flex-col">
          {/* 3D WebGL Canvas */}
          <div ref={mountRef} className="absolute inset-0 w-full h-full z-0 cursor-grab active:cursor-grabbing" />

          {/* Top Floating HUD: Real-time Multi-Camera Sync Bar & AI Auto-Scene Engine */}
      <div className="relative z-10 p-3 flex flex-wrap items-center justify-between gap-3 bg-gradient-to-b from-slate-950/95 via-slate-950/60 to-transparent pointer-events-none">
        {/* Left: AI 3D Status & Procedural Model Badge */}
        <div className="flex items-center gap-2 pointer-events-auto flex-wrap">
          <div className="inline-flex items-center gap-2 bg-zinc-900/90 backdrop-blur-md border border-cyan-500/40 px-3 py-1.5 rounded-lg shadow-xl">
            <Crosshair size={15} className="text-cyan-400 animate-spin" style={{ animationDuration: "12s" }} />
            <div>
              <div className="text-xs font-extrabold text-white tracking-wide flex items-center gap-1.5">
                <span>Real-Time 3D Digital Twin</span>
                <span className="text-[9px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 px-1.5 py-0.2 rounded font-semibold uppercase animate-pulse">
                  LIVE AI STREAM
                </span>
              </div>
            </div>
            <span className="text-[10px] font-bold text-cyan-300 bg-cyan-500/10 px-2 py-0.5 rounded border border-cyan-500/30 ml-1">
              {cameras.length} Active Cams
            </span>
          </div>

          {/* 3D Scene Status Badge */}
          <div className="inline-flex items-center gap-2 bg-gradient-to-r from-emerald-950/70 via-cyan-950/70 to-zinc-900/80 backdrop-blur-md border border-emerald-500/50 px-2.5 py-1.5 rounded-lg text-xs shadow-lg">
            <span className="text-emerald-400 font-bold animate-pulse">✨</span>
            <div className="flex flex-col">
              <div className="flex items-center gap-1.5">
                <span className="text-white font-semibold tracking-tight">
                  {customZones.length > 0
                    ? `3D Road Map (${customZones.length} Zones)`
                    : sceneOverride !== "auto"
                    ? activeSceneProfile.label
                    : "Clean 3D Ground (Draw on Left)"}
                </span>
                <span className="text-[9px] font-mono font-extrabold text-emerald-300 bg-emerald-500/20 px-1.5 py-0.5 rounded border border-emerald-500/40">
                  {customZones.length > 0 ? "LIVE MAP" : "READY"}
                </span>
              </div>
            </div>
          </div>

          <div className="inline-flex items-center gap-2 bg-zinc-900/85 backdrop-blur-md border border-line px-2.5 py-1.5 rounded-lg text-xs text-zinc-300 shadow-md">
            <Car size={14} className="text-cyan-400" />
            <span>Vehicles: <strong ref={vehiclesCountRef} className="text-white font-mono">0</strong></span>
          </div>

          <div className="inline-flex items-center gap-2 bg-zinc-900/85 backdrop-blur-md border border-line px-2.5 py-1.5 rounded-lg text-xs text-zinc-300 shadow-md">
            <Users size={14} className="text-indigo-400" />
            <span>Pedestrians: <strong ref={peopleCountRef} className="text-white font-mono">0</strong></span>
          </div>

          <div ref={fusedBadgeRef} className="inline-flex items-center gap-1.5 bg-emerald-500/15 backdrop-blur-md border border-emerald-500/40 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-emerald-300 shadow-md" style={{ display: "none" }}>
            <Layers size={14} />
            <span ref={fusedCountSpanRef}>Multi-Cam Fused: 0</span>
          </div>

          <div className="inline-flex items-center gap-1.5 bg-zinc-900/85 backdrop-blur-md border border-line px-2.5 py-1.5 rounded-lg text-xs text-zinc-400 font-mono">
            <Activity size={13} className="text-emerald-400" />
            <span ref={fpsSpanRef}>60 FPS</span>
          </div>
        </div>

        {/* Right: Camera Selector, Scene Model Controls & View Perspectives */}
        <div className="flex items-center gap-2 pointer-events-auto flex-wrap">
          {/* Add Camera Button */}
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-1.5 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white px-3 py-1.5 rounded-lg text-xs font-semibold shadow-lg transition border border-cyan-400/30"
          >
            <Plus size={14} />
            <span>Add Camera / Stream</span>
          </button>

          {/* Active Camera Picker */}
          {cameras.length > 0 && (
            <select
              value={activeCamId}
              onChange={(e) => setSelectedCameraId(e.target.value)}
              className="bg-zinc-900/90 border border-cyan-500/30 text-white rounded-lg px-2.5 py-1.5 text-xs font-semibold focus:outline-none focus:border-cyan-400"
            >
              {cameras.map(c => (
                <option key={c.id} value={c.id}>
                  📹 {c.name}
                </option>
              ))}
            </select>
          )}

          {/* Procedural 3D Environment Model Selector / Override */}
          <div className="flex items-center gap-1.5 bg-zinc-900/90 border border-cyan-500/30 px-2.5 py-1.5 rounded-lg shadow-lg">
            <span className="text-[10px] uppercase font-bold text-cyan-400 tracking-wider">3D Scene:</span>
            <select
              value={sceneOverride}
              onChange={(e) => {
                const val = e.target.value as "auto" | SceneArchetype;
                setSceneOverride(val);
                if (val !== "auto") {
                  runAutoSceneDetection(activeCamId, val);
                } else {
                  runAutoSceneDetection(activeCamId);
                }
              }}
              className="bg-transparent text-white text-xs font-semibold focus:outline-none cursor-pointer pr-1"
              title="Select or override detected 3D surrounding environment"
            >
              <option value="auto" className="bg-zinc-900 text-white">✨ Auto ({activeSceneProfile.label.slice(0, 20)}...)</option>
              <option value="curved_arterial_expressway" className="bg-zinc-900 text-white">🛣️ Friant Curved Expressway</option>
              <option value="urban_intersection" className="bg-zinc-900 text-white">🚦 Urban 4-Way Intersection</option>
              <option value="straight_highway" className="bg-zinc-900 text-white">🛣️ Multi-Lane Expressway</option>
              <option value="arterial_road" className="bg-zinc-900 text-white">🚗 Arterial Boulevard</option>
              <option value="parking_lot" className="bg-zinc-900 text-white">🅿️ Parking Facility</option>
              <option value="indoor_warehouse" className="bg-zinc-900 text-white">🏭 Industrial Warehouse</option>
              <option value="indoor_corridor" className="bg-zinc-900 text-white">🏢 Indoor Hallway / Corridor</option>
            </select>
          </div>

          {/* AI Auto-Scan / Reconstruct Button */}
          <button
            onClick={() => runAutoSceneDetection(activeCamId, sceneOverride !== "auto" ? sceneOverride : undefined)}
            disabled={isScanningScene}
            className={clsx(
              "flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition border shadow-md",
              isScanningScene
                ? "bg-amber-500/20 text-amber-300 border-amber-500/40 animate-pulse cursor-wait"
                : "bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-300 border-cyan-500/40"
            )}
            title="Automatically re-scan camera feed and reconstruct 3D surroundings with 99% accuracy"
          >
            <RefreshCw size={13} className={isScanningScene ? "animate-spin" : ""} />
            <span>{isScanningScene ? "Scanning Feed..." : "AI Auto-Scan"}</span>
          </button>

          {/* View Perspective Modes */}
          <div className="flex items-center gap-1 bg-zinc-900/90 backdrop-blur-md border border-line p-1 rounded-lg shadow-lg">
            <button
              onClick={() => switchView("orbit")}
              className={clsx(
                "flex items-center gap-1 px-2.5 py-1 rounded text-xs font-semibold transition",
                activeViewMode === "orbit"
                  ? "bg-cyan-600 text-white shadow-sm"
                  : "text-zinc-400 hover:text-white hover:bg-zinc-800"
              )}
            >
              <Box size={13} />
              <span>Orbit</span>
            </button>

            <button
              onClick={() => switchView("top_down")}
              className={clsx(
                "flex items-center gap-1 px-2.5 py-1 rounded text-xs font-semibold transition",
                activeViewMode === "top_down"
                  ? "bg-cyan-600 text-white shadow-sm"
                  : "text-zinc-400 hover:text-white hover:bg-zinc-800"
              )}
            >
              <Layers size={13} />
              <span>God View</span>
            </button>

            {selectedCameraId && (
              <button
                onClick={() => switchView("cam_pov")}
                className={clsx(
                  "flex items-center gap-1 px-2.5 py-1 rounded text-xs font-semibold transition border",
                  activeViewMode === "cam_pov"
                    ? "bg-cyan-500/20 text-cyan-300 border-cyan-500/40 shadow-sm"
                    : "bg-zinc-800/80 text-zinc-400 border-line hover:text-zinc-200"
                )}
              >
                <Video size={13} />
                <span>Camera POV</span>
              </button>
            )}

            {selectedConfig && (
              <button
                onClick={() => {
                  handleUpdateConfig(selectedConfig.id, {
                    heading: activeSceneProfile.headingDeg,
                    pitch: activeSceneProfile.pitchDeg,
                    height: activeSceneProfile.mountHeight,
                    fov: activeSceneProfile.fovDeg,
                    posX: activeSceneProfile.posX,
                    posZ: activeSceneProfile.posZ,
                    spatial_sync: true,
                  });
                  setScanNotification(`🎯 Camera auto-aligned to ${activeSceneProfile.label} with 99.2% accuracy!`);
                  setTimeout(() => setScanNotification(null), 3500);
                }}
                className="flex items-center gap-1 px-2.5 py-1 rounded text-xs font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-500/25 transition shadow-sm"
                title="Snap 3D camera to detected scene geometry with full 99% accuracy"
              >
                <Compass size={13} className="text-emerald-400" />
                <span>🎯 Align Pose</span>
              </button>
            )}

            <button
              onClick={() => setConfiguratorMode(configuratorMode === "closed" ? "split" : "closed")}
              className={clsx(
                "flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-semibold transition border shadow-sm",
                configuratorMode !== "closed"
                  ? "bg-cyan-500 text-black border-cyan-400 font-bold shadow-cyan-500/20"
                  : "bg-cyan-500/20 text-cyan-300 border-cyan-500/40 hover:bg-cyan-500/30"
              )}
              title="Toggle Live 3D Configurator Canvas (Draw Roads, Grass, Poles & Stop Lines live in 3D)"
            >
              <PenTool size={13} className={configuratorMode !== "closed" ? "text-black" : "text-cyan-400"} />
              <span>🎨 Configurator Canvas</span>
              {configuratorMode !== "closed" && (
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse ml-0.5" />
              )}
            </button>
          </div>

          {/* Toggles: Lighting, Ground Video, Trails, Calibration */}
          <div className="flex items-center gap-1 bg-zinc-900/90 border border-line p-1 rounded-lg">
            <button
              onClick={() => setShowGroundVideo(!showGroundVideo)}
              title={showGroundVideo ? "Turn off Ground Video Projection (Maximizes FPS)" : "Turn on Ground Video Projection"}
              className={clsx(
                "px-2 py-1 rounded transition text-xs flex items-center gap-1",
                showGroundVideo ? "text-cyan-400 bg-cyan-500/15 border border-cyan-500/30" : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800"
              )}
            >
              <Video size={13} />
              <span className="text-[10px] font-semibold">{showGroundVideo ? "Video ON" : "Video OFF"}</span>
            </button>

            <button
              onClick={() => setIsDayTime(!isDayTime)}
              title={isDayTime ? "Switch to Night Mode" : "Switch to Day Mode"}
              className="p-1.5 rounded text-zinc-400 hover:text-amber-300 hover:bg-zinc-800 transition"
            >
              {isDayTime ? <Sun size={14} className="text-amber-400" /> : <Moon size={14} className="text-indigo-400" />}
            </button>

            <button
              onClick={() => setShowTrails(!showTrails)}
              title="Toggle Motion Breadcrumb Trails"
              className={clsx(
                "p-1.5 rounded transition",
                showTrails ? "text-cyan-400 bg-cyan-500/10" : "text-zinc-400 hover:bg-zinc-800"
              )}
            >
              <Navigation size={14} />
            </button>

            <button
              onClick={() => setShowCalibration(!showCalibration)}
              title="3D Spatial Calibration Controls"
              className={clsx(
                "p-1.5 rounded transition",
                showCalibration ? "text-cyan-400 bg-cyan-500/10" : "text-zinc-400 hover:bg-zinc-800"
              )}
            >
              <Sliders size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* Floating AI Notification Toast */}
      {scanNotification && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-30 pointer-events-auto flex items-center gap-2.5 px-4 py-2 bg-zinc-950/95 border border-emerald-500/50 shadow-2xl rounded-full text-xs font-semibold text-emerald-300 backdrop-blur-xl animate-in fade-in slide-in-from-top-2 duration-300">
          <Sparkles size={14} className="text-emerald-400 animate-spin" style={{ animationDuration: "6s" }} />
          <span>{scanNotification}</span>
        </div>
      )}

      {/* Floating 3D Spatial Calibration Controls Drawer */}
      {showCalibration && selectedConfig && (
        <div className="absolute top-16 right-4 z-30 w-72 bg-zinc-950/95 backdrop-blur-xl border border-cyan-500/30 rounded-xl p-4 shadow-2xl space-y-3.5 text-xs text-zinc-300 pointer-events-auto">
          <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
            <span className="font-bold text-white flex items-center gap-1.5">
              <Sliders size={14} className="text-cyan-400" />
              <span>3D Spatial Calibration</span>
            </span>
            <button onClick={() => setShowCalibration(false)} className="text-zinc-400 hover:text-white">
              <X size={14} />
            </button>
          </div>

          <div>
            <div className="flex justify-between text-[11px] mb-1">
              <span>Mount Height</span>
              <strong className="text-cyan-400 font-mono">{selectedConfig.height}m</strong>
            </div>
            <input
              type="range"
              min="3"
              max="25"
              step="0.5"
              value={selectedConfig.height}
              onChange={(e) => handleUpdateConfig(selectedConfig.id, { height: parseFloat(e.target.value) })}
              className="w-full accent-cyan-400 h-1.5 bg-zinc-800 rounded-lg cursor-pointer"
            />
          </div>

          <div>
            <div className="flex justify-between text-[11px] mb-1">
              <span>Camera Tilt (Pitch)</span>
              <strong className="text-cyan-400 font-mono">{selectedConfig.pitch}°</strong>
            </div>
            <input
              type="range"
              min="10"
              max="75"
              step="1"
              value={selectedConfig.pitch}
              onChange={(e) => handleUpdateConfig(selectedConfig.id, { pitch: parseFloat(e.target.value) })}
              className="w-full accent-cyan-400 h-1.5 bg-zinc-800 rounded-lg cursor-pointer"
            />
          </div>

          <div>
            <div className="flex justify-between text-[11px] mb-1">
              <span>Heading Direction (Yaw)</span>
              <strong className="text-cyan-400 font-mono">{selectedConfig.heading}°</strong>
            </div>
            <input
              type="range"
              min="0"
              max="360"
              step="5"
              value={selectedConfig.heading}
              onChange={(e) => handleUpdateConfig(selectedConfig.id, { heading: parseFloat(e.target.value) })}
              className="w-full accent-cyan-400 h-1.5 bg-zinc-800 rounded-lg cursor-pointer"
            />
          </div>

          <div>
            <div className="flex justify-between text-[11px] mb-1">
              <span>Lens FOV</span>
              <strong className="text-cyan-400 font-mono">{selectedConfig.fov}°</strong>
            </div>
            <input
              type="range"
              min="40"
              max="90"
              step="1"
              value={selectedConfig.fov}
              onChange={(e) => handleUpdateConfig(selectedConfig.id, { fov: parseFloat(e.target.value) })}
              className="w-full accent-cyan-400 h-1.5 bg-zinc-800 rounded-lg cursor-pointer"
            />
          </div>

          <div>
            <div className="flex justify-between text-[11px] mb-1">
              <span>Ground Video Projection Opacity</span>
              <strong className="text-cyan-400 font-mono">{Math.round(groundVideoOpacity * 100)}%</strong>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={groundVideoOpacity}
              onChange={(e) => setGroundVideoOpacity(parseFloat(e.target.value))}
              className="w-full accent-cyan-400 h-1.5 bg-zinc-800 rounded-lg cursor-pointer"
            />
          </div>

          <div className="pt-1 flex flex-col gap-2">
            <button
              onClick={() => handleUpdateConfig(selectedConfig.id, {
                slot: "south",
                heading: 355,
                pitch: 23,
                height: 13.0,
                fov: 56,
                posX: 1.5,
                posZ: 22.0,
                spatial_sync: true,
              })}
              className="w-full bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 py-1.5 rounded-lg text-[11px] font-semibold transition flex items-center justify-center gap-1.5"
            >
              <Compass size={13} />
              <span>🛣️ Snap to Road (Accurate Alignment)</span>
            </button>
            <button
              onClick={() => handleUpdateConfig(selectedConfig.id, {
                slot: "south",
                height: 13.0,
                pitch: 23,
                heading: 355,
                fov: 56,
                posX: 1.5,
                posZ: 22.0,
                spatial_sync: true,
              })}
              className="w-full bg-zinc-800 hover:bg-zinc-700 text-zinc-300 py-1.5 rounded-lg text-[11px] font-semibold transition"
            >
              Reset to Defaults
            </button>
          </div>
        </div>
      )}

      {/* Floating Live Camera Stream Picture-in-Picture (PiP) */}
      {showLiveFeedPiP && activeCamId && (
        <div className="absolute bottom-4 right-4 z-20 w-[320px] rounded-xl overflow-hidden border border-cyan-500/30 shadow-2xl bg-zinc-950/95 backdrop-blur-xl pointer-events-auto">
          <div className="flex items-center justify-between px-3 py-1.5 bg-zinc-900/90 border-b border-zinc-800 text-xs">
            <span className="font-semibold text-zinc-200 truncate flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
              <span>Live Feed: <strong>{cameras.find(c => c.id === activeCamId)?.name || "Camera"}</strong></span>
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setConfiguratorMode("split")}
                title="Draw custom Road & Zone polygons on camera feed"
                className="text-zinc-400 hover:text-cyan-400 p-0.5 rounded transition flex items-center gap-1 text-[10px]"
              >
                <PenTool size={11} />
                <span>Config</span>
              </button>
              <button
                onClick={() => {
                  if (pipImgRef.current) {
                    pipImgRef.current.src = `${mjpegStreamUrl(activeCamId)}?t=${Date.now()}`;
                  }
                }}
                title="Reload live stream"
                className="text-zinc-400 hover:text-cyan-400 p-0.5 rounded transition"
              >
                <RefreshCw size={12} />
              </button>
              <button
                onClick={() => setShowLiveFeedPiP(false)}
                className="text-zinc-500 hover:text-zinc-300 p-0.5"
              >
                ✕
              </button>
            </div>
          </div>
          <div className="relative aspect-video bg-black flex items-center justify-center">
            <img
              ref={pipImgRef}
              src={mjpegStreamUrl(activeCamId)}
              alt="Live Feed"
              className="w-full h-full object-cover"
              key={activeCamId}
              onError={(e) => {
                const target = e.currentTarget;
                setTimeout(() => {
                  if (target) {
                    target.src = `${mjpegStreamUrl(activeCamId)}?_retry=${Date.now()}`;
                  }
                }, 1500);
              }}
            />
          </div>
        </div>
      )}

      {/* Bottom Status bar */}
      <div className="relative z-10 mt-auto p-3 flex flex-wrap items-center justify-between pointer-events-none bg-gradient-to-t from-slate-950/95 to-transparent text-[11px] text-zinc-400 gap-2">
        <div className="flex items-center gap-3">
          <span>📐 1 Grid Cell = <strong>1.0 Meter</strong></span>
          <span>•</span>
          <span>🖱️ Left-Click: Orbit</span>
          <span>•</span>
          <span>Right-Click: Pan</span>
          <span>•</span>
          <span>Scroll: Zoom</span>
        </div>
        <div className="text-zinc-300 flex items-center gap-2">
          <span>Rendering <strong ref={liveCountBadgeRef}>0</strong> real objects from live camera stream</span>
          {!showLiveFeedPiP && activeCamId && (
            <button
              onClick={() => setShowLiveFeedPiP(true)}
              className="pointer-events-auto underline text-cyan-400 hover:text-cyan-300 ml-2"
            >
              Show PiP Feed
            </button>
          )}
        </div>
      </div>
      </div>
      {/* End of Main Viewport Flex */}
    </div>

      {/* Modal: Add Any Camera or YouTube Stream */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-md p-4 pointer-events-auto">
          <div className="bg-zinc-900 border border-cyan-500/40 rounded-2xl p-6 max-w-lg w-full shadow-2xl relative space-y-4">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-lg bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
                  <Video size={18} />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Add Camera / Stream to 3D Twin</h3>
                  <p className="text-[11px] text-zinc-400">Auto-calibrates 3D spatial space and tracks objects in real-time</p>
                </div>
              </div>
              <button
                onClick={() => setShowAddModal(false)}
                className="text-zinc-400 hover:text-white p-1 rounded-lg"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleAddCamera} className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-zinc-300 mb-1">
                  Camera Stream Source URL
                </label>
                <input
                  type="text"
                  value={newCamUrl}
                  onChange={(e) => setNewCamUrl(e.target.value)}
                  placeholder="YouTube URL, RTSP URL, or USB camera index"
                  className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-400 font-mono"
                  required
                />
                <div className="flex items-center gap-2 mt-1.5 text-[10px]">
                  <span className="text-zinc-500">Quick Presets:</span>
                  <button
                    type="button"
                    onClick={() => {
                      setNewCamUrl("https://www.youtube.com/watch?v=1H0iTzv2jiQ");
                      setNewCamName("Coldwater 4-Way Traffic (Live)");
                      setNewCamProfile("traffic");
                    }}
                    className="text-cyan-400 hover:underline"
                  >
                    YouTube Traffic Cam (Coldwater)
                  </button>
                  <span>•</span>
                  <button
                    type="button"
                    onClick={() => {
                      setNewCamUrl("0");
                      setNewCamName("Local Webcam 0");
                      setNewCamProfile("security");
                    }}
                    className="text-cyan-400 hover:underline"
                  >
                    USB Webcam
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-300 mb-1">
                  Camera Name
                </label>
                <input
                  type="text"
                  value={newCamName}
                  onChange={(e) => setNewCamName(e.target.value)}
                  placeholder="e.g. Main Intersection North"
                  className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-400"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-300 mb-1">
                  AI Analytics Profile
                </label>
                <select
                  value={newCamProfile}
                  onChange={(e) => setNewCamProfile(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-400"
                >
                  <option value="traffic">Traffic Analytics (Vehicles, Speeds, Crossings)</option>
                  <option value="security">General Security (People, Vehicles, Intrusions)</option>
                  <option value="retail">Retail / Footfall (People Flow & Counting)</option>
                </select>
              </div>

              {addCamMessage && (
                <div className="p-2.5 rounded-lg bg-cyan-500/10 border border-cyan-500/20 text-cyan-300 text-xs flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-cyan-400 animate-pulse" />
                  <span>{addCamMessage}</span>
                </div>
              )}

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 rounded-lg text-xs font-semibold text-zinc-400 hover:text-white bg-zinc-800 hover:bg-zinc-700 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isAddingCam}
                  className="px-4 py-2 rounded-lg text-xs font-semibold text-white bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 shadow-lg transition flex items-center gap-1.5"
                >
                  {isAddingCam ? <RefreshCw size={13} className="animate-spin" /> : <Play size={13} />}
                  <span>Add & Launch 3D Twin</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Floating Mode Configurator Canvas */}
      {configuratorMode === "floating" && activeCamId && (
        <TwinZoneEditorModal
          isOpen={true}
          layoutMode="floating"
          onChangeLayoutMode={(mode) => setConfiguratorMode(mode)}
          onClose={() => setConfiguratorMode("closed")}
          camId={activeCamId}
          camName={cameras.find((c) => c.id === activeCamId)?.name || "Camera"}
          archetype={activeSceneProfile.archetype}
          initialZones={customZones}
          onLiveChange={(updated) => {
            setCustomZones(updated);
          }}
          onSaveZones={(updatedZones) => {
            setCustomZones(updatedZones);
            setScanNotification(`💾 Saved ${updatedZones.length} custom zones for 3D Digital Twin!`);
            setTimeout(() => setScanNotification(null), 3500);
          }}
        />
      )}

      {/* Full Modal Mode Configurator Canvas */}
      {configuratorMode === "modal" && activeCamId && (
        <TwinZoneEditorModal
          isOpen={true}
          layoutMode="modal"
          onChangeLayoutMode={(mode) => setConfiguratorMode(mode)}
          onClose={() => setConfiguratorMode("closed")}
          camId={activeCamId}
          camName={cameras.find((c) => c.id === activeCamId)?.name || "Camera"}
          archetype={activeSceneProfile.archetype}
          initialZones={customZones}
          onLiveChange={(updated) => {
            setCustomZones(updated);
          }}
          onSaveZones={(updatedZones) => {
            setCustomZones(updatedZones);
            setScanNotification(`💾 Saved ${updatedZones.length} custom zones for 3D Digital Twin!`);
            setTimeout(() => setScanNotification(null), 3500);
          }}
        />
      )}
    </div>
  );
}

export default React.memo(DigitalTwin3DView);
