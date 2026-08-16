"""Resolves *page* URLs into the direct media URL behind them.

WHY THIS EXISTS
---------------
Every other camera source this engine takes is already a media address:
an RTSP URL, an HLS playlist, an MJPEG endpoint. cv2.VideoCapture/CAP_FFMPEG
opens those directly. A YouTube link is not one of those — it is an HTML
watch page, and the playable manifest behind it is a signed, expiring URL
that only exists after the page's player config has been extracted.

Handing cv2 a watch page therefore fails at open(), and it fails *silently*:
measured against a real live stream on this build, cv2.VideoCapture(
"https://www.youtube.com/watch?v=...", CAP_FFMPEG) returned isOpened()==False
in 1.1s with nothing on stderr. Upstream, that is indistinguishable from a
camera that is powered off — _capture_loop counts a failed open, escalates
backoff, and _update_health_on_failure eventually reports "offline". The
operator sees a camera stuck offline and is told nothing about why.

Resolving the same URL through yt-dlp first and handing cv2 the manifest it
returns opened in 4.7s and decoded 60 frames of 1920x1080 at the stream's
native 14 fps.

EXPIRY IS THE HARD PART
-----------------------
The resolved manifest is signed and short-lived — YouTube's carry an explicit
expiry (~6h on the stream measured here). A cached URL therefore cannot be
treated as the camera's address: it must be re-resolved whenever the capture
drops, or the reconnect loop spends its whole backoff schedule re-opening a
URL that is now permanently 403. invalidate() exists for exactly that, and
_capture_loop calls it on every reconnect.
"""
from __future__ import annotations

import ipaddress
import re
import socket
import threading
import time
from urllib.parse import urlparse, parse_qs

# Hosts whose URLs are pages rather than media. Deliberately an explicit
# allow-list, not a heuristic: routing an address that cv2 can already open
# through an extractor would add seconds of latency to every reconnect and
# could rewrite a working URL into a worse one. Anything not listed here is
# passed to the decoder untouched, which is the current behaviour for every
# existing camera.
_PAGE_HOSTS = {
    "youtube.com", "youtu.be", "youtube-nocookie.com",
    "twitch.tv",
}

# Re-resolve this long before the signed URL's stated expiry. A stream that
# expires mid-read costs a full reconnect cycle; 10 minutes of slack is far
# cheaper than that and is still a rounding error against a ~6h lifetime.
_EXPIRY_MARGIN_S = 600.0

# Used when the resolved URL carries no expiry we can read. Not a guess at
# how long it lasts — a cap on how long we're willing to trust it.
_DEFAULT_TTL_S = 1800.0

# yt-dlp will happily spend minutes retrying an extraction. A camera capture
# loop cannot block that long: it holds the only thread that reads frames.
_SOCKET_TIMEOUT_S = 15

# Prefer a muxed HLS variant: FFmpeg reads HLS natively, and it is what a
# live stream serves anyway. The `?` makes the height bound a preference
# rather than a filter, so a stream published only above 1080p still
# resolves instead of failing with "no formats".
_FORMAT = (
    "best[protocol^=m3u8][height<=?1080]/best[protocol^=m3u8]"
    "/best[height<=?1080]/best"
)


class StreamResolveError(Exception):
    """Extraction failed. The message is operator-facing (it reaches the log
    panel and the camera's health reason), so it stays short and unstyled."""


class _QuietLogger:
    """Swallows yt-dlp's own output. `quiet` alone does not: it still writes
    "ERROR: [youtube] ...: Video unavailable" straight to stderr, which in the
    engine lands in the middle of the capture log for a camera that already
    reports the same thing through its health status."""

    def debug(self, msg): pass
    def info(self, msg): pass
    def warning(self, msg): pass
    def error(self, msg): pass


class _Resolved:
    __slots__ = ("url", "expires_at")

    def __init__(self, url: str, expires_at: float):
        self.url = url
        self.expires_at = expires_at


_cache: dict[str, _Resolved] = {}
_cache_lock = threading.Lock()


def _host_of(url: str) -> str:
    try:
        host = (urlparse(str(url)).hostname or "").lower()
    except Exception:
        return ""
    return host[4:] if host.startswith("www.") else host


def needs_resolution(url) -> bool:
    """Is this a page URL that must be resolved before cv2 can open it?"""
    host = _host_of(url)
    if not host:
        return False
    # Match subdomains too (m.youtube.com, gaming.youtube.com) without
    # matching a lookalike domain that merely ends in the same characters.
    return any(host == h or host.endswith("." + h) for h in _PAGE_HOSTS)


# Protocols this engine actually decodes. A camera "source" using anything
# else was never a real media address — FFmpeg's own protocol handlers
# include several (concat:, subfile:, data:, file:) that were built for
# trusted local pipelines, not for a string a portal user typed into a form.
_ALLOWED_SCHEMES = {"rtsp", "rtsps", "rtmp", "rtmps", "http", "https"}


def blocked_source_reason(url) -> "str | None":
    """None if the engine may dial this address, else a short reason it must not.

    Camera sources are routinely private-network addresses — 192.168.1.64,
    10.0.0.5 — that is simply where CCTV cameras live, and this check must
    never reject them (see app/camera_test.py's module docstring: rejecting
    RFC1918 here would break the product for essentially every real
    deployment). What must never be reachable through a "camera source" is
    the class of address that was never a camera: loopback (a pivot back
    into this machine's own services, including this engine's own control
    API on 127.0.0.1) and link-local (169.254.169.254 is the near-universal
    cloud instance-metadata address). A camera source is chosen by whoever
    can add a camera in the portal — a lower trust level than whoever has
    the engine's own control token — so this is a real trust boundary, not
    a redundant check.
    """
    try:
        s = str(url)
    except Exception:
        return None
    if "://" not in s:
        return None  # device index, bare path, etc. - not a network address
    try:
        parsed = urlparse(s)
    except Exception:
        return None
    scheme = (parsed.scheme or "").lower()
    if scheme and scheme not in _ALLOWED_SCHEMES:
        return f"'{scheme}' is not a supported camera protocol"
    host = parsed.hostname
    if not host:
        return None
    try:
        infos = socket.getaddrinfo(host, None)
    except Exception:
        # Unresolvable is not our call to make - the normal connect-failure
        # path already reports this with a much better reason than we could.
        return None
    for info in infos:
        raw_addr = info[4][0]
        try:
            addr = ipaddress.ip_address(raw_addr.split("%")[0])
        except ValueError:
            continue
        if addr.is_loopback or addr.is_link_local or addr.is_unspecified:
            return f"resolves to {raw_addr}, a loopback/link-local address (never a real camera)"
    return None


def _expiry_of(direct_url: str, info: dict) -> float:
    """Best available expiry for a resolved URL, as a unix timestamp.

    Google serves the deadline two different ways on the same host — a query
    parameter on progressive URLs and a path segment on HLS manifests
    (…/hls_playlist/expire/1785144686/ei/…) — so both are read. Falls back to
    a bounded default rather than to "never".
    """
    now = time.time()
    candidates = []

    for key in ("expire", "expires"):
        try:
            vals = parse_qs(urlparse(direct_url).query).get(key) or []
            for v in vals:
                if v.isdigit():
                    candidates.append(float(v))
        except Exception:
            pass

    m = re.search(r"/expire/(\d{10,})(?:/|$)", direct_url)
    if m:
        candidates.append(float(m.group(1)))

    for key in ("expires", "expire"):
        v = info.get(key)
        if isinstance(v, (int, float)) and v > 0:
            candidates.append(float(v))

    # Only trust a deadline that is actually in the future; a stale one would
    # pin the cache entry to "already expired" and re-resolve on every frame.
    future = [c for c in candidates if c > now]
    if future:
        return min(future) - _EXPIRY_MARGIN_S
    return now + _DEFAULT_TTL_S


def _extract(url: str) -> _Resolved:
    try:
        import yt_dlp  # imported lazily: the engine must still run without it
    except ImportError:
        raise StreamResolveError(
            "yt-dlp is not installed - this engine build cannot open YouTube "
            "or Twitch URLs. Use a direct stream address (.m3u8 / RTSP) instead."
        )

    opts = {
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "logger": _QuietLogger(),
        "skip_download": True,
        "noplaylist": True,
        # `noplaylist` is NOT enough on its own, and the difference is what
        # wedged a capture thread indefinitely in production.
        #
        # noplaylist only suppresses the playlist ATTACHED to a video URL
        # (?v=X&list=Y). A channel or tab URL — "youtube.com/@NASA/videos" —
        # *is* the playlist, so yt-dlp enumerates it as requested. Combined with
        # the entries[0] materialisation below, that paged through the channel's
        # entire back catalogue over the network, one API call at a time, with
        # no upper bound. py-spy caught it live: __process_playlist -> _entries
        # -> get_requested_items, blocked on an SSL read, holding the camera's
        # Cap thread forever while the UI showed the camera as "connecting".
        #
        # playlist_items caps the enumeration at the source, so a channel URL
        # costs one page instead of hundreds.
        "playlist_items": "1",
        "playlistend": 1,
        "format": _FORMAT,
        "socket_timeout": _SOCKET_TIMEOUT_S,
        # Fail fast. This runs on the capture thread; a long retry schedule
        # here stalls the camera instead of letting the loop back off.
        "retries": 1,
        "extractor_retries": 1,
        "extractor_args": {
            "youtube": {
                "player_client": ["android", "web", "tv"]
            }
        },
    }
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=False)
    except Exception as e:
        # yt-dlp's message already names the reason (private, geo-blocked,
        # ended, members-only). Strip its "ERROR: " prefix and any non-ASCII:
        # this goes to a Windows console whose code page mangles it.
        msg = str(e).replace("ERROR: ", "").strip()
        msg = msg.encode("ascii", "ignore").decode()
        raise StreamResolveError(msg[:200] or "extraction failed")

    if not info:
        raise StreamResolveError("no stream information returned")

    # A search or channel URL resolves to a playlist; take its first entry so
    # a channel's /live URL still works.
    #
    # Taken LAZILY. `entries` is a yt-dlp LazyList, not a list: the previous
    # `[e for e in (info.get("entries") or []) if e]` looked like a cheap filter
    # but forced the generator to completion, which for a channel tab means
    # paging the whole back catalogue over the network before the first frame
    # could ever be decoded. next() stops after the first item, which is the
    # only one this function has ever used.
    if info.get("_type") == "playlist":
        info = next((e for e in (info.get("entries") or []) if e), None)
        if not info:
            raise StreamResolveError("that URL has no playable stream")

    direct = info.get("url")
    if not direct:
        formats = [f for f in (info.get("formats") or []) if f.get("url")]
        if not formats:
            raise StreamResolveError("no playable format found")
        direct = formats[-1]["url"]

    return _Resolved(direct, _expiry_of(direct, info))


def resolve(url: str, force: bool = False) -> str:
    """Direct media URL for `url`, cached until shortly before it expires.

    Returns non-page URLs unchanged, so this is safe to call on every source.
    Raises StreamResolveError if extraction fails.
    """
    src = str(url)
    if not needs_resolution(src):
        return src

    if not force:
        with _cache_lock:
            hit = _cache.get(src)
        if hit and hit.expires_at > time.time():
            return hit.url

    # Extraction runs outside the lock: it is a multi-second network call and
    # must not block another camera's capture thread. Two cameras on the same
    # URL may briefly duplicate the work, which costs one extra request.
    resolved = _extract(src)
    with _cache_lock:
        _cache[src] = resolved
    return resolved.url


def invalidate(url: str) -> None:
    """Drop the cached resolution so the next resolve() re-extracts.

    Called from the capture loop's reconnect path: if the stream dropped
    because its signed URL expired, retrying the same URL can never succeed.
    """
    src = str(url)
    with _cache_lock:
        _cache.pop(src, None)


def describe(url: str) -> str:
    """Short label for logs — a resolved googlevideo URL is ~1 KB of signature
    and must never be printed whole into an operator's log panel."""
    src = str(url)
    host = _host_of(src)
    return f"{host or 'stream'} (resolved)"
