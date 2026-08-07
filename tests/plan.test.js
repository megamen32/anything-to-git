'use strict';

const { buildPlan, applyPlan } = require('../src/plan');

test('buildPlan: no diff → empty plan', () => {
  const t = { a: 1, b: { c: 2 } };
  const plan = buildPlan(t, t);
  assertEqual(plan.operations.length, 0);
});

test('buildPlan: replace when value differs', () => {
  const plan = buildPlan({ a: 1 }, { a: 2 });
  assertEqual(plan.operations.length, 1);
  assertEqual(plan.operations[0].op, 'replace');
  assertEqual(plan.operations[0].path, '/a');
  assertEqual(plan.operations[0].value, 2);
});

test('buildPlan: add when path missing in current', () => {
  const plan = buildPlan({}, { a: 1 });
  assertEqual(plan.operations.length, 1);
  assertEqual(plan.operations[0].op, 'add');
});

test('buildPlan: remove when path missing in desired', () => {
  const plan = buildPlan({ a: 1 }, {});
  assertEqual(plan.operations.length, 1);
  assertEqual(plan.operations[0].op, 'remove');
});

test('applyPlan: round-trip', () => {
  const remote = { a: 1, b: { c: 2 } };
  const desired = { a: 1, b: { c: 99 }, d: 'new' };
  const plan = buildPlan(remote, desired);
  const result = applyPlan(remote, plan);
  assertDeepEqual(result, desired);
});
