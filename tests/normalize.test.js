'use strict';

const { canonicalize, stringify, treeId, hashString } = require('../src/normalize');

test('canonicalize sorts object keys', () => {
  const a = canonicalize({ b: 1, a: 2, c: 3 });
  const b = canonicalize({ c: 3, a: 2, b: 1 });
  assertDeepEqual(a, b);
  assertDeepEqual(Object.keys(a), ['a', 'b', 'c']);
});

test('canonicalize is deterministic for nested objects', () => {
  const a = canonicalize({ x: { b: 1, a: 2 }, y: [{ q: 1, p: 2 }] });
  const b = canonicalize({ y: [{ p: 2, q: 1 }], x: { a: 2, b: 1 } });
  assertEqual(stringify(a), stringify(b));
});

test('canonicalize drops undefined values', () => {
  const a = canonicalize({ a: 1, b: undefined, c: 3 });
  assertDeepEqual(a, { a: 1, c: 3 });
});

test('canonicalize throws on non-finite numbers', () => {
  let threw = false;
  try { canonicalize({ a: NaN }); } catch (_) { threw = true; }
  assertOk(threw, 'should throw on NaN');
});

test('canonicalize throws on cycles', () => {
  const obj = {};
  obj.self = obj;
  let threw = false;
  try { canonicalize(obj); } catch (_) { threw = true; }
  assertOk(threw, 'should throw on cycle');
});

test('treeId is stable for equal canonical trees', () => {
  const id1 = treeId({ a: 1, b: 2 });
  const id2 = treeId({ b: 2, a: 1 });
  assertEqual(id1, id2);
});

test('hashString is 16 hex chars', () => {
  const h = hashString('hello');
  assertEqual(typeof h, 'string');
  assertEqual(h.length, 16);
  assertOk(/^[0-9a-f]+$/.test(h), 'should be hex');
});

test('hashString differs for different inputs', () => {
  assertOk(hashString('a') !== hashString('b'), 'different strings → different hashes');
});
