'use strict';

const assert = require('node:assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const { DEMO, makeTemp } = require('./helpers');
const { Project } = require('../src');

const ROOT = path.resolve(__dirname, '..');
const CLI = path.join(ROOT, 'bin', 'a2g.js');

function run(args, cwd) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', env: { ...process.env, A2G_UTC_OFFSET: '+03:00' } });
}

test('CLI creates an adapter and updates manifest plus fixture id', (t) => {
  const temporary = makeTemp();
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const target = path.join(temporary, 'my-adapter');
  const result = run(['new-adapter', target, '--id', 'my-site'], temporary);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(fs.readFileSync(path.join(target, 'adapter.json'))).id, 'my-site');
  assert.equal(JSON.parse(fs.readFileSync(path.join(target, 'fixtures', 'capture.example.json'))).adapter_id, 'my-site');
});

test('CLI init and fetch-spec work with an explicit repo', (t) => {
  const temporary = makeTemp();
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const repo = path.join(temporary, 'repo');
  fs.mkdirSync(repo);
  const init = run(['--repo', repo, 'init', '--adapter', DEMO, '--remote', 'grant'], repo);
  assert.equal(init.status, 0, init.stderr);
  const spec = run(['--repo', repo, 'fetch-spec'], repo);
  assert.equal(spec.status, 0, spec.stderr);
  const parsed = JSON.parse(spec.stdout);
  assert.equal(parsed.kind, 'anything-to-git.fetch-spec');
  assert.equal(parsed.adapter_id, 'demo-grant-portal');
});

test('CLI resolves project-relative adapter and output paths with --repo', (t) => {
  const temporary = makeTemp();
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const repo = path.join(temporary, 'repo');
  fs.mkdirSync(repo);
  fs.cpSync(DEMO, path.join(repo, 'adapter'), { recursive: true });
  const init = run(['--repo', repo, 'init', '--adapter', 'adapter'], temporary);
  assert.equal(init.status, 0, init.stderr);
  const spec = run(['--repo', repo, 'fetch-spec', '-o', '.a2g/generated/spec.json'], temporary);
  assert.equal(spec.status, 0, spec.stderr);
  assert.equal(fs.existsSync(path.join(repo, '.a2g', 'generated', 'spec.json')), true);
  assert.equal(fs.existsSync(path.join(temporary, '.a2g', 'generated', 'spec.json')), false);
});

test('CLI prefers a repository-relative adapter over a same-named cwd adapter', (t) => {
  const temporary = makeTemp();
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const repo = path.join(temporary, 'repo');
  const outside = path.join(temporary, 'runner');
  fs.mkdirSync(repo);
  fs.mkdirSync(outside);
  fs.cpSync(DEMO, path.join(repo, 'adapter'), { recursive: true });
  fs.cpSync(DEMO, path.join(outside, 'adapter'), { recursive: true });
  const wrongManifest = JSON.parse(fs.readFileSync(path.join(outside, 'adapter', 'adapter.json'), 'utf8'));
  wrongManifest.id = 'wrong-cwd-adapter';
  fs.writeFileSync(path.join(outside, 'adapter', 'adapter.json'), `${JSON.stringify(wrongManifest, null, 2)}\n`);

  const init = run(['--repo', repo, 'init', '--adapter', 'adapter'], outside);
  assert.equal(init.status, 0, init.stderr);
  assert.equal(JSON.parse(init.stdout).adapter, 'demo-grant-portal');
});

test('CLI rejects an unsafe adapter id before creating files', (t) => {
  const temporary = makeTemp();
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const target = path.join(temporary, 'bad-adapter');
  const result = run(['new-adapter', target, '--id', '../bad'], temporary);
  assert.equal(result.status, 2);
  assert.equal(fs.existsSync(target), false);
});

test('CLI reports a missing new-adapter target without a runtime TypeError', (t) => {
  const temporary = makeTemp();
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const result = run(['new-adapter'], temporary);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /target directory is required/i);
  assert.doesNotMatch(result.stderr, /TypeError/);
});

test('CLI emits a plan-bound verification capture template', (t) => {
  const temporary = makeTemp();
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const repo = path.join(temporary, 'repo');
  const adapter = path.join(repo, 'adapter');
  fs.mkdirSync(repo, { recursive: true });
  fs.cpSync(DEMO, adapter, { recursive: true });
  const project = Project.initialize(repo, { adapterPath: adapter, remoteName: 'site', stateDir: 'site' });
  project.ingestCapture(path.join(adapter, 'fixtures', 'capture.base.json'), { bootstrap: true });
  const plan = project.createPushPlan();
  const output = run(['--repo', repo, 'verification-template', '--plan-id', plan.plan_id], temporary);
  assert.equal(output.status, 0, output.stderr);
  const template = JSON.parse(output.stdout);
  assert.equal(template.verification.plan_id, plan.plan_id);
  assert.equal(template.verification.challenge, plan.verification_challenge);
});

test('CLI lists bundled adapters and reports version', () => {
  const adapters = run(['adapters'], ROOT);
  assert.equal(adapters.status, 0, adapters.stderr);
  assert.deepEqual(JSON.parse(adapters.stdout).adapters, ['demo-grant-portal']);
  const version = run(['--version'], ROOT);
  assert.match(version.stdout, /^0\.2\.0\n$/);
});

test('CLI fails clearly on unknown commands', (t) => {
  const temporary = makeTemp();
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const result = run(['wat'], temporary);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Not an Anything to Git project|Unknown command/);
});


test('new-adapter resolves a relative target under --repo', (t) => {
  const temporary = makeTemp();
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const repo = path.join(temporary, 'repo');
  fs.mkdirSync(repo);
  const result = run(['--repo', repo, 'new-adapter', 'adapters/repo-site', '--id', 'repo-site'], temporary);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(path.join(repo, 'adapters', 'repo-site', 'adapter.json')), true);
});
