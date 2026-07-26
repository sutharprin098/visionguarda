import os
import imageio_ffmpeg
import subprocess

ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
out_dir = r"d:\camAI\portal\public\videos"
os.makedirs(out_dir, exist_ok=True)

files = [
    ("junction", r"d:\camAI\dtest\vIDEO\features-annotated.mp4", os.path.join(out_dir, "junction.mp4")),
    ("speed", r"d:\camAI\dtest\vIDEO\speed_detected.mp4", os.path.join(out_dir, "speed.mp4")),
    ("helmet", r"d:\camAI\dtest\vIDEO\bikes_helmet_detected.mp4", os.path.join(out_dir, "helmet.mp4")),
    ("humans", r"d:\camAI\dtest\vIDEO\humans_detected.mp4", os.path.join(out_dir, "humans.mp4")),
]

for name, src, dst in files:
    print(f"Converting {name}: {src} -> {dst}...")
    cmd = [
        ffmpeg, "-y",
        "-i", src,
        "-c:v", "libx264",
        "-preset", "fast",
        "-crf", "23",
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        dst
    ]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode == 0:
        size_mb = os.path.getsize(dst) / (1024 * 1024)
        print(f"SUCCESS {name}: {size_mb:.2f} MB")
    else:
        print(f"FAILED {name}:\n{res.stderr}")
