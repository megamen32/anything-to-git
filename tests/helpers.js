'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { Project, readJson, writeJson } = require('../src');

const ROOT = path.resolve(__dirname, '..');
const DEMO = path.join(ROOT, 'adapters', 'demo-grant-portal');

function makeTemp(prefix = 'a2g-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function copyDemo(repo) {
  const destination = path.join(repo, 'adapters', 'demo');
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.cpSync(DEMO, destination, { recursive: true });
  return destination;
}

function makeProject({ bootstrap = true } = {}) {
  const temporary = makeTemp();
  const repo = path.join(temporary, 'repo');
  const adapter = copyDemo(repo);
  const project = Project.initialize(repo, {
    adapterPath: adapter,
    remoteName: 'grant',
    stateDir: 'site',
  });
  if (bootstrap) project.ingestCapture(path.join(adapter, 'fixtures', 'capture.base.json'), { bootstrap: true });
  return {
    temporary,
    repo,
    adapter,
    project,
    cleanup() { fs.rmSync(temporary, { recursive: true, force: true }); },
  };
}

function fixture(adapter, name) {
  return path.join(adapter, 'fixtures', name);
}

function modifiedCapture(adapter, name, mutate, destination) {
  const capture = plain(readJson(fixture(adapter, name)));
  mutate(capture);
  writeJson(destination, capture);
  return destination;
}

function verificationCapture(project, source, plan, destination = null) {
  const capture = plain(readJson(source));
  capture.verification = plain(project.verificationTemplate(plan.plan_id).verification);
  const target = destination || path.join(project.meta, `verification-${plan.plan_id}.json`);
  writeJson(target, capture);
  return target;
}

module.exports = { ROOT, DEMO, makeTemp, plain, copyDemo, makeProject, fixture, modifiedCapture, verificationCapture };
