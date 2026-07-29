"""Recorder resource-lifecycle contract.

Every check here corresponds to a defect that was live in the shipped engine
and that showed up to operators as one of: runaway memory, high CPU, a pile of
idle ffmpeg processes, or a camera reporting "recording" while writing nothing.

The encoder is stubbed out — these are lifecycle tests, not encoding tests, and
launching real ffmpeg processes in CI is exactly the thing being guarded
against.
"""
import time

import numpy as np
import pytest

from app import recorder as R


class FakeWriter:
    """Stands in for _H264Writer and records every spawn."""

    spawns = []

    def __init__(self, file_path, fps, frame_size):
        FakeWriter.spawns.append(file_path)
        self.frames = []
        self._open = True

    def isOpened(self):
        return self._open

    def write(self, frame):
        if self._open:
            self.frames.append(frame.shape)

    def release(self):
        self._open = False


@pytest.fixture
def fake_writer(monkeypatch):
    FakeWriter.spawns = []
    monkeypatch.setattr(R, "_H264Writer", FakeWriter)
    # The DB layer is not under test; recordings are keyed by uuid anyway.
    monkeypatch.setattr(R, "start_recording_entry", lambda *a, **k: None)
    monkeypatch.setattr(R, "end_recording_entry", lambda *a, **k: None)
    return FakeWriter


@pytest.fixture
def rec(fake_writer):
    r = R.CCTVRecorder("test-cam", fps=10)
    yield r
    r.force_stop_all()
    _join(r)


def _drain(recorder, timeout=2.0):
    end = time.time() + timeout
    while time.time() < end and not recorder.queue.empty():
        time.sleep(0.01)
    time.sleep(0.15)


def _join(recorder, timeout=4.0):
    end = time.time() + timeout
    while time.time() < end and recorder.thread.is_alive():
        time.sleep(0.02)


def _frame(h=906, w=1624):
    """A frame at capture resolution, i.e. NOT the recording size."""
    return np.zeros((h, w, 3), dtype=np.uint8)


def test_arming_without_frames_spawns_no_encoder(rec, fake_writer):
    """A camera that never produces a frame must not hold an ffmpeg process.

    Eight active cameras, six of them frameless (an unreachable RTSP host, a
    virtual camera with no source picked) meant six live ffmpeg processes and
    six open, empty .mp4 files for the lifetime of the engine.
    """
    rec.start_continuous()
    _drain(rec)
    assert fake_writer.spawns == []
    # ...but the operator's toggle must still read as on.
    assert rec.is_recording() is True


def test_first_frame_opens_exactly_one_encoder(rec, fake_writer):
    rec.start_continuous()
    rec.push_frame(_frame())
    _drain(rec)
    assert len(fake_writer.spawns) == 1


def test_frames_are_downscaled_before_being_queued(rec):
    """The queue must never hold capture-resolution frames.

    The resize used to happen in the consumer, so a stalled encoder backed the
    queue up with 1000 full-resolution frames — about 4.4 GB for one camera.
    """
    rec.start_continuous()
    rec.push_frame(_frame())
    _drain(rec)
    assert rec.continuous_writer.frames == [(R.RECORDING_HEIGHT, R.RECORDING_WIDTH, 3)]


def test_queue_bound_is_seconds_of_recording_not_a_thousand_frames(rec):
    assert rec.queue.maxsize == 20
    worst_case_bytes = rec.queue.maxsize * R.RECORDING_WIDTH * R.RECORDING_HEIGHT * 3
    assert worst_case_bytes < 25_000_000


def test_push_frame_rate_gates_to_the_recording_fps(rec):
    """The decode loop calls push_frame at SOURCE fps (typically 30) while
    every writer is opened with -framerate RECORDING_FPS (10). Feeding all of
    them through tripled the encode cost and produced 3x-speed playback."""
    rec.start_continuous()
    accepted = calls = 0
    t0 = next_call = time.monotonic()
    while time.monotonic() - t0 < 1.0:
        now = time.monotonic()
        if now < next_call:
            time.sleep(min(0.002, next_call - now))
            continue
        next_call += 1 / 30.0
        calls += 1
        before = rec._next_frame_due
        rec.push_frame(_frame())
        if rec._next_frame_due != before:
            accepted += 1
    assert 25 <= calls <= 35, f"test harness did not run at ~30fps (got {calls})"
    assert 8 <= accepted <= 12, f"expected ~10 accepted, got {accepted}"


def test_dead_encoder_is_unbound_and_replaced_after_a_backoff(rec, fake_writer):
    """A writer whose ffmpeg died stayed bound forever: write() became a silent
    no-op, so the camera reported "recording" while producing nothing."""
    rec.start_continuous()
    rec.push_frame(_frame())
    _drain(rec)
    first = rec.continuous_writer
    first._open = False

    rec._next_frame_due = 0.0
    rec.push_frame(_frame())          # detects the death, arms a short backoff
    _drain(rec)
    assert rec.continuous_writer is None
    assert len(fake_writer.spawns) == 1, "must not respawn instantly"
    assert 0 < rec._continuous_retry_after - time.time() <= 2.5

    time.sleep(2.1)
    rec._next_frame_due = 0.0
    rec.push_frame(_frame())
    _drain(rec)
    assert len(fake_writer.spawns) == 2
    assert rec.continuous_writer is not first


def test_shutdown_releases_writers_even_without_the_sentinel(fake_writer):
    """force_stop_all() clears self.running BEFORE queueing SHUTDOWN, so a
    get() that times out in that window used to exit the loop with both writers
    still open — leaking the ffmpeg process and truncating its .mp4 (no moov
    atom, so nothing can play it back)."""
    r = R.CCTVRecorder("race-cam", fps=10)
    r.start_continuous()
    r.push_frame(_frame())
    _drain(r)
    writer = r.continuous_writer
    assert writer is not None and writer.isOpened()

    r.running = False                 # no sentinel is ever queued
    _join(r)

    assert not r.thread.is_alive()
    assert not writer.isOpened(), "encoder leaked on shutdown"


def test_force_stop_all_disarms_so_nothing_restarts(fake_writer):
    r = R.CCTVRecorder("stop-cam", fps=10)
    r.start_continuous()
    r.push_frame(_frame())
    _drain(r)
    r.force_stop_all()
    _join(r)

    assert r.continuous_armed is False
    assert r.is_recording() is False
    assert r.continuous_writer is None
