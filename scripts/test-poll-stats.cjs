const http = require('http');

async function login() {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({ username: 'admin', password: 'AdminPass123!' });
    const req = http.request('http://localhost:3000/api/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const json = JSON.parse(data);
        resolve(json.token);
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

async function getStats(token) {
  return new Promise((resolve, reject) => {
    const req = http.request('http://localhost:3000/api/stats', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve(JSON.parse(data));
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function main() {
  const token = await login();
  console.log('Got token');
  const s1 = await getStats(token);
  console.log('Sample 1 Hardware:', {
    cpuPercent: s1.hardware.cpuPercent,
    gpuUtil: s1.hardware.gpuUtil,
    vramUsedMb: s1.hardware.vramUsedMb,
    network: s1.hardware.network?.totalIngestMbps
  });

  await new Promise(r => setTimeout(r, 2000));

  const s2 = await getStats(token);
  console.log('Sample 2 Hardware:', {
    cpuPercent: s2.hardware.cpuPercent,
    gpuUtil: s2.hardware.gpuUtil,
    vramUsedMb: s2.hardware.vramUsedMb,
    network: s2.hardware.network?.totalIngestMbps
  });
}

main().catch(console.error);

