import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageEnhance
import os
import subprocess
import time
import imageio_ffmpeg

# --- CONFIGURATION ---
WIDTH_16_9, HEIGHT_16_9 = 1920, 1080
WIDTH_X, HEIGHT_X = 1080, 1080
FPS = 30
TOTAL_FRAMES = 1800  # Exactly 60.0 seconds
OUTPUT_VIDEO = r"d:\camAI\videos\CamAI_60s_X_Ad.mp4"
AUDIO_TRACK = r"d:\camAI\videos\audio_stems\final_ad_audio_60s.mp3"

try:
    LANCZOS = Image.Resampling.LANCZOS
    BILINEAR = Image.Resampling.BILINEAR
except AttributeError:
    LANCZOS = Image.LANCZOS
    BILINEAR = Image.BILINEAR

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

# 16:9 Fonts
FONT_XL = get_font(52, bold=True)
FONT_LG = get_font(36, bold=True)
FONT_MD = get_font(24, bold=True)
FONT_SM = get_font(18, bold=False)
FONT_MONO_MD = get_font(22, bold=True, mono=True)
FONT_MONO_SM = get_font(16, bold=False, mono=True)
FONT_BRAND = get_font(64, bold=True)
FONT_TAGLINE = get_font(26, bold=False)

# X-Specific Fonts
FONT_BANNER_LG = get_font(26, bold=True)
FONT_BANNER_SM = get_font(14, bold=True)
FONT_BANNER_MONO = get_font(16, bold=True, mono=True)
FONT_BANNER_MONO_SM = get_font(13, bold=False, mono=True)
FONT_SUBTITLE = get_font(36, bold=True)

# --- VIDEO SOURCES ---
SRC_HUMANS = r"d:\camAI\portal\public\videos\humans.mp4"
SRC_JUNCTION = r"d:\camAI\portal\public\videos\junction.mp4"
SRC_SPEED = r"d:\camAI\portal\public\videos\speed.mp4"
SRC_DRONE = r"d:\camAI\drone_test_video.mp4"

class VideoStreamPool:
    def __init__(self):
        self.caps = {}
        self.paths = {
            "humans": SRC_HUMANS,
            "junction": SRC_JUNCTION,
            "speed": SRC_SPEED,
            "drone": SRC_DRONE
        }
        for key, path in self.paths.items():
            if os.path.exists(path):
                self.caps[key] = cv2.VideoCapture(path)
            else:
                self.caps[key] = None

    def get_frame(self, key, frame_num):
        cap = self.caps.get(key)
        path = self.paths.get(key)
        
        if cap is None or not cap.isOpened():
            if path and os.path.exists(path):
                cap = cv2.VideoCapture(path)
                self.caps[key] = cap
            
            if cap is None or not cap.isOpened():
                img = np.zeros((HEIGHT_16_9, WIDTH_16_9, 3), dtype=np.uint8)
                cv2.putText(img, f"FEED: {key.upper()}", (100, 100), cv2.FONT_HERSHEY_SIMPLEX, 1.5, (0, 240, 255), 2)
                return img
            
        ret1, frame1 = cap.read()
        ret2, frame2 = cap.read()
        
        # Safe self-healing loop: if either read fails, release and reopen a fresh capture
        if not ret1 or frame1 is None or not ret2 or frame2 is None:
            cap.release()
            cap = cv2.VideoCapture(path)
            self.caps[key] = cap
            ret1, frame1 = cap.read()
            ret2, frame2 = cap.read()
            
        final_frame = frame2 if (ret2 and frame2 is not None) else frame1
        if final_frame is None:
            final_frame = frame1
            
        if final_frame is not None:
            return cv2.cvtColor(final_frame, cv2.COLOR_BGR2RGB)
        
        img = np.zeros((HEIGHT_16_9, WIDTH_16_9, 3), dtype=np.uint8)
        return img

# --- HELPER COMPOSITING FUNCTIONS ---

def draw_cctv_hud(draw, cam_id, location, timestamp_str, is_rec=True):
    draw.rectangle([30, 30, 350, 75], fill=(15, 23, 42, 200), outline=(56, 189, 248, 120))
    draw.ellipse([45, 47, 57, 59], fill=(239, 68, 68) if is_rec else (100, 116, 139))
    draw.text((68, 43), f"REC • {cam_id}", font=FONT_MONO_MD, fill=(255, 255, 255))
    
    draw.rectangle([30, HEIGHT_16_9 - 70, 380, HEIGHT_16_9 - 30], fill=(15, 23, 42, 200), outline=(56, 189, 248, 120))
    draw.text((45, HEIGHT_16_9 - 60), f"LOC: {location}", font=FONT_MONO_SM, fill=(148, 163, 184))
    
    draw.rectangle([WIDTH_16_9 - 360, 30, WIDTH_16_9 - 30, 75], fill=(15, 23, 42, 200), outline=(56, 189, 248, 120))
    draw.text((WIDTH_16_9 - 345, 43), timestamp_str, font=FONT_MONO_MD, fill=(0, 240, 255))

def draw_ai_bbox(draw, box, label, track_id=None, color=(0, 240, 255), conf=0.98):
    x1, y1, x2, y2 = box
    t = 4
    l_len = min(25, (x2 - x1) // 3)
    draw.rectangle([x1, y1, x2, y2], outline=color, width=2)
    draw.line([x1, y1, x1 + l_len, y1], fill=color, width=t)
    draw.line([x1, y1, x1, y1 + l_len], fill=color, width=t)
    draw.line([x2, y1, x2 - l_len, y1], fill=color, width=t)
    draw.line([x2, y1, x2, y1 + l_len], fill=color, width=t)
    draw.line([x1, y2, x1 + l_len, y2], fill=color, width=t)
    draw.line([x1, y2, x1, y2 - l_len], fill=color, width=t)
    draw.line([x2, y2, x2 - l_len, y2], fill=color, width=t)
    draw.line([x2, y2, x2, y2 - l_len], fill=color, width=t)
    
    tag_str = f"{label} #{track_id}" if track_id else f"{label} [{int(conf*100)}%]"
    bbox_txt = FONT_MONO_SM.getbbox(tag_str)
    tw, th = bbox_txt[2] - bbox_txt[0], bbox_txt[3] - bbox_txt[1]
    
    draw.rectangle([x1, max(0, y1 - 28), x1 + tw + 16, y1], fill=(15, 23, 42, 230), outline=color)
    draw.text((x1 + 8, max(0, y1 - 24)), tag_str, font=FONT_MONO_SM, fill=(255, 255, 255))

def render_dashboard_shell(pil_img, active_nav="Live View", alert_count=3, intrusion_count=1, people_count=24):
    draw = ImageDraw.Draw(pil_img, "RGBA")
    draw.rectangle([0, 0, 240, HEIGHT_16_9], fill=(11, 15, 25, 245), outline=(30, 41, 59, 180))
    
    draw.rectangle([20, 20, 52, 52], fill=(2, 132, 199), outline=(0, 240, 255))
    draw.polygon([(36, 26), (46, 44), (26, 44)], fill=(255, 255, 255))
    draw.text((64, 23), "CamAI", font=FONT_LG, fill=(255, 255, 255))
    draw.text((64, 55), "ENTERPRISE v4.8", font=FONT_MONO_SM, fill=(0, 240, 255))
    
    nav_items = [("Dashboard", 110), ("Live View", 160), ("Cameras (18)", 210), ("Alerts & Logs", 260), ("Analytics", 310), ("Zone Profile", 360), ("Settings", 410)]
    for name, y in nav_items:
        is_active = (name == active_nav)
        bg_col = (14, 165, 233, 40) if is_active else (0, 0, 0, 0)
        txt_col = (0, 240, 255) if is_active else (148, 163, 184)
        if is_active:
            draw.rectangle([0, y - 5, 6, y + 30], fill=(0, 240, 255))
        draw.rectangle([15, y - 5, 225, y + 30], fill=bg_col)
        draw.text((30, y), name, font=FONT_SM if not is_active else FONT_MD, fill=txt_col)

    draw.rectangle([15, HEIGHT_16_9 - 90, 225, HEIGHT_16_9 - 30], fill=(15, 23, 42, 230), outline=(56, 189, 248, 80))
    draw.ellipse([25, HEIGHT_16_9 - 70, 35, HEIGHT_16_9 - 60], fill=(34, 197, 94))
    draw.text((42, HEIGHT_16_9 - 73), "ENGINE ACTIVE", font=FONT_MONO_SM, fill=(34, 197, 94))
    draw.text((42, HEIGHT_16_9 - 53), "Latency: 14ms", font=FONT_MONO_SM, fill=(148, 163, 184))

    draw.rectangle([240, 0, WIDTH_16_9, 75], fill=(15, 23, 42, 235), outline=(30, 41, 59, 180))
    draw.text((270, 22), "Multi-Camera Intelligence Matrix", font=FONT_LG, fill=(255, 255, 255))
    
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
    draw = ImageDraw.Draw(pil_img, "RGBA")
    card_w, card_h = 440, 110
    end_x = WIDTH_16_9 - 460
    start_x = WIDTH_16_9 + 20
    
    cur_x = int(start_x + (end_x - start_x) * min(1.0, t_progress * 1.5))
    cur_y = 90
    
    draw.rectangle([cur_x, cur_y, cur_x + card_w, cur_y + card_h], fill=(15, 23, 42, 245), outline=(239, 68, 68, 220), width=2)
    draw.rectangle([cur_x, cur_y, cur_x + card_w, cur_y + 32], fill=(239, 68, 68, 40))
    draw.rectangle([cur_x + 12, cur_y + 8, cur_x + 28, cur_y + 24], fill=(239, 68, 68))
    draw.text((cur_x + 16, cur_y + 7), "!", font=FONT_MD, fill=(255, 255, 255))
    draw.text((cur_x + 36, cur_y + 7), "CamAI REAL-TIME ALERT", font=FONT_MD, fill=(239, 68, 68))
    draw.text((cur_x + card_w - 70, cur_y + 9), "JUST NOW", font=FONT_MONO_SM, fill=(148, 163, 184))
    
    draw.text((cur_x + 16, cur_y + 40), "Restricted zone intrusion detected", font=FONT_MD, fill=(255, 255, 255))
    draw.text((cur_x + 16, cur_y + 72), "Location: North Gate • Camera 07", font=FONT_SM, fill=(148, 163, 184))

# --- SUBTITLES LIST FOR X ---
SUBTITLES = [
    (0.0, 1.2, "[ Atmospheric Synth Pulse ]"),
    (1.2, 7.0, "Your cameras are watching.\nBut who is watching your cameras?"),
    (7.0, 8.2, "[ Scanning Footage Archives ]"),
    (8.2, 15.0, "Hundreds of cameras. Thousands of hours of footage.\nCritical events can be missed in seconds."),
    (15.0, 16.5, "[ Core Intelligence Initializing ]"),
    (16.5, 24.2, "Meet CamAI.\nThe Real-time AI Video Intelligence Platform."),
    (24.2, 36.0, "CamAI understands what is happening\nin your cameras in real time."),
    (36.0, 46.0, "Detect people, track movement, identify intrusions,\nmonitor restricted zones, and receive instant alerts."),
    (46.0, 53.0, "Turn your existing CCTV infrastructure\ninto an intelligent security system."),
    (53.0, 60.0, "CamAI Enterprise\nBook your live demo today.")
]

# --- X PANEL DRAWING FUNCTIONS ---

def draw_x_top_banner(draw, current_t):
    # Dark panel background (11, 15, 25)
    draw.rectangle([0, 0, WIDTH_X, 180], fill=(11, 15, 25))
    
    # Glowing bottom separator at Y=178
    draw.line([(0, 178), (WIDTH_X, 178)], fill=(0, 240, 255, 200), width=3)
    
    # CamAI Brand Left
    # Blue square logo
    draw.rectangle([40, 45, 80, 85], fill=(2, 132, 199), outline=(0, 240, 255), width=2)
    # Triangle inside
    draw.polygon([(60, 52), (72, 77), (48, 77)], fill=(255, 255, 255))
    
    draw.text((95, 42), "CamAI", font=FONT_BANNER_LG, fill=(255, 255, 255))
    draw.text((95, 80), "REAL-TIME VIDEO INTELLIGENCE", font=FONT_BANNER_SM, fill=(0, 240, 255))
    
    # Segment-specific telemetry indicator in middle
    # Map t_sec to segment name
    if current_t < 7.0:
        segment_lbl = "SYSTEM DIAGNOSTIC // HOOK"
        lbl_col = (239, 68, 68)  # Orange-red
    elif current_t < 15.0:
        segment_lbl = "ARCHIVE TIMELINE ANALYSIS"
        lbl_col = (245, 158, 11) # Amber
    elif current_t < 22.0:
        segment_lbl = "INITIALIZING CamAI AGENT"
        lbl_col = (34, 197, 94)  # Green
    elif current_t < 45.0:
        segment_lbl = "LIVE TELEMETRY STREAM"
        lbl_col = (0, 240, 255)  # Cyan
    elif current_t < 53.0:
        segment_lbl = "INTELLIGENCE DEPLOYMENT"
        lbl_col = (56, 189, 248) # Sky blue
    else:
        segment_lbl = "ESTABLISHING ENTERPRISE CTA"
        lbl_col = (255, 255, 255)
        
    draw.rectangle([340, 60, 680, 100], fill=(15, 23, 42, 230), outline=lbl_col, width=1)
    draw.text((360, 70), segment_lbl, font=FONT_BANNER_MONO_SM, fill=lbl_col)
    
    # System Status Right
    status_x = WIDTH_X - 260
    # Pulse green dot
    pulse_alpha = int(127 + 128 * np.sin(current_t * 6))
    draw.ellipse([status_x, 52, status_x + 12, 64], fill=(34, 197, 94, pulse_alpha))
    draw.ellipse([status_x, 52, status_x + 12, 64], outline=(34, 197, 94), width=1)
    draw.text((status_x + 22, 48), "ENGINE ACTIVE", font=FONT_BANNER_MONO, fill=(34, 197, 94))
    
    draw.text((status_x, 80), "LATENCY: 14ms", font=FONT_BANNER_MONO_SM, fill=(148, 163, 184))
    draw.text((status_x + 140, 80), "FPS: 30.0", font=FONT_BANNER_MONO_SM, fill=(148, 163, 184))

def draw_highlighted_subtitles(draw, text, current_t, start_t, end_t, center_x, center_y, font, default_color=(255, 255, 255), active_color=(0, 240, 255)):
    lines = text.split('\n')
    line_spacing = 10
    
    # Calculate text sizes
    total_height = sum([font.getbbox(line)[3] - font.getbbox(line)[1] for line in lines]) + line_spacing * (len(lines) - 1)
    
    # Calculate word progress
    duration = end_t - start_t
    progress = (current_t - start_t) / duration if duration > 0 else 0.0
    
    # Gather all words
    words = []
    for line in lines:
        words.extend(line.split())
    num_words = len(words)
    active_word_index = int(progress * num_words)
    active_word_index = min(active_word_index, num_words - 1)
    
    word_counter = 0
    cur_y = center_y - total_height // 2
    
    for line in lines:
        line_words = line.split()
        line_w_boxes = [font.getbbox(w) for w in line_words]
        line_w_widths = [b[2] - b[0] for b in line_w_boxes]
        space_w = font.getbbox(" ")[2] - font.getbbox(" ")[0]
        line_total_width = sum(line_w_widths) + space_w * (len(line_words) - 1)
        
        cur_x = center_x - line_total_width // 2
        for w_idx, word in enumerate(line_words):
            is_active = (word_counter <= active_word_index)
            color = active_color if is_active else default_color
            
            # Shadow
            draw.text((cur_x + 2, cur_y + 2), word, font=font, fill=(0, 0, 0, 220))
            # Text
            draw.text((cur_x, cur_y), word, font=font, fill=color)
            
            cur_x += line_w_widths[w_idx] + space_w
            word_counter += 1
            
        cur_y += (font.getbbox(line)[3] - font.getbbox(line)[1]) + line_spacing

def draw_x_bottom_banner(draw, current_t):
    # Dark panel background (11, 15, 25)
    draw.rectangle([0, 788, WIDTH_X, HEIGHT_X], fill=(11, 15, 25))
    
    # Glowing top separator at Y=788
    draw.line([(0, 788), (WIDTH_X, 788)], fill=(0, 240, 255, 200), width=3)
    
    # Find active subtitle
    active_sub = "[ Processing Telemetry ]"
    sub_start = current_t
    sub_end = current_t + 1.0
    
    for start, end, text in SUBTITLES:
        if start <= current_t < end:
            active_sub = text
            sub_start = start
            sub_end = end
            break
            
    # Draw subtitles centered in the bottom area (Y: 788 to 1080)
    # Center coordinates: X=540, Y=884
    draw_highlighted_subtitles(
        draw, active_sub, current_t, sub_start, sub_end,
        center_x=540, center_y=884, font=FONT_SUBTITLE
    )
    
    # Tech diagnostics detail on lower bottom corners
    draw.text((40, HEIGHT_X - 45), "MODE: AI MATRIX", font=FONT_BANNER_MONO_SM, fill=(148, 163, 184))
    draw.text((WIDTH_X - 250, HEIGHT_X - 45), "LICENSE: ENTERPRISE ACTIVE", font=FONT_BANNER_MONO_SM, fill=(148, 163, 184))

# --- MAIN GENERATOR FUNCTION ---
def render_ad_frames():
    os.makedirs(r"d:\camAI\videos", exist_ok=True)
    pool = VideoStreamPool()
    
    ffmpeg_exe = imageio_ffmpeg.get_ffmpeg_exe()
    
    cmd = [
        ffmpeg_exe, "-y",
        "-f", "rawvideo",
        "-vcodec", "rawvideo",
        "-s", f"{WIDTH_X}x{HEIGHT_X}",
        "-pix_fmt", "rgb24",
        "-r", str(FPS),
        "-i", "-", # input from stdin
        "-i", AUDIO_TRACK, # input audio
        "-c:v", "libx264",
        "-preset", "ultrafast",
        "-crf", "18",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        "-b:a", "192k",
        "-shortest",
        OUTPUT_VIDEO
    ]
    
    print(f"Starting video encoding pipe for X (Square 1:1) to {OUTPUT_VIDEO}...")
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    
    start_time = time.time()
    
    for f_idx in range(TOTAL_FRAMES):
        t_sec = f_idx / float(FPS)
        
        # 1. Base 16:9 frame container (RGB)
        pil_frame_16_9 = Image.new("RGB", (WIDTH_16_9, HEIGHT_16_9), (0, 0, 0))
        draw_16_9 = ImageDraw.Draw(pil_frame_16_9, "RGBA")
        
        # --- SEGMENTS LOGIC FROM ORIGINAL AD ---
        
        # SEGMENT 1: 0–7 sec — HOOK
        if t_sec < 7.0:
            cut_id = int(t_sec / 1.75) % 3
            cam_src_key = ["humans", "junction", "speed"][cut_id]
            cam_num_str = f"CAM-0{cut_id + 1}"
            cam_loc_str = ["NORTH FACTORY EXTERIOR", "MAIN ENTRANCE GATE", "PERIMETER FENCE WEST"][cut_id]
            
            vid_frame = pool.get_frame(cam_src_key, f_idx)
            vid_frame = cv2.resize(vid_frame, (WIDTH_16_9, HEIGHT_16_9))
            
            vid_frame = cv2.addWeighted(vid_frame, 0.75, np.zeros_like(vid_frame), 0, -20)
            pil_frame_16_9 = Image.fromarray(vid_frame)
            draw_16_9 = ImageDraw.Draw(pil_frame_16_9, "RGBA")
            
            for y_line in range(0, HEIGHT_16_9, 6):
                draw_16_9.line([(0, y_line), (WIDTH_16_9, y_line)], fill=(0, 0, 0, 40))
                
            draw_cctv_hud(draw_16_9, cam_num_str, cam_loc_str, f"2026-08-23 23:14:{int(t_sec)%60:02d}.{f_idx%30:02d}")
            
            if t_sec >= 2.0:
                txt_alpha = min(255, int((t_sec - 2.0) * 300))
                draw_16_9.rectangle([0, HEIGHT_16_9//2 - 90, WIDTH_16_9, HEIGHT_16_9//2 + 90], fill=(9, 13, 22, min(220, txt_alpha)))
                draw_16_9.line([(0, HEIGHT_16_9//2 - 90), (WIDTH_16_9, HEIGHT_16_9//2 - 90)], fill=(0, 240, 255, min(255, txt_alpha)), width=2)
                draw_16_9.line([(0, HEIGHT_16_9//2 + 90), (WIDTH_16_9, HEIGHT_16_9//2 + 90)], fill=(0, 240, 255, min(255, txt_alpha)), width=2)
                
                txt = "YOUR CAMERAS SEE EVERYTHING."
                txt_bbox = FONT_BRAND.getbbox(txt)
                tw = txt_bbox[2] - txt_bbox[0]
                draw_16_9.text(((WIDTH_16_9 - tw)//2, HEIGHT_16_9//2 - 40), txt, font=FONT_BRAND, fill=(255, 255, 255, txt_alpha))
                draw_16_9.text(((WIDTH_16_9 - tw)//2 + 2, HEIGHT_16_9//2 - 38), txt, font=FONT_BRAND, fill=(0, 240, 255, min(100, txt_alpha)))

        # SEGMENT 2: 7–15 sec — THE PROBLEM
        elif t_sec < 15.0:
            gw, gh = (WIDTH_16_9 - 60) // 2, (HEIGHT_16_9 - 180) // 2
            feeds = [("humans", "CAM-01", "FACILITY NORTH"), ("junction", "CAM-02", "EAST GATEWAY"), 
                     ("speed", "CAM-03", "MAIN ACCESS ROAD"), ("drone", "CAM-04", "WAREHOUSE ROOFTOP")]
            
            positions = [(20, 80), (40 + gw, 80), (20, 100 + gh), (40 + gw, 100 + gh)]
            
            for idx, (fkey, cname, cloc) in enumerate(feeds):
                px, py = positions[idx]
                f_raw = pool.get_frame(fkey, f_idx)
                f_resized = cv2.resize(f_raw, (gw, gh))
                
                pil_frame_16_9.paste(Image.fromarray(f_resized), (px, py))
                draw_16_9.rectangle([px, py, px + gw, py + gh], outline=(56, 189, 248, 120), width=2)
                draw_16_9.text((px + 15, py + 15), f"REC • {cname} [{cloc}]", font=FONT_MONO_SM, fill=(0, 240, 255))
            
            draw_16_9.rectangle([20, HEIGHT_16_9 - 85, WIDTH_16_9 - 20, HEIGHT_16_9 - 20], fill=(15, 23, 42, 240), outline=(56, 189, 248, 100))
            draw_16_9.text((35, HEIGHT_16_9 - 75), "TIMELINE RECORDER (24h ARCHIVE)", font=FONT_MONO_SM, fill=(148, 163, 184))
            
            t_bar_x1, t_bar_x2 = 260, WIDTH_16_9 - 40
            draw_16_9.line([(t_bar_x1, HEIGHT_16_9 - 48), (t_bar_x2, HEIGHT_16_9 - 48)], fill=(51, 65, 85), width=12)
            
            scrub_x = t_bar_x1 + int((t_bar_x2 - t_bar_x1) * ((t_sec - 7.0) / 8.0))
            draw_16_9.line([(t_bar_x1, HEIGHT_16_9 - 48), (scrub_x, HEIGHT_16_9 - 48)], fill=(0, 240, 255), width=12)
            draw_16_9.rectangle([scrub_x - 4, HEIGHT_16_9 - 65, scrub_x + 4, HEIGHT_16_9 - 30], fill=(239, 68, 68))
            
            for sp in [320, 480, 620, 850, 1100, 1350, 1500]:
                draw_16_9.rectangle([sp - 2, HEIGHT_16_9 - 58, sp + 2, HEIGHT_16_9 - 38], fill=(239, 68, 68))
                
            if t_sec >= 9.0:
                txt = "Too many cameras. Too much footage."
                draw_16_9.rectangle([0, HEIGHT_16_9//2 - 60, WIDTH_16_9, HEIGHT_16_9//2 + 60], fill=(9, 13, 22, 230))
                draw_16_9.line([(0, HEIGHT_16_9//2 - 60), (WIDTH_16_9, HEIGHT_16_9//2 - 60)], fill=(239, 68, 68), width=2)
                draw_16_9.line([(0, HEIGHT_16_9//2 + 60), (WIDTH_16_9, HEIGHT_16_9//2 + 60)], fill=(239, 68, 68), width=2)
                
                tb = FONT_XL.getbbox(txt)
                tw = tb[2] - tb[0]
                draw_16_9.text(((WIDTH_16_9 - tw)//2, HEIGHT_16_9//2 - 30), txt, font=FONT_XL, fill=(255, 255, 255))

        # SEGMENT 3: 15–22 sec — INTRODUCE CAMAI
        elif t_sec < 22.0:
            pil_frame_16_9 = Image.new("RGB", (WIDTH_16_9, HEIGHT_16_9), (9, 13, 22))
            
            render_dashboard_shell(pil_frame_16_9, active_nav="Dashboard", alert_count=0, intrusion_count=0, people_count=0)
            draw_16_9 = ImageDraw.Draw(pil_frame_16_9, "RGBA")
            
            box_w, box_h = 760, 320
            bx, by = (WIDTH_16_9 - box_w)//2 + 100, (HEIGHT_16_9 - box_h)//2
            
            draw_16_9.rectangle([bx, by, bx + box_w, by + box_h], fill=(15, 23, 42, 250), outline=(0, 240, 255, 200), width=2)
            draw_16_9.rectangle([bx + box_w//2 - 40, by + 40, bx + box_w//2 + 40, by + 120], fill=(2, 132, 199), outline=(0, 240, 255), width=3)
            draw_16_9.polygon([(bx + box_w//2, by + 52), (bx + box_w//2 + 24, by + 104), (bx + box_w//2 - 24, by + 104)], fill=(255, 255, 255))
            
            b_txt = "CamAI"
            btb = FONT_BRAND.getbbox(b_txt)
            btw = btb[2] - btb[0]
            draw_16_9.text((bx + (box_w - btw)//2, by + 140), b_txt, font=FONT_BRAND, fill=(255, 255, 255))
            
            sub_txt = "AI Video Intelligence Platform"
            stb = FONT_LG.getbbox(sub_txt)
            stw = stb[2] - stb[0]
            draw_16_9.text((bx + (box_w - stw)//2, by + 230), sub_txt, font=FONT_LG, fill=(0, 240, 255))
            
            t_expand = min(1.0, (t_sec - 15.0) / 3.0)
            div_w = int(btw * t_expand)
            draw_16_9.line([(bx + (box_w - div_w)//2, by + 215), (bx + (box_w + div_w)//2, by + 215)], fill=(0, 240, 255), width=4)

        # SEGMENT 4: 22–35 sec — AI DETECTION
        elif t_sec < 35.0:
            render_dashboard_shell(pil_frame_16_9, active_nav="Live View", alert_count=3, intrusion_count=1, people_count=24)
            draw_16_9 = ImageDraw.Draw(pil_frame_16_9, "RGBA")
            
            vx1, vy1, vx2, vy2 = 270, 90, WIDTH_16_9 - 40, HEIGHT_16_9 - 40
            vw, vh = vx2 - vx1, vy2 - vy1
            
            if t_sec < 27.0:
                f_raw = pool.get_frame("humans", f_idx)
                f_resized = cv2.resize(f_raw, (vw, vh))
                pil_frame_16_9.paste(Image.fromarray(f_resized), (vx1, vy1))
                draw_16_9 = ImageDraw.Draw(pil_frame_16_9, "RGBA")
                
                shift = int((f_idx % 120) * 1.5)
                bboxes = [
                    ([vx1 + 200 + shift, vy1 + 180, vx1 + 340 + shift, vy1 + 460], "PERSON DETECTED", 1042, (0, 240, 255)),
                    ([vx1 + 520 - shift//2, vy1 + 220, vx1 + 640 - shift//2, vy1 + 490], "PERSON DETECTED", 1043, (0, 240, 255)),
                    ([vx1 + 800 + shift//3, vy1 + 150, vx1 + 920 + shift//3, vy1 + 420], "PERSON DETECTED", 1044, (0, 240, 255))
                ]
                for box, lbl, tid, col in bboxes:
                    draw_ai_bbox(draw_16_9, box, lbl, track_id=tid, color=col)
                    
                draw_16_9.rectangle([vx1 + 30, vy1 + 30, vx1 + 380, vy1 + 75], fill=(15, 23, 42, 230), outline=(0, 240, 255))
                draw_16_9.text((vx1 + 45, vy1 + 42), "TRACKING ACTIVE • 3 PEOPLE", font=FONT_MONO_MD, fill=(0, 240, 255))
                
            elif t_sec < 31.0:
                f_raw = pool.get_frame("junction", f_idx)
                f_resized = cv2.resize(f_raw, (vw, vh))
                pil_frame_16_9.paste(Image.fromarray(f_resized), (vx1, vy1))
                draw_16_9 = ImageDraw.Draw(pil_frame_16_9, "RGBA")
                
                zone_pts = [(vx1 + 400, vy1 + 200), (vx1 + 900, vy1 + 200), (vx1 + 1100, vy1 + 600), (vx1 + 350, vy1 + 600)]
                draw_16_9.polygon(zone_pts, fill=(239, 68, 68, 60), outline=(239, 68, 68, 220))
                draw_16_9.text((vx1 + 420, vy1 + 220), "RESTRICTED ZONE B-04", font=FONT_MONO_MD, fill=(239, 68, 68))
                
                px1 = vx1 + 580 + int(np.sin(t_sec*3)*30)
                py1 = vy1 + 300
                draw_ai_bbox(draw_16_9, [px1, py1, px1 + 130, py1 + 260], "INTRUDER", track_id=8801, color=(239, 68, 68))
                
                is_flash = (int(t_sec * 6) % 2 == 0)
                banner_col = (239, 68, 68, 240) if is_flash else (185, 28, 28, 240)
                draw_16_9.rectangle([vx1 + 30, vy1 + 30, vx1 + 480, vy1 + 80], fill=banner_col)
                draw_16_9.text((vx1 + 45, vy1 + 45), "[!] RESTRICTED ZONE INTRUSION", font=FONT_MONO_MD, fill=(255, 255, 255))
                
            else:
                f_raw = pool.get_frame("speed", f_idx)
                f_resized = cv2.resize(f_raw, (vw, vh))
                pil_frame_16_9.paste(Image.fromarray(f_resized), (vx1, vy1))
                draw_16_9 = ImageDraw.Draw(pil_frame_16_9, "RGBA")
                
                line_y = vy1 + 350
                draw_16_9.line([(vx1 + 100, line_y), (vx1 + vw - 100, line_y)], fill=(0, 240, 255, 240), width=4)
                draw_16_9.text((vx1 + 120, line_y - 30), "TRIPWIRE LINE #01 [INBOUND]", font=FONT_MONO_SM, fill=(0, 240, 255))
                
                vx_x = vx1 + 300 + int((t_sec - 31.0) * 180)
                draw_ai_bbox(draw_16_9, [vx_x, line_y - 120, vx_x + 220, line_y + 80], "VEHICLE DETECTED", track_id=402, color=(0, 240, 255))
                
                draw_16_9.rectangle([vx1 + 30, vy1 + 30, vx1 + 450, vy1 + 80], fill=(15, 23, 42, 230), outline=(0, 240, 255))
                draw_16_9.text((vx1 + 45, vy1 + 45), "LINE CROSSING DETECTED", font=FONT_MONO_MD, fill=(0, 240, 255))
                
            draw_16_9.rectangle([vx1, vy1, vx2, vy2], outline=(56, 189, 248, 150), width=2)

        # SEGMENT 5: 35–45 sec — INTELLIGENT MONITORING
        elif t_sec < 45.0:
            cur_people = min(24, 12 + int((t_sec - 35.0) * 1.2))
            cur_alerts = 3
            cur_intrusions = 1
            
            render_dashboard_shell(pil_frame_16_9, active_nav="Live View", alert_count=cur_alerts, intrusion_count=cur_intrusions, people_count=cur_people)
            draw_16_9 = ImageDraw.Draw(pil_frame_16_9, "RGBA")
            
            vx1, vy1, vx2, vy2 = 270, 90, WIDTH_16_9 - 40, HEIGHT_16_9 - 40
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
                pil_frame_16_9.paste(Image.fromarray(f_resized), (cx, cy))
                
                draw_16_9.rectangle([cx, cy, cx + gw, cy + gh], outline=(56, 189, 248, 120), width=2)
                draw_16_9.rectangle([cx + 10, cy + 10, cx + 240, cy + 40], fill=(15, 23, 42, 220))
                draw_16_9.text((cx + 18, cy + 17), clabel, font=FONT_MONO_SM, fill=(0, 240, 255))
                
                bx1, by1, bx2, by2 = bbox_coords
                draw_ai_bbox(draw_16_9, [cx + bx1, cy + by1, cx + bx2, cy + by2], "TARGET", track_id=100 + idx, color=(0, 240, 255) if idx != 1 else (239, 68, 68))

            if t_sec >= 38.5:
                t_toast = (t_sec - 38.5) / 1.5
                draw_toast_notification(pil_frame_16_9, t_toast)

        # SEGMENT 6: 45–53 sec — BUSINESS VALUE
        elif t_sec < 53.0:
            f_raw = pool.get_frame("drone", f_idx)
            f_resized = cv2.resize(f_raw, (WIDTH_16_9, HEIGHT_16_9))
            
            f_resized = cv2.addWeighted(f_resized, 0.65, np.zeros_like(f_resized), 0, -10)
            pil_frame_16_9 = Image.fromarray(f_resized)
            draw_16_9 = ImageDraw.Draw(pil_frame_16_9, "RGBA")
            
            nodes = [
                (350, 280), (600, 340), (950, 220), (1350, 310), (1600, 450),
                (450, 650), (820, 720), (1200, 680), (1500, 780)
            ]
            
            for i, n1 in enumerate(nodes):
                for j, n2 in enumerate(nodes[i+1:], start=i+1):
                    dist = np.hypot(n1[0] - n2[0], n1[1] - n2[1])
                    if dist < 450:
                        alpha = int(max(0, 180 - (dist / 450.0) * 180))
                        draw_16_9.line([n1, n2], fill=(0, 240, 255, alpha), width=2)
                        
            for idx, (nx, ny) in enumerate(nodes):
                draw_16_9.ellipse([nx - 10, ny - 10, nx + 10, ny + 10], fill=(2, 132, 199, 200), outline=(0, 240, 255), width=2)
                draw_16_9.ellipse([nx - 4, ny - 4, nx + 4, ny + 4], fill=(255, 255, 255))
                draw_16_9.text((nx + 14, ny - 10), f"CAM-NODE #{idx+1:02d}", font=FONT_MONO_SM, fill=(0, 240, 255))

            if t_sec >= 47.0:
                draw_16_9.rectangle([0, HEIGHT_16_9//2 - 100, WIDTH_16_9, HEIGHT_16_9//2 + 100], fill=(9, 13, 22, 230))
                draw_16_9.line([(0, HEIGHT_16_9//2 - 100), (WIDTH_16_9, HEIGHT_16_9//2 - 100)], fill=(0, 240, 255), width=3)
                draw_16_9.line([(0, HEIGHT_16_9//2 + 100), (WIDTH_16_9, HEIGHT_16_9//2 + 100)], fill=(0, 240, 255), width=3)
                
                t1 = "YOUR CAMERAS."
                t2 = "NOW INTELLIGENT."
                
                tb1 = FONT_BRAND.getbbox(t1)
                tw1 = tb1[2] - tb1[0]
                tb2 = FONT_BRAND.getbbox(t2)
                tw2 = tb2[2] - tb2[0]
                
                draw_16_9.text(((WIDTH_16_9 - tw1)//2, HEIGHT_16_9//2 - 75), t1, font=FONT_BRAND, fill=(255, 255, 255))
                draw_16_9.text(((WIDTH_16_9 - tw2)//2, HEIGHT_16_9//2 + 5), t2, font=FONT_BRAND, fill=(0, 240, 255))

        # SEGMENT 7: 53–60 sec — FINAL CTA
        else:
            pil_frame_16_9 = Image.new("RGB", (WIDTH_16_9, HEIGHT_16_9), (9, 13, 22))
            draw_16_9 = ImageDraw.Draw(pil_frame_16_9, "RGBA")
            
            for gx in range(0, WIDTH_16_9, 60):
                draw_16_9.line([(gx, 0), (gx, HEIGHT_16_9)], fill=(30, 41, 59, 50))
            for gy in range(0, HEIGHT_16_9, 60):
                draw_16_9.line([(0, gy), (WIDTH_16_9, gy)], fill=(30, 41, 59, 50))
                
            cx, cy = WIDTH_16_9 // 2, HEIGHT_16_9 // 2 - 110
            
            draw_16_9.rectangle([cx - 50, cy - 50, cx + 50, cy + 50], fill=(2, 132, 199), outline=(0, 240, 255), width=4)
            draw_16_9.polygon([(cx, cy - 30), (cx + 30, cy + 30), (cx - 30, cy + 30)], fill=(255, 255, 255))
            
            b_txt = "CamAI"
            btb = FONT_BRAND.getbbox(b_txt)
            btw = btb[2] - btb[0]
            draw_16_9.text((cx - btw//2, cy + 70), b_txt, font=FONT_BRAND, fill=(255, 255, 255))
            
            s_txt = "AI-Powered Video Intelligence"
            stb = FONT_LG.getbbox(s_txt)
            stw = stb[2] - stb[0]
            draw_16_9.text((cx - stw//2, cy + 160), s_txt, font=FONT_LG, fill=(0, 240, 255))
            
            p_txt = "Monitor  •  Detect  •  Track  •  Respond"
            ptb = FONT_MD.getbbox(p_txt)
            ptw = ptb[2] - ptb[0]
            draw_16_9.rectangle([cx - ptw//2 - 25, cy + 230, cx + ptw//2 + 25, cy + 275], fill=(15, 23, 42, 230), outline=(56, 189, 248, 120))
            draw_16_9.text((cx - ptw//2, cy + 240), p_txt, font=FONT_MD, fill=(148, 163, 184))
            
            btn_w, btn_h = 320, 70
            btn_x, btn_y = cx - btn_w//2, cy + 320
            
            pulse_w = int(2 + np.sin(t_sec * 5) * 2)
            draw_16_9.rectangle([btn_x, btn_y, btn_x + btn_w, btn_y + btn_h], fill=(2, 132, 199), outline=(0, 240, 255), width=pulse_w)
            
            cta_txt = "BOOK A DEMO"
            ctb = FONT_LG.getbbox(cta_txt)
            ctw = ctb[2] - ctb[0]
            draw_16_9.text((btn_x + (btn_w - ctw)//2, btn_y + 15), cta_txt, font=FONT_LG, fill=(255, 255, 255))
            
            if t_sec >= 58.5:
                fade_alpha = int(((t_sec - 58.5) / 1.5) * 255)
                draw_16_9.rectangle([0, 0, WIDTH_16_9, HEIGHT_16_9], fill=(0, 0, 0, fade_alpha))

        # --- END OF 16:9 RENDERING LOGIC ---
        
        # 2. Create new 1:1 X Canvas (1080x1080)
        x_canvas_pil = Image.new("RGB", (WIDTH_X, HEIGHT_X), (11, 15, 25))
        x_draw = ImageDraw.Draw(x_canvas_pil, "RGBA")
        
        # 3. Resize 16:9 PIL frame directly using PIL's optimized resize (BILINEAR is extremely fast)
        resized_frame_pil = pil_frame_16_9.resize((1080, 608), BILINEAR)
        
        # 4. Paste the resized video feed in the center (Y: 180 to 788)
        x_canvas_pil.paste(resized_frame_pil, (0, 180))
        
        # 6. Draw X-specific diagnostic panels on top and bottom
        draw_x_top_banner(x_draw, t_sec)
        draw_x_bottom_banner(x_draw, t_sec)
        
        # 7. Convert canvas back to numpy array for encoding
        final_rgb = np.array(x_canvas_pil, dtype=np.uint8)
        
        # 8. Write to FFmpeg pipe
        proc.stdin.write(final_rgb.tobytes())
        
        if f_idx % 10 == 0:
            elapsed = time.time() - start_time
            print(f"X Video Rendered {f_idx}/{TOTAL_FRAMES} frames ({t_sec:.1f}s / 60s) - Elapsed: {elapsed:.1f}s", flush=True)
            
    proc.stdin.close()
    proc.wait()
    print(f"Finished rendering full X video to {OUTPUT_VIDEO}!")

if __name__ == "__main__":
    render_ad_frames()
