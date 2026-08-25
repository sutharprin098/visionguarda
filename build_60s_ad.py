import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageEnhance
import os
import subprocess
import time

# --- CONFIGURATION ---
WIDTH, HEIGHT = 1920, 1080
FPS = 30
TOTAL_FRAMES = 1800 # Exactly 60.0 seconds
OUTPUT_VIDEO = r"d:\camAI\videos\CamAI_60s_SaaS_Ad.mp4"
AUDIO_TRACK = r"d:\camAI\videos\audio_stems\final_ad_audio_60s.mp3"

# --- FONTS ---
def get_font(size, bold=False, mono=False):
    try:
        if mono:
            path = r"C:\Windows\Fonts\consola.ttf" if not bold else r"C:\Windows\Fonts\consolab.ttf"
        elif bold:
            path = r"C:\Windows\Fonts\segoeuib.ttf"
        else:
            path = r"C:\Windows\Fonts\segoeui.ttf"
        return ImageFont.truetype(path, size)
    except Exception:
        return ImageFont.load_default()

FONT_XL = get_font(52, bold=True)
FONT_LG = get_font(36, bold=True)
FONT_MD = get_font(24, bold=True)
FONT_SM = get_font(18, bold=False)
FONT_MONO_MD = get_font(22, bold=True, mono=True)
FONT_MONO_SM = get_font(16, bold=False, mono=True)
FONT_BRAND = get_font(64, bold=True)
FONT_TAGLINE = get_font(26, bold=False)

# --- VIDEO SOURCES ---
SRC_HUMANS = r"d:\camAI\portal\public\videos\humans.mp4"
SRC_JUNCTION = r"d:\camAI\portal\public\videos\junction.mp4"
SRC_SPEED = r"d:\camAI\portal\public\videos\speed.mp4"
SRC_DRONE = r"d:\camAI\drone_test_video.mp4"

class VideoStreamPool:
    def __init__ (self):
        self.caps = {}
        for key, path in [("humans", SRC_HUMANS), ("junction", SRC_JUNCTION), ("speed", SRC_SPEED), ("drone", SRC_DRONE)]:
            if os.path.exists(path):
                self.caps[key] = cv2.VideoCapture(path)
            else:
                self.caps[key] = None

    def get_frame(self, key, frame_num):
        cap = self.caps.get(key)
        if cap is None or not cap.isOpened():
            # Generate synthetic fallback noise / pattern
            img = np.zeros((HEIGHT, WIDTH, 3), dtype=np.uint8)
            cv2.putText(img, f"FEED: {key.upper()}", (100, 100), cv2.FONT_HERSHEY_SIMPLEX, 1.5, (0, 240, 255), 2)
            return img
        
        total_f = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        if total_f > 0:
            cap.set(cv2.CAP_PROP_POS_FRAMES, (frame_num * 2) % total_f)
        ret, frame = cap.read()
        if not ret or frame is None:
            cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
            ret, frame = cap.read()
        
        if ret and frame is not None:
            return cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        
        img = np.zeros((HEIGHT, WIDTH, 3), dtype=np.uint8)
        return img

# --- HELPER COMPOSITING FUNCTIONS ---

def draw_cctv_hud(draw, cam_id, location, timestamp_str, is_rec=True):
    # Scanline & HUD text overlay
    draw.rectangle([30, 30, 350, 75], fill=(15, 23, 42, 200), outline=(56, 189, 248, 120))
    draw.ellipse([45, 47, 57, 59], fill=(239, 68, 68) if is_rec else (100, 116, 139))
    draw.text((68, 43), f"REC • {cam_id}", font=FONT_MONO_MD, fill=(255, 255, 255))
    
    # Location tag
    draw.rectangle([30, HEIGHT - 70, 380, HEIGHT - 30], fill=(15, 23, 42, 200), outline=(56, 189, 248, 120))
    draw.text((45, HEIGHT - 60), f"LOC: {location}", font=FONT_MONO_SM, fill=(148, 163, 184))
    
    # Timestamp top right
    draw.rectangle([WIDTH - 360, 30, WIDTH - 30, 75], fill=(15, 23, 42, 200), outline=(56, 189, 248, 120))
    draw.text((WIDTH - 345, 43), timestamp_str, font=FONT_MONO_MD, fill=(0, 240, 255))

def draw_ai_bbox(draw, box, label, track_id=None, color=(0, 240, 255), conf=0.98):
    x1, y1, x2, y2 = box
    # Corner ticks style bounding box
    t = 4
    l_len = min(25, (x2 - x1) // 3)
    # Box outline
    draw.rectangle([x1, y1, x2, y2], outline=color, width=2)
    # Corner highlights
    draw.line([x1, y1, x1 + l_len, y1], fill=color, width=t)
    draw.line([x1, y1, x1, y1 + l_len], fill=color, width=t)
    draw.line([x2, y1, x2 - l_len, y1], fill=color, width=t)
    draw.line([x2, y1, x2, y1 + l_len], fill=color, width=t)
    draw.line([x1, y2, x1 + l_len, y2], fill=color, width=t)
    draw.line([x1, y2, x1, y2 - l_len], fill=color, width=t)
    draw.line([x2, y2, x2 - l_len, y2], fill=color, width=t)
    draw.line([x2, y2, x2, y2 - l_len], fill=color, width=t)
    
    # Label pill
    tag_str = f"{label} #{track_id}" if track_id else f"{label} [{int(conf*100)}%]"
    bbox_txt = FONT_MONO_SM.getbbox(tag_str)
    tw, th = bbox_txt[2] - bbox_txt[0], bbox_txt[3] - bbox_txt[1]
    
    draw.rectangle([x1, max(0, y1 - 28), x1 + tw + 16, y1], fill=(15, 23, 42, 230), outline=color)
    draw.text((x1 + 8, max(0, y1 - 24)), tag_str, font=FONT_MONO_SM, fill=(255, 255, 255))

def render_dashboard_shell(pil_img, active_nav="Live View", alert_count=3, intrusion_count=1, people_count=24):
    draw = ImageDraw.Draw(pil_img, "RGBA")
    
    # Sidebar
    draw.rectangle([0, 0, 240, HEIGHT], fill=(11, 15, 25, 245), outline=(30, 41, 59, 180))
    
    # CamAI Brand Logo Top Left
    draw.rectangle([20, 20, 52, 52], fill=(2, 132, 199), outline=(0, 240, 255))
    draw.polygon([(36, 26), (46, 44), (26, 44)], fill=(255, 255, 255))
    draw.text((64, 23), "CamAI", font=FONT_LG, fill=(255, 255, 255))
    draw.text((64, 55), "ENTERPRISE v4.8", font=FONT_MONO_SM, fill=(0, 240, 255))
    
    # Nav Items
    nav_items = [("Dashboard", 110), ("Live View", 160), ("Cameras (18)", 210), ("Alerts & Logs", 260), ("Analytics", 310), ("Zone Profile", 360), ("Settings", 410)]
    for name, y in nav_items:
        is_active = (name == active_nav)
        bg_col = (14, 165, 233, 40) if is_active else (0, 0, 0, 0)
        txt_col = (0, 240, 255) if is_active else (148, 163, 184)
        if is_active:
            draw.rectangle([0, y - 5, 6, y + 30], fill=(0, 240, 255))
        draw.rectangle([15, y - 5, 225, y + 30], fill=bg_col)
        draw.text((30, y), name, font=FONT_SM if not is_active else FONT_MD, fill=txt_col)

    # System Status Pill Bottom Sidebar
    draw.rectangle([15, HEIGHT - 90, 225, HEIGHT - 30], fill=(15, 23, 42, 230), outline=(56, 189, 248, 80))
    draw.ellipse([25, HEIGHT - 70, 35, HEIGHT - 60], fill=(34, 197, 94))
    draw.text((42, HEIGHT - 73), "ENGINE ACTIVE", font=FONT_MONO_SM, fill=(34, 197, 94))
    draw.text((42, HEIGHT - 53), "Latency: 14ms", font=FONT_MONO_SM, fill=(148, 163, 184))

    # Top Bar
    draw.rectangle([240, 0, WIDTH, 75], fill=(15, 23, 42, 235), outline=(30, 41, 59, 180))
    draw.text((270, 22), "Multi-Camera Intelligence Matrix", font=FONT_LG, fill=(255, 255, 255))
    
    # Top Telemetry Cards
    metrics = [
        ("PEOPLE DETECTED", f"{people_count:02d}", (0, 240, 255)),
        ("ACTIVE CAMERAS", "18/18", (56, 189, 248)),
        ("SYSTEM ALERTS", f"{alert_count:02d}", (245, 158, 11)),
        ("INTRUSIONS", f"{intrusion_count:02d}", (239, 68, 68) if intrusion_count > 0 else (34, 197, 94))
    ]
    card_w = 210
    start_x = 950
    for idx, (title, val, col) in enumerate(metrics):
        cx = start_x + idx * (card_w + 15)
        draw.rectangle([cx, 12, cx + card_w, 63], fill=(30, 41, 59, 200), outline=col)
        draw.text((cx + 12, 16), title, font=FONT_MONO_SM, fill=(148, 163, 184))
        draw.text((cx + 12, 33), val, font=FONT_MD, fill=col)

def draw_toast_notification(pil_img, t_progress):
    # Slide in from right (t_progress 0.0 to 1.0)
    draw = ImageDraw.Draw(pil_img, "RGBA")
    card_w, card_h = 440, 110
    end_x = WIDTH - 460
    start_x = WIDTH + 20
    
    # Smooth ease out
    cur_x = int(start_x + (end_x - start_x) * min(1.0, t_progress * 1.5))
    cur_y = 90
    
    # Card Background with Red Alarm Border Glow
    draw.rectangle([cur_x, cur_y, cur_x + card_w, cur_y + card_h], fill=(15, 23, 42, 245), outline=(239, 68, 68, 220), width=2)
    # Header strip
    draw.rectangle([cur_x, cur_y, cur_x + card_w, cur_y + 32], fill=(239, 68, 68, 40))
    draw.rectangle([cur_x + 12, cur_y + 8, cur_x + 28, cur_y + 24], fill=(239, 68, 68))
    draw.text((cur_x + 16, cur_y + 7), "!", font=FONT_MD, fill=(255, 255, 255))
    draw.text((cur_x + 36, cur_y + 7), "CamAI REAL-TIME ALERT", font=FONT_MD, fill=(239, 68, 68))
    draw.text((cur_x + card_w - 70, cur_y + 9), "JUST NOW", font=FONT_MONO_SM, fill=(148, 163, 184))
    
    # Body text
    draw.text((cur_x + 16, cur_y + 40), "Restricted zone intrusion detected", font=FONT_MD, fill=(255, 255, 255))
    draw.text((cur_x + 16, cur_y + 72), "Location: North Gate • Camera 07", font=FONT_SM, fill=(148, 163, 184))

# --- MAIN GENERATOR FUNCTION ---
def render_ad_frames():
    os.makedirs(r"d:\camAI\videos", exist_ok=True)
    pool = VideoStreamPool()
    
    # Setup FFmpeg output pipe
    import imageio_ffmpeg
    ffmpeg_exe = imageio_ffmpeg.get_ffmpeg_exe()
    
    cmd = [
        ffmpeg_exe, "-y",
        "-f", "rawvideo",
        "-vcodec", "rawvideo",
        "-s", f"{WIDTH}x{HEIGHT}",
        "-pix_fmt", "rgb24",
        "-r", str(FPS),
        "-i", "-", # input from stdin
        "-i", AUDIO_TRACK, # input audio
        "-c:v", "libx264",
        "-preset", "medium",
        "-crf", "18",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        "-b:a", "192k",
        "-shortest",
        OUTPUT_VIDEO
    ]
    
    print(f"Starting video encoding pipe to {OUTPUT_VIDEO}...")
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    
    start_time = time.time()
    
    for f_idx in range(TOTAL_FRAMES):
        t_sec = f_idx / float(FPS)
        
        # Base frame container (RGB)
        frame_canvas = np.zeros((HEIGHT, WIDTH, 3), dtype=np.uint8)
        pil_frame = Image.fromarray(frame_canvas)
        draw = ImageDraw.Draw(pil_frame, "RGBA")
        
        # =========================================================================
        # SEGMENT 1: 0–7 sec — HOOK
        # Night exterior CCTV multi-camera rapid cuts + "YOUR CAMERAS SEE EVERYTHING"
        # =========================================================================
        if t_sec < 7.0:
            # Rapid camera grid cuts every 1.75s
            cut_id = int(t_sec / 1.75) % 3
            cam_src_key = ["humans", "junction", "speed"][cut_id]
            cam_num_str = f"CAM-0{cut_id + 1}"
            cam_loc_str = ["NORTH FACTORY EXTERIOR", "MAIN ENTRANCE GATE", "PERIMETER FENCE WEST"][cut_id]
            
            vid_frame = pool.get_frame(cam_src_key, f_idx)
            vid_frame = cv2.resize(vid_frame, (WIDTH, HEIGHT))
            
            # Apply CCTV night/contrast filter & scanlines
            vid_frame = cv2.addWeighted(vid_frame, 0.75, np.zeros_like(vid_frame), 0, -20)
            pil_frame = Image.fromarray(vid_frame)
            draw = ImageDraw.Draw(pil_frame, "RGBA")
            
            # Scanlines overlay
            for y_line in range(0, HEIGHT, 6):
                draw.line([(0, y_line), (WIDTH, y_line)], fill=(0, 0, 0, 40))
                
            draw_cctv_hud(draw, cam_num_str, cam_loc_str, f"2026-08-23 23:14:{int(t_sec)%60:02d}.{f_idx%30:02d}")
            
            # On-Screen Text Overlay (02.5s - 06.8s)
            if t_sec >= 2.0:
                txt_alpha = min(255, int((t_sec - 2.0) * 300))
                # Text backdrop banner
                draw.rectangle([0, HEIGHT//2 - 90, WIDTH, HEIGHT//2 + 90], fill=(9, 13, 22, min(220, txt_alpha)))
                draw.line([(0, HEIGHT//2 - 90), (WIDTH, HEIGHT//2 - 90)], fill=(0, 240, 255, min(255, txt_alpha)), width=2)
                draw.line([(0, HEIGHT//2 + 90), (WIDTH, HEIGHT//2 + 90)], fill=(0, 240, 255, min(255, txt_alpha)), width=2)
                
                txt = "YOUR CAMERAS SEE EVERYTHING."
                txt_bbox = FONT_BRAND.getbbox(txt)
                tw = txt_bbox[2] - txt_bbox[0]
                draw.text(((WIDTH - tw)//2, HEIGHT//2 - 40), txt, font=FONT_BRAND, fill=(255, 255, 255, txt_alpha))
                draw.text(((WIDTH - tw)//2 + 2, HEIGHT//2 - 38), txt, font=FONT_BRAND, fill=(0, 240, 255, min(100, txt_alpha)))

        # =========================================================================
        # SEGMENT 2: 7–15 sec — THE PROBLEM
        # Operator control room video wall (4-grid feeds) + dense timeline scrubber
        # =========================================================================
        elif t_sec < 15.0:
            # Render 2x2 grid of CCTV monitors
            gw, gh = (WIDTH - 60) // 2, (HEIGHT - 180) // 2
            feeds = [("humans", "CAM-01", "FACILITY NORTH"), ("junction", "CAM-02", "EAST GATEWAY"), 
                     ("speed", "CAM-03", "MAIN ACCESS ROAD"), ("drone", "CAM-04", "WAREHOUSE ROOFTOP")]
            
            positions = [(20, 80), (40 + gw, 80), (20, 100 + gh), (40 + gw, 100 + gh)]
            
            for idx, (fkey, cname, cloc) in enumerate(feeds):
                px, py = positions[idx]
                f_raw = pool.get_frame(fkey, f_idx)
                f_resized = cv2.resize(f_raw, (gw, gh))
                
                # Draw monitor window
                pil_frame.paste(Image.fromarray(f_resized), (px, py))
                draw.rectangle([px, py, px + gw, py + gh], outline=(56, 189, 248, 120), width=2)
                draw.text((px + 15, py + 15), f"REC • {cname} [{cloc}]", font=FONT_MONO_SM, fill=(0, 240, 255))
            
            # Bottom dense timeline scrubber (hours of footage)
            draw.rectangle([20, HEIGHT - 85, WIDTH - 20, HEIGHT - 20], fill=(15, 23, 42, 240), outline=(56, 189, 248, 100))
            draw.text((35, HEIGHT - 75), "TIMELINE RECORDER (24h ARCHIVE)", font=FONT_MONO_SM, fill=(148, 163, 184))
            
            # Draw timeline bars and red unread warning spikes
            t_bar_x1, t_bar_x2 = 260, WIDTH - 40
            draw.line([(t_bar_x1, HEIGHT - 48), (t_bar_x2, HEIGHT - 48)], fill=(51, 65, 85), width=12)
            
            # Animated scrubber playhead
            scrub_x = t_bar_x1 + int((t_bar_x2 - t_bar_x1) * ((t_sec - 7.0) / 8.0))
            draw.line([(t_bar_x1, HEIGHT - 48), (scrub_x, HEIGHT - 48)], fill=(0, 240, 255), width=12)
            draw.rectangle([scrub_x - 4, HEIGHT - 65, scrub_x + 4, HEIGHT - 30], fill=(239, 68, 68))
            
            # Add yellow/red event indicators on timeline
            for sp in [320, 480, 620, 850, 1100, 1350, 1500]:
                draw.rectangle([sp - 2, HEIGHT - 58, sp + 2, HEIGHT - 38], fill=(239, 68, 68))
                
            # Text overlay: "Too many cameras. Too much footage."
            if t_sec >= 9.0:
                txt = "Too many cameras. Too much footage."
                draw.rectangle([0, HEIGHT//2 - 60, WIDTH, HEIGHT//2 + 60], fill=(9, 13, 22, 230))
                draw.line([(0, HEIGHT//2 - 60), (WIDTH, HEIGHT//2 - 60)], fill=(239, 68, 68), width=2)
                draw.line([(0, HEIGHT//2 + 60), (WIDTH, HEIGHT//2 + 60)], fill=(239, 68, 68), width=2)
                
                tb = FONT_XL.getbbox(txt)
                tw = tb[2] - tb[0]
                draw.text(((WIDTH - tw)//2, HEIGHT//2 - 30), txt, font=FONT_XL, fill=(255, 255, 255))

        # =========================================================================
        # SEGMENT 3: 15–22 sec — INTRODUCE CAMAI
        # Smooth transition into dark SaaS dashboard + Logo & "AI Video Intelligence"
        # =========================================================================
        elif t_sec < 22.0:
            # Transition background (Dark sleek SaaS gradient canvas)
            bg_gradient = np.zeros((HEIGHT, WIDTH, 3), dtype=np.uint8)
            cv2.rectangle(bg_gradient, (0, 0), (WIDTH, HEIGHT), (9, 13, 22), -1)
            pil_frame = Image.fromarray(bg_gradient)
            
            render_dashboard_shell(pil_frame, active_nav="Dashboard", alert_count=0, intrusion_count=0, people_count=0)
            draw = ImageDraw.Draw(pil_frame, "RGBA")
            
            # Central Brand Reveal Card
            box_w, box_h = 760, 320
            bx, by = (WIDTH - box_w)//2 + 100, (HEIGHT - box_h)//2
            
            # Card background
            draw.rectangle([bx, by, bx + box_w, by + box_h], fill=(15, 23, 42, 250), outline=(0, 240, 255, 200), width=2)
            
            # Glowing logo icon
            draw.rectangle([bx + box_w//2 - 40, by + 40, bx + box_w//2 + 40, by + 120], fill=(2, 132, 199), outline=(0, 240, 255), width=3)
            draw.polygon([(bx + box_w//2, by + 52), (bx + box_w//2 + 24, by + 104), (bx + box_w//2 - 24, by + 104)], fill=(255, 255, 255))
            
            # Text
            b_txt = "CamAI"
            btb = FONT_BRAND.getbbox(b_txt)
            btw = btb[2] - btb[0]
            draw.text((bx + (box_w - btw)//2, by + 140), b_txt, font=FONT_BRAND, fill=(255, 255, 255))
            
            sub_txt = "AI Video Intelligence Platform"
            stb = FONT_LG.getbbox(sub_txt)
            stw = stb[2] - stb[0]
            draw.text((bx + (box_w - stw)//2, by + 230), sub_txt, font=FONT_LG, fill=(0, 240, 255))
            
            # Expanding glowing divider
            t_expand = min(1.0, (t_sec - 15.0) / 3.0)
            div_w = int(btw * t_expand)
            draw.line([(bx + (box_w - div_w)//2, by + 215), (bx + (box_w + div_w)//2, by + 215)], fill=(0, 240, 255), width=4)

        # =========================================================================
        # SEGMENT 4: 22–35 sec — AI DETECTION
        # Live CCTV inside dashboard frame with Cyan Bounding Boxes, Restricted Zone Intrusion, Line Crossing
        # =========================================================================
        elif t_sec < 35.0:
            # Base Dashboard Frame
            render_dashboard_shell(pil_frame, active_nav="Live View", alert_count=3, intrusion_count=1, people_count=24)
            draw = ImageDraw.Draw(pil_frame, "RGBA")
            
            # Camera Viewport Container
            vx1, vy1, vx2, vy2 = 270, 90, WIDTH - 40, HEIGHT - 40
            vw, vh = vx2 - vx1, vy2 - vy1
            
            # Select sub-clip feature based on timestamp
            if t_sec < 27.0:
                # 22-27s: Multiple Person Detection & Tracking
                f_raw = pool.get_frame("humans", f_idx)
                f_resized = cv2.resize(f_raw, (vw, vh))
                pil_frame.paste(Image.fromarray(f_resized), (vx1, vy1))
                draw = ImageDraw.Draw(pil_frame, "RGBA")
                
                # Draw live AI Bounding Boxes (Person 1, 2, 3)
                shift = int((f_idx % 120) * 1.5)
                bboxes = [
                    ([vx1 + 200 + shift, vy1 + 180, vx1 + 340 + shift, vy1 + 460], "PERSON DETECTED", 1042, (0, 240, 255)),
                    ([vx1 + 520 - shift//2, vy1 + 220, vx1 + 640 - shift//2, vy1 + 490], "PERSON DETECTED", 1043, (0, 240, 255)),
                    ([vx1 + 800 + shift//3, vy1 + 150, vx1 + 920 + shift//3, vy1 + 420], "PERSON DETECTED", 1044, (0, 240, 255))
                ]
                for box, lbl, tid, col in bboxes:
                    draw_ai_bbox(draw, box, lbl, track_id=tid, color=col)
                    
                # Status Pill Overlay
                draw.rectangle([vx1 + 30, vy1 + 30, vx1 + 380, vy1 + 75], fill=(15, 23, 42, 230), outline=(0, 240, 255))
                draw.text((vx1 + 45, vy1 + 42), "TRACKING ACTIVE • 3 PEOPLE", font=FONT_MONO_MD, fill=(0, 240, 255))
                
            elif t_sec < 31.0:
                # 27-31s: Restricted Zone Intrusion Detection
                f_raw = pool.get_frame("junction", f_idx)
                f_resized = cv2.resize(f_raw, (vw, vh))
                pil_frame.paste(Image.fromarray(f_resized), (vx1, vy1))
                draw = ImageDraw.Draw(pil_frame, "RGBA")
                
                # Render Restricted Zone Polygon with Red Hatching
                zone_pts = [(vx1 + 400, vy1 + 200), (vx1 + 900, vy1 + 200), (vx1 + 1100, vy1 + 600), (vx1 + 350, vy1 + 600)]
                draw.polygon(zone_pts, fill=(239, 68, 68, 60), outline=(239, 68, 68, 220))
                draw.text((vx1 + 420, vy1 + 220), "RESTRICTED ZONE B-04", font=FONT_MONO_MD, fill=(239, 68, 68))
                
                # Person stepping in
                px1 = vx1 + 580 + int(np.sin(t_sec*3)*30)
                py1 = vy1 + 300
                draw_ai_bbox(draw, [px1, py1, px1 + 130, py1 + 260], "INTRUDER", track_id=8801, color=(239, 68, 68))
                
                # Intrusion Warning Banner
                is_flash = (int(t_sec * 6) % 2 == 0)
                banner_col = (239, 68, 68, 240) if is_flash else (185, 28, 28, 240)
                draw.rectangle([vx1 + 30, vy1 + 30, vx1 + 480, vy1 + 80], fill=banner_col)
                draw.text((vx1 + 45, vy1 + 45), "[!] RESTRICTED ZONE INTRUSION", font=FONT_MONO_MD, fill=(255, 255, 255))
                
            else:
                # 31-35s: Virtual Line Crossing Detection
                f_raw = pool.get_frame("speed", f_idx)
                f_resized = cv2.resize(f_raw, (vw, vh))
                pil_frame.paste(Image.fromarray(f_resized), (vx1, vy1))
                draw = ImageDraw.Draw(pil_frame, "RGBA")
                
                # Render Tripwire Virtual Line
                line_y = vy1 + 350
                draw.line([(vx1 + 100, line_y), (vx1 + vw - 100, line_y)], fill=(0, 240, 255, 240), width=4)
                draw.text((vx1 + 120, line_y - 30), "TRIPWIRE LINE #01 [INBOUND]", font=FONT_MONO_SM, fill=(0, 240, 255))
                
                # Vehicle / Object crossing line
                vx_x = vx1 + 300 + int((t_sec - 31.0) * 180)
                draw_ai_bbox(draw, [vx_x, line_y - 120, vx_x + 220, line_y + 80], "VEHICLE DETECTED", track_id=402, color=(0, 240, 255))
                
                # Line Crossing Banner
                draw.rectangle([vx1 + 30, vy1 + 30, vx1 + 450, vy1 + 80], fill=(15, 23, 42, 230), outline=(0, 240, 255))
                draw.text((vx1 + 45, vy1 + 45), "LINE CROSSING DETECTED", font=FONT_MONO_MD, fill=(0, 240, 255))
                
            # Outline Viewport Container
            draw.rectangle([vx1, vy1, vx2, vy2], outline=(56, 189, 248, 150), width=2)

        # =========================================================================
        # SEGMENT 5: 35–45 sec — INTELLIGENT MONITORING
        # Dashboard multi-camera grid (4 feeds) + animated metric counters & Toast Notification
        # =========================================================================
        elif t_sec < 45.0:
            # Metrics count animation over time (35s -> 45s)
            cur_people = min(24, 12 + int((t_sec - 35.0) * 1.2))
            cur_alerts = 3
            cur_intrusions = 1
            
            render_dashboard_shell(pil_frame, active_nav="Live View", alert_count=cur_alerts, intrusion_count=cur_intrusions, people_count=cur_people)
            draw = ImageDraw.Draw(pil_frame, "RGBA")
            
            # 2x2 Camera Grid inside dashboard
            vx1, vy1, vx2, vy2 = 270, 90, WIDTH - 40, HEIGHT - 40
            gw, gh = (vx2 - vx1 - 20) // 2, (vy2 - vy1 - 20) // 2
            
            grid_cams = [("humans", "CAM-01 [NORTH GATE]", [150, 120, 280, 320]),
                         ("junction", "CAM-07 [RESTRICTED PERIMETER]", [220, 100, 380, 280]),
                         ("speed", "CAM-12 [MAIN DRIVE]", [300, 140, 480, 290]),
                         ("drone", "CAM-18 [ROOFTOP FACILITY]", [100, 80, 260, 220])]
                         
            coords = [(vx1, vy1), (vx1 + gw + 20, vy1), (vx1, vy1 + gh + 20), (vx1 + gw + 20, vy1 + gh + 20)]
            
            for idx, (fkey, clabel, bbox_coords) in enumerate(grid_cams):
                cx, cy = coords[idx]
                f_raw = pool.get_frame(fkey, f_idx)
                f_resized = cv2.resize(f_raw, (gw, gh))
                pil_frame.paste(Image.fromarray(f_resized), (cx, cy))
                
                # Redraw UI outline for each cell
                draw.rectangle([cx, cy, cx + gw, cy + gh], outline=(56, 189, 248, 120), width=2)
                draw.rectangle([cx + 10, cy + 10, cx + 240, cy + 40], fill=(15, 23, 42, 220))
                draw.text((cx + 18, cy + 17), clabel, font=FONT_MONO_SM, fill=(0, 240, 255))
                
                # Draw bounding box inside each feed
                bx1, by1, bx2, by2 = bbox_coords
                draw_ai_bbox(draw, [cx + bx1, cy + by1, cx + bx2, cy + by2], "TARGET", track_id=100 + idx, color=(0, 240, 255) if idx != 1 else (239, 68, 68))

            # Toast Notification Popup appearing at t=39.0s
            if t_sec >= 38.5:
                t_toast = (t_sec - 38.5) / 1.5
                draw_toast_notification(pil_frame, t_toast)

        # =========================================================================
        # SEGMENT 6: 45–53 sec — BUSINESS VALUE
        # Cinematic aerial facility / warehouse footage + subtle AI network mesh overlay + "YOUR CAMERAS. NOW INTELLIGENT."
        # =========================================================================
        elif t_sec < 53.0:
            f_raw = pool.get_frame("drone", f_idx)
            f_resized = cv2.resize(f_raw, (WIDTH, HEIGHT))
            
            # Dark tech grading
            f_resized = cv2.addWeighted(f_resized, 0.65, np.zeros_like(f_resized), 0, -10)
            pil_frame = Image.fromarray(f_resized)
            draw = ImageDraw.Draw(pil_frame, "RGBA")
            
            # Overlay Futuristic AI Mesh Network Nodes over facility
            nodes = [
                (350, 280), (600, 340), (950, 220), (1350, 310), (1600, 450),
                (450, 650), (820, 720), (1200, 680), (1500, 780)
            ]
            
            # Draw interconnecting cyan data lines
            for i, n1 in enumerate(nodes):
                for j, n2 in enumerate(nodes[i+1:], start=i+1):
                    dist = np.hypot(n1[0] - n2[0], n1[1] - n2[1])
                    if dist < 450:
                        alpha = int(max(0, 180 - (dist / 450.0) * 180))
                        draw.line([n1, n2], fill=(0, 240, 255, alpha), width=2)
                        
            # Draw glowing camera node markers
            for idx, (nx, ny) in enumerate(nodes):
                draw.ellipse([nx - 10, ny - 10, nx + 10, ny + 10], fill=(2, 132, 199, 200), outline=(0, 240, 255), width=2)
                draw.ellipse([nx - 4, ny - 4, nx + 4, ny + 4], fill=(255, 255, 255))
                draw.text((nx + 14, ny - 10), f"CAM-NODE #{idx+1:02d}", font=FONT_MONO_SM, fill=(0, 240, 255))

            # On-Screen Text Overlay: "YOUR CAMERAS. NOW INTELLIGENT." (t=47.5s onwards)
            if t_sec >= 47.0:
                draw.rectangle([0, HEIGHT//2 - 100, WIDTH, HEIGHT//2 + 100], fill=(9, 13, 22, 230))
                draw.line([(0, HEIGHT//2 - 100), (WIDTH, HEIGHT//2 - 100)], fill=(0, 240, 255), width=3)
                draw.line([(0, HEIGHT//2 + 100), (WIDTH, HEIGHT//2 + 100)], fill=(0, 240, 255), width=3)
                
                t1 = "YOUR CAMERAS."
                t2 = "NOW INTELLIGENT."
                
                tb1 = FONT_BRAND.getbbox(t1)
                tw1 = tb1[2] - tb1[0]
                tb2 = FONT_BRAND.getbbox(t2)
                tw2 = tb2[2] - tb2[0]
                
                draw.text(((WIDTH - tw1)//2, HEIGHT//2 - 75), t1, font=FONT_BRAND, fill=(255, 255, 255))
                draw.text(((WIDTH - tw2)//2, HEIGHT//2 + 5), t2, font=FONT_BRAND, fill=(0, 240, 255))

        # =========================================================================
        # SEGMENT 7: 53–60 sec — FINAL CTA
        # Dark premium CamAI dashboard background, Logo animation, Tagline, and CTA Button "BOOK A DEMO"
        # =========================================================================
        else:
            # Premium dark radial gradient background
            bg_gradient = np.zeros((HEIGHT, WIDTH, 3), dtype=np.uint8)
            cv2.rectangle(bg_gradient, (0, 0), (WIDTH, HEIGHT), (9, 13, 22), -1)
            pil_frame = Image.fromarray(bg_gradient)
            draw = ImageDraw.Draw(pil_frame, "RGBA")
            
            # Subtle gridlines background
            for gx in range(0, WIDTH, 60):
                draw.line([(gx, 0), (gx, HEIGHT)], fill=(30, 41, 59, 50))
            for gy in range(0, HEIGHT, 60):
                draw.line([(0, gy), (WIDTH, gy)], fill=(30, 41, 59, 50))
                
            # Central Emblem & Brand Callout
            cx, cy = WIDTH // 2, HEIGHT // 2 - 110
            
            # Glowing logo icon
            draw.rectangle([cx - 50, cy - 50, cx + 50, cy + 50], fill=(2, 132, 199), outline=(0, 240, 255), width=4)
            draw.polygon([(cx, cy - 30), (cx + 30, cy + 30), (cx - 30, cy + 30)], fill=(255, 255, 255))
            
            # Brand Name: CamAI
            b_txt = "CamAI"
            btb = FONT_BRAND.getbbox(b_txt)
            btw = btb[2] - btb[0]
            draw.text((cx - btw//2, cy + 70), b_txt, font=FONT_BRAND, fill=(255, 255, 255))
            
            # Subtitle: AI-Powered Video Intelligence
            s_txt = "AI-Powered Video Intelligence"
            stb = FONT_LG.getbbox(s_txt)
            stw = stb[2] - stb[0]
            draw.text((cx - stw//2, cy + 160), s_txt, font=FONT_LG, fill=(0, 240, 255))
            
            # Pillar badges: "Monitor. Detect. Track. Respond."
            p_txt = "Monitor  •  Detect  •  Track  •  Respond"
            ptb = FONT_MD.getbbox(p_txt)
            ptw = ptb[2] - ptb[0]
            draw.rectangle([cx - ptw//2 - 25, cy + 230, cx + ptw//2 + 25, cy + 275], fill=(15, 23, 42, 230), outline=(56, 189, 248, 120))
            draw.text((cx - ptw//2, cy + 240), p_txt, font=FONT_MD, fill=(148, 163, 184))
            
            # Final CTA Button: "BOOK A DEMO"
            btn_w, btn_h = 320, 70
            btn_x, btn_y = cx - btn_w//2, cy + 320
            
            # Pulse glow effect on CTA button
            pulse_w = int(2 + np.sin(t_sec * 5) * 2)
            draw.rectangle([btn_x, btn_y, btn_x + btn_w, btn_y + btn_h], fill=(2, 132, 199), outline=(0, 240, 255), width=pulse_w)
            
            cta_txt = "BOOK A DEMO"
            ctb = FONT_LG.getbbox(cta_txt)
            ctw = ctb[2] - ctb[0]
            draw.text((btn_x + (btn_w - ctw)//2, btn_y + 15), cta_txt, font=FONT_LG, fill=(255, 255, 255))
            
            # Smooth fade-out to black (58.5s - 60.0s)
            if t_sec >= 58.5:
                fade_alpha = int(((t_sec - 58.5) / 1.5) * 255)
                draw.rectangle([0, 0, WIDTH, HEIGHT], fill=(0, 0, 0, fade_alpha))

        # Write frame to FFmpeg pipe
        raw_rgb = np.array(pil_frame, dtype=np.uint8)
        proc.stdin.write(raw_rgb.tobytes())
        
        if f_idx % 150 == 0:
            elapsed = time.time() - start_time
            print(f"Rendered {f_idx}/{TOTAL_FRAMES} frames ({t_sec:.1f}s / 60s) - Elapsed: {elapsed:.1f}s")
            
    proc.stdin.close()
    proc.wait()
    print(f"Finished rendering full 60s video to {OUTPUT_VIDEO}!")

if __name__ == "__main__":
    render_ad_frames()
