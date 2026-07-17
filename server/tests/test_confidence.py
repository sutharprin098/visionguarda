"""
Detection confidence contract (server/app/ai/pipeline.py + /api/detection/confidence).

WHY THIS SUITE EXISTS:

`ai.confidence` was a setting in name only. The portal wrote it to `settings` on
every save (Settings.tsx, key `ai.confidence`, derived from the sensitivity
picker), the column had been in the schema since 0002_cameras_gis_ai.sql — and
NOTHING on either side ever read it. The engine ran a hardcoded 0.25. An admin
dragging detection sensitivity changed a database row, got a success toast, and
changed nothing at all about what the cameras detected. There was no error to
find, because nothing failed; the value simply had no reader.

That is the same shape as the fabricated-detection class this codebase has been
bitten by before, and the reason these tests assert the WIRE, not just the maths:
a threshold that is settable but unread looks identical, from the outside, to one
that works.

The rules pinned here:

  1. The value an operator sets is the value the detector uses. Not a default
     that happens to match it, and not a value the API echoed back without
     storing.
  2. Out-of-range input clamps rather than blinding every camera in the org, and
     the APPLIED value is what the API reports — so an admin is never shown a
     number the detector isn't actually running.
  3. The crowded-scene relaxation stays proportional to the operator's choice.
     It used to be a hardcoded 0.15; if it stayed hardcoded, a strict setting
     would silently collapse back to lenient the moment a scene filled up.
"""
import pytest
from fastapi.testclient import TestClient

from app.ai.pipeline import (
    CROWDED_CONF_RATIO,
    DEFAULT_CONFIDENCE,
    MAX_CONFIDENCE,
    MIN_CONFIDENCE,
    get_detection_confidence,
    set_detection_confidence,
)
from app.main import app


@pytest.fixture(autouse=True)
def _restore_default():
    """The threshold is process-wide state; leaking a test's value into the next
    one would make failures depend on test order."""
    yield
    set_detection_confidence(DEFAULT_CONFIDENCE)


@pytest.fixture
def client():
    return TestClient(app)


# --- the value an operator sets is the value the detector reads --------------

def test_set_confidence_is_what_the_detector_reads():
    set_detection_confidence(0.55)
    assert get_detection_confidence() == 0.55


def test_default_matches_the_threshold_the_engine_shipped_with():
    # Not cosmetic: an engine that starts on a different floor than it always
    # had would change every existing deployment's detections on upgrade, before
    # any admin touches anything.
    assert DEFAULT_CONFIDENCE == 0.25


# --- clamping ---------------------------------------------------------------

@pytest.mark.parametrize(
    "requested,expected",
    [
        (0.95, MAX_CONFIDENCE),   # above the top: would report almost nothing
        (1.5, MAX_CONFIDENCE),
        (0.01, MIN_CONFIDENCE),   # below the floor: would emit mostly noise
        (0.0, MIN_CONFIDENCE),
        (-1.0, MIN_CONFIDENCE),
    ],
)
def test_out_of_range_clamps_instead_of_blinding_every_camera(requested, expected):
    assert set_detection_confidence(requested) == expected
    assert get_detection_confidence() == expected


def test_in_range_values_pass_through_untouched():
    for v in (0.1, 0.25, 0.4, 0.55, 0.9):
        assert set_detection_confidence(v) == v


def test_setter_returns_the_applied_value_not_the_requested_one():
    # The caller reports this to an admin. Echoing the request back would show a
    # number the detector is not using.
    assert set_detection_confidence(0.95) == MAX_CONFIDENCE


# --- crowded-scene relaxation stays relative to the operator's choice --------

def test_crowded_ratio_reproduces_the_old_hardcoded_pair():
    # The threshold pair used to be literally `0.15 if n_tracks > 5 else 0.25`.
    # At the default, the ratio must reproduce that exactly, or this refactor
    # silently retunes every camera that never changed the setting.
    assert round(DEFAULT_CONFIDENCE * CROWDED_CONF_RATIO, 3) == 0.15


def test_crowded_threshold_stays_below_the_operators_floor():
    # The whole point of the relaxation: half-occluded objects in a busy scene
    # must still register. A ratio >= 1 would defeat it.
    assert 0 < CROWDED_CONF_RATIO < 1


def test_a_strict_setting_stays_strict_when_the_scene_fills_up():
    # With the old hardcoded 0.15, an admin who set 0.8 got 0.15 in a crowd —
    # their choice inverted exactly when it mattered most.
    strict = 0.8
    assert strict * CROWDED_CONF_RATIO > DEFAULT_CONFIDENCE * CROWDED_CONF_RATIO


# --- the HTTP wire the desktop actually uses --------------------------------

def test_post_changes_what_the_running_engine_holds(client):
    res = client.post("/api/detection/confidence", json={"confidence": 0.4})
    assert res.status_code == 200
    assert res.json() == {"success": True, "confidence": 0.4}
    # The assertion that would have caught the original bug: the API did not just
    # answer, it moved the value the AI loop reads.
    assert get_detection_confidence() == 0.4


def test_get_reports_what_the_engine_holds(client):
    set_detection_confidence(0.35)
    assert client.get("/api/detection/confidence").json() == {"confidence": 0.35}


def test_post_reports_the_clamped_value(client):
    # localEngine.syncAiConfidenceToLocalEngine compares the desktop's setting
    # against this response to decide whether a push is still needed. If it
    # reported the requested 0.95 while holding 0.9, that comparison would never
    # settle and the desktop would re-push on every tick, forever.
    assert client.post("/api/detection/confidence", json={"confidence": 0.95}).json() == {
        "success": True,
        "confidence": MAX_CONFIDENCE,
    }


def test_get_after_clamped_post_agrees_with_the_post(client):
    client.post("/api/detection/confidence", json={"confidence": 0.95})
    assert client.get("/api/detection/confidence").json()["confidence"] == MAX_CONFIDENCE


def test_non_numeric_is_rejected_rather_than_silently_ignored(client):
    assert client.post("/api/detection/confidence", json={"confidence": "abc"}).status_code == 422
    assert get_detection_confidence() == DEFAULT_CONFIDENCE
