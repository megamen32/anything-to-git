#!/usr/bin/env node
'use strict';

const { main } = require('../src/cli');

main().then(
  (code) => { process.exitCode = code; },
  (error) => {
    process.stderr.write(`a2g: ${error && error.message ? error.message : String(error)}\n`);
    if (process.env.A2G_DEBUG && error && error.stack) process.stderr.write(`${error.stack}\n`);
    process.exitCode = 2;
  },
);
