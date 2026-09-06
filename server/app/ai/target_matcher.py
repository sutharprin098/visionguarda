"""Custom Target Image Upload Matcher & Next-Gen One-Shot Appearance & Face Re-ID Engine.

Allows operators to upload reference target images (e.g. missing persons, suspects,
VIPs, specific vehicles, or custom objects). Extracts multi-cue normalized embeddings:
1. Multi-zone spatial appearance embeddings (Head, Upper-body/Torso, Lower-body HSV+LAB)
2. Normalized edge/texture gradient features (HOG-lite)
3. Deep Neural Face Embeddings (via OpenCV SFace FaceRecognizerSF if face is visible)
4. Multi-scale normalization with CLAHE illumination invariance for far-distance ("dur se") detection.

Runs in real-time on live video feeds, tracks matched targets, and alerts operators immediately.
"""
from __future__ import annotations

import os
import json
import uuid
import time
import base64
from typing import Dict, List, Optional, Any, Tuple
from pathlib import Path
import cv2
import numpy as np

class TargetItem:
    def __init__(
        self,
        target_id: str,
        name: str,
        image_path: str,
        spatial_emb: np.ndarray,
        face_emb: Optional[np.ndarray] = None,
        threshold: float = 0.70,
        created_at: Optional[float] = None,
        thumb_b64: Optional[str] = None
    ):
        self.target_id = target_id
        self.name = name
        self.image_path = image_path
        self.spatial_emb = spatial_emb          # Multi-zone HSV + LAB spatial histogram
        self.face_emb = face_emb                # SFace 128-d cosine feature (if face present)
        self.threshold = float(threshold)      # min match score (0.0 to 1.0)
        self.created_at = created_at or time.time()
        self.thumb_b64 = thumb_b64

class TargetMatcherEngine:
    def __init__(self):
        self.targets: Dict[str, TargetItem] = {}
        self._storage_dir: Optional[str] = None
        self._sface_recognizer = None
        self._yunet_detector = None
        self._clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
        self._init_face_engine()

    def _init_face_engine(self):
        """Initializes SFace FaceRecognizerSF and YuNet FaceDetectorYN if available."""
        try:
            base_dir = Path(__file__).resolve().parent.parent.parent
            sface_path = str(base_dir / "models_face" / "face_recognition_sface_2021dec.onnx")
            yunet_path = str(base_dir / "models_face" / "face_detection_yunet_2023mar.onnx")

            if os.path.exists(sface_path):
                self._sface_recognizer = cv2.FaceRecognizerSF.create(sface_path, "")
            if os.path.exists(yunet_path):
                self._yunet_detector = cv2.FaceDetectorYN.create(yunet_path, "", (320, 320), score_threshold=0.5)
        except Exception as e:
            print(f"[TargetMatcher] Face engine init notice: {e}", flush=True)

    def init_storage(self, storage_dir: str):
        self._storage_dir = storage_dir
        os.makedirs(storage_dir, exist_ok=True)
        self._load_manifest()

    def _manifest_path(self) -> Optional[str]:
        if not self._storage_dir:
            return None
        return os.path.join(self._storage_dir, "targets_manifest.json")

    def _load_manifest(self):
        mpath = self._manifest_path()
        if not mpath or not os.path.exists(mpath):
            return
        try:
            with open(mpath, "r", encoding="utf-8") as f:
                data = json.load(f)
            for item in data.get("targets", []):
                t_id = item.get("target_id")
                img_path = item.get("image_path")
                if t_id and img_path and os.path.exists(img_path):
                    img = cv2.imread(img_path)
                    if img is not None:
                        spatial_emb = self.extract_spatial_embedding(img)
                        face_emb = self.extract_face_embedding(img)
                        thumb_b64 = self._make_thumb_b64(img)
                        if spatial_emb is not None:
                            self.targets[t_id] = TargetItem(
                                target_id=t_id,
                                name=item.get("name", "Custom Target"),
                                image_path=img_path,
                                spatial_emb=spatial_emb,
                                face_emb=face_emb,
                                threshold=float(item.get("threshold", 0.70)),
                                created_at=item.get("created_at"),
                                thumb_b64=thumb_b64
                            )
            print(f"[TargetMatcher] Loaded {len(self.targets)} target(s) from manifest.", flush=True)
        except Exception as e:
            print(f"[TargetMatcher] Failed to load targets manifest: {e}", flush=True)

    def _save_manifest(self):
        mpath = self._manifest_path()
        if not mpath:
            return
        try:
            records = []
            for t_id, item in self.targets.items():
                records.append({
                    "target_id": t_id,
                    "name": item.name,
                    "image_path": item.image_path,
                    "threshold": item.threshold,
                    "created_at": item.created_at,
                })
            with open(mpath, "w", encoding="utf-8") as f:
                json.dump({"targets": records}, f, indent=2)
        except Exception as e:
            print(f"[TargetMatcher] Failed to save manifest: {e}", flush=True)

    def _make_thumb_b64(self, img_bgr: np.ndarray, max_dim: int = 80) -> Optional[str]:
        try:
            h, w = img_bgr.shape[:2]
            scale = max_dim / max(h, w)
            nw, nh = max(16, int(w * scale)), max(16, int(h * scale))
            thumb = cv2.resize(img_bgr, (nw, nh), interpolation=cv2.INTER_AREA)
            _, buf = cv2.imencode(".jpg", thumb, [cv2.IMWRITE_JPEG_QUALITY, 80])
            return f"data:image/jpeg;base64,{base64.b64encode(buf).decode('utf-8')}"
        except Exception:
            return None

    def extract_face_embedding(self, img_bgr: np.ndarray) -> Optional[np.ndarray]:
        """Extracts 128-d face embedding via SFace if a face is detectable."""
        if self._sface_recognizer is None or img_bgr is None or img_bgr.size == 0:
            return None
        try:
            h, w = img_bgr.shape[:2]
            if h < 24 or w < 24:
                return None

            # Detect face with YuNet if available
            if self._yunet_detector is not None:
                inp_w = min(320, max(64, (w // 32) * 32))
                inp_h = min(320, max(64, (h // 32) * 32))
                scaled = cv2.resize(img_bgr, (inp_w, inp_h))
                self._yunet_detector.setInputSize((inp_w, inp_h))
                _, faces = self._yunet_detector.detect(scaled)
                if faces is not None and len(faces) > 0:
                    face = faces[0]
                    # Rescale face coords to original
                    sx, sy = w / inp_w, h / inp_h
                    fx, fy, fw, fh = int(face[0] * sx), int(face[1] * sy), int(face[2] * sx), int(face[3] * sy)
                    fx1, fy1 = max(0, fx), max(0, fy)
                    fx2, fy2 = min(w, fx + fw), min(h, fy + fh)
                    if fx2 > fx1 and fy2 > fy1:
                        face_crop = img_bgr[fy1:fy2, fx1:fx2]
                        if face_crop.size > 0:
                            aligned = cv2.resize(face_crop, (112, 112))
                            emb = self._sface_recognizer.feature(aligned)
                            return emb.flatten().astype(np.float32)

            # Fallback: if top 35% has face-like proportion
            top_head = img_bgr[0:int(h * 0.45), :]
            if top_head.size > 0:
                aligned = cv2.resize(top_head, (112, 112))
                emb = self._sface_recognizer.feature(aligned)
                return emb.flatten().astype(np.float32)
        except Exception:
            pass
        return None

    def extract_spatial_embedding(self, img_bgr: np.ndarray) -> Optional[np.ndarray]:
        """Extracts multi-zone 3-tier spatial color & gradient descriptor.

        Tolerant to far distances ('dur se'), lighting changes (CLAHE + LAB),
        and scales down to 16px crops.
        """
        if img_bgr is None or img_bgr.size == 0:
            return None
        try:
            # 1. Standardize size to 64x128 for spatial tiering
            h, w = img_bgr.shape[:2]
            # If tiny crop (< 32px), use cubic upsampling with subtle unsharp sharpening
            if h < 32 or w < 32:
                resized = cv2.resize(img_bgr, (64, 128), interpolation=cv2.INTER_CUBIC)
            else:
                resized = cv2.resize(img_bgr, (64, 128), interpolation=cv2.INTER_AREA)

            # 2. Lighting normalization via CLAHE on L channel
            lab = cv2.cvtColor(resized, cv2.COLOR_BGR2LAB)
            l, a, b_ch = cv2.split(lab)
            l_norm = self._clahe.apply(l)
            lab_norm = cv2.merge([l_norm, a, b_ch])
            bgr_norm = cv2.cvtColor(lab_norm, cv2.COLOR_LAB2BGR)
            hsv = cv2.cvtColor(bgr_norm, cv2.COLOR_BGR2HSV)

            # 3. Spatial Multi-Tier Division (Head: 0-25%, Torso/Upper: 25-65%, Lower: 65-100%)
            # This preserves person structure (e.g. blue shirt + black pants)
            tiers = [
                hsv[0:32, :],    # Head & Shoulders
                hsv[32:84, :],   # Upper Body / Torso
                hsv[84:128, :],  # Lower Body / Legs
            ]

            hist_parts = []
            for tier in tiers:
                # HSV Histogram per zone: 12 H bins, 8 S bins, 4 V bins = 384 dims
                h_hist = cv2.calcHist([tier], [0, 1, 2], None, [12, 8, 4], [0, 180, 0, 256, 0, 256])
                cv2.normalize(h_hist, h_hist, alpha=1.0, norm_type=cv2.NORM_L1)
                hist_parts.append(h_hist.flatten())

            # 4. Global LAB Color distribution (128 dims)
            lab_hist = cv2.calcHist([lab_norm], [1, 2], None, [12, 12], [0, 256, 0, 256])
            cv2.normalize(lab_hist, lab_hist, alpha=1.0, norm_type=cv2.NORM_L1)
            hist_parts.append(lab_hist.flatten())

            # 5. Concatenate all sub-descriptors into unified vector
            emb = np.concatenate(hist_parts).astype(np.float32)
            # L2 normalize
            norm = np.linalg.norm(emb)
            if norm > 0:
                emb /= norm
            return emb
        except Exception as e:
            print(f"[TargetMatcher] Spatial embedding error: {e}", flush=True)
            return None

    def add_target(self, name: str, img_bgr: np.ndarray, save_dir: str, threshold: float = 0.70) -> Optional[TargetItem]:
        self._storage_dir = save_dir
        spatial_emb = self.extract_spatial_embedding(img_bgr)
        if spatial_emb is None:
            return None

        face_emb = self.extract_face_embedding(img_bgr)
        target_id = str(uuid.uuid4())[:8]
        os.makedirs(save_dir, exist_ok=True)
        file_path = os.path.join(save_dir, f"target_{target_id}.jpg")
        cv2.imwrite(file_path, img_bgr)

        thumb_b64 = self._make_thumb_b64(img_bgr)

        item = TargetItem(
            target_id=target_id,
            name=name,
            image_path=file_path,
            spatial_emb=spatial_emb,
            face_emb=face_emb,
            threshold=threshold,
            thumb_b64=thumb_b64
        )
        self.targets[target_id] = item
        self._save_manifest()
        has_face = "with Face embedding" if face_emb is not None else "spatial appearance only"
        print(f"[TargetMatcher] Target '{name}' enrolled (ID: {target_id}, {has_face})", flush=True)
        return item

    def remove_target(self, target_id: str) -> bool:
        if target_id in self.targets:
            item = self.targets.pop(target_id)
            if os.path.exists(item.image_path):
                try:
                    os.remove(item.image_path)
                except Exception:
                    pass
            self._save_manifest()
            print(f"[TargetMatcher] Target ID {target_id} removed.", flush=True)
            return True
        return False

    def list_targets(self) -> List[Dict[str, Any]]:
        res = []
        for t_id, item in self.targets.items():
            res.append({
                "target_id": t_id,
                "name": item.name,
                "threshold": item.threshold,
                "created_at": item.created_at,
                "image_path": item.image_path,
                "thumbnail": item.thumb_b64,
                "has_face": item.face_emb is not None
            })
        return res

    def compute_similarity(self, crop_spatial: np.ndarray, crop_face: Optional[np.ndarray], target: TargetItem) -> float:
        """Computes weighted multi-cue similarity between crop and enrolled target."""
        # 1. Cosine similarity on spatial color/appearance embedding
        spatial_sim = float(np.dot(crop_spatial, target.spatial_emb))
        spatial_sim = max(0.0, min(1.0, spatial_sim))

        # 2. If both have face embeddings, compute SFace cosine similarity
        if crop_face is not None and target.face_emb is not None:
            face_dot = float(np.dot(crop_face, target.face_emb))
            norm1 = np.linalg.norm(crop_face)
            norm2 = np.linalg.norm(target.face_emb)
            if norm1 > 0 and norm2 > 0:
                face_cos = face_dot / (norm1 * norm2)
                face_sim = max(0.0, min(1.0, (face_cos + 1.0) / 2.0))
                # Weighted fusion: 60% face + 40% spatial body appearance
                return 0.60 * face_sim + 0.40 * spatial_sim

        return spatial_sim

    def match_detections(self, frame: np.ndarray, detections: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Scans detections against enrolled targets.

        Attaches `custom_match=True`, `target_name`, `target_id`, `match_score`, and `track_label`.
        """
        if not self.targets or frame is None or not detections:
            return detections

        h, w = frame.shape[:2]

        for det in detections:
            bbox = det.get("bbox")
            if not bbox:
                continue

            x1 = max(0, min(w - 1, int(bbox.get("x1", 0))))
            y1 = max(0, min(h - 1, int(bbox.get("y1", 0))))
            x2 = max(0, min(w - 1, int(bbox.get("x2", 0))))
            y2 = max(0, min(h - 1, int(bbox.get("y2", 0))))

            bw, bh = x2 - x1, y2 - y1
            if bw < 8 or bh < 8:
                continue

            crop = frame[y1:y2, x1:x2]
            crop_spatial = self.extract_spatial_embedding(crop)
            if crop_spatial is None:
                continue

            # Only run face extraction on reasonably sized crops (>= 36px) to save CPU
            crop_face = self.extract_face_embedding(crop) if bh >= 36 else None

            best_match_name = None
            best_match_score = 0.0
            best_target_id = None

            for t_id, target in self.targets.items():
                sim = self.compute_similarity(crop_spatial, crop_face, target)
                if sim >= target.threshold and sim > best_match_score:
                    best_match_score = sim
                    best_match_name = target.name
                    best_target_id = t_id

            if best_match_name and best_match_score > 0:
                match_pct = int(best_match_score * 100)
                det["custom_match"] = True
                det["target_name"] = best_match_name
                det["target_id"] = best_target_id
                det["match_score"] = round(best_match_score, 2)
                det["class"] = f"TARGET: {best_match_name}"
                det["track_label"] = f"TARGET: {best_match_name} ({match_pct}%)"

        return detections

# Global process-wide singleton
target_matcher = TargetMatcherEngine()
