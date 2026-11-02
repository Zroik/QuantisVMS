import socket
import threading
import sys
import os
import re
import time
import base64
from urllib.parse import urlsplit, unquote

LISTEN_PORT = 8555
REDIS_HOST = os.getenv("REDIS_HOST", "redis")
REDIS_PORT = int(os.getenv("REDIS_PORT", "6379"))
REDIS_PASSWORD = os.getenv("REDIS_PASSWORD", "redis_password_secret")

# In-memory target cache: cam_id -> (target_url, expire_timestamp)
URL_CACHE = {}
CACHE_TTL = 15.0

# Fallback default camera from environment if needed
DEFAULT_CAMERA_URL = os.getenv("RTSP_DEFAULT_CAMERA_URL", "")

def query_redis_rtsp_url(cam_id: str) -> str | None:
    now = time.time()
    if cam_id in URL_CACHE:
        val, exp = URL_CACHE[cam_id]
        if now < exp:
            return val

    key = f"cam:{cam_id}:rtsp_url"
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(2.0)
        s.connect((REDIS_HOST, REDIS_PORT))
        if REDIS_PASSWORD:
            s.sendall(f"AUTH {REDIS_PASSWORD}\r\n".encode())
            s.recv(1024)
        s.sendall(f"GET {key}\r\n".encode())
        resp = s.recv(4096)
        s.close()

        if resp.startswith(b"$"):
            lines = resp.split(b"\r\n", 2)
            if len(lines) >= 2 and lines[0] != b"$-1":
                url = lines[1].decode("utf-8", errors="replace").strip()
                if url:
                    URL_CACHE[cam_id] = (url, now + CACHE_TTL)
                    return url
    except Exception as exc:
        print(f"[RTSP-Proxy] Redis lookup error for cam {cam_id}: {exc}", file=sys.stderr)

    return None

def resolve_target(request_text: str):
    """
    Parses request line (e.g. DESCRIBE rtsp://.../cam1... RTSP/1.0).
    Returns (cam_id, target_url, subpath).
    """
    m = re.search(r'^[A-Z]+\s+([^\s]+)\s+RTSP/1\.[0-9]', request_text, flags=re.MULTILINE)
    if not m:
        return None, None, ""

    url_str = m.group(1)
    p = urlsplit(url_str)
    path = p.path or ""

    cam_match = re.search(r'/cam(\d+)', path)
    if cam_match:
        cam_id = cam_match.group(1)
        subpath = path[cam_match.end():]
        target_url = query_redis_rtsp_url(cam_id)
        if not target_url:
            # Fallback ONLY for camera 1 if configured via env
            if cam_id == "1":
                target_url = DEFAULT_CAMERA_URL or None
            else:
                target_url = None
        return cam_id, target_url, subpath

    # Request without /cam{id}
    return None, None, path

def handle_client(client, addr):
    first_packet = True
    cam_socket = None
    target_host = None
    target_port = 554
    target_path = ""
    auth_header = None
    cam_id = None

    def c2s():
        nonlocal first_packet, cam_socket, target_host, target_port, target_path, auth_header, cam_id
        try:
            while True:
                data = client.recv(8192)
                if not data:
                    break

                if first_packet:
                    first_packet = False
                    txt = data.decode("utf-8", errors="ignore")
                    print(f"[RTSP-Proxy] Received first packet from client {addr}: {txt[:120]!r}")
                    sys.stdout.flush()
                    cid, t_url, _ = resolve_target(txt)
                    if not t_url:
                        print(f"[RTSP-Proxy] No target RTSP URL for camera {cid}, rejecting request", file=sys.stderr)
                        cseq_m = re.search(r'CSeq:\s*(\d+)', txt, re.IGNORECASE)
                        cseq = cseq_m.group(1) if cseq_m else "1"
                        try:
                            client.sendall(f"RTSP/1.0 404 Stream Not Found\r\nCSeq: {cseq}\r\n\r\n".encode())
                        except Exception:
                            pass
                        client.close()
                        return

                    cam_id = cid or "1"
                    parsed = urlsplit(t_url)
                    target_host = parsed.hostname
                    target_port = parsed.port or 554
                    target_path = parsed.path.rstrip("/")
                    if not target_host:
                        print(f"[RTSP-Proxy] Invalid target host in URL {t_url} for camera {cid}, rejecting", file=sys.stderr)
                        client.close()
                        return

                    if parsed.username and parsed.password:
                        cred = f"{parsed.username}:{unquote(parsed.password)}"
                        auth_header = b"Authorization: Basic " + base64.b64encode(cred.encode()) + b"\r\n"
                    else:
                        auth_header = None

                    try:
                        cam_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                        cam_socket.settimeout(3.0)
                        cam_socket.connect((target_host, target_port))
                        cam_socket.settimeout(None)
                        print(f"[RTSP-Proxy] Proxying client {addr} to cam{cam_id} -> {target_host}:{target_port}{target_path}")
                        sys.stdout.flush()
                        threading.Thread(target=s2c, daemon=True).start()
                    except Exception as e:
                        print(f"[RTSP-Proxy] Connect failed to {target_host}:{target_port} for cam{cam_id}: {e}", file=sys.stderr)
                        cseq_m = re.search(r'CSeq:\s*(\d+)', txt, re.IGNORECASE)
                        cseq = cseq_m.group(1) if cseq_m else "1"
                        try:
                            client.sendall(f"RTSP/1.0 503 Service Unavailable\r\nCSeq: {cseq}\r\n\r\n".encode())
                        except Exception:
                            pass
                        client.close()
                        return

                if not cam_socket:
                    break

                # Rewrite RTSP request text if not binary RTP interleaved packet
                if not data.startswith(b"$"):
                    def rewrite_req(match):
                        method = match.group(1)
                        full_url = match.group(2).decode("utf-8", errors="ignore")
                        proto = match.group(3)
                        p = urlsplit(full_url)
                        req_path = p.path or ""

                        # Strip /cam{id}
                        sub = ""
                        cm = re.search(r'/cam\d+', req_path)
                        if cm:
                            sub = req_path[cm.end():]
                        elif req_path.startswith(target_path):
                            sub = req_path[len(target_path):]

                        new_url = f"rtsp://{target_host}:{target_port}{target_path}{sub}"
                        return f"{method.decode()} {new_url} {proto.decode()}".encode()

                    new_data = re.sub(rb'^([A-Z]+)\s+([^\s]+)\s+(RTSP/1\.[0-9])', rewrite_req, data, flags=re.MULTILINE)
                    # Do NOT inject Authorization on OPTIONS - Hikvision terminates TCP connection if auth is on OPTIONS
                    if auth_header and not new_data.startswith(b"OPTIONS") and b"Authorization:" not in new_data:
                        lines = new_data.split(b"\r\n", 1)
                        if len(lines) == 2:
                            new_data = lines[0] + b"\r\n" + auth_header + lines[1]
                    cam_socket.sendall(new_data)
                else:
                    cam_socket.sendall(data)
        except Exception:
            pass
        finally:
            client.close()
            if cam_socket:
                cam_socket.close()

    def s2c():
        try:
            while True:
                if not cam_socket:
                    break
                data = cam_socket.recv(8192)
                if not data:
                    break

                if not data.startswith(b"$"):
                    # 1. Strip Digest header to force client to use Basic auth (fixes Hikvision / Dahua)
                    if b"WWW-Authenticate: Digest" in data:
                        lines = data.split(b"\r\n")
                        filtered = [l for l in lines if not l.startswith(b"WWW-Authenticate: Digest")]
                        data = b"\r\n".join(filtered)

                    # 2. Fix empty AAC config in SDP (fixes V380 Pro and macro-video cameras)
                    if b"m=audio" in data and b"config=" in data:
                        new_data = re.sub(rb'config=([;\r\n])', rb'config=1588\1', data)
                        cl_match = re.search(rb'Content-Length:\s*(\d+)', new_data)
                        if cl_match:
                            header_end = new_data.find(rb'\r\n\r\n')
                            if header_end != -1:
                                body = new_data[header_end + 4:]
                                actual_len = len(body)
                                new_data = re.sub(rb'Content-Length:\s*\d+', f'Content-Length: {actual_len}'.encode(), new_data)
                        data = new_data

                    client.sendall(data)
                else:
                    client.sendall(data)
        except Exception:
            pass
        finally:
            client.close()
            if cam_socket:
                cam_socket.close()

    threading.Thread(target=c2s, daemon=True).start()

def main():
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    s.bind(('0.0.0.0', LISTEN_PORT))
    s.listen(25)
    print(f"[Universal RTSP-Proxy] Listening on 0.0.0.0:{LISTEN_PORT} -> dynamic routing via Redis / MySQL")
    sys.stdout.flush()
    while True:
        try:
            client, addr = s.accept()
            handle_client(client, addr)
        except KeyboardInterrupt:
            break
        except Exception as e:
            print(f"[RTSP-Proxy] Accept error: {e}", file=sys.stderr)

if __name__ == '__main__':
    main()
