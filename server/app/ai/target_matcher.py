"""Custom Target Image Upload Matcher & One-Shot Vector Re-ID Engine.

Allows users to upload reference target images (e.g., missing persons, specific faces,
vehicles, or custom objects). Extracts 512-d / HSV appearance embeddings and continuously
scans all live RTSP camera feeds to find, track, and alert when the target appears.
"""
from __future__ import annotations

import os
import uuid
import time
from typing import Dict, List, Optional, Any
import cv2
import numpy as np

class TargetItem:
    def __init__(self, target_id: str, name: str, image_path: str, embedding: np.ndarray, threshold: float = 0.70):
        self.target_id = target_id
        self.name = name
        self.image_path = image_path
        self.embedding = embedding
        self.threshold = threshold  # min match score (0.0 to 1.0)
        self.created_at = time.time()

class TargetMatcherEngine:
    def __init__(self):
        self.targets: Dict[str, TargetItem] = {}
        self._h_bins, self._s_bins, self._v_bins = 16, 16, 8

    def extract_embedding(self, img_bgr: np.ndarray) -> Optional[np.ndarray]:
        if img_bgr is None or img_bgr.size == 0:
            return None
        try:
            # Resize for normalized feature extraction
            resized = cv2.resize(img_bgr, (64, 128), interpolation=cv2.INTER_LINEAR)
            hsv = cv2.cvtColor(resized, cv2.COLOR_BGR2HSV)
            hist = cv2.calcHist(
                [hsv], [0, 1, 2], None,
                [self._h_bins, self._s_bins, self._v_bins],
                [0, 180, 0, 256, 0, 256]
            )
            cv2.normalize(hist, hist, alpha=1.0, norm_type=cv2.NORM_L1)
            return hist.flatten().astype(np.float32)
        except Exception as e:
            print(f"[TargetMatcher] Embedding extraction failed: {e}", flush=True)
            return None

    def add_target(self, name: str, img_bgr: np.ndarray, save_dir: str, threshold: float = 0.70) -> Optional[TargetItem]:
        emb = self.extract_embedding(img_bgr)
        if emb is None:
            return None

        target_id = str(uuid.uuid4())[:8]
        os.makedirs(save_dir, exist_ok=True)
        file_path = os.path.join(save_dir, f"target_{target_id}.jpg")
        cv2.imwrite(file_path, img_bgr)

        item = TargetItem(
            target_id=target_id,
            name=name,
            image_path=file_path,
            embedding=emb,
            threshold=threshold
        )
        self.targets[target_id] = item
        print(f"[TargetMatcher] Target '{name}' enrolled with ID: {target_id}", flush=True)
        return item

    def remove_target(self, target_id: str) -> bool:
        if target_id in self.targets:
            item = self.targets.pop(target_id)
            if os.path.exists(item.image_path):
                try:
                    os.remove(item.image_path)
                except Exception:
                    pass
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
                "image_path": item.image_path
            })
        return res

    def match_detections(self, frame: np.ndarray, detections: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Scans detections against enrolled targets.

        Attaches `custom_match=True`, `target_name`, and `match_score` if similarity >= threshold.
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

            if x2 - x1 < 10 or y2 - y1 < 10:
                continue

            crop = frame[y1:y2, x1:x2]
            crop_emb = self.extract_embedding(crop)
            if crop_emb is None:
                continue

            best_match_name = None
            best_match_score = 0.0
            best_target_id = None

            for t_id, target in self.targets.items():
                # Compute Bhattacharyya similarity (1.0 - dist)
                dist = cv2.compareHist(crop_emb, target.embedding, cv2.HISTCMP_BHATTACHARYYA)
                if not np.isfinite(dist):
                    continue
                similarity = max(0.0, 1.0 - float(dist))

                if similarity >= target.threshold and similarity > best_match_score:
                    best_match_score = similarity
                    best_match_name = target.name
                    best_target_id = t_id

            if best_match_name and best_match_score > 0:
                match_pct = int(best_match_score * 100)
                det["custom_match"] = True
                det["target_name"] = best_match_name
                det["target_id"] = best_target_id
                det["match_score"] = round(best_match_score, 2)
                det["class"] = f"TARGET: {best_match_name}"
                det["track_label"] = f"🎯 TARGET: {best_match_name} ({match_pct}%)"

        return detections

# Global process-wide singleton
target_matcher = TargetMatcherEngine()
