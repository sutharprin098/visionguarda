#!/usr/bin/env python3
"""
CamAI Workspace Cleanup Tool
Removes temporary video files, audio renders, frame crops, track JSONs, and scratch render scripts.
Preserves all core workspaces (ACAP, desktop, server, portal, supabase, mobile, docs).
"""

import os
import shutil

def cleanup_workspace():
    root_dir = os.path.dirname(os.path.abspath(__file__))
    print("==================================================")
    print(" CamAI Workspace Cleanup Utility                  ")
    print("==================================================")

    # Core files and directories to PRESERVE
    preserve_set = {
        "ACAP", "desktop", "server", "portal", "supabase", "mobile", "docs", "overview_site",
        "benchmark", "platform-tools", "videos", ".git", ".gitignore", "package.json",
        "package-lock.json", "README.md", "LICENSE", "CHANGELOG.md", "vercel.json",
        "CamAI_IP_Sale_Executive_Teaser.md", "clean_temp_files.py"
    }

    deleted_count = 0
    freed_bytes = 0

    items = os.listdir(root_dir)
    for item in items:
        if item in preserve_set:
            continue

        item_path = os.path.join(root_dir, item)

        # Remove video files, avi, mp4, mp3, png, json tracks, and scratch render python scripts
        if item.endswith(('.mp4', '.avi', '.mp3', '.png', '.json', '.py', '.m4a')) or os.path.isdir(item_path):
            try:
                if os.path.isdir(item_path):
                    shutil.rmtree(item_path)
                    print(f"[CLEANED DIR]  {item}/")
                else:
                    size = os.path.getsize(item_path)
                    freed_bytes += size
                    os.remove(item_path)
                    print(f"[CLEANED FILE] {item} ({size / (1024*1024):.2f} MB)")
                deleted_count += 1
            except Exception as e:
                print(f"[!] Could not remove {item}: {e}")

    # Remove temporary test_cameras.py in ACAP if exists
    acap_test_cam = os.path.join(root_dir, "ACAP", "test_cameras.py")
    if os.path.exists(acap_test_cam):
        try:
            os.remove(acap_test_cam)
            print("[CLEANED FILE] ACAP/test_cameras.py")
        except Exception:
            pass

    freed_mb = freed_bytes / (1024 * 1024)
    print("\n==================================================")
    print(f" [SUCCESS] Workspace Cleaned Cleanly!            ")
    print(f" Total Items Removed: {deleted_count}")
    print(f" Total Disk Space Freed: {freed_mb:.2f} MB")
    print("==================================================")

if __name__ == "__main__":
    cleanup_workspace()
