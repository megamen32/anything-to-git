'use strict';

// JSON tree operations: walk, get, set, remove, diff at JSON-path level.
// Paths use JSON Pointer (RFC 6901) with leading slash, e.g. "/team/person-1/name".

function isObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function toPointer(parts) {
  if (!parts || parts.length === 0) return '';
  return '/' + parts.map(escapeToken).join('/');
}

function fromPointer(pointer) {
  if (!pointer || pointer === '') return [];
  if (pointer[0] !== '/') {
    throw new Error(`Invalid JSON pointer: ${JSON.stringify(pointer)}`);
  }
  return pointer.slice(1).split('/').map(unescapeToken);
}

function escapeToken(t) {
  return String(t).replace(/~/g, '~0').replace(/\//g, '~1');
}

function unescapeToken(t) {
  return String(t).replace(/~1/g, '/').replace(/~0/g, '~');
}

function get(tree, pointer) {
  const parts = fromPointer(pointer);
  let cur = tree;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

function set(tree, pointer, value) {
  const parts = fromPointer(pointer);
  if (parts.length === 0) {
    throw new Error('Cannot replace root via set(); use replaceRoot()');
  }
  let cur = tree;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i];
    if (cur[k] == null) {
      // Heuristic: next key is integer-ish → array, else object.
      cur[k] = /^\d+$/.test(parts[i + 1]) ? [] : {};
    }
    cur = cur[k];
  }
  cur[parts[parts.length - 1]] = value;
  return tree;
}

function remove(tree, pointer) {
  const parts = fromPointer(pointer);
  if (parts.length === 0) {
    throw new Error('Cannot remove root');
  }
  let cur = tree;
  for (let i = 0; i < parts.length - 1; i++) {
    cur = cur[parts[i]];
    if (cur == null) return false;
  }
  const last = parts[parts.length - 1];
  if (Array.isArray(cur)) {
    const idx = Number(last);
    if (Number.isInteger(idx) && idx >= 0 && idx < cur.length) {
      cur.splice(idx, 1);
      return true;
    }
    return false;
  }
  if (Object.prototype.hasOwnProperty.call(cur, last)) {
    delete cur[last];
    return true;
  }
  return false;
}

function deepClone(value) {
  // structuredClone is available in Node 18+.
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

// Stable deep-equal for JSON values.
function deepEqual(a, b) {
  if (a === b) return true;
  if (a === null || b === null) return a === b;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  if (isObject(a)) {
    if (!isObject(b)) return false;
    const ka = Object.keys(a).sort();
    const kb = Object.keys(b).sort();
    if (ka.length !== kb.length) return false;
    for (let i = 0; i < ka.length; i++) {
      if (ka[i] !== kb[i]) return false;
      if (!deepEqual(a[ka[i]], b[ka[i]])) return false;
    }
    return true;
  }
  return false;
}

// Recursive path lister. Returns sorted list of JSON pointers to every leaf scalar
// and to every object/array node (excluding the root).
function listPaths(tree) {
  const out = [];
  walk(tree, []);
  out.sort();
  return out;

  function walk(node, parts) {
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) walk(node[i], parts.concat(String(i)));
      return;
    }
    if (isObject(node)) {
      if (parts.length > 0) out.push(toPointer(parts));
      const keys = Object.keys(node).sort();
      for (const k of keys) walk(node[k], parts.concat(k));
      return;
    }
    out.push(toPointer(parts));
  }
}

module.exports = {
  isObject,
  toPointer,
  fromPointer,
  get,
  set,
  remove,
  deepClone,
  deepEqual,
  listPaths,
};
