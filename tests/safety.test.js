'use strict';

const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const test = require('node:test');
const { DeclarativeSiteAdapter, Project, writeJson, writeTree } = require('../src');
const { DEMO, makeProject, makeTemp } = require('./helpers');

test('state directory cannot escape or target metadata', (t) => {
  const roots = [];
  t.after(() => roots.forEach((root) => fs.rmSync(root, { recursive: true, force: true })));
  for (const value of ['../outside', '/absolute', '.', '.git', '.GIT', '.a2g', '.A2G', 'a/../../b', ':(glob)', '-bad', 'has space', 'state.LOCK']) {
    const root = makeTemp(); roots.push(root);
    assert.throws(() => Project.initialize(path.join(root, 'repo'), { adapterPath: DEMO, remoteName: 'site', stateDir: value }), undefined, value);
  }
});

test('initializing inside a parent Git repository creates an independent child repository', (t) => {
  const temporary = makeTemp();
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  spawnSync('git', ['init', '-q'], { cwd: temporary, check: true });
  const child = path.join(temporary, 'child');
  Project.initialize(child, { adapterPath: DEMO, remoteName: 'site', stateDir: 'site' });
  assert.equal(fs.existsSync(path.join(child, '.git')), true);
  const top = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: child, encoding: 'utf8' });
  // Use realpathSync to canonicalize both sides — on macOS /var is a symlink
  // to /private/var, and os.tmpdir() returns the un-prefixed form while
  // git --show-toplevel returns the realpath, so plain path.resolve is
  // not enough to compare them.
  assert.equal(fs.realpathSync(top.stdout.trim()), fs.realpathSync(child));
});

test('tampered metadata pointers cannot escape their private directories', (t) => {
  const env = makeProject();
  t.after(env.cleanup);
  const { project, repo, adapter } = env;
  writeJson(path.join(repo, '.a2g', 'latest-merge.json'), { report: '../config.json' });
  const resolution = path.join(repo, '.a2g', 'resolution.json');
  writeJson(resolution, { resolutions: [] });
  assert.throws(() => project.resolve(resolution), /must resolve inside/);

  writeJson(path.join(repo, '.a2g', 'latest-plan.json'), {
    plan_id: 'plan-0123456789ab', path: '../config.json',
  });
  assert.throws(() => project.verify(path.join(adapter, 'fixtures', 'capture.base.json')), /must resolve inside/);
});

test('Base ref must point to a validated synthetic snapshot', (t) => {
  const env = makeProject();
  t.after(env.cleanup);
  const { project } = env;
  project.git.updateRef(project.baseRef, project.git.head());
  assert.throws(() => project.status(), /Snapshot metadata is missing/);
});

test('remote name is safe for private Git refs', (t) => {
  const roots = [];
  t.after(() => roots.forEach((root) => fs.rmSync(root, { recursive: true, force: true })));
  for (const value of ['site/evil', 'a..b', 'x.lock', 'x.LOCK', '@bad', '-bad']) {
    const root = makeTemp(); roots.push(root);
    assert.throws(() => Project.initialize(path.join(root, 'repo'), { adapterPath: DEMO, remoteName: value, stateDir: 'site' }), undefined, value);
  }
});

test('state directory may not traverse a symlink', { skip: process.platform === 'win32' }, (t) => {
  const temporary = makeTemp();
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const repo = path.join(temporary, 'repo');
  const outside = path.join(temporary, 'outside');
  fs.mkdirSync(outside);
  const project = Project.initialize(repo, { adapterPath: DEMO, remoteName: 'site', stateDir: 'site' });
  fs.symlinkSync(outside, path.join(repo, 'site'), 'dir');
  assert.throws(() => project.ingestCapture(path.join(DEMO, 'fixtures', 'capture.base.json'), { bootstrap: true }), /symlink/i);
});

test('adapter id is safe for project metadata and refs', (t) => {
  const temporary = makeTemp();
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  fs.cpSync(DEMO, path.join(temporary, 'adapter'), { recursive: true });
  const manifest = path.join(temporary, 'adapter', 'adapter.json');
  const doc = JSON.parse(fs.readFileSync(manifest, 'utf8'));
  doc.id = '../evil';
  fs.writeFileSync(manifest, JSON.stringify(doc));
  assert.throws(() => new DeclarativeSiteAdapter(path.dirname(manifest)), /Unsafe/);
});

test('writeTree rejects traversal and leaves files outside untouched', (t) => {
  const temporary = makeTemp();
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const outside = path.join(temporary, 'outside.json');
  fs.writeFileSync(outside, '{"safe":true}');
  assert.throws(() => writeTree(path.join(temporary, 'site'), { '../outside.json': { safe: false } }), /Unsafe/);
  assert.equal(fs.readFileSync(outside, 'utf8'), '{"safe":true}');
});


test('adapter directory cannot overlap canonical state or private metadata', (t) => {
  const temporary = makeTemp();
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));

  const stateAdapter = path.join(temporary, 'project-state', 'site', 'adapter');
  fs.mkdirSync(stateAdapter, { recursive: true });
  fs.cpSync(DEMO, stateAdapter, { recursive: true });
  assert.throws(
    () => Project.initialize(path.join(temporary, 'project-state'), {
      adapterPath: stateAdapter,
      remoteName: 'site',
      stateDir: 'site',
    }),
    /must not overlap the canonical state directory/,
  );

  const metadataAdapter = path.join(temporary, 'project-meta', '.a2g', 'adapter');
  fs.mkdirSync(metadataAdapter, { recursive: true });
  fs.cpSync(DEMO, metadataAdapter, { recursive: true });
  assert.throws(
    () => Project.initialize(path.join(temporary, 'project-meta'), {
      adapterPath: metadataAdapter,
      remoteName: 'site',
      stateDir: 'site',
    }),
    /must not overlap the \.a2g metadata directory/,
  );
});
