import cv2
import numpy as np
import time
import os
import sys

# Try importing mss for ultra-fast screen capture, fallback to PIL ImageGrab
try:
    import mss
    HAS_MSS = True
except ImportError:
    HAS_MSS = False
    from PIL import ImageGrab

sys.path.append(os.path.join(os.path.dirname(__file__), 'server'))
from app.ai.screen_motion_detector import ScreenMicroMotionDetector

def run_live_overlay():
    print("=" * 70)
    print("[START] Launching CamAI Live Screen Micro-Motion Overlay Engine")
    print("[INFO] Target: Real-Time Screen Capture & CCTV Motion Highlight")
    print("[INFO] Press 'q' or 'ESC' in the overlay window to stop.")
    print("=" * 70)

    # Initialize micro motion detector (high sensitivity)
    detector = ScreenMicroMotionDetector(
        min_area=20,          # Micro motion capture (rodents, insects, birds)
        max_area=35000, 
        threshold_value=18,   # Low-light sensitivity threshold
        blur_kernel=(11, 11)
    )

    cv2.namedWindow("CamAI - Live Screen Motion HUD", cv2.WINDOW_NORMAL)
    cv2.resizeWindow("CamAI - Live Screen Motion HUD", 960, 540)

    if HAS_MSS:
        sct = mss.mss()
        # Capture primary monitor
        monitor = sct.monitors[1]
    
    fps_counter = 0
    start_time = time.time()
    last_fps_display = 30.0

    print("[STATUS] Live Screen Motion HUD is Running! Move your mouse or play a video...")

    try:
        while True:
            t0 = time.time()

            # Capture live screen frame
            if HAS_MSS:
                sct_img = sct.grab(monitor)
                frame = np.array(sct_img)
                frame = cv2.cvtColor(frame, cv2.COLOR_BGRA2BGR)
            else:
                img = ImageGrab.grab()
                frame = cv2.cvtColor(np.array(img), cv2.COLOR_RGB2BGR)

            # Resize frame for ultra-fast processing if resolution is huge (e.g. 4K/1080p)
            h, w = frame.shape[:2]
            target_w = 960
            scale = target_w / float(w)
            target_h = int(h * scale)
            resized_frame = cv2.resize(frame, (target_w, target_h), interpolation=cv2.INTER_LINEAR)

            # Process frame with micro motion detector
            annotated_frame, detections = detector.process_frame(resized_frame)

            # Add Live FPS & Detection Stats Banner
            fps_counter += 1
            if time.time() - start_time >= 1.0:
                last_fps_display = fps_counter / (time.time() - start_time)
                fps_counter = 0
                start_time = time.time()

            cv2.putText(annotated_frame, f"FPS: {last_fps_display:.1f} | Detections: {len(detections)}", 
                        (target_w - 240, 32), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 0), 1, cv2.LINE_AA)

            # Render overlay window
            cv2.imshow("CamAI - Live Screen Motion HUD", annotated_frame)

            # Break loop on 'q' or ESC key
            key = cv2.waitKey(1) & 0xFF
            if key in (ord('q'), 27):
                print("[INFO] Quitting Live Screen Overlay Engine...")
                break

    except Exception as e:
        print(f"[ERROR] Live capture error: {e}")
    finally:
        cv2.destroyAllWindows()
        print("[SHUTDOWN] Live Screen Overlay Engine Stopped Cleanly.")

if __name__ == "__main__":
    run_live_overlay()
