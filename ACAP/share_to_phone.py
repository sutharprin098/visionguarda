#!/usr/bin/env python3
"""
CamAI ACAP Mobile Transfer Utility
Starts a lightweight local HTTP server to download camai_acap_1_0_0_aarch64.eap
directly onto your Mobile Phone over Wi-Fi.
"""

import http.server
import socketserver
import socket
import os

PORT = 8080

def get_local_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"

def start_server():
    local_ip = get_local_ip()
    acap_dir = os.path.dirname(os.path.abspath(__file__))
    os.chdir(acap_dir)

    print("==================================================")
    print(" CamAI ACAP Mobile Download Server Active        ")
    print("==================================================")
    print(f"[*] Local PC IP: {local_ip}")
    print(f"[*] Open this link on your Mobile Phone Browser:\n")
    print(f"    👉 http://{local_ip}:{PORT}/camai_acap_1_0_0_aarch64.eap\n")
    print("==================================================")

    handler = http.server.SimpleHTTPRequestHandler
    with socketserver.TCPServer(("", PORT), handler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n[+] Mobile Download Server stopped.")

if __name__ == "__main__":
    start_server()
