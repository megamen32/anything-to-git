'use strict';

// Adapter base class. Concrete adapters (iri-grant, local-files, …) extend
// this and override the methods they need. The orchestrator only ever calls
// these hooks, so adapters are free to use any tool under the hood
// (Playwright, browser-mcp, browseros, chrome-devtools-mcp, raw HTTP, …).

class Adapter {
  constructor(config = {}) {
    this.config = config;
    this.name = config.name || 'unnamed-adapter';
  }

  // Capabilities manifest. Adapters should override.
  describe() {
    return {
      name: this.name,
      atomicApply: false,
      supportsRevision: false,
      supportsDelete: true,
      supportsAttachments: false,
      supportsTransactions: false,
      supportsPartialUpdate: true,
      blocks: [],
    };
  }

  // Required: read the current external state and return a snapshot.
  // snapshot = { revision, tree, fetchedAt, raw? }
  async fetch() {
    throw new Error(`Adapter ${this.name}: fetch() not implemented`);
  }

  // Required: build a change plan from currentRemote to desired.
  // Most adapters can use the default JSON-Patch builder, but may
  // override to translate to native operations (e.g. SDK calls).
  // eslint-disable-next-line no-unused-vars
  async plan(currentRemote, desired) {
    const { buildPlan } = require('./plan');
    return buildPlan(currentRemote, desired);
  }

  // Optional: validate the plan before applying.
  // eslint-disable-next-line no-unused-vars
  async validate(plan) {
    return { ok: true, errors: [] };
  }

  // Required: apply the plan against the external system, pinned to
  // `expectedRevision`. If the external system has moved, throw
  // `RevisionMismatchError` so the orchestrator can refetch and retry.
  // eslint-disable-next-line no-unused-vars
  async apply(plan, expectedRevision) {
    throw new Error(`Adapter ${this.name}: apply() not implemented`);
  }

  // Optional: re-read the external state after apply and return the new snapshot.
  async verify() {
    return this.fetch();
  }
}

class RevisionMismatchError extends Error {
  constructor(expected, actual) {
    super(`Revision mismatch: expected ${JSON.stringify(expected)} but external is ${JSON.stringify(actual)}`);
    this.name = 'RevisionMismatchError';
    this.expected = expected;
    this.actual = actual;
  }
}

module.exports = { Adapter, RevisionMismatchError };
