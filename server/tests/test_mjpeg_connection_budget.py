"""
MJPEG stream lifetime contract (/api/cameras/{id}/stream in server/app/main.py).

WHY THIS SUITE EXISTS

A browser holds one connection open for as long as an MJPEG response is open,
and Chromium allows only SIX per host. The stream generator used to be

    while thread.running:
        if there is a new frame: yield it
        await asyncio.sleep(0.03)

with no exit. A camera producing no frames — wrong RTSP address, expired stream
link, virtual camera nobody is sharing to — therefore held its connection open
forever while sending zero bytes.

Six such cameras and the renderer cannot open a SEVENTH connection to the engine
at all. The health poll, /api/status, the alerts fetch and every control write
queue behind streams that will never send a byte. The engine is healthy and
answering; the desktop reports it unreachable and shows no detections on ANY
camera, including the ones that work. "The software isn't detecting."

The rule: a stream with no video to send must END, so the connection is
returned. The client retries on error, which is a request that completes rather
than one pinned open indefinitely.

The counter-rule, equally important: a HEALTHY camera must never be cut off just
because it paused briefly between frames. The grace window is measured from the
last frame actually sent, not from when the response started.
"""
import time

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.camera_manager import manager


class FakeThread:
    """Stands in for a PipelineCoordinator.

    The endpoint only ever touches `.running` and `.current_jpeg_bytes`, so a
    real pipeline (model load, capture threads, sockets) is not needed to pin
    the connection-lifetime behaviour this suite is about.
    """

    def __init__(self):
        self.running = True
        self.current_jpeg_bytes = None
        self._health_status = "connecting"
        self.latest_telemetry = {}


@pytest.fixture
def fake_camera():
    cam_id = "mjpeg-contract-cam"
    thread = FakeThread()
    manager.camera_threads[cam_id] = thread
    yield cam_id, thread
    manager.camera_threads.pop(cam_id, None)


def test_unknown_camera_is_rejected_not_streamed(fake_camera):
    r = TestClient(app).get("/api/cameras/no-such-camera/stream")
    assert r.status_code == 404


def test_a_camera_with_no_frames_ends_the_stream(fake_camera):
    """The bug: this used to never return, pinning a connection forever."""
    cam_id, thread = fake_camera
    assert thread.current_jpeg_bytes is None

    started = time.time()
    # If the endpoint regresses to an endless generator this call never returns
    # and the suite hangs rather than failing — which is itself the signal, but
    # the elapsed-time assertion below documents the intent.
    client = TestClient(app)
    r = client.get("/api/cameras/{}/stream".format(cam_id))
    body = r.content
    elapsed = time.time() - started

    assert r.status_code == 200
    assert body == b"", "a camera with no video sent bytes"
    assert elapsed < 30, (
        f"stream took {elapsed:.1f}s to end — the no-frame grace window is not "
        f"bounding it, so the connection is effectively pinned"
    )


def test_a_streaming_camera_sends_its_frames(fake_camera):
    """The counter-rule: real video still gets through untouched."""
    cam_id, thread = fake_camera
    thread.current_jpeg_bytes = b"\xff\xd8JPEGDATA\xff\xd9"

    client = TestClient(app)
    r = client.get("/api/cameras/{}/stream".format(cam_id))
    body = r.content

    assert r.status_code == 200
    assert b"JPEGDATA" in body, "a camera with frames did not deliver them"
    assert b"--frame" in body, "multipart boundary missing from the MJPEG stream"


def test_stream_ends_when_the_camera_stops(fake_camera):
    """A stopped pipeline must release the connection immediately."""
    cam_id, thread = fake_camera
    thread.running = False

    started = time.time()
    client = TestClient(app)
    r = client.get("/api/cameras/{}/stream".format(cam_id))
    body = r.content
    elapsed = time.time() - started

    assert r.status_code == 200
    assert body == b""
    assert elapsed < 5, f"a stopped camera held the connection {elapsed:.1f}s"
