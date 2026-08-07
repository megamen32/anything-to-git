'use strict';

const {
  MISSING,
  canonicalStringify,
  deepEqual,
  isPlainObject,
  joinPointer,
  createJsonObject,
  setOwn,
} = require('./json');

function policyFor(file, pointer, policies = {}) {
  // Policies describe one semantic value at one canonical JSON pointer. They do
  // not implicitly leak into descendants: a by_id policy for a collection must
  // not turn unrelated arrays inside each entity into by_id collections too.
  const target = `${file}#${pointer}`;
  const selected = Object.prototype.hasOwnProperty.call(policies || {}, target)
    ? policies[target]
    : null;
  if (selected == null) return { kind: 'atomic', idKey: 'id', explicit: false };
  if (typeof selected === 'string') return { kind: selected, idKey: 'id', explicit: true };
  return { kind: selected.kind || 'atomic', idKey: selected.id_key || selected.idKey || 'id', explicit: true };
}

function same(left, right) {
  return left === MISSING || right === MISSING ? left === right : deepEqual(left, right);
}

function marker(value) {
  return canonicalStringify(value, { pretty: false, trailingNewline: false });
}

function mergeSet(base, local, remote) {
  const b = new Map(base.map((item) => [marker(item), item]));
  const l = new Map(local.map((item) => [marker(item), item]));
  const r = new Map(remote.map((item) => [marker(item), item]));
  const mergedKeys = new Set();
  const keys = new Set([...b.keys(), ...l.keys(), ...r.keys()]);
  for (const key of keys) {
    const inBase = b.has(key);
    const inLocal = l.has(key);
    const inRemote = r.has(key);
    let present;
    if (inLocal === inRemote) present = inLocal;
    else if (inLocal === inBase) present = inRemote;
    else present = inLocal; // inRemote === inBase; local is the one-sided change
    if (present) mergedKeys.add(key);
  }
  const ordered = [];
  const seen = new Set();
  for (const source of [base, local, remote]) {
    for (const item of source) {
      const key = marker(item);
      if (mergedKeys.has(key) && !seen.has(key)) {
        seen.add(key);
        ordered.push(item);
      }
    }
  }
  return ordered;
}

function hasUniqueSetMembers(items) {
  const seen = new Set();
  for (const item of items) {
    const key = marker(item);
    if (seen.has(key)) return false;
    seen.add(key);
  }
  return true;
}

function listById(items, idKey) {
  const mapping = new Map();
  const order = [];
  for (const item of items) {
    if (!isPlainObject(item) || !Object.prototype.hasOwnProperty.call(item, idKey)) return null;
    const rawKey = item[idKey];
    if (!['string', 'number'].includes(typeof rawKey) || (typeof rawKey === 'number' && !Number.isFinite(rawKey))) return null;
    const key = `${typeof rawKey}:${String(rawKey)}`;
    if (mapping.has(key)) return null;
    mapping.set(key, item);
    order.push(key);
  }
  return { mapping, order };
}

function mapGetOrMissing(map, key) {
  return map.has(key) ? map.get(key) : MISSING;
}

function mergeValue(base, local, remote, context) {
  const { file, pointer, policies, conflicts } = context;
  if (same(local, remote)) return local;
  if (same(local, base)) return remote;
  if (same(remote, base)) return local;

  const policy = policyFor(file, pointer, policies);

  // Objects are recursively mergeable by default, but an adapter can mark a
  // semantic object as explicitly atomic when partial combination would be
  // unsafe (for example, a coupled address or credential-like structure).
  if (isPlainObject(base) && isPlainObject(local) && isPlainObject(remote) && !(policy.explicit && policy.kind === 'atomic')) {
    const merged = createJsonObject();
    const keys = [...new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)])].sort();
    for (const key of keys) {
      const value = mergeValue(
        Object.prototype.hasOwnProperty.call(base, key) ? base[key] : MISSING,
        Object.prototype.hasOwnProperty.call(local, key) ? local[key] : MISSING,
        Object.prototype.hasOwnProperty.call(remote, key) ? remote[key] : MISSING,
        { ...context, pointer: joinPointer(pointer, key) },
      );
      if (value !== MISSING) setOwn(merged, key, value);
    }
    return merged;
  }

  if (policy.kind === 'set' && Array.isArray(base) && Array.isArray(local) && Array.isArray(remote)) {
    if ([base, local, remote].every(hasUniqueSetMembers)) return mergeSet(base, local, remote);
    conflicts.push({
      file,
      pointer,
      base,
      local,
      remote,
      reason: 'set merge requires unique members on every side',
      policy: policy.kind,
    });
    return local;
  }

  if (policy.kind === 'by_id' && Array.isArray(base) && Array.isArray(local) && Array.isArray(remote)) {
    const converted = [base, local, remote].map((items) => listById(items, policy.idKey));
    if (converted.every(Boolean)) {
      const conflictStart = conflicts.length;
      const [b, l, r] = converted;
      const mergedMap = new Map();
      const ids = [...new Set([...b.mapping.keys(), ...l.mapping.keys(), ...r.mapping.keys()])].sort();
      for (const id of ids) {
        const value = mergeValue(
          mapGetOrMissing(b.mapping, id),
          mapGetOrMissing(l.mapping, id),
          mapGetOrMissing(r.mapping, id),
          { ...context, pointer: joinPointer(pointer, id) },
        );
        if (value !== MISSING) mergedMap.set(id, value);
      }

      const common = new Set([...b.mapping.keys()].filter((id) => l.mapping.has(id) && r.mapping.has(id) && mergedMap.has(id)));
      const commonOrder = (order) => order.filter((id) => common.has(id));
      const baseCommon = commonOrder(b.order);
      const localCommon = commonOrder(l.order);
      const remoteCommon = commonOrder(r.order);
      const localReordered = !deepEqual(localCommon, baseCommon);
      const remoteReordered = !deepEqual(remoteCommon, baseCommon);
      let preferredOrder;
      if (localReordered && remoteReordered && !deepEqual(localCommon, remoteCommon)) {
        conflicts.push({
          file,
          pointer,
          base,
          local,
          remote,
          reason: 'both sides reordered the same collection differently',
          policy: policy.kind,
        });
        preferredOrder = l.order;
      } else if (localReordered) preferredOrder = l.order;
      else if (remoteReordered) preferredOrder = r.order;
      else preferredOrder = b.order;

      const order = [];
      for (const source of [preferredOrder, l.order, r.order, b.order]) {
        for (const id of source) {
          if (mergedMap.has(id) && !order.includes(id)) order.push(id);
        }
      }
      const candidate = order.map((id) => mergedMap.get(id));

      // Recursive conflicts inside a stable-ID array use semantic ID segments,
      // not physical JSON array indices. Such paths are excellent diagnostics
      // but cannot be applied safely by the generic JSON-pointer resolver,
      // especially for delete-versus-edit where the candidate item may be
      // absent. Collapse them into one executable collection-level conflict.
      // The report still retains the merged candidate, so a user may approve a
      // fully combined collection with an explicit `set` resolution.
      if (conflicts.length > conflictStart) {
        const nested = conflicts.slice(conflictStart);
        const reason = nested.length === 1 && nested[0].pointer === pointer
          ? nested[0].reason
          : 'conflicting edits or order within a stable-ID collection';
        conflicts.splice(conflictStart);
        conflicts.push({
          file,
          pointer,
          base,
          local,
          remote,
          reason,
          policy: policy.kind,
        });
      }
      return candidate;
    }
  }

  let reason = 'both sides changed the same value differently';
  if (base === MISSING) reason = 'both sides added different values';
  else if (local === MISSING || remote === MISSING) reason = 'delete-versus-edit conflict';
  conflicts.push({ file, pointer, base, local, remote, reason, policy: policy.kind });
  return local;
}

function mergeTrees(base = {}, local = {}, remote = {}, { policies = {} } = {}) {
  const conflicts = [];
  const merged = createJsonObject();
  const files = [...new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)])].sort();
  for (const file of files) {
    const value = mergeValue(
      Object.prototype.hasOwnProperty.call(base, file) ? base[file] : MISSING,
      Object.prototype.hasOwnProperty.call(local, file) ? local[file] : MISSING,
      Object.prototype.hasOwnProperty.call(remote, file) ? remote[file] : MISSING,
      { file, pointer: '', policies, conflicts },
    );
    if (value !== MISSING) setOwn(merged, file, value);
  }
  return { merged, conflicts, clean: conflicts.length === 0 };
}

module.exports = { policyFor, mergeSet, mergeTrees };
