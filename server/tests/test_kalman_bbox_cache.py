"""get_bbox() is memoised; this pins that the memo can never go stale.

get_bbox profiled at 22% of the entire tracking stage — it is called once per
track per matching pass and O(n^2) times in the duplicate-merge scan, and each
call re-sliced `state` and converted numpy scalars to Python floats. Caching it
is worth real latency, but a stale bbox is far worse than a slow one: it would
feed wrong boxes into IoU matching and draw boxes where objects are not.

The invariant: `_bbox_cache` must be invalidated by every write to `state`.
There are exactly three (__init__, predict, update) and nothing outside the
class touches `state` — only kf.predict/kf.update/kf.get_bbox.
"""
import numpy as np

from app.ai.pipeline import LightweightKalmanFilter


def _kf(bbox=(10.0, 20.0, 50.0, 100.0)):
    return LightweightKalmanFilter(list(bbox))


def test_initial_bbox_round_trips():
    kf = _kf((10.0, 20.0, 50.0, 100.0))
    got = kf.get_bbox()
    assert np.allclose(got, [10.0, 20.0, 50.0, 100.0], atol=1e-3)


def test_repeated_calls_are_stable():
    kf = _kf()
    assert kf.get_bbox() == kf.get_bbox()


def test_returned_list_is_not_shared():
    """Callers index into and may assign to the result; handing out the cached
    object itself would couple every caller together."""
    kf = _kf()
    a = kf.get_bbox()
    b = kf.get_bbox()
    assert a is not b
    a[0] = -12345.0
    assert kf.get_bbox()[0] != -12345.0, "mutating a result corrupted the cache"


def test_predict_invalidates_the_cache():
    kf = _kf()
    before = kf.get_bbox()          # populate the cache
    # Give the filter a velocity so predict actually moves the box.
    kf.state[4] = 100.0             # vx, px/sec
    kf.predict(0.5)
    after = kf.get_bbox()
    assert after[0] != before[0], "predict() returned a stale cached bbox"


def test_update_invalidates_the_cache():
    kf = _kf((10.0, 20.0, 50.0, 100.0))
    before = kf.get_bbox()          # populate the cache
    kf.update([200.0, 300.0, 260.0, 400.0])
    after = kf.get_bbox()
    assert after != before, "update() returned a stale cached bbox"
    # It should have moved towards the measurement, not jumped past it.
    assert after[0] > before[0]


def test_cache_matches_an_uncached_recomputation():
    """Drive a realistic predict/update sequence and compare every cached read
    against the arithmetic computed straight from `state`."""
    def uncached(kf):
        cx, cy, a, h = kf.state[0:4]
        h = max(1.0, float(h)); a = max(0.1, float(a)); w = a * h
        return [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2]

    kf = _kf()
    rng = np.random.default_rng(7)
    for step in range(40):
        kf.predict(1 / 25.0)
        assert np.allclose(kf.get_bbox(), uncached(kf), atol=1e-6), f"drift after predict {step}"
        if step % 3 == 0:
            x1 = float(rng.uniform(0, 500)); y1 = float(rng.uniform(0, 500))
            kf.update([x1, y1, x1 + 40, y1 + 90])
            assert np.allclose(kf.get_bbox(), uncached(kf), atol=1e-6), f"drift after update {step}"
