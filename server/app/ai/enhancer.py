"""
CamAI Zero-DCE (Zero-Reference Deep Curve Estimation) Night-Vision Enhancer

Zero-DCE adjusts low-light frame exposure dynamically using 8-stage light enhancement curves.
Boosts dark regions without over-saturating highlights or magnifying digital noise.
Paper & Repo: https://github.com/bsun0802/Zero-DCE
"""

import os
import cv2
import time
import threading
import numpy as np
from typing import Optional, Tuple, Dict, Any


class ZeroDCEEnhancer:
    """Zero-Reference Deep Curve Estimation for Low-Light / Night Vision CCTV & Drone feeds."""

    def __init__(self, model_path: Optional[str] = None):
        self.model_path = model_path
        self.onnx_session = None
        self.is_loaded = False
        self.enabled = True
        self.auto_mode = True
        self.threshold = 110.0  # Mean luminance threshold (0-255) for dark scene detection

        self.lock = threading.Lock()

        if model_path and os.path.exists(model_path):
            self.load_model(model_path)
        else:
            # Check default model location
            default_path = r"D:\CamAI-data\models\zero_dce.onnx"
            if os.path.exists(default_path):
                self.load_model(default_path)

    def load_model(self, model_path: str):
        """Loads ONNX weights for Zero-DCE neural network."""
        try:
            import onnxruntime as ort
            providers = ['CUDAExecutionProvider', 'CPUExecutionProvider']
            self.onnx_session = ort.InferenceSession(model_path, providers=providers)
            self.model_path = model_path
            self.is_loaded = True
            print(f"[Zero-DCE] Loaded neural curve estimation model from {model_path}", flush=True)
        except Exception as e:
            print(f"[Zero-DCE] ONNX load notice ({e}); using fast adaptive Zero-DCE curve solver fallback.", flush=True)
            self.is_loaded = False

    @staticmethod
    def calculate_luminance(frame: np.ndarray) -> float:
        """Computes mean frame luminance (0-255)."""
        if frame is None or frame.size == 0:
            return 128.0
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        return float(np.mean(gray))

    def _enhance_curves_lut(self, mean_lum: float, thresh: float, iterations: int = 8, target_lum: float = 160.0) -> np.ndarray:
        """
        Ultra-fast C-speed Lookup Table (LUT) solver for 8-stage Zero-DCE curve equation:
        LE_n(x) = LE_{n-1}(x) + A_n * LE_{n-1}(x) * (1 - LE_{n-1}(x))
        Executes in sub-millisecond time (<1ms) instead of multi-second full-frame matrix math.
        """
        lut_in = np.linspace(0.0, 1.0, 256, dtype=np.float32)
        mean_norm = mean_lum / 255.0
        
        # Calculate brightness deficit relative to healthy target (target_lum = 160.0)
        target = max(130.0, target_lum)
        deficit = max(0.45, (target - mean_lum) / target)
        
        # Adaptive parameter A curve
        alpha = 0.85 * deficit * (1.0 - mean_norm)
        a_lut = alpha * (1.0 - lut_in)
        
        enhanced_lut = lut_in.copy()
        for _ in range(iterations):
            enhanced_lut = enhanced_lut + a_lut * enhanced_lut * (1.0 - enhanced_lut)
        
        return (np.clip(enhanced_lut, 0.0, 1.0) * 255.0).astype(np.uint8)


    def enhance(
        self,
        frame: np.ndarray,
        override_threshold: Optional[float] = None,
        force_enable: bool = False
    ) -> Tuple[np.ndarray, Dict[str, Any]]:
        """
        Enhances a low-light frame using Zero-DCE.
        Returns: (enhanced_frame, telemetry_dict)
        """
        stats = {
            "zero_dce_applied": False,
            "mean_luminance": 128.0,
            "latency_ms": 0.0,
            "method": "none",
        }

        if frame is None or frame.size == 0 or not self.enabled:
            return frame, stats

        t0 = time.time()
        thresh = override_threshold if override_threshold is not None else self.threshold
        mean_lum = self.calculate_luminance(frame)
        stats["mean_luminance"] = round(mean_lum, 1)

        # In auto mode (when not forced ON), bypass if scene is brighter than dark threshold
        if not force_enable and self.auto_mode and mean_lum >= thresh:
            stats["latency_ms"] = round((time.time() - t0) * 1000.0, 2)
            return frame, stats


        with self.lock:
            # 1. Neural Zero-DCE inference if ONNX model is loaded
            if self.is_loaded and self.onnx_session:
                try:
                    h, w = frame.shape[:2]
                    # Resize to 256x256 for fast parameter estimation
                    small = cv2.resize(frame, (256, 256))
                    blob = small.astype(np.float32) / 255.0
                    blob = np.transpose(blob, (2, 0, 1))[None, ...]

                    input_name = self.onnx_session.get_inputs()[0].name
                    out = self.onnx_session.run(None, {input_name: blob})[0]

                    # Zero-DCE outputs 8 sets of 3-channel parameter maps
                    if out.shape[1] == 24:  # 8 iterations * 3 channels
                        a_maps = out[0]
                        orig_norm = frame.astype(np.float32) / 255.0
                        enhanced = orig_norm
                        for i in range(8):
                            a_i = cv2.resize(np.transpose(a_maps[i*3:(i+1)*3], (1, 2, 0)), (w, h))
                            enhanced = enhanced + a_i * enhanced * (1.0 - enhanced)
                        enhanced_bgr = np.clip(enhanced * 255.0, 0, 255).astype(np.uint8)
                        stats["zero_dce_applied"] = True
                        stats["method"] = "onnx_model"
                        stats["latency_ms"] = round((time.time() - t0) * 1000.0, 2)
                        return enhanced_bgr, stats
                except Exception as e:
                    print(f"[Zero-DCE] ONNX inference notice ({e}); using fast solver.", flush=True)

            # 2. Sub-millisecond LUT Zero-DCE curve transformation solver
            lut_8bit = self._enhance_curves_lut(mean_lum, thresh, iterations=8)
            enhanced_bgr = cv2.LUT(frame, lut_8bit)
            
            stats["zero_dce_applied"] = True
            stats["method"] = "lut_curve_solver"
            stats["latency_ms"] = round((time.time() - t0) * 1000.0, 2)
            return enhanced_bgr, stats



# Global Singleton Accessor
zero_dce = ZeroDCEEnhancer()
