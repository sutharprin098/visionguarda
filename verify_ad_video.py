import cv2
import os
import imageio_ffmpeg
import subprocess

VIDEO_PATH = r"d:\camAI\videos\CamAI_60s_SaaS_Ad.mp4"
KEYFRAME_DIR = r"d:\camAI\videos\keyframes"

os.makedirs(KEYFRAME_DIR, exist_ok=True)

def verify_video_properties():
    print(f"Verifying properties of {VIDEO_PATH}...")
    cap = cv2.VideoCapture(VIDEO_PATH)
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    fps = cap.get(cv2.CAP_PROP_FPS)
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    duration = total_frames / fps if fps > 0 else 0
    size_mb = os.path.getsize(VIDEO_PATH) / (1024 * 1024)
    cap.release()
    
    print(f"  • Resolution: {width}x{height}")
    print(f"  • Framerate: {fps:.2f} FPS")
    print(f"  • Total Frames: {total_frames}")
    print(f"  • Exact Duration: {duration:.2f} seconds")
    print(f"  • File Size: {size_mb:.2f} MB")
    
    assert abs(duration - 60.0) < 0.5, f"Duration {duration:.2f}s is not ~60s"
    assert width == 1920 and height == 1080, f"Resolution {width}x{height} is not 1080p"
    print("SUCCESS: Video metadata matches specifications perfectly!")

def extract_keyframes():
    keyframes = [
        (4.0, "01_hook_night_cctv.jpg", "01. Hook - Night CCTV Feed"),
        (11.0, "02_problem_control_wall.jpg", "02. Problem - Operator Control Wall"),
        (18.0, "03_intro_dashboard_brand.jpg", "03. Intro - CamAI Dashboard Brand"),
        (25.0, "04_detection_bounding_boxes.jpg", "04. AI Detection - Cyan Bounding Boxes"),
        (29.0, "05_detection_restricted_zone.jpg", "05. AI Detection - Restricted Zone Intrusion"),
        (33.0, "06_detection_line_crossing.jpg", "06. AI Detection - Line Crossing"),
        (41.0, "07_monitoring_toast_alert.jpg", "07. Intelligent Monitoring - Toast Alert"),
        (49.0, "08_value_facility_mesh.jpg", "08. Business Value - Facility AI Mesh"),
        (57.0, "09_cta_final_screen.jpg", "09. Final CTA - Book A Demo")
    ]
    
    cap = cv2.VideoCapture(VIDEO_PATH)
    fps = cap.get(cv2.CAP_PROP_FPS)
    
    for sec, filename, label in keyframes:
        frame_no = int(sec * fps)
        cap.set(cv2.CAP_PROP_POS_FRAMES, frame_no)
        ret, frame = cap.read()
        if ret and frame is not None:
            out_path = os.path.join(KEYFRAME_DIR, filename)
            cv2.imwrite(out_path, frame)
            print(f"Extracted keyframe at {sec:04.1f}s ({label}) -> {out_path}")
            
    cap.release()

def create_verification_html():
    html_content = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>CamAI 60-Second SaaS Ad Commercial Verification</title>
  <style>
    body {
      background: #090d16;
      color: #f8fafc;
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      margin: 0;
      padding: 30px;
      text-align: center;
    }
    h1 {
      color: #00f0ff;
      font-size: 28px;
      margin-bottom: 5px;
    }
    p.sub {
      color: #94a3b8;
      font-size: 16px;
      margin-bottom: 25px;
    }
    .video-card {
      max-width: 1000px;
      margin: 0 auto 30px auto;
      background: #0f172a;
      border: 1px solid #00f0ff;
      border-radius: 12px;
      padding: 20px;
      box-shadow: 0 0 25px rgba(0, 240, 255, 0.15);
    }
    video {
      width: 100%;
      border-radius: 8px;
      outline: none;
    }
    .nav-buttons {
      margin-top: 15px;
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      justify-content: center;
    }
    button {
      background: #0284c7;
      color: #fff;
      border: none;
      padding: 10px 18px;
      border-radius: 6px;
      cursor: pointer;
      font-weight: bold;
      font-size: 14px;
      transition: all 0.2s ease;
    }
    button:hover {
      background: #00f0ff;
      color: #090d16;
      box-shadow: 0 0 10px #00f0ff;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 20px;
      max-width: 1200px;
      margin: 30px auto;
    }
    .grid-card {
      background: #0f172a;
      border: 1px solid #334155;
      border-radius: 8px;
      padding: 10px;
    }
    .grid-card img {
      width: 100%;
      border-radius: 6px;
    }
    .grid-card label {
      display: block;
      margin-top: 8px;
      color: #38bdf8;
      font-weight: bold;
      font-size: 14px;
    }
  </style>
</head>
<body>
  <h1>CamAI 60-Second Enterprise SaaS Commercial</h1>
  <p class="sub">4K-Quality Master Video Render • 1080p @ 30 FPS • Synchronized Neural Voiceover & Synth Soundtrack</p>
  
  <div class="video-card">
    <video id="adVideo" src="videos/CamAI_60s_SaaS_Ad.mp4" controls autoplay muted></video>
    <div class="nav-buttons">
      <button onclick="seekTo(1.5)">01. Hook (1.5s)</button>
      <button onclick="seekTo(8.5)">02. The Problem (8.5s)</button>
      <button onclick="seekTo(16.5)">03. Meet CamAI (16.5s)</button>
      <button onclick="seekTo(24.0)">04. Bounding Boxes (24.0s)</button>
      <button onclick="seekTo(28.5)">05. Restricted Zone (28.5s)</button>
      <button onclick="seekTo(32.0)">06. Line Crossing (32.0s)</button>
      <button onclick="seekTo(39.0)">07. Toast Alerts (39.0s)</button>
      <button onclick="seekTo(47.5)">08. AI Mesh Value (47.5s)</button>
      <button onclick="seekTo(54.0)">09. Final CTA (54.0s)</button>
    </div>
  </div>
  
  <script>
    const v = document.getElementById('adVideo');
    function seekTo(sec) {
      v.currentTime = sec;
      v.play();
    }
  </script>
</body>
</html>
"""
    html_path = r"d:\camAI\view_ad_video_60s.html"
    with open(html_path, "w", encoding="utf-8") as f:
        f.write(html_content)
    print(f"Created verification HTML preview page: {html_path}")

if __name__ == "__main__":
    verify_video_properties()
    extract_keyframes()
    create_verification_html()
