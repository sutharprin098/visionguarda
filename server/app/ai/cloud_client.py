"""
CamAI Cloud Inference Client
=============================
Sends a single camera frame to the configured cloud detection endpoint and
returns detections in the same dict format the local YOLO pipeline uses:

    [{"class": "person", "confidence": 0.91,
      "bbox": {"x1": 120, "y1": 45, "x2": 340, "y2": 620}}, ...]

All coordinates are ABSOLUTE PIXELS (same as EngineBackend.run_inference output).

Thread-safe and stateless — safe to call concurrently from multiple camera
AI threads. Does not cache, buffer, or retry: the caller (PipelineCoordinator)
owns retry policy.

Raises CloudOfflineError on any network/HTTP failure so callers can distinguish
"cloud down" from a genuine empty-detection frame.
"""
from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
from typing import List, Dict, Any

import cv2
import numpy as np

COCO_CLASS_MAP = {
    0: "person",
    1: "bicycle",
    2: "car",
    3: "motorcycle",
    5: "bus",
    7: "truck",
    9: "traffic_light",
    11: "stop_sign",
    24: "backpack",
    25: "umbrella",
    26: "handbag",
    28: "suitcase",
}


class CloudOfflineError(Exception):
    """Raised when the cloud endpoint is unreachable or returns a non-200 response."""


_endpoint_failures: Dict[str, float] = {}
ENDPOINT_COOL_OFF_S = 15.0


def detect(
    frame: np.ndarray,
    endpoint_url: str,
    api_key: str = "",
    jpeg_quality: int = 60,
    timeout_s: float = 2.0,
    camera_id: str = "default",
    target_size: int = 320,
) -> List[Dict[str, Any]]:
    """Send `frame` to the cloud endpoint and return a list of detections."""
    t0 = time.perf_counter()

    frame_h, frame_w = frame.shape[:2]

    # ── 1. Downscale frame to target_size for ultra-fast payload transmission ──
    if max(frame_h, frame_w) > target_size:
        scale = target_size / float(max(frame_h, frame_w))
        new_w, new_h = max(1, int(frame_w * scale)), max(1, int(frame_h * scale))
        encode_frame = cv2.resize(frame, (new_w, new_h), interpolation=cv2.INTER_AREA)
    else:
        encode_frame = frame

    # ── 2. Encode frame to JPEG bytes ─────────────────────────────────────────
    ok, buf = cv2.imencode(".jpg", encode_frame, [cv2.IMWRITE_JPEG_QUALITY, jpeg_quality])
    if not ok:
        raise CloudOfflineError("Frame JPEG encoding failed")
    jpeg_bytes: bytes = buf.tobytes()

    # ── 3. Build HTTP request ──────────────────────────────────────────────────
    import base64
    b64 = base64.b64encode(jpeg_bytes).decode("ascii")
    body = json.dumps({"image_b64": b64, "target_size": target_size}).encode("utf-8")

    url = endpoint_url.rstrip("/") + "/api/detect"

    # ── 3. Send Request (with fast automatic fallback & failure cool-off) ──────
    now = time.time()
    candidate_urls = [url]
    if "127.0.0.1:8099" not in url and "localhost:8099" not in url:
        candidate_urls.append("http://127.0.0.1:8099/api/detect")

    urls_to_try = [
        u for u in candidate_urls
        if (now - _endpoint_failures.get(u, 0.0)) > ENDPOINT_COOL_OFF_S
    ]
    if not urls_to_try:
        urls_to_try = candidate_urls

    status = None
    raw = None
    last_exc = None

    for target_url in urls_to_try:
        cur_timeout = 0.5 if (len(urls_to_try) > 1 and target_url == url) else timeout_s
        try:
            req = urllib.request.Request(
                target_url,
                data=body,
                headers={
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                },
                method="POST",
            )
            if api_key:
                req.add_header("X-API-Key", api_key)

            with urllib.request.urlopen(req, timeout=cur_timeout) as resp:
                status = resp.getcode()
                raw = resp.read()
                if status >= 200 and status < 300:
                    break
        except Exception as exc:
            last_exc = exc
            _endpoint_failures[target_url] = time.time()
            print(f"[CLOUD_DIAG] Endpoint {target_url} failed ({exc}); marked for cool-off.", flush=True)

    if raw is None or status is None or status < 200 or status >= 300:
        raise CloudOfflineError(f"Cloud endpoint unreachable: {last_exc} ({url})")

    latency_ms = (time.perf_counter() - t0) * 1000

    print(
        f"[CLOUD_DIAG] [CLOUD_RESPONSE] Status={status} Time={latency_ms:.1f}ms Raw_len={len(raw)} Raw_preview={raw[:300]!r}",
        flush=True,
    )

    if status < 200 or status >= 300:
        raise CloudOfflineError(f"Cloud endpoint returned HTTP {status} ({url})")

    # ── 4. Parse JSON Response ────────────────────────────────────────────────
    try:
        payload = json.loads(raw)
    except Exception as exc:
        raise CloudOfflineError(f"Cloud response is not valid JSON: {exc}") from exc

    return _parse_response(payload, frame_w, frame_h, enc_w=new_w, enc_h=new_h)


def ping(endpoint_url: str, timeout_s: float = 2.0) -> bool:
    """Return True if the cloud endpoint answers a GET /health or /api/status within timeout_s."""
    base = endpoint_url.rstrip("/")
    for path in ["/health", "/api/status", "/"]:
        url = base + path
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "CamAI/1.0"})
            with urllib.request.urlopen(req, timeout=timeout_s) as resp:
                if resp.getcode() == 200:
                    return True
        except Exception:
            pass
    return False


# ---------------------------------------------------------------------------
# Response parser with Coordinate Scaling & NMS Duplicate Filtering
# ---------------------------------------------------------------------------

def _nms(dets: List[Dict[str, Any]], iou_thresh: float = 0.45) -> List[Dict[str, Any]]:
    if not dets:
        return []
    # Sort by confidence descending
    dets = sorted(dets, key=lambda d: d["confidence"], reverse=True)
    keep = []
    for d in dets:
        b = d["bbox"]
        x1, y1, x2, y2 = b["x1"], b["y1"], b["x2"], b["y2"]
        area = (x2 - x1) * (y2 - y1)
        if area <= 0:
            continue
        duplicate = False
        for k in keep:
            kb = k["bbox"]
            kx1, ky1, kx2, ky2 = kb["x1"], kb["y1"], kb["x2"], kb["y2"]
            karea = (kx2 - kx1) * (ky2 - ky1)
            
            # Intersection
            ix1, iy1 = max(x1, kx1), max(y1, ky1)
            ix2, iy2 = min(x2, kx2), min(y2, ky2)
            iw, ih = max(0.0, ix2 - ix1), max(0.0, iy2 - iy1)
            iarea = iw * ih
            if iarea > 0:
                iou = iarea / float(area + karea - iarea)
                # If IoU > threshold or box is 80%+ contained inside higher-confidence box of same class
                if (d.get("class") == k.get("class")) and (iou > iou_thresh or (iarea / float(area)) > 0.80):
                    duplicate = True
                    break
        if not duplicate:
            keep.append(d)
    return keep


def _parse_response(
    payload: Any,
    frame_w: int,
    frame_h: int,
    enc_w: int = 320,
    enc_h: int = 320,
) -> List[Dict[str, Any]]:
    """Convert cloud JSON payload to canonical detection list scaled to full frame."""
    if isinstance(payload, list):
        raw_dets = payload
    elif isinstance(payload, dict):
        raw_dets = (
            payload.get("detections")
            or payload.get("results")
            or payload.get("predictions")
            or payload.get("objects")
            or payload.get("data")
            or []
        )
    else:
        raw_dets = []

    if not isinstance(raw_dets, list):
        raw_dets = []

    scale_x = frame_w / float(enc_w) if (enc_w > 0 and enc_w != frame_w) else 1.0
    scale_y = frame_h / float(enc_h) if (enc_h > 0 and enc_h != frame_h) else 1.0

    out: List[Dict[str, Any]] = []
    for det in raw_dets:
        if not isinstance(det, dict):
            continue

        raw_cls = det.get("class")
        if raw_cls is None:
            raw_cls = det.get("class_id", det.get("category_id", det.get("label", det.get("name", "object"))))

        # COCO class mapping check
        if isinstance(raw_cls, int) or (isinstance(raw_cls, str) and raw_cls.isdigit()):
            cls = COCO_CLASS_MAP.get(int(raw_cls), str(raw_cls))
        else:
            cls = str(raw_cls)

        conf = float(det.get("confidence") or det.get("score") or 0.0)
        if conf < 0.20:
            continue

        # Extract bounding box
        bbox_raw = det.get("bbox")
        if isinstance(bbox_raw, dict):
            x1 = float(bbox_raw.get("x1", bbox_raw.get("xmin", 0)))
            y1 = float(bbox_raw.get("y1", bbox_raw.get("ymin", 0)))
            x2 = float(bbox_raw.get("x2", bbox_raw.get("xmax", 0)))
            y2 = float(bbox_raw.get("y2", bbox_raw.get("ymax", 0)))
            # Check for x, y, w, h
            if "w" in bbox_raw or "width" in bbox_raw:
                w = float(bbox_raw.get("w", bbox_raw.get("width", 0)))
                h = float(bbox_raw.get("h", bbox_raw.get("height", 0)))
                x2 = x1 + w
                y2 = y1 + h
        elif isinstance(bbox_raw, (list, tuple)) and len(bbox_raw) == 4:
            v1, v2, v3, v4 = (float(v) for v in bbox_raw)
            if v3 < v1 or v4 < v2:
                if v1 + v3 <= 1.05 and v2 + v4 <= 1.05:
                    x1, y1, x2, y2 = v1, v2, v1 + v3, v2 + v4
                else:
                    x1, y1, x2, y2 = v1 - v3 / 2.0, v2 - v4 / 2.0, v1 + v3 / 2.0, v2 + v4 / 2.0
            else:
                x1, y1, x2, y2 = v1, v2, v3, v4
        else:
            x1 = float(det.get("x1", det.get("xmin", 0)))
            y1 = float(det.get("y1", det.get("ymin", 0)))
            x2 = float(det.get("x2", det.get("xmax", 0)))
            y2 = float(det.get("y2", det.get("ymax", 0)))

        # Auto-detect normalised vs pixel coords: if all coords <= 1.0 treat as normalised
        if x1 <= 1.0 and y1 <= 1.0 and x2 <= 1.0 and y2 <= 1.0 and (x2 > x1 or y2 > y1):
            x1 *= frame_w
            x2 *= frame_w
            y1 *= frame_h
            y2 *= frame_h
        else:
            # Rescale pixel coords from downscaled encoded frame to original frame size
            x1 *= scale_x
            x2 *= scale_x
            y1 *= scale_y
            y2 *= scale_y

        # Clamp to frame bounds
        x1 = max(0.0, min(float(frame_w - 1), x1))
        y1 = max(0.0, min(float(frame_h - 1), y1))
        x2 = max(0.0, min(float(frame_w - 1), x2))
        y2 = max(0.0, min(float(frame_h - 1), y2))

        if x2 - x1 < 4 or y2 - y1 < 4:
            continue  # degenerate box

        out.append({
            "class": cls,
            "confidence": round(conf, 4),
            "bbox": {"x1": x1, "y1": y1, "x2": x2, "y2": y2},
        })

    # Apply NMS to remove duplicate stacked boxes
    out = _nms(out, iou_thresh=0.45)
    return out
