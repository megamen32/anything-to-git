'use strict';

// Optional pure conversion hooks. Do not call BrowserOS, Playwright, Chrome MCP,
// HTTP APIs, the network, or the clock here. The same input must always produce
// the same canonical output.
module.exports = {
  // normalizeFieldValue({ field, value }) { return value; },
  // denormalizeFieldValue({ field, value }) { return value; },
  // validateTree({ tree, fields }) { return []; },
  // mergePolicies({ defaultPolicies }) { return defaultPolicies; },
};
