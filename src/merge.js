'use strict';

const { isObject, get, set, remove, deepEqual, listPaths } = require('./tree');

// Three-way merge at JSON-path level.
// base  = last agreed state (site == local at the last successful sync)
// local = current local (Git) state
// remote = freshly fetched state of the external system
//
// Returns { merged, conflicts, classifications }
//   merged        : canonical tree with auto-resolved changes
//   conflicts     : [{ path, base, local, remote, reason }]
//   classifications: { [path]: 'local-only' | 'remote-only' | 'both' | 'agree' | 'delete-vs-edit' }

function threeWay(base, local, remote) {
  const merged = JSON.parse(JSON.stringify(base || {}));
  const conflicts = [];
  const classifications = {};

  const paths = new Set();
  for (const p of listPaths(base || {})) paths.add(p);
  for (const p of listPaths(local || {})) paths.add(p);
  for (const p of listPaths(remote || {})) paths.add(p);

  for (const path of [...paths].sort()) {
    const b = get(base || {}, path);
    const l = get(local || {}, path);
    const r = get(remote || {}, path);

    const bUndef = b === undefined;
    const lUndef = l === undefined;
    const rUndef = r === undefined;

    // All three absent — nothing to do.
    if (bUndef && lUndef && rUndef) {
      classifications[path] = 'absent';
      continue;
    }

    // Pure add cases (base had no value).
    if (bUndef) {
      if (lUndef) {
        set(merged, path, r);
        classifications[path] = 'remote-only';
      } else if (rUndef) {
        set(merged, path, l);
        classifications[path] = 'local-only';
      } else if (deepEqual(l, r)) {
        set(merged, path, l);
        classifications[path] = 'agree';
      } else {
        // Both added different values — real conflict.
        classifications[path] = 'conflict';
        conflicts.push({ path, base: b, local: l, remote: r, reason: 'both-added' });
        set(merged, path, l);
      }
      continue;
    }

    // Base had a value, one or both sides removed it.
    if (lUndef || rUndef) {
      if (lUndef && rUndef) {
        // Both deleted — agree.
        classifications[path] = 'agree';
        // ensure removal in merged
        const { remove } = require('./tree');
        remove(merged, path);
        continue;
      }
      // Exactly one side removed.
      const survivor = lUndef ? r : l;
      const survivorName = lUndef ? 'remote' : 'local';
      if (deepEqual(survivor, b)) {
        // The side that kept the field didn't change it; the other side deleted.
        // Take the deletion.
        const { remove } = require('./tree');
        remove(merged, path);
        classifications[path] = survivorName + '-only'; // 'remote-only' or 'local-only'
      } else {
        // The side that kept the field changed it; the other side deleted.
        // delete-vs-edit: real conflict, both interpretations are valid.
        classifications[path] = 'delete-vs-edit';
        conflicts.push({ path, base: b, local: l, remote: r, reason: 'delete-vs-edit' });
        // Don't auto-resolve: keep base in merged so the conflict is visible.
      }
      continue;
    }

    // All three present.
    const lEqB = deepEqual(l, b);
    const rEqB = deepEqual(r, b);
    const lEqR = deepEqual(l, r);

    if (lEqB && rEqB) {
      classifications[path] = 'agree';
      continue;
    }
    if (lEqB && !rEqB) {
      set(merged, path, r);
      classifications[path] = 'remote-only';
      continue;
    }
    if (rEqB && !lEqB) {
      set(merged, path, l);
      classifications[path] = 'local-only';
      continue;
    }
    if (lEqR) {
      set(merged, path, l);
      classifications[path] = 'agree';
      continue;
    }

    // Both changed differently — real conflict.
    classifications[path] = 'conflict';
    conflicts.push({ path, base: b, local: l, remote: r, reason: 'value-diverged' });
    // Default behaviour: keep local, flag.
    set(merged, path, l);
  }

  return { merged, conflicts, classifications };
}

// Recursive object merge (used by adapters that explicitly opt into a
// per-field "join" merge strategy, e.g. for sets of tags or notes).
function deepJoinObjects(local, remote) {
  if (Array.isArray(local) && Array.isArray(remote)) {
    return Array.from(new Set([...local, ...remote]));
  }
  if (isObject(local) && isObject(remote)) {
    const out = { ...local };
    for (const k of Object.keys(remote)) {
      if (k in out) out[k] = deepJoinObjects(out[k], remote[k]);
      else out[k] = remote[k];
    }
    return out;
  }
  // Scalars: remote wins on tie-break by presence.
  return remote !== undefined ? remote : local;
}

module.exports = { threeWay, deepJoinObjects };
