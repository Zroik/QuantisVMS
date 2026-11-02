const { getRedisClient } = require('./apps/api-server/dist/redis/client.js');
const { getDbPool } = require('./apps/api-server/dist/db/connection.js');
const fs = require('fs');
const path = require('path');

async function test() {
  console.log('[1] Testing redis...');
  // wait we can test via curl directly
}

