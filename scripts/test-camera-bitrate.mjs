async function checkBitrates() {
  const auth = "Basic " + Buffer.from("internal_reader:mediamtx_internal_token_secret").toString("base64");
  const res1 = await fetch("http://127.0.0.1:9997/v3/paths/list", { headers: { Authorization: auth } });
  const data1 = await res1.json();
  const t1 = Date.now();

  console.log("Waiting 2 seconds to calculate real delta bitrate...");
  await new Promise(r => setTimeout(r, 2000));

  const res2 = await fetch("http://127.0.0.1:9997/v3/paths/list", { headers: { Authorization: auth } });
  const data2 = await res2.json();
  const t2 = Date.now();
  const dtSec = (t2 - t1) / 1000;

  for (const it2 of data2.items) {
    const it1 = data1.items.find(x => x.name === it2.name);
    if (it1) {
      const deltaBytes = it2.inboundBytes - it1.inboundBytes;
      const mbps = ((deltaBytes * 8) / (dtSec * 1024 * 1024)).toFixed(2);
      const kbps = ((deltaBytes * 8) / (dtSec * 1024)).toFixed(0);
      console.log(`Camera ${it2.name}: ${mbps} Mbps (${kbps} Kbps) [inboundBytes delta: ${deltaBytes}]`);
    }
  }
}

checkBitrates().catch(console.error);

