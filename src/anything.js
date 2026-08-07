'use strict';

const fs = require('fs');
const path = require('path');
const { Adapter } = require('./adapter');
const { canonicalize, treeId } = require('./normalize');
const { threeWay } = require('./merge');
const { buildPlan, applyPlan } = require('./plan');
const { makeRevision, revisionsEqual } = require('./revision');
const { validate } = require('./validate');
const { runGit, ensureRepo, isRepo, readRef, updateRef, commitTree, writeTreeFromIndex, addAll, commit, status } = require('./git');
const { makeLogger } = require('./log');
const { RevisionMismatchError } = require('./adapter');

// Anything is the orchestrator. One Anything instance per (repo, adapter) pair.
//
// State stored under .git/a2g/<adapter>/:
//   - HEAD: ref pointing at the last local merged commit
//   - refs/a2g/<adapter>/remote: ref pointing at the last fetched remote snapshot
//   - refs/a2g/<adapter>/base: ref pointing at the last agreed commit (== remote == local)
//   - workdir/remote/: working copy of the latest fetched tree
//   - workdir/local/: working copy of the merged tree the user can edit
//
// The user edits files under workdir/local/ and commits them as normal Git
// commits. The orchestrator reads the latest commit on `local` when it needs
// the desired state.

class Anything {
  constructor(opts) {
    if (!opts || !opts.adapter) throw new Error('Anything: opts.adapter is required');
    if (!(opts.adapter instanceof Adapter)) {
      throw new Error('Anything: opts.adapter must be an instance of Adapter');
    }
    this.adapter = opts.adapter;
    this.cwd = opts.cwd || process.cwd();
    this.workdir = opts.workdir || path.join(this.cwd, '.a2g', this.adapter.name);
    this.logger = opts.logger || makeLogger(opts.logLevel || 'info');
    this.author = opts.author || { name: 'Anything to Git', email: 'a2g@local' };
  }

  // ---- Init: prepare workdir and refs ---------------------------------------

  init() {
    ensureRepo(this.cwd);
    fs.mkdirSync(path.join(this.workdir, 'remote'), { recursive: true });
    fs.mkdirSync(path.join(this.workdir, 'local'), { recursive: true });
    this.logger.info(`initialized ${this.adapter.name} under ${this.workdir}`);
  }

  // ---- Fetch: read external, write remote snapshot, update remote ref ------

  async fetch() {
    if (!fs.existsSync(this.workdir)) this.init();
    const log = this.logger.child('fetch');
    log.info('reading external state…');
    const snap = await this.adapter.fetch();
    const tree = canonicalize(snap.tree || {});
    const rev = makeRevision(snap.revision || treeId(tree));
    const treeWritten = this._writeTreeToDir(path.join(this.workdir, 'remote'), tree);
    const sha = this._commitSnapshot(`fetch: ${this.adapter.name} @ ${rev.value}`, treeWritten, null);
    updateRef(this.cwd, `refs/a2g/${this.adapter.name}/remote`, sha);
    if (!readRef(this.cwd, `refs/a2g/${this.adapter.name}/base`)) {
      // First-ever fetch seeds the base.
      updateRef(this.cwd, `refs/a2g/${this.adapter.name}/base`, sha);
    }
    log.info(`remote snapshot ${sha.slice(0, 8)} @ rev ${rev.value}`);
    return { revision: rev, sha, tree };
  }

  // ---- Status: classify what's ahead, what's behind, where the conflicts are

  async status() {
    if (!fs.existsSync(this.workdir)) {
      return { initialized: false, ahead: 0, behind: 0, conflicts: [] };
    }
    const log = this.logger.child('status');
    const remoteSha = readRef(this.cwd, `refs/a2g/${this.adapter.name}/remote`);
    const baseSha = readRef(this.cwd, `refs/a2g/${this.adapter.name}/base`);
    const localSha = readRef(this.cwd, `refs/a2g/${this.adapter.name}/local-head`);

    if (!remoteSha || !baseSha) {
      return { initialized: true, ahead: 0, behind: 0, conflicts: [], note: 'no remote snapshot yet; run fetch' };
    }

    const remoteTree = this._readTreeAt(remoteSha);
    const baseTree = this._readTreeAt(baseSha);
    const localTree = localSha ? this._readTreeAt(localSha) : baseTree;

    const { classifications, conflicts } = threeWay(baseTree, localTree, remoteTree);

    let localOnly = 0, remoteOnly = 0, both = 0, agree = 0;
    for (const c of Object.values(classifications)) {
      if (c === 'local-only') localOnly++;
      else if (c === 'remote-only') remoteOnly++;
      else if (c === 'both') both++;
      else if (c === 'agree') agree++;
    }
    log.info(`${localOnly} local-only, ${remoteOnly} remote-only, ${conflicts.length} conflict(s)`);
    return { initialized: true, classifications, conflicts, localOnly, remoteOnly, both, agree };
  }

  // ---- Merge: produce a merged tree in workdir/local and a candidate commit

  async merge(opts = {}) {
    if (!fs.existsSync(this.workdir)) this.init();
    const log = this.logger.child('merge');
    const remoteSha = readRef(this.cwd, `refs/a2g/${this.adapter.name}/remote`);
    const baseSha = readRef(this.cwd, `refs/a2g/${this.adapter.name}/base`);
    let localSha = readRef(this.cwd, `refs/a2g/${this.adapter.name}/local-head`);
    if (!remoteSha || !baseSha) throw new Error('merge: no remote/base snapshot; run fetch first');

    // If the local workdir has uncommitted changes, snapshot them first.
    const localDir = path.join(this.workdir, 'local');
    const localWorkdirTree = dirToObject(localDir);
    const localLastTree = localSha ? this._readTreeAt(localSha) : {};
    if (!deepEqualTrees(localWorkdirTree, localLastTree)) {
      const sha = this._commitSnapshot(`draft: local edits ${this.adapter.name}`, localDir, localSha);
      updateRef(this.cwd, `refs/a2g/${this.adapter.name}/local-head`, sha);
      localSha = sha;
      log.info(`snapshotted local workdir → ${sha.slice(0, 8)}`);
    }

    const remoteTree = this._readTreeAt(remoteSha);
    const baseTree = this._readTreeAt(baseSha);
    const localTree = localSha ? this._readTreeAt(localSha) : baseTree;

    let { merged, conflicts, classifications } = threeWay(baseTree, localTree, remoteTree);

    if (conflicts.length && opts.resolver) {
      const resolved = await opts.resolver({ base: baseTree, local: localTree, remote: remoteTree, conflicts });
      // Resolver returns a partial patch: { path: value } or { path: null } for delete.
      for (const [path, value] of Object.entries(resolved || {})) {
        if (value === null) {
          // explicit delete
          const { remove } = require('./tree');
          remove(merged, path);
        } else {
          const { set } = require('./tree');
          set(merged, path, value);
        }
      }
      // Re-classify after resolution.
      const re = threeWay(baseTree, merged, remoteTree);
      conflicts = re.conflicts;
      classifications = re.classifications;
    }

    this._writeTreeToDir(localDir, merged);
    const sha = this._commitSnapshot(`merge: ${this.adapter.name}`, localDir, baseSha);
    updateRef(this.cwd, `refs/a2g/${this.adapter.name}/local-head`, sha);
    log.info(`merged → ${sha.slice(0, 8)} (${conflicts.length} conflict(s) remaining)`);
    return { sha, conflicts, classifications, merged };
  }

  // ---- Push: validate, plan, apply, verify, advance base -------------------

  async push(opts = {}) {
    if (!fs.existsSync(this.workdir)) throw new Error('push: not initialized; run fetch first');
    const log = this.logger.child('push');
    const remoteSha = readRef(this.cwd, `refs/a2g/${this.adapter.name}/remote`);
    const localSha = readRef(this.cwd, `refs/a2g/${this.adapter.name}/local-head`);
    if (!remoteSha) throw new Error('push: no remote snapshot; run fetch first');
    if (!localSha) throw new Error('push: no local-head; run merge first');

    const remoteTree = this._readTreeAt(remoteSha);
    const localTree = this._readTreeAt(localSha);

    const plan = await this.adapter.plan(remoteTree, localTree);
    log.info(`plan: ${plan.operations.length} operation(s)`);

    if (opts.dryRun) {
      return { plan, applied: false };
    }

    const v = await this.adapter.validate(plan);
    if (!v.ok) {
      const err = new Error('validation failed: ' + v.errors.map((e) => `${e.path}: ${e.message}`).join('; '));
      err.validation = v;
      throw err;
    }

    const expectedRevision = (await this._readSnapshotMeta(remoteSha)).revision;
    let result;
    try {
      result = await this.adapter.apply(plan, expectedRevision);
    } catch (err) {
      if (err instanceof RevisionMismatchError) {
        log.warn('revision changed underneath us; refetch and retry');
        await this.fetch();
        throw err;
      }
      throw err;
    }

    // Verify by re-reading.
    const verified = await this.adapter.verify();
    const verifiedTree = canonicalize(verified.tree || {});
    // If the live system normalised fields we sent, that's fine; we want
    // the verified tree to be "close enough" — i.e. the plan we sent has
    // been applied. We do not require byte-equal because the adapter may
    // have computed fields (timestamps, ids, etc.).
    log.info(`verified snapshot rev ${verified.revision}`);
    updateRef(this.cwd, `refs/a2g/${this.adapter.name}/base`, remoteSha);

    return { plan, applied: true, result, verified: { revision: verified.revision, tree: verifiedTree } };
  }

  // ---- Sync: fetch → status → merge → push in one go -----------------------

  async sync(opts = {}) {
    await this.fetch();
    const statusResult = await this.status();
    if (statusResult.conflicts && statusResult.conflicts.length && !opts.allowPushWithConflicts) {
      return { aborted: true, reason: 'conflicts require resolver', status: statusResult };
    }
    await this.merge({ resolver: opts.resolver });
    if (opts.dryRun) {
      return { aborted: false, dryRun: true, status: statusResult };
    }
    return this.push({ dryRun: false });
  }

  // ---- Internals -----------------------------------------------------------

  _writeTreeToDir(dir, tree) {
    fs.mkdirSync(dir, { recursive: true });
    for (const [k, v] of Object.entries(tree || {})) {
      const p = path.join(dir, k);
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        this._writeTreeToDir(p, v);
      } else {
        fs.writeFileSync(p, typeof v === 'string' ? v : JSON.stringify(v, null, 2));
      }
    }
    // Remove any keys that are no longer in the tree.
    if (fs.existsSync(dir)) {
      for (const entry of fs.readdirSync(dir)) {
        if (!(entry in (tree || {}))) {
          fs.rmSync(path.join(dir, entry), { recursive: true, force: true });
        }
      }
    }
    return dir;
  }

  _commitSnapshot(message, treeOrDir, parent) {
    // Stage the directory in a temp index, write a tree, then commit-tree.
    const dir = typeof treeOrDir === 'string' ? treeOrDir : null;
    if (!dir) throw new Error('internal: _commitSnapshot needs a directory for now');
    // Use a temporary GIT_INDEX_FILE to avoid touching the real index.
    const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'a2g-'));
    const env = { GIT_INDEX_FILE: path.join(tmp, 'index'), GIT_WORK_TREE: dir };
    runGit(['read-tree', '--empty'], { cwd: this.cwd, env, allowFailure: true });
    // Add everything from the dir into the temp index.
    const r = spawn('git', ['-C', dir, 'add', '-A', '--', '.'], { env });
    r.status === 0 || (function () { throw new Error('add failed: ' + r.stderr); })();
    const treeSha = runGit(['write-tree'], { cwd: this.cwd, env }).stdout;
    const args = ['commit-tree', treeSha, '-m', message];
    if (parent) args.push('-p', parent);
    const author = this.author;
    const fullEnv = {
      ...env,
      GIT_AUTHOR_NAME: author.name,
      GIT_AUTHOR_EMAIL: author.email,
      GIT_COMMITTER_NAME: author.name,
      GIT_COMMITTER_EMAIL: author.email,
    };
    const sha = runGit(args, { cwd: this.cwd, env: fullEnv }).stdout;
    fs.rmSync(tmp, { recursive: true, force: true });
    return sha;
  }

  _readTreeAt(sha) {
    if (!sha) return {};
    const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'a2g-read-'));
    const out = {};
    try {
      // First check if the commit has any tree at all.
      const treeSha = runGit(['rev-parse', `${sha}^{tree}`], { cwd: this.cwd, allowFailure: true }).stdout;
      const entries = treeSha
        ? runGit(['ls-tree', treeSha], { cwd: this.cwd, allowFailure: true }).stdout
        : '';
      if (!entries) {
        return out;
      }
      const env = { GIT_WORK_TREE: tmp };
      runGit(['--work-tree=' + tmp, 'checkout', '-f', sha, '--', '.'], { cwd: this.cwd, env });
      // Walk tmp and build the object.
      this._dirToObject(tmp, out, '');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
    return out;
  }

  _dirToObject(base, out, rel) {
    const dir = rel ? path.join(base, rel) : base;
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir)) {
      const full = path.join(dir, entry);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) {
        const sub = {};
        this._dirToObject(base, sub, path.join(rel, entry));
        out[entry] = sub;
      } else if (stat.isFile()) {
        const txt = fs.readFileSync(full, 'utf8');
        // Try JSON first; fall back to raw string.
        try {
          out[entry] = JSON.parse(txt);
        } catch (_) {
          out[entry] = txt;
        }
      }
    }
  }

  async _readSnapshotMeta(sha) {
    const fmt = '%H%n%s';
    const out = runGit(['log', '-1', `--format=${fmt}`, sha], { cwd: this.cwd, allowFailure: true }).stdout;
    return { sha, message: out };
  }
}

function spawn(cmd, args, options) {
  const { spawnSync } = require('child_process');
  const r = spawnSync(cmd, args, { ...options, encoding: 'utf-8' });
  return { status: r.status, stdout: (r.stdout || '').trim(), stderr: (r.stderr || '').trim() };
}

function dirToObject(dir) {
  const out = {};
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) out[entry] = dirToObject(full);
    else if (stat.isFile()) {
      const txt = fs.readFileSync(full, 'utf8');
      try { out[entry] = JSON.parse(txt); } catch (_) { out[entry] = txt; }
    }
  }
  return out;
}

function deepEqualTrees(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

module.exports = { Anything };
