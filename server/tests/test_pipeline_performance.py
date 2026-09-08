from app.ai.pipeline import _LatencyWindow


def test_latency_window_reports_bounded_percentiles():
    window = _LatencyWindow(size=5)
    for value in (10, 20, 30, 40, 50, 60):
        window.add(value)

    assert window.summary() == {
        "samples": 5,
        "average_ms": 40.0,
        "p50_ms": 40.0,
        "p95_ms": 60.0,
    }


def test_latency_window_ignores_invalid_samples():
    window = _LatencyWindow()
    for value in (None, "invalid", -1):
        window.add(value)

    assert window.summary()["samples"] == 0
