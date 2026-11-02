import os, socket, hashlib, re

CAMERA_IP = os.getenv("CAMERA_IP", "192.168.1.100")
CAMERA_PORT = int(os.getenv("CAMERA_PORT", "554"))
STREAM_URI = os.getenv("STREAM_URI", "/Streaming/Channels/101")
CAMERA_PWD = os.getenv("CAMERA_PWD", "SecretPassword123@")

def test_digest(pwd, uri_in_digest):
    try:
        s = socket.socket()
        s.settimeout(3.0)
        s.connect((CAMERA_IP, CAMERA_PORT))
        s.sendall(f'DESCRIBE rtsp://{CAMERA_IP}:{CAMERA_PORT}{STREAM_URI} RTSP/1.0\r\nCSeq: 1\r\n\r\n'.encode())
        res1 = s.recv(1024).decode(errors='ignore')
        nonce_m = re.search(r'nonce="([^"]+)"', res1)
        realm_m = re.search(r'realm="([^"]+)"', res1)
        if not nonce_m or not realm_m:
            print("Could not find nonce/realm:", res1)
            s.close()
            return
        nonce = nonce_m.group(1)
        realm = realm_m.group(1)
        
        ha1 = hashlib.md5(f"admin:{realm}:{pwd}".encode()).hexdigest()
        ha2 = hashlib.md5(f"DESCRIBE:{uri_in_digest}".encode()).hexdigest()
        resp = hashlib.md5(f"{ha1}:{nonce}:{ha2}".encode()).hexdigest()
        
        auth_header = f'Digest username="admin", realm="{realm}", nonce="{nonce}", uri="{uri_in_digest}", response="{resp}"'
        s.sendall(f'DESCRIBE rtsp://{CAMERA_IP}:{CAMERA_PORT}{STREAM_URI} RTSP/1.0\r\nCSeq: 2\r\nAuthorization: {auth_header}\r\n\r\n'.encode())
        res2 = s.recv(1024).decode(errors='ignore')
        print(f"PWD: {pwd!r} | URI: {uri_in_digest} -> {res2.splitlines()[0] if res2 else 'empty'}")
        s.close()
    except Exception as e:
        print(f"Connection error to {CAMERA_IP}:{CAMERA_PORT} ({e})")

if __name__ == "__main__":
    for pwd in [CAMERA_PWD, f"{CAMERA_PWD}."]:
        test_digest(pwd, f'rtsp://{CAMERA_IP}:{CAMERA_PORT}{STREAM_URI}')
        test_digest(pwd, f'rtsp://{CAMERA_IP}{STREAM_URI}')
        test_digest(pwd, STREAM_URI)

