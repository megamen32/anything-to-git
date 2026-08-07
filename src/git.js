'use strict';

// Thin Git CLI wrapper. Anything to Git does not depend on any JS Git library;
// it just shells out to the user's `git` binary. This keeps the dependency
// surface to zero and makes the toolchain auditable.

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function runGit(args, options = {}) {
  const cwd = options.cwd || process.cwd();
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...(options.env || {}) },
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(
      `git ${args.join(' ')} failed: ${(result.stderr || result.stdout || '').trim()}`
    );
  }
  return {
    status: result.status,
    stdout: (result.stdout || '').trim(),
    stderr: (result.stderr || '').trim(),
  };
}

function isRepo(dir) {
  try {
    return runGit(['rev-parse', '--git-dir'], { cwd: dir, allowFailure: true }).status === 0;
  } catch (_) {
    return false;
  }
}

function ensureRepo(dir) {
  if (!isRepo(dir)) {
    runGit(['init', '-q', '-b', 'main'], { cwd: dir });
  }
}

function head(cwd) {
  const r = runGit(['rev-parse', 'HEAD'], { cwd, allowFailure: true });
  return r.status === 0 ? r.stdout : null;
}

function status(cwd) {
  return runGit(['status', '--porcelain'], { cwd }).stdout;
}

function addAll(cwd) {
  return runGit(['add', '-A'], { cwd }).stdout;
}

function commit(cwd, message, author) {
  const args = ['commit', '-m', message];
  if (author) {
    args.splice(1, 0, '-c', `user.name=${author.name}`, `-c`, `user.email=${author.email}`);
  }
  return runGit(args, { cwd });
}

function commitTree(cwd, treeSha, message, parent, author) {
  // git commit-tree is the lowest-level commit constructor.
  const env = { GIT_AUTHOR_NAME: author?.name || 'Anything to Git', GIT_AUTHOR_EMAIL: author?.email || 'a2g@local', GIT_COMMITTER_NAME: author?.name || 'Anything to Git', GIT_COMMITTER_EMAIL: author?.email || 'a2g@local' };
  const args = ['commit-tree', treeSha, '-m', message];
  if (parent) args.push('-p', parent);
  return runGit(args, { cwd, env }).stdout;
}

function writeTreeFromDir(cwd) {
  // Materialize a tree object from the working copy (after `git add`).
  return runGit(['write-tree'], { cwd }).stdout;
}

function writeTreeFromIndex(cwd) {
  return runGit(['write-tree'], { cwd }).stdout;
}

function updateRef(cwd, ref, sha) {
  return runGit(['update-ref', ref, sha], { cwd });
}

function readRef(cwd, ref) {
  const r = runGit(['rev-parse', '--verify', '--quiet', ref], { cwd, allowFailure: true });
  return r.status === 0 ? r.stdout : null;
}

function listRefs(cwd, prefix) {
  const r = runGit(['for-each-ref', '--format=%(refname)', prefix || 'refs/'], { cwd, allowFailure: true });
  if (r.status !== 0) return [];
  return r.stdout.split('\n').filter(Boolean);
}

function workdirOf(cwd) {
  const r = runGit(['rev-parse', '--show-toplevel'], { cwd, allowFailure: true });
  return r.status === 0 ? r.stdout : null;
}

module.exports = {
  runGit,
  isRepo,
  ensureRepo,
  head,
  status,
  addAll,
  commit,
  commitTree,
  writeTreeFromDir,
  writeTreeFromIndex,
  updateRef,
  readRef,
  listRefs,
  workdirOf,
};
