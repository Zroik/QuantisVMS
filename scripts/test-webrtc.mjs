import pkg from "../apps/web-dashboard/node_modules/@playwright/test/index.js";
const { chromium } = pkg;

async function testWebRTC() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  page.on('console', msg => console.log('BROWSER LOG:', msg.text()));

  await page.goto('http://localhost:5173/login');
  await page.fill('input[type="text"]', 'admin');
  await page.fill('input[type="password"]', 'admin123');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/matrix');

  const webrtcDiag = await page.evaluate(async () => {
    return new Promise((resolve) => {
      const logs = [];
      const token = localStorage.getItem('vms_access_token');
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
      });

      pc.addTransceiver('video', { direction: 'recvonly' });
      pc.addTransceiver('audio', { direction: 'recvonly' });

      pc.onicecandidate = (e) => {
        logs.push({ type: 'local-candidate', cand: e.candidate ? e.candidate.candidate : null });
      };

      pc.oniceconnectionstatechange = () => {
        logs.push({ type: 'iceConnectionState', state: pc.iceConnectionState });
      };

      pc.onconnectionstatechange = () => {
        logs.push({ type: 'connectionState', state: pc.connectionState });
      };

      pc.ontrack = (e) => {
        logs.push({ type: 'track', kind: e.track.kind });
      };

      (async () => {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        const res = await fetch('/stream/webrtc/cam8/whep?jwt=' + token, {
          method: 'POST',
          headers: { 'Content-Type': 'application/sdp' },
          body: offer.sdp
        });

        logs.push({ type: 'whep-status', status: res.status });
        const answer = await res.text();
        logs.push({ type: 'answer-sdp', sdp: answer });

        await pc.setRemoteDescription({ type: 'answer', sdp: answer });

        setTimeout(() => {
          logs.push({ type: 'final-ice-state', state: pc.iceConnectionState, conn: pc.connectionState });
          resolve(logs);
        }, 4000);
      })();
    });
  });

  console.log('WEBRTC DIAGNOSTICS:');
  for (const l of webrtcDiag) {
    if (l.type === 'answer-sdp') {
      console.log('ANSWER CANDIDATES:');
      const cands = l.sdp.split('\r\n').filter(line => line.startsWith('a=candidate:'));
      console.log(cands);
    } else {
      console.log(l);
    }
  }

  await browser.close();
}

testWebRTC().catch(console.error);

