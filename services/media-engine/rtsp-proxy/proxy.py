import socket
import threading
import sys
import os
import re
import time
import base64
import struct
from urllib.parse import urlsplit, unquote

try:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
except ImportError:
    AESGCM = None  # type: ignore

try:
    import redis as redis_py
except ImportError:  # pragma: no cover - older image without redis-py
    redis_py = None

LISTEN_PORT = 8555
REDIS_HOST = os.getenv("REDIS_HOST", "redis")
REDIS_PORT = int(os.getenv("REDIS_PORT", "6379"))
REDIS_PASSWORD = os.getenv("REDIS_PASSWORD", "")
CREDENTIAL_KEY_RAW = os.getenv("CREDENTIAL_KEY", "")
REDIS_ENC_PREFIX = "enc:v1:"
MAX_RTSP_HEADER_BYTES = 16384
IDLE_TIMEOUT_SEC = float(os.getenv("RTSP_PROXY_IDLE_TIMEOUT_SEC", "300"))
MAX_CONNECTIONS = int(os.getenv("RTSP_PROXY_MAX_CONNECTIONS", "50"))


def mask_sensitive(text: str) -> str:
    """Mask credentials in RTSP URLs and Authorization headers."""
    if not text:
        return ""
    # Mask userinfo up to the last '@' before the path, so a password that
    # itself contains '@' cannot leak its tail (Spec §10 item 6).
    text = re.sub(r'(rtsps?://)[^\s/]*@', r'\1***:***@', text)
    text = re.sub(r'(Authorization:\s*(?:Basic|Digest)\s+)[^\r\n]+', r'\1***', text, flags=re.IGNORECASE)
    return text


def derive_credential_key(raw_key: str | None = None) -> bytes | None:
    key_b64 = raw_key if raw_key is not None else (os.getenv("CREDENTIAL_KEY") or CREDENTIAL_KEY_RAW)
    if not key_b64:
        return None
    try:
        key_bytes = base64.b64decode(key_b64)
        if len(key_bytes) != 32 or all(b == 0 for b in key_bytes):
            print("[RTSP-Proxy] Invalid CREDENTIAL_KEY length or all-zero key", file=sys.stderr, flush=True)
            return None
        return key_bytes
    except Exception as exc:
        print(f"[RTSP-Proxy] Failed to decode CREDENTIAL_KEY: {exc}", file=sys.stderr, flush=True)
        return None


def decrypt_redis_rtsp_url(stored_value: str, raw_key: str | None = None) -> str | None:
    """
    Decrypts an AES-256-GCM envelope ('enc:v1:<base64([12B IV][16B Tag][Ciphertext])>')
    stored in Redis back into a plaintext RTSP URL in memory.
    """
    if not stored_value:
        return None
    if stored_value.startswith(REDIS_ENC_PREFIX):
        if AESGCM is None:
            print("[RTSP-Proxy] cryptography package is required to decrypt RTSP URLs", file=sys.stderr, flush=True)
            return None
        key = derive_credential_key(raw_key)
        if not key:
            print("[RTSP-Proxy] CREDENTIAL_KEY is missing; cannot decrypt camera RTSP URL", file=sys.stderr, flush=True)
            return None
        try:
            raw = base64.b64decode(stored_value[len(REDIS_ENC_PREFIX):])
            if len(raw) < 28:
                print("[RTSP-Proxy] Encrypted RTSP payload truncated (< 28 bytes)", file=sys.stderr, flush=True)
                return None
            iv = raw[:12]
            tag = raw[12:28]
            ciphertext = raw[28:]
            plaintext = AESGCM(key).decrypt(iv, ciphertext + tag, None)
            return plaintext.decode("utf-8")
        except Exception as exc:
            print(f"[RTSP-Proxy] AES-GCM decryption failed for RTSP URL: {exc}", file=sys.stderr, flush=True)
            return None

    # Allow legacy plaintext only in non-production environments with a warning
    if os.getenv("NODE_ENV", "production") != "production" and stored_value.startswith("rtsp://"):
        print("[RTSP-Proxy] WARNING: Using unencrypted RTSP URL from Redis in non-production mode", file=sys.stderr, flush=True)
        return stored_value

    print("[RTSP-Proxy] Refusing unencrypted or unrecognized RTSP payload in Redis", file=sys.stderr, flush=True)
    return None


# In-memory target cache: cam_id -> (target_url, expire_timestamp)
URL_CACHE: dict[str, tuple[str, float]] = {}
CACHE_TTL = 15.0

# Fallback default camera from environment if needed
DEFAULT_CAMERA_URL = os.getenv("RTSP_DEFAULT_CAMERA_URL", "")

_redis_client = None
_redis_lock = threading.Lock()


def get_redis_client():
    """Lazily create a shared redis-py client (preferred over hand-rolled RESP)."""
    global _redis_client
    if redis_py is None:
        return None
    with _redis_lock:
        if _redis_client is None:
            _redis_client = redis_py.Redis(
                host=REDIS_HOST,
                port=REDIS_PORT,
                password=REDIS_PASSWORD or None,
                socket_connect_timeout=2.0,
                socket_timeout=2.0,
                decode_responses=True,
                health_check_interval=30,
            )
        return _redis_client


def _query_redis_rtsp_url_socket(cam_id: str) -> str | None:
    """Legacy hand-rolled RESP lookup, used only when redis-py is unavailable."""
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
                raw_val = lines[1].decode("utf-8", errors="replace").strip()
                return decrypt_redis_rtsp_url(raw_val)
    except Exception as exc:
        print(f"[RTSP-Proxy] Legacy Redis lookup error for cam {cam_id}: {exc}", file=sys.stderr, flush=True)
    return None


def query_redis_rtsp_url(cam_id: str) -> str | None:
    now = time.time()
    cached = URL_CACHE.get(cam_id)
    if cached and now < cached[1]:
        return cached[0]

    # Prune expired entries so the cache cannot grow without bound.
    if len(URL_CACHE) > 256:
        for k, (_, exp) in list(URL_CACHE.items()):
            if now >= exp:
                URL_CACHE.pop(k, None)

    url = None
    client = get_redis_client()
    if client is not None:
        try:
            raw_val = client.get(f"cam:{cam_id}:rtsp_url")
            if raw_val:
                url = decrypt_redis_rtsp_url(raw_val)
        except Exception as exc:
            print(f"[RTSP-Proxy] redis-py lookup error for cam {cam_id}: {exc}", file=sys.stderr, flush=True)

    if url is None:
        url = _query_redis_rtsp_url_socket(cam_id)

    if url:
        URL_CACHE[cam_id] = (url, now + CACHE_TTL)
    return url


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
            if cam_id == "1":
                target_url = DEFAULT_CAMERA_URL or None
            else:
                target_url = None
        return cam_id, target_url, subpath

    return None, None, path


def parse_content_length(header_bytes: bytes) -> int:
    m = re.search(rb'Content-Length:\s*(\d+)', header_bytes, flags=re.IGNORECASE)
    if not m:
        return 0
    try:
        return max(0, int(m.group(1)))
    except ValueError:
        return 0


def rewrite_client_rtsp_message(msg_bytes: bytes, target_host: str, target_port: int, target_path: str, auth_header: bytes | None) -> bytes:
    header_end = msg_bytes.find(b"\r\n\r\n")
    if header_end == -1:
        return msg_bytes
    headers_part = msg_bytes[:header_end + 4]
    body_part = msg_bytes[header_end + 4:]

    def rewrite_req(match):
        method = match.group(1)
        full_url = match.group(2).decode("utf-8", errors="ignore")
        proto = match.group(3)
        p = urlsplit(full_url)
        req_path = p.path or ""

        sub = ""
        cm = re.search(r'/cam\d+', req_path)
        if cm:
            sub = req_path[cm.end():]
        elif req_path.startswith(target_path):
            sub = req_path[len(target_path):]

        new_url = f"rtsp://{target_host}:{target_port}{target_path}{sub}"
        return f"{method.decode()} {new_url} {proto.decode()}".encode()

    new_headers = re.sub(rb'^([A-Z]+)\s+([^\s]+)\s+(RTSP/1\.[0-9])', rewrite_req, headers_part, count=1, flags=re.MULTILINE)
    if auth_header and not new_headers.startswith(b"OPTIONS") and b"Authorization:" not in new_headers:
        lines = new_headers.split(b"\r\n", 1)
        if len(lines) == 2:
            new_headers = lines[0] + b"\r\n" + auth_header + lines[1]

    return new_headers + body_part


def rewrite_server_rtsp_message(msg_bytes: bytes) -> bytes:
    header_end = msg_bytes.find(b"\r\n\r\n")
    if header_end == -1:
        return msg_bytes
    headers_part = msg_bytes[:header_end]
    body_part = msg_bytes[header_end + 4:]

    # 1. Strip Digest header ONLY IF Basic is also offered
    if b"WWW-Authenticate: Digest" in headers_part and b"WWW-Authenticate: Basic" in headers_part:
        lines = headers_part.split(b"\r\n")
        filtered = [l for l in lines if not l.startswith(b"WWW-Authenticate: Digest")]
        headers_part = b"\r\n".join(filtered)

    # 2. Fix empty AAC config in SDP body (fixes V380 Pro and macro-video cameras)
    if b"m=audio" in body_part and b"config=" in body_part:
        new_body = re.sub(rb'config=([;\r\n])', rb'config=1588\1', body_part)
        if new_body != body_part:
            body_part = new_body
            if re.search(rb'Content-Length:\s*\d+', headers_part, flags=re.IGNORECASE):
                headers_part = re.sub(
                    rb'Content-Length:\s*\d+',
                    f"Content-Length: {len(body_part)}".encode(),
                    headers_part,
                    count=1,
                    flags=re.IGNORECASE,
                )

    return headers_part + b"\r\n\r\n" + body_part


def drain_framed_stream(buf: bytearray, on_rtsp_msg, on_rtp_frame) -> bytearray:
    """
    Processes complete interleaved RTP/RTCP frames ($ + 1B chan + 2B len + payload)
    and complete RTSP text messages (headers + \r\n\r\n + Content-Length body) from buf.
    Returns the remaining unconsumed tail buffer.
    """
    while buf:
        if buf[0] == 0x24:  # '$' interleaved RTP/RTCP frame
            if len(buf) < 4:
                break
            _, _, payload_len = struct.unpack("!BBH", bytes(buf[:4]))
            total_frame_len = 4 + payload_len
            if len(buf) < total_frame_len:
                break
            frame = bytes(buf[:total_frame_len])
            del buf[:total_frame_len]
            on_rtp_frame(frame)
        else:
            header_end = buf.find(b"\r\n\r\n")
            if header_end == -1:
                if len(buf) > MAX_RTSP_HEADER_BYTES:
                    # Flush oversized non-standard chunk unmodified to avoid memory exhaustion
                    chunk = bytes(buf)
                    buf.clear()
                    on_rtp_frame(chunk)
                break
            headers_bytes = bytes(buf[:header_end + 4])
            body_len = parse_content_length(headers_bytes)
            total_msg_len = header_end + 4 + body_len
            if len(buf) < total_msg_len:
                break
            msg = bytes(buf[:total_msg_len])
            del buf[:total_msg_len]
            on_rtsp_msg(msg)
    return buf


def handle_client(client: socket.socket, addr, release_slot=None):
    cam_socket: socket.socket | None = None
    target_host: str | None = None
    target_port = 554
    target_path = ""
    auth_header: bytes | None = None
    cam_id: str | None = None

    def c2s():
        nonlocal cam_socket, target_host, target_port, target_path, auth_header, cam_id
        c2s_buf = bytearray()
        connected_upstream = False
        try:
            client.settimeout(10.0)
            while True:
                data = client.recv(8192)
                if not data:
                    break
                c2s_buf.extend(data)

                if not connected_upstream:
                    header_end = c2s_buf.find(b"\r\n\r\n")
                    if header_end == -1:
                        if len(c2s_buf) > MAX_RTSP_HEADER_BYTES:
                            print(f"[RTSP-Proxy] Initial RTSP header exceeded {MAX_RTSP_HEADER_BYTES} bytes from {addr}", file=sys.stderr, flush=True)
                            client.close()
                            return
                        continue

                    first_req_txt = bytes(c2s_buf[:header_end + 4]).decode("utf-8", errors="ignore")
                    print(f"[RTSP-Proxy] Received first request from client {addr}: {mask_sensitive(first_req_txt[:120])!r}", flush=True)
                    cid, t_url, _ = resolve_target(first_req_txt)
                    if not t_url:
                        print(f"[RTSP-Proxy] No target RTSP URL for camera {cid}, rejecting request", file=sys.stderr, flush=True)
                        cseq_m = re.search(r'CSeq:\s*(\d+)', first_req_txt, re.IGNORECASE)
                        cseq = cseq_m.group(1) if cseq_m else "1"
                        try:
                            client.sendall(f"RTSP/1.0 404 Stream Not Found\r\nCSeq: {cseq}\r\n\r\n".encode())
                        except OSError:
                            pass
                        client.close()
                        return

                    cam_id = cid or "1"
                    parsed = urlsplit(t_url)
                    target_host = parsed.hostname
                    target_port = parsed.port or 554
                    target_path = parsed.path.rstrip("/")
                    if not target_host:
                        print(f"[RTSP-Proxy] Invalid target host in URL {mask_sensitive(t_url)} for camera {cid}, rejecting", file=sys.stderr, flush=True)
                        client.close()
                        return

                    if parsed.username and parsed.password:
                        cred = f"{parsed.username}:{unquote(parsed.password)}"
                        auth_header = b"Authorization: Basic " + base64.b64encode(cred.encode()) + b"\r\n"
                    else:
                        auth_header = None

                    try:
                        cam_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                        cam_socket.settimeout(5.0)
                        cam_socket.connect((target_host, target_port))
                        # Idle timeout (not "no timeout") so a stalled camera or
                        # client cannot pin a thread/socket forever.
                        cam_socket.settimeout(IDLE_TIMEOUT_SEC)
                        client.settimeout(IDLE_TIMEOUT_SEC)
                        connected_upstream = True
                        print(f"[RTSP-Proxy] Proxying client {addr} to cam{cam_id} -> {target_host}:{target_port}{target_path}", flush=True)
                        threading.Thread(target=s2c, daemon=True).start()
                    except Exception as e:
                        print(f"[RTSP-Proxy] Connect failed to {target_host}:{target_port} for cam{cam_id}: {e}", file=sys.stderr, flush=True)
                        cseq_m = re.search(r'CSeq:\s*(\d+)', first_req_txt, re.IGNORECASE)
                        cseq = cseq_m.group(1) if cseq_m else "1"
                        try:
                            client.sendall(f"RTSP/1.0 503 Service Unavailable\r\nCSeq: {cseq}\r\n\r\n".encode())
                        except OSError:
                            pass
                        client.close()
                        return

                if not cam_socket or not target_host:
                    break

                drain_framed_stream(
                    c2s_buf,
                    on_rtsp_msg=lambda msg: cam_socket.sendall(
                        rewrite_client_rtsp_message(msg, target_host, target_port, target_path, auth_header)
                    ),
                    on_rtp_frame=lambda frame: cam_socket.sendall(frame),
                )
        except (ConnectionResetError, BrokenPipeError, TimeoutError, socket.timeout):
            pass
        except OSError as exc:
            if exc.errno not in (9, 104, 32):  # EBADF, ECONNRESET, EPIPE
                print(f"[RTSP-Proxy] c2s socket error for cam{cam_id}: {exc}", file=sys.stderr, flush=True)
        except Exception as exc:
            print(f"[RTSP-Proxy] Unexpected c2s error for cam{cam_id}: {exc}", file=sys.stderr, flush=True)
        finally:
            try:
                client.close()
            except OSError:
                pass
            if cam_socket:
                try:
                    cam_socket.close()
                except OSError:
                    pass
            if release_slot is not None:
                release_slot.release()

    def s2c():
        s2c_buf = bytearray()
        try:
            while True:
                if not cam_socket:
                    break
                data = cam_socket.recv(8192)
                if not data:
                    break
                s2c_buf.extend(data)
                drain_framed_stream(
                    s2c_buf,
                    on_rtsp_msg=lambda msg: client.sendall(rewrite_server_rtsp_message(msg)),
                    on_rtp_frame=lambda frame: client.sendall(frame),
                )
        except (ConnectionResetError, BrokenPipeError):
            pass
        except OSError as exc:
            if exc.errno not in (9, 104, 32):
                print(f"[RTSP-Proxy] s2c socket error for cam{cam_id}: {exc}", file=sys.stderr, flush=True)
        except Exception as exc:
            print(f"[RTSP-Proxy] Unexpected s2c error for cam{cam_id}: {exc}", file=sys.stderr, flush=True)
        finally:
            try:
                client.close()
            except OSError:
                pass
            if cam_socket:
                try:
                    cam_socket.close()
                except OSError:
                    pass

    threading.Thread(target=c2s, daemon=True).start()


def main():
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    s.bind(('0.0.0.0', LISTEN_PORT))
    s.listen(MAX_CONNECTIONS)
    # Bound concurrent sessions so a burst cannot exhaust threads/sockets.
    connection_slots = threading.BoundedSemaphore(MAX_CONNECTIONS)
    print(
        f"[Universal RTSP-Proxy] Listening on 0.0.0.0:{LISTEN_PORT} -> dynamic routing via Redis "
        f"(AES-256-GCM, max {MAX_CONNECTIONS} sessions, idle {IDLE_TIMEOUT_SEC:.0f}s)",
        flush=True,
    )
    while True:
        try:
            client, addr = s.accept()
            if not connection_slots.acquire(blocking=False):
                print(f"[RTSP-Proxy] Connection limit {MAX_CONNECTIONS} reached; rejecting {addr}", file=sys.stderr, flush=True)
                try:
                    client.sendall(b"RTSP/1.0 503 Service Unavailable\r\n\r\n")
                except OSError:
                    pass
                client.close()
                continue
            handle_client(client, addr, connection_slots)
        except KeyboardInterrupt:
            break
        except Exception as e:
            print(f"[RTSP-Proxy] Accept error: {e}", file=sys.stderr, flush=True)


if __name__ == '__main__':
    main()
