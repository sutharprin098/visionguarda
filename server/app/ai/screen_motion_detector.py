import cv2
import numpy as np
import time
from typing import List, Dict, Any, Tuple

class ScreenMicroMotionDetector:
    """
    High-Sensitivity Micro-Motion Detection & Visual Overlay Engine.
    Specifically calibrated for CCTV alarm replays to detect subtle movements 
    including rodents, insects, birds, vegetation shifts, and distant human motion.
    """
    def __init__(self, 
                 min_area: int = 25, 
                 max_area: int = 35000, 
                 threshold_value: int = 6, 
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

    def reset(self):
        """Reset internal frame history buffer."""
        self.frame_buffer.clear()
        self.last_motion_detections.clear()

    def process_frame(self, frame: np.ndarray) -> Tuple[np.ndarray, List[Dict[str, Any]]]:
        """
        Process a single video frame, perform temporal frame-differencing,
        extract motion contours, and return both the HUD-overlaid frame and bounding box metadata.
        """
        if frame is None or frame.size == 0:
            return frame, []

        h, w = frame.shape[:2]
        
        # 1. Resize to fixed canonical (640, 360) for stable temporal differencing across all input sizes
        proc_w, proc_h = 640, 360
        scale_x, scale_y = w / float(proc_w), h / float(proc_h)
        
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        proc_gray = cv2.resize(gray, (proc_w, proc_h), interpolation=cv2.INTER_LINEAR)
        blurred = cv2.GaussianBlur(proc_gray, self.blur_kernel, 0)
        
        self.frame_buffer.append(blurred)
        if len(self.frame_buffer) > self.history_frames:
            self.frame_buffer.pop(0)

        # Clear buffer if frame dimensions change mid-stream
        if self.frame_buffer and self.frame_buffer[0].shape != blurred.shape:
            self.frame_buffer = [blurred]

        # Need at least 2 frames to calculate motion difference
        if len(self.frame_buffer) < 2:
            return frame, []

        # 2. Temporal Frame Differencing between current frame and oldest buffered frame
        reference_frame = self.frame_buffer[0]
        frame_delta = cv2.absdiff(reference_frame, blurred)
        
        # 3. Thresholding to convert delta to binary motion mask
        _, thresh = cv2.threshold(frame_delta, self.threshold_value, 255, cv2.THRESH_BINARY)
        
        # Exclude bottom 10% and top 5% timestamp/header noise regions
        thresh[:int(proc_h * 0.05), :] = 0
        thresh[int(proc_h * 0.88):, :] = 0

        # 4. Morphological closing & dilation to merge rat/mouse body segments
        close_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (7, 7))
        closed = cv2.morphologyEx(thresh, cv2.MORPH_CLOSE, close_kernel)
        dilated = cv2.dilate(closed, None, iterations=2)
        
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
                motion_score = intensity * (area ** 0.5)
                confidence = min(0.99, max(0.45, intensity / 40.0))

                tag = "RODENT / MOUSE" if area < 2500 else "SUBTLE MOTION TARGET"
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
                    "tag": tag,
                    "color": color
                })

        # Sort candidates by motion saliency score (highest intensity/area first)
        candidates.sort(key=lambda item: item["score"], reverse=True)
        
        # Keep ONLY the top 1 primary target (single box on the mouse)
        selected_targets = candidates[:self.max_targets]

        detections = []
        annotated_frame = frame.copy()
        
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
        _, dets = self.process_frame(frame)
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
