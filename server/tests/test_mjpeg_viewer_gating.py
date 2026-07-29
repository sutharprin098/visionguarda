"""The MJPEG preview encode is demand-driven; this pins that contract.

Profiling put cv2.imencode in _decode_loop at 25% of total engine CPU — more
than twice inference — because it ran on every decoded frame at full camera
FPS for every camera, whether or not anyone had ever opened that stream.

Two things must hold, and both fail silently if broken (the picture still
works; only the CPU bill changes):

  * A camera with no viewers must encode nothing.
  * Every HTTP generator must release its viewer count on EVERY exit path,
    including a client that disconnects mid-stream. A leaked count pins the
    camera in "always encoding" for the rest of the process's life.
"""
import asyncio

import pytest

from app import main as M


class StubThread:
    """Minimal stand-in for PipelineCoordinator's viewer-accounting surface.

    Mirrors the real implementation rather than importing it: constructing a
    real coordinator starts capture/AI/tracking threads, which is exactly the
    machinery this test exists to avoid.
    """

    def __init__(self):
        self.running = True
        self.current_jpeg_bytes = None
        self.jpeg_ready_event = None
        self._mjpeg_viewers = 0
        self._next_mjpeg_due = 99999.0

    def mjpeg_viewer_attached(self):
        self._mjpeg_viewers += 1
        self._next_mjpeg_due = 0.0

    def mjpeg_viewer_detached(self):
        self._mjpeg_viewers = max(0, self._mjpeg_viewers - 1)

    def has_mjpeg_viewers(self) -> bool:
        return self._mjpeg_viewers > 0


@pytest.fixture
def stub(monkeypatch):
    t = StubThread()
    monkeypatch.setitem(M.manager.camera_threads, "stubcam", t)
    return t


async def _take(gen, n):
    """Pull n chunks out of the async generator without closing it.

    Note for anyone extending this file: the attach/consume/close sequence must
    happen inside a SINGLE event loop. asyncio.run() finalises pending async
    generators when it tears the loop down, which runs the very `finally` these
    tests are trying to observe — split it across two asyncio.run() calls and
    the release looks like it happened when it did not.
    """
    out = []
    async for chunk in gen:
        out.append(chunk)
        if len(out) >= n:
            break
    return out


def test_no_viewer_means_no_encode(stub):
    """The gate the CPU saving rests on."""
    assert stub.has_mjpeg_viewers() is False


def test_attach_marks_the_next_frame_due_immediately(stub):
    """A newly opened tile must paint on the next frame, not wait out a cap
    interval left over from the previous viewer."""
    stub._next_mjpeg_due = 99999.0
    stub.mjpeg_viewer_attached()
    assert stub._next_mjpeg_due == 0.0
    assert stub.has_mjpeg_viewers() is True


def test_detach_never_goes_negative(stub):
    """A double release would otherwise drive the count below zero and disable
    this camera's preview permanently."""
    stub.mjpeg_viewer_attached()
    stub.mjpeg_viewer_detached()
    stub.mjpeg_viewer_detached()
    stub.mjpeg_viewer_detached()
    assert stub._mjpeg_viewers == 0
    stub.mjpeg_viewer_attached()
    assert stub.has_mjpeg_viewers() is True


def test_concurrent_viewers_are_counted(stub):
    stub.mjpeg_viewer_attached()
    stub.mjpeg_viewer_attached()
    stub.mjpeg_viewer_detached()
    # One viewer left — the camera must keep encoding.
    assert stub.has_mjpeg_viewers() is True
    stub.mjpeg_viewer_detached()
    assert stub.has_mjpeg_viewers() is False


def test_generator_releases_the_count_when_the_client_disconnects(stub):
    """The leak that matters: a tile unmounts or a request is cancelled
    mid-stream. Closing the generator early must still run the finally."""
    stub.current_jpeg_bytes = b"jpegdata"

    async def scenario():
        response = await M.get_mjpeg_stream("stubcam")
        gen = response.body_iterator

        chunks = await _take(gen, 1)
        assert chunks and b"jpegdata" in chunks[0]
        assert stub._mjpeg_viewers == 1, "generator did not register as a viewer"

        # Abandon the stream the way a disconnecting client does.
        await gen.aclose()
        assert stub._mjpeg_viewers == 0, "viewer count leaked on client disconnect"

    asyncio.run(scenario())


def test_sequential_streams_do_not_accumulate_viewers(stub):
    stub.current_jpeg_bytes = b"jpegdata"

    async def scenario():
        for i in range(4):
            response = await M.get_mjpeg_stream("stubcam")
            gen = response.body_iterator
            await _take(gen, 1)
            assert stub._mjpeg_viewers == 1, f"stream {i}: expected exactly one viewer"
            await gen.aclose()
            assert stub._mjpeg_viewers == 0, f"stream {i}: viewer count leaked"

    asyncio.run(scenario())
