'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { Anything } = require('../src/index');
const LocalFilesAdapter = require('../adapters/local-files/adapter');

test('local-files: end-to-end fetch → merge → push → verify', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'a2g-e2e-'));
  const dataDir = path.join(tmp, 'a2g-data');
  // Seed the directory with an initial state.
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'count.json'), '0');
  fs.writeFileSync(path.join(dataDir, 'name.txt'), 'first');

  const adapter = new LocalFilesAdapter({ name: 'local-files', dir: dataDir });
  const a2g = new Anything({ adapter, cwd: tmp, workdir: path.join(tmp, '.a2g', 'local-files') });

  a2g.init();
  await a2g.fetch();

  // User edits locally by writing files in the workdir's local copy.
  const localDir = path.join(tmp, '.a2g', 'local-files', 'local');
  fs.mkdirSync(localDir, { recursive: true });
  fs.writeFileSync(path.join(localDir, 'count.json'), '0');
  fs.writeFileSync(path.join(localDir, 'name.txt'), 'first');
  fs.writeFileSync(path.join(localDir, 'extra.json'), '"added"');

  await a2g.merge();
  const pushResult = await a2g.push();
  assertEqual(pushResult.applied, true);

  // Verify that the data dir now matches.
  assertEqual(fs.readFileSync(path.join(dataDir, 'count.json'), 'utf8'), '0');
  assertEqual(fs.readFileSync(path.join(dataDir, 'name.txt'), 'utf8'), 'first');
  assertEqual(fs.readFileSync(path.join(dataDir, 'extra.json'), 'utf8'), 'added');

  fs.rmSync(tmp, { recursive: true, force: true });
});

test('local-files: idempotent — push same desired twice → no diff on second push', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'a2g-e2e-'));
  const dataDir = path.join(tmp, 'a2g-data');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'a.json'), '1');

  const adapter = new LocalFilesAdapter({ name: 'local-files', dir: dataDir });
  const a2g = new Anything({ adapter, cwd: tmp, workdir: path.join(tmp, '.a2g', 'local-files') });

  a2g.init();
  await a2g.fetch();
  await a2g.merge();
  const first = await a2g.push();
  assertEqual(first.plan.operations.length, 0, 'no ops on first push');

  const second = await a2g.push();
  assertEqual(second.plan.operations.length, 0, 'still no ops on second push');

  fs.rmSync(tmp, { recursive: true, force: true });
});
