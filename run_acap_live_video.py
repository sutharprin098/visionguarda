#!/usr/bin/env python3
import sys, os
sys.path.insert(0, os.path.abspath("ACAP"))
from ACAP.run_acap_live_video import run_acap_live_pipeline, DEFAULT_VIDEO_URL

if __name__ == "__main__":
    url = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_VIDEO_URL
    run_acap_live_pipeline(url)
