import os
from PIL import Image

base_png = r"d:\camAI\desktop\build\icon.png"

if not os.path.exists(base_png):
    print(f"Source icon not found at {base_png}")
    exit(1)

img = Image.open(base_png)

res_dir = r"d:\camAI\mobile\android\app\src\main\res"

sizes = {
    "mipmap-mdpi": 48,
    "mipmap-hdpi": 72,
    "mipmap-xhdpi": 96,
    "mipmap-xxhdpi": 144,
    "mipmap-xxxhdpi": 192,
}

for folder, size in sizes.items():
    target_dir = os.path.join(res_dir, folder)
    os.makedirs(target_dir, exist_ok=True)
    resized = img.resize((size, size), Image.Resampling.LANCZOS)
    
    # Save standard launcher icon
    resized.save(os.path.join(target_dir, "ic_launcher.png"))
    resized.save(os.path.join(target_dir, "ic_launcher_round.png"))
    resized.save(os.path.join(target_dir, "ic_launcher_foreground.png"))

print("Android App Icons successfully generated and updated!")
