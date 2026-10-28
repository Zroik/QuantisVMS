import socket, hashlib, re

def test_rtsp(pwd):
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(3.0)
        s.connect(('192.168.100.67', 554))
        
        req1 = "DESCRIBE rtsp://192.168.100.67:554/Streaming/Channels/101 RTSP/1.0\r\nCSeq: 1\r\nUser-Agent: test\r\n\r\n"
        s.sendall(req1.encode())
        res1 = s.recv(4096).decode(errors='ignore')
        
        nonce_m = re.search(r'nonce="([^"]+)"', res1)
        realm_m = re.search(r'realm="([^"]+)"', res1)
        if not nonce_m or not realm_m:
            print("Could not find nonce/realm:", res1)
            return
        nonce = nonce_m.group(1)
        realm = realm_m.group(1)
        
        ha1 = hashlib.md5(f"admin:{realm}:{pwd}".encode()).hexdigest()
        ha2 = hashlib.md5(b"DESCRIBE:rtsp://192.168.100.67:554/Streaming/Channels/101").hexdigest()
        resp = hashlib.md5(f"{ha1}:{nonce}:{ha2}".encode()).hexdigest()
        
        auth_header = f'Digest username="admin", realm="{realm}", nonce="{nonce}", uri="rtsp://192.168.100.67:554/Streaming/Channels/101", response="{resp}"'
        req2 = f"DESCRIBE rtsp://192.168.100.67:554/Streaming/Channels/101 RTSP/1.0\r\nCSeq: 2\r\nUser-Agent: test\r\nAuthorization: {auth_header}\r\n\r\n"
        s.sendall(req2.encode())
        res2 = s.recv(4096).decode(errors='ignore')
        print(f"Testing password {pwd!r}: status = {res2.splitlines()[0] if res2 else 'no reply'}")
        s.close()
    except Exception as e:
        print(f"Error testing {pwd!r}: {e}")

test_rtsp("REDACTED-LEAKED-PASSWORD@.")
test_rtsp("REDACTED-LEAKED-PASSWORD@")
test_rtsp("REDACTED-LEAKED-PASSWORD%40.")
test_rtsp("REDACTED-LEAKED-PASSWORD.")
test_rtsp("REDACTED-LEAKED-PASSWORD")

