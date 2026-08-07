'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { A2GError } = require('./errors');

const MISSING = Symbol('anything-to-git.missing');

function createJsonObject() {
  return Object.create(null);
}

function setOwn(object, key, value) {
  Object.defineProperty(object, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
  return object;
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function canonicalize(value, seen = new WeakSet()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new A2GError('Non-finite numbers are not valid canonical JSON');
    if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
      throw new A2GError('Integers outside JavaScript safe range must be encoded as strings');
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value === 'undefined') throw new A2GError('undefined is not valid canonical JSON');
  if (typeof value === 'bigint' || typeof value === 'function' || typeof value === 'symbol') {
    throw new A2GError(`Unsupported canonical JSON value: ${typeof value}`);
  }
  if (seen.has(value)) throw new A2GError('Cyclic values are not valid canonical JSON');
  seen.add(value);
  try {
    if (Array.isArray(value)) return value.map((item) => canonicalize(item, seen));
    if (!isPlainObject(value)) throw new A2GError('Only plain objects are valid canonical JSON objects');
    const out = createJsonObject();
    for (const key of Object.keys(value).sort()) setOwn(out, key, canonicalize(value[key], seen));
    return out;
  } finally {
    seen.delete(value);
  }
}

function canonicalStringify(value, { pretty = true, trailingNewline = pretty } = {}) {
  const text = JSON.stringify(canonicalize(value), null, pretty ? 2 : 0);
  return trailingNewline ? `${text}\n` : text;
}

function canonicalBytes(value) {
  return Buffer.from(canonicalStringify(value, { pretty: false, trailingNewline: false }), 'utf8');
}

class StrictJsonParser {
  constructor(text, source) {
    this.text = text;
    this.source = source;
    this.index = 0;
  }

  fail(message) {
    const before = this.text.slice(0, this.index);
    const line = before.split('\n').length;
    const lastNewline = before.lastIndexOf('\n');
    const column = this.index - lastNewline;
    throw new A2GError(`Invalid JSON in ${this.source} at ${line}:${column}: ${message}`);
  }

  skipWhitespace() {
    while (this.index < this.text.length && /[\t\n\r ]/.test(this.text[this.index])) this.index += 1;
  }

  parse() {
    this.skipWhitespace();
    const value = this.parseValue();
    this.skipWhitespace();
    if (this.index !== this.text.length) this.fail('trailing data');
    return value;
  }

  parseValue() {
    this.skipWhitespace();
    const ch = this.text[this.index];
    if (ch === '{') return this.parseObject();
    if (ch === '[') return this.parseArray();
    if (ch === '"') return this.parseString();
    if (ch === '-' || (ch >= '0' && ch <= '9')) return this.parseNumber();
    if (this.text.startsWith('true', this.index)) { this.index += 4; return true; }
    if (this.text.startsWith('false', this.index)) { this.index += 5; return false; }
    if (this.text.startsWith('null', this.index)) { this.index += 4; return null; }
    this.fail('expected a JSON value');
  }

  parseObject() {
    const out = createJsonObject();
    const keys = new Set();
    this.index += 1;
    this.skipWhitespace();
    if (this.text[this.index] === '}') { this.index += 1; return out; }
    while (true) {
      this.skipWhitespace();
      if (this.text[this.index] !== '"') this.fail('object key must be a string');
      const key = this.parseString();
      if (keys.has(key)) this.fail(`duplicate object key ${JSON.stringify(key)}`);
      keys.add(key);
      this.skipWhitespace();
      if (this.text[this.index] !== ':') this.fail("expected ':' after object key");
      this.index += 1;
      setOwn(out, key, this.parseValue());
      this.skipWhitespace();
      const ch = this.text[this.index];
      if (ch === '}') { this.index += 1; return out; }
      if (ch !== ',') this.fail("expected ',' or '}' in object");
      this.index += 1;
    }
  }

  parseArray() {
    const out = [];
    this.index += 1;
    this.skipWhitespace();
    if (this.text[this.index] === ']') { this.index += 1; return out; }
    while (true) {
      out.push(this.parseValue());
      this.skipWhitespace();
      const ch = this.text[this.index];
      if (ch === ']') { this.index += 1; return out; }
      if (ch !== ',') this.fail("expected ',' or ']' in array");
      this.index += 1;
    }
  }

  parseString() {
    const start = this.index;
    this.index += 1;
    while (this.index < this.text.length) {
      const code = this.text.charCodeAt(this.index);
      const ch = this.text[this.index];
      if (ch === '"') {
        this.index += 1;
        try {
          return JSON.parse(this.text.slice(start, this.index));
        } catch (error) {
          this.fail(error.message);
        }
      }
      if (code < 0x20) this.fail('unescaped control character in string');
      if (ch === '\\') {
        this.index += 1;
        if (this.index >= this.text.length) this.fail('unterminated escape sequence');
        const escape = this.text[this.index];
        if (!'"\\/bfnrtu'.includes(escape)) this.fail(`invalid escape sequence \\${escape}`);
        if (escape === 'u') {
          const hex = this.text.slice(this.index + 1, this.index + 5);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) this.fail('invalid unicode escape');
          this.index += 4;
        }
      }
      this.index += 1;
    }
    this.fail('unterminated string');
  }

  parseNumber() {
    const rest = this.text.slice(this.index);
    const match = rest.match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);
    if (!match) this.fail('invalid number');
    const token = match[0];
    this.index += token.length;
    const value = Number(token);
    if (!Number.isFinite(value)) this.fail('non-finite number');
    if (value === 0 && /[1-9]/.test(token)) {
      this.fail('number underflows JavaScript numeric range; encode it as a JSON string');
    }
    if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
      this.fail('integer is outside JavaScript safe range; encode it as a JSON string');
    }
    return Object.is(value, -0) ? 0 : value;
  }
}

function strictJsonParse(text, { source = 'JSON' } = {}) {
  if (typeof text !== 'string') throw new A2GError(`Expected JSON text from ${source}`);
  return new StrictJsonParser(text, source).parse();
}

function readJson(filePath) {
  try {
    return strictJsonParse(fs.readFileSync(filePath, 'utf8'), { source: filePath });
  } catch (error) {
    if (error && error.code === 'ENOENT') throw new A2GError(`File not found: ${filePath}`);
    throw error;
  }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, canonicalStringify(value), 'utf8');
}

// Presence wrappers are used in user-editable reports. They deliberately keep
// absence outside the JSON value itself, so a legitimate value such as
// {"$a2g":"missing"} can never be mistaken for the internal MISSING sentinel.
function encodePresence(value) {
  if (value === MISSING) return { present: false };
  return { present: true, value: canonicalize(value) };
}

function decodePresence(wrapper) {
  if (!isPlainObject(wrapper) || typeof wrapper.present !== 'boolean') {
    throw new A2GError("Presence value must be an object with boolean 'present'");
  }
  const keys = Object.keys(wrapper).sort();
  if (!wrapper.present) {
    if (keys.length !== 1) throw new A2GError("Absent presence value must contain only 'present'");
    return MISSING;
  }
  if (!Object.prototype.hasOwnProperty.call(wrapper, 'value') || keys.some((key) => !['present', 'value'].includes(key))) {
    throw new A2GError("Present presence value must contain exactly 'present' and 'value'");
  }
  return canonicalize(wrapper.value);
}

function validateTreePath(value) {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.includes('\0')) {
    throw new A2GError(`Unsafe canonical tree path: ${JSON.stringify(value)}`);
  }
  if (path.posix.isAbsolute(value)) throw new A2GError(`Unsafe canonical tree path: ${JSON.stringify(value)}`);
  const parts = value.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) {
    throw new A2GError(`Unsafe canonical tree path: ${JSON.stringify(value)}`);
  }
  if (['.a2g', '.git'].includes(parts[0].toLowerCase())) throw new A2GError(`Reserved canonical tree path: ${JSON.stringify(value)}`);
  if (!value.toLowerCase().endsWith('.json')) throw new A2GError(`Canonical tree files must end in .json: ${JSON.stringify(value)}`);
  return value;
}

function normalizeTree(tree) {
  if (!isPlainObject(tree)) throw new A2GError('Canonical tree must be an object mapping file paths to JSON values');
  const out = createJsonObject();
  for (const key of Object.keys(tree).sort()) setOwn(out, validateTreePath(key), canonicalize(tree[key]));
  return out;
}

function treeHash(tree) {
  const hash = crypto.createHash('sha256');
  for (const [file, value] of Object.entries(normalizeTree(tree))) {
    hash.update(file, 'utf8');
    hash.update(Buffer.from([0]));
    hash.update(canonicalBytes(value));
    hash.update(Buffer.from([0]));
  }
  return hash.digest('hex');
}

function pointerTokens(pointer) {
  if (pointer === '') return [];
  if (typeof pointer !== 'string' || !pointer.startsWith('/')) {
    throw new A2GError(`JSON pointer must be empty or start with '/': ${JSON.stringify(pointer)}`);
  }
  return pointer.slice(1).split('/').map((token) => {
    if (/~(?:[^01]|$)/.test(token)) throw new A2GError(`Invalid JSON pointer escape in ${JSON.stringify(pointer)}`);
    return token.replace(/~1/g, '/').replace(/~0/g, '~');
  });
}

function escapePointerToken(token) {
  return String(token).replace(/~/g, '~0').replace(/\//g, '~1');
}

function joinPointer(pointer, token) {
  const escaped = escapePointerToken(token);
  return pointer ? `${pointer}/${escaped}` : `/${escaped}`;
}

function isArrayIndex(token) {
  return /^(?:0|[1-9]\d*)$/.test(token);
}

function getPointer(document, pointer, fallback = MISSING) {
  let current = document;
  for (const token of pointerTokens(pointer)) {
    if (Array.isArray(current) && isArrayIndex(token) && Number(token) < current.length) current = current[Number(token)];
    else if (isPlainObject(current) && Object.prototype.hasOwnProperty.call(current, token)) current = current[token];
    else return fallback;
  }
  return current;
}

function setPointer(document, pointer, value) {
  const tokens = pointerTokens(pointer);
  if (!tokens.length) return canonicalize(value);
  let root = (Array.isArray(document) || isPlainObject(document)) ? document : (isArrayIndex(tokens[0]) ? [] : createJsonObject());
  let current = root;
  for (let index = 0; index < tokens.length - 1; index += 1) {
    const token = tokens[index];
    const nextIsArray = isArrayIndex(tokens[index + 1]);
    if (Array.isArray(current)) {
      if (!isArrayIndex(token)) throw new A2GError(`Array JSON pointer token must be an index: ${token}`);
      const position = Number(token);
      if (position > current.length) throw new A2GError(`Array JSON pointer index is out of range: ${position}`);
      if (position === current.length) current.push(nextIsArray ? [] : createJsonObject());
      if (!Array.isArray(current[position]) && !isPlainObject(current[position])) current[position] = nextIsArray ? [] : createJsonObject();
      current = current[position];
    } else {
      if (!Object.prototype.hasOwnProperty.call(current, token) || (!Array.isArray(current[token]) && !isPlainObject(current[token]))) {
        setOwn(current, token, nextIsArray ? [] : createJsonObject());
      }
      current = current[token];
    }
  }
  const last = tokens[tokens.length - 1];
  const normalized = canonicalize(value);
  if (Array.isArray(current)) {
    if (!isArrayIndex(last)) throw new A2GError(`Array JSON pointer token must be an index: ${last}`);
    const position = Number(last);
    if (position > current.length) throw new A2GError(`Array JSON pointer index is out of range: ${position}`);
    if (position === current.length) current.push(normalized); else current[position] = normalized;
  } else {
    setOwn(current, last, normalized);
  }
  return root;
}

function deletePointer(document, pointer) {
  const tokens = pointerTokens(pointer);
  if (!tokens.length) return MISSING;
  if (!Array.isArray(document) && !isPlainObject(document)) return document;
  let current = document;
  for (const token of tokens.slice(0, -1)) {
    if (Array.isArray(current) && isArrayIndex(token) && Number(token) < current.length) current = current[Number(token)];
    else if (isPlainObject(current) && Object.prototype.hasOwnProperty.call(current, token)) current = current[token];
    else return document;
  }
  const last = tokens[tokens.length - 1];
  if (Array.isArray(current) && isArrayIndex(last) && Number(last) < current.length) current.splice(Number(last), 1);
  else if (isPlainObject(current)) delete current[last];
  return document;
}

function deepEqual(left, right) {
  if (left === MISSING || right === MISSING) return left === right;
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((item, index) => deepEqual(item, right[index]));
  }
  if (isPlainObject(left) && isPlainObject(right)) {
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    return leftKeys.length === rightKeys.length && leftKeys.every((key, index) => key === rightKeys[index] && deepEqual(left[key], right[key]));
  }
  return false;
}

function diffValues(before, after, { file, pointer = '' }) {
  if (deepEqual(before, after)) return [];

  // Descend into objects even when one side is absent. Without this, adding a
  // new JSON file containing mapped fields appears as one unmapped change at
  // file# instead of the actual field-level additions.
  if (
    (isPlainObject(before) && isPlainObject(after)) ||
    (before === MISSING && isPlainObject(after)) ||
    (after === MISSING && isPlainObject(before))
  ) {
    const beforeObject = isPlainObject(before) ? before : {};
    const afterObject = isPlainObject(after) ? after : {};
    const changes = [];
    for (const key of [...new Set([...Object.keys(beforeObject), ...Object.keys(afterObject)])].sort()) {
      changes.push(...diffValues(
        Object.prototype.hasOwnProperty.call(beforeObject, key) ? beforeObject[key] : MISSING,
        Object.prototype.hasOwnProperty.call(afterObject, key) ? afterObject[key] : MISSING,
        { file, pointer: joinPointer(pointer, key) },
      ));
    }
    // Empty object versus missing is still a meaningful file/field change.
    if (!changes.length && (before === MISSING || after === MISSING)) {
      return [{
        file,
        pointer,
        before,
        after,
        kind: before === MISSING ? 'add' : 'remove',
      }];
    }
    return changes;
  }
  return [{
    file,
    pointer,
    before,
    after,
    kind: before === MISSING ? 'add' : after === MISSING ? 'remove' : 'replace',
  }];
}

function diffTrees(before, after) {
  const changes = [];
  for (const file of [...new Set([...Object.keys(before || {}), ...Object.keys(after || {})])].sort()) {
    changes.push(...diffValues(
      Object.prototype.hasOwnProperty.call(before || {}, file) ? before[file] : MISSING,
      Object.prototype.hasOwnProperty.call(after || {}, file) ? after[file] : MISSING,
      { file },
    ));
  }
  return changes;
}

function loadTree(root) {
  if (!fs.existsSync(root)) return {};
  const tree = createJsonObject();
  function walk(directory, relative = '') {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(directory, entry.name);
      const rel = relative ? `${relative}/${entry.name}` : entry.name;
      const stat = fs.lstatSync(full);
      if (stat.isSymbolicLink()) throw new A2GError(`Symlinks are not allowed in the canonical tree: ${full}`);
      if (stat.isDirectory()) walk(full, rel);
      else if (stat.isFile() && rel.toLowerCase().endsWith('.json')) {
        tree[validateTreePath(rel)] = readJson(full);
      }
    }
  }
  walk(root);
  return normalizeTree(tree);
}

function writeTree(root, tree, { clear = true } = {}) {
  const normalized = normalizeTree(tree);
  if (clear && fs.existsSync(root)) {
    function clearJson(directory) {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const full = path.join(directory, entry.name);
        const stat = fs.lstatSync(full);
        if (stat.isSymbolicLink()) throw new A2GError(`Symlinks are not allowed in the canonical tree: ${full}`);
        if (stat.isDirectory()) clearJson(full);
        else if (stat.isFile() && entry.name.toLowerCase().endsWith('.json')) fs.unlinkSync(full);
      }
    }
    clearJson(root);
  }
  fs.mkdirSync(root, { recursive: true });
  for (const [relative, value] of Object.entries(normalized)) {
    const destination = path.join(root, ...relative.split('/'));
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, canonicalStringify(value), 'utf8');
  }
}

function cloneJson(value) {
  return canonicalize(value);
}

function serializeChange(change) {
  return { ...change, before: encodePresence(change.before), after: encodePresence(change.after) };
}

module.exports = {
  MISSING,
  isPlainObject,
  canonicalize,
  canonicalStringify,
  canonicalBytes,
  strictJsonParse,
  readJson,
  writeJson,
  encodePresence,
  decodePresence,
  validateTreePath,
  normalizeTree,
  treeHash,
  pointerTokens,
  escapePointerToken,
  joinPointer,
  getPointer,
  setPointer,
  deletePointer,
  deepEqual,
  diffValues,
  diffTrees,
  loadTree,
  writeTree,
  cloneJson,
  createJsonObject,
  setOwn,
  serializeChange,
};
