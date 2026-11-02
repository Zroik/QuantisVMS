import os, socket, threading

CAMERA_HOST = os.getenv("CAMERA_HOST", "192.168.1.100")
CAMERA_PORT = int(os.getenv("CAMERA_PORT", "554"))

def handle_client(client, addr):
    print("Client connected:", addr)
    cam = socket.socket()
    cam.connect((CAMERA_HOST, CAMERA_PORT))
    
    def c2s():
        try:
            while True:
                data = client.recv(4096)
                if not data: break
                cam.sendall(data)
        except: pass
        client.close()
        cam.close()

    def s2c():
        try:
            while True:
                data = cam.recv(4096)
                if not data: break
                # Strip Digest line from 401 response so client uses Basic
                if b'WWW-Authenticate: Digest' in data:
                    lines = data.split(b'\r\n')
                    filtered = [l for l in lines if not l.startswith(b'WWW-Authenticate: Digest')]
                    data = b'\r\n'.join(filtered)
                client.sendall(data)
        except: pass
        client.close()
        cam.close()

    threading.Thread(target=c2s, daemon=True).start()
    threading.Thread(target=s2c, daemon=True).start()

def main():
    s = socket.socket()
    s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    s.bind(('0.0.0.0', 8555))
    s.listen(5)
    print("RTSP Basic-Enforcer Proxy listening on 0.0.0.0:8555")
    while True:
        client, addr = s.accept()
        threading.Thread(target=handle_client, args=(client, addr), daemon=True).start()

if __name__ == '__main__':
    main()

