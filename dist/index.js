#!/usr/bin/env node
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _helpers = require('./helpers');

/* istanbul ignore next */
if (!module.parent) {
  require('./cli').default();
}

exports.default = _helpers.createBots;