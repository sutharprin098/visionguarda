export interface ContentRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// The MJPEG <img>/screenshare <video> render with object-contain: the
// element preserves its native aspect ratio inside a container of a
// different shape, leaving letterbox bars. Detection overlays draw at
// normalized (0..1) coordinates relative to the actual video frame, so
// they must map onto this content rect — not the full (possibly
// letterboxed) canvas/container — or boxes/masks/tracks drift away from
// the real video pixels whenever the source and container aspect ratios
// differ (a 16:9 camera in a near-square grid cell, a portrait screen
// share, etc).
export function computeContainRect(
  containerW: number, containerH: number, contentW: number, contentH: number
): ContentRect {
  if (!containerW || !containerH || !contentW || !contentH) {
    return { x: 0, y: 0, width: containerW, height: containerH };
  }
  const containerRatio = containerW / containerH;
  const contentRatio = contentW / contentH;
  let width: number, height: number;
  if (contentRatio > containerRatio) {
    width = containerW;
    height = containerW / contentRatio;
  } else {
    height = containerH;
    width = containerH * contentRatio;
  }
  return { x: (containerW - width) / 2, y: (containerH - height) / 2, width, height };
}

// Ray-casting point-in-polygon test. `point` and `polygon` are both in the
// same normalized (0..1) space zones/lines are stored in — used by the
// zone editor to tell "click landed inside this shape" (move the whole
// polygon) apart from "click landed on empty canvas" or on a vertex handle.
export function isPointInPolygon(point: [number, number], polygon: number[][]): boolean {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const intersect = (yi > y) !== (yj > y) &&
      x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}
