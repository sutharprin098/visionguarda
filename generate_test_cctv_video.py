import cv2
import numpy as np
import time
import os

def create_sample_cctv_video(output_path="test_cctv_motion.mp4", duration_sec=10, fps=30):
    width, height = 960, 540
    fourcc = cv2.VideoWriter_fourcc(*'mp4v')
    out = cv2.VideoWriter(output_path, fourcc, fps, (width, height))

    print(f"[INFO] Generating realistic low-light CCTV test video: {output_path}")

    num_frames = duration_sec * fps
    
    # Base background (dark warehouse floor with grid pattern)
    bg = np.zeros((height, width, 3), dtype=np.uint8)
    bg[:, :] = (25, 28, 25) # Dark greenish IR CCTV tone
    
    # Add subtle static noise & background structures
    cv2.rectangle(bg, (100, 100), (300, 400), (35, 40, 35), -1) # Storage boxes
    cv2.rectangle(bg, (650, 80), (880, 480), (30, 35, 30), -1)  # Wall/door
    
    # Rodent trajectory (moving across floor from left to right)
    rx, ry = 150, 450
    
    # Insect trajectory (fluttering around top right)
    ix, iy = 700, 150

    for f in range(num_frames):
        frame = bg.copy()
        
        # 1. Simulate Rodent (Mouse/Rat) moving quickly across floor
        rx += 3.5 if f < 150 else -2.5
        ry += np.sin(f * 0.2) * 1.5
        r_x_int, r_y_int = int(rx), int(ry)
        # Bright high-contrast mouse on dark floor
        cv2.ellipse(frame, (r_x_int, r_y_int), (10, 6), 15, 0, 360, (220, 220, 220), -1)

        # 2. Simulate Insect/Moth fluttering around camera IR light
        ix += np.sin(f * 0.5) * 6
        iy += np.cos(f * 0.7) * 5
        i_x_int, i_y_int = int(ix), int(iy)
        cv2.circle(frame, (i_x_int, i_y_int), 4, (255, 255, 255), -1)

        # 3. Add timestamp overlay
        timestamp_str = f"CAM_04 NIGHT_IR  2026-08-25 02:14:{10 + (f // fps):02d}"
        cv2.putText(frame, timestamp_str, (20, 40), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (200, 200, 200), 1, cv2.LINE_AA)
        
        out.write(frame)

    out.release()
    print(f"[SUCCESS] CCTV test video generated: {output_path}")

if __name__ == "__main__":
    create_sample_cctv_video()
