'use strict';

const { get, set, remove, deepEqual, listPaths, deepClone, toPointer, fromPointer } = require('../src/tree');

test('get / set at JSON pointer', () => {
  const t = { a: { b: 1 } };
  set(t, '/a/b', 42);
  assertEqual(get(t, '/a/b'), 42);
  set(t, '/x/y/z', 'hi');
  assertEqual(get(t, '/x/y/z'), 'hi');
});

test('remove deletes a path', () => {
  const t = { a: { b: 1, c: 2 } };
  assertOk(remove(t, '/a/b'));
  assertEqual(get(t, '/a/b'), undefined);
  assertEqual(get(t, '/a/c'), 2);
});

test('deepEqual is order-insensitive for objects, sensitive for arrays', () => {
  assertOk(deepEqual({ a: 1, b: 2 }, { b: 2, a: 1 }));
  assertOk(!deepEqual([1, 2, 3], [3, 2, 1]), 'arrays are order-sensitive');
  assertOk(deepEqual({ a: [1, 2] }, { a: [1, 2] }));
});

test('listPaths returns sorted pointers', () => {
  const t = { b: 1, a: { y: 1, x: 2 } };
  const paths = listPaths(t);
  assertDeepEqual(paths, ['/a', '/a/x', '/a/y', '/b']);
});

test('deepClone is independent', () => {
  const a = { x: { y: 1 } };
  const b = deepClone(a);
  b.x.y = 2;
  assertEqual(a.x.y, 1);
  assertEqual(b.x.y, 2);
});

test('toPointer / fromPointer round-trip', () => {
  const parts = ['a', 'b/c', '~d'];
  assertDeepEqual(fromPointer(toPointer(parts)), parts);
});
