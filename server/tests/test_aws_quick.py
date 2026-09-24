#!/usr/bin/env python3
"""Quick AWS connectivity + inference test."""
import requests, sys, time, base64

aws_url = 'http://13.203.71.14:8000'

print('Testing AWS health...')
try:
    r = requests.get(aws_url + '/health', timeout=5)
    print('  /health: HTTP', r.status_code)
    if r.status_code == 200:
        d = r.json()
        print('  backend_ready =', d.get('backend_ready'), '  device =', d.get('device'))
        print('  frames_received =', d.get('frames_received'), '  frames_processed =', d.get('frames_processed'))
        print('  PASS: AWS is reachable and healthy')
    else:
        print('  FAIL: HTTP', r.status_code)
        sys.exit(1)
except Exception as e:
    print('  FAIL:', e)
    sys.exit(1)

print()
print('Testing /api/detect with synthetic 640x480 frame...')

try:
    import numpy as np
    import cv2
    frame = np.zeros((480, 640, 3), dtype=np.uint8)
    frame[:] = (40, 40, 60)
    cv2.rectangle(frame, (200, 100), (300, 400), (120, 180, 120), -1)
    _, buf = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
    b64 = base64.b64encode(buf.tobytes()).decode()
except Exception as e:
    print('  cv2 not available, using minimal JPEG test:', e)
    # minimal 1x1 white JPEG
    b64 = '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFgABAQEAAAAAAAAAAAAAAAAABgUEB//EAB8QAAIBBAMBAQAAAAAAAAAAAAECAwQFERIhQf/EABUBAQEAAAAAAAAAAAAAAAAAAAEC/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AzW2aVtSbr4t9VbbNbLEaE6l0aRPFN7Oevj3oAKACgAoAKAP/2Q=='

t0 = time.perf_counter()
r = requests.post(aws_url + '/api/detect',
                  json={'image_b64': b64, 'frame_id': 1, 'timestamp_ms': int(time.time()*1000)},
                  timeout=15)
lat = round((time.perf_counter() - t0) * 1000, 1)
print('  HTTP', r.status_code, '  latency =', lat, 'ms')
if r.status_code == 200:
    d = r.json()
    print('  status =', d.get('status'), '  count =', d.get('count'))
    fps = d.get('fps', {})
    print('  fps.input_fps =', fps.get('input_fps'), '  processing_fps =', fps.get('processing_fps'))
    dets = d.get('detections', [])
    if dets:
        for det in dets:
            bbox = det.get('bbox', {})
            print('  DETECTION:', det.get('class'), 'conf =', det.get('confidence'), 'bbox =', bbox)
    else:
        print('  No detections (expected for synthetic frame — real camera required for live detections)')
    print('  PASS: /api/detect is working')
else:
    print('  FAIL: HTTP', r.status_code)
    print('  Body:', r.text[:300])
    sys.exit(1)
