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
    jpeg_quality: int = 75,
    timeout_s: float = 3.0,
    camera_id: str = "default",
) -> List[Dict[str, Any]]:
    """Send `frame` to the cloud endpoint and return a list of detections."""
    t0 = time.perf_counter()

    # ── 1. Encode frame to JPEG bytes ─────────────────────────────────────────
    ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, jpeg_quality])
    if not ok:
        raise CloudOfflineError("Frame JPEG encoding failed")
    jpeg_bytes: bytes = buf.tobytes()

    frame_h, frame_w = frame.shape[:2]

    # ── 2. Build HTTP request ──────────────────────────────────────────────────
    import base64
    b64 = base64.b64encode(jpeg_bytes).decode("ascii")
    body = json.dumps({"image_b64": b64}).encode("utf-8")

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

    return _parse_response(payload, frame_w, frame_h)


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
# Response parser
# ---------------------------------------------------------------------------

def _parse_response(
    payload: Any,
    frame_w: int,
    frame_h: int,
) -> List[Dict[str, Any]]:
    """Convert cloud JSON payload to canonical detection list."""
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

    print(
        f"[CLOUD_DIAG] [RAW_DETECTIONS] Count={len(raw_dets)} Dets={raw_dets}",
        flush=True,
    )

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
                # Format: [x_min, y_min, width, height] or [x_center, y_center, width, height]
                if v1 + v3 <= 1.05 and v2 + v4 <= 1.05:
                    x1, y1, x2, y2 = v1, v2, v1 + v3, v2 + v4
                else:
                    x1, y1, x2, y2 = v1 - v3 / 2.0, v2 - v4 / 2.0, v1 + v3 / 2.0, v2 + v4 / 2.0
            else:
                x1, y1, x2, y2 = v1, v2, v3, v4
        else:
            # Flat keys on det itself
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

        # Clamp to frame bounds
        x1 = max(0.0, min(float(frame_w - 1), x1))
        y1 = max(0.0, min(float(frame_h - 1), y1))
        x2 = max(0.0, min(float(frame_w - 1), x2))
        y2 = max(0.0, min(float(frame_h - 1), y2))

        if x2 - x1 < 2 or y2 - y1 < 2:
            continue  # degenerate box

        out.append({
            "class": cls,
            "confidence": round(conf, 4),
            "bbox": {"x1": x1, "y1": y1, "x2": x2, "y2": y2},
        })

    formatted_dets = [f"{d['class']}:{d['confidence']}:({int(d['bbox']['x1'])},{int(d['bbox']['y1'])},{int(d['bbox']['x2'])},{int(d['bbox']['y2'])})" for d in out]
    print(
        f"[CLOUD_DIAG] [PARSED_DETECTIONS] Count={len(out)} Dets={formatted_dets}",
        flush=True,
    )

    return out
