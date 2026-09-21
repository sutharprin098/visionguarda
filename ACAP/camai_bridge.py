#!/usr/bin/env python3
"""
CamAI Environment Integration Bridge
Bridges AXIS Camera ACAP instances to CamAI Desktop, FastAPI Server, and Supabase Cloud.
"""

import requests
import json
import time

class CamAIACAPBridge:
    def __init__(self, camera_ip, username="root", password=""):
        self.camera_ip = camera_ip
        self.username = username
        self.password = password
        self.base_url = f"http://{camera_ip}"

    def update_camera_config(self, conf_threshold=0.45, roi_coords=None, overlay=True):
        """Pushes Desktop / Portal rules to Axis Camera via VAPIX axparameter"""
        url = f"{self.base_url}/axis-cgi/param.cgi"
        params = {
            "action": "update",
            "camai_acap.ConfidenceThreshold": str(conf_threshold),
            "camai_acap.EnableOverlay": "true" if overlay else "false"
        }
        if roi_coords:
            params["camai_acap.IntrusionROICoords"] = roi_coords

        try:
            res = requests.get(url, params=params, auth=(self.username, self.password), timeout=5)
            print(f"[Bridge] Synced settings to Camera {self.camera_ip}: Status {res.status_code}")
            return res.status_code == 200
        except Exception as e:
            print(f"[Bridge] Connection error to camera {self.camera_ip}: {e}")
            return False

    def forward_event_to_supabase(self, supabase_url, alert_payload):
        """Forwards CamAI ACAP event payload to Supabase Edge Function"""
        endpoint = f"{supabase_url}/functions/v1/report-events"
        headers = {"Content-Type": "application/json"}
        try:
            res = requests.post(endpoint, json=alert_payload, headers=headers, timeout=5)
            print(f"[Bridge] Forwarded event to Supabase: Status {res.status_code}")
            return res.status_code == 200
        except Exception as e:
            print(f"[Bridge] Cloud sync error: {e}")
            return False

if __name__ == "__main__":
    print("=== CamAI ACAP Environment Bridge Tool ===")
    bridge = CamAIACAPBridge("192.168.1.100", "root", "pass")
    bridge.update_camera_config(0.55, "100,100;500,100;500,400;100,400", True)
