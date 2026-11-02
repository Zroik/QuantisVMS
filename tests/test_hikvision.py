import os, socket, hashlib, re

CAMERA_IP = os.getenv("CAMERA_IP", "192.168.1.100")
CAMERA_PORT = int(os.getenv("CAMERA_PORT", "554"))
STREAM_URI = os.getenv("STREAM_URI", "/Streaming/Channels/101")
CAMERA_PWD = os.getenv("CAMERA_PWD", "SecretPassword123@")

def test_rtsp(pwd):
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(3.0)
        s.connect((CAMERA_IP, CAMERA_PORT))
        
        req1 = f"DESCRIBE rtsp://{CAMERA_IP}:{CAMERA_PORT}{STREAM_URI} RTSP/1.0\r\nCSeq: 1\r\nUser-Agent: test\r\n\r\n"
        s.sendall(req1.encode())
        res1 = s.recv(4096).decode(errors='ignore')
        
        nonce_m = re.search(r'nonce="([^"]+)"', res1)
        realm_m = re.search(r'realm="([^"]+)"', res1)
        if not nonce_m or not realm_m:
            print("Could not find nonce/realm:", res1)
            s.close()
            return
        nonce = nonce_m.group(1)
        realm = realm_m.group(1)
        
        ha1 = hashlib.md5(f"admin:{realm}:{pwd}".encode()).hexdigest()
        ha2 = hashlib.md5(f"DESCRIBE:rtsp://{CAMERA_IP}:{CAMERA_PORT}{STREAM_URI}".encode()).hexdigest()
        resp = hashlib.md5(f"{ha1}:{nonce}:{ha2}".encode()).hexdigest()
        
        auth_header = f'Digest username="admin", realm="{realm}", nonce="{nonce}", uri="rtsp://{CAMERA_IP}:{CAMERA_PORT}{STREAM_URI}", response="{resp}"'
        req2 = f"DESCRIBE rtsp://{CAMERA_IP}:{CAMERA_PORT}{STREAM_URI} RTSP/1.0\r\nCSeq: 2\r\nUser-Agent: test\r\nAuthorization: {auth_header}\r\n\r\n"
        s.sendall(req2.encode())
        res2 = s.recv(4096).decode(errors='ignore')
        print(f"Testing password {pwd!r}: status = {res2.splitlines()[0] if res2 else 'no reply'}")
        s.close()
    except Exception as e:
        print(f"Error testing {pwd!r} on {CAMERA_IP}:{CAMERA_PORT} ({e})")

if __name__ == "__main__":
    for p in [CAMERA_PWD, f"{CAMERA_PWD}."]:
        test_rtsp(p)

