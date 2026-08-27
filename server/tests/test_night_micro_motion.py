import numpy as np

from app.ai.pipeline import PipelineCoordinator
from app.ai.screen_motion_detector import ScreenMicroMotionDetector


def _motion_probe():
    probe = PipelineCoordinator.__new__(PipelineCoordinator)
    probe._prev_motion = None
    probe._prev_motion_full = None
    probe._motion_noise_ema = None
    probe._motion_thr = 0.004
    return probe


def _dark_frame(x=80, y=70, noise=0, seed=1):
    frame = np.full((240, 320, 3), 34, dtype=np.uint8)
    if noise:
        rng = np.random.default_rng(seed)
        jitter = rng.normal(0, noise, frame.shape).astype(np.int16)
        frame = np.clip(frame.astype(np.int16) + jitter, 0, 255).astype(np.uint8)
    frame[y:y + 8, x:x + 8] = (78, 78, 78)
    return frame


def test_low_light_two_pixel_displacement_triggers_motion_gate():
    probe = _motion_probe()
    probe._analyze_motion(_dark_frame(x=80))

    stats = probe._analyze_motion(_dark_frame(x=82))

    assert stats["low_light"] is True
    assert stats["motion"] is True
    assert stats["threshold"] <= 18
    assert stats["latency_ms"] < 50


def test_low_light_camera_noise_does_not_trigger_motion_gate():
    probe = _motion_probe()
    probe._analyze_motion(_dark_frame(noise=1, seed=10))

    stats = probe._analyze_motion(_dark_frame(noise=1, seed=11))

    assert stats["low_light"] is True
    assert stats["motion"] is False


def test_micro_motion_detector_finds_tiny_slow_target_in_dark_scene():
    detector = ScreenMicroMotionDetector(
        min_area=3,
        max_area=8000,
        threshold_value=3,
        history_frames=4,
        max_targets=2,
    )

    detections = []
    for x in (70, 70, 70, 72, 74):
        detections = detector.detect(_dark_frame(x=x, noise=1, seed=x))

    assert detections, "tiny slow target was missed in low light"
    assert detections[0]["class"] == "micro_motion"
    assert detections[0]["confidence"] >= 0.35


def test_micro_motion_detector_rejects_static_dark_noise():
    detector = ScreenMicroMotionDetector(
        min_area=3,
        max_area=8000,
        threshold_value=3,
        history_frames=4,
        max_targets=2,
    )

    detections = []
    for seed in range(20, 26):
        detections = detector.detect(_dark_frame(noise=1, seed=seed))

    assert detections == []
