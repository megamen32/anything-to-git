'use strict';

const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const { DeclarativeSiteAdapter, loadAdapter, readJson, writeJson } = require('../src');
const { DEMO, makeTemp, plain } = require('./helpers');

function adapter() { return new DeclarativeSiteAdapter(DEMO); }
function baseCapture() { return plain(readJson(path.join(DEMO, 'fixtures', 'capture.base.json'))); }

test('capture normalizes to a deterministic file tree', () => {
  const snapshot = adapter().normalizeCapture(baseCapture());
  assert.equal(snapshot.revision, 'grant-rev-001');
  assert.equal(snapshot.tree['application/general.json'].title, 'Study of iron complexes');
  assert.equal(snapshot.tree['budget/summary.json'].total, 1000000);
  assert.equal(snapshot.tree['sections/summary.json'].text, 'Base summary.');
});

test('push plan contains only changed mapped fields and preconditions', () => {
  const instance = adapter();
  const snapshot = instance.normalizeCapture(baseCapture());
  const desired = plain(snapshot.tree);
  desired['sections/summary.json'].text = 'New summary.';
  desired['budget/summary.json'].total = 1200000;
  const plan = instance.planPush(snapshot.tree, desired, { expectedRevision: snapshot.revision });
  assert.equal(plan.operations.length, 2);
  assert.deepEqual(new Set(plan.operations.map((op) => `${op.page_id}.${op.block_id}.${op.field_id}`)), new Set(['description.summary.text', 'budget.totals.total']));
  const summary = plan.operations.find((op) => op.page_id === 'description');
  assert.equal(summary.expected_present, true);
  assert.equal(summary.expected_before, 'Base summary.');
  assert.equal(summary.expected_before, 'Base summary.');
  assert.equal(summary.expected_before_site, 'Base summary.');
  assert.equal(summary.value, 'New summary.');
  assert.equal(summary.write_value, 'New summary.');
  assert.equal(plan.expected_remote_revision, 'grant-rev-001');
});

test('read-only and unmapped local edits fail closed', () => {
  const instance = adapter();
  const snapshot = instance.normalizeCapture(baseCapture());
  const readOnly = plain(snapshot.tree);
  readOnly['application/general.json'].competition = 'Different competition';
  assert.throws(() => instance.planPush(snapshot.tree, readOnly, { expectedRevision: snapshot.revision }), /Read-only/);
  const unmapped = plain(snapshot.tree);
  unmapped['extra.json'] = { invented: true };
  assert.throws(() => instance.planPush(snapshot.tree, unmapped, { expectedRevision: snapshot.revision }), /not mapped/);
});

test('captures require explicit complete known fields', () => {
  const instance = adapter();
  const missing = baseCapture();
  delete missing.values['description.summary.text'];
  assert.throws(() => instance.normalizeCapture(missing), /Complete capture value is missing/);
  const raw = baseCapture();
  raw.values['description.summary.text'] = 'raw value';
  assert.throws(() => instance.normalizeCapture(raw), /boolean 'present'/);
  const unknown = baseCapture();
  unknown.values['browser.session.cookie'] = { present: true, value: 'secret' };
  assert.throws(() => instance.normalizeCapture(unknown), /unknown to this adapter/);
  const noVersion = baseCapture();
  delete noVersion.adapter_version;
  assert.throws(() => instance.normalizeCapture(noVersion), /adapter_version/);
  const wrongVersion = baseCapture();
  wrongVersion.adapter_version = 999;
  assert.throws(() => instance.normalizeCapture(wrongVersion), /expected 1/);
  const absentWithValue = baseCapture();
  absentWithValue.values['description.summary.text'] = { present: false, value: 'must not be accepted' };
  assert.throws(() => instance.normalizeCapture(absentWithValue), /must not contain 'value'/);
});

test('normalization is deterministic and missing revision falls back to tree hash', () => {
  const instance = adapter();
  const capture = baseCapture();
  capture.revision = null;
  capture.values['general.identity.title'].value = '  Normalized title  ';
  const first = instance.normalizeCapture(capture);
  const second = instance.normalizeCapture(capture);
  assert.equal(first.tree['application/general.json'].title, 'Normalized title');
  assert.match(first.revision, /^sha256:[0-9a-f]{64}$/);
  assert.equal(first.revision, second.revision);
});

test('manifest rejects overlapping canonical mappings', (t) => {
  const temporary = makeTemp();
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const manifest = baseCapture();
  void manifest;
  fs.cpSync(DEMO, path.join(temporary, 'adapter'), { recursive: true });
  const manifestPath = path.join(temporary, 'adapter', 'adapter.json');
  const doc = plain(readJson(manifestPath));
  doc.pages[0].blocks[0].fields.push({
    id: 'nested', type: 'string', required: true,
    canonical: { file: 'application/general.json', pointer: '/title/nested' },
    read: {}, write: { enabled: true },
  });
  writeJson(manifestPath, doc);
  assert.throws(() => new DeclarativeSiteAdapter(path.dirname(manifestPath)), /Overlapping canonical mappings/);
});

test('fetch specification is browser-transport neutral', () => {
  const spec = adapter().fetchSpec();
  assert.equal(spec.kind, 'anything-to-git.fetch-spec');
  assert.equal(spec.adapter_id, 'demo-grant-portal');
  assert.match(spec.rules.join(' '), /not which browser tool/i);
  assert.equal(JSON.stringify(spec).includes('playwright'), false);
});


test('a newly added optional mapped JSON file produces a field-level operation', (t) => {
  const temporary = makeTemp();
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const directory = path.join(temporary, 'adapter');
  fs.cpSync(DEMO, directory, { recursive: true });
  const manifestPath = path.join(directory, 'adapter.json');
  const manifest = plain(readJson(manifestPath));
  manifest.pages[0].blocks[0].fields.push({
    id: 'optional-note',
    capture_key: 'general.identity.optional-note',
    label: 'Optional note',
    canonical: { file: 'optional/note.json', pointer: '/text' },
    type: 'string',
    required: false,
    read: { instruction: 'Read the optional note when present' },
    write: { enabled: true, instruction: 'Set the optional note', save_group: 'general' },
  });
  writeJson(manifestPath, manifest);
  const instance = new DeclarativeSiteAdapter(directory);
  const capture = baseCapture();
  capture.values['general.identity.optional-note'] = { present: false };
  const snapshot = instance.normalizeCapture(capture);
  const desired = plain(snapshot.tree);
  desired['optional/note.json'] = { text: 'New optional note' };
  const plan = instance.planPush(snapshot.tree, desired, { expectedRevision: snapshot.revision });
  assert.equal(plan.operations.length, 1);
  assert.equal(plan.operations[0].file, 'optional/note.json');
  assert.equal(plan.operations[0].pointer, '/text');
  assert.equal(plan.operations[0].expected_present, false);
  assert.equal(plan.operations[0].write_value, 'New optional note');
});

test('optional fields must still be explicitly captured as present or absent', (t) => {
  const temporary = makeTemp();
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const directory = path.join(temporary, 'adapter');
  fs.cpSync(DEMO, directory, { recursive: true });
  const manifestPath = path.join(directory, 'adapter.json');
  const manifest = plain(readJson(manifestPath));
  manifest.pages[0].blocks[0].fields.push({
    id: 'optional-note', capture_key: 'general.identity.optional-note',
    canonical: { file: 'optional/note.json', pointer: '/text' },
    type: 'string', required: false, read: {}, write: { enabled: true },
  });
  writeJson(manifestPath, manifest);
  const instance = new DeclarativeSiteAdapter(directory);
  const capture = baseCapture();
  assert.throws(() => instance.normalizeCapture(capture), /Complete capture value is missing/);
  capture.values['general.identity.optional-note'] = { present: false };
  assert.doesNotThrow(() => instance.normalizeCapture(capture));
});

test('manifest rejects invalid regular expressions and contradictory constraints', (t) => {
  const temporary = makeTemp();
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const directory = path.join(temporary, 'adapter');
  fs.cpSync(DEMO, directory, { recursive: true });
  const manifestPath = path.join(directory, 'adapter.json');
  const manifest = plain(readJson(manifestPath));
  manifest.pages[0].blocks[0].fields[0].constraints.pattern = '[';
  writeJson(manifestPath, manifest);
  assert.throws(() => new DeclarativeSiteAdapter(directory), /pattern is invalid/);
  delete manifest.pages[0].blocks[0].fields[0].constraints.pattern;
  manifest.pages[0].blocks[0].fields[0].constraints.min_length = 20;
  manifest.pages[0].blocks[0].fields[0].constraints.max_length = 10;
  writeJson(manifestPath, manifest);
  assert.throws(() => new DeclarativeSiteAdapter(directory), /min_length greater/);
});


test('adapter converter rejects browser/runtime implementations and unknown hooks', (t) => {
  const temporary = makeTemp();
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const directory = path.join(temporary, 'adapter');
  fs.cpSync(DEMO, directory, { recursive: true });

  fs.writeFileSync(
    path.join(directory, 'converter.js'),
    "'use strict';\nmodule.exports = { createAdapter() { return {}; } };\n",
  );
  assert.throws(() => loadAdapter(directory), /unsupported hooks: createAdapter/);

  fs.writeFileSync(
    path.join(directory, 'converter.js'),
    "'use strict';\nmodule.exports = { normalizeFieldValue: true };\n",
  );
  assert.throws(() => loadAdapter(directory), /normalizeFieldValue must be a function/);
});


test('converter validation and merge-policy hooks are contract-checked', (t) => {
  const temporary = makeTemp();
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const directory = path.join(temporary, 'adapter');
  fs.cpSync(DEMO, directory, { recursive: true });

  fs.writeFileSync(
    path.join(directory, 'converter.js'),
    "'use strict';\nmodule.exports = { validateTree() { return ['not-an-issue']; } };\n",
  );
  let instance = loadAdapter(directory);
  assert.throws(() => instance.validateTree(instance.normalizeCapture(baseCapture()).tree), /Every converter\.validateTree/);

  fs.writeFileSync(
    path.join(directory, 'converter.js'),
    "'use strict';\nmodule.exports = { mergePolicies() { return { 'sections/summary.json#/text': { kind: 'invented' } }; } };\n",
  );
  instance = loadAdapter(directory);
  assert.throws(() => instance.mergePolicies(), /Invalid merge policy/);
});


test('manifest rejects ignored top-level typos and malformed navigation contracts', (t) => {
  const temporary = makeTemp();
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const directory = path.join(temporary, 'adapter');
  fs.cpSync(DEMO, directory, { recursive: true });
  const manifestPath = path.join(directory, 'adapter.json');
  const manifest = plain(readJson(manifestPath));
  manifest.merge_policy = {};
  writeJson(manifestPath, manifest);
  assert.throws(() => new DeclarativeSiteAdapter(directory), /unsupported top-level keys: merge_policy/);

  delete manifest.merge_policy;
  manifest.pages[0].navigation = 'click somewhere';
  writeJson(manifestPath, manifest);
  assert.throws(() => new DeclarativeSiteAdapter(directory), /navigation must be an object/);
});
