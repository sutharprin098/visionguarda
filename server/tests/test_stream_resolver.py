"""
Page-URL resolution contract (server/app/ai/stream_resolver.py).

A YouTube link is a web page, not a media address. cv2.VideoCapture opens it
in ~1s with isOpened()==False and nothing on stderr, which upstream is
indistinguishable from a camera that is switched off — the capture loop counts
a failed open, escalates backoff, and the camera settles on "offline" with no
reason ever shown. Resolving the page to the manifest behind it is what makes
such a camera work at all.

Two properties this suite exists to enforce:

  1. ONLY page URLs are rewritten. Every camera that exists today is already a
     media address (RTSP, HLS, MJPEG, a file, a device index). Sending one of
     those through an extractor would cost seconds on every reconnect and could
     replace a working address with a worse one, so needs_resolution() is an
     explicit allow-list and resolve() is the identity function off it.

  2. A resolved URL is TREATED AS PERISHABLE. YouTube's manifests are signed
     and expire (~6h on the live stream this was measured against). The cache
     must therefore hold an expiry that comes from the URL itself, and
     force/invalidate must both really drop the entry — otherwise a stream that
     ages out spends its entire reconnect schedule re-opening an address that
     can never succeed again.

Everything here is offline: no test in this file performs an extraction.
"""
import time

import pytest

from app.ai import stream_resolver as sr


@pytest.fixture(autouse=True)
def _clean_cache():
    sr._cache.clear()
    yield
    sr._cache.clear()


# --- 1. Routing -----------------------------------------------------------

@pytest.mark.parametrize("url", [
    "https://www.youtube.com/watch?v=sTF-6_xinUU",
    "https://youtube.com/watch?v=sTF-6_xinUU",
    "https://m.youtube.com/watch?v=sTF-6_xinUU",
    "https://youtu.be/sTF-6_xinUU",
    "https://www.youtube.com/@SomeChannel/live",
    "https://www.twitch.tv/somechannel",
])
def test_page_urls_are_routed_to_the_resolver(url):
    assert sr.needs_resolution(url) is True


@pytest.mark.parametrize("url", [
    "rtsp://admin:pw@192.168.1.64:554/Streaming/Channels/101",
    "https://example.com/live/playlist.m3u8",
    "http://192.168.1.90:8080/video",
    "D:/videos/traffic.mp4",
    "0",
    "",
])
def test_media_addresses_are_never_touched(url):
    assert sr.needs_resolution(url) is False
    assert sr.resolve(url) == url


def test_an_already_resolved_manifest_is_not_re_resolved():
    """The googlevideo host that YouTube resolves ONTO is not itself a page.
    Treating it as one would send the manifest back through the extractor on
    every reconnect, which cannot work — it is not a watch page."""
    url = "https://manifest.googlevideo.com/api/manifest/hls_playlist/expire/1785144686/ei/x"
    assert sr.needs_resolution(url) is False


def test_a_lookalike_domain_is_not_treated_as_youtube():
    """Suffix matching must be on a domain boundary: notyoutube.com is a
    different site, and handing an arbitrary host to the extractor because its
    name ends in the right characters is how an allow-list stops being one."""
    assert sr.needs_resolution("https://notyoutube.com/watch?v=x") is False
    assert sr.needs_resolution("https://gaming.youtube.com/watch?v=x") is True


# --- 2. Expiry ------------------------------------------------------------

def test_expiry_is_read_from_the_hls_path_segment():
    """HLS manifests carry the deadline as a PATH segment
    (…/hls_playlist/expire/<unix>/ei/…), not a query parameter."""
    deadline = time.time() + 6 * 3600
    url = f"https://manifest.googlevideo.com/api/manifest/hls_playlist/expire/{int(deadline)}/ei/x"
    got = sr._expiry_of(url, {})
    assert got == pytest.approx(deadline - sr._EXPIRY_MARGIN_S, abs=1.0)


def test_expiry_is_read_from_the_query_parameter():
    """Progressive URLs carry it as ?expire=<unix> on the same host."""
    deadline = time.time() + 3600
    url = f"https://rr3---sn-x.googlevideo.com/videoplayback?expire={int(deadline)}&ei=x"
    got = sr._expiry_of(url, {})
    assert got == pytest.approx(deadline - sr._EXPIRY_MARGIN_S, abs=1.0)


def test_a_url_with_no_readable_expiry_still_expires():
    """Absent a stated deadline the answer is a bounded default, never
    'never' — an address we cannot date is one we re-check."""
    got = sr._expiry_of("https://example.com/live.m3u8", {})
    assert got == pytest.approx(time.time() + sr._DEFAULT_TTL_S, abs=1.0)


def test_an_expiry_already_in_the_past_is_ignored():
    """A stale deadline would pin the entry to permanently-expired and make
    every single frame trigger a fresh extraction."""
    url = "https://manifest.googlevideo.com/api/manifest/hls_playlist/expire/1000000000/ei/x"
    assert sr._expiry_of(url, {}) > time.time()


def test_the_earliest_deadline_wins():
    soon = int(time.time() + 600)
    late = int(time.time() + 90000)
    url = f"https://manifest.googlevideo.com/api/manifest/hls_playlist/expire/{late}/ei/x?expire={soon}"
    assert sr._expiry_of(url, {}) == pytest.approx(soon - sr._EXPIRY_MARGIN_S, abs=1.0)


# --- 3. Cache behaviour ---------------------------------------------------

def test_a_live_entry_is_served_without_re_extracting(monkeypatch):
    url = "https://www.youtube.com/watch?v=abc"
    sr._cache[url] = sr._Resolved("https://cdn/one.m3u8", time.time() + 3600)
    monkeypatch.setattr(sr, "_extract", lambda u: pytest.fail("re-extracted a live entry"))
    assert sr.resolve(url) == "https://cdn/one.m3u8"


def test_an_expired_entry_is_re_extracted(monkeypatch):
    url = "https://www.youtube.com/watch?v=abc"
    sr._cache[url] = sr._Resolved("https://cdn/stale.m3u8", time.time() - 1)
    monkeypatch.setattr(sr, "_extract", lambda u: sr._Resolved("https://cdn/fresh.m3u8", time.time() + 3600))
    assert sr.resolve(url) == "https://cdn/fresh.m3u8"


def test_force_bypasses_a_still_live_entry(monkeypatch):
    """What the reconnect path relies on. A stream can stop for reasons the
    cached expiry has no way to know about, so a reconnect always re-asks."""
    url = "https://www.youtube.com/watch?v=abc"
    sr._cache[url] = sr._Resolved("https://cdn/old.m3u8", time.time() + 3600)
    monkeypatch.setattr(sr, "_extract", lambda u: sr._Resolved("https://cdn/new.m3u8", time.time() + 3600))
    assert sr.resolve(url, force=True) == "https://cdn/new.m3u8"
    assert sr._cache[url].url == "https://cdn/new.m3u8"


def test_invalidate_drops_the_entry():
    url = "https://www.youtube.com/watch?v=abc"
    sr._cache[url] = sr._Resolved("https://cdn/one.m3u8", time.time() + 3600)
    sr.invalidate(url)
    assert url not in sr._cache


def test_a_failed_extraction_raises_rather_than_returning_the_page(monkeypatch):
    """Returning the original URL on failure would hand cv2 the watch page —
    the exact silent failure this module exists to remove."""
    url = "https://www.youtube.com/watch?v=abc"

    def boom(u):
        raise sr.StreamResolveError("Video unavailable")

    monkeypatch.setattr(sr, "_extract", boom)
    with pytest.raises(sr.StreamResolveError):
        sr.resolve(url)


def test_a_failed_extraction_leaves_no_cache_entry(monkeypatch):
    url = "https://www.youtube.com/watch?v=abc"
    monkeypatch.setattr(sr, "_extract", lambda u: (_ for _ in ()).throw(sr.StreamResolveError("nope")))
    with pytest.raises(sr.StreamResolveError):
        sr.resolve(url)
    assert url not in sr._cache


# --- 4. Logging -----------------------------------------------------------

def test_describe_does_not_leak_the_signed_url():
    """A resolved manifest URL is ~1 KB of signature. It reaches the desktop's
    engine-log panel, so the capture loop logs the origin instead."""
    label = sr.describe("https://www.youtube.com/watch?v=abc")
    assert "youtube.com" in label
    assert len(label) < 60
