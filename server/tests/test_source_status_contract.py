"""
Source-status contract (server/app/ai/pipeline.py).

"No video" and "video, but nothing in it" are different facts, and a client can
only tell them apart if the engine says which one it is.

The bug this suite pins: a camera whose source never opened — wrong RTSP
address, unplugged webcam, a YouTube link whose video was taken down, a virtual
camera nobody picked a source for — reported

    {"status": "no_human", "detections": [], "fps": 0.0, ...}

which is exactly what a healthy camera watching an empty room reports. That is a
positive claim that the detector ran and found no people, made about a camera
the detector has never been handed a single pixel from. The operator sees a
blank view with a confident readout, and concludes the AI has stopped working.

The rules:

  1. A camera that has never processed a frame MUST NOT report an analytic
     result. "no_human" is a measurement; "connecting" is a state.
  2. Every payload carries health_status, so a client can always tell whether
     `detections` is a measurement or a placeholder.
  3. When the source is unhealthy there is a human-readable reason attached.
     Nothing here invents wording when a more specific message exists — the
     extractor's own error wins, because "This video is not available" beats
     anything this layer could guess.
"""
import pytest

from app.ai.pipeline import PipelineCoordinator


def make_coordinator(source_type="rtsp", source="rtsp://198.51.100.7:554/s1"):
    """A coordinator WITHOUT starting any threads.

    __init__ builds the initial telemetry stub and the health state, which is
    all this contract concerns. Starting the pipeline would open sockets and
    load a model — neither is needed to assert what the engine reports about a
    source it cannot read.
    """
    return PipelineCoordinator(
        camera_id="contract-cam",
        name="Contract Cam",
        source_type=source_type,
        source=source,
        zones_json="[]",
        lines_json="[]",
        # Never called: nothing here runs inference. A lambda keeps the
        # constructor honest without loading a model.
        backend_getter=lambda: None,
    )


# --- Rule 1: never fabricate an analytic result for a frameless camera -------

def test_camera_before_first_frame_does_not_claim_no_human():
    """The stub returned by /api/cameras/{id}/telemetry until a frame lands."""
    pc = make_coordinator()
    assert pc.latest_telemetry["status"] != "no_human", (
        "a camera that has never received a frame reported 'no_human', which "
        "states the detector ran and found nobody"
    )
    assert pc.latest_telemetry["status"] == "connecting"


def test_camera_before_first_frame_reports_no_detections():
    """Empty is right — it's the accompanying *claim* that was wrong."""
    pc = make_coordinator()
    assert pc.latest_telemetry["detections"] == []
    assert pc.latest_telemetry["people"] == 0


# --- Rule 2: health_status is always present --------------------------------

def test_initial_telemetry_carries_health_status():
    pc = make_coordinator()
    assert pc.latest_telemetry["health_status"] == "connecting"
    assert "source_error" in pc.latest_telemetry


def test_status_push_reports_current_health_not_an_analytic_verdict():
    pc = make_coordinator()
    pc._health_status = "network_error"
    pc._cap_consecutive_failures = 4
    pc._last_status_push_ts = 0.0  # defeat the rate limiter

    pc.publish_source_status()

    tel = pc.latest_telemetry
    assert tel["health_status"] == "network_error"
    assert tel["status"] == "network_error", (
        "a status-only push must not leave an analytic verdict in `status`"
    )
    assert tel["detections"] == []
    assert tel["cap_consecutive_failures"] == 4


def test_status_push_reaches_the_websocket_callback():
    """A frameless camera emits nothing on the WS without this.

    Modules 5 and 6 only run off a decoded frame, so the desktop subscribes to a
    dead camera and then waits forever — which renders identically to a working
    camera detecting nothing.
    """
    pc = make_coordinator()
    seen = []
    pc.telemetry_callback = seen.append
    pc._health_status = "offline"
    pc._last_status_push_ts = 0.0

    pc.publish_source_status()

    assert len(seen) == 1, "status push did not reach the telemetry callback"
    assert "contract-cam" in seen[0]
    assert seen[0]["contract-cam"]["health_status"] == "offline"


def test_status_push_is_rate_limited():
    """The capture retry cadence is far faster than anything a human reads."""
    pc = make_coordinator()
    seen = []
    pc.telemetry_callback = seen.append
    pc._health_status = "offline"
    pc._last_status_push_ts = 0.0

    pc.publish_source_status(min_interval=60.0)
    pc.publish_source_status(min_interval=60.0)
    pc.publish_source_status(min_interval=60.0)

    assert len(seen) == 1, f"expected the rate limiter to collapse 3 pushes, got {len(seen)}"


# --- Rule 3: an unhealthy source explains itself ----------------------------

def test_healthy_source_has_no_error_text():
    pc = make_coordinator()
    pc._health_status = "online"
    assert pc.source_error_text() is None


@pytest.mark.parametrize("health,expect_substring", [
    ("network_error", "unreachable"),
    ("auth_failed", "credentials"),
    ("offline", "stopped sending frames"),
])
def test_each_failure_mode_explains_itself(health, expect_substring):
    pc = make_coordinator()
    pc._health_status = health
    text = pc.source_error_text()
    assert text, f"{health} produced no operator-readable reason"
    assert expect_substring in text


def test_resolver_error_wins_over_generic_classification():
    """The extractor knows the actual reason; don't paper over it."""
    pc = make_coordinator(source="https://www.youtube.com/watch?v=deadbeef")
    pc._health_status = "network_error"
    pc._resolve_error = "This video is not available"

    text = pc.source_error_text()
    assert "This video is not available" in text, (
        "the specific extractor message was replaced by a generic one"
    )


def test_unpicked_screenshare_says_so_rather_than_looking_like_a_dead_camera():
    pc = make_coordinator(source_type="screenshare", source="push")
    pc._health_status = "connecting"
    text = pc.source_error_text()
    assert text and "sharing" in text.lower()


def test_usb_device_failure_names_the_device_not_the_network():
    pc = make_coordinator(source_type="usb", source="0")
    pc._health_status = "offline"
    text = pc.source_error_text()
    assert "USB" in text or "webcam" in text
    assert "unreachable" not in text, "a local device was described as a network fault"
