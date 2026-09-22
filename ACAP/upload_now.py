#!/usr/bin/env python3
"""
Upload freshly built EAP directly to Axis camera via VAPIX API
"""
import requests
import warnings
warnings.filterwarnings('ignore')

host = 'http://195.60.68.14:12116'
eap_path = r'd:\camAI\ACAP\camai_acap_1_0_0_armv7hf.eap'

with open(eap_path, 'rb') as f:
    eap_data = f.read()

print(f"Uploading EAP: {eap_path} ({len(eap_data)} bytes)")

url = host + '/axis-cgi/applications/upload.cgi'
print("Target URL:", url)

credentials = [
    ('VLTuser', 'IP3-uoACkoVbfh'),
    ('root', 'IP3-uoACkoVbfh'),
    ('VLTUser', 'IP3-uoACkoVbfh'),
]

for user, password in credentials:
    print(f"\n[*] Trying authentication with user: {user}...")
    auth = requests.auth.HTTPDigestAuth(user, password)
    files = {
        'packfil': ('camai_acap_1_0_0_armv7hf.eap', eap_data, 'application/octet-stream')
    }
    try:
        r = requests.post(url, files=files, auth=auth, timeout=30, verify=False)
        print(f"    HTTP Status: {r.status_code}")
        print(f"    Response text:\n{r.text[:500]}")
        if r.status_code == 200:
            print("\n=========================================")
            print(" 🎉 CAMERA EAP UPLOAD SUCCESSFUL!")
            print("=========================================")
            break
    except Exception as e:
        print(f"    Exception: {e}")
