'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _extends = Object.assign || function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; };

var _lodash = require('lodash');

var _lodash2 = _interopRequireDefault(_lodash);

var _ircUpd = require('irc-upd');

var _ircUpd2 = _interopRequireDefault(_ircUpd);

var _discord = require('discord.js');

var _discord2 = _interopRequireDefault(_discord);

var _logger = require('./logger');

var _logger2 = _interopRequireDefault(_logger);

var _errors = require('./errors');

var _validators = require('./validators');

var _formatting = require('./formatting');

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

const REQUIRED_FIELDS = ['server', 'nickname', 'channelMapping', 'discordToken'];
const NICK_COLORS = ['light_blue', 'dark_blue', 'light_red', 'dark_red', 'light_green', 'dark_green', 'magenta', 'light_magenta', 'orange', 'yellow', 'cyan', 'light_cyan'];
const patternMatch = /{\$(.+?)}/g;

var team_members = ["mandevil", "shummie", "helmschank", "danielguo94", "neondemon", "berryknight", "caminho"];

/**
 * An IRC bot, works as a middleman for all communication
 * @param {object} options - server, nickname, channelMapping, outgoingToken, incomingURL
 */
class Bot {
  constructor(options) {
    REQUIRED_FIELDS.forEach(field => {
      if (!options[field]) {
        throw new _errors.ConfigurationError(`Missing configuration field ${field}`);
      }
    });

    (0, _validators.validateChannelMapping)(options.channelMapping);

    this.discord = new _discord2.default.Client({ autoReconnect: true });

    this.server = options.server;
    this.nickname = options.nickname;
    this.ircOptions = options.ircOptions;
    this.discordToken = options.discordToken;
    this.commandCharacters = options.commandCharacters || [];
    this.ircNickColor = options.ircNickColor !== false; // default to true
    this.channels = _lodash2.default.values(options.channelMapping);
    this.ircStatusNotices = options.ircStatusNotices;
    this.announceSelfJoin = options.announceSelfJoin;
    this.webhookOptions = options.webhooks;

    // Nicks to ignore
    this.ignoreUsers = options.ignoreUsers || {};
    this.ignoreUsers.irc = this.ignoreUsers.irc || [];
    this.ignoreUsers.discord = this.ignoreUsers.discord || [];

    // "{$keyName}" => "variableValue"
    // author/nickname: nickname of the user who sent the message
    // discordChannel: Discord channel (e.g. #general)
    // ircChannel: IRC channel (e.g. #irc)
    // text: the (appropriately formatted) message content
    this.format = options.format || {};

    // "{$keyName}" => "variableValue"
    // displayUsername: nickname with wrapped colors
    // attachmentURL: the URL of the attachment (only applicable in formatURLAttachment)
    this.formatIRCText = this.format.ircText || '<{$displayUsername}> {$text}';
    this.formatURLAttachment = this.format.urlAttachment || '<{$displayUsername}> {$attachmentURL}';
    // "{$keyName}" => "variableValue"
    // side: "Discord" or "IRC"
    if ('commandPrelude' in this.format) {
      this.formatCommandPrelude = this.format.commandPrelude;
    } else {
      this.formatCommandPrelude = 'Command sent from {$side} by {$nickname}:';
    }

    // "{$keyName}" => "variableValue"
    // withMentions: text with appropriate mentions reformatted
    this.formatDiscord = this.format.discord || '**<{$author}>** {$withMentions}';

    // Keep track of { channel => [list, of, usernames] } for ircStatusNotices
    this.channelUsers = {};

    this.channelMapping = {};
    this.webhooks = {};

    // Remove channel passwords from the mapping and lowercase IRC channel names
    _lodash2.default.forOwn(options.channelMapping, (ircChan, discordChan) => {
      this.channelMapping[discordChan] = ircChan.split(' ')[0].toLowerCase();
    });

    this.invertedMapping = _lodash2.default.invert(this.channelMapping);
    this.autoSendCommands = options.autoSendCommands || [];
  }

  connect() {
    _logger2.default.debug('Connecting to IRC and Discord');
    this.discord.login(this.discordToken);

    // Extract id and token from Webhook urls and connect.
    _lodash2.default.forOwn(this.webhookOptions, (url, channel) => {
      const [id, token] = url.split('/').slice(-2);
      const client = new _discord2.default.WebhookClient(id, token);
      this.webhooks[channel] = {
        id,
        client
      };
    });

    const ircOptions = _extends({
      userName: this.nickname,
      realName: this.nickname,
      channels: this.channels,
      floodProtection: true,
      floodProtectionDelay: 500,
      retryCount: 10,
      autoRenick: true
    }, this.ircOptions);

    // default encoding to UTF-8 so messages to Discord aren't corrupted
    if (!Object.prototype.hasOwnProperty.call(ircOptions, 'encoding')) {
      if (_ircUpd2.default.canConvertEncoding()) {
        ircOptions.encoding = 'utf-8';
      } else {
        _logger2.default.warn('Cannot convert message encoding; you may encounter corrupted characters with non-English text.\n' + 'For information on how to fix this, please see: https://github.com/Throne3d/node-irc#character-set-detection');
      }
    }

    this.ircClient = new _ircUpd2.default.Client(this.server, this.nickname, ircOptions);
    this.attachListeners();
  }

  attachListeners() {
    this.discord.on('ready', () => {
      _logger2.default.info('Connected to Discord');
    });

    this.ircClient.on('registered', message => {
      _logger2.default.info('Connected to IRC');
      _logger2.default.debug('Registered event: ', message);
      this.autoSendCommands.forEach(element => {
        this.ircClient.send(...element);
      });
    });

    this.ircClient.on('error', error => {
      _logger2.default.error('Received error event from IRC', error);
    });

    this.discord.on('error', error => {
      _logger2.default.error('Received error event from Discord', error);
    });

    this.discord.on('warn', warning => {
      _logger2.default.warn('Received warn event from Discord', warning);
    });

    this.discord.on('message', message => {
      // Ignore bot messages and people leaving/joining
      this.sendToIRC(message);
    });

    this.ircClient.on('message', this.sendToDiscord.bind(this));

    this.ircClient.on('notice', (author, to, text) => {
      this.sendToDiscord(author, to, `*${text}*`, false);
    });

    this.ircClient.on('pm', (author, text, msg) => {
      this.sendToDiscord(author, "##crawl", `*${text}*`, true);
    });

    this.ircClient.on('nick', (oldNick, newNick, channels) => {
      return;
      if (!this.ircStatusNotices) return;
      channels.forEach(channelName => {
        const channel = channelName.toLowerCase();
        if (this.channelUsers[channel]) {
          if (this.channelUsers[channel].has(oldNick)) {
            this.channelUsers[channel].delete(oldNick);
            this.channelUsers[channel].add(newNick);
            this.sendExactToDiscord(channel, `*${oldNick}* is now known as ${newNick}`);
          }
        } else {
          _logger2.default.warn(`No channelUsers found for ${channel} when ${oldNick} changed.`);
        }
      });
    });

    this.ircClient.on('join', (channelName, nick) => {
      return;
      _logger2.default.debug('Received join:', channelName, nick);
      if (!this.ircStatusNotices) return;
      if (nick === this.ircClient.nick && !this.announceSelfJoin) return;
      const channel = channelName.toLowerCase();
      // self-join is announced before names (which includes own nick)
      // so don't add nick to channelUsers
      if (nick !== this.ircClient.nick) this.channelUsers[channel].add(nick);
      this.sendExactToDiscord(channel, `*${nick}* has joined the channel`);
    });

    this.ircClient.on('part', (channelName, nick, reason) => {
      return;
      _logger2.default.debug('Received part:', channelName, nick, reason);
      if (!this.ircStatusNotices) return;
      const channel = channelName.toLowerCase();
      // remove list of users when no longer in channel (as it will become out of date)
      if (nick === this.ircClient.nick) {
        _logger2.default.debug('Deleting channelUsers as bot parted:', channel);
        delete this.channelUsers[channel];
        return;
      }
      if (this.channelUsers[channel]) {
        this.channelUsers[channel].delete(nick);
      } else {
        _logger2.default.warn(`No channelUsers found for ${channel} when ${nick} parted.`);
      }
      this.sendExactToDiscord(channel, `*${nick}* has left the channel (${reason})`);
    });

    this.ircClient.on('quit', (nick, reason, channels) => {
      return;
      _logger2.default.debug('Received quit:', nick, channels);
      if (!this.ircStatusNotices || nick === this.ircClient.nick) return;
      channels.forEach(channelName => {
        const channel = channelName.toLowerCase();
        if (!this.channelUsers[channel]) {
          _logger2.default.warn(`No channelUsers found for ${channel} when ${nick} quit, ignoring.`);
          return;
        }
        if (!this.channelUsers[channel].delete(nick)) return;
        this.sendExactToDiscord(channel, `*${nick}* has quit (${reason})`);
      });
    });

    this.ircClient.on('names', (channelName, nicks) => {
      _logger2.default.debug('Received names:', channelName, nicks);
      if (!this.ircStatusNotices) return;
      const channel = channelName.toLowerCase();
      this.channelUsers[channel] = new Set(Object.keys(nicks));
    });

    this.ircClient.on('action', (author, to, text) => {
      this.sendToDiscord(author, to, `_${text}_`);
    });

    this.ircClient.on('invite', (channel, from) => {
      _logger2.default.debug('Received invite:', channel, from);
      if (!this.invertedMapping[channel]) {
        _logger2.default.debug('Channel not found in config, not joining:', channel);
      } else {
        this.ircClient.join(channel);
        _logger2.default.debug('Joining channel:', channel);
      }
    });

    if (_logger2.default.level === 'debug') {
      this.discord.on('debug', message => {
        _logger2.default.debug('Received debug event from Discord', message);
      });
    }
  }

  static getDiscordNicknameOnServer(user, guild) {
    if (guild) {
      const userDetails = guild.members.get(user.id);
      if (userDetails) {
        return userDetails.nickname || user.username;
      }
    }
    return user.username;
  }

  parseText(message) {
    const text = message.mentions.users.reduce((content, mention) => {
      const displayName = Bot.getDiscordNicknameOnServer(mention, message.guild);
      return content.replace(`<@${mention.id}>`, `@${displayName}`).replace(`<@!${mention.id}>`, `@${displayName}`).replace(`<@&${mention.id}>`, `@${displayName}`);
    }, message.content);

    return text.replace(/\n|\r\n|\r/g, ' ').replace(/<#(\d+)>/g, (match, channelId) => {
      const channel = this.discord.channels.get(channelId);
      if (channel) return `#${channel.name}`;
      return '#deleted-channel';
    }).replace(/<@&(\d+)>/g, (match, roleId) => {
      const role = message.guild.roles.get(roleId);
      if (role) return `@${role.name}`;
      return '@deleted-role';
    }).replace(/<a?(:\w+:)\d+>/g, (match, emoteName) => emoteName);
  }

  isCommandMessage(message) {
    return this.commandCharacters.some(prefix => message.startsWith(prefix));
  }

  ignoredIrcUser(user) {
    return this.ignoreUsers.irc.some(i => i.toLowerCase() === user.toLowerCase());
  }

  ignoredDiscordUser(user) {
    return this.ignoreUsers.discord.some(i => i.toLowerCase() === user.toLowerCase());
  }

  static substitutePattern(message, patternMapping) {
    return message.replace(patternMatch, (match, varName) => patternMapping[varName] || match);
  }

  sendToIRC(message) {
    const { author } = message;
    // Ignore messages sent by the bot itself:
    if (author.id === this.discord.user.id || Object.keys(this.webhooks).some(channel => this.webhooks[channel].id === author.id)) return;

    // Do not send to IRC if this user is on the ignore list.
    if (this.ignoredDiscordUser(author.username)) {
      return;
    }

    const channelName = `#${message.channel.name}`;
    const ircChannel = this.channelMapping[message.channel.id] || this.channelMapping[channelName];

    _logger2.default.debug('Channel Mapping', channelName, this.channelMapping[channelName]);
    if (ircChannel) {
      const fromGuild = message.guild;
      const nickname = Bot.getDiscordNicknameOnServer(author, fromGuild);
      let text = this.parseText(message);
      let displayUsername = nickname;
      if (this.ircNickColor) {
        const colorIndex = (nickname.charCodeAt(0) + nickname.length) % NICK_COLORS.length;
        displayUsername = _ircUpd2.default.colors.wrap(NICK_COLORS[colorIndex], nickname);
      }

      const patternMap = {
        author: nickname,
        nickname,
        displayUsername,
        text,
        discordChannel: channelName,
        ircChannel
      };

      if (this.isCommandMessage(text)) {
        patternMap.side = 'Discord';
        _logger2.default.debug('Sending command message to IRC', ircChannel, text);
        // if (prelude) this.ircClient.say(ircChannel, prelude);
        if (this.formatCommandPrelude) {
          // const prelude = Bot.substitutePattern(this.formatCommandPrelude, patternMap);
          // this.ircClient.say(ircChannel, prelude);
        }
        // text = "/msg Sequell " + text;
        // this.ircClient.say(ircChannel, text);
        this.ircClient.say("Sequell", text);
      } else {

        // For now, if it's not a command, don't send it over.
        return;

        if (text !== '') {
          // Convert formatting
          text = (0, _formatting.formatFromDiscordToIRC)(text);
          patternMap.text = text;

          text = Bot.substitutePattern(this.formatIRCText, patternMap);
          _logger2.default.debug('Sending message to IRC', ircChannel, text);
          this.ircClient.say(ircChannel, text);
        }

        if (message.attachments && message.attachments.size) {
          message.attachments.forEach(a => {
            patternMap.attachmentURL = a.url;
            const urlMessage = Bot.substitutePattern(this.formatURLAttachment, patternMap);

            _logger2.default.debug('Sending attachment URL to IRC', ircChannel, urlMessage);
            this.ircClient.say(ircChannel, urlMessage);
          });
        }
      }
    }
  }

  findDiscordChannel(ircChannel) {
    
    const discordChannelName = this.invertedMapping[ircChannel.toLowerCase()];
    // const discordChannelName = "542760791057891338";
    if (discordChannelName) {
      // #channel -> channel before retrieving and select only text channels:
      let discordChannel = null;

      if (this.discord.channels.has(discordChannelName)) {
        discordChannel = this.discord.channels.get(discordChannelName);
      } else if (discordChannelName.startsWith('#')) {
        discordChannel = this.discord.channels.filter(c => c.type === 'text').find(c => c.name === discordChannelName.slice(1));
      }

      if (!discordChannel) {
        _logger2.default.info('Tried to send a message to a channel the bot isn\'t in: ', discordChannelName);
        // return "542760791057891338";
        return null;
      }
      return discordChannel;
    }
    // return "542760791057891338";
    return null;
  }

  findWebhook(ircChannel) {
    const discordChannelName = this.invertedMapping[ircChannel.toLowerCase()];
    return discordChannelName && this.webhooks[discordChannelName];
  }

  getDiscordAvatar(nick, channel) {
    const guildMembers = this.findDiscordChannel(channel).guild.members;
    const findByNicknameOrUsername = caseSensitive => member => {
      if (caseSensitive) {
        return member.user.username === nick || member.nickname === nick;
      }
      const nickLowerCase = nick.toLowerCase();
      return member.user.username.toLowerCase() === nickLowerCase || member.nickname && member.nickname.toLowerCase() === nickLowerCase;
    };

    // Try to find exact matching case
    let users = guildMembers.filter(findByNicknameOrUsername(true));

    // Now let's search case insensitive.
    if (users.size === 0) {
      users = guildMembers.filter(findByNicknameOrUsername(false));
    }

    // No matching user or more than one => no avatar
    if (users && users.size === 1) {
      return users.first().user.avatarURL;
    }
    return null;
  }

  // compare two strings case-insensitively
  // for discord mention matching
  static caseComp(str1, str2) {
    return str1.toUpperCase() === str2.toUpperCase();
  }

  // check if the first string starts with the second case-insensitively
  // for discord mention matching
  static caseStartsWith(str1, str2) {
    return str1.toUpperCase().startsWith(str2.toUpperCase());
  } 

  sendToDiscord(author, channel, text, pm=false) {    
    let discordChannel = this.findDiscordChannel(channel);
    if (!discordChannel) return;

    let send_filter = ["Sequell", "Postquell"];

    let allow_send = false;

    // discordChannel.send("Debugging info: ");
    // discordChannel.send("Author: " + author);
    // discordChannel.send("channel: " + channel);
    // discordChannel.send("text: " + text);

    for (let i of send_filter) {
      if (i.toLowerCase() == author.toLowerCase()) {
        allow_send = true;
        break;
      }
    }

    // discordChannel.send("pm: " + pm);


    // discordChannel.send("allow_send: " + allow_send);
    if (!allow_send && (pm !== true)) {
      return;
    }

    allow_send = false;
    for (let i of team_members) {
      if (text.includes(i)) {
        allow_send = true;
        break;
      }
    }
    // discordChannel.send("team_member filter: " + allow_send);
    if (!allow_send && (pm !== true)) {
      return;
    }

    // Do not send to Discord if this user is on the ignore list.
    if (this.ignoredIrcUser(author)) {
      return;
    }

    // Convert text formatting (bold, italics, underscore)
    const withFormat = (0, _formatting.formatFromIRCToDiscord)(text);

    const patternMap = {
      author,
      nickname: author,
      displayUsername: author,
      text: withFormat,
      discordChannel: `#${discordChannel.name}`,
      ircChannel: channel
    };

    if (this.isCommandMessage(text)) {
      patternMap.side = 'IRC';
      _logger2.default.debug('Sending command message to Discord', `#${discordChannel.name}`, text);
      if (this.formatCommandPrelude) {
        // const prelude = Bot.substitutePattern(this.formatCommandPrelude, patternMap);
        // discordChannel.send(prelude);
      }
      discordChannel.send(text);
      return;
    }

    const { guild } = discordChannel;
    const withMentions = withFormat.replace(/@([^\s#]+)#(\d+)/g, (match, username, discriminator) => {
      // @username#1234 => mention
      // skips usernames including spaces for ease (they cannot include hashes)
      // checks case insensitively as Discord does
      const user = guild.members.find(x => Bot.caseComp(x.user.username, username.toUpperCase()) && x.user.discriminator === discriminator);
      if (user) return user;

      return match;
    }).replace(/@([^\s]+)/g, (match, reference) => {
      // this preliminary stuff is ultimately unnecessary
      // but might save time over later more complicated calculations
      // @nickname => mention, case insensitively
      const nickUser = guild.members.find(x => x.nickname !== null && Bot.caseComp(x.nickname, reference));
      if (nickUser) return nickUser;

      // @username => mention, case insensitively
      const user = guild.members.find(x => Bot.caseComp(x.user.username, reference));
      if (user) return user;

      // @role => mention, case insensitively
      const role = guild.roles.find(x => x.mentionable && Bot.caseComp(x.name, reference));
      if (role) return role;

      // No match found checking the whole word. Check for partial matches now instead.
      // @nameextra => [mention]extra, case insensitively, as Discord does
      // uses the longest match, and if there are two, whichever is a match by case
      let matchLength = 0;
      let bestMatch = null;
      let caseMatched = false;

      // check if a partial match is found in reference and if so update the match values
      const checkMatch = function (matchString, matchValue) {
        // if the matchString is longer than the current best and is a match
        // or if it's the same length but it matches by case unlike the current match
        // set the best match to this matchString and matchValue
        if (matchString.length > matchLength && Bot.caseStartsWith(reference, matchString) || matchString.length === matchLength && !caseMatched && reference.startsWith(matchString)) {
          matchLength = matchString.length;
          bestMatch = matchValue;
          caseMatched = reference.startsWith(matchString);
        }
      };

      // check users by username and nickname
      guild.members.forEach(member => {
        checkMatch(member.user.username, member);
        if (bestMatch === member || member.nickname === null) return;
        checkMatch(member.nickname, member);
      });
      // check mentionable roles by visible name
      guild.roles.forEach(member => {
        if (!member.mentionable) return;
        checkMatch(member.name, member);
      });

      // if a partial match was found, return the match and the unmatched trailing characters
      if (bestMatch) return bestMatch.toString() + reference.substring(matchLength);

      return match;
    }).replace(/:(\w+):/g, (match, ident) => {
      // :emoji: => mention, case sensitively
      const emoji = guild.emojis.find(x => x.name === ident && x.requiresColons);
      if (emoji) return emoji;

      return match;
    });

    // Webhooks first
    const webhook = this.findWebhook(channel);
    if (webhook) {
      _logger2.default.debug('Sending message to Discord via webhook', withMentions, channel, '->', `#${discordChannel.name}`);
      const avatarURL = this.getDiscordAvatar(author, channel);
      webhook.client.sendMessage(withMentions, {
        username: author,
        text,
        avatarURL
      }).catch(_logger2.default.error);
      return;
    }

    patternMap.withMentions = withMentions;

    // Add bold formatting:
    // Use custom formatting from config / default formatting with bold author
    const withAuthor = Bot.substitutePattern(this.formatDiscord, patternMap);
    _logger2.default.debug('Sending message to Discord', withAuthor, channel, '->', `#${discordChannel.name}`);
    discordChannel.send(withAuthor);

    if (text.includes("escaped with the Orb")) {
      discordChannel = this.findDiscordChannel("##wins");
      discordChannel.send(withAuthor);
    }

  }

  /* Sends a message to Discord exactly as it appears */
  sendExactToDiscord(channel, text) {
    const discordChannel = this.findDiscordChannel(channel);
    if (!discordChannel) return;

    _logger2.default.debug('Sending special message to Discord', text, channel, '->', `#${discordChannel.name}`);
    discordChannel.send(text);
  }
}

exports.default = Bot;