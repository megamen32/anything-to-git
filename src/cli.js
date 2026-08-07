'use strict';

const fs = require('fs');
const path = require('path');
const { A2GError } = require('./errors');
const { canonicalStringify, readJson, writeJson } = require('./json');
const { Project } = require('./project');

const PACKAGE_ROOT = path.resolve(__dirname, '..');
const ADAPTERS_ROOT = path.join(PACKAGE_ROOT, 'adapters');
const PACKAGE = readJson(path.join(PACKAGE_ROOT, 'package.json'));

function usage() {
  return `a2g — deterministic website ↔ Git synchronization

Usage:
  a2g init <adapter-or-path> [--remote site] [--state-dir site]
  a2g new-adapter <target> --id <adapter-id>
  a2g fetch-spec [-o file]
  a2g capture-template [-o file]
  a2g verification-template [-o file] [--plan-id id]
  a2g fetch --capture file [--bootstrap]
  a2g status
  a2g merge
  a2g resolve --file resolutions.json
  a2g push-plan [-o file]
  a2g verify --capture file [--plan-id id]
  a2g adapters

Global:
  --repo <path>     project repository (default: current directory)
  --version
  -h, --help

The core never chooses BrowserOS, Playwright, Chrome MCP, or another browser.
An agent uses fetch-spec and push-plan with whichever browser transport it has.
`;
}

function removeOption(args, names) {
  for (const name of names) {
    const index = args.indexOf(name);
    if (index !== -1) {
      if (index + 1 >= args.length) throw new A2GError(`Missing value for ${name}`);
      const value = args[index + 1];
      args.splice(index, 2);
      return value;
    }
  }
  return null;
}

function removeFlag(args, names) {
  for (const name of names) {
    const index = args.indexOf(name);
    if (index !== -1) {
      args.splice(index, 1);
      return true;
    }
  }
  return false;
}

function emit(value, output = null, baseDir = process.cwd()) {
  const text = canonicalStringify(value);
  if (output) {
    const destination = path.isAbsolute(output) ? path.resolve(output) : path.resolve(baseDir, output);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, text, 'utf8');
    process.stdout.write(`${destination}\n`);
  } else {
    process.stdout.write(text);
  }
}

function resolveAdapter(value, baseDir = process.cwd()) {
  if (!value) throw new A2GError('An adapter name or path is required');
  const candidates = path.isAbsolute(value)
    ? [path.resolve(value)]
    : [...new Set([path.resolve(baseDir, value), path.resolve(value)])];
  for (const direct of candidates) {
    if (fs.existsSync(path.join(direct, 'adapter.json'))) return direct;
  }
  const bundled = path.join(ADAPTERS_ROOT, value);
  if (fs.existsSync(path.join(bundled, 'adapter.json'))) return bundled;
  throw new A2GError(`Adapter not found: ${value}`);
}

function listAdapters() {
  if (!fs.existsSync(ADAPTERS_ROOT)) return [];
  return fs.readdirSync(ADAPTERS_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('_') && fs.existsSync(path.join(ADAPTERS_ROOT, entry.name, 'adapter.json')))
    .map((entry) => entry.name)
    .sort();
}

function createAdapter(target, id, baseDir = process.cwd()) {
  if (typeof target !== 'string' || !target) throw new A2GError('A target directory is required');
  if (!id) throw new A2GError('--id is required');
  if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id) || id.toLowerCase().endsWith('.lock') || id.includes('..')) {
    throw new A2GError(`Unsafe adapter id: ${JSON.stringify(id)}`);
  }
  const destination = path.isAbsolute(target) ? path.resolve(target) : path.resolve(baseDir, target);
  if (fs.existsSync(destination)) throw new A2GError(`Target already exists: ${destination}`);
  const template = path.join(ADAPTERS_ROOT, '_template');
  if (!fs.existsSync(template)) throw new A2GError('Bundled adapter template is unavailable');
  fs.cpSync(template, destination, { recursive: true, errorOnExist: true });
  const manifestPath = path.join(destination, 'adapter.json');
  const manifest = readJson(manifestPath);
  manifest.id = id;
  writeJson(manifestPath, manifest);
  const fixturePath = path.join(destination, 'fixtures', 'capture.example.json');
  if (fs.existsSync(fixturePath)) {
    const fixture = readJson(fixturePath);
    fixture.adapter_id = id;
    writeJson(fixturePath, fixture);
  }
  return { created: destination, adapter_id: id };
}

function assertNoArgs(args) {
  if (args.length) throw new A2GError(`Unexpected arguments: ${args.join(' ')}`);
}

async function main(argv = process.argv.slice(2)) {
  const args = [...argv];
  if (removeFlag(args, ['--version'])) {
    process.stdout.write(`${PACKAGE.version}\n`);
    return 0;
  }
  if (!args.length || removeFlag(args, ['-h', '--help'])) {
    process.stdout.write(usage());
    return 0;
  }

  const repo = path.resolve(removeOption(args, ['--repo']) || '.');
  const command = args.shift();

  if (command === 'adapters') {
    assertNoArgs(args);
    emit({ adapters: listAdapters() });
    return 0;
  }
  if (command === 'new-adapter') {
    const target = args.shift();
    const id = removeOption(args, ['--id']);
    assertNoArgs(args);
    emit(createAdapter(target, id, repo));
    return 0;
  }
  if (command === 'init') {
    const adapterValue = removeOption(args, ['--adapter']) || args.shift();
    const remoteName = removeOption(args, ['--remote']) || 'site';
    const stateDir = removeOption(args, ['--state-dir']) || 'site';
    assertNoArgs(args);
    const project = Project.initialize(repo, {
      adapterPath: resolveAdapter(adapterValue, repo),
      remoteName,
      stateDir,
    });
    emit({ initialized: project.root, config: project.config, adapter: project.adapter.id });
    return 0;
  }

  const project = new Project(repo);
  if (command === 'fetch-spec') {
    const output = removeOption(args, ['-o', '--output']);
    assertNoArgs(args);
    emit(project.fetchSpec(), output, project.root);
  } else if (command === 'capture-template') {
    const output = removeOption(args, ['-o', '--output']);
    assertNoArgs(args);
    emit(project.captureTemplate(), output, project.root);
  } else if (command === 'verification-template') {
    const output = removeOption(args, ['-o', '--output']);
    const planId = removeOption(args, ['--plan-id']);
    assertNoArgs(args);
    emit(project.verificationTemplate(planId), output, project.root);
  } else if (command === 'fetch') {
    const capture = removeOption(args, ['--capture']);
    const bootstrap = removeFlag(args, ['--bootstrap']);
    assertNoArgs(args);
    if (!capture) throw new A2GError('--capture is required');
    emit(project.ingestCapture(capture, { bootstrap }));
  } else if (command === 'status') {
    assertNoArgs(args);
    emit(project.status());
  } else if (command === 'merge') {
    assertNoArgs(args);
    emit(project.merge());
  } else if (command === 'resolve') {
    const file = removeOption(args, ['--file']);
    assertNoArgs(args);
    if (!file) throw new A2GError('--file is required');
    emit(project.resolve(file));
  } else if (command === 'push-plan') {
    const output = removeOption(args, ['-o', '--output']);
    assertNoArgs(args);
    emit(project.createPushPlan(), output, project.root);
  } else if (command === 'verify') {
    const capture = removeOption(args, ['--capture']);
    const planId = removeOption(args, ['--plan-id']);
    assertNoArgs(args);
    if (!capture) throw new A2GError('--capture is required');
    emit(project.verify(capture, { planId }));
  } else {
    throw new A2GError(`Unknown command: ${command}`);
  }
  return 0;
}

module.exports = { main, usage, emit, resolveAdapter, listAdapters, createAdapter };
