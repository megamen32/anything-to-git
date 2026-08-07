'use strict';

// Revision handling: a `Revision` is whatever opaque token the external system
// uses to detect concurrent writes (etag, lastModified, version, etc.).
// The orchestrator pins a plan to a specific revision and refuses to apply
// it if the live system has moved on.

function makeRevision(value) {
  return { value: String(value), isEmpty: value == null || value === '' };
}

function revisionsEqual(a, b) {
  if (!a || !b) return false;
  return a.value === b.value;
}

module.exports = { makeRevision, revisionsEqual };
