'use strict';

const { isObject } = require('./tree');

// Canonicalize a JSON value into a stable, deterministic tree.
// Rules:
//  - object keys are sorted lexicographically at every level
//  - arrays preserve caller order (caller is responsible for identity)
//  - undefined values are dropped
//  - functions / symbols throw
//  - NaN / Infinity throw
function canonicalize(value) {
  return canon(value, new WeakSet());
}

function canon(v, seen) {
  if (v === null) return null;
  const t = typeof v;
  if (t === 'string' || t === 'boolean') return v;
  if (t === 'number') {
    if (!Number.isFinite(v)) {
      throw new Error('normalize: non-finite number is not allowed in canonical tree');
    }
    return v;
  }
  if (t === 'bigint') return v.toString();
  if (t === 'undefined') return undefined; // dropped by caller
  if (Array.isArray(v)) {
    if (seen.has(v)) throw new Error('normalize: cyclic array');
    seen.add(v);
    const out = v.map((x) => canon(x, seen));
    seen.delete(v);
    return out;
  }
  if (isObject(v)) {
    if (seen.has(v)) throw new Error('normalize: cyclic object');
    seen.add(v);
    const out = {};
    const keys = Object.keys(v).sort();
    for (const k of keys) {
      const cv = canon(v[k], seen);
      if (cv === undefined) continue;
      out[k] = cv;
    }
    seen.delete(v);
    return out;
  }
  throw new Error(`normalize: unsupported value of type ${t}`);
}

// Stable stringify: object keys sorted, no insignificant whitespace.
// Two equal canonical trees always serialize to the same string.
function stringify(tree) {
  return JSON.stringify(canonicalize(tree));
}

// Stable hash via FNV-1a 64-bit. Used for tree IDs and revision matching
// when the external system has no native revision.
function hashString(str) {
  // FNV-1a 64-bit
  let h = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const buf = Buffer.from(str, 'utf8');
  for (const b of buf) {
    h ^= BigInt(b);
    h = (h * prime) & 0xffffffffffffffffn;
  }
  return h.toString(16).padStart(16, '0');
}

function treeId(tree) {
  return hashString(stringify(tree));
}

module.exports = { canonicalize, stringify, hashString, treeId };
