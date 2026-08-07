'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { A2GError } = require('./errors');
const { loadAdapter } = require('./adapter-loader');
const { GitRepo } = require('./git');
const {
  MISSING,
  canonicalize,
  cloneJson,
  decodePresence,
  deepEqual,
  deletePointer,
  diffTrees,
  encodePresence,
  readJson,
  serializeChange,
  setPointer,
  treeHash,
  writeJson,
} = require('./json');
const { mergeTrees } = require('./merge');
const { filenameTimestamp, nowIso } = require('./time');

function validateStateDir(value) {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.includes('\0')) {
    throw new A2GError(`Unsafe state directory: ${JSON.stringify(value)}`);
  }
  const stripped = value.replace(/^\/+|\/+$/g, '');
  const parts = stripped.split('/');
  const safePart = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
  if (!stripped || value.startsWith('/') || parts.some((part) => !safePart.test(part) || part === '.' || part === '..')) {
    throw new A2GError(`Unsafe state directory: ${JSON.stringify(value)}`);
  }
  if (['.git', '.a2g'].includes(parts[0].toLowerCase()) || parts.some((part) => part.toLowerCase().endsWith('.lock') || part.includes('..'))) {
    throw new A2GError(`Reserved or unsafe state directory: ${JSON.stringify(value)}`);
  }
  return stripped;
}

function validateRemoteName(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) {
    throw new A2GError('Remote name may contain only letters, digits, dot, underscore, or hyphen');
  }
  if (value.toLowerCase().endsWith('.lock') || value.includes('..')) throw new A2GError(`Unsafe remote name: ${JSON.stringify(value)}`);
  return value;
}

function relativeIfInside(root, target) {
  const relative = path.relative(root, target);
  if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) return relative.split(path.sep).join('/');
  return target;
}


function pathContains(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function validateAdapterSeparation(root, adapterPath, stateDir) {
  const realRoot = fs.realpathSync(root);
  const realAdapter = fs.realpathSync(adapterPath);
  const statePath = path.resolve(realRoot, stateDir);
  const metadataPath = path.resolve(realRoot, '.a2g');
  const overlaps = (left, right) => pathContains(left, right) || pathContains(right, left);
  if (overlaps(realAdapter, statePath)) {
    throw new A2GError('Adapter directory must not overlap the canonical state directory');
  }
  if (overlaps(realAdapter, metadataPath)) {
    throw new A2GError('Adapter directory must not overlap the .a2g metadata directory');
  }
}

function validatePlanId(value) {
  if (typeof value !== 'string' || !/^plan-[0-9a-f]{12}$/.test(value)) {
    throw new A2GError(`Unsafe or invalid plan id: ${JSON.stringify(value)}`);
  }
  return value;
}

function resolveInside(root, value, label, relativeTo = root) {
  if (typeof value !== 'string' || !value) throw new A2GError(`${label} must be a non-empty path`);
  const resolved = path.isAbsolute(value) ? path.resolve(value) : path.resolve(relativeTo, value);
  const relative = path.relative(root, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new A2GError(`${label} must resolve inside ${root}: ${value}`);
  }
  let current = root;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) {
      throw new A2GError(`${label} must not traverse a symlink: ${current}`);
    }
  }
  return resolved;
}

class Project {
  constructor(root) {
    this.root = path.resolve(root);
    this.meta = path.join(this.root, '.a2g');
    const configPath = path.join(this.meta, 'config.json');
    if (!fs.existsSync(configPath)) throw new A2GError(`Not an Anything to Git project: ${this.root}`);
    const raw = readJson(configPath);
    this.config = {
      adapter_path: String(raw.adapter_path || ''),
      remote_name: validateRemoteName(String(raw.remote_name || 'site')),
      state_dir: validateStateDir(String(raw.state_dir || 'site')),
      format_version: Number(raw.format_version || 1),
    };
    if (this.config.format_version !== 1) throw new A2GError(`Unsupported project format version: ${this.config.format_version}`);
    const adapterPath = path.isAbsolute(this.config.adapter_path)
      ? this.config.adapter_path
      : path.resolve(this.root, this.config.adapter_path);
    validateAdapterSeparation(this.root, adapterPath, this.config.state_dir);
    this.adapter = loadAdapter(adapterPath);
    this.git = new GitRepo(this.root);
    this.git.ensure();
  }

  static initialize(root, { adapterPath, remoteName = 'site', stateDir = 'site' }) {
    const resolvedRoot = path.resolve(root);
    const safeRemote = validateRemoteName(remoteName);
    const safeState = validateStateDir(stateDir);
    const resolvedAdapter = path.resolve(adapterPath);
    loadAdapter(resolvedAdapter);
    fs.mkdirSync(resolvedRoot, { recursive: true });
    new GitRepo(resolvedRoot).ensure();
    validateAdapterSeparation(resolvedRoot, resolvedAdapter, safeState);
    const meta = path.join(resolvedRoot, '.a2g');
    if (fs.existsSync(path.join(meta, 'config.json'))) throw new A2GError(`Anything to Git is already initialized in ${resolvedRoot}`);
    fs.mkdirSync(path.join(meta, 'reports'), { recursive: true });
    fs.mkdirSync(path.join(meta, 'pending'), { recursive: true });
    writeJson(path.join(meta, 'config.json'), {
      adapter_path: relativeIfInside(resolvedRoot, resolvedAdapter),
      remote_name: safeRemote,
      state_dir: safeState,
      format_version: 1,
    });
    const gitignore = path.join(resolvedRoot, '.gitignore');
    const existing = fs.existsSync(gitignore) ? fs.readFileSync(gitignore, 'utf8') : '';
    const lines = existing.split(/\r?\n/);
    if (!lines.includes('.a2g/')) {
      const prefix = existing && !existing.endsWith('\n') ? '\n' : '';
      fs.appendFileSync(gitignore, `${prefix}.a2g/\n`, 'utf8');
    }
    return new Project(resolvedRoot);
  }

  get remoteRef() {
    return GitRepo.remoteRef(this.config.remote_name);
  }

  get baseRef() {
    return GitRepo.baseRef(this.config.remote_name);
  }

  snapshotAt(ref, missingMessage) {
    const commit = this.git.resolve(ref);
    if (!commit) throw new A2GError(missingMessage);
    const snapshotMetadata = this.git.readSnapshotMetadata(commit);
    const tree = this.git.readTree(commit, { stateDir: this.config.state_dir });
    if (snapshotMetadata.tree_hash !== treeHash(tree)) {
      throw new A2GError(`Snapshot tree hash does not match embedded metadata: ${commit}`);
    }
    if (snapshotMetadata.adapter_id !== this.adapter.id) {
      throw new A2GError(`Snapshot ${commit} belongs to adapter ${JSON.stringify(snapshotMetadata.adapter_id)}, expected ${JSON.stringify(this.adapter.id)}`);
    }
    if (Number(snapshotMetadata.adapter_version) !== this.adapter.version) {
      throw new A2GError(`Snapshot ${commit} uses adapter version ${JSON.stringify(snapshotMetadata.adapter_version)}, expected ${this.adapter.version}`);
    }
    return {
      adapter_id: snapshotMetadata.adapter_id,
      adapter_version: snapshotMetadata.adapter_version,
      revision: String(snapshotMetadata.revision),
      captured_at: snapshotMetadata.captured_at || null,
      ingested_at: snapshotMetadata.ingested_at || null,
      metadata: canonicalize(snapshotMetadata.metadata || {}),
      commit,
      tree,
    };
  }

  remoteSnapshot() {
    return this.snapshotAt(
      this.remoteRef,
      'No site snapshot exists. Capture the site and run `a2g fetch` first.',
    );
  }

  baseSnapshot() {
    return this.snapshotAt(
      this.baseRef,
      'No synchronization base exists. Bootstrap the first capture.',
    );
  }

  baseTree() {
    return this.baseSnapshot().tree;
  }

  localTree() {
    const head = this.git.head();
    if (!head) throw new A2GError('The local Git branch has no commits');
    return this.git.readTree(head, { stateDir: this.config.state_dir });
  }

  fetchSpec() {
    return this.adapter.fetchSpec();
  }

  captureTemplate() {
    return this.adapter.captureTemplate();
  }

  pendingPush(planId = null) {
    let pendingPath;
    if (planId == null) {
      const latest = readJson(path.join(this.meta, 'latest-plan.json'));
      planId = validatePlanId(latest.plan_id);
      pendingPath = resolveInside(path.join(this.meta, 'pending'), latest.path, 'Pending plan path');
    } else {
      planId = validatePlanId(planId);
      pendingPath = path.join(this.meta, 'pending', `${planId}.json`);
    }
    const pending = readJson(pendingPath);
    if (!pending || pending.kind !== 'anything-to-git.pending-push' || !pending.plan || pending.plan.plan_id !== planId) {
      throw new A2GError(`Invalid pending push record for ${planId}`);
    }
    return { planId, pendingPath, pending };
  }

  validatePendingPush(loaded) {
    const { planId, pending } = loaded;
    const desired = pending.desired_tree;
    const plan = pending.plan;
    if (!plan || plan.plan_id !== planId) throw new A2GError(`Invalid pending push plan for ${planId}`);
    if (plan.adapter_id !== this.adapter.id || plan.adapter_version !== this.adapter.version) {
      throw new A2GError('The adapter changed after this push plan was created; fetch, merge, and re-plan');
    }
    if (typeof plan.verification_challenge !== 'string' || !/^[0-9a-f]{48}$/.test(plan.verification_challenge)) {
      throw new A2GError(`Pending push ${planId} has no valid verification challenge`);
    }

    const currentLocal = this.localTree();
    if (treeHash(currentLocal) !== plan.desired_hash || this.git.head() !== plan.local_commit) {
      throw new A2GError('Local HEAD changed after this push plan was created; create a new plan');
    }
    if (treeHash(desired) !== plan.desired_hash || !deepEqual(desired, currentLocal)) {
      throw new A2GError('Pending push desired state is invalid or was modified');
    }

    const currentRemote = this.remoteSnapshot();
    if (currentRemote.revision !== plan.expected_remote_revision) {
      throw new A2GError('The site revision changed after this push plan was created; fetch, merge, and re-plan');
    }
    if (treeHash(currentRemote.tree) !== plan.current_remote_hash || currentRemote.commit !== plan.remote_commit) {
      throw new A2GError('The recorded site snapshot changed after this push plan was created; merge and re-plan');
    }
    if (currentRemote.captured_at !== (plan.remote_captured_at || null) || currentRemote.ingested_at !== (plan.remote_ingested_at || null)) {
      throw new A2GError('Pending push observation metadata does not match the recorded site snapshot');
    }

    const expected = this.adapter.planPush(currentRemote.tree, currentLocal, {
      expectedRevision: currentRemote.revision,
    });
    const deterministicKeys = [
      'kind', 'adapter_id', 'adapter_version', 'site', 'expected_remote_revision',
      'current_remote_hash', 'desired_hash', 'operations', 'execution_rules', 'warnings',
    ];
    for (const key of deterministicKeys) {
      if (!deepEqual(plan[key], expected[key])) {
        throw new A2GError(`Pending push plan was modified or is inconsistent at ${key}`);
      }
    }
    return { ...loaded, plan, desired, currentLocal, currentRemote };
  }

  verificationTemplate(planId = null) {
    const loaded = this.validatePendingPush(this.pendingPush(planId));
    return this.adapter.captureTemplate({
      verification: { plan_id: loaded.planId, challenge: loaded.plan.verification_challenge },
    });
  }

  resolveInputPath(value) {
    if (typeof value !== 'string' || !value) throw new A2GError('A non-empty input file path is required');
    return path.isAbsolute(value) ? path.resolve(value) : path.resolve(this.root, value);
  }

  ingestCapture(capturePath, { bootstrap = false } = {}) {
    const capture = readJson(this.resolveInputPath(capturePath));
    const snapshot = this.adapter.normalizeCapture(capture);
    const baseExists = Boolean(this.git.resolve(this.baseRef));
    if (bootstrap) {
      if (baseExists) throw new A2GError('A synchronization base already exists; bootstrap is only for the first capture');
      if (this.git.head() && Object.keys(this.git.headTree({ stateDir: this.config.state_dir })).length) {
        throw new A2GError('Cannot bootstrap over an existing committed site tree');
      }
      const statePath = this.git.stateRoot({ stateDir: this.config.state_dir });
      if (fs.existsSync(statePath)) {
        const worktree = this.git.worktreeTree({ stateDir: this.config.state_dir });
        if (Object.keys(worktree).length && !deepEqual(worktree, snapshot.tree)) {
          throw new A2GError('Cannot bootstrap over existing uncommitted site JSON files');
        }
      }
    }

    const existingRemote = this.git.resolve(this.remoteRef);
    const existingTree = existingRemote ? this.git.readTree(existingRemote, { stateDir: this.config.state_dir }) : null;
    const ingestedAt = nowIso();
    // Preserve every complete observation in the synthetic history. Identical
    // canonical content remains the same tree hash, while the new commit proves
    // that a fresh capture actually occurred.
    const commit = this.git.createSnapshotCommit(snapshot.tree, {
      stateDir: this.config.state_dir,
      message: `Snapshot ${this.config.remote_name} ${snapshot.revision}`,
      parentRef: existingRemote,
      metadata: {
        adapter_id: this.adapter.id,
        adapter_version: this.adapter.version,
        revision: snapshot.revision,
        captured_at: snapshot.captured_at,
        ingested_at: ingestedAt,
        metadata: snapshot.metadata,
      },
    });
    this.git.updateRef(this.remoteRef, commit);

    const result = {
      remote_commit: commit,
      revision: snapshot.revision,
      tree_hash: treeHash(snapshot.tree),
      content_changed: existingTree == null || !deepEqual(existingTree, snapshot.tree),
      observed_at: ingestedAt,
      bootstrapped: false,
    };
    if (bootstrap) {
      this.git.writeWorktree(snapshot.tree, { stateDir: this.config.state_dir });
      const localCommit = this.git.commitState({
        stateDir: this.config.state_dir,
        message: `Bootstrap ${this.config.remote_name} from site`,
      });
      this.git.updateRef(this.baseRef, commit);
      result.bootstrapped = true;
      result.local_commit = localCommit;
    }
    return result;
  }

  status() {
    const remoteCommit = this.git.resolve(this.remoteRef);
    const baseCommit = this.git.resolve(this.baseRef);
    const headCommit = this.git.head();
    const result = {
      adapter: this.adapter.id,
      remote_name: this.config.remote_name,
      state_dir: this.config.state_dir,
      head_commit: headCommit,
      base_commit: baseCommit,
      remote_commit: remoteCommit,
      remote_revision: null,
      worktree_changes: this.git.stateStatus({ stateDir: this.config.state_dir }),
    };
    if (!remoteCommit || !baseCommit || !headCommit) {
      result.state = 'not_bootstrapped';
      return result;
    }
    result.remote_revision = this.remoteSnapshot().revision;
    const base = this.baseSnapshot().tree;
    const local = this.git.readTree(headCommit, { stateDir: this.config.state_dir });
    const remote = this.git.readTree(remoteCommit, { stateDir: this.config.state_dir });
    const preview = mergeTrees(base, local, remote, { policies: this.adapter.mergePolicies() });
    Object.assign(result, {
      state: preview.conflicts.length ? 'conflicted' : 'mergeable',
      base_hash: treeHash(base),
      local_hash: treeHash(local),
      remote_hash: treeHash(remote),
      local_changes: diffTrees(base, local).length,
      remote_changes: diffTrees(base, remote).length,
      conflicts: preview.conflicts.map((conflict) => serializeConflict(conflict, this.adapter)),
      local_contains_remote: preview.conflicts.length === 0 && deepEqual(preview.merged, local),
    });
    if (!result.worktree_changes.length && result.local_hash === result.remote_hash) {
      result.state = result.base_hash === result.local_hash ? 'synced' : 'aligned_unverified';
    }
    return result;
  }

  merge() {
    if (!this.git.stateClean({ stateDir: this.config.state_dir })) {
      throw new A2GError('Commit or discard local site-tree changes before merging');
    }
    const base = this.baseTree();
    const local = this.localTree();
    const remoteSnapshot = this.remoteSnapshot();
    const result = mergeTrees(base, local, remoteSnapshot.tree, { policies: this.adapter.mergePolicies() });
    const reportId = `merge-${filenameTimestamp()}-${crypto.randomUUID().slice(0, 8)}`;
    const reportPath = path.join(this.meta, 'reports', `${reportId}.json`);
    const report = {
      kind: 'anything-to-git.merge-report',
      report_id: reportId,
      created_at: nowIso(),
      base_commit: this.git.resolve(this.baseRef),
      local_commit: this.git.head(),
      remote_commit: this.git.resolve(this.remoteRef),
      base_hash: treeHash(base),
      local_hash: treeHash(local),
      remote_hash: treeHash(remoteSnapshot.tree),
      clean: result.clean,
      candidate: result.merged,
      conflicts: result.conflicts.map((conflict) => serializeConflict(conflict, this.adapter)),
    };
    writeJson(reportPath, report);
    writeJson(path.join(this.meta, 'latest-merge.json'), { report: path.basename(reportPath) });
    if (result.clean) this.git.writeWorktree(result.merged, { stateDir: this.config.state_dir });
    return {
      clean: result.clean,
      report: reportPath,
      conflict_count: result.conflicts.length,
      worktree_updated: result.clean,
    };
  }

  resolve(resolutionPath) {
    if (!this.git.stateClean({ stateDir: this.config.state_dir })) {
      throw new A2GError('Do not apply a conflict report over a dirty canonical worktree');
    }
    const latest = readJson(path.join(this.meta, 'latest-merge.json'));
    const reportPath = resolveInside(path.join(this.meta, 'reports'), latest.report, 'Merge report path');
    const report = readJson(reportPath);
    if (
      report.base_commit !== this.git.resolve(this.baseRef) ||
      report.local_commit !== this.git.head() ||
      report.remote_commit !== this.git.resolve(this.remoteRef)
    ) {
      throw new A2GError('The latest merge report is stale; fetch and merge again');
    }
    const expectedMerge = mergeTrees(this.baseTree(), this.localTree(), this.remoteSnapshot().tree, {
      policies: this.adapter.mergePolicies(),
    });
    const expectedConflicts = expectedMerge.conflicts.map((conflict) => serializeConflict(conflict, this.adapter));
    if (!deepEqual(report.candidate, expectedMerge.merged) || !deepEqual(report.conflicts || [], expectedConflicts)) {
      throw new A2GError('The latest merge report was modified or does not match current Base/Local/Site state');
    }
    const conflicts = expectedConflicts;
    if (!conflicts.length) throw new A2GError('The latest merge report has no conflicts');
    const resolvedResolutionPath = this.resolveInputPath(resolutionPath);
    const resolutionsDoc = readJson(resolvedResolutionPath);
    if (!resolutionsDoc || typeof resolutionsDoc !== 'object' || Array.isArray(resolutionsDoc) || Object.keys(resolutionsDoc).some((key) => key !== 'resolutions')) {
      throw new A2GError("Resolution document must contain only a list named 'resolutions'");
    }
    if (!Array.isArray(resolutionsDoc.resolutions)) throw new A2GError("Resolution document must contain a list named 'resolutions'");
    const byLocation = new Map();
    for (const item of resolutionsDoc.resolutions) {
      if (!item || typeof item !== 'object' || Array.isArray(item) || typeof item.file !== 'string' || !item.file) {
        throw new A2GError("Every resolution must be an object containing string 'file'");
      }
      const unknown = Object.keys(item).filter((key) => !['file', 'pointer', 'action', 'side', 'value'].includes(key));
      if (unknown.length) throw new A2GError(`Resolution contains unsupported keys: ${unknown.sort().join(', ')}`);
      if (item.pointer != null && typeof item.pointer !== 'string') throw new A2GError('Resolution pointer must be a string');
      const location = `${item.file}#${item.pointer || ''}`;
      if (byLocation.has(location)) throw new A2GError(`Duplicate resolution for ${location}`);
      byLocation.set(location, item);
    }
    const conflictLocations = new Set(conflicts.map((item) => `${item.file}#${item.pointer || ''}`));
    const extras = [...byLocation.keys()].filter((location) => !conflictLocations.has(location));
    if (extras.length) throw new A2GError(`Resolution file contains locations that are not conflicts: ${extras.sort().join(', ')}`);

    const candidate = cloneJson(expectedMerge.merged);
    const unresolved = [];
    for (const conflict of conflicts) {
      const location = `${conflict.file}#${conflict.pointer || ''}`;
      const resolution = byLocation.get(location);
      if (!resolution) {
        unresolved.push(location);
        continue;
      }
      const action = resolution.action || 'set';
      const document = Object.prototype.hasOwnProperty.call(candidate, conflict.file) ? candidate[conflict.file] : {};
      let selected = MISSING;
      if (['local', 'remote', 'base'].includes(action)) {
        selected = decodePresence(conflict[action]);
      } else if (action === 'take') {
        const side = resolution.side;
        if (!['local', 'remote', 'base'].includes(side)) {
          throw new A2GError(`Take resolution requires side local, remote, or base: ${location}`);
        }
        selected = decodePresence(conflict[side]);
      } else if (action === 'delete') {
        selected = MISSING;
      } else if (action === 'set') {
        if (!Object.prototype.hasOwnProperty.call(resolution, 'value')) throw new A2GError(`Set resolution requires a value: ${location}`);
        selected = resolution.value;
      } else {
        throw new A2GError(`Unsupported resolution action: ${JSON.stringify(action)}`);
      }

      if (selected === MISSING) {
        const updated = deletePointer(document, conflict.pointer || '');
        if (updated === MISSING) delete candidate[conflict.file];
        else candidate[conflict.file] = updated;
      } else {
        candidate[conflict.file] = setPointer(document, conflict.pointer || '', selected);
      }
    }
    if (unresolved.length) throw new A2GError(`Missing explicit resolutions for: ${unresolved.join(', ')}`);
    const issues = this.adapter.validateTree(candidate);
    const errors = issues.filter((issue) => issue.level === 'error');
    if (errors.length) throw new A2GError(`Resolved tree is invalid: ${errors.map((issue) => issue.message).join('; ')}`);
    this.git.writeWorktree(candidate, { stateDir: this.config.state_dir });
    const resolvedPath = reportPath.replace(/\.json$/, '.resolved.json');
    writeJson(resolvedPath, {
      source_report: reportPath,
      resolution_file: resolvedResolutionPath,
      resolved_at: nowIso(),
      tree_hash: treeHash(candidate),
    });
    return { worktree_updated: true, resolved_report: resolvedPath };
  }

  createPushPlan() {
    if (!this.git.stateClean({ stateDir: this.config.state_dir })) {
      throw new A2GError('Commit local site-tree changes before creating a push plan');
    }
    const base = this.baseTree();
    const local = this.localTree();
    const remoteSnapshot = this.remoteSnapshot();
    const merged = mergeTrees(base, local, remoteSnapshot.tree, { policies: this.adapter.mergePolicies() });
    if (merged.conflicts.length) throw new A2GError('Remote changes still conflict with local changes; resolve them before push');
    if (!deepEqual(merged.merged, local)) throw new A2GError('Local HEAD does not contain the latest site changes; run `a2g merge` and commit');
    const plan = this.adapter.planPush(remoteSnapshot.tree, local, { expectedRevision: remoteSnapshot.revision });
    plan.verification_challenge = crypto.randomBytes(24).toString('hex');
    plan.local_commit = this.git.head();
    plan.remote_commit = remoteSnapshot.commit;
    plan.remote_captured_at = remoteSnapshot.captured_at;
    plan.remote_ingested_at = remoteSnapshot.ingested_at;
    const pending = {
      kind: 'anything-to-git.pending-push',
      plan,
      desired_tree: local,
      created_at: nowIso(),
    };
    const pendingPath = path.join(this.meta, 'pending', `${plan.plan_id}.json`);
    writeJson(pendingPath, pending);
    writeJson(path.join(this.meta, 'latest-plan.json'), {
      plan_id: plan.plan_id,
      path: path.basename(pendingPath),
    });
    return plan;
  }

  verify(capturePath, { planId = null } = {}) {
    const loaded = this.validatePendingPush(this.pendingPush(planId));
    ({ planId } = loaded);
    const { pendingPath, desired, plan } = loaded;

    const actual = this.adapter.normalizeCapture(readJson(this.resolveInputPath(capturePath)));
    if (
      !actual.verification ||
      actual.verification.plan_id !== planId ||
      actual.verification.challenge !== plan.verification_challenge
    ) {
      throw new A2GError('Verification capture does not contain the one-time challenge from this push plan');
    }
    const actualHash = treeHash(actual.tree);
    const desiredHash = treeHash(desired);
    if (actualHash !== desiredHash) {
      const reportPath = path.join(this.meta, 'reports', `verify-${planId}.failed.json`);
      writeJson(reportPath, {
        kind: 'anything-to-git.verification-failure',
        plan_id: planId,
        desired_hash: desiredHash,
        actual_hash: actualHash,
        differences: diffTrees(desired, actual.tree).map(serializeChange),
      });
      throw new A2GError(`Verification failed; site differs from desired state. Report: ${reportPath}`);
    }

    const commit = this.git.createSnapshotCommit(actual.tree, {
      stateDir: this.config.state_dir,
      message: `Verified ${this.config.remote_name} ${actual.revision}`,
      parentRef: this.remoteRef,
      metadata: {
        adapter_id: this.adapter.id,
        adapter_version: this.adapter.version,
        revision: actual.revision,
        captured_at: actual.captured_at,
        ingested_at: nowIso(),
        metadata: actual.metadata,
      },
    });
    this.git.updateRef(this.remoteRef, commit);
    this.git.updateRef(this.baseRef, commit);
    const donePath = pendingPath.replace(/\.json$/, '.verified.json');
    writeJson(donePath, {
      plan_id: planId,
      verified_at: nowIso(),
      remote_commit: commit,
      revision: actual.revision,
      tree_hash: actualHash,
    });
    fs.unlinkSync(pendingPath);
    const latestPlanPath = path.join(this.meta, 'latest-plan.json');
    if (fs.existsSync(latestPlanPath)) {
      const latest = readJson(latestPlanPath);
      if (latest.plan_id === planId) fs.unlinkSync(latestPlanPath);
    }
    return {
      verified: true,
      plan_id: planId,
      remote_commit: commit,
      local_commit: this.git.head(),
      revision: actual.revision,
      tree_hash: actualHash,
    };
  }
}

function serializeConflict(conflict, adapter = null) {
  const description = adapter && typeof adapter.describeLocation === 'function'
    ? adapter.describeLocation(conflict.file, conflict.pointer)
    : { file: conflict.file, pointer: conflict.pointer };
  return {
    ...description,
    file: conflict.file,
    pointer: conflict.pointer,
    base: encodePresence(conflict.base),
    local: encodePresence(conflict.local),
    remote: encodePresence(conflict.remote),
    reason: conflict.reason,
    policy: conflict.policy,
    allowed_resolutions: ['local', 'remote', 'base', 'set', 'delete'],
  };
}

module.exports = {
  Project,
  validateStateDir,
  validateRemoteName,
  serializeConflict,
  validatePlanId,
  resolveInside,
  validateAdapterSeparation,
};
