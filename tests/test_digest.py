import socket, hashlib, re

def test_digest(pwd, uri_in_digest):
    s = socket.socket()
    s.connect(('192.168.100.67', 554))
    s.sendall(b'DESCRIBE rtsp://192.168.100.67:554/Streaming/Channels/101 RTSP/1.0\r\nCSeq: 1\r\n\r\n')
    res1 = s.recv(1024).decode()
    nonce = re.search(r'nonce="([^"]+)"', res1).group(1)
    realm = re.search(r'realm="([^"]+)"', res1).group(1)
    
    ha1 = hashlib.md5(f"admin:{realm}:{pwd}".encode()).hexdigest()
    ha2 = hashlib.md5(f"DESCRIBE:{uri_in_digest}".encode()).hexdigest()
    resp = hashlib.md5(f"{ha1}:{nonce}:{ha2}".encode()).hexdigest()
    
    auth_header = f'Digest username="admin", realm="{realm}", nonce="{nonce}", uri="{uri_in_digest}", response="{resp}"'
    s.sendall(f'DESCRIBE rtsp://192.168.100.67:554/Streaming/Channels/101 RTSP/1.0\r\nCSeq: 2\r\nAuthorization: {auth_header}\r\n\r\n'.encode())
    res2 = s.recv(1024).decode(errors='ignore')
    print(f"PWD: {pwd!r} | URI: {uri_in_digest} -> {res2.splitlines()[0] if res2 else 'empty'}")
    s.close()

for pwd in ['Sby09300116@', 'Sby09300116@.', 'Sby09300116%40', 'Sby09300116%40.']:
    test_digest(pwd, 'rtsp://192.168.100.67:554/Streaming/Channels/101')
    test_digest(pwd, 'rtsp://192.168.100.67/Streaming/Channels/101')
    test_digest(pwd, '/Streaming/Channels/101')
