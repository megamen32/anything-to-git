'use strict';

const assert = require('node:assert');
const path = require('path');
const test = require('node:test');
const { loadTree, treeHash, writeTree } = require('../src');
const { makeProject, fixture, verificationCapture } = require('./helpers');

test('bootstrap, merge, plan, and full verification round-trip', (t) => {
  const env = makeProject();
  t.after(env.cleanup);
  const { project, repo, adapter } = env;
  assert.equal(project.status().state, 'synced');

  const local = loadTree(path.join(repo, 'site'));
  local['sections/summary.json'].text = 'Summary rewritten locally.';
  local['budget/summary.json'].total = 1200000;
  writeTree(path.join(repo, 'site'), local);
  project.git.commitState({ stateDir: 'site', message: 'Local grant edits' });

  project.ingestCapture(fixture(adapter, 'capture.remote-changed.json'));
  const status = project.status();
  assert.equal(status.state, 'mergeable');
  assert.equal(status.local_changes, 2);
  assert.equal(status.remote_changes, 2);

  const merge = project.merge();
  assert.equal(merge.clean, true);
  const merged = loadTree(path.join(repo, 'site'));
  assert.equal(merged['application/general.json'].title, 'Molecular iron complexes');
  assert.equal(merged['sections/relevance.json'].text, 'Relevance edited by the user on the website.');
  assert.equal(merged['sections/summary.json'].text, 'Summary rewritten locally.');
  project.git.commitState({ stateDir: 'site', message: 'Merge latest website changes' });

  const plan = project.createPushPlan();
  assert.equal(plan.expected_remote_revision, 'grant-rev-002');
  assert.equal(plan.operations.length, 2);
  assert.deepEqual(new Set(plan.operations.map((op) => `${op.page_id}.${op.field_id}`)), new Set(['description.text', 'budget.total']));
  assert.ok(plan.local_commit);
  assert.ok(plan.remote_commit);

  const verification = project.verify(
    verificationCapture(project, fixture(adapter, 'capture.after-push.json'), plan),
    { planId: plan.plan_id },
  );
  assert.equal(verification.verified, true);
  assert.equal(verification.revision, 'grant-rev-003');
  assert.equal(project.status().state, 'synced');
  assert.equal(project.git.resolve(project.baseRef), project.git.resolve(project.remoteRef));
});

test('fetching identical content updates revision without fabricating a canonical content change', (t) => {
  const env = makeProject();
  t.after(env.cleanup);
  const { project, adapter, repo } = env;
  const before = project.git.resolve(project.remoteRef);
  const beforeTree = project.git.readTree(before, { stateDir: 'site' });
  const beforeMetadata = project.git.readSnapshotMetadata(before);
  assert.equal(beforeMetadata.adapter_id, 'demo-grant-portal');
  assert.equal(beforeMetadata.adapter_version, 1);
  assert.equal(beforeMetadata.revision, 'grant-rev-001');
  const beforeHash = treeHash(beforeTree);
  const capturePath = path.join(repo, '.a2g', 'same-new-revision.json');
  const capture = require('../src').readJson(fixture(adapter, 'capture.base.json'));
  capture.revision = 'grant-rev-same-content';
  require('../src').writeJson(capturePath, capture);
  const result = project.ingestCapture(capturePath);
  assert.notEqual(result.remote_commit, before);
  assert.equal(result.tree_hash, beforeHash);
  assert.equal(treeHash(project.remoteSnapshot().tree), beforeHash);
  assert.deepEqual(project.git.readTree(before, { stateDir: 'site' }), project.remoteSnapshot().tree);
  assert.equal(project.remoteSnapshot().revision, 'grant-rev-same-content');
  assert.equal(project.git.readSnapshotMetadata(result.remote_commit).tree_hash, beforeHash);
});


test('every complete capture records a fresh observation even when content and revision are identical', (t) => {
  const env = makeProject();
  t.after(env.cleanup);
  const { project, adapter } = env;
  const before = project.git.resolve(project.remoteRef);
  const beforeHash = treeHash(project.remoteSnapshot().tree);
  const result = project.ingestCapture(fixture(adapter, 'capture.base.json'));
  assert.notEqual(result.remote_commit, before);
  assert.equal(result.content_changed, false);
  assert.equal(result.tree_hash, beforeHash);
  assert.ok(result.observed_at);
  assert.equal(project.remoteSnapshot().ingested_at, result.observed_at);
});
