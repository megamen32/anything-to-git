'use strict';

const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const { loadTree, readJson, writeJson, writeTree } = require('../src');
const { makeProject, fixture, plain, verificationCapture } = require('./helpers');

test('ambiguous conflict cannot rewrite the worktree and requires every explicit resolution', (t) => {
  const env = makeProject();
  t.after(env.cleanup);
  const { project, repo, adapter } = env;
  const local = loadTree(path.join(repo, 'site'));
  local['application/general.json'].title = 'Locally edited title';
  writeTree(path.join(repo, 'site'), local);
  project.git.commitState({ stateDir: 'site', message: 'Local title edit' });

  const remote = plain(readJson(fixture(adapter, 'capture.base.json')));
  remote.revision = 'grant-rev-conflict';
  remote.values['general.identity.title'].value = 'Title edited on the website';
  const remotePath = path.join(repo, '.a2g', 'capture.conflict.json');
  writeJson(remotePath, remote);
  project.ingestCapture(remotePath);

  const merge = project.merge();
  assert.equal(merge.clean, false);
  assert.equal(merge.conflict_count, 1);
  assert.equal(loadTree(path.join(repo, 'site'))['application/general.json'].title, 'Locally edited title');
  assert.throws(() => project.createPushPlan(), /conflict/i);

  const incomplete = path.join(repo, '.a2g', 'empty-resolutions.json');
  writeJson(incomplete, { resolutions: [] });
  assert.throws(() => project.resolve(incomplete), /Missing explicit resolutions/);

  const resolution = path.join(repo, '.a2g', 'resolutions.json');
  writeJson(resolution, { resolutions: [{
    file: 'application/general.json', pointer: '/title', action: 'set', value: 'User-approved combined title',
  }] });
  const resolved = project.resolve(resolution);
  assert.equal(resolved.worktree_updated, true);
  assert.equal(loadTree(path.join(repo, 'site'))['application/general.json'].title, 'User-approved combined title');
});

test('verification mismatch writes a report and does not advance base', (t) => {
  const env = makeProject();
  t.after(env.cleanup);
  const { project, repo, adapter } = env;
  const baseBefore = project.git.resolve(project.baseRef);
  const local = loadTree(path.join(repo, 'site'));
  local['sections/summary.json'].text = 'Desired new summary.';
  writeTree(path.join(repo, 'site'), local);
  project.git.commitState({ stateDir: 'site', message: 'Edit summary' });
  const plan = project.createPushPlan();
  const failedCapture = verificationCapture(project, fixture(adapter, 'capture.base.json'), plan);
  assert.throws(() => project.verify(failedCapture, { planId: plan.plan_id }), /Verification failed/);
  assert.equal(project.git.resolve(project.baseRef), baseBefore);
  assert.equal(fs.existsSync(path.join(repo, '.a2g', 'reports', `verify-${plan.plan_id}.failed.json`)), true);
  assert.equal(fs.existsSync(path.join(repo, '.a2g', 'pending', `${plan.plan_id}.json`)), true);
});

test('a push plan becomes stale when local HEAD changes', (t) => {
  const env = makeProject();
  t.after(env.cleanup);
  const { project, repo, adapter } = env;
  const local = loadTree(path.join(repo, 'site'));
  local['sections/summary.json'].text = 'First desired summary.';
  writeTree(path.join(repo, 'site'), local);
  project.git.commitState({ stateDir: 'site', message: 'First edit' });
  const plan = project.createPushPlan();
  local['sections/summary.json'].text = 'Second desired summary.';
  writeTree(path.join(repo, 'site'), local);
  project.git.commitState({ stateDir: 'site', message: 'Second edit' });
  assert.throws(() => project.verify(fixture(adapter, 'capture.base.json'), { planId: plan.plan_id }), /Local HEAD changed/);
});

test('a push plan becomes stale when the recorded site revision changes even if content does not', (t) => {
  const env = makeProject();
  t.after(env.cleanup);
  const { project, repo, adapter } = env;
  const local = loadTree(path.join(repo, 'site'));
  local['sections/summary.json'].text = 'Desired new summary.';
  writeTree(path.join(repo, 'site'), local);
  project.git.commitState({ stateDir: 'site', message: 'Edit summary' });
  const plan = project.createPushPlan();
  const capture = plain(readJson(fixture(adapter, 'capture.base.json')));
  capture.revision = 'grant-rev-concurrent';
  const changedRevision = path.join(repo, '.a2g', 'capture.same-tree-new-revision.json');
  writeJson(changedRevision, capture);
  project.ingestCapture(changedRevision);
  assert.throws(() => project.verify(fixture(adapter, 'capture.base.json'), { planId: plan.plan_id }), /site revision changed/i);
});


test('direct local/remote/base conflict actions are executable, not merely documented', (t) => {
  const env = makeProject();
  t.after(env.cleanup);
  const { project, repo, adapter } = env;
  const local = loadTree(path.join(repo, 'site'));
  local['application/general.json'].title = 'Local title';
  writeTree(path.join(repo, 'site'), local);
  project.git.commitState({ stateDir: 'site', message: 'Local title' });

  const remote = plain(readJson(fixture(adapter, 'capture.base.json')));
  remote.revision = 'grant-rev-direct-resolution';
  remote.values['general.identity.title'].value = 'Website title';
  const capturePath = path.join(repo, '.a2g', 'capture.direct-resolution.json');
  writeJson(capturePath, remote);
  project.ingestCapture(capturePath);
  const merge = project.merge();
  assert.equal(merge.clean, false);

  const resolution = path.join(repo, '.a2g', 'direct-resolution.json');
  writeJson(resolution, { resolutions: [{
    file: 'application/general.json', pointer: '/title', action: 'remote',
  }] });
  project.resolve(resolution);
  assert.equal(loadTree(path.join(repo, 'site'))['application/general.json'].title, 'Website title');
});

test('successful verification consumes the pending plan and latest-plan pointer', (t) => {
  const env = makeProject();
  t.after(env.cleanup);
  const { project, repo, adapter } = env;
  const plan = project.createPushPlan();
  const result = project.verify(
    verificationCapture(project, fixture(adapter, 'capture.base.json'), plan),
    { planId: plan.plan_id },
  );
  assert.equal(result.verified, true);
  assert.equal(fs.existsSync(path.join(repo, '.a2g', 'pending', `${plan.plan_id}.json`)), false);
  assert.equal(fs.existsSync(path.join(repo, '.a2g', 'latest-plan.json')), false);
  assert.equal(fs.existsSync(path.join(repo, '.a2g', 'pending', `${plan.plan_id}.verified.json`)), true);
});

test('verification rejects a stale capture without the one-time plan challenge', (t) => {
  const env = makeProject();
  t.after(env.cleanup);
  const { project, adapter } = env;
  const plan = project.createPushPlan();
  assert.throws(
    () => project.verify(fixture(adapter, 'capture.base.json'), { planId: plan.plan_id }),
    /one-time challenge/,
  );
});


test('tampered merge report is rejected before any resolution writes', (t) => {
  const env = makeProject();
  t.after(env.cleanup);
  const { project, repo, adapter } = env;

  const localPath = path.join(repo, 'site', 'sections', 'summary.json');
  const localDoc = readJson(localPath);
  localDoc.text = 'Local summary';
  writeJson(localPath, localDoc);
  project.git.commitState({ stateDir: 'site', message: 'Local edit' });
  const remote = plain(readJson(fixture(adapter, 'capture.base.json')));
  remote.revision = 'grant-rev-tampered-report';
  remote.values['description.summary.text'].value = 'Website summary';
  const remotePath = path.join(repo, '.a2g', 'capture.tampered-report.json');
  writeJson(remotePath, remote);
  project.ingestCapture(remotePath);
  const merged = project.merge();
  const report = readJson(merged.report);
  report.conflicts[0].local = { present: true, value: 'Tampered value' };
  writeJson(merged.report, report);
  const resolutionPath = path.join(repo, '.a2g', 'resolution.json');
  writeJson(resolutionPath, {
    resolutions: [{ file: 'sections/summary.json', pointer: '/text', action: 'local' }],
  });
  assert.throws(() => project.resolve(resolutionPath), /report was modified/);
  assert.equal(readJson(localPath).text, 'Local summary');
});

test('tampered pending desired tree cannot advance Base', (t) => {
  const env = makeProject();
  t.after(env.cleanup);
  const { project, repo, adapter } = env;
  project.createPushPlan();
  const latest = readJson(path.join(repo, '.a2g', 'latest-plan.json'));
  const pendingPath = path.join(repo, '.a2g', 'pending', latest.path);
  const pending = readJson(pendingPath);
  pending.desired_tree['sections/summary.json'].text = 'Tampered desired state';
  writeJson(pendingPath, pending);
  assert.throws(() => project.verificationTemplate(), /Pending push desired state is invalid or was modified/);
});

test('tampered pending operations are rejected before verification execution', (t) => {
  const env = makeProject();
  t.after(env.cleanup);
  const { project, repo } = env;
  project.createPushPlan();
  const latest = readJson(path.join(repo, '.a2g', 'latest-plan.json'));
  const pendingPath = path.join(repo, '.a2g', 'pending', latest.path);
  const pending = readJson(pendingPath);
  pending.plan.operations.push({ injected: true });
  writeJson(pendingPath, pending);
  assert.throws(() => project.verificationTemplate(), /modified or is inconsistent at operations/);
});
