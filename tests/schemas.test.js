'use strict';

const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const { strictJsonParse } = require('../src');
const { ROOT } = require('./helpers');

test('bundled JSON schemas are strict valid JSON objects', () => {
  for (const name of ['adapter.schema.json', 'capture.schema.json', 'push-plan.schema.json']) {
    const file = path.join(ROOT, 'schemas', name);
    const parsed = strictJsonParse(fs.readFileSync(file, 'utf8'), { source: file });
    assert.equal(parsed.type, 'object');
  }
});


test('capture and push-plan schemas expose the v0.2 safety contract', () => {
  const capture = strictJsonParse(fs.readFileSync(path.join(ROOT, 'schemas', 'capture.schema.json'), 'utf8'));
  for (const key of ['adapter_version', 'captured_at', 'revision', 'values', 'metadata']) assert.ok(capture.required.includes(key), key);
  assert.deepEqual(capture.properties.verification.required, ['plan_id', 'challenge']);
  const plan = strictJsonParse(fs.readFileSync(path.join(ROOT, 'schemas', 'push-plan.schema.json'), 'utf8'));
  for (const key of ['kind', 'local_commit', 'remote_commit', 'remote_captured_at', 'remote_ingested_at', 'verification_challenge', 'execution_rules', 'warnings', 'created_at']) {
    assert.ok(plan.required.includes(key), key);
  }
  assert.equal(plan.properties.kind.const, 'anything-to-git.push-plan');
  const operation = plan.properties.operations.items.properties;
  for (const key of ['expected_before', 'expected_before_site', 'value', 'write_value']) assert.ok(key in operation, key);
});
