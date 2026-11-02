const fs = require('fs');
let c = fs.readFileSync('docker-compose.yml', 'utf8');
c = c.replace('"127.0.0.1:3306:3306"', '"127.0.0.1:3307:3306"');
c = c.replace('"127.0.0.1:6379:6379"', '"127.0.0.1:6380:6379"');
fs.writeFileSync('docker-compose.yml', c, 'utf8');
console.log('Ports updated in docker-compose.yml');

