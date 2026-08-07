'use strict';

const assert = require('node:assert');
const test = require('node:test');
const { configuredOffset, filenameTimestamp, nowIso, offsetMinutes } = require('../src');

test('default timestamp offset is UTC+03:00', () => {
  const previous = process.env.A2G_UTC_OFFSET;
  delete process.env.A2G_UTC_OFFSET;
  try { assert.match(nowIso(new Date('2026-08-08T00:00:00Z')), /\+03:00$/); }
  finally { if (previous == null) delete process.env.A2G_UTC_OFFSET; else process.env.A2G_UTC_OFFSET = previous; }
});

test('offset can be overridden and filenames are portable', () => {
  const previous = process.env.A2G_UTC_OFFSET;
  process.env.A2G_UTC_OFFSET = '-05:30';
  try {
    assert.equal(configuredOffset(), '-05:30');
    assert.equal(offsetMinutes(), -330);
    assert.equal(filenameTimestamp(new Date('2026-08-08T12:34:56.789Z')), '20260808T070456789m0530');
  } finally { if (previous == null) delete process.env.A2G_UTC_OFFSET; else process.env.A2G_UTC_OFFSET = previous; }
});


test('offsets beyond ISO-8601 maximum are rejected', () => {
  const previous = process.env.A2G_UTC_OFFSET;
  process.env.A2G_UTC_OFFSET = '+14:01';
  try { assert.throws(() => configuredOffset(), /maximum is ±14:00/); }
  finally { if (previous == null) delete process.env.A2G_UTC_OFFSET; else process.env.A2G_UTC_OFFSET = previous; }
});
