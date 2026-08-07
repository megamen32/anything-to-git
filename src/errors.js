'use strict';

class A2GError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'A2GError';
  }
}

module.exports = { A2GError };
