'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { loadAdapter } = require('../src/adapter-loader');
const directory = path.join(__dirname, '../adapters/pfki-muzcontent-2027');
const capture = () => JSON.parse(fs.readFileSync(path.join(directory, 'fixtures/capture.empty.json'), 'utf8'));

test('all 81 fields are observed, including null; incomplete capture fails', () => {
  const adapter = loadAdapter(directory);
  const a = capture();
  assert.equal(Object.keys(a.values).length, 81);
  assert.deepEqual(adapter.normalizeCapture(a).tree, adapter.normalizeCapture(capture()).tree);
  delete a.values['s24.fields.f10276'];
  assert.throws(() => adapter.normalizeCapture(a));
});

test('a table edit preserves file references, geography and ordering', () => {
  const adapter = loadAdapter(directory);
  const before = capture();
  const rows = [{ itemKey: 1, documentIds: [123], geographyRubricIds: [], count: 4 },
    { itemKey: 2, documentIds: [], geographyRubricIds: [5], count: 7 }];
  before.values['s24.fields.f10300'].value = rows;
  const current = adapter.normalizeCapture(before);
  const desired = structuredClone(current.tree);
  desired['sections/24.json']['10300'].value[0].count = 6;
  const plan = adapter.planPush(current.tree, desired, { expectedRevision: current.revision });
  assert.equal(plan.operations.length, 1);
  const plain = (value) => JSON.parse(JSON.stringify(value));
  assert.deepEqual(plain(plan.operations[0].expected_before_site), rows);
  assert.deepEqual(plain(plan.operations[0].write_value), [{ ...rows[0], count: 6 }, rows[1]]);
});

test('signature edits and unmapped paths fail closed', () => {
  const adapter = loadAdapter(directory);
  const current = adapter.normalizeCapture(capture());
  const desired = structuredClone(current.tree);
  desired['sections/29.json']['10273'].value = [{ id: 1 }];
  assert.throws(() => adapter.planPush(current.tree, desired, { expectedRevision: current.revision }), /Read-only/);
  const unknown = structuredClone(current.tree);
  unknown['sections/24.json'].unexpected = { value: 'unmapped' };
  assert.throws(() => adapter.planPush(current.tree, unknown, { expectedRevision: current.revision }));
});

test('wrong API types and lossy envelopes are rejected', () => {
  const adapter = loadAdapter(directory);
  const current = adapter.normalizeCapture(capture());
  const wrong = structuredClone(current.tree);
  wrong['sections/26.json']['10279'] = { value: '2027-03-01' };
  assert.throws(() => adapter.planPush(current.tree, wrong, { expectedRevision: current.revision }), /invalid DATE/);
  wrong['sections/26.json']['10279'] = { value: null, forgotten: 'property' };
  assert.throws(() => adapter.planPush(current.tree, wrong, { expectedRevision: current.revision }), /exactly one/);
});

test('repeatable partner prose remains an exact ordered array', () => {
  const adapter = loadAdapter(directory);
  const observed = capture();
  const prose = ['First partner\nExact paragraph', 'Second partner'];
  observed.values['s24.fields.f10329'].value = prose;
  const state = adapter.normalizeCapture(observed);
  assert.deepEqual(JSON.parse(JSON.stringify(state.tree['sections/24.json']['10329'].value)), prose);
  observed.values['s24.fields.f10276'].value = ['Title must not become a list'];
  assert.throws(() => adapter.normalizeCapture(observed), /invalid TEXTAREA/);
});
