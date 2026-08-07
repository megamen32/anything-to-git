'use strict';

const crypto = require('crypto');
const path = require('path');
const {
  MISSING,
  canonicalize,
  cloneJson,
  createJsonObject,
  setOwn,
  deepEqual,
  diffTrees,
  getPointer,
  isPlainObject,
  normalizeTree,
  pointerTokens,
  readJson,
  setPointer,
  treeHash,
  validateTreePath,
} = require('./json');
const { A2GError } = require('./errors');
const { nowIso } = require('./time');

const FIELD_TYPES = new Set(['string', 'integer', 'number', 'boolean', 'array', 'object', 'null']);
const MERGE_KINDS = new Set(['atomic', 'set', 'by_id']);
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

class SiteAdapter {
  fetchSpec() { throw new A2GError('SiteAdapter.fetchSpec() is not implemented'); }
  normalizeCapture() { throw new A2GError('SiteAdapter.normalizeCapture() is not implemented'); }
  validateTree() { throw new A2GError('SiteAdapter.validateTree() is not implemented'); }
  planPush() { throw new A2GError('SiteAdapter.planPush() is not implemented'); }
  mergePolicies() { return {}; }
}

class DeclarativeSiteAdapter extends SiteAdapter {
  constructor(directory, hooks = {}) {
    super();
    this.directory = path.resolve(directory);
    this.manifest = readJson(path.join(this.directory, 'adapter.json'));
    if (!isPlainObject(this.manifest)) throw new A2GError('adapter.json must contain a JSON object');
    this.id = String(this.manifest.id || '');
    this.version = Number(this.manifest.version || 1);
    this.hooks = hooks || {};
    this.fields = [...this.iterFields()];
    this.validateManifest();
    this.fieldByKey = new Map(this.fields.map((field) => [field.capture_key, field]));
  }

  *iterFields() {
    for (const page of this.manifest.pages || []) {
      for (const block of page.blocks || []) {
        for (const rawField of block.fields || []) {
          const field = cloneJson(rawField);
          if (field.capture_key == null || field.capture_key === '') field.capture_key = `${page.id}.${block.id}.${field.id}`;
          field.page_id = page.id;
          field.block_id = block.id;
          field.page_navigation = cloneJson(page.navigation || {});
          field.block_navigation = cloneJson(block.navigation || {});
          field.page_save = cloneJson(page.save || {});
          field.block_save = cloneJson(block.save || {});
          yield field;
        }
      }
    }
  }

  validateManifest() {
    const topLevelKeys = new Set(['id', 'version', 'site', 'pages', 'merge_policies']);
    const unknownTop = Object.keys(this.manifest).filter((key) => !topLevelKeys.has(key));
    if (unknownTop.length) throw new A2GError(`adapter.json contains unsupported top-level keys: ${unknownTop.sort().join(', ')}`);
    if (!this.id || !SAFE_ID.test(this.id) || this.id.toLowerCase().endsWith('.lock') || this.id.includes('..')) {
      throw new A2GError(`Unsafe or missing adapter id: ${JSON.stringify(this.id)}`);
    }
    if (!Number.isInteger(this.version) || this.version < 1) throw new A2GError('Adapter version must be an integer >= 1');
    if (!isPlainObject(this.manifest.site) || typeof this.manifest.site.name !== 'string' || !this.manifest.site.name.trim()) {
      throw new A2GError('Adapter site must be an object with a non-empty name');
    }
    if (!Array.isArray(this.manifest.pages) || !this.manifest.pages.length) {
      throw new A2GError(`Adapter ${JSON.stringify(this.id)} declares no pages`);
    }

    const pageIds = new Set();
    const captureKeys = new Set();
    const canonicalLocations = new Set();
    for (const page of this.manifest.pages) {
      if (!isPlainObject(page) || typeof page.id !== 'string' || !SAFE_ID.test(page.id)) throw new A2GError('Every adapter page must have a safe non-empty string id');
      if (page.navigation != null && !isPlainObject(page.navigation)) throw new A2GError(`Page ${page.id}.navigation must be an object`);
      if (page.save != null && !isPlainObject(page.save)) throw new A2GError(`Page ${page.id}.save must be an object`);
      if (pageIds.has(page.id)) throw new A2GError(`Duplicate page id: ${page.id}`);
      pageIds.add(page.id);
      if (!Array.isArray(page.blocks) || !page.blocks.length) throw new A2GError(`Page ${page.id} declares no blocks`);
      const blockIds = new Set();
      for (const block of page.blocks) {
        if (!isPlainObject(block) || typeof block.id !== 'string' || !SAFE_ID.test(block.id)) throw new A2GError(`Every block on page ${page.id} must have a safe non-empty string id`);
        if (block.navigation != null && !isPlainObject(block.navigation)) throw new A2GError(`Block ${page.id}.${block.id}.navigation must be an object`);
        if (block.save != null && !isPlainObject(block.save)) throw new A2GError(`Block ${page.id}.${block.id}.save must be an object`);
        if (blockIds.has(block.id)) throw new A2GError(`Duplicate block id on page ${page.id}: ${block.id}`);
        blockIds.add(block.id);
        if (!Array.isArray(block.fields) || !block.fields.length) throw new A2GError(`Block ${page.id}.${block.id} declares no fields`);
        const fieldIds = new Set();
        for (const field of block.fields) {
          if (!isPlainObject(field) || typeof field.id !== 'string' || !SAFE_ID.test(field.id)) throw new A2GError(`Every field in ${page.id}.${block.id} must have a safe non-empty string id`);
          if (fieldIds.has(field.id)) throw new A2GError(`Duplicate field id in ${page.id}.${block.id}: ${field.id}`);
          fieldIds.add(field.id);
        }
      }
    }

    if (!this.fields.length) throw new A2GError(`Adapter ${JSON.stringify(this.id)} declares no fields`);
    for (const field of this.fields) {
      if (typeof field.capture_key !== 'string') throw new A2GError('Every capture_key must be a string');
      const key = field.capture_key;
      if (!SAFE_ID.test(key)) throw new A2GError(`Unsafe capture_key in adapter: ${key}`);
      if (captureKeys.has(key)) throw new A2GError(`Duplicate capture_key in adapter: ${key}`);
      captureKeys.add(key);
      if (!isPlainObject(field.canonical) || typeof field.canonical.file !== 'string') throw new A2GError(`Field ${key} has no canonical file mapping`);
      const file = validateTreePath(field.canonical.file);
      if (field.canonical.pointer != null && typeof field.canonical.pointer !== 'string') throw new A2GError(`Field ${key} canonical pointer must be a string`);
      const pointer = field.canonical.pointer || '';
      pointerTokens(pointer);
      const location = `${file}#${pointer}`;
      if (canonicalLocations.has(location)) throw new A2GError(`Duplicate canonical mapping: ${location}`);
      for (const existing of canonicalLocations) {
        const hash = existing.indexOf('#');
        const existingFile = existing.slice(0, hash);
        const existingPointer = existing.slice(hash + 1);
        if (existingFile !== file) continue;
        const existingContains = existingPointer === '' || pointer.startsWith(`${existingPointer}/`);
        const currentContains = pointer === '' || existingPointer.startsWith(`${pointer}/`);
        if (existingContains || currentContains) {
          throw new A2GError(`Overlapping canonical mappings are ambiguous: ${existing} and ${location}`);
        }
      }
      canonicalLocations.add(location);
      if (!FIELD_TYPES.has(field.type)) throw new A2GError(`Unsupported field type for ${key}: ${field.type}`);
      if (field.label != null && typeof field.label !== 'string') throw new A2GError(`Field ${key}.label must be a string`);
      if (field.description != null && typeof field.description !== 'string') throw new A2GError(`Field ${key}.description must be a string`);
      if (field.required != null && typeof field.required !== 'boolean') throw new A2GError(`Field ${key}.required must be boolean`);
      if (field.read != null && !isPlainObject(field.read)) throw new A2GError(`Field ${key}.read must be an object`);
      if (field.write != null && !isPlainObject(field.write)) throw new A2GError(`Field ${key}.write must be an object`);
      if (field.normalize != null && !isPlainObject(field.normalize)) throw new A2GError(`Field ${key}.normalize must be an object`);
      if (field.constraints != null && !isPlainObject(field.constraints)) throw new A2GError(`Field ${key}.constraints must be an object`);
      if (field.write && field.write.enabled != null && typeof field.write.enabled !== 'boolean') throw new A2GError(`Field ${key}.write.enabled must be boolean`);
      for (const flag of ['trim', 'normalize_newlines', 'empty_string_is_null']) {
        if (field.normalize && field.normalize[flag] != null && typeof field.normalize[flag] !== 'boolean') {
          throw new A2GError(`Field ${key}.normalize.${flag} must be boolean`);
        }
      }
      const constraints = field.constraints || {};
      if (constraints.pattern != null) {
        if (typeof constraints.pattern !== 'string') throw new A2GError(`Field ${key}.constraints.pattern must be a string`);
        try { new RegExp(constraints.pattern); } catch (error) {
          throw new A2GError(`Field ${key}.constraints.pattern is invalid: ${error.message}`);
        }
      }
      for (const name of ['min_length', 'max_length', 'min_items', 'max_items', 'minimum', 'maximum']) {
        if (constraints[name] != null && (typeof constraints[name] !== 'number' || !Number.isFinite(constraints[name]))) {
          throw new A2GError(`Field ${key}.constraints.${name} must be a finite number`);
        }
      }
      for (const name of ['min_length', 'max_length', 'min_items', 'max_items']) {
        if (constraints[name] != null && (!Number.isInteger(constraints[name]) || constraints[name] < 0)) {
          throw new A2GError(`Field ${key}.constraints.${name} must be a non-negative integer`);
        }
      }
      if (constraints.enum != null && !Array.isArray(constraints.enum)) throw new A2GError(`Field ${key}.constraints.enum must be an array`);
      if (constraints.min_length != null && constraints.max_length != null && constraints.min_length > constraints.max_length) {
        throw new A2GError(`Field ${key} has min_length greater than max_length`);
      }
      if (constraints.min_items != null && constraints.max_items != null && constraints.min_items > constraints.max_items) {
        throw new A2GError(`Field ${key} has min_items greater than max_items`);
      }
      if (constraints.minimum != null && constraints.maximum != null && constraints.minimum > constraints.maximum) {
        throw new A2GError(`Field ${key} has minimum greater than maximum`);
      }
    }

    this.validateMergePolicyMap(this.manifest.merge_policies || {});
  }

  validateMergePolicyMap(policies) {
    if (!isPlainObject(policies)) throw new A2GError('merge_policies must be an object');
    for (const [location, rawPolicy] of Object.entries(policies)) {
      const hash = location.indexOf('#');
      if (hash <= 0) throw new A2GError(`Merge policy location must be file.json#/pointer: ${location}`);
      const file = validateTreePath(location.slice(0, hash));
      const pointer = location.slice(hash + 1);
      pointerTokens(pointer);
      const policy = typeof rawPolicy === 'string' ? { kind: rawPolicy } : rawPolicy;
      if (!isPlainObject(policy) || !MERGE_KINDS.has(policy.kind)) throw new A2GError(`Invalid merge policy at ${location}`);
      const unknown = Object.keys(policy).filter((key) => !['kind', 'id_key', 'idKey'].includes(key));
      if (unknown.length) throw new A2GError(`Merge policy at ${location} has unsupported keys: ${unknown.sort().join(', ')}`);
      if (!this.fields.some((field) => this.fieldCovers(field, file, pointer))) {
        throw new A2GError(`Merge policy does not target a mapped canonical field: ${location}`);
      }
      const idKey = policy.id_key == null ? policy.idKey : policy.id_key;
      if (policy.kind === 'by_id' && idKey != null && (typeof idKey !== 'string' || !idKey)) {
        throw new A2GError(`by_id policy id_key must be a non-empty string at ${location}`);
      }
      if (policy.kind !== 'by_id' && idKey != null) {
        throw new A2GError(`Only by_id merge policy may declare id_key at ${location}`);
      }
    }
    return policies;
  }

  fetchSpec() {
    return {
      kind: 'anything-to-git.fetch-spec',
      adapter_id: this.id,
      adapter_version: this.version,
      site: cloneJson(this.manifest.site || {}),
      pages: cloneJson(this.manifest.pages || []),
      capture_contract: {
        adapter_id: this.id,
        adapter_version: this.version,
        captured_at: 'ISO-8601 timestamp',
        revision: 'site revision/ETag/version when available; otherwise null',
        values: {
          '<capture_key>': { present: true, value: 'captured JSON value' },
        },
        metadata: { source_url: 'optional', notes: 'optional' },
      },
      rules: [
        'Read every declared field and preserve exact user-visible values.',
        'Every capture key must be present. Use present=false only after verifying that an optional field is absent.',
        'Do not infer missing values. Use present=false only when absence is verified.',
        'Do not include credentials, cookies, tokens, or hidden session data.',
        'The adapter describes what to capture, not which browser tool to use.',
      ],
    };
  }

  captureTemplate({ verification = null } = {}) {
    const values = createJsonObject();
    for (const field of this.fields) setOwn(values, field.capture_key, { present: true, value: null });
    const template = {
      adapter_id: this.id,
      adapter_version: this.version,
      captured_at: nowIso(),
      revision: null,
      values,
      metadata: {},
    };
    if (verification != null) template.verification = canonicalize(verification);
    return template;
  }

  captureValue(raw, key) {
    if (!isPlainObject(raw) || typeof raw.present !== 'boolean') {
      throw new A2GError(`Capture value ${key} must be an object with boolean 'present'`);
    }
    if (raw.present && !Object.prototype.hasOwnProperty.call(raw, 'value')) {
      throw new A2GError(`Capture value ${key} is present but has no 'value'`);
    }
    const unknown = Object.keys(raw).filter((name) => !['present', 'value'].includes(name));
    if (unknown.length) throw new A2GError(`Capture value ${key} contains unsupported keys: ${unknown.sort().join(', ')}`);
    if (!raw.present && Object.prototype.hasOwnProperty.call(raw, 'value')) {
      throw new A2GError(`Capture value ${key} is absent and must not contain 'value'`);
    }
    return { present: raw.present, value: raw.value };
  }

  normalizeCapture(capture) {
    if (!isPlainObject(capture)) throw new A2GError('Capture must be a JSON object');
    const allowed = new Set(['adapter_id', 'adapter_version', 'captured_at', 'revision', 'values', 'metadata', 'verification']);
    const unknownTop = Object.keys(capture).filter((key) => !allowed.has(key));
    if (unknownTop.length) throw new A2GError(`Capture contains unsupported top-level keys: ${unknownTop.sort().join(', ')}`);
    for (const key of ['adapter_id', 'adapter_version', 'captured_at', 'revision', 'values', 'metadata']) {
      if (!Object.prototype.hasOwnProperty.call(capture, key)) throw new A2GError(`Capture is missing required top-level key: ${key}`);
    }
    if (capture.adapter_id !== this.id) throw new A2GError(`Capture belongs to ${JSON.stringify(capture.adapter_id)}, expected ${JSON.stringify(this.id)}`);
    if (!Number.isInteger(capture.adapter_version)) {
      throw new A2GError("Capture must contain an integer 'adapter_version'");
    }
    if (capture.adapter_version !== this.version) {
      throw new A2GError(`Capture uses adapter version ${JSON.stringify(capture.adapter_version)}, expected ${this.version}`);
    }
    if (typeof capture.captured_at !== 'string' || !/(?:Z|[+-]\d{2}:\d{2})$/.test(capture.captured_at) || !Number.isFinite(Date.parse(capture.captured_at))) {
      throw new A2GError("Capture 'captured_at' must be an ISO-8601 timestamp with an explicit offset");
    }
    if (capture.revision != null && typeof capture.revision !== 'string') throw new A2GError("Capture 'revision' must be a string or null");
    if (capture.revision === '') throw new A2GError("Capture 'revision' must not be an empty string");
    if (!isPlainObject(capture.metadata)) throw new A2GError("Capture 'metadata' must be an object");
    let verification = null;
    if (capture.verification != null) {
      if (!isPlainObject(capture.verification)) throw new A2GError("Capture 'verification' must be an object");
      const keys = Object.keys(capture.verification).sort();
      if (keys.join(',') !== 'challenge,plan_id') throw new A2GError("Capture 'verification' must contain exactly plan_id and challenge");
      if (typeof capture.verification.plan_id !== 'string' || !/^plan-[0-9a-f]{12}$/.test(capture.verification.plan_id)) {
        throw new A2GError("Capture verification plan_id is invalid");
      }
      if (typeof capture.verification.challenge !== 'string' || !/^[0-9a-f]{48}$/.test(capture.verification.challenge)) {
        throw new A2GError("Capture verification challenge is invalid");
      }
      verification = canonicalize(capture.verification);
    }
    if (!isPlainObject(capture.values)) throw new A2GError("Capture must contain an object named 'values'");
    const unknown = Object.keys(capture.values).filter((key) => !this.fieldByKey.has(key));
    if (unknown.length) throw new A2GError(`Capture contains fields unknown to this adapter: ${unknown.sort().join(', ')}`);

    const tree = createJsonObject();
    for (const field of this.fields) {
      const key = field.capture_key;
      const required = field.required !== false;
      if (!Object.prototype.hasOwnProperty.call(capture.values, key)) throw new A2GError(`Complete capture value is missing: ${key}`);
      const { present, value } = this.captureValue(capture.values[key], key);
      if (!present) {
        if (required) throw new A2GError(`Required field was captured as absent: ${key}`);
        continue;
      }
      const file = field.canonical.file;
      const pointer = field.canonical.pointer || '';
      const document = Object.prototype.hasOwnProperty.call(tree, file) ? tree[file] : createJsonObject();
      setOwn(tree, file, setPointer(document, pointer, this.normalizeFieldValue(field, value)));
    }

    const issues = this.validateTree(tree);
    const errors = issues.filter((issue) => issue.level === 'error');
    if (errors.length) throw new A2GError(`Captured site state is invalid: ${errors.map((issue) => issue.message).join('; ')}`);
    const normalized = canonicalize(tree);
    return {
      adapter_id: this.id,
      adapter_version: this.version,
      revision: String(capture.revision || `sha256:${treeHash(normalized)}`),
      tree: normalized,
      captured_at: capture.captured_at || null,
      metadata: canonicalize(capture.metadata || {}),
      verification,
    };
  }

  normalizeFieldValue(field, value) {
    let result = canonicalize(value);
    const normalizer = field.normalize || {};
    if (normalizer.trim && typeof result === 'string') result = result.trim();
    if (normalizer.normalize_newlines && typeof result === 'string') result = result.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    if (normalizer.empty_string_is_null && result === '') result = null;
    if (typeof this.hooks.normalizeFieldValue === 'function') {
      result = this.hooks.normalizeFieldValue({ field: cloneJson(field), value: result, adapter: this });
    }
    return canonicalize(result);
  }

  denormalizeFieldValue(field, value) {
    let result = canonicalize(value);
    if (typeof this.hooks.denormalizeFieldValue === 'function') {
      result = this.hooks.denormalizeFieldValue({ field: cloneJson(field), value: result, adapter: this });
    }
    return canonicalize(result);
  }

  validateTree(tree) {
    const issues = [];
    if (!isPlainObject(tree)) {
      return [{ level: 'error', code: 'tree_type', message: 'Canonical tree must map JSON file paths to values' }];
    }
    let normalized;
    try {
      normalized = normalizeTree(tree);
    } catch (error) {
      return [{ level: 'error', code: 'tree_shape', message: error.message }];
    }
    for (const change of diffTrees({}, normalized)) {
      if (!this.fields.some((field) => this.fieldCovers(field, change.file, change.pointer))) {
        issues.push({
          level: 'error',
          code: 'unmapped',
          message: `Canonical value is not mapped by the adapter: ${change.file}#${change.pointer}`,
          file: change.file,
          pointer: change.pointer,
        });
      }
    }
    for (const field of this.fields) {
      const file = field.canonical.file;
      const pointer = field.canonical.pointer || '';
      const document = Object.prototype.hasOwnProperty.call(normalized, file) ? normalized[file] : MISSING;
      const value = getPointer(document, pointer, MISSING);
      const required = field.required !== false;
      if (value === MISSING) {
        if (required) issues.push({ level: 'error', code: 'required', message: `Required value is missing: ${field.capture_key}`, file, pointer });
        continue;
      }
      const constraints = field.constraints || {};
      let validType = true;
      switch (field.type) {
        case 'string': validType = typeof value === 'string'; break;
        case 'integer': validType = Number.isInteger(value); break;
        case 'number': validType = typeof value === 'number' && Number.isFinite(value); break;
        case 'boolean': validType = typeof value === 'boolean'; break;
        case 'array': validType = Array.isArray(value); break;
        case 'object': validType = isPlainObject(value); break;
        case 'null': validType = value === null; break;
        default: validType = false;
      }
      if (!validType) {
        issues.push({ level: 'error', code: 'type', message: `${field.capture_key} must be ${field.type}`, file, pointer });
        continue;
      }
      if (typeof value === 'string') {
        if (constraints.min_length != null && value.length < Number(constraints.min_length)) issues.push({ level: 'error', code: 'min_length', message: `${field.capture_key} is too short`, file, pointer });
        if (constraints.max_length != null && value.length > Number(constraints.max_length)) issues.push({ level: 'error', code: 'max_length', message: `${field.capture_key} is too long`, file, pointer });
        if (constraints.pattern != null && !(new RegExp(String(constraints.pattern))).test(value)) issues.push({ level: 'error', code: 'pattern', message: `${field.capture_key} does not match its pattern`, file, pointer });
      }
      if (Array.isArray(value)) {
        if (constraints.min_items != null && value.length < Number(constraints.min_items)) issues.push({ level: 'error', code: 'min_items', message: `${field.capture_key} has too few items`, file, pointer });
        if (constraints.max_items != null && value.length > Number(constraints.max_items)) issues.push({ level: 'error', code: 'max_items', message: `${field.capture_key} has too many items`, file, pointer });
      }
      if (typeof value === 'number') {
        if (constraints.minimum != null && value < Number(constraints.minimum)) issues.push({ level: 'error', code: 'minimum', message: `${field.capture_key} is below its minimum`, file, pointer });
        if (constraints.maximum != null && value > Number(constraints.maximum)) issues.push({ level: 'error', code: 'maximum', message: `${field.capture_key} is above its maximum`, file, pointer });
      }
      if (Array.isArray(constraints.enum) && !constraints.enum.some((candidate) => deepEqual(candidate, value))) {
        issues.push({ level: 'error', code: 'enum', message: `${field.capture_key} has an unsupported value`, file, pointer });
      }
    }
    if (typeof this.hooks.validateTree === 'function') {
      const extra = this.hooks.validateTree({ tree: cloneJson(normalized), fields: cloneJson(this.fields), adapter: this });
      if (!Array.isArray(extra)) throw new A2GError('converter.validateTree() must return an array of issues');
      for (const rawIssue of extra) {
        if (!isPlainObject(rawIssue) || !['error', 'warning'].includes(rawIssue.level) || typeof rawIssue.code !== 'string' || !rawIssue.code || typeof rawIssue.message !== 'string' || !rawIssue.message) {
          throw new A2GError('Every converter.validateTree() issue must contain level=error|warning and non-empty code/message strings');
        }
        const issue = canonicalize(rawIssue);
        if (issue.file != null) validateTreePath(issue.file);
        if (issue.pointer != null) pointerTokens(issue.pointer);
        issues.push(issue);
      }
    }
    return issues;
  }

  fieldCovers(field, file, pointer) {
    if (field.canonical.file !== file) return false;
    const fieldPointer = field.canonical.pointer || '';
    return pointer === fieldPointer || (fieldPointer === '' ? pointer.startsWith('/') : pointer.startsWith(`${fieldPointer}/`));
  }

  fieldForLocation(file, pointer = '') {
    return this.fields.find((field) => this.fieldCovers(field, file, pointer)) || null;
  }

  describeLocation(file, pointer = '') {
    const field = this.fieldForLocation(file, pointer);
    if (!field) return { file, pointer };
    return {
      file,
      pointer,
      page_id: field.page_id,
      block_id: field.block_id,
      field_id: field.id,
      capture_key: field.capture_key,
      label: field.label || field.id,
      description: field.description || null,
      type: field.type,
      required: field.required !== false,
      writable: !(field.write && field.write.enabled === false),
      constraints: cloneJson(field.constraints || {}),
    };
  }

  planPush(currentRemote, desired, { expectedRevision }) {
    if (expectedRevision == null || String(expectedRevision) === '') {
      throw new A2GError('A push plan requires the exact revision of the captured site state');
    }
    const normalizedRemote = normalizeTree(currentRemote);
    const normalizedDesired = normalizeTree(desired);
    const issues = this.validateTree(normalizedDesired);
    const errors = issues.filter((issue) => issue.level === 'error');
    if (errors.length) throw new A2GError(`Desired state is invalid: ${errors.map((issue) => issue.message).join('; ')}`);

    const changes = diffTrees(normalizedRemote, normalizedDesired);
    const unmapped = changes.filter((change) => !this.fields.some((field) => this.fieldCovers(field, change.file, change.pointer)));
    if (unmapped.length) {
      throw new A2GError(`Desired tree contains changes not mapped by the adapter: ${unmapped.slice(0, 10).map((change) => `${change.file}#${change.pointer}`).join(', ')}`);
    }

    const operations = [];
    for (const field of this.fields) {
      const file = field.canonical.file;
      const pointer = field.canonical.pointer || '';
      const beforeDocument = Object.prototype.hasOwnProperty.call(normalizedRemote, file) ? normalizedRemote[file] : MISSING;
      const afterDocument = Object.prototype.hasOwnProperty.call(normalizedDesired, file) ? normalizedDesired[file] : MISSING;
      const before = getPointer(beforeDocument, pointer, MISSING);
      const after = getPointer(afterDocument, pointer, MISSING);
      if (deepEqual(before, after)) continue;
      if (field.write && field.write.enabled === false) throw new A2GError(`Read-only site field changed locally: ${field.capture_key}`);
      const navigation = { ...(field.page_navigation || {}), ...(field.block_navigation || {}) };
      const save = { ...(field.page_save || {}), ...(field.block_save || {}) };
      operations.push({
        operation_id: `op-${String(operations.length + 1).padStart(4, '0')}`,
        action: after === MISSING ? 'clear' : 'set',
        file,
        pointer,
        page_id: field.page_id,
        block_id: field.block_id,
        field_id: field.id,
        capture_key: field.capture_key,
        label: field.label || field.id,
        description: field.description || null,
        type: field.type,
        required: field.required !== false,
        constraints: cloneJson(field.constraints || {}),
        expected_present: before !== MISSING,
        expected_before: before === MISSING ? null : cloneJson(before),
        expected_before_site: before === MISSING ? null : this.denormalizeFieldValue(field, before),
        value_present: after !== MISSING,
        value: after === MISSING ? null : cloneJson(after),
        write_value: after === MISSING ? null : this.denormalizeFieldValue(field, after),
        navigation: canonicalize(navigation),
        observation: cloneJson(field.read || {}),
        interaction: cloneJson(field.write || {}),
        comparison_normalization: cloneJson(field.normalize || {}),
        save: canonicalize(save),
        save_group: (field.write && field.write.save_group) || field.page_id,
      });
    }

    return {
      kind: 'anything-to-git.push-plan',
      plan_id: `plan-${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`,
      adapter_id: this.id,
      adapter_version: this.version,
      site: cloneJson(this.manifest.site || {}),
      expected_remote_revision: String(expectedRevision),
      current_remote_hash: treeHash(normalizedRemote),
      desired_hash: treeHash(normalizedDesired),
      operations,
      execution_rules: [
        'Before each write, read the complete current field and compare its site representation with expected_present/expected_before_site; expected_before is the canonical audit value.',
        'Stop immediately on any precondition mismatch, navigation ambiguity, validation error, or uncertain save result.',
        'Write only write_value for each listed operation; value is the canonical desired value used for audit.',
        'After all saves, capture the complete synchronized site object again and run a2g verify.',
      ],
      warnings: issues.filter((issue) => issue.level === 'warning').map((issue) => issue.message),
      created_at: nowIso(),
    };
  }

  mergePolicies() {
    const defaults = cloneJson(this.manifest.merge_policies || {});
    let result = defaults;
    if (typeof this.hooks.mergePolicies === 'function') {
      result = this.hooks.mergePolicies({ manifest: cloneJson(this.manifest), defaultPolicies: defaults, adapter: this });
      if (!isPlainObject(result)) throw new A2GError('converter.mergePolicies() must return an object');
    }
    this.validateMergePolicyMap(result);
    return canonicalize(result);
  }
}

module.exports = { SiteAdapter, DeclarativeSiteAdapter, FIELD_TYPES, MERGE_KINDS };
