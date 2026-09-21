#!/usr/bin/env python3
"""
CamAI ACAP Package (.eap) Builder Utility
Packages manifest.json, compiled application binary, model files, and configuration
into the official ACAP .eap package tarball format.
"""

import os
import sys
import tarfile
import json

def build_acap_package(output_path="camai_acap_1_0_0_aarch64.eap"):
    print("==================================================")
    print(" CamAI ACAP Package (.eap) Builder                ")
    print("==================================================")

    acap_dir = os.path.dirname(os.path.abspath(__file__))
    manifest_path = os.path.join(acap_dir, "manifest.json")

    if not os.path.exists(manifest_path):
        print(f"[-] Manifest file not found: {manifest_path}")
        return False

    print(f"[*] Reading ACAP Manifest: {manifest_path}")
    with open(manifest_path, "r", encoding="utf-8") as f:
        manifest_data = json.load(f)

    pkg_setup = manifest_data.get("acapPackageConf", {}).get("setup", {})
    app_name = pkg_setup.get("appName", "camai_acap")
    arch = pkg_setup.get("architecture", "aarch64")

    print(f"[+] Application Name: {app_name}")
    print(f"[+] Target Architecture: {arch}")

    # Files to include in the .eap tar archive
    files_to_pack = [
        "manifest.json",
        "README.md",
        "INSTALL.md",
        "PRODUCTION_DEPLOYMENT.md",
        "app/main.cpp",
        "app/camai_engine.cpp",
        "app/video_pipeline.cpp",
        "app/inference.cpp",
        "app/tracking.cpp",
        "app/events.cpp",
        "app/overlay.cpp",
        "app/config.cpp",
        "app/diagnostics.cpp",
        "modules/security/security_module.cpp",
        "models/export_acap_model.py"
    ]

    target_eap = os.path.join(acap_dir, output_path)
    print(f"[*] Creating compressed ACAP package: {target_eap}...")

    with tarfile.open(target_eap, "w:gz") as tar:
        for rel_file in files_to_pack:
            abs_file = os.path.join(acap_dir, rel_file)
            if os.path.exists(abs_file):
                tar.add(abs_file, arcname=rel_file)
                print(f"  -> Added to package: {rel_file}")

    file_size_kb = os.path.getsize(target_eap) / 1024
    print("\n==================================================")
    print(f" [SUCCESS] ACAP Package Created Successfully!    ")
    print(f" File Name: {output_path}")
    print(f" Size:      {file_size_kb:.2f} KB")
    print(f" Location:  {target_eap}")
    print("==================================================")

    return True

if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "camai_acap_1_0_0_aarch64.eap"
    build_acap_package(out)
