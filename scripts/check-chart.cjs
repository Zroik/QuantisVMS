const fs = require('fs');
const content = fs.readFileSync('apps/web-dashboard/src/views/HardwareMonitorView.vue', 'utf8');

const chIdx = content.indexOf('id="ch"');
console.log('--- Template Around #ch ---');
console.log(content.substring(chIdx - 150, chIdx + 600));

const scriptIdx = content.indexOf('<script');
console.log('--- Script Section ---');
console.log(content.substring(scriptIdx, scriptIdx + 2500));

