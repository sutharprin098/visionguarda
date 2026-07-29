"""Classifies *why* a network camera source isn't producing frames, so the
capture loop (see app.ai.pipeline.PipelineCoordinator._capture_loop) can
report accurate status upstream instead of a blanket "offline". Mirrors the
reachability + RTSP-handshake technique the cloud edge function uses for
the "Test Connection" button (supabase/functions/_shared/util.ts
verifyCameraConnection) — this runs from the desktop's own LAN, the only
vantage point that can actually reach a camera behind a private network.
"""
import socket
from urllib.parse import urlparse


def probe_connection(source: str, timeout: float = 3.0) -> str:
    """Returns 'connecting', 'auth_failed', or 'network_error'. Only
    meaningful for network sources (rtsp/http); never called for USB."""
    try:
        parsed = urlparse(str(source))
    except Exception:
        return "network_error"
    host = parsed.hostname
    if not host:
        return "network_error"
    port = parsed.port or (554 if parsed.scheme == "rtsp" else 443 if parsed.scheme == "https" else 80)

    try:
        with socket.create_connection((host, port), timeout=timeout) as sock:
            if parsed.scheme != "rtsp":
                return "connecting"
            path = parsed.path or "/"
            req = f"OPTIONS rtsp://{host}:{port}{path} RTSP/1.0\r\nCSeq: 1\r\n\r\n".encode()
            sock.sendall(req)
            sock.settimeout(timeout)
            resp = sock.recv(512).decode(errors="ignore")
            if resp.startswith("RTSP/1.0 401") or resp.startswith("RTSP/1.0 403"):
                return "auth_failed"
            return "connecting"
    except (socket.timeout, ConnectionRefusedError, OSError):
        return "network_error"
