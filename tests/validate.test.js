'use strict';

const { validate } = require('../src/validate');

test('validate: required field missing', () => {
  const r = validate({ application: { concept: 'x' } }, {
    type: 'object',
    properties: {
      application: { type: 'object', required: ['title'], properties: { title: { type: 'string' } } },
    },
  });
  assertEqual(r.ok, false);
  assertEqual(r.errors.length >= 1, true);
});

test('validate: type mismatch', () => {
  const r = validate({ x: 'string' }, { properties: { x: { type: 'number' } } });
  assertEqual(r.ok, false);
});

test('validate: enum', () => {
  const r = validate({ color: 'blue' }, { properties: { color: { enum: ['red', 'green'] } } });
  assertEqual(r.ok, false);
});

test('validate: string maxLength', () => {
  const r = validate({ s: 'abcdef' }, { properties: { s: { type: 'string', maxLength: 3 } } });
  assertEqual(r.ok, false);
});

test('validate: ok for clean tree', () => {
  const r = validate({ application: { title: 'Hello' } }, {
    type: 'object',
    properties: {
      application: { type: 'object', required: ['title'], properties: { title: { type: 'string' } } },
    },
  });
  assertEqual(r.ok, true);
});
