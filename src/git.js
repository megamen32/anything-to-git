'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { A2GError } = require('./errors');
const {
  canonicalBytes,
  canonicalize,
  createJsonObject,
  isPlainObject,
  loadTree,
  strictJsonParse,
  treeHash,
  validateTreePath,
  writeTree,
} = require('./json');
const { nowIso } = require('./time');

class GitRepo {
  constructor(root) {
    this.root = path.resolve(root);
  }

  run(args, { check = true, env = {}, input = undefined } = {}) {
    const result = spawnSync('git', args, {
      cwd: this.root,
      env: { ...process.env, ...env },
      input,
      encoding: null,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    if (result.error) throw result.error;
    if (check && result.status !== 0) {
      const stderr = Buffer.from(result.stderr || '').toString('utf8').trim();
      const stdout = Buffer.from(result.stdout || '').toString('utf8').trim();
      throw new A2GError(`git ${args.join(' ')} failed: ${stderr || stdout || `exit ${result.status}`}`);
    }
    return {
      status: result.status,
      stdout: Buffer.from(result.stdout || ''),
      stderr: Buffer.from(result.stderr || ''),
    };
  }

  ensure() {
    fs.mkdirSync(this.root, { recursive: true });
    const check = this.run(['rev-parse', '--show-toplevel'], { check: false });
    let ownsRepository = false;
    if (check.status === 0) {
      const reported = check.stdout.toString('utf8').trim();
      try {
        ownsRepository = fs.realpathSync(reported) === fs.realpathSync(this.root);
      } catch {
        ownsRepository = path.resolve(reported) === path.resolve(this.root);
      }
    }
    if (!ownsRepository) {
      const modernInit = this.run(['init', '-q', '-b', 'main'], { check: false });
      if (modernInit.status !== 0) {
        // Git < 2.28 has no `git init -b`. Keep the public branch name stable
        // instead of failing project creation on an otherwise usable Git.
        this.run(['init', '-q']);
        this.run(['symbolic-ref', 'HEAD', 'refs/heads/main']);
      }
    }
  }

  resolve(ref) {
    const result = this.run(['rev-parse', '--verify', '--quiet', ref], { check: false });
    return result.status === 0 ? result.stdout.toString('utf8').trim() : null;
  }

  head() {
    return this.resolve('HEAD');
  }

  static remoteRef(name) {
    return `refs/a2g/remotes/${name}`;
  }

  static baseRef(name) {
    return `refs/a2g/bases/${name}`;
  }

  updateRef(ref, commit) {
    this.run(['update-ref', ref, commit]);
  }

  createSnapshotCommit(tree, { stateDir, message, parentRef = null, metadata = {} }) {
    this.ensure();
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'a2g-index-'));
    try {
      const indexPath = path.join(temp, 'index');
      const env = { GIT_INDEX_FILE: indexPath };
      this.run(['read-tree', '--empty'], { env });
      for (const [relative, value] of Object.entries(tree).sort(([a], [b]) => a.localeCompare(b))) {
        const safeRelative = validateTreePath(relative);
        const blob = this.run(['hash-object', '-w', '--stdin'], { input: canonicalBytes(value) }).stdout.toString('utf8').trim();
        const repoPath = `${stateDir.replace(/\/$/, '')}/${safeRelative}`;
        this.run(['update-index', '--add', '--cacheinfo', '100644', blob, repoPath], { env });
      }
      const snapshotMetadata = canonicalize({
        ...metadata,
        format: 1,
        tree_hash: treeHash(tree),
      });
      const metadataBlob = this.run(['hash-object', '-w', '--stdin'], { input: canonicalBytes(snapshotMetadata) }).stdout.toString('utf8').trim();
      this.run(['update-index', '--add', '--cacheinfo', '100644', metadataBlob, '.a2g-snapshot.json'], { env });

      const treeId = this.run(['write-tree'], { env }).stdout.toString('utf8').trim();
      const args = ['commit-tree', treeId, '-m', message];
      if (parentRef) {
        const parent = this.resolve(parentRef);
        if (parent) args.push('-p', parent);
      }
      const timestamp = nowIso();
      const identity = {
        GIT_AUTHOR_NAME: 'Anything to Git',
        GIT_AUTHOR_EMAIL: 'a2g@localhost',
        GIT_COMMITTER_NAME: 'Anything to Git',
        GIT_COMMITTER_EMAIL: 'a2g@localhost',
        GIT_AUTHOR_DATE: timestamp,
        GIT_COMMITTER_DATE: timestamp,
      };
      return this.run(args, { env: identity }).stdout.toString('utf8').trim();
    } finally {
      fs.rmSync(temp, { recursive: true, force: true });
    }
  }

  readSnapshotMetadata(commit) {
    const result = this.run(['show', `${commit}:.a2g-snapshot.json`], { check: false });
    if (result.status !== 0) throw new A2GError(`Snapshot metadata is missing from commit ${commit}`);
    const metadata = strictJsonParse(result.stdout.toString('utf8'), { source: `snapshot ${commit} metadata` });
    if (!isPlainObject(metadata) || metadata.format !== 1) {
      throw new A2GError(`Unsupported snapshot metadata in commit ${commit}`);
    }
    if (typeof metadata.tree_hash !== 'string' || !/^[0-9a-f]{64}$/.test(metadata.tree_hash)) {
      throw new A2GError(`Snapshot metadata has an invalid tree hash in commit ${commit}`);
    }
    if (typeof metadata.adapter_id !== 'string' || !metadata.adapter_id) {
      throw new A2GError(`Snapshot metadata has no adapter id in commit ${commit}`);
    }
    if (!Number.isInteger(metadata.adapter_version) || metadata.adapter_version < 1) {
      throw new A2GError(`Snapshot metadata has an invalid adapter version in commit ${commit}`);
    }
    if (typeof metadata.revision !== 'string' || !metadata.revision) {
      throw new A2GError(`Snapshot metadata has no remote revision in commit ${commit}`);
    }
    if (metadata.captured_at != null && typeof metadata.captured_at !== 'string') {
      throw new A2GError(`Snapshot metadata has an invalid capture timestamp in commit ${commit}`);
    }
    if (metadata.ingested_at != null && typeof metadata.ingested_at !== 'string') {
      throw new A2GError(`Snapshot metadata has an invalid ingestion timestamp in commit ${commit}`);
    }
    if (metadata.metadata != null && !isPlainObject(metadata.metadata)) {
      throw new A2GError(`Snapshot metadata payload must be an object in commit ${commit}`);
    }
    return metadata;
  }

  readTree(commit, { stateDir }) {
    const prefix = `${stateDir.replace(/\/$/, '')}/`;
    const result = this.run(['ls-tree', '-r', '-z', commit, '--', stateDir]);
    const tree = createJsonObject();
    for (const record of result.stdout.toString('utf8').split('\0')) {
      if (!record) continue;
      const tab = record.indexOf('\t');
      if (tab === -1) throw new A2GError(`Malformed git ls-tree record for ${commit}`);
      const [mode, objectType, objectId] = record.slice(0, tab).split(' ');
      void mode;
      if (objectType !== 'blob') continue;
      const fullPath = record.slice(tab + 1);
      if (!fullPath.startsWith(prefix)) continue;
      const relative = fullPath.slice(prefix.length);
      if (!relative.toLowerCase().endsWith('.json')) continue;
      validateTreePath(relative);
      const content = this.run(['cat-file', '-p', objectId]).stdout.toString('utf8');
      tree[relative] = strictJsonParse(content, { source: `snapshot ${commit}:${fullPath}` });
    }
    return tree;
  }

  headTree({ stateDir }) {
    const head = this.head();
    return head ? this.readTree(head, { stateDir }) : {};
  }

  stateRoot({ stateDir }) {
    const candidate = path.resolve(this.root, stateDir);
    const relative = path.relative(this.root, candidate);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new A2GError(`State directory resolves outside the repository: ${stateDir}`);
    }
    let current = this.root;
    for (const segment of relative.split(path.sep)) {
      current = path.join(current, segment);
      if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) {
        throw new A2GError(`State directory must not traverse a symlink: ${current}`);
      }
    }
    return candidate;
  }

  worktreeTree({ stateDir }) {
    return loadTree(this.stateRoot({ stateDir }));
  }

  writeWorktree(tree, { stateDir }) {
    writeTree(this.stateRoot({ stateDir }), tree);
  }

  stateStatus({ stateDir }) {
    const result = this.run(['status', '--porcelain=v1', '--', stateDir]);
    return result.stdout.toString('utf8').split(/\r?\n/).filter(Boolean);
  }

  stateClean({ stateDir }) {
    return this.stateStatus({ stateDir }).length === 0;
  }

  commitState({ stateDir, message }) {
    this.run(['add', '--', stateDir]);
    const staged = this.run(['diff', '--cached', '--quiet', '--', stateDir], { check: false });
    if (staged.status === 0) {
      const head = this.head();
      if (head) return head;
      throw new A2GError('There is no canonical state to commit');
    }
    if (staged.status !== 1) throw new A2GError('Unable to inspect staged canonical state');

    const identity = {
      GIT_AUTHOR_DATE: nowIso(),
      GIT_COMMITTER_DATE: nowIso(),
    };
    const configuredName = this.run(['config', '--get', 'user.name'], { check: false }).stdout.toString('utf8').trim();
    const configuredEmail = this.run(['config', '--get', 'user.email'], { check: false }).stdout.toString('utf8').trim();
    if (!process.env.GIT_AUTHOR_NAME && !configuredName) identity.GIT_AUTHOR_NAME = 'Anything to Git user';
    if (!process.env.GIT_COMMITTER_NAME && !configuredName) identity.GIT_COMMITTER_NAME = 'Anything to Git user';
    if (!process.env.GIT_AUTHOR_EMAIL && !configuredEmail) identity.GIT_AUTHOR_EMAIL = 'user@localhost';
    if (!process.env.GIT_COMMITTER_EMAIL && !configuredEmail) identity.GIT_COMMITTER_EMAIL = 'user@localhost';
    this.run(['commit', '-m', message, '--', stateDir], { env: identity });
    const head = this.head();
    if (!head) throw new A2GError('Git did not create a commit');
    return head;
  }
}

module.exports = { GitRepo };
