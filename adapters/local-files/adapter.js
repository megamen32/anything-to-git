'use strict';

const fs = require('fs');
const path = require('path');
const { Adapter, buildPlan, applyPlan } = require('../../src/index');

// Trivial second adapter: a directory on disk where each file is one
// top-level key in the tree. Exists to prove the core works for a system
// that is not a website.
//
// Usage:
//   a2g init local-files
//   a2g fetch local-files
//   a2g merge local-files
//   a2g push local-files
//
// Configuration:
//   dir: path to the data directory (default: ./a2g-data)
//
// On disk:
//   <dir>/<key>            a file whose name is the tree key
//   JSON values are written via JSON.stringify (and re-parsed on read)
//   String values are written as-is
//   { __binary__: base64 } values are decoded and written as a Buffer
//
// The key naming is the user's responsibility: pick "count.json" for JSON,
// "name.txt" for plain text, etc. The adapter does not append extensions.

class LocalFilesAdapter extends Adapter {
  constructor(config = {}) {
    super({ ...config, name: 'local-files' });
    this.dir = config.dir || process.env.A2G_LOCAL_DIR || path.join(process.cwd(), 'a2g-data');
  }

  describe() {
    return {
      name: 'local-files',
      atomicApply: true,
      supportsRevision: false,
      supportsDelete: true,
      supportsAttachments: false,
      supportsTransactions: false,
      supportsPartialUpdate: true,
      blocks: [{ id: this.dir, title: 'Directory of files', fields: [] }],
    };
  }

  async fetch() {
    if (!fs.existsSync(this.dir)) {
      return { revision: 'absent', fetchedAt: new Date().toISOString(), tree: {} };
    }
    const tree = {};
    let maxMtime = 0;
    for (const entry of fs.readdirSync(this.dir)) {
      const full = path.join(this.dir, entry);
      const stat = fs.statSync(full);
      if (!stat.isFile()) continue;
      maxMtime = Math.max(maxMtime, stat.mtimeMs);
      const buf = fs.readFileSync(full);
      // Try JSON first; fall back to text. This is good enough for a
      // trivial adapter — the user picks the right extension.
      const text = buf.toString('utf8');
      try { tree[entry] = JSON.parse(text); }
      catch (_) { tree[entry] = text; }
    }
    return {
      revision: 'mtime-' + (maxMtime || 0).toString(36),
      fetchedAt: new Date(maxMtime || Date.now()).toISOString(),
      tree,
    };
  }

  async plan(currentRemote, desired) {
    return buildPlan(currentRemote, desired);
  }

  async apply(plan, _expectedRevision) {
    const current = (await this.fetch()).tree;
    const next = applyPlan(current, plan);
    fs.mkdirSync(this.dir, { recursive: true });
    // Wipe and rewrite. The adapter is "atomic enough" for a local fixture.
    for (const f of fs.readdirSync(this.dir)) {
      fs.rmSync(path.join(this.dir, f), { force: true });
    }
    for (const [k, v] of Object.entries(next)) {
      const full = path.join(this.dir, k);
      if (typeof v === 'string') {
        fs.writeFileSync(full, v);
      } else if (v && typeof v === 'object' && v.__binary__) {
        fs.writeFileSync(full, Buffer.from(v.__binary__, 'base64'));
      } else {
        fs.writeFileSync(full, JSON.stringify(v, null, 2));
      }
    }
    return { applied: true, revision: 'mtime-' + Date.now().toString(36) };
  }

  async verify() {
    return this.fetch();
  }
}

module.exports = LocalFilesAdapter;
