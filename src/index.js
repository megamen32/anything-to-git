'use strict';

const { Anything } = require('./anything');
const { Adapter, RevisionMismatchError } = require('./adapter');
const { canonicalize, stringify, treeId } = require('./normalize');
const { threeWay, deepJoinObjects } = require('./merge');
const { buildPlan, applyPlan } = require('./plan');
const { validate } = require('./validate');
const { makeRevision, revisionsEqual } = require('./revision');
const { makeLogger } = require('./log');
const tree = require('./tree');

module.exports = {
  Anything,
  Adapter,
  RevisionMismatchError,
  canonicalize,
  stringify,
  treeId,
  threeWay,
  deepJoinObjects,
  buildPlan,
  applyPlan,
  validate,
  makeRevision,
  revisionsEqual,
  makeLogger,
  tree,
};
