import cv2
import numpy as np
import time
from typing import List, Dict, Any, Optional, Tuple

class ScreenMicroMotionDetector:
    """
    High-Sensitivity Micro-Motion Detection & Visual Overlay Engine.
    Specifically calibrated for CCTV alarm replays to detect subtle movements 
    including rodents, insects, birds, vegetation shifts, and distant human motion.
    """
    def __init__(self, 
                 min_area: int = 15, 
                 max_area: int = 35000, 
                 threshold_value: int = 4, 
                 blur_kernel: Tuple[int, int] = (5, 5),
                 history_frames: int = 5,
                 max_targets: int = 1):
        self.min_area = min_area
        self.max_area = max_area
        self.threshold_value = threshold_value
        self.blur_kernel = blur_kernel
        self.history_frames = history_frames
        self.max_targets = max_targets
        
        self.frame_buffer: List[np.ndarray] = []
        self.last_motion_detections: List[Dict[str, Any]] = []
        self.bg_subtractor = cv2.createBackgroundSubtractorMOG2(
            history=max(20, history_frames * 6),
            varThreshold=10,
            detectShadows=False,
        )
        self._noise_ema: Optional[float] = None

    def reset(self):
        """Reset internal frame history buffer."""
        self.frame_buffer.clear()
        self.last_motion_detections.clear()
        self.bg_subtractor = cv2.createBackgroundSubtractorMOG2(
            history=max(20, self.history_frames * 6),
            varThreshold=10,
            detectShadows=False,
        )
        self._noise_ema = None

    @staticmethod
    def _adaptive_threshold(delta: np.ndarray, mean_lum: float, base: int) -> Tuple[int, float]:
        if delta.size == 0:
            return max(2, base), 0.0
        med = float(np.median(delta))
        mad = float(np.median(np.abs(delta.astype(np.float32) - med)))
        sigma = 1.4826 * mad
        # Dark sensors are noisy, but the threshold still has to stay low enough
        # for 1-2 px real displacement. Use a noise-relative floor instead of a
        # fixed high cutoff.
        low_light = mean_lum < 85.0
        k = 3.8 if low_light else 3.0
        floor = 2 if low_light else max(3, base)
        return int(np.clip(max(floor, med + k * sigma), floor, 18)), sigma

    @staticmethod
    def _local_flow_score(prev: np.ndarray, curr: np.ndarray, x: int, y: int, w: int, h: int) -> float:
        pad = 4
        x1 = max(0, x - pad); y1 = max(0, y - pad)
        x2 = min(curr.shape[1], x + w + pad); y2 = min(curr.shape[0], y + h + pad)
        if x2 - x1 < 8 or y2 - y1 < 8:
            return 0.0
        p0 = cv2.goodFeaturesToTrack(prev[y1:y2, x1:x2], maxCorners=24, qualityLevel=0.01,
                                     minDistance=3, blockSize=3)
        if p0 is None:
            return 0.0
        p1, st, _ = cv2.calcOpticalFlowPyrLK(prev[y1:y2, x1:x2], curr[y1:y2, x1:x2], p0, None,
                                             winSize=(9, 9), maxLevel=2)
        if p1 is None or st is None:
            return 0.0
        moved = p1[st.reshape(-1) == 1] - p0[st.reshape(-1) == 1]
        if moved.size == 0:
            return 0.0
        return float(np.median(np.linalg.norm(moved.reshape(-1, 2), axis=1)))

    def process_frame(self, frame: np.ndarray, return_annotated: bool = True) -> Tuple[np.ndarray, List[Dict[str, Any]]]:
        """
        Process a single video frame, perform temporal frame-differencing,
        extract motion contours, and return bounding box metadata (and optional HUD-overlaid frame).
        """
        if frame is None or frame.size == 0:
            return frame, []

        h, w = frame.shape[:2]
        
        # 1. Resize to a bounded working size. This keeps the pass cheap on 1080p
        # streams while retaining enough pixels for tiny birds/rodents.
        proc_w = min(640, max(320, int(round(w / max(1.0, w / 640.0)))))
        proc_h = max(180, int(round(h * (proc_w / float(w)))))
        scale_x, scale_y = w / float(proc_w), h / float(proc_h)
        
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        proc_gray = cv2.resize(gray, (proc_w, proc_h), interpolation=cv2.INTER_LINEAR)
        mean_lum = float(np.mean(proc_gray))
        # Mild denoise only. A large blur erased exactly the single-pixel edge
        # changes this detector is supposed to catch in night footage.
        blurred = cv2.GaussianBlur(proc_gray, (3, 3), 0)
        
        self.frame_buffer.append(blurred)
        if len(self.frame_buffer) > self.history_frames:
            self.frame_buffer.pop(0)

        # Clear buffer if frame dimensions change mid-stream
        if self.frame_buffer and self.frame_buffer[0].shape != blurred.shape:
            self.frame_buffer = [blurred]

        # Need at least 2 frames to calculate motion difference
        if len(self.frame_buffer) < 2:
            return frame, []

        # 2. Temporal differencing: previous frame catches fast movement, oldest
        # buffered frame catches very slow displacement, MOG2 adds background
        # subtraction without another expensive model.
        reference_frame = self.frame_buffer[0]
        prev_frame = self.frame_buffer[-2]
        delta_prev = cv2.absdiff(prev_frame, blurred)
        delta_hist = cv2.absdiff(reference_frame, blurred)
        frame_delta = cv2.max(delta_prev, delta_hist)
        adaptive_thr, noise_sigma = self._adaptive_threshold(frame_delta, mean_lum, self.threshold_value)
        self._noise_ema = noise_sigma if self._noise_ema is None else (0.9 * self._noise_ema + 0.1 * noise_sigma)
        
        # 3. Thresholding to convert delta to binary motion mask. Combine two
        # independent signals so compression sparkle has to survive local shape
        # cleanup before it becomes a target.
        _, thresh = cv2.threshold(frame_delta, adaptive_thr, 255, cv2.THRESH_BINARY)
        fg = self.bg_subtractor.apply(blurred, learningRate=0.015 if mean_lum < 85.0 else 0.03)
        _, fg = cv2.threshold(fg, 180, 255, cv2.THRESH_BINARY)
        thresh = cv2.bitwise_or(thresh, fg)
        
        # Exclude bottom 10% and top 5% timestamp/header noise regions
        thresh[:int(proc_h * 0.05), :] = 0
        thresh[int(proc_h * 0.88):, :] = 0

        # 4. Small morphology: connect real moving edges, but do not balloon tiny
        # objects into huge boxes or merge unrelated speckles.
        close_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
        closed = cv2.morphologyEx(thresh, cv2.MORPH_CLOSE, close_kernel)
        dilated = cv2.dilate(closed, None, iterations=1)
        
        # 5. Find contours on motion mask
        contours, _ = cv2.findContours(dilated.copy(), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        
        candidates = []
        for c in contours:
            area = cv2.contourArea(c)
            if self.min_area <= area <= self.max_area:
                (x, y, bw, bh) = cv2.boundingRect(c)
                
                # Ignore extreme aspect ratio streaks (camera noise)
                aspect = max(bw / max(1, bh), bh / max(1, bw))
                if aspect > 5.0:
                    continue

                roi_delta = frame_delta[y:y+bh, x:x+bw]
                intensity = float(np.mean(roi_delta)) if roi_delta.size > 0 else 0.0
                active_ratio = float(np.count_nonzero(thresh[y:y+bh, x:x+bw])) / max(1.0, float(bw * bh))
                flow_px = self._local_flow_score(prev_frame, blurred, x, y, bw, bh)
                if flow_px < 0.35 and active_ratio < 0.18:
                    continue
                if intensity < adaptive_thr * 0.65 and flow_px < 0.75:
                    continue
                motion_score = (intensity + 8.0 * flow_px) * (area ** 0.5) * (0.4 + active_ratio)
                confidence = min(0.99, max(0.35, (intensity / max(8.0, adaptive_thr * 3.0)) + min(flow_px, 2.0) * 0.16))

                tag = "TINY MOTION" if area < 700 else ("SMALL ANIMAL / BIRD" if area < 2500 else "SUBTLE MOTION TARGET")
                color = (0, 255, 255) if area < 1500 else (0, 165, 255)

                # Scale coordinates back to original frame dimensions
                orig_x = int(x * scale_x)
                orig_y = int(y * scale_y)
                orig_bw = int(bw * scale_x)
                orig_bh = int(bh * scale_y)

                candidates.append({
                    "box": [orig_x, orig_y, orig_bw, orig_bh],
                    "area": int(area * scale_x * scale_y),
                    "confidence": round(confidence, 2),
                    "score": motion_score,
                    "threshold": adaptive_thr,
                    "noise_sigma": round(float(self._noise_ema or noise_sigma), 2),
                    "flow_px": round(flow_px, 2),
                    "tag": tag,
                    "color": color
                })

        # Sort candidates by motion saliency score (highest intensity/area first)
        candidates.sort(key=lambda item: item["score"], reverse=True)
        
        # Keep ONLY the top 1 primary target (single box on the mouse)
        selected_targets = candidates[:self.max_targets]

        detections = []
        annotated_frame = frame if not return_annotated else frame.copy()
        
        if return_annotated:
            # Subtle heatmap overlay for context
            motion_heatmap = cv2.applyColorMap(cv2.convertScaleAbs(frame_delta, alpha=3.0), cv2.COLORMAP_JET)
            motion_heatmap = cv2.resize(motion_heatmap, (w, h), interpolation=cv2.INTER_LINEAR)
            annotated_frame = cv2.addWeighted(annotated_frame, 0.90, motion_heatmap, 0.10, 0)

        for i, det in enumerate(selected_targets):
            det["id"] = i + 1
            x, y, bw, bh = det["box"]
            color = det["color"]
            tag = det["tag"]
            conf = det["confidence"]

            detections.append(det)

            if return_annotated:
                # Draw SINGLE high-contrast bounding box around the mouse
                cv2.rectangle(annotated_frame, (x, y), (x + bw, y + bh), color, 2)
                
                # Corner accents
                line_len = min(bw // 4, bh // 4, 12)
                if line_len > 2:
                    cv2.line(annotated_frame, (x, y), (x + line_len, y), color, 3)
                    cv2.line(annotated_frame, (x, y), (x, y + line_len), color, 3)
                    cv2.line(annotated_frame, (x + bw, y), (x + bw - line_len, y), color, 3)
                    cv2.line(annotated_frame, (x + bw, y), (x + bw, y + line_len), color, 3)

                # Label text
                lbl = f"{tag} | {int(conf*100)}%"
                (tw, th), _ = cv2.getTextSize(lbl, cv2.FONT_HERSHEY_SIMPLEX, 0.45, 1)
                cv2.rectangle(annotated_frame, (x, max(0, y - th - 6)), (x + tw + 6, max(th + 6, y)), (0, 0, 0), -1)
                cv2.putText(annotated_frame, lbl, (x + 3, max(th + 2, y - 4)), cv2.FONT_HERSHEY_SIMPLEX, 0.45, color, 1)

        if return_annotated:
            # Draw HUD header overlay bar
            cv2.rectangle(annotated_frame, (10, 10), (360, 45), (15, 15, 15), -1)
            cv2.rectangle(annotated_frame, (10, 10), (360, 45), (0, 255, 255), 1)
            cv2.putText(annotated_frame, f"NZ CCTV Micro-Motion HUD | Active: {len(detections)}", (20, 32), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 255), 1, cv2.LINE_AA)

        self.last_motion_detections = detections
        return annotated_frame, detections

    def detect(self, frame: np.ndarray) -> List[Dict[str, Any]]:
        """
        Runs micro-motion detection on frame and returns standardized detection list:
        [{'bbox': [x, y, w, h], 'confidence': float, 'class': 'micro_motion', 'tag': str}]
        """
        _, dets = self.process_frame(frame, return_annotated=False)
        result = []
        for d in dets:
            box = d["box"]
            result.append({
                "bbox": [box[0], box[1], box[2], box[3]],
                "confidence": d.get("confidence", 0.85),
                "class": "micro_motion",
                "tag": d.get("tag", "Micro Motion")
            })
        return result
