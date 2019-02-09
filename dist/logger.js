'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _winston = require('winston');

var _winston2 = _interopRequireDefault(_winston);

var _util = require('util');

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function formatter(info) {
  const stringifiedRest = (0, _util.inspect)(Object.assign({}, info, {
    level: undefined,
    message: undefined,
    splat: undefined
  }), { depth: null });

  const padding = info.padding && info.padding[info.level] || '';
  if (stringifiedRest !== '{}') {
    return `${info.timestamp} ${info.level}:${padding} ${info.message} ${stringifiedRest}`;
  }

  return `${info.timestamp} ${info.level}:${padding} ${info.message}`;
}

const logger = _winston2.default.createLogger({
  transports: [new _winston2.default.transports.Console()],
  level: process.env.NODE_ENV === 'development' ? 'debug' : 'info',
  format: _winston.format.combine(_winston.format.colorize(), _winston.format.timestamp(), _winston.format.printf(formatter))
});

exports.default = logger;