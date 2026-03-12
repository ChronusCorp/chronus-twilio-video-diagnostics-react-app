'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const { handler } = require('./handler');

// Mock event factories
function v1Event(path, method) {
  return { path, httpMethod: method };
}

function v2Event(path, method) {
  return { rawPath: path, requestContext: { http: { method } } };
}

async function runTest(name, event, assertions) {
  try {
    const result = await handler(event);
    assertions(result);
    console.log(`  PASS: ${name}`);
    return true;
  } catch (error) {
    console.error(`  FAIL: ${name} — ${error.message}`);
    return false;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  console.log('Running Lambda handler local tests...\n');

  let passed = 0;
  let failed = 0;

  const tests = [
    ['V1 GET /app/token', v1Event('/app/token', 'GET'), (r) => {
      assert(r.statusCode === 200, `Expected 200, got ${r.statusCode}`);
      const body = JSON.parse(r.body);
      assert(body.token, 'Response should have token');
    }],
    ['V2 GET /app/token', v2Event('/app/token', 'GET'), (r) => {
      assert(r.statusCode === 200, `Expected 200, got ${r.statusCode}`);
      const body = JSON.parse(r.body);
      assert(body.token, 'Response should have token');
    }],
    ['V1 GET /app/turn-credentials', v1Event('/app/turn-credentials', 'GET'), (r) => {
      assert(r.statusCode === 200, `Expected 200, got ${r.statusCode}`);
      const body = JSON.parse(r.body);
      assert(body.iceServers, 'Response should have iceServers');
    }],
    ['V2 GET /app/turn-credentials', v2Event('/app/turn-credentials', 'GET'), (r) => {
      assert(r.statusCode === 200, `Expected 200, got ${r.statusCode}`);
      const body = JSON.parse(r.body);
      assert(body.iceServers, 'Response should have iceServers');
    }],
    ['V1 OPTIONS /app/token', v1Event('/app/token', 'OPTIONS'), (r) => {
      assert(r.statusCode === 200, `Expected 200, got ${r.statusCode}`);
    }],
    ['V2 OPTIONS /app/turn-credentials', v2Event('/app/turn-credentials', 'OPTIONS'), (r) => {
      assert(r.statusCode === 200, `Expected 200, got ${r.statusCode}`);
    }],
    ['V1 GET /unknown', v1Event('/unknown', 'GET'), (r) => {
      assert(r.statusCode === 404, `Expected 404, got ${r.statusCode}`);
    }],
    ['V2 GET /unknown', v2Event('/unknown', 'GET'), (r) => {
      assert(r.statusCode === 404, `Expected 404, got ${r.statusCode}`);
    }],
  ];

  for (const [name, event, assertions] of tests) {
    const ok = await runTest(name, event, assertions);
    if (ok) passed++;
    else failed++;
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed out of ${tests.length} tests`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
