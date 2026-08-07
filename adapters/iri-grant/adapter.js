'use strict';

const fs = require('fs');
const path = require('path');
const { Adapter, RevisionMismatchError, buildPlan } = require('../../src/index');

// IRI 2026 grant application adapter (конкурс.ири.рф).
//
// Site is split into blocks: application / business-plan / presentation /
// applicant / team. The adapter does NOT dictate how the agent reads or
// writes each block — that is the responsibility of the executing AI
// (Playwright, browseros, chrome-devtools-mcp, raw HTTP, saved fixtures,
// whatever the operator prefers). The adapter describes WHAT to read and
// write, never HOW.
//
// `fetch()` and `apply()` in this minimal implementation read a fixture
// directory `fixtures/<app-id>/` and write to the same directory. A real
// adapter replaces those with browser/SDK calls and pins the plan to the
// portal's revision header.

const ADAPTER_DIR = __dirname;
const FIXTURE_ROOT = path.join(ADAPTER_DIR, 'fixtures');

class IriGrantAdapter extends Adapter {
  constructor(config = {}) {
    super({ ...config, name: 'iri-grant' });
    this.appId = config.appId || process.env.IRI_APP_ID || 'demo';
    this.transport = config.transport || 'fixture'; // 'fixture' | 'http' | 'browser' | …
  }

  describe() {
    return {
      name: 'iri-grant',
      atomicApply: false,
      supportsRevision: true,
      supportsDelete: true,
      supportsAttachments: true,
      supportsTransactions: false,
      supportsPartialUpdate: true,
      blocks: [
        { id: 'application', title: 'Application text', fields: ['title', 'concept', 'relevance', 'expectedResults'] },
        { id: 'business-plan', title: 'Business plan + budget', fields: ['summary', 'items', 'risks'] },
        { id: 'presentation', title: 'Presentation (≤11 slides)', fields: ['pdf', 'pptx'] },
        { id: 'applicant', title: 'Applicant (legal entity)', fields: ['name', 'inn', 'ogrn', 'address'] },
        { id: 'team', title: 'Project team', fields: ['members'] },
      ],
    };
  }

  // Read the current state. In production this would use a transport
  // (browser, API, etc.) configured in the constructor. The fixture
  // transport keeps the adapter testable without a live portal.
  async fetch() {
    if (this.transport === 'fixture') return this._fetchFixture();
    throw new Error(`iri-grant: transport "${this.transport}" is not implemented in this minimal version`);
  }

  async _fetchFixture() {
    const appDir = path.join(FIXTURE_ROOT, String(this.appId));
    if (!fs.existsSync(appDir)) {
      // First-ever fetch: emit an empty tree with a stable revision so the
      // user can start populating it from the CLI.
      return {
        revision: 'fixture-empty-' + Date.now().toString(36),
        fetchedAt: new Date().toISOString(),
        tree: {},
      };
    }
    const tree = {};
    for (const block of fs.readdirSync(appDir)) {
      const blockDir = path.join(appDir, block);
      if (!fs.statSync(blockDir).isDirectory()) continue;
      tree[block] = readDirAsObject(blockDir);
    }
    const stat = fs.statSync(appDir);
    return {
      revision: 'fixture-' + stat.mtimeMs.toString(36),
      fetchedAt: stat.mtime.toISOString(),
      tree,
    };
  }

  async plan(currentRemote, desired) {
    // Use the default JSON-Patch builder. A real adapter may translate to
    // portal-specific operations (PUT /fields, PUT /bp, multipart upload).
    return buildPlan(currentRemote, desired);
  }

  async validate(plan) {
    // Trivial example: forbid empty titles. Real adapter loads
    // schema.json and runs validate() from src/validate.js.
    const errors = [];
    for (const op of plan.operations) {
      if (op.path === '/application/title' && op.op !== 'remove' && (!op.value || String(op.value).trim() === '')) {
        errors.push({ path: op.path, message: 'title must be non-empty' });
      }
    }
    return { ok: errors.length === 0, errors };
  }

  async apply(plan, expectedRevision) {
    if (this.transport === 'fixture') return this._applyFixture(plan, expectedRevision);
    throw new Error(`iri-grant: transport "${this.transport}" is not implemented in this minimal version`);
  }

  async _applyFixture(plan, expectedRevision) {
    const appDir = path.join(FIXTURE_ROOT, String(this.appId));
    fs.mkdirSync(appDir, { recursive: true });
    const current = fs.existsSync(appDir) ? readDirAsObject(appDir) : {};
    const { applyPlan } = require('../../src/index');
    const next = applyPlan(current, plan);
    // Write the tree back to disk, one JSON file per leaf.
    writeObjectToDir(appDir, next);
    return { applied: true, revision: 'fixture-' + Date.now().toString(36), expectedRevision };
  }

  async verify() {
    return this.fetch();
  }
}

function readDirAsObject(dir) {
  const out = {};
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      out[entry] = readDirAsObject(full);
    } else if (stat.isFile()) {
      const txt = fs.readFileSync(full, 'utf8');
      try {
        out[entry] = JSON.parse(txt);
      } catch (_) {
        out[entry] = txt;
      }
    }
  }
  return out;
}

function writeObjectToDir(dir, obj) {
  fs.mkdirSync(dir, { recursive: true });
  // Remove anything not in obj.
  for (const entry of fs.readdirSync(dir)) {
    if (!(entry in obj)) {
      fs.rmSync(path.join(dir, entry), { recursive: true, force: true });
    }
  }
  for (const [k, v] of Object.entries(obj)) {
    const p = path.join(dir, k);
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      writeObjectToDir(p, v);
    } else {
      fs.writeFileSync(p, typeof v === 'string' ? v : JSON.stringify(v, null, 2));
    }
  }
}

module.exports = IriGrantAdapter;
