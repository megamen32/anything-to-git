'use strict';

const { get, set, remove, deepEqual, listPaths } = require('./tree');

// Build a minimal change plan from (currentRemote → desired) using JSON Patch
// (RFC 6902) operations. The plan is what the adapter will apply, so it must
// reference concrete JSON paths, not whole-tree replaces.

function buildPlan(currentRemote, desired) {
  const ops = [];
  const remote = currentRemote || {};
  const want = desired || {};

  // 1) Removes
  for (const path of listPaths(remote)) {
    if (get(desired, path) === undefined) {
      ops.push({ op: 'remove', path });
    }
  }

  // 2) Adds / replaces
  for (const path of listPaths(want)) {
    const r = get(remote, path);
    const w = get(want, path);
    if (r === undefined) {
      ops.push({ op: 'add', path, value: w });
    } else if (!deepEqual(r, w)) {
      ops.push({ op: 'replace', path, value: w });
    }
  }

  return { operations: ops };
}

// Apply a plan to an in-memory tree. Used by tests and by adapters that want
// to preview the plan before going to the wire.
function applyPlan(tree, plan) {
  const out = JSON.parse(JSON.stringify(tree || {}));
  for (const op of plan.operations) {
    if (op.op === 'remove') remove(out, op.path);
    else if (op.op === 'add' || op.op === 'replace') set(out, op.path, op.value);
    else if (op.op === 'test') {
      const got = get(out, op.path);
      if (!deepEqual(got, op.value)) {
        throw new Error(`plan test failed at ${op.path}: expected ${JSON.stringify(op.value)} got ${JSON.stringify(got)}`);
      }
    } else {
      throw new Error(`unknown plan op: ${op.op}`);
    }
  }
  return out;
}

module.exports = { buildPlan, applyPlan };
