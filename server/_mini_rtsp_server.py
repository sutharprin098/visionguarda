"""Minimal single-client RTSP/RTP server for locally testing the app's RTSP
capture path (no real IP camera available in this environment).

Reads a raw H.264 Annex-B elementary stream from ffmpeg's stdout and
re-packetizes it as RTP (RFC 6184 H.264 payload, with FU-A fragmentation for
NALs over the UDP MTU), serving it over a hand-rolled RTSP OPTIONS/DESCRIBE/
SETUP/PLAY handshake. Good enough to validate that cv2.VideoCapture(rtsp://...)
via OpenCV's FFmpeg backend actually connects and reads frames end-to-end.
"""
import re
import socket
import struct
import subprocess
import sys
import threading
import time

FFMPEG = r"C:\Users\Expert\AppData\Local\Programs\Python\Python311\Lib\site-packages\imageio_ffmpeg\binaries\ffmpeg-win-x86_64-v7.1.exe"
RTSP_PORT = 8554
WIDTH, HEIGHT, FPS = 640, 480, 15

PAYLOAD_TYPE = 96
SSRC = 0x1234ABCD


def find_nals(data: bytes):
    """Split Annex-B bytestream into NAL units (without start codes)."""
    starts = [m.start() for m in re.finditer(rb'\x00\x00\x00\x01|\x00\x00\x01', data)]
    nals = []
    for i, s in enumerate(starts):
        body_start = s + (4 if data[s:s + 4] == b'\x00\x00\x00\x01' else 3)
        end = starts[i + 1] if i + 1 < len(starts) else len(data)
        nals.append(data[body_start:end])
    return nals


class RTPSender:
    def __init__(self, sock, dst_ip, dst_port):
        self.sock = sock
        self.dst = (dst_ip, dst_port)
        self.seq = 0
        self.ts = 0
        self.mtu = 1400

    def _send_rtp(self, payload: bytes, marker: bool):
        b0 = 0x80
        b1 = (0x80 if marker else 0x00) | PAYLOAD_TYPE
        header = struct.pack('!BBHII', b0, b1, self.seq & 0xFFFF, self.ts & 0xFFFFFFFF, SSRC)
        self.seq += 1
        try:
            self.sock.sendto(header + payload, self.dst)
        except OSError:
            raise

    def send_nal(self, nal: bytes, marker: bool):
        if not nal:
            return
        if len(nal) <= self.mtu:
            self._send_rtp(nal, marker)
            return
        # FU-A fragmentation (RFC 6184 section 5.8)
        header_byte = nal[0]
        nal_type = header_byte & 0x1F
        nri = header_byte & 0x60
        payload = nal[1:]
        i = 0
        first = True
        while i < len(payload):
            chunk = payload[i:i + self.mtu - 2]
            i += len(chunk)
            last = i >= len(payload)
            fu_indicator = bytes([nri | 28])  # type 28 = FU-A
            fu_header = (0x80 if first else 0) | (0x40 if last else 0) | nal_type
            self._send_rtp(fu_indicator + bytes([fu_header]) + chunk, marker and last)
            first = False

    def advance_timestamp(self):
        self.ts += 90000 // FPS


def rtsp_worker(conn: socket.socket, addr):
    print(f"[MiniRTSP] Client connected: {addr}", flush=True)
    f = conn.makefile('rwb')
    udp_sock = None
    ffmpeg_proc = None
    playing = threading.Event()
    stop = threading.Event()

    def feeder(dst_ip, dst_port):
        nonlocal ffmpeg_proc
        sender = RTPSender(udp_sock, dst_ip, dst_port)
        ffmpeg_proc = subprocess.Popen(
            [FFMPEG, "-loglevel", "error", "-re", "-f", "lavfi",
             "-i", f"testsrc=size={WIDTH}x{HEIGHT}:rate={FPS}",
             "-c:v", "libx264", "-preset", "ultrafast", "-tune", "zerolatency",
             "-pix_fmt", "yuv420p", "-g", str(FPS),
             "-f", "h264", "-"],
            stdout=subprocess.PIPE, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        playing.wait()
        buf = b""
        start_code = re.compile(rb'\x00\x00\x00\x01|\x00\x00\x01')
        while not stop.is_set():
            chunk = ffmpeg_proc.stdout.read(4096)
            if not chunk:
                break
            buf += chunk
            starts = [m.start() for m in start_code.finditer(buf)]
            if len(starts) < 2:
                continue  # need a following start code to know the last complete NAL's end
            complete_end = starts[-1]
            segment, buf = buf[:complete_end], buf[complete_end:]
            nals = find_nals(segment)
            for idx, nal in enumerate(nals):
                sender.send_nal(nal, marker=(idx == len(nals) - 1))
            sender.advance_timestamp()
            time.sleep(1.0 / FPS)

    try:
        while not stop.is_set():
            request = b""
            while b"\r\n\r\n" not in request:
                data = conn.recv(4096)
                if not data:
                    return
                request += data
            text = request.decode(errors="ignore")
            lines = text.split("\r\n")
            if not lines or not lines[0]:
                continue
            method, url, _ = lines[0].split(" ", 2)
            headers = {}
            for line in lines[1:]:
                if ":" in line:
                    k, v = line.split(":", 1)
                    headers[k.strip().lower()] = v.strip()
            cseq = headers.get("cseq", "1")
            print(f"[MiniRTSP] {method} {url}", flush=True)

            if method == "OPTIONS":
                resp = (f"RTSP/1.0 200 OK\r\nCSeq: {cseq}\r\n"
                        f"Public: OPTIONS, DESCRIBE, SETUP, PLAY, TEARDOWN\r\n\r\n")
                conn.sendall(resp.encode())
            elif method == "DESCRIBE":
                sdp = (
                    "v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\ns=MiniRTSP\r\nt=0 0\r\n"
                    f"m=video 0 RTP/AVP {PAYLOAD_TYPE}\r\n"
                    "a=rtpmap:96 H264/90000\r\n"
                    "a=fmtp:96 packetization-mode=1\r\n"
                    "a=control:track0\r\n"
                )
                resp = (f"RTSP/1.0 200 OK\r\nCSeq: {cseq}\r\n"
                        f"Content-Base: {url}/\r\nContent-Type: application/sdp\r\n"
                        f"Content-Length: {len(sdp)}\r\n\r\n{sdp}")
                conn.sendall(resp.encode())
            elif method == "SETUP":
                transport = headers.get("transport", "")
                m = re.search(r"client_port=(\d+)-(\d+)", transport)
                client_rtp_port = int(m.group(1)) if m else 5000
                udp_sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
                udp_sock.bind(("0.0.0.0", 0))
                server_port = udp_sock.getsockname()[1]
                resp = (f"RTSP/1.0 200 OK\r\nCSeq: {cseq}\r\n"
                        f"Transport: RTP/AVP;unicast;client_port={client_rtp_port}-{client_rtp_port+1};"
                        f"server_port={server_port}-{server_port+1}\r\n"
                        f"Session: 12345678\r\n\r\n")
                conn.sendall(resp.encode())
                dst_ip = addr[0]
                dst_port = client_rtp_port
                t = threading.Thread(target=feeder, args=(dst_ip, dst_port), daemon=True)
                t.start()
            elif method == "PLAY":
                resp = (f"RTSP/1.0 200 OK\r\nCSeq: {cseq}\r\nSession: 12345678\r\n"
                        f"Range: npt=0.000-\r\n\r\n")
                conn.sendall(resp.encode())
                playing.set()
            elif method == "TEARDOWN":
                resp = f"RTSP/1.0 200 OK\r\nCSeq: {cseq}\r\n\r\n"
                conn.sendall(resp.encode())
                stop.set()
                break
            else:
                resp = f"RTSP/1.0 200 OK\r\nCSeq: {cseq}\r\n\r\n"
                conn.sendall(resp.encode())
    finally:
        stop.set()
        if ffmpeg_proc:
            try:
                ffmpeg_proc.kill()
            except Exception:
                pass
        try:
            conn.close()
        except Exception:
            pass
        print(f"[MiniRTSP] Client disconnected: {addr}", flush=True)


def main():
    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind(("0.0.0.0", RTSP_PORT))
    srv.listen(5)
    print(f"[MiniRTSP] Listening on rtsp://0.0.0.0:{RTSP_PORT}/teststream", flush=True)
    while True:
        conn, addr = srv.accept()
        threading.Thread(target=rtsp_worker, args=(conn, addr), daemon=True).start()


if __name__ == "__main__":
    main()
