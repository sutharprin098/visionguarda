import os
import sys
import zipfile
import time

def zip_directory(src_dir, output_zip):
    print(f"==> Compressing {src_dir} to {output_zip} ...")
    start = time.time()
    count = 0
    with zipfile.ZipFile(output_zip, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
        for root, dirs, files in os.walk(src_dir):
            # Skip python cache directories
            dirs[:] = [d for d in dirs if d not in ("__pycache__", ".pytest_cache", "scratch")]
            for file in files:
                if file.endswith((".pyc", ".pyo", ".tmp")):
                    continue
                full_path = os.path.join(root, file)
                rel_path = os.path.relpath(full_path, src_dir)
                zf.write(full_path, rel_path)
                count += 1
                if count % 500 == 0:
                    print(f"  Archived {count} files...")
    size_mb = os.path.getsize(output_zip) / (1024 * 1024)
    duration = time.time() - start
    print(f"==> SUCCESS: {output_zip} ({size_mb:.2f} MB, {count} files) in {duration:.1f}s")

if __name__ == "__main__":
    server_dir = os.path.dirname(os.path.abspath(__file__))
    src = os.path.join(server_dir, "dist", "camai-engine")
    out = os.path.join(server_dir, "dist", "camai-engine.zip")
    if os.path.exists(out):
        os.remove(out)
    zip_directory(src, out)
