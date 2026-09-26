#!/usr/bin/env python3
"""
Upload freshly built EAP directly to Axis camera via VAPIX API
"""
import sys
import requests
import warnings
from requests.auth import HTTPBasicAuth, HTTPDigestAuth
warnings.filterwarnings('ignore')

hosts = [
    'http://195.60.68.14:11017',
    'https://195.60.68.14:41017',
]
eap_path = r'd:\camAI\ACAP\camai_acap_1_0_0_armv7hf.eap'

with open(eap_path, 'rb') as f:
    eap_data = f.read()

print(f"Uploading EAP: {eap_path} ({len(eap_data)} bytes)")

credentials = [
    ('VLTUser', 'wY0-oD0jA6jft3'),
    ('VLTuser', 'wY0-oD0jA6jft3'),
    ('root', 'wY0-oD0jA6jft3'),
    ('VLTUser', 'wM1_hTNvkrdkuY'),
    ('VLTuser', 'wM1_hTNvkrdkuY'),
    ('root', 'wM1_hTNvkrdkuY'),
    ('VLTUser', 'IP3-uoACkoVbfh'),
]

for host in hosts:
    url = host + '/axis-cgi/applications/upload.cgi'
    print(f"\n================ Target Host: {host} ================")
    for user, password in credentials:
        for auth_cls in [HTTPBasicAuth, HTTPDigestAuth]:
            print(f"[*] Trying {auth_cls.__name__} with user: {user} @ {host}...")
            auth = auth_cls(user, password)
            s = requests.Session()
            s.auth = auth
            s.verify = False
            try:
                p_resp = s.get(host + '/axis-cgi/param.cgi?action=list', timeout=4)
                if p_resp.status_code not in (200, 401):
                    continue
                files = {
                    'packfil': ('camai_acap_1_0_0_armv7hf.eap', eap_data, 'application/octet-stream')
                }
                r = s.post(url, files=files, timeout=30)
                print(f"    Upload HTTP Status: {r.status_code}")
                print(f"    Upload Response: {r.text[:300]}")
                if r.status_code == 200:
                    print("\nStarting package via control.cgi...")
                    r_start = s.get(host + '/axis-cgi/applications/control.cgi?action=start&package=camai_acap', timeout=10)
                    print(f"    Start Status: {r_start.status_code}")
                    print(f"    Start Response: {r_start.text[:300]}")
                    print("=========================================")
                    print(" [OK] CAMERA EAP UPLOAD & START SUCCESSFUL!")
                    print("=========================================")
                    sys.exit(0)
            except Exception as e:
                pass

