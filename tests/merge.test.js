'use strict';

const { threeWay, deepJoinObjects } = require('../src/merge');

test('three-way: no changes → empty', () => {
  const base = { a: 1, b: { c: 2 } };
  const r = threeWay(base, base, base);
  assertEqual(r.conflicts.length, 0);
  assertEqual(r.merged.b.c, 2);
});

test('three-way: only local changed → keep local', () => {
  const base = { a: 1 };
  const local = { a: 2 };
  const remote = { a: 1 };
  const r = threeWay(base, local, remote);
  assertEqual(r.merged.a, 2);
  assertEqual(r.conflicts.length, 0);
});

test('three-way: only remote changed → keep remote', () => {
  const base = { a: 1 };
  const local = { a: 1 };
  const remote = { a: 2 };
  const r = threeWay(base, local, remote);
  assertEqual(r.merged.a, 2);
  assertEqual(r.conflicts.length, 0);
});

test('three-way: both changed same value → agree', () => {
  const base = { a: 1 };
  const r = threeWay(base, { a: 2 }, { a: 2 });
  assertEqual(r.merged.a, 2);
  assertEqual(r.conflicts.length, 0);
});

test('three-way: both changed differently → conflict', () => {
  const base = { title: 'foo' };
  const r = threeWay(base, { title: 'bar' }, { title: 'baz' });
  assertEqual(r.conflicts.length, 1);
  assertEqual(r.conflicts[0].path, '/title');
});

test('three-way: non-overlapping local + remote → both kept', () => {
  const base = { a: 1, b: 2 };
  const r = threeWay(base, { a: 1, b: 99 }, { a: 99, b: 2 });
  assertEqual(r.merged.a, 99);
  assertEqual(r.merged.b, 99);
  assertEqual(r.conflicts.length, 0);
});

test('three-way: remote add only → keep remote', () => {
  const base = { a: 1 };
  const r = threeWay(base, { a: 1 }, { a: 1, b: 'new' });
  assertEqual(r.merged.b, 'new');
  assertEqual(r.conflicts.length, 0);
});

test('three-way: local add only → keep local', () => {
  const base = { a: 1 };
  const r = threeWay(base, { a: 1, b: 'new' }, { a: 1 });
  assertEqual(r.merged.b, 'new');
  assertEqual(r.conflicts.length, 0);
});

test('three-way: delete-vs-edit → conflict', () => {
  const base = { a: 1 };
  const r = threeWay(base, { a: 2 }, {});
  assertEqual(r.conflicts.length, 1);
  assertEqual(r.conflicts[0].reason, 'delete-vs-edit');
});

test('deepJoinObjects: union for arrays', () => {
  assertDeepEqual(deepJoinObjects([1, 2, 3], [3, 4, 5]), [1, 2, 3, 4, 5]);
});

test('deepJoinObjects: merge for objects', () => {
  assertDeepEqual(deepJoinObjects({ a: 1, b: 2 }, { b: 9, c: 3 }), { a: 1, b: 9, c: 3 });
});
