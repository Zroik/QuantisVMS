const fs = require('fs');
const content = fs.readFileSync('apps/api-server/src/routes/stats.ts', 'utf8');
const start = content.indexOf('statsRouter.get');
console.log(content.substring(start, start + 2500));

