import socket
import re

cam = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
cam.connect(('192.168.100.16', 554))
cam.sendall(b'DESCRIBE rtsp://192.168.100.16 RTSP/1.0\r\nCSeq: 1\r\nAccept: application/sdp\r\n\r\n')
data = cam.recv(4096)
print('ORIGINAL RESPONSE:')
print(data.decode('utf-8', errors='replace'))

# Check SDP replacement
if b'config=' in data:
    # replace config= with config=1588
    fixed = re.sub(rb'config=([;\r\n])', rb'config=1588\1', data)
    diff = len(fixed) - len(data)
    m = re.search(rb'Content-Length:\s*(\d+)', fixed)
    if m:
        old_cl = int(m.group(1))
        new_cl = old_cl + diff
        fixed = re.sub(rb'Content-Length:\s*\d+', f'Content-Length: {new_cl}'.encode(), fixed)
    print('FIXED RESPONSE:')
    print(fixed.decode('utf-8', errors='replace'))
