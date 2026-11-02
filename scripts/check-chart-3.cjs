const fs = require('fs');
const content = fs.readFileSync('apps/web-dashboard/src/views/HardwareMonitorView.vue', 'utf8');

const scriptIdx = content.indexOf('<script');
console.log('--- Script Section Part 3 ---');
console.log(content.substring(scriptIdx + 5400, scriptIdx + 8500));

