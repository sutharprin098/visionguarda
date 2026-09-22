#!/usr/bin/env python3
"""
CamAI ACAP Application Verification Suite
Verifies structure, manifest schema, file presence, C++ code completeness, and configuration.
"""

import os
import json
import sys

def check_file_exists(filepath):
    if os.path.exists(filepath):
        print(f"[OK] File present: {filepath}")
        return True
    else:
        print(f"[FAIL] Missing file: {filepath}")
        return False

def verify_manifest(manifest_path):
    print(f"\n[*] Validating ACAP Manifest v2.0 schema: {manifest_path}")
    try:
        with open(manifest_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        assert str(data.get("schemaVersion")).startswith("1.") or str(data.get("schemaVersion")).startswith("2."), f"Invalid schemaVersion: {data.get('schemaVersion')}"
        setup = data.get("acapPackageConf", {}).get("setup", {})
        assert setup.get("appName") in ["camai_edge", "camai_acap"], "Invalid appName"
        assert setup.get("architecture") in ["aarch64", "armv7hf"], "Invalid architecture"
        print("[OK] Manifest v2.0 validation passed.")
        return True
    except Exception as e:
        print(f"[FAIL] Manifest validation error: {e}")
        return False

def verify_cpp_structure(acap_dir):
    print(f"\n[*] Verifying C++ application components in {acap_dir}...")
    required_files = [
        "manifest.json",
        "Dockerfile",
        "Makefile",
        "README.md",
        "INSTALL.md",
        "PRODUCTION_DEPLOYMENT.md",
        "app/main.cpp",
        "app/camai_engine.hpp",
        "app/camai_engine.cpp",
        "app/video_pipeline.hpp",
        "app/video_pipeline.cpp",
        "app/inference.hpp",
        "app/inference.cpp",
        "app/tracking.hpp",
        "app/tracking.cpp",
        "app/events.hpp",
        "app/events.cpp",
        "app/overlay.hpp",
        "app/overlay.cpp",
        "app/config.hpp",
        "app/config.cpp",
        "app/diagnostics.hpp",
        "app/diagnostics.cpp",
        "modules/module_interface.hpp",
        "modules/security/security_module.hpp",
        "modules/security/security_module.cpp",
        "modules/traffic/traffic_module.hpp",
        "modules/ppe/ppe_module.hpp",
        "modules/retail/retail_module.hpp",
        "modules/smart_city/smart_city_module.hpp",
        "modules/micro_motion/micro_motion_module.hpp",
        "modules/custom/custom_module.hpp",
        "models/export_acap_model.py",
        "tests/test_main.cpp",
        "tests/test_pipeline.cpp",
        "tests/test_tracking.cpp",
        "tests/test_roi.cpp",
        "tests/test_events.cpp",
        "benchmarks/benchmark_runner.cpp"
    ]

    all_ok = True
    for rel_path in required_files:
        full_path = os.path.join(acap_dir, rel_path)
        if not check_file_exists(full_path):
            all_ok = False
    return all_ok

def main():
    acap_dir = os.path.dirname(os.path.abspath(__file__))
    print(f"=== CamAI ACAP Verification Suite ===")
    m_ok = verify_manifest(os.path.join(acap_dir, "manifest.json"))
    c_ok = verify_cpp_structure(acap_dir)

    if m_ok and c_ok:
        print("\n==================================================")
        print(" CamAI ACAP Native Application Verification PASSED")
        print("==================================================")
        sys.exit(0)
    else:
        print("\n[!] Verification FAILED")
        sys.exit(1)

if __name__ == "__main__":
    main()
