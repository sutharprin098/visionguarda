import urllib.request
import imageio_ffmpeg
import subprocess

urls = [
    "https://kuqyhceykvisqfyghiot.supabase.co/storage/v1/object/public/demo/JUNCTION-01.mp4",
    "https://kuqyhceykvisqfyghiot.supabase.co/storage/v1/object/public/demo/speed_detected.mp4",
    "https://kuqyhceykvisqfyghiot.supabase.co/storage/v1/object/public/demo/bikes_helmet_detected.mp4",
    "https://kuqyhceykvisqfyghiot.supabase.co/storage/v1/object/public/demo/humans_detected.mp4"
]

ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()

for u in urls:
    try:
        req = urllib.request.Request(u, method='HEAD')
        resp = urllib.request.urlopen(req)
        print(f"URL: {u}\nSTATUS: {resp.status}, CONTENT-TYPE: {resp.headers.get('Content-Type')}, CONTENT-LENGTH: {resp.headers.get('Content-Length')}\n")
    except Exception as e:
        print(f"URL: {u} FAILED: {e}\n")

    # Inspect with ffmpeg
    cmd = [ffmpeg, "-i", u]
    res = subprocess.run(cmd, capture_output=True, text=True)
    print(f"FFMPEG OUTPUT FOR {u.split('/')[-1]}:\n{res.stderr}\n" + "="*50)
