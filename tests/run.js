'use strict';

// Tiny test runner that loads every tests/*.test.js file. Each file must
// call test(name, fn) and may call assertEqual / assertDeepEqual from
// the helpers below. Exits 1 on the first failure.

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const tests = [];
let failed = 0;
let passed = 0;

global.test = function test(name, fn) {
  tests.push({ name, fn });
};

global.assertEqual = function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    const msg = `${label || 'assertEqual'}: expected ${JSON.stringify(expected)} got ${JSON.stringify(actual)}`;
    throw new Error(msg);
  }
};

global.assertDeepEqual = function assertDeepEqual(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`${label || 'assertDeepEqual'}: expected ${e} got ${a}`);
  }
};

global.assertOk = function assertOk(value, label) {
  if (!value) throw new Error(`${label || 'assertOk'}: expected truthy got ${JSON.stringify(value)}`);
};

const files = fs.readdirSync(__dirname)
  .filter((f) => f.endsWith('.test.js'))
  .sort();

for (const f of files) {
  require(path.join(__dirname, f));
}

(async () => {
  for (const t of tests) {
    try {
      await t.fn();
      process.stderr.write(`  ok  ${t.name}\n`);
      passed++;
    } catch (err) {
      process.stderr.write(`  FAIL ${t.name}\n      ${(err.stack || err.message || err).toString().split('\n').slice(0, 3).join('\n      ')}\n`);
      failed++;
    }
  }
  process.stderr.write(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
})();
