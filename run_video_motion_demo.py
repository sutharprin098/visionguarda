import cv2
import time
import os
import sys

# Add server to sys.path
sys.path.append(os.path.join(os.path.dirname(__file__), 'server'))

from app.ai.screen_motion_detector import ScreenMicroMotionDetector

def run_video_demo(video_path="test_cctv_motion.mp4"):
    if not os.path.exists(video_path):
        print(f"[ERROR] Video file {video_path} not found!")
        return

    print("=" * 70)
    print(f"[START] Running CamAI Micro-Motion Engine on Test CCTV Video: {video_path}")
    print("Press 'q' in the video window to quit at any time.")
    print("=" * 70)

    # Initialize micro motion detector
    detector = ScreenMicroMotionDetector(
        min_area=12,
        max_area=15000,
        threshold_value=15,
        blur_kernel=(11, 11)
    )

    cap = cv2.VideoCapture(video_path)
    window_name = "CamAI Enterprise - Micro Motion Detection HUD"
    cv2.namedWindow(window_name, cv2.WINDOW_NORMAL)
    cv2.resizeWindow(window_name, 960, 540)

    while cap.isOpened():
        ret, frame = cap.read()
        if not ret:
            # Loop the video for continuous demonstration
            cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
            continue

        start_time = time.time()

        # Run detection
        detections = detector.detect(frame)

        # Draw HUD Bounding Boxes
        output_frame = frame.copy()
        for det in detections:
            bbox = det["bbox"]
            conf = det["confidence"]
            cls_name = det["class"]

            # Neon green bounding box
            x, y, w, h = bbox
            cv2.rectangle(output_frame, (x, y), (x + w, y + h), (0, 255, 64), 2)
            cv2.rectangle(output_frame, (x, y - 22), (x + 130, y), (0, 255, 64), -1)
            cv2.putText(output_frame, f"{cls_name.upper()} {conf:.2f}", (x + 4, y - 6),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 0, 0), 1, cv2.LINE_AA)

        # Header HUD Overlay
        fps = 1.0 / (time.time() - start_time + 1e-6)
        cv2.rectangle(output_frame, (10, 10), (380, 50), (0, 0, 0), -1)
        cv2.putText(output_frame, f"CamAI HUD | Detections: {len(detections)} | FPS: {fps:.1f}", (20, 35),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 255, 64), 2, cv2.LINE_AA)

        cv2.imshow(window_name, output_frame)

        # Slow down slightly to match normal video playback (~30fps)
        if cv2.waitKey(30) & 0xFF == ord('q'):
            break

    cap.release()
    cv2.destroyAllWindows()
    print("[STOP] Video demo completed.")

if __name__ == "__main__":
    run_video_demo()
