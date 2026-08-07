#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const { Anything, Adapter, makeLogger } = require(path.join(SRC, 'index'));

const ADAPTERS_DIR = path.join(ROOT, 'adapters');

function usage() {
  process.stderr.write(`a2g — Anything to Git CLI

Usage:
  a2g init <adapter>
  a2g fetch <adapter>
  a2g status <adapter>
  a2g merge <adapter> [--allow-conflicts]
  a2g push <adapter> [--dry-run]
  a2g sync <adapter> [--dry-run] [--allow-conflicts]
  a2g verify <adapter>
  a2g adapters                # list bundled adapters

<adapter> is the adapter name (e.g. iri-grant, local-files).

Environment:
  A2G_LOG    silent|error|warn|info|debug  (default: info)
`);
  process.exit(2);
}

function loadAdapter(name) {
  const dir = path.join(ADAPTERS_DIR, name);
  if (!fs.existsSync(dir)) {
    process.stderr.write(`error: adapter "${name}" not found in ${ADAPTERS_DIR}\n`);
    process.exit(3);
  }
  const entry = require(path.join(dir, 'adapter.js'));
  return entry;
}

function getArg(name) {
  const i = process.argv.indexOf(name);
  return i === -1 ? null : process.argv[i + 1];
}

function hasFlag(name) {
  return process.argv.includes(name);
}

async function main() {
  const [cmd, adapterName, ...rest] = process.argv.slice(2);
  if (!cmd || cmd === '-h' || cmd === '--help') usage();

  const log = makeLogger(process.env.A2G_LOG || 'info');

  if (cmd === 'adapters') {
    const names = fs.readdirSync(ADAPTERS_DIR).filter((d) => fs.existsSync(path.join(ADAPTERS_DIR, d, 'adapter.js')));
    process.stdout.write(names.join('\n') + '\n');
    return;
  }

  if (!adapterName) usage();
  const AdapterClass = loadAdapter(adapterName);
  const adapter = new AdapterClass({ name: adapterName });
  const a2g = new Anything({ adapter, logLevel: process.env.A2G_LOG || 'info' });

  switch (cmd) {
    case 'init':
      a2g.init();
      return;
    case 'fetch':
      await a2g.fetch();
      return;
    case 'status': {
      const s = await a2g.status();
      process.stdout.write(JSON.stringify(s, null, 2) + '\n');
      return;
    }
    case 'merge': {
      const m = await a2g.merge({ allowConflicts: hasFlag('--allow-conflicts') });
      process.stdout.write(JSON.stringify({ sha: m.sha, conflicts: m.conflicts, classifications: m.classifications }, null, 2) + '\n');
      return;
    }
    case 'push': {
      const dry = hasFlag('--dry-run');
      const r = await a2g.push({ dryRun: dry });
      process.stdout.write(JSON.stringify(r, null, 2) + '\n');
      return;
    }
    case 'sync': {
      const dry = hasFlag('--dry-run');
      const allow = hasFlag('--allow-conflicts');
      const r = await a2g.sync({ dryRun: dry, allowPushWithConflicts: allow });
      process.stdout.write(JSON.stringify(r, null, 2) + '\n');
      return;
    }
    case 'verify': {
      const snap = await a2g.adapter.verify();
      process.stdout.write(JSON.stringify({ revision: snap.revision, fetchedAt: snap.fetchedAt }, null, 2) + '\n');
      return;
    }
    default:
      process.stderr.write(`error: unknown command "${cmd}"\n`);
      usage();
  }
}

main().catch((err) => {
  process.stderr.write('error: ' + (err.stack || err.message || err) + '\n');
  process.exit(1);
});
