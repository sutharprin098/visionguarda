"""Camera connection test — the pre-add gate, run from the LAN.

WHY THIS LIVES IN THE ENGINE AND NOT IN AN EDGE FUNCTION
--------------------------------------------------------
The product already had a "Test Connection" button. It called the
`test-camera` Supabase edge function, which runs in Deno on Supabase's cloud
infrastructure. That function contains this (supabase/functions/_shared/util.ts):

    if (isPrivateIp(f.host)) {
      return { ok: true, message: `Local/private IP address (...) bypassed
               cloud verification. The desktop app will connect to it locally.` }
    }

10/8, 192.168/16, 172.16-31/12 — returned `ok: true` having opened no socket.
Practically every CCTV camera ever installed sits on one of those ranges, so
for real deployments the test passed unconditionally, and `add-camera` /
`update-camera` (which gate their INSERT on the same function) were gating on
a value that was decided before any network activity happened.

That is not a bug in the function; it is the function being on the wrong side
of the NAT. Cloud code cannot route to 192.168.1.64 and no amount of extra
checks will change that. The desktop engine is already on the camera's LAN —
it is the only vantage point that can answer "can we actually talk to this
camera", which app/health_probe.py's docstring has said all along.

WHAT THIS MODULE WILL AND WILL NOT REPORT
-----------------------------------------
Every value here is measured. Where a value cannot be honestly obtained with
the runtime we ship, the check reports NOT_MEASURED with the reason, and the
UI shows that instead of a number. This is deliberate and it is not laziness:

  * packet loss    — needs RTP sequence-number accounting. We consume streams
                     through OpenCV/FFmpeg, which does not surface per-packet
                     state. There is no honest number available here.
  * per-test GPU   — app/gpu_monitor.py samples a system-wide Windows perf
                     counter every 5s with no per-process attribution. It
                     cannot say what a single 5-second camera test cost.
  * bitrate        — measurable for HTTP MJPEG (we read the socket ourselves
                     and can count bytes, so we do). Not measurable for RTSP
                     without demuxing RTP, so RTSP reports NOT_MEASURED.

This codebase has shipped invented telemetry before — a smoke detector that
reported "concrete" on 200/200 frames, PPE hardcoded at 0.95, a km/h figure
derived from an invented constant. All were removed on 2026-07-17. A test
screen that fabricates "0.2% packet loss" would be the same failure wearing a
network-diagnostics costume, and it would be found in due diligence. A blank
labelled "not measured — needs RTP-level access" costs nothing and is true.

NAMING IS PART OF HONESTY
-------------------------
Two labels here are deliberately not the ones the spec asked for:

  * "Ping latency" is reported as TCP_RTT. A real ICMP ping needs a raw
    socket (admin/root on Windows). We measure the TCP handshake round-trip
    instead, which is a different thing — it includes the listener's accept.
    Calling it "ping" would misreport the method.
  * "Decode time" is reported as frame_read_ms. cv2 read() covers network
    wait + demux + decode; isolating the decoder is not possible through this
    API. The number is real, the name says what it is.
"""
from __future__ import annotations

import base64
import hashlib
import os
import re
import socket
import time
import uuid
from dataclasses import dataclass, field, asdict
from typing import Any, Callable, Iterator, Optional
from urllib.parse import urlparse, quote, unquote

import cv2


# ---------------------------------------------------------------------------
# Result vocabulary
# ---------------------------------------------------------------------------
# Statuses a single check can end in. NOT_MEASURED is a first-class outcome,
# not a failure: "we did not measure this and here is why" is information, and
# collapsing it into PASS or FAIL would be a lie in one direction or the other.
PASS = "pass"
FAIL = "fail"
SKIP = "skip"
NOT_MEASURED = "not_measured"

# Error codes. The UI maps these to sentences; the code is the contract, so a
# copy edit upstream can never change what a caller branches on. The spec's
# hard requirement — "never display generic Connection Failed" — is enforced
# structurally: a failing check must carry one of these, and there is no
# generic member to fall back to.
ERR_INVALID_URL = "INVALID_URL"
ERR_DNS_FAILED = "DNS_FAILED"
ERR_HOST_UNREACHABLE = "HOST_UNREACHABLE"
ERR_CONNECTION_REFUSED = "CONNECTION_REFUSED"
ERR_PORT_BLOCKED = "PORT_BLOCKED"
ERR_AUTH_FAILED = "AUTH_FAILED"
ERR_AUTH_REQUIRED = "AUTH_REQUIRED"
ERR_RTSP_TIMEOUT = "RTSP_TIMEOUT"
ERR_RTSP_ERROR = "RTSP_ERROR"
ERR_ONVIF_UNAVAILABLE = "ONVIF_UNAVAILABLE"
ERR_STREAM_UNAVAILABLE = "STREAM_UNAVAILABLE"
ERR_NO_FRAMES = "NO_FRAMES"
ERR_UNSUPPORTED_CODEC = "UNSUPPORTED_CODEC"
ERR_DEVICE_NOT_FOUND = "DEVICE_NOT_FOUND"
ERR_FILE_NOT_FOUND = "FILE_NOT_FOUND"
ERR_PLAYLIST_INVALID = "PLAYLIST_INVALID"

# Phases the UI shows while the test runs.
PHASE_RESOLVING = "Resolving..."
PHASE_CONNECTING = "Connecting..."
PHASE_AUTHENTICATING = "Authenticating..."
PHASE_OPENING = "Opening Stream..."
PHASE_RECEIVING = "Receiving Frames..."
PHASE_SUCCESS = "Success"
PHASE_FAILED = "Failed"

# Source types this module knows how to test. `screen_share` is here so the
# caller gets a definite SKIP with a reason rather than an unknown-type error:
# the surface is captured by Electron in the renderer and never exists as
# something the engine could dial.
SOURCE_TYPES = (
    "rtsp", "rtmp", "http_mjpeg", "onvif", "usb", "webcam",
    "screen_share", "file", "hls",
    # Portal vocabulary. `ip`/`nvr`/`dvr` are RTSP endpoints wearing a label
    # that describes the box, not the protocol (desktop/src/lib/localEngine.ts
    # already collapses them to "rtsp" before the engine ever sees them).
    "ip", "nvr", "dvr",
)

DEFAULT_PORTS = {
    "rtsp": 554, "ip": 554, "nvr": 554, "dvr": 554,
    "rtmp": 1935,
    "http_mjpeg": 80,
    "onvif": 80,
    "hls": 80,
}


@dataclass
class Check:
    """One diagnostic step. `data` carries the measurement, if any."""
    id: str
    label: str
    status: str
    detail: str = ""
    error_code: Optional[str] = None
    duration_ms: Optional[float] = None
    data: dict = field(default_factory=dict)


@dataclass
class TestResult:
    ok: bool
    source_type: str
    phase: str
    checks: list = field(default_factory=list)
    metrics: dict = field(default_factory=dict)
    error_code: Optional[str] = None
    error_detail: str = ""
    # The URL with credentials masked. The raw one is never returned or logged:
    # an rtsp:// URL carries the camera password in the userinfo, and this
    # result goes to the portal, into logs, and onto operators' screens.
    url: str = ""
    started_at: float = 0.0
    duration_ms: float = 0.0


def mask_url(url: str) -> str:
    """rtsp://admin:hunter2@10.0.0.5/s1 -> rtsp://admin:***@10.0.0.5/s1"""
    if not url:
        return ""
    return re.sub(r"://([^:/@]+):([^@]*)@", r"://\1:***@", url)


# ---------------------------------------------------------------------------
# URL construction
# ---------------------------------------------------------------------------
def build_url(
    source_type: str,
    host: Optional[str] = None,
    port: Optional[int] = None,
    username: Optional[str] = None,
    password: Optional[str] = None,
    path: Optional[str] = None,
    url: Optional[str] = None,
) -> str:
    """Assemble the connection URL. An explicit `url` always wins — an operator
    who pasted a full URL from their camera's manual has told us more than our
    template ever could."""
    if url:
        return url.strip()

    st = source_type
    if st in ("usb", "webcam", "screen_share", "file"):
        return ""

    if not host:
        return ""

    p = port or DEFAULT_PORTS.get(st, 554)
    tail = path or ""
    if tail and not tail.startswith("/"):
        tail = "/" + tail

    # Credentials are percent-encoded: a password containing '@' or '/' (both
    # common, neither rejected by any camera's admin page) otherwise splits the
    # authority and the URL silently addresses the wrong host.
    userinfo = ""
    if username:
        userinfo = quote(username, safe="")
        if password:
            userinfo += ":" + quote(password, safe="")
        userinfo += "@"

    scheme = {
        "rtsp": "rtsp", "ip": "rtsp", "nvr": "rtsp", "dvr": "rtsp",
        "rtmp": "rtmp",
        "http_mjpeg": "http",
        "onvif": "http",
        "hls": "http",
    }.get(st, "rtsp")

    return f"{scheme}://{userinfo}{host}:{p}{tail}"


# ---------------------------------------------------------------------------
# Digest / Basic auth
# ---------------------------------------------------------------------------
def _parse_auth_challenge(header_block: str) -> Optional[dict]:
    """Pull the WWW-Authenticate challenge out of a raw response head.

    Returns {"scheme": "digest"|"basic", "realm": ..., "nonce": ..., ...}.
    """
    m = re.search(r"WWW-Authenticate:\s*(\w+)\s*(.*)", header_block, re.IGNORECASE)
    if not m:
        return None
    scheme = m.group(1).strip().lower()
    params = dict(re.findall(r'(\w+)\s*=\s*"([^"]*)"', m.group(2)))
    params["scheme"] = scheme
    return params


def _make_cnonce() -> str:
    """Client nonce. A seam, so the RFC 2617 known-answer test can pin the one
    value in this computation that is otherwise random — without it the digest
    can only be checked for shape, and a wrong digest means every camera on the
    network reports "wrong password"."""
    return uuid.uuid4().hex[:16]


def _digest_response(username: str, password: str, method: str,
                     uri: str, challenge: dict) -> str:
    """RFC 2069 / RFC 2617 Digest, qop=auth included.

    Cameras are split roughly down the middle on whether they send `qop`, and
    getting this wrong reads to the operator exactly like a wrong password —
    which is the failure this whole module exists to tell apart from a real
    one. So both forms are implemented rather than assuming the modern one.
    """
    realm = challenge.get("realm", "")
    nonce = challenge.get("nonce", "")
    qop = challenge.get("qop")
    algorithm = (challenge.get("algorithm") or "MD5").upper()

    def _h(s: str) -> str:
        return hashlib.md5(s.encode("utf-8")).hexdigest()

    ha1 = _h(f"{username}:{realm}:{password}")
    if algorithm == "MD5-SESS":
        ha1 = _h(f"{ha1}:{nonce}:{_make_cnonce()}")
    ha2 = _h(f"{method}:{uri}")

    parts = [
        f'username="{username}"', f'realm="{realm}"', f'nonce="{nonce}"',
        f'uri="{uri}"',
    ]
    if qop:
        # qop is offered as a comma list ("auth,auth-int"); we implement auth.
        cnonce = _make_cnonce()
        nc = "00000001"
        resp = _h(f"{ha1}:{nonce}:{nc}:{cnonce}:auth:{ha2}")
        parts += [f'response="{resp}"', "qop=auth", f"nc={nc}", f'cnonce="{cnonce}"']
    else:
        resp = _h(f"{ha1}:{nonce}:{ha2}")
        parts.append(f'response="{resp}"')

    if challenge.get("opaque"):
        parts.append(f'opaque="{challenge["opaque"]}"')

    return "Digest " + ", ".join(parts)


def _basic_response(username: str, password: str) -> str:
    raw = f"{username}:{password}".encode("utf-8")
    return "Basic " + base64.b64encode(raw).decode("ascii")


def _auth_header(username: str, password: str, method: str,
                 uri: str, challenge: dict) -> str:
    if challenge.get("scheme") == "digest":
        return _digest_response(username, password, method, uri, challenge)
    return _basic_response(username, password)


# ---------------------------------------------------------------------------
# RTSP
# ---------------------------------------------------------------------------
class RtspError(Exception):
    def __init__(self, code: str, detail: str):
        super().__init__(detail)
        self.code = code
        self.detail = detail


def _rtsp_send(sock: socket.socket, method: str, uri: str, cseq: int,
               extra: Optional[dict] = None, timeout: float = 5.0) -> str:
    """Send one RTSP request, return the raw response (head, and body if the
    Content-Length says there is one)."""
    lines = [f"{method} {uri} RTSP/1.0", f"CSeq: {cseq}",
             "User-Agent: CamAI-ConnectionTest/1.0"]
    for k, v in (extra or {}).items():
        lines.append(f"{k}: {v}")
    req = ("\r\n".join(lines) + "\r\n\r\n").encode("utf-8")

    sock.settimeout(timeout)
    sock.sendall(req)

    # Read until the header terminator, then honour Content-Length. A DESCRIBE
    # body (the SDP) is the whole point of this exchange and it routinely
    # arrives in a second TCP segment, so a single recv() would truncate it and
    # we would report "no codec" for a camera that told us exactly what it was.
    buf = b""
    deadline = time.monotonic() + timeout
    while b"\r\n\r\n" not in buf:
        if time.monotonic() > deadline:
            raise RtspError(ERR_RTSP_TIMEOUT, f"{method} timed out after {timeout:.0f}s")
        chunk = sock.recv(4096)
        if not chunk:
            raise RtspError(ERR_RTSP_ERROR, f"connection closed during {method}")
        buf += chunk

    head, _, body = buf.partition(b"\r\n\r\n")
    m = re.search(rb"Content-Length:\s*(\d+)", head, re.IGNORECASE)
    if m:
        want = int(m.group(1))
        while len(body) < want:
            if time.monotonic() > deadline:
                break
            chunk = sock.recv(4096)
            if not chunk:
                break
            body += chunk

    return (head + b"\r\n\r\n" + body).decode("utf-8", errors="ignore")


def _rtsp_status(resp: str) -> int:
    m = re.match(r"RTSP/\d\.\d\s+(\d+)", resp)
    return int(m.group(1)) if m else 0


def parse_sdp(sdp: str) -> dict:
    """Extract what the camera itself declares about its video track.

    This is where codec comes from, and it is worth saying why rather than
    using OpenCV's CAP_PROP_FOURCC: for an FFmpeg-backed RTSP capture that
    property routinely reports 0 or garbage, because there is no FOURCC in the
    pipeline to report — the container is RTP, not AVI. The SDP's rtpmap is the
    camera's own statement of its encoding, which is both authoritative and
    free (we already have the DESCRIBE body in hand).
    """
    out: dict = {}
    codecs = []
    for rtpmap in re.findall(r"a=rtpmap:\d+\s+([A-Za-z0-9\-]+)/", sdp):
        codecs.append(rtpmap.upper())
    if codecs:
        # H264 and H265 are the encodings; JPEG here means MJPEG-over-RTP.
        video = [c for c in codecs if c in ("H264", "H265", "HEVC", "JPEG", "MP4V-ES", "VP8", "VP9")]
        out["codec"] = video[0] if video else codecs[0]
        out["codecs_offered"] = codecs

    # Some cameras publish dimensions directly; most do not, so this is a bonus
    # rather than the resolution source of record (the decoded frame is).
    dim = re.search(r"a=x-dimensions:\s*(\d+)\s*,\s*(\d+)", sdp)
    if dim:
        out["sdp_resolution"] = f"{dim.group(1)}x{dim.group(2)}"

    ctrl = re.search(r"a=control:(\S+)", sdp)
    if ctrl:
        out["control"] = ctrl.group(1)
    return out


# ---------------------------------------------------------------------------
# ONVIF
# ---------------------------------------------------------------------------
def _ws_security_header(username: str, password: str) -> str:
    """WS-UsernameToken with PasswordDigest — what ONVIF actually requires.

    The existing cloud probe (util.ts probeOnvifDevice) sends an envelope with
    no security header at all, which is why it can only ever reach cameras with
    authentication disabled, and why it could never distinguish a wrong
    password from an absent ONVIF service.
    """
    nonce = os.urandom(16)
    created = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    digest = base64.b64encode(
        hashlib.sha1(nonce + created.encode("utf-8") + password.encode("utf-8")).digest()
    ).decode("ascii")
    return (
        '<s:Header><Security s:mustUnderstand="1" '
        'xmlns="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd">'
        f"<UsernameToken><Username>{username}</Username>"
        f'<Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest">{digest}</Password>'
        f'<Nonce EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary">{base64.b64encode(nonce).decode("ascii")}</Nonce>'
        f"<Created xmlns=\"http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd\">{created}</Created>"
        "</UsernameToken></Security></s:Header>"
    )


def _soap(body: str, username: Optional[str], password: Optional[str]) -> bytes:
    header = _ws_security_header(username, password) if username else ""
    env = (
        '<?xml version="1.0" encoding="utf-8"?>'
        '<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope">'
        f"{header}<s:Body>{body}</s:Body></s:Envelope>"
    )
    return env.encode("utf-8")


def _http_post(host: str, port: int, path: str, payload: bytes,
               timeout: float = 5.0) -> tuple[int, str]:
    req = (
        f"POST {path} HTTP/1.1\r\n"
        f"Host: {host}:{port}\r\n"
        'Content-Type: application/soap+xml; charset=utf-8\r\n'
        f"Content-Length: {len(payload)}\r\n"
        "Connection: close\r\n\r\n"
    ).encode("utf-8") + payload

    with socket.create_connection((host, port), timeout=timeout) as s:
        s.settimeout(timeout)
        s.sendall(req)
        buf = b""
        while True:
            try:
                chunk = s.recv(8192)
            except socket.timeout:
                break
            if not chunk:
                break
            buf += chunk
            if len(buf) > 512_000:
                break

    text = buf.decode("utf-8", errors="ignore")
    m = re.match(r"HTTP/\d\.\d\s+(\d+)", text)
    return (int(m.group(1)) if m else 0), text


def onvif_device_info(host: str, port: int, username: Optional[str],
                      password: Optional[str], timeout: float = 5.0) -> Optional[dict]:
    body = '<GetDeviceInformation xmlns="http://www.onvif.org/ver10/device/wsdl"/>'
    try:
        code, text = _http_post(host, port, "/onvif/device_service",
                                _soap(body, username, password), timeout)
    except Exception:
        return None
    if code != 200:
        return None
    out = {}
    for tag in ("Manufacturer", "Model", "FirmwareVersion", "SerialNumber", "HardwareId"):
        m = re.search(rf"<[\w:]*{tag}>([^<]*)<", text)
        if m:
            out[tag[0].lower() + tag[1:]] = m.group(1)
    return out or None


def onvif_profiles(host: str, port: int, username: Optional[str],
                   password: Optional[str], timeout: float = 5.0) -> list:
    body = '<GetProfiles xmlns="http://www.onvif.org/ver10/media/wsdl"/>'
    try:
        code, text = _http_post(host, port, "/onvif/device_service",
                                _soap(body, username, password), timeout)
    except Exception:
        return []
    if code != 200:
        return []
    tokens = re.findall(r'<[\w:]*Profiles[^>]*token="([^"]+)"', text)
    names = re.findall(r"<[\w:]*Name>([^<]*)<", text)
    out = []
    for i, tok in enumerate(tokens):
        out.append({"token": tok, "name": names[i] if i < len(names) else tok})
    return out


def onvif_stream_uri(host: str, port: int, profile_token: str,
                     username: Optional[str], password: Optional[str],
                     timeout: float = 5.0) -> Optional[str]:
    body = (
        '<GetStreamUri xmlns="http://www.onvif.org/ver10/media/wsdl">'
        "<StreamSetup>"
        '<Stream xmlns="http://www.onvif.org/ver10/schema">RTP-Unicast</Stream>'
        '<Transport xmlns="http://www.onvif.org/ver10/schema"><Protocol>RTSP</Protocol></Transport>'
        "</StreamSetup>"
        f"<ProfileToken>{profile_token}</ProfileToken>"
        "</GetStreamUri>"
    )
    try:
        code, text = _http_post(host, port, "/onvif/device_service",
                                _soap(body, username, password), timeout)
    except Exception:
        return None
    if code != 200:
        return None
    m = re.search(r"<[\w:]*Uri>([^<]*)<", text)
    return m.group(1) if m else None


def onvif_discover(timeout: float = 4.0) -> list:
    """WS-Discovery probe on 239.255.255.250:3702.

    This capability only exists here. The cloud function could never do it —
    multicast does not traverse the internet, so discovery is structurally a
    LAN-side feature, and moving the test onto the engine is what makes it
    possible at all.
    """
    probe = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<e:Envelope xmlns:e="http://www.w3.org/2003/05/soap-envelope" '
        'xmlns:w="http://schemas.xmlsoap.org/ws/2004/08/addressing" '
        'xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery" '
        'xmlns:dn="http://www.onvif.org/ver10/network/wsdl">'
        f"<e:Header><w:MessageID>uuid:{uuid.uuid4()}</w:MessageID>"
        "<w:To>urn:schemas-xmlsoap-org:ws:2005:04:discovery</w:To>"
        "<w:Action>http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</w:Action>"
        "</e:Header><e:Body><d:Probe><d:Types>dn:NetworkVideoTransmitter</d:Types>"
        "</d:Probe></e:Body></e:Envelope>"
    ).encode("utf-8")

    found: dict = {}
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        sock.setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_TTL, 2)
        sock.settimeout(0.6)
        sock.sendto(probe, ("239.255.255.250", 3702))
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            try:
                data, addr = sock.recvfrom(65535)
            except socket.timeout:
                continue
            except OSError:
                break
            text = data.decode("utf-8", errors="ignore")
            xaddrs = re.search(r"<[\w:]*XAddrs>([^<]*)<", text)
            if not xaddrs:
                continue
            urls = xaddrs.group(1).split()
            found[addr[0]] = {
                "ip": addr[0],
                "xaddrs": urls,
                "scopes": (re.search(r"<[\w:]*Scopes>([^<]*)<", text) or [None, ""])[1]
                if re.search(r"<[\w:]*Scopes>([^<]*)<", text) else "",
            }
    finally:
        sock.close()
    return list(found.values())


# ---------------------------------------------------------------------------
# The test itself
# ---------------------------------------------------------------------------
def _timed(fn: Callable[[], Any]) -> tuple[Any, float]:
    t0 = time.perf_counter()
    out = fn()
    return out, (time.perf_counter() - t0) * 1000.0


def run_test(
    source_type: str,
    host: Optional[str] = None,
    port: Optional[int] = None,
    username: Optional[str] = None,
    password: Optional[str] = None,
    path: Optional[str] = None,
    url: Optional[str] = None,
    frame_count: int = 15,
    frame_timeout: float = 12.0,
    on_phase: Optional[Callable[[str, Optional[Check]], None]] = None,
) -> TestResult:
    """Run the full diagnostic. `on_phase(phase, check)` is called as each step
    resolves so a caller can stream progress; it is optional and never affects
    the outcome."""
    started = time.time()
    t_start = time.perf_counter()
    st = (source_type or "").strip().lower()
    result = TestResult(ok=False, source_type=st, phase=PHASE_RESOLVING, started_at=started)

    def emit(phase: str, check: Optional[Check] = None):
        result.phase = phase
        if check:
            result.checks.append(check)
        if on_phase:
            try:
                on_phase(phase, check)
            except Exception:
                # A subscriber that blows up must not fail the camera's test.
                pass

    def finish(ok: bool, code: Optional[str] = None, detail: str = "") -> TestResult:
        result.ok = ok
        result.error_code = code
        result.error_detail = detail
        result.phase = PHASE_SUCCESS if ok else PHASE_FAILED
        result.duration_ms = (time.perf_counter() - t_start) * 1000.0
        # Metrics with no honest source. Recorded on every result so the UI can
        # render the field with its reason rather than an empty cell that looks
        # like a bug or, worse, a zero that looks like a measurement.
        result.metrics.setdefault("packet_loss", {
            "status": NOT_MEASURED,
            "reason": "Requires RTP sequence-number accounting; OpenCV/FFmpeg does not expose per-packet state.",
        })
        result.metrics.setdefault("gpu_percent", {
            "status": NOT_MEASURED,
            "reason": "gpu_monitor samples a system-wide counter every 30s with no per-process attribution; it cannot be attributed to this test.",
        })
        if on_phase:
            try:
                on_phase(result.phase, None)
            except Exception:
                pass
        return result

    if st not in SOURCE_TYPES:
        return finish(False, ERR_INVALID_URL, f"Unknown source type '{source_type}'.")

    # ---- Sources with nothing on the network to dial ----
    if st == "screen_share":
        emit(PHASE_SUCCESS, Check(
            id="screen_share", label="Screen share", status=SKIP,
            detail="Screen shares are captured in the desktop app itself; there is no endpoint to test.",
        ))
        return finish(True)

    if st in ("usb", "webcam"):
        return _test_local_device(st, url or path or host, result, emit, finish, frame_count)

    if st == "file":
        return _test_file(url or path or "", result, emit, finish, frame_count)

    # ---- Network sources ----
    full_url = build_url(st, host, port, username, password, path, url)
    result.url = mask_url(full_url)
    if not full_url:
        return finish(False, ERR_INVALID_URL, "No host or URL was provided.")

    try:
        parsed = urlparse(full_url)
    except Exception:
        return finish(False, ERR_INVALID_URL, f"Could not parse '{mask_url(full_url)}' as a URL.")

    hostname = parsed.hostname or host
    if not hostname:
        return finish(False, ERR_INVALID_URL, "URL has no host component.")
    p = parsed.port or port or (443 if parsed.scheme == "https" else 80 if parsed.scheme == "http" else DEFAULT_PORTS.get(st, 554))

    # Credentials from an explicit url= override the separate fields, since the
    # URL is the more specific statement of intent.
    #
    # unquote is load-bearing, not tidying. urlparse returns the userinfo
    # exactly as it appears in the URL — still percent-encoded — and build_url
    # above percent-encodes on the way in (it must; an unescaped '@' or '/' in
    # a password splits the authority and addresses the wrong host). Without
    # unquote here, a password of "p@ss/w0rd" is handed to the digest hash as
    # "p%40ss%2Fw0rd", which is not what the camera hashes, so the camera
    # rejects a CORRECT password and we report AUTH_FAILED. That is the worst
    # possible bug in this module: it blames the operator for our escaping.
    user = unquote(parsed.username) if parsed.username else username
    pwd = unquote(parsed.password) if parsed.password else password

    # ---- DNS ----
    emit(PHASE_RESOLVING)
    try:
        (addrs, dns_ms) = _timed(lambda: socket.getaddrinfo(hostname, p, proto=socket.IPPROTO_TCP))
        ips = sorted({a[4][0] for a in addrs})
        emit(PHASE_RESOLVING, Check(
            id="dns", label="DNS resolution", status=PASS,
            detail=f"{hostname} resolved to {', '.join(ips)}",
            duration_ms=round(dns_ms, 1), data={"addresses": ips},
        ))
    except socket.gaierror as e:
        emit(PHASE_FAILED, Check(
            id="dns", label="DNS resolution", status=FAIL, error_code=ERR_DNS_FAILED,
            detail=f"'{hostname}' could not be resolved ({e.strerror or e}). Check the hostname, or use an IP address.",
        ))
        return finish(False, ERR_DNS_FAILED,
                      f"'{hostname}' could not be resolved. Check the hostname or use an IP address.")

    # ---- TCP connect (+ RTT) ----
    emit(PHASE_CONNECTING)
    try:
        t0 = time.perf_counter()
        sock = socket.create_connection((hostname, p), timeout=5.0)
        rtt = (time.perf_counter() - t0) * 1000.0
        sock.close()
        emit(PHASE_CONNECTING, Check(
            id="tcp", label="TCP port open", status=PASS,
            detail=f"{hostname}:{p} accepted a connection in {rtt:.0f} ms",
            duration_ms=round(rtt, 1), data={"tcp_rtt_ms": round(rtt, 1), "port": p},
        ))
        result.metrics["tcp_rtt_ms"] = round(rtt, 1)
    except ConnectionRefusedError:
        emit(PHASE_FAILED, Check(
            id="tcp", label="TCP port open", status=FAIL, error_code=ERR_CONNECTION_REFUSED,
            detail=f"{hostname}:{p} refused the connection — something answered, but nothing is listening on port {p}. Check the port number.",
        ))
        return finish(False, ERR_CONNECTION_REFUSED,
                      f"{hostname}:{p} refused the connection. Nothing is listening on that port.")
    except socket.timeout:
        emit(PHASE_FAILED, Check(
            id="tcp", label="TCP port open", status=FAIL, error_code=ERR_PORT_BLOCKED,
            detail=f"{hostname}:{p} did not answer within 5s. A silent drop (rather than a refusal) usually means a firewall is blocking the port.",
        ))
        return finish(False, ERR_PORT_BLOCKED,
                      f"Port {p} on {hostname} is blocked or filtered (no response within 5s).")
    except OSError as e:
        emit(PHASE_FAILED, Check(
            id="tcp", label="TCP port open", status=FAIL, error_code=ERR_HOST_UNREACHABLE,
            detail=f"{hostname} is unreachable: {e.strerror or e}",
        ))
        return finish(False, ERR_HOST_UNREACHABLE, f"{hostname} is unreachable ({e.strerror or e}).")

    sdp_info: dict = {}

    # ---- Protocol handshake + auth ----
    if st in ("rtsp", "ip", "nvr", "dvr"):
        code, detail, sdp_info = _rtsp_handshake(hostname, p, parsed.path or "/", user, pwd, emit)
        if code:
            return finish(False, code, detail)
    elif st == "onvif":
        code, detail, onvif_url = _onvif_negotiate(hostname, p, user, pwd, emit)
        if code:
            return finish(False, code, detail)
        if onvif_url:
            # The device told us where its stream lives; believe it over any
            # path we guessed. Credentials go back in — GetStreamUri returns a
            # bare rtsp:// URL that the RTSP server itself still challenges.
            full_url = _inject_credentials(onvif_url, user, pwd)
            result.url = mask_url(full_url)
            rp = urlparse(full_url)
            code, detail, sdp_info = _rtsp_handshake(
                rp.hostname or hostname, rp.port or 554, rp.path or "/", user, pwd, emit)
            if code:
                return finish(False, code, detail)
    elif st == "http_mjpeg":
        code, detail, mjpeg_data = _mjpeg_probe(hostname, p, parsed.path or "/", user, pwd, emit)
        if code:
            return finish(False, code, detail)
        result.metrics.update(mjpeg_data)
    elif st == "hls":
        code, detail = _hls_probe(hostname, p, parsed.path or "/", user, pwd, emit)
        if code:
            return finish(False, code, detail)
    elif st == "rtmp":
        # RTMP's handshake is a binary exchange, not a text protocol we can
        # meaningfully assert on without implementing it. TCP reachability is
        # established above; the stream open below is the real test, and saying
        # so is better than inventing a "handshake OK" that checked nothing.
        emit(PHASE_CONNECTING, Check(
            id="rtmp_handshake", label="RTMP handshake", status=SKIP,
            detail="RTMP handshake is binary and is not probed separately; the stream-open step below is the actual verification.",
        ))

    # ---- Open the stream and pull frames ----
    return _test_stream(full_url, result, emit, finish, frame_count, frame_timeout, sdp_info)


def _inject_credentials(u: str, user: Optional[str], pwd: Optional[str]) -> str:
    if not user:
        return u
    parsed = urlparse(u)
    if parsed.username:
        return u
    userinfo = quote(user, safe="")
    if pwd:
        userinfo += ":" + quote(pwd, safe="")
    netloc = f"{userinfo}@{parsed.hostname}"
    if parsed.port:
        netloc += f":{parsed.port}"
    return parsed._replace(netloc=netloc).geturl()


def _rtsp_handshake(hostname: str, port: int, path: str, user: Optional[str],
                    pwd: Optional[str], emit) -> tuple[Optional[str], str, dict]:
    """OPTIONS, then DESCRIBE with real authentication.

    DESCRIBE is the step that matters. OPTIONS is frequently allowed
    unauthenticated, so a camera that answers it tells us the RTSP server is
    alive and nothing about whether our credentials work. DESCRIBE is
    challenged, which is what lets us separate "wrong password" from "camera
    not there" — a distinction the product could not previously make at all,
    because no probe on either side ever sent credentials.
    """
    base = f"rtsp://{hostname}:{port}{path}"
    try:
        sock = socket.create_connection((hostname, port), timeout=5.0)
    except OSError as e:
        return ERR_HOST_UNREACHABLE, f"Could not open an RTSP connection to {hostname}:{port} ({e}).", {}

    try:
        emit(PHASE_CONNECTING)
        try:
            resp = _rtsp_send(sock, "OPTIONS", base, 1)
        except RtspError as e:
            emit(PHASE_FAILED, Check(id="rtsp_options", label="RTSP handshake", status=FAIL,
                                     error_code=e.code, detail=e.detail))
            return e.code, f"RTSP OPTIONS failed: {e.detail}", {}

        status = _rtsp_status(resp)
        if status == 0:
            emit(PHASE_FAILED, Check(
                id="rtsp_options", label="RTSP handshake", status=FAIL, error_code=ERR_RTSP_ERROR,
                detail=f"{hostname}:{port} answered, but not with RTSP. Is this an RTSP port?",
            ))
            return ERR_RTSP_ERROR, f"{hostname}:{port} is open but did not speak RTSP.", {}

        public = re.search(r"Public:\s*([^\r\n]+)", resp, re.IGNORECASE)
        emit(PHASE_CONNECTING, Check(
            id="rtsp_options", label="RTSP handshake", status=PASS,
            detail=f"RTSP/1.0 {status}" + (f" — server supports: {public.group(1).strip()}" if public else ""),
            data={"methods": public.group(1).strip() if public else None},
        ))

        # ---- DESCRIBE (auth) ----
        emit(PHASE_AUTHENTICATING)
        try:
            resp = _rtsp_send(sock, "DESCRIBE", base, 2, {"Accept": "application/sdp"})
        except RtspError as e:
            emit(PHASE_FAILED, Check(id="auth", label="Authentication", status=FAIL,
                                     error_code=e.code, detail=e.detail))
            return e.code, f"RTSP DESCRIBE failed: {e.detail}", {}

        status = _rtsp_status(resp)
        if status == 401:
            challenge = _parse_auth_challenge(resp)
            if not challenge:
                emit(PHASE_FAILED, Check(
                    id="auth", label="Authentication", status=FAIL, error_code=ERR_AUTH_REQUIRED,
                    detail="Camera requires authentication but sent no WWW-Authenticate challenge we could answer.",
                ))
                return ERR_AUTH_REQUIRED, "Camera requires authentication but offered no usable challenge.", {}
            if not user:
                emit(PHASE_FAILED, Check(
                    id="auth", label="Authentication", status=FAIL, error_code=ERR_AUTH_REQUIRED,
                    detail=f"Camera requires a username and password ({challenge.get('scheme','?')} auth, realm \"{challenge.get('realm','')}\"). None were provided.",
                ))
                realm_note = f' (realm "{challenge["realm"]}")' if challenge.get("realm") else ""
                return (ERR_AUTH_REQUIRED,
                        f"This camera requires a username and password{realm_note}; none were provided.",
                        {})

            hdr = _auth_header(user, pwd or "", "DESCRIBE", base, challenge)
            try:
                resp = _rtsp_send(sock, "DESCRIBE", base, 3,
                                  {"Accept": "application/sdp", "Authorization": hdr})
            except RtspError as e:
                emit(PHASE_FAILED, Check(id="auth", label="Authentication", status=FAIL,
                                         error_code=e.code, detail=e.detail))
                return e.code, f"RTSP DESCRIBE (authenticated) failed: {e.detail}", {}
            status = _rtsp_status(resp)

            if status in (401, 403):
                emit(PHASE_FAILED, Check(
                    id="auth", label="Authentication", status=FAIL, error_code=ERR_AUTH_FAILED,
                    detail=f"Camera rejected the credentials for user '{user}' ({challenge.get('scheme','digest')} auth, realm \"{challenge.get('realm','')}\").",
                ))
                return ERR_AUTH_FAILED, f"Wrong username or password (camera rejected user '{user}').", {}

            emit(PHASE_AUTHENTICATING, Check(
                id="auth", label="Authentication", status=PASS,
                detail=f"Accepted user '{user}' via {challenge.get('scheme','digest')} auth"
                       + (f" (realm \"{challenge['realm']}\")" if challenge.get("realm") else ""),
                data={"scheme": challenge.get("scheme"), "realm": challenge.get("realm")},
            ))
        elif status == 200:
            emit(PHASE_AUTHENTICATING, Check(
                id="auth", label="Authentication", status=PASS,
                detail="Camera did not require authentication (open stream).",
                data={"scheme": "none"},
            ))
        else:
            emit(PHASE_FAILED, Check(
                id="auth", label="Authentication", status=FAIL, error_code=ERR_RTSP_ERROR,
                detail=f"DESCRIBE returned RTSP/1.0 {status}. The path '{path}' may be wrong for this camera.",
            ))
            return ERR_RTSP_ERROR, f"Camera answered DESCRIBE with RTSP/1.0 {status} — check the stream path.", {}

        if status != 200:
            return ERR_RTSP_ERROR, f"DESCRIBE returned RTSP/1.0 {status}.", {}

        # ---- SDP / codec ----
        _, _, body = resp.partition("\r\n\r\n")
        info = parse_sdp(body)
        if info.get("codec"):
            emit(PHASE_AUTHENTICATING, Check(
                id="codec", label="Codec", status=PASS,
                detail=f"{info['codec']} (declared by the camera in its SDP)",
                data=info,
            ))
        else:
            emit(PHASE_AUTHENTICATING, Check(
                id="codec", label="Codec", status=NOT_MEASURED,
                detail="Camera's SDP declared no rtpmap we recognise; the decoder below is the real test.",
                data={"sdp_len": len(body)},
            ))
        return None, "", info
    finally:
        try:
            sock.close()
        except OSError:
            pass


def _onvif_negotiate(hostname: str, port: int, user: Optional[str],
                     pwd: Optional[str], emit) -> tuple[Optional[str], str, Optional[str]]:
    emit(PHASE_AUTHENTICATING)
    info = onvif_device_info(hostname, port, user, pwd)
    if not info:
        emit(PHASE_FAILED, Check(
            id="onvif", label="ONVIF discovery", status=FAIL, error_code=ERR_ONVIF_UNAVAILABLE,
            detail=f"{hostname}:{port} did not answer ONVIF GetDeviceInformation at /onvif/device_service. The device may not speak ONVIF, may use a different port, or may have rejected the credentials.",
        ))
        return ERR_ONVIF_UNAVAILABLE, f"{hostname}:{port} did not respond to ONVIF GetDeviceInformation.", None

    emit(PHASE_AUTHENTICATING, Check(
        id="onvif", label="ONVIF discovery", status=PASS,
        detail=f"{info.get('manufacturer','unknown')} {info.get('model','')} (firmware {info.get('firmwareVersion','?')})".strip(),
        data=info,
    ))

    profiles = onvif_profiles(hostname, port, user, pwd)
    if not profiles:
        emit(PHASE_AUTHENTICATING, Check(
            id="onvif_profiles", label="ONVIF profiles", status=FAIL, error_code=ERR_ONVIF_UNAVAILABLE,
            detail="Device answered GetDeviceInformation but returned no media profiles from GetProfiles — it cannot tell us where its stream is.",
        ))
        return ERR_ONVIF_UNAVAILABLE, "ONVIF device exposed no media profiles.", None

    emit(PHASE_AUTHENTICATING, Check(
        id="onvif_profiles", label="ONVIF profiles", status=PASS,
        detail=f"{len(profiles)} profile(s): " + ", ".join(p["name"] for p in profiles),
        data={"profiles": profiles},
    ))

    uri = onvif_stream_uri(hostname, port, profiles[0]["token"], user, pwd)
    if not uri:
        emit(PHASE_AUTHENTICATING, Check(
            id="onvif_uri", label="ONVIF stream URI", status=FAIL, error_code=ERR_ONVIF_UNAVAILABLE,
            detail=f"GetStreamUri returned nothing for profile '{profiles[0]['name']}'.",
        ))
        return ERR_ONVIF_UNAVAILABLE, "ONVIF device would not hand over a stream URI.", None

    emit(PHASE_AUTHENTICATING, Check(
        id="onvif_uri", label="ONVIF stream URI", status=PASS,
        detail=f"Profile '{profiles[0]['name']}' -> {mask_url(uri)}",
        data={"uri": mask_url(uri), "profile": profiles[0]["name"]},
    ))
    return None, "", uri


def _mjpeg_probe(hostname: str, port: int, path: str, user: Optional[str],
                 pwd: Optional[str], emit) -> tuple[Optional[str], str, dict]:
    """HTTP MJPEG. Unlike RTSP, we read this socket ourselves, so bitrate is a
    real measurement here rather than a NOT_MEASURED: we count the bytes that
    actually arrive over a known interval."""
    emit(PHASE_AUTHENTICATING)

    def _get(auth_header: Optional[str]) -> tuple[int, str, socket.socket]:
        s = socket.create_connection((hostname, port), timeout=5.0)
        req = f"GET {path} HTTP/1.1\r\nHost: {hostname}:{port}\r\nUser-Agent: CamAI-ConnectionTest/1.0\r\n"
        if auth_header:
            req += f"Authorization: {auth_header}\r\n"
        req += "\r\n"
        s.settimeout(5.0)
        s.sendall(req.encode("utf-8"))
        buf = b""
        while b"\r\n\r\n" not in buf and len(buf) < 65536:
            chunk = s.recv(4096)
            if not chunk:
                break
            buf += chunk
        head = buf.split(b"\r\n\r\n")[0].decode("utf-8", errors="ignore")
        m = re.match(r"HTTP/\d\.\d\s+(\d+)", head)
        return (int(m.group(1)) if m else 0), head, s

    try:
        status, head, sock = _get(None)
    except OSError as e:
        return ERR_STREAM_UNAVAILABLE, f"HTTP request to {hostname}:{port}{path} failed ({e}).", {}

    try:
        if status == 401:
            challenge = _parse_auth_challenge(head)
            if not user or not challenge:
                return ERR_AUTH_REQUIRED, "This MJPEG stream requires a username and password.", {}
            sock.close()
            hdr = _auth_header(user, pwd or "", "GET", path, challenge)
            try:
                status, head, sock = _get(hdr)
            except OSError as e:
                return ERR_STREAM_UNAVAILABLE, f"HTTP request failed after authenticating ({e}).", {}
            if status in (401, 403):
                emit(PHASE_FAILED, Check(id="auth", label="Authentication", status=FAIL,
                                         error_code=ERR_AUTH_FAILED,
                                         detail=f"Server rejected the credentials for user '{user}'."))
                return ERR_AUTH_FAILED, f"Wrong username or password (server rejected user '{user}').", {}
            emit(PHASE_AUTHENTICATING, Check(
                id="auth", label="Authentication", status=PASS,
                detail=f"Accepted user '{user}' via {challenge.get('scheme','basic')} auth"))
        elif status == 200:
            emit(PHASE_AUTHENTICATING, Check(id="auth", label="Authentication", status=PASS,
                                             detail="Stream did not require authentication."))
        else:
            return ERR_STREAM_UNAVAILABLE, f"Server answered HTTP {status} for {path}.", {}

        ctype = re.search(r"Content-Type:\s*([^\r\n]+)", head, re.IGNORECASE)
        ct = ctype.group(1).strip() if ctype else ""
        if "multipart" not in ct.lower():
            emit(PHASE_FAILED, Check(
                id="mjpeg", label="MJPEG stream", status=FAIL, error_code=ERR_UNSUPPORTED_CODEC,
                detail=f"{path} returned Content-Type '{ct or 'unknown'}', not a multipart MJPEG stream. This URL is probably a snapshot or a web page, not a stream.",
            ))
            return ERR_UNSUPPORTED_CODEC, f"'{ct or 'unknown'}' is not an MJPEG stream (expected multipart/x-mixed-replace).", {}

        # Real bitrate: bytes actually delivered over a measured window.
        emit(PHASE_RECEIVING)
        sock.settimeout(4.0)
        total = 0
        t0 = time.perf_counter()
        window = 2.0
        while time.perf_counter() - t0 < window:
            try:
                chunk = sock.recv(65536)
            except socket.timeout:
                break
            if not chunk:
                break
            total += len(chunk)
        elapsed = max(time.perf_counter() - t0, 1e-6)
        kbps = (total * 8) / elapsed / 1000.0
        emit(PHASE_RECEIVING, Check(
            id="mjpeg", label="MJPEG stream", status=PASS,
            detail=f"multipart stream delivering {kbps:.0f} kbps ({total/1024:.0f} KiB in {elapsed:.1f}s)",
            data={"bitrate_kbps": round(kbps, 1), "content_type": ct},
        ))
        return None, "", {
            "bitrate_kbps": round(kbps, 1),
            "codec": "MJPEG",
        }
    finally:
        try:
            sock.close()
        except OSError:
            pass


def _hls_probe(hostname: str, port: int, path: str, user: Optional[str],
               pwd: Optional[str], emit) -> tuple[Optional[str], str]:
    emit(PHASE_CONNECTING)
    try:
        s = socket.create_connection((hostname, port), timeout=5.0)
    except OSError as e:
        return ERR_STREAM_UNAVAILABLE, f"Could not fetch the HLS playlist ({e})."
    try:
        req = f"GET {path} HTTP/1.1\r\nHost: {hostname}:{port}\r\nConnection: close\r\n"
        if user:
            req += f"Authorization: {_basic_response(user, pwd or '')}\r\n"
        req += "\r\n"
        s.settimeout(5.0)
        s.sendall(req.encode("utf-8"))
        buf = b""
        while len(buf) < 262144:
            try:
                chunk = s.recv(8192)
            except socket.timeout:
                break
            if not chunk:
                break
            buf += chunk
    finally:
        s.close()

    text = buf.decode("utf-8", errors="ignore")
    m = re.match(r"HTTP/\d\.\d\s+(\d+)", text)
    status = int(m.group(1)) if m else 0
    if status in (401, 403):
        return ERR_AUTH_FAILED, f"HLS playlist rejected the credentials (HTTP {status})."
    if status != 200:
        return ERR_STREAM_UNAVAILABLE, f"HLS playlist returned HTTP {status} for {path}."
    if "#EXTM3U" not in text:
        return ERR_PLAYLIST_INVALID, f"{path} did not return an M3U8 playlist (no #EXTM3U header)."

    variants = len(re.findall(r"#EXT-X-STREAM-INF", text))
    segments = len(re.findall(r"#EXTINF", text))
    emit(PHASE_CONNECTING, Check(
        id="hls", label="HLS playlist", status=PASS,
        detail=(f"Master playlist with {variants} variant(s)" if variants
                else f"Media playlist with {segments} segment(s)"),
        data={"variants": variants, "segments": segments},
    ))
    return None, ""


def _test_local_device(st: str, index_raw, result, emit, finish, frame_count: int):
    emit(PHASE_OPENING)
    try:
        index = int(str(index_raw).strip()) if str(index_raw or "0").strip() != "" else 0
    except (TypeError, ValueError):
        return finish(False, ERR_INVALID_URL,
                      f"'{index_raw}' is not a device index. USB and webcam sources are addressed by number (0, 1, 2...).")

    result.url = f"device:{index}"
    cap = cv2.VideoCapture(index, cv2.CAP_DSHOW)
    if not cap.isOpened():
        cap.release()
        cap = cv2.VideoCapture(index)
    if not cap.isOpened():
        cap.release()
        emit(PHASE_FAILED, Check(
            id="device", label="Open device", status=FAIL, error_code=ERR_DEVICE_NOT_FOUND,
            detail=f"No camera at device index {index}. It may be unplugged, or in use by another application (Windows gives exclusive access to the first opener).",
        ))
        return finish(False, ERR_DEVICE_NOT_FOUND,
                      f"No camera found at device index {index} (unplugged, or held by another app).")

    emit(PHASE_OPENING, Check(id="device", label="Open device", status=PASS,
                              detail=f"Opened device index {index}"))
    return _pull_frames(cap, result, emit, finish, frame_count, 8.0, {})


def _test_file(p: str, result, emit, finish, frame_count: int):
    emit(PHASE_OPENING)
    result.url = p
    if not p:
        return finish(False, ERR_INVALID_URL, "No file path was provided.")
    if not os.path.isfile(p):
        emit(PHASE_FAILED, Check(
            id="file", label="Video file", status=FAIL, error_code=ERR_FILE_NOT_FOUND,
            detail=f"'{p}' does not exist or is not a file.",
        ))
        return finish(False, ERR_FILE_NOT_FOUND, f"'{p}' does not exist.")

    size = os.path.getsize(p)
    cap = cv2.VideoCapture(p)
    if not cap.isOpened():
        cap.release()
        emit(PHASE_FAILED, Check(
            id="file", label="Video file", status=FAIL, error_code=ERR_UNSUPPORTED_CODEC,
            detail=f"'{os.path.basename(p)}' exists ({size/1048576:.1f} MB) but no installed decoder could open it.",
        ))
        return finish(False, ERR_UNSUPPORTED_CODEC,
                      f"'{os.path.basename(p)}' could not be decoded — unsupported codec or container.")

    emit(PHASE_OPENING, Check(id="file", label="Video file", status=PASS,
                              detail=f"{os.path.basename(p)} ({size/1048576:.1f} MB)"))
    return _pull_frames(cap, result, emit, finish, frame_count, 8.0, {})


def _test_stream(full_url: str, result, emit, finish, frame_count: int,
                 frame_timeout: float, sdp_info: dict):
    emit(PHASE_OPENING)
    # Same FFmpeg options the real capture loop uses (pipeline.py:25) — testing
    # under a different transport than production would validate a path the
    # product never takes.
    t0 = time.perf_counter()
    cap = cv2.VideoCapture(full_url, cv2.CAP_FFMPEG)
    open_ms = (time.perf_counter() - t0) * 1000.0

    if not cap.isOpened():
        cap.release()
        emit(PHASE_FAILED, Check(
            id="stream_open", label="Stream opens", status=FAIL, error_code=ERR_STREAM_UNAVAILABLE,
            detail=f"The endpoint answered every protocol check, but the decoder could not open the stream. The path may point at a channel that exists but is not streaming.",
            duration_ms=round(open_ms, 1),
        ))
        return finish(False, ERR_STREAM_UNAVAILABLE,
                      "Handshake succeeded but the stream would not open — check the stream path/channel.")

    emit(PHASE_OPENING, Check(
        id="stream_open", label="Stream opens", status=PASS,
        detail=f"Decoder opened the stream in {open_ms:.0f} ms",
        duration_ms=round(open_ms, 1),
    ))
    result.metrics["stream_open_ms"] = round(open_ms, 1)
    return _pull_frames(cap, result, emit, finish, frame_count, frame_timeout, sdp_info)


def _pull_frames(cap, result, emit, finish, frame_count: int,
                 frame_timeout: float, sdp_info: dict):
    """Decode real frames. This is the only check that proves video actually
    flows — everything before it proves the camera is willing to talk."""
    emit(PHASE_RECEIVING)
    read_times = []
    frames = 0
    first_frame_ms = None
    resolution = ""
    t_start = time.perf_counter()

    try:
        while frames < frame_count:
            if time.perf_counter() - t_start > frame_timeout:
                break
            t0 = time.perf_counter()
            ok, frame = cap.read()
            dt = (time.perf_counter() - t0) * 1000.0
            if not ok or frame is None:
                # One bad read is normal on stream start; the loop's own timeout
                # is the real bound.
                continue
            if first_frame_ms is None:
                first_frame_ms = (time.perf_counter() - t_start) * 1000.0
                h, w = frame.shape[:2]
                resolution = f"{w}x{h}"
            read_times.append(dt)
            frames += 1

        elapsed = time.perf_counter() - t_start

        if frames == 0:
            emit(PHASE_FAILED, Check(
                id="frames", label="Video frames received", status=FAIL, error_code=ERR_NO_FRAMES,
                detail=f"The stream opened but delivered no decodable frames in {frame_timeout:.0f}s. The codec may be unsupported, or the channel may be idle.",
            ))
            return finish(False, ERR_NO_FRAMES,
                          f"Stream opened but produced no frames in {frame_timeout:.0f}s.")

        # FPS across the whole pull, not 1/mean(read). Those differ: read()
        # returns buffered frames back-to-back, so averaging per-call time
        # reports a number far above what the camera actually sends.
        fps = frames / elapsed if elapsed > 0 else 0.0
        avg_read = sum(read_times) / len(read_times)

        emit(PHASE_RECEIVING, Check(
            id="frames", label="Video frames received", status=PASS,
            detail=f"{frames} frames decoded in {elapsed:.1f}s at {resolution}",
            data={"frames": frames, "resolution": resolution},
        ))
        emit(PHASE_RECEIVING, Check(
            id="fps", label="FPS", status=PASS,
            detail=f"{fps:.1f} fps measured over {frames} frames",
            data={"fps": round(fps, 1)},
        ))
        emit(PHASE_RECEIVING, Check(
            id="resolution", label="Resolution", status=PASS,
            detail=resolution, data={"resolution": resolution},
        ))

        result.metrics.update({
            "fps": round(fps, 1),
            "resolution": resolution,
            "frames_decoded": frames,
            "first_frame_ms": round(first_frame_ms or 0.0, 1),
            "frame_read_ms": round(avg_read, 1),
        })

        # Codec: prefer the camera's own SDP declaration. Fall back to FOURCC
        # only when it is a sane printable tag — for RTSP it is usually 0, and
        # reporting "codec: \x00\x00\x00\x00" would be worse than saying we
        # don't know.
        if sdp_info.get("codec"):
            result.metrics["codec"] = sdp_info["codec"]
            result.metrics["codec_source"] = "sdp"
        else:
            fourcc = int(cap.get(cv2.CAP_PROP_FOURCC))
            tag = "".join(chr((fourcc >> (8 * i)) & 0xFF) for i in range(4)) if fourcc else ""
            if tag.strip() and tag.isprintable() and tag.strip("\x00"):
                result.metrics["codec"] = tag.strip()
                result.metrics["codec_source"] = "fourcc"
            else:
                result.metrics["codec"] = None
                result.metrics["codec_source"] = "unavailable"

        result.metrics.setdefault("bitrate_kbps", {
            "status": NOT_MEASURED,
            "reason": "Bitrate requires demuxing RTP; OpenCV hands us decoded frames, not the byte stream.",
        })
        return finish(True)
    finally:
        cap.release()


def run_test_stream(**kwargs) -> Iterator[dict]:
    """Generator form: yields one dict per phase/check so an HTTP layer can
    stream progress, then a final {"done": true, "result": ...}."""
    events: list = []
    def on_phase(phase: str, check: Optional[Check]):
        events.append({"phase": phase, "check": asdict(check) if check else None})

    kwargs["on_phase"] = on_phase
    # run_test is synchronous; drain the queue as it fills by running it in a
    # thread would add complexity for little gain here — instead the caller
    # gets the events in order once each blocking step resolves.
    import threading
    result_box: dict = {}
    def _run():
        result_box["result"] = run_test(**kwargs)
    th = threading.Thread(target=_run, daemon=True)
    th.start()
    seen = 0
    while th.is_alive() or seen < len(events):
        while seen < len(events):
            yield events[seen]
            seen += 1
        if th.is_alive():
            time.sleep(0.05)
    yield {"done": True, "result": asdict(result_box["result"])}
