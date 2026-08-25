import cv2
import numpy as np
import sys
import os

sys.path.append(r"d:\camAI\server")
from app.ai.enhancer import zero_dce

user_img_path = r"C:\Users\Expert\.gemini\antigravity\brain\64b43b48-94a1-452e-9a53-18d12b2c0ab1\.tempmediaStorage\media_64b43b48-94a1-452e-9a53-18d12b2c0ab1_1787051749781.png"

if not os.path.exists(user_img_path):
    print("Error: user image file not found")
    sys.exit(1)

img = cv2.imread(user_img_path)
print(f"Loaded image size: {img.shape}")

# Calculate original mean luminance
orig_lum = zero_dce.calculate_luminance(img)
print(f"Original CCTV image luminance: {orig_lum:.1f}")

# Enhance with Zero-DCE
enhanced, stats = zero_dce.enhance(img, override_threshold=160.0, force_enable=True)
enh_lum = zero_dce.calculate_luminance(enhanced)
print(f"Enhanced CCTV image luminance: {enh_lum:.1f}")

artifact_dir = r"C:\Users\Expert\.gemini\antigravity\brain\64b43b48-94a1-452e-9a53-18d12b2c0ab1"

# 1. Save single enhanced output
out_single_path = os.path.join(artifact_dir, "zero_dce_cctv_ch5_enhanced.png")
cv2.imwrite(out_single_path, enhanced)

# 2. Save side-by-side visual comparison
h, w = img.shape[:2]
canvas = np.zeros((h + 60, w * 2 + 20, 3), dtype=np.uint8)

# Left: Original
canvas[50:50+h, :w] = img
cv2.putText(canvas, f"BEFORE (Raw Dark Feed - {orig_lum:.1f} lum)", (20, 35), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 255), 2)

# Right: Enhanced
canvas[50:50+h, w+20:] = enhanced
cv2.putText(canvas, f"AFTER (Zero-DCE Enhanced - {enh_lum:.1f} lum)", (w + 40, 35), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)

comp_path = os.path.join(artifact_dir, "cctv_ch5_before_after_comparison.jpg")
cv2.imwrite(comp_path, canvas)

print(f"Enhanced output saved to: {out_single_path}")
print(f"Comparison saved to: {comp_path}")
