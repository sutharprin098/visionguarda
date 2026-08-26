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
                 min_area: int = 4, 
                 max_area: int = 35000, 
                 threshold_value: int = 5, 
                 blur_kernel: Tuple[int, int] = (5, 5),
                 history_frames: int = 5):
        self.min_area = min_area
        self.max_area = max_area
        self.threshold_value = threshold_value
        self.blur_kernel = blur_kernel
        self.history_frames = history_frames
        
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
        
        # 1. Convert to grayscale and apply Gaussian blur to reduce high-frequency noise
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        blurred = cv2.GaussianBlur(gray, self.blur_kernel, 0)
        
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
        
        # 4. Dilate the thresholded image to fill in holes & merge close motion contours
        dilated = cv2.dilate(thresh, None, iterations=2)
        
        # 5. Find contours on motion mask
        contours, _ = cv2.findContours(dilated.copy(), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        
        detections = []
        annotated_frame = frame.copy()
        
        # Draw motion heatmap intensity highlight layer (subtle glowing effect)
        motion_heatmap = cv2.applyColorMap(cv2.convertScaleAbs(frame_delta, alpha=4.0), cv2.COLORMAP_JET)
        annotated_frame = cv2.addWeighted(annotated_frame, 0.85, motion_heatmap, 0.15, 0)

        for i, c in enumerate(contours):
            area = cv2.contourArea(c)
            if self.min_area <= area <= self.max_area:
                (x, y, bw, bh) = cv2.boundingRect(c)
                
                # Calculate relative motion intensity / confidence
                roi_delta = frame_delta[y:y+bh, x:x+bw]
                intensity = float(np.mean(roi_delta)) if roi_delta.size > 0 else 0.0
                confidence = min(1.0, max(0.2, intensity / 50.0))

                # Determine category tag based on bounding box size
                if area < 150:
                    tag = "Micro Motion (Rodent/Insect)"
                    color = (0, 255, 255) # Cyan
                elif area < 1500:
                    tag = "Subtle Motion (Bird/Bag)"
                    color = (0, 165, 255) # Orange
                else:
                    tag = "Object/Human Motion"
                    color = (0, 255, 0) # Bright Green

                det = {
                    "id": i + 1,
                    "box": [int(x), int(y), int(bw), int(bh)],
                    "area": int(area),
                    "confidence": round(confidence, 2),
                    "tag": tag,
                    "color": color
                }
                detections.append(det)

                # Draw high-visibility glowing bounding box
                cv2.rectangle(annotated_frame, (x, y), (x + bw, y + bh), color, 2)
                
                # Corner accents for sleek modern HUD UI
                line_len = min(bw // 4, bh // 4, 15)
                if line_len > 2:
                    cv2.line(annotated_frame, (x, y), (x + line_len, y), color, 3)
                    cv2.line(annotated_frame, (x, y), (x, y + line_len), color, 3)
                    cv2.line(annotated_frame, (x + bw, y), (x + bw - line_len, y), color, 3)
                    cv2.line(annotated_frame, (x + bw, y), (x + bw, y + line_len), color, 3)

                # Label background & text
                label = f"{tag} | {int(confidence*100)}%"
                (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.45, 1)
                cv2.rectangle(annotated_frame, (x, max(0, y - th - 6)), (x + tw + 6, max(th + 6, y)), (20, 20, 20), -1)
                cv2.putText(annotated_frame, label, (x + 3, max(th + 2, y - 4)), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (255, 255, 255), 1, cv2.LINE_AA)

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
