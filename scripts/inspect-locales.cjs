const fs = require('fs');
const idJson = JSON.parse(fs.readFileSync('apps/web-dashboard/src/locales/id.json', 'utf8'));
const enJson = JSON.parse(fs.readFileSync('apps/web-dashboard/src/locales/en.json', 'utf8'));

const hwKeys = Object.keys(idJson).filter(k => k.startsWith('hw.'));
console.log('Current hw.* in ID:');
hwKeys.forEach(k => console.log(`  "${k}": "${idJson[k]}"`));

