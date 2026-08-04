"""Camera connection test (server/app/camera_test.py).

The suite is built around two properties that the old cloud-side probe could
not have, and that are the entire reason this module exists:

  1. Credentials are actually sent, so a wrong password is distinguishable
     from an absent camera. `verifyCameraConnection` in
     supabase/functions/_shared/util.ts never sent an Authorization header on
     any code path, so "wrong username/password" was undetectable by
     construction — and, for private IPs, it returned ok:true without opening
     a socket at all.

  2. Every failure carries a specific error code. The spec's "never display
     generic Connection Failed" is only enforceable if there is no generic
     code to fall back on, so test_no_generic_failure walks the taxonomy.

The digest test is a known-answer test against the RFC 2617 §3.5 vector rather
than a self-consistency check. Getting digest subtly wrong would make every
camera on the network report AUTH_FAILED — a failure mode strictly worse than
the status quo, because it would look like the operator's fault.
"""
import socket
import threading
import hashlib
import re

import pytest

from app import camera_test as ct


# ---------------------------------------------------------------------------
# Digest / Basic
# ---------------------------------------------------------------------------
def test_digest_matches_rfc2617_vector(monkeypatch):
    """RFC 2617 §3.5: the canonical worked example. If this drifts, real
    cameras start rejecting correct passwords."""
    monkeypatch.setattr(ct, "_make_cnonce", lambda: "0a4f113b")
    challenge = ct._parse_auth_challenge(
        'WWW-Authenticate: Digest realm="testrealm@host.com", qop="auth", '
        'nonce="dcd98b7102dd2f0e8b11d0f600bfb0c093", '
        'opaque="5ccc069c403ebaf9f0171e9517f40e41"'
    )
    hdr = ct._digest_response("Mufasa", "Circle Of Life", "GET",
                              "/dir/index.html", challenge)
    m = re.search(r'response="([0-9a-f]{32})"', hdr)
    assert m, hdr
    assert m.group(1) == "6629fae49393a05397450978507c4ef1"
    assert 'qop=auth' in hdr
    assert 'nc=00000001' in hdr
    assert 'opaque="5ccc069c403ebaf9f0171e9517f40e41"' in hdr


def test_digest_without_qop_uses_rfc2069_form():
    """Cameras are split on whether they offer qop. The legacy form omits
    nc/cnonce from the hash entirely — mixing the two up reads to an operator
    exactly like a wrong password."""
    challenge = ct._parse_auth_challenge('WWW-Authenticate: Digest realm="r", nonce="n"')
    hdr = ct._digest_response("u", "p", "DESCRIBE", "rtsp://x/y", challenge)

    ha1 = hashlib.md5(b"u:r:p").hexdigest()
    ha2 = hashlib.md5(b"DESCRIBE:rtsp://x/y").hexdigest()
    expect = hashlib.md5(f"{ha1}:n:{ha2}".encode()).hexdigest()

    assert f'response="{expect}"' in hdr
    assert "qop" not in hdr
    assert "cnonce" not in hdr


def test_basic_challenge_produces_basic_header():
    challenge = ct._parse_auth_challenge('WWW-Authenticate: Basic realm="cam"')
    assert challenge["scheme"] == "basic"
    hdr = ct._auth_header("admin", "hunter2", "DESCRIBE", "rtsp://x/", challenge)
    assert hdr == "Basic YWRtaW46aHVudGVyMg=="


# ---------------------------------------------------------------------------
# URL handling
# ---------------------------------------------------------------------------
def test_password_special_chars_are_encoded():
    """A password with '@' or '/' is legal on every camera admin page and would
    otherwise split the authority, silently addressing a different host."""
    from urllib.parse import urlparse, unquote
    url = ct.build_url("rtsp", host="10.0.0.5", port=554,
                       username="admin", password="p@ss/w0rd", path="stream1")
    assert urlparse(url).hostname == "10.0.0.5"
    # urlparse hands back the userinfo still encoded, which is exactly the trap
    # run_test has to undo before hashing — see test_encoded_password_round_trips.
    assert unquote(urlparse(url).password) == "p@ss/w0rd"


def test_encoded_password_round_trips_to_the_digest(monkeypatch):
    """Regression: build_url percent-encodes the password into the URL, and
    run_test re-parses that URL to recover the credentials. urlparse does NOT
    decode, so without an unquote the digest was computed over
    'p%40ss%2Fw0rd' while the camera hashed 'p@ss/w0rd' — a CORRECT password
    reported as AUTH_FAILED, blaming the operator for our own escaping."""
    # The SSRF guard (blocked_source_reason) correctly refuses loopback in
    # production — no real camera is ever the engine's own machine — but this
    # test stands a fake RTSP server up on 127.0.0.1 to exercise the protocol
    # logic without a real network device, so it must bypass that guard.
    monkeypatch.setattr(ct, "blocked_source_reason", lambda url: None)
    cam = FakeRtspCamera(username="admin", password="p@ss/w0rd")
    try:
        res = ct.run_test("rtsp", host="127.0.0.1", port=cam.port,
                          username="admin", password="p@ss/w0rd", path="/stream")
        # The stream itself cannot open (the fake serves no RTP), but auth must
        # have succeeded — that is what this test pins.
        assert res.error_code != ct.ERR_AUTH_FAILED, \
            "correct password rejected — the percent-encoding round-trip is broken again"
        auth = [c for c in res.checks if c.id == "auth"]
        assert auth and auth[0].status == ct.PASS, [ (c.id, c.status, c.detail) for c in res.checks ]
    finally:
        cam.close()


def test_explicit_url_wins_over_fields():
    url = ct.build_url("rtsp", host="10.0.0.5", url="rtsp://other/path")
    assert url == "rtsp://other/path"


def test_mask_url_hides_password():
    masked = ct.mask_url("rtsp://admin:hunter2@10.0.0.5:554/s1")
    assert "hunter2" not in masked
    assert masked == "rtsp://admin:***@10.0.0.5:554/s1"


def test_result_never_carries_the_raw_password():
    """The result goes to the portal, to logs, and onto screens."""
    res = ct.run_test("rtsp", host="203.0.113.1", port=1,
                      username="admin", password="hunter2")
    assert "hunter2" not in res.url
    assert "hunter2" not in res.error_detail


# ---------------------------------------------------------------------------
# SDP
# ---------------------------------------------------------------------------
def test_parse_sdp_extracts_h264():
    sdp = (
        "v=0\r\no=- 1 1 IN IP4 10.0.0.5\r\nm=video 0 RTP/AVP 96\r\n"
        "a=rtpmap:96 H264/90000\r\na=control:trackID=1\r\n"
        "a=x-dimensions:1920,1080\r\n"
    )
    info = ct.parse_sdp(sdp)
    assert info["codec"] == "H264"
    assert info["sdp_resolution"] == "1920x1080"
    assert info["control"] == "trackID=1"


def test_parse_sdp_picks_video_codec_over_audio():
    """Cameras advertise audio too; reporting PCMU as the video codec would be
    wrong in a way nobody would notice until a decoder failed."""
    sdp = (
        "m=audio 0 RTP/AVP 0\r\na=rtpmap:0 PCMU/8000\r\n"
        "m=video 0 RTP/AVP 96\r\na=rtpmap:96 H265/90000\r\n"
    )
    assert ct.parse_sdp(sdp)["codec"] == "H265"


def test_parse_sdp_without_rtpmap_reports_nothing():
    assert "codec" not in ct.parse_sdp("v=0\r\nm=video 0 RTP/AVP 96\r\n")


# ---------------------------------------------------------------------------
# A fake RTSP camera — the auth round-trip end to end
# ---------------------------------------------------------------------------
SDP_BODY = (
    "v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\ns=Test\r\n"
    "m=video 0 RTP/AVP 96\r\na=rtpmap:96 H264/90000\r\na=control:trackID=1\r\n"
)


class FakeRtspCamera:
    """Speaks just enough RTSP to challenge and verify a Digest credential."""

    def __init__(self, username="admin", password="secret", realm="IP Camera",
                 nonce="abc123nonce", require_auth=True, qop=True):
        self.username, self.password = username, password
        self.realm, self.nonce = realm, nonce
        self.require_auth, self.qop = require_auth, qop
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.sock.bind(("127.0.0.1", 0))
        self.sock.listen(1)
        self.port = self.sock.getsockname()[1]
        self.thread = threading.Thread(target=self._serve, daemon=True)
        self.thread.start()

    def _expected(self, method, uri, params):
        ha1 = hashlib.md5(f"{self.username}:{self.realm}:{self.password}".encode()).hexdigest()
        ha2 = hashlib.md5(f"{method}:{uri}".encode()).hexdigest()
        if self.qop:
            return hashlib.md5(
                f"{ha1}:{self.nonce}:{params.get('nc','')}:{params.get('cnonce','')}:auth:{ha2}".encode()
            ).hexdigest()
        return hashlib.md5(f"{ha1}:{self.nonce}:{ha2}".encode()).hexdigest()

    def _challenge(self):
        q = ' qop="auth",' if self.qop else ""
        return (f'RTSP/1.0 401 Unauthorized\r\nCSeq: 2\r\n'
                f'WWW-Authenticate: Digest realm="{self.realm}",{q} nonce="{self.nonce}"\r\n\r\n')

    def _serve(self):
        # Accept repeatedly, not once: run_test's TCP-reachability probe opens
        # and closes its own connection before the RTSP handshake dials again,
        # so a single-shot accept would leave the handshake hanging.
        while True:
            try:
                conn, _ = self.sock.accept()
            except OSError:
                return
            threading.Thread(target=self._handle, args=(conn,), daemon=True).start()

    def _handle(self, conn):
        with conn:
            buf = b""
            while True:
                try:
                    chunk = conn.recv(4096)
                except OSError:
                    return
                if not chunk:
                    return
                buf += chunk
                while b"\r\n\r\n" in buf:
                    head, _, buf = buf.partition(b"\r\n\r\n")
                    text = head.decode("utf-8", errors="ignore")
                    if not text.strip():
                        continue
                    try:
                        conn.sendall(self._respond(text).encode())
                    except OSError:
                        return

    def _respond(self, req: str) -> str:
        method = req.split(" ", 1)[0]
        uri = req.split(" ")[1] if len(req.split(" ")) > 1 else "*"

        if method == "OPTIONS":
            return "RTSP/1.0 200 OK\r\nCSeq: 1\r\nPublic: OPTIONS, DESCRIBE, SETUP, PLAY\r\n\r\n"

        if method == "DESCRIBE":
            if not self.require_auth:
                return (f"RTSP/1.0 200 OK\r\nCSeq: 2\r\nContent-Type: application/sdp\r\n"
                        f"Content-Length: {len(SDP_BODY)}\r\n\r\n{SDP_BODY}")
            m = re.search(r"Authorization:\s*Digest\s*(.*)", req, re.IGNORECASE)
            if not m:
                return self._challenge()
            params = dict(re.findall(r'(\w+)\s*=\s*"?([^",\r\n]*)"?', m.group(1)))
            if params.get("response") != self._expected("DESCRIBE", uri, params):
                return self._challenge()
            return (f"RTSP/1.0 200 OK\r\nCSeq: 3\r\nContent-Type: application/sdp\r\n"
                    f"Content-Length: {len(SDP_BODY)}\r\n\r\n{SDP_BODY}")

        return "RTSP/1.0 501 Not Implemented\r\nCSeq: 9\r\n\r\n"

    def close(self):
        try:
            self.sock.close()
        except OSError:
            pass


@pytest.fixture
def cam():
    c = FakeRtspCamera()
    yield c
    c.close()


def _noop_emit(phase, check=None):
    pass


def test_correct_password_authenticates(cam):
    code, detail, sdp = ct._rtsp_handshake("127.0.0.1", cam.port, "/stream",
                                           "admin", "secret", _noop_emit)
    assert code is None, f"expected success, got {code}: {detail}"
    assert sdp["codec"] == "H264"


def test_wrong_password_is_reported_as_auth_failed(cam):
    """The headline capability. Before this module the product could not tell
    a wrong password from an unreachable camera."""
    code, detail, _ = ct._rtsp_handshake("127.0.0.1", cam.port, "/stream",
                                         "admin", "WRONG", _noop_emit)
    assert code == ct.ERR_AUTH_FAILED
    assert "admin" in detail
    assert "WRONG" not in detail  # never echo the attempted secret


def test_missing_credentials_reported_as_auth_required(cam):
    """Distinct from AUTH_FAILED: nothing was tried, so nothing was rejected.
    'Wrong username/password' for a field the operator left blank would send
    them hunting for a credential problem that does not exist."""
    code, detail, _ = ct._rtsp_handshake("127.0.0.1", cam.port, "/stream",
                                         None, None, _noop_emit)
    assert code == ct.ERR_AUTH_REQUIRED
    assert "IP Camera" in detail  # surfaces the realm the camera asked for


def test_open_camera_needs_no_credentials():
    c = FakeRtspCamera(require_auth=False)
    try:
        code, _, sdp = ct._rtsp_handshake("127.0.0.1", c.port, "/stream",
                                          None, None, _noop_emit)
        assert code is None
        assert sdp["codec"] == "H264"
    finally:
        c.close()


def test_legacy_camera_without_qop_authenticates():
    c = FakeRtspCamera(qop=False)
    try:
        code, detail, _ = ct._rtsp_handshake("127.0.0.1", c.port, "/stream",
                                             "admin", "secret", _noop_emit)
        assert code is None, f"RFC 2069 camera rejected a correct password: {detail}"
    finally:
        c.close()


def test_non_rtsp_service_on_the_port_is_not_a_password_problem():
    """An HTTP server on 554 must not be reported as an auth failure — that
    would send the operator to the credentials screen for a port mistake."""
    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind(("127.0.0.1", 0))
    srv.listen(1)
    port = srv.getsockname()[1]

    def serve():
        try:
            conn, _ = srv.accept()
            with conn:
                conn.recv(4096)
                conn.sendall(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n")
        except OSError:
            pass

    threading.Thread(target=serve, daemon=True).start()
    try:
        code, detail, _ = ct._rtsp_handshake("127.0.0.1", port, "/", None, None, _noop_emit)
        assert code == ct.ERR_RTSP_ERROR
        assert "not with RTSP" in detail or "did not speak RTSP" in detail
    finally:
        srv.close()


# ---------------------------------------------------------------------------
# Error taxonomy — the "never say Connection Failed" guarantee
# ---------------------------------------------------------------------------
def test_connection_refused_is_distinct_from_blocked(monkeypatch):
    """A refusal means something answered — that is a port mistake, not a
    firewall. Collapsing the two sends operators down the wrong path.

    ("blocked" here is PORT_BLOCKED, a firewall silently dropping the
    connection — unrelated to the SSRF guard's own BLOCKED_ADDRESS, which
    this test bypasses since it deliberately targets 127.0.0.1 to simulate
    an unreachable port without a real network device.)"""
    monkeypatch.setattr(ct, "blocked_source_reason", lambda url: None)
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()  # nothing is listening now

    res = ct.run_test("rtsp", host="127.0.0.1", port=port)
    assert res.ok is False
    assert res.error_code == ct.ERR_CONNECTION_REFUSED
    assert str(port) in res.error_detail


def test_run_test_refuses_a_loopback_address():
    """The SSRF guard is real, not just present in stream_resolver: a portal
    user who can trigger a connection test must never get this engine to open
    a socket to itself or to another local service. No monkeypatch here —
    this is the one test that must see the guard actually fire."""
    res = ct.run_test("rtsp", host="127.0.0.1", port=54321)
    assert res.ok is False
    assert res.error_code == ct.ERR_BLOCKED_ADDRESS


def test_run_test_refuses_cloud_metadata_address():
    res = ct.run_test("http_mjpeg", host="169.254.169.254", port=80, path="/latest/meta-data/")
    assert res.ok is False
    assert res.error_code == ct.ERR_BLOCKED_ADDRESS


def test_dns_failure_is_reported_as_dns():
    res = ct.run_test("rtsp", host="no-such-host.invalid", port=554)
    assert res.ok is False
    assert res.error_code == ct.ERR_DNS_FAILED
    assert "resolve" in res.error_detail.lower()


def test_unknown_source_type_is_rejected():
    res = ct.run_test("carrier-pigeon", host="10.0.0.5")
    assert res.ok is False
    assert res.error_code == ct.ERR_INVALID_URL


def test_missing_host_is_rejected():
    res = ct.run_test("rtsp")
    assert res.ok is False
    assert res.error_code == ct.ERR_INVALID_URL


def test_no_generic_failure():
    """Every failing result carries a specific, actionable code — there is no
    generic bucket, which is what makes 'never display Connection Failed'
    structurally true rather than a UI convention."""
    failures = [
        ct.run_test("rtsp", host="no-such-host.invalid"),
        ct.run_test("carrier-pigeon", host="1.2.3.4"),
        ct.run_test("rtsp"),
        ct.run_test("file", url="/definitely/not/here.mp4"),
        ct.run_test("usb", url="not-a-number"),
    ]
    for res in failures:
        assert res.ok is False
        assert res.error_code, f"a failure with no error code: {res}"
        assert res.error_code in vars(ct).values() or res.error_code.isupper()
        assert res.error_detail and res.error_detail != "Connection Failed"
        assert res.phase == ct.PHASE_FAILED


def test_every_failed_check_has_an_error_code():
    res = ct.run_test("rtsp", host="no-such-host.invalid")
    for c in res.checks:
        if c.status == ct.FAIL:
            assert c.error_code, f"check '{c.id}' failed with no error code"


# ---------------------------------------------------------------------------
# Honesty of unmeasurable metrics
# ---------------------------------------------------------------------------
def test_packet_loss_is_reported_as_not_measured_never_as_a_number():
    """This project has shipped invented telemetry before (a smoke detector
    reporting 'concrete' on 200/200 frames; PPE hardcoded at 0.95; a km/h
    figure built from an invented constant). Packet loss has no honest source
    behind OpenCV, so it must never acquire a value."""
    res = ct.run_test("rtsp", host="no-such-host.invalid")
    pl = res.metrics["packet_loss"]
    assert pl["status"] == ct.NOT_MEASURED
    assert "RTP" in pl["reason"]
    assert not isinstance(pl, (int, float))


def test_gpu_is_not_attributed_to_a_single_test():
    res = ct.run_test("rtsp", host="no-such-host.invalid")
    gpu = res.metrics["gpu_percent"]
    assert gpu["status"] == ct.NOT_MEASURED
    assert "attribution" in gpu["reason"] or "attributed" in gpu["reason"]


# ---------------------------------------------------------------------------
# Sources with nothing to dial
# ---------------------------------------------------------------------------
def test_screen_share_skips_rather_than_pretending_to_probe():
    res = ct.run_test("screen_share")
    assert res.ok is True
    assert res.checks[0].status == ct.SKIP
    assert "desktop" in res.checks[0].detail.lower()


def test_missing_file_reports_file_not_found():
    res = ct.run_test("file", url="/definitely/not/here.mp4")
    assert res.error_code == ct.ERR_FILE_NOT_FOUND


def test_usb_index_must_be_a_number():
    res = ct.run_test("usb", url="not-a-number")
    assert res.error_code == ct.ERR_INVALID_URL
    assert "index" in res.error_detail.lower()
