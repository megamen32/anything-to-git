'use strict';

const fs = require('fs');
const path = require('path');
const { DeclarativeSiteAdapter } = require('./adapter');
const { A2GError } = require('./errors');

const ALLOWED_HOOKS = new Set([
  'normalizeFieldValue',
  'denormalizeFieldValue',
  'validateTree',
  'mergePolicies',
]);

function loadAdapter(directory) {
  const resolved = path.resolve(directory);
  if (!fs.existsSync(path.join(resolved, 'adapter.json'))) {
    throw new A2GError(`Adapter manifest not found: ${path.join(resolved, 'adapter.json')}`);
  }
  let hooks = {};
  const converterPath = path.join(resolved, 'converter.js');
  if (fs.existsSync(converterPath)) {
    delete require.cache[require.resolve(converterPath)];
    hooks = require(converterPath);
    if (typeof hooks === 'function') hooks = hooks();
    if (!hooks || typeof hooks !== 'object' || Array.isArray(hooks)) {
      throw new A2GError(`Adapter converter must export an object: ${converterPath}`);
    }
    const unknown = Object.keys(hooks).filter((name) => !ALLOWED_HOOKS.has(name));
    if (unknown.length) {
      throw new A2GError(`Adapter converter exports unsupported hooks: ${unknown.sort().join(', ')}`);
    }
    for (const [name, hook] of Object.entries(hooks)) {
      if (typeof hook !== 'function') throw new A2GError(`Adapter converter hook ${name} must be a function`);
    }
  }
  return new DeclarativeSiteAdapter(resolved, hooks);
}

module.exports = { loadAdapter };
