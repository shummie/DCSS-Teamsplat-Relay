'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.createBots = createBots;

var _lodash = require('lodash');

var _lodash2 = _interopRequireDefault(_lodash);

var _bot = require('./bot');

var _bot2 = _interopRequireDefault(_bot);

var _errors = require('./errors');

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

/**
 * Reads from the provided config file and returns an array of bots
 * @return {object[]}
 */


function ping_lm(bot) {
    bot.ircClient.say("Sequell", "!lm shummie");
}

let tm = ["mandevil", "shummie", "helmschank", "danielguo94", "neondemon", "berryknight", "caminho"];
let lm = [];

function createBots(configFile) {
  const bots = [];

  // The config file can be both an array and an object
  if (Array.isArray(configFile)) {
    configFile.forEach(config => {
      const bot = new _bot2.default(config);
      bot.connect();
      bots.push(bot);
    });
  } else if (_lodash2.default.isObject(configFile)) {
    const bot = new _bot2.default(configFile);
    bot.connect();
    bots.push(bot);
  } else {
    throw new _errors.ConfigurationError();
  }

  for (let i of tm) {
    lm.push("");
  }

  var tt = setInterval(function() {



    bots[0].ircClient.say("Sequell", "!lm shummie");



    }, 10000);






  return bots;
}
