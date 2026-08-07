'use strict';

// Tiny stderr logger so it never pollutes stdout (which the CLI uses for data).
const LEVELS = { silent: 0, error: 1, warn: 2, info: 3, debug: 4 };

function makeLogger(levelName) {
  const threshold = LEVELS[levelName] ?? LEVELS.info;
  function emit(level, args) {
    if (LEVELS[level] > threshold) return;
    const tag = `[${level}]`;
    const stream = level === 'error' ? process.stderr : process.stderr;
    stream.write(tag + ' ' + args.map(stringify).join(' ') + '\n');
  }
  return {
    error: (...a) => emit('error', a),
    warn: (...a) => emit('warn', a),
    info: (...a) => emit('info', a),
    debug: (...a) => emit('debug', a),
    child: (prefix) => makeChildLogger(prefix, threshold),
  };
}

function makeChildLogger(prefix, threshold) {
  const wrap = (level) => (...args) => {
    if (LEVELS[level] > threshold) return;
    process.stderr.write(`[${level}] [${prefix}] ` + args.map(stringify).join(' ') + '\n');
  };
  return {
    error: wrap('error'),
    warn: wrap('warn'),
    info: wrap('info'),
    debug: wrap('debug'),
  };
}

function stringify(v) {
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v);
  } catch (_) {
    return String(v);
  }
}

module.exports = { makeLogger, LEVELS };
