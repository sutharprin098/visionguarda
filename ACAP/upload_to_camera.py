#!/usr/bin/env python3
"""
Upload EAP to Axis camera using requests library (handles Digest auth automatically).
"""
import requests
import os
import warnings
warnings.filterwarnings('ignore')

host = 'http://195.60.68.14:12116'
eap_path = r'd:\camAI\ACAP\camai_edge_1_0_0_armv7hf.eap'

# Try both credential variants
credentials_to_try = [
    ('VLTUser', 'IP3-uoACkoVbfh'),
    ('VLTuser', 'IP3-uoACkoVbfh'),
    ('root',    'IP3-uoACkoVbfh'),
]

with open(eap_path, 'rb') as f:
    eap_data = f.read()

print('EAP file: %s (%d bytes)' % (eap_path, len(eap_data)))

url = host + '/axis-cgi/applications/upload.cgi'
print('Upload URL:', url)

for username, password in credentials_to_try:
    print('\nTrying user: %s' % username)
    auth = requests.auth.HTTPDigestAuth(username, password)
    
    files = {
        'packfil': ('camai_edge_1_0_0_armv7hf.eap', eap_data, 'application/octet-stream')
    }
    
    try:
        resp = requests.post(url, files=files, auth=auth, timeout=60, verify=False)
        print('HTTP %d' % resp.status_code)
        print('Response:', resp.text[:1000])
        if resp.status_code == 200:
            print('\n=== UPLOAD SUCCESS ===')
            break
        elif resp.status_code == 401:
            print('Auth failed for this user.')
        else:
            print('Unexpected status.')
    except Exception as ex:
        print('Error:', str(ex))
