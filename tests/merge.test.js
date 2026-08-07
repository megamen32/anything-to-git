'use strict';

const assert = require('node:assert');
const test = require('node:test');
const { mergeTrees } = require('../src');
const { plain } = require('./helpers');

test('non-overlapping object changes merge', () => {
  const result = mergeTrees(
    { 'doc.json': { title: 'Old', budget: 100 } },
    { 'doc.json': { title: 'Old', budget: 120 } },
    { 'doc.json': { title: 'New', budget: 100 } },
  );
  assert.equal(result.clean, true);
  assert.deepEqual(plain(result.merged), { 'doc.json': { budget: 120, title: 'New' } });
});

test('an explicit atomic policy prevents unsafe partial object merging', () => {
  const base = { 'doc.json': { address: { city: 'Berlin', postal: '10115' } } };
  const local = { 'doc.json': { address: { city: 'Munich', postal: '10115' } } };
  const remote = { 'doc.json': { address: { city: 'Berlin', postal: '20095' } } };
  const recursive = mergeTrees(base, local, remote);
  assert.equal(recursive.clean, true);
  assert.deepEqual(plain(recursive.merged['doc.json'].address), { city: 'Munich', postal: '20095' });
  const atomic = mergeTrees(base, local, remote, { policies: { 'doc.json#/address': 'atomic' } });
  assert.equal(atomic.clean, false);
  assert.equal(atomic.conflicts[0].pointer, '/address');
});

test('same scalar changed differently is an explicit conflict', () => {
  const result = mergeTrees(
    { 'doc.json': { title: 'Old' } },
    { 'doc.json': { title: 'Local' } },
    { 'doc.json': { title: 'Site' } },
  );
  assert.equal(result.clean, false);
  assert.equal(result.conflicts.length, 1);
  assert.deepEqual({ ...result.conflicts[0] }, {
    file: 'doc.json', pointer: '/title', base: 'Old', local: 'Local', remote: 'Site',
    reason: 'both sides changed the same value differently', policy: 'atomic',
  });
});

test('delete versus edit is a conflict', () => {
  const result = mergeTrees(
    { 'doc.json': { section: { text: 'Old' } } },
    { 'doc.json': {} },
    { 'doc.json': { section: { text: 'New' } } },
  );
  assert.equal(result.clean, false);
  assert.equal(result.conflicts[0].reason, 'delete-versus-edit conflict');
});

test('set policy combines independent additions deterministically', () => {
  const result = mergeTrees(
    { 'doc.json': { tags: ['a'] } },
    { 'doc.json': { tags: ['a', 'local'] } },
    { 'doc.json': { tags: ['a', 'site'] } },
    { policies: { 'doc.json#/tags': 'set' } },
  );
  assert.equal(result.clean, true);
  assert.deepEqual(plain(result.merged['doc.json'].tags), ['a', 'local', 'site']);
});

test('by_id policy merges edits to different entities', () => {
  const base = { 'people.json': { items: [
    { id: 'anna', name: 'Anna', role: 'Researcher' },
    { id: 'ivan', name: 'Ivan', role: 'Engineer' },
  ] } };
  const local = { 'people.json': { items: [
    { id: 'anna', name: 'Anna', role: 'Lead' },
    { id: 'ivan', name: 'Ivan', role: 'Engineer' },
  ] } };
  const remote = { 'people.json': { items: [
    { id: 'anna', name: 'Anna', role: 'Researcher' },
    { id: 'ivan', name: 'Ivan Petrov', role: 'Engineer' },
  ] } };
  const result = mergeTrees(base, local, remote, { policies: { 'people.json#/items': { kind: 'by_id', id_key: 'id' } } });
  assert.equal(result.clean, true);
  assert.deepEqual(plain(result.merged['people.json'].items), [
    { id: 'anna', name: 'Anna', role: 'Lead' },
    { id: 'ivan', name: 'Ivan Petrov', role: 'Engineer' },
  ]);
});

test('by_id policy does not silently accept incompatible reorders', () => {
  const result = mergeTrees(
    { 'items.json': { items: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] } },
    { 'items.json': { items: [{ id: 'b' }, { id: 'a' }, { id: 'c' }] } },
    { 'items.json': { items: [{ id: 'a' }, { id: 'c' }, { id: 'b' }] } },
    { policies: { 'items.json#/items': { kind: 'by_id', id_key: 'id' } } },
  );
  assert.equal(result.clean, false);
  assert.equal(result.conflicts[0].reason, 'both sides reordered the same collection differently');
});

test('identical changes and one-sided changes are clean', () => {
  const identical = mergeTrees({ 'x.json': { x: 1 } }, { 'x.json': { x: 2 } }, { 'x.json': { x: 2 } });
  assert.equal(identical.clean, true);
  const localOnly = mergeTrees({ 'x.json': { x: 1 } }, { 'x.json': { x: 2 } }, { 'x.json': { x: 1 } });
  assert.equal(localOnly.merged['x.json'].x, 2);
  const remoteOnly = mergeTrees({ 'x.json': { x: 1 } }, { 'x.json': { x: 1 } }, { 'x.json': { x: 3 } });
  assert.equal(remoteOnly.merged['x.json'].x, 3);
});


test('set policy preserves one-sided removals while combining unrelated additions', () => {
  const result = mergeTrees(
    { 'doc.json': { tags: ['a', 'keep'] } },
    { 'doc.json': { tags: ['keep', 'local'] } },
    { 'doc.json': { tags: ['a', 'keep', 'site'] } },
    { policies: { 'doc.json#/tags': 'set' } },
  );
  assert.equal(result.clean, true);
  assert.deepEqual(plain(result.merged['doc.json'].tags), ['keep', 'local', 'site']);
});

test('set policy refuses duplicate members instead of silently deduplicating them', () => {
  const base = { 'data.json': { tags: ['a'] } };
  const local = { 'data.json': { tags: ['a', 'a', 'local'] } };
  const remote = { 'data.json': { tags: ['a', 'remote'] } };
  const result = mergeTrees(base, local, remote, {
    policies: { 'data.json#/tags': 'set' },
  });
  assert.equal(result.clean, false);
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0].pointer, '/tags');
  assert.match(result.conflicts[0].reason, /unique members/);
});

test('by_id child conflicts collapse to one executable collection pointer', () => {
  const base = {
    'data.json': {
      items: [
        { id: 'a', name: 'Base A' },
        { id: 'b', name: 'Base B' },
      ],
    },
  };
  const local = {
    'data.json': {
      items: [
        { id: 'a', name: 'Local A' },
        { id: 'b', name: 'Base B' },
      ],
    },
  };
  const remote = {
    'data.json': {
      items: [
        { id: 'a', name: 'Remote A' },
        { id: 'b', name: 'Remote B' },
      ],
    },
  };
  const result = mergeTrees(base, local, remote, {
    policies: { 'data.json#/items': { kind: 'by_id', id_key: 'id' } },
  });
  assert.equal(result.clean, false);
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0].pointer, '/items');
  assert.match(result.conflicts[0].reason, /stable-ID collection/);
  assert.deepEqual(result.merged['data.json'].items, [
    { id: 'a', name: 'Local A' },
    { id: 'b', name: 'Remote B' },
  ]);
});


test('a collection merge policy does not leak into nested arrays', () => {
  const base = { 'data.json': { items: [{ id: 'a', tags: [{ id: 'x', value: 1 }] }] } };
  const local = { 'data.json': { items: [{ id: 'a', tags: [{ id: 'x', value: 2 }] }] } };
  const remote = { 'data.json': { items: [{ id: 'a', tags: [{ id: 'x', value: 3 }] }] } };
  const result = mergeTrees(base, local, remote, {
    policies: { 'data.json#/items': { kind: 'by_id', id_key: 'id' } },
  });
  assert.equal(result.clean, false);
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0].pointer, '/items');
});
