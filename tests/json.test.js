'use strict';

const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const {
  A2GError,
  MISSING,
  canonicalStringify,
  canonicalize,
  deepEqual,
  deletePointer,
  diffTrees,
  decodePresence,
  encodePresence,
  getPointer,
  loadTree,
  setPointer,
  strictJsonParse,
  treeHash,
  validateTreePath,
  writeTree,
} = require('../src');
const { makeTemp, plain } = require('./helpers');

test('canonical JSON is deterministic and normalizes negative zero', () => {
  assert.equal(canonicalStringify({ z: -0, a: { y: 2, x: 1 } }), '{\n  "a": {\n    "x": 1,\n    "y": 2\n  },\n  "z": 0\n}\n');
  assert.equal(treeHash({ 'b.json': { z: 1, a: 2 } }), treeHash({ 'b.json': { a: 2, z: 1 } }));
});

test('strict parser rejects duplicate keys, invalid values, and trailing data', () => {
  assert.throws(() => strictJsonParse('{"x":1,"x":2}', { source: 'test' }), /duplicate object key/);
  assert.throws(() => strictJsonParse('{"x":NaN}', { source: 'test' }), /expected a JSON value/);
  assert.throws(() => strictJsonParse('{"x":1} garbage', { source: 'test' }), /trailing data/);
  assert.throws(() => canonicalize({ x: Number.NaN }), /Non-finite/);
  assert.throws(() => strictJsonParse('{"id":9007199254740993}', { source: 'test' }), /safe range/);
  assert.throws(() => canonicalize({ id: Number.MAX_SAFE_INTEGER + 1 }), /safe range/);
  assert.deepEqual(plain(strictJsonParse('{"id":"9007199254740993"}')), { id: '9007199254740993' });
});

test('JSON object keys cannot pollute Object.prototype', () => {
  const parsed = strictJsonParse('{"__proto__":{"polluted":true},"constructor":"safe"}');
  assert.equal({}.polluted, undefined);
  assert.equal(Object.prototype.hasOwnProperty.call(parsed, '__proto__'), true);
  assert.equal(parsed.__proto__.polluted, true);
  const canonical = canonicalize(parsed);
  assert.equal({}.polluted, undefined);
  const roundTripped = plain(canonical);
  assert.equal(Object.prototype.hasOwnProperty.call(roundTripped, '__proto__'), true);
  assert.deepEqual(roundTripped.__proto__, { polluted: true });
  assert.equal(roundTripped.constructor, 'safe');
});

test('tree paths fail closed', () => {
  for (const value of ['', '../x.json', '/x.json', 'a\\x.json', '.git/x.json', '.a2g/x.json', 'x.txt', 'a//x.json']) {
    assert.throws(() => validateTreePath(value), A2GError, value);
  }
  assert.equal(validateTreePath('sections/summary.json'), 'sections/summary.json');
});

test('JSON pointer get, set, delete, and missing sentinel work', () => {
  let value = setPointer({}, '/a~1b/~0key', 42);
  assert.equal(getPointer(value, '/a~1b/~0key'), 42);
  assert.equal(getPointer(value, '/missing'), MISSING);
  value = deletePointer(value, '/a~1b/~0key');
  assert.equal(getPointer(value, '/a~1b/~0key'), MISSING);
  assert.throws(() => setPointer([], '/2', 'x'), /out of range/);
});

test('tree writer removes stale JSON but preserves non-JSON files', (t) => {
  const temporary = makeTemp();
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const root = path.join(temporary, 'site');
  fs.mkdirSync(root);
  fs.writeFileSync(path.join(root, 'README.md'), 'keep me', 'utf8');
  fs.writeFileSync(path.join(root, 'old.json'), '{"old":true}\n', 'utf8');
  writeTree(root, { 'nested/new.json': { new: true }, 'empty.json': {} });
  assert.equal(fs.readFileSync(path.join(root, 'README.md'), 'utf8'), 'keep me');
  assert.equal(fs.existsSync(path.join(root, 'old.json')), false);
  assert.deepEqual(plain(loadTree(root)), { 'empty.json': {}, 'nested/new.json': { new: true } });
});

test('tree loader rejects symlinks', { skip: process.platform === 'win32' }, (t) => {
  const temporary = makeTemp();
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const root = path.join(temporary, 'site');
  fs.mkdirSync(root);
  fs.writeFileSync(path.join(temporary, 'outside.json'), '{}');
  fs.symlinkSync(path.join(temporary, 'outside.json'), path.join(root, 'link.json'));
  assert.throws(() => loadTree(root), /Symlinks are not allowed/);
});

test('semantic diff reports object leaves and treats arrays atomically', () => {
  const changes = diffTrees(
    { 'doc.json': { title: 'Old', tags: ['a'] } },
    { 'doc.json': { title: 'New', tags: ['a', 'b'] } },
  );
  assert.deepEqual(changes.map((change) => [change.pointer, change.kind]), [['/tags', 'replace'], ['/title', 'replace']]);
  assert.equal(deepEqual({ a: [1, 2] }, { a: [1, 2] }), true);
});

test('presence wrappers cannot collide with legitimate JSON values', () => {
  const legitimate = { $a2g: 'missing' };
  const wrapped = encodePresence(legitimate);
  assert.deepEqual(plain(wrapped), { present: true, value: legitimate });
  assert.deepEqual(plain(decodePresence(wrapped)), legitimate);
  assert.equal(decodePresence({ present: false }), MISSING);
  assert.throws(() => decodePresence({ present: false, value: null }), /only 'present'/);
});


test('strict parser rejects numeric underflow and case-insensitive reserved paths', () => {
  assert.throws(() => strictJsonParse('1e-324'), /underflows JavaScript numeric range/);
  assert.throws(() => validateTreePath('.GIT/state.json'), /Reserved canonical tree path/);
  assert.throws(() => validateTreePath('.A2G/state.json'), /Reserved canonical tree path/);
});
