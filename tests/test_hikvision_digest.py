import os, socket, hashlib, re

cam_host = os.getenv("CAMERA_HOST", "192.168.1.100")
s = socket.socket()
s.connect((cam_host, 554))
s.sendall(f'DESCRIBE rtsp://{cam_host}:554/Streaming/Channels/101 RTSP/1.0\r\nCSeq: 1\r\n\r\n'.encode())
res1 = s.recv(1024).decode()
nonce = re.search(r'nonce="([^"]+)"', res1).group(1)
realm = re.search(r'realm="([^"]+)"', realm_match.group(1) if (realm_match := re.search(r'realm="([^"]+)"', res1)) else "Hikvision")

user = os.getenv("CAMERA_USER", "admin")
pwd = os.getenv("CAMERA_PASSWORD", "")
ha1 = hashlib.md5(f'{user}:{realm}:{pwd}'.encode()).hexdigest()

for uri in [
    f'rtsp://{cam_host}:554/Streaming/Channels/101',
    f'rtsp://{cam_host}:554/Streaming/Channels/101/',
    '/Streaming/Channels/101',
    f'rtsp://{cam_host}/Streaming/Channels/101'
]:
    s2 = socket.socket()
    s2.connect((cam_host, 554))
    s2.sendall(f'DESCRIBE rtsp://{cam_host}:554/Streaming/Channels/101 RTSP/1.0\r\nCSeq: 1\r\n\r\n'.encode())
    r1 = s2.recv(1024).decode()
    non = re.search(r'nonce="([^"]+)"', r1).group(1)
    
    ha2 = hashlib.md5(f'DESCRIBE:{uri}'.encode()).hexdigest()
    resp = hashlib.md5(f'{ha1}:{non}:{ha2}'.encode()).hexdigest()

    auth = f'Digest username="admin", realm="{realm}", nonce="{non}", uri="{uri}", response="{resp}"'
    req = f'DESCRIBE rtsp://{cam_host}:554/Streaming/Channels/101 RTSP/1.0\r\nCSeq: 2\r\nAuthorization: {auth}\r\n\r\n'
    s2.sendall(req.encode())
    r2 = s2.recv(1024).decode(errors='ignore')
    print(f"URI: {uri} -> {r2.splitlines()[0] if r2 else 'empty'}")
    s2.close()

