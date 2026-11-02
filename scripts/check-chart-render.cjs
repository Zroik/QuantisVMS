const fs = require('fs');
const content = fs.readFileSync('apps/web-dashboard/src/views/HardwareMonitorView.vue', 'utf8');

const start = content.indexOf('const Y:');
console.log(content.substring(start, start + 2500));

