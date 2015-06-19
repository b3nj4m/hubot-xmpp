// Generated by CoffeeScript 1.9.0
(function() {
  var Adapter, EnterMessage, JID, LeaveMessage, Robot, TextMessage, XmppBot, XmppClient, ltx, util, _ref,
    __bind = function(fn, me){ return function(){ return fn.apply(me, arguments); }; },
    __extends = function(child, parent) { for (var key in parent) { if (__hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; },
    __hasProp = {}.hasOwnProperty,
    __slice = [].slice;

  _ref = require('brobbot'), Adapter = _ref.Adapter, Robot = _ref.Robot, TextMessage = _ref.TextMessage, EnterMessage = _ref.EnterMessage, LeaveMessage = _ref.LeaveMessage;

  XmppClient = require('node-xmpp-client');

  JID = require('node-xmpp-core').JID;

  ltx = require('ltx');

  util = require('util');

  XmppBot = (function(_super) {
    __extends(XmppBot, _super);

    XmppBot.prototype.reconnectTryCount = 0;

    function XmppBot(robot) {
      this.offline = __bind(this.offline, this);
      this.readPresence = __bind(this.readPresence, this);
      this.readMessage = __bind(this.readMessage, this);
      this.readIq = __bind(this.readIq, this);
      this.read = __bind(this.read, this);
      this.ping = __bind(this.ping, this);
      this.online = __bind(this.online, this);
      this.error = __bind(this.error, this);
      this.robot = robot;
      this.anonymousGroupChatWarningLogged = false;
      this.roomToPrivateJID = {};
    }

    XmppBot.prototype.run = function() {
      var options;
      options = {
        username: process.env.BROBBOT_XMPP_USERNAME,
        password: '********',
        host: process.env.BROBBOT_XMPP_HOST,
        port: process.env.BROBBOT_XMPP_PORT,
        rooms: this.parseRooms(process.env.BROBBOT_XMPP_ROOMS.split(',')),
        keepaliveInterval: 30000,
        legacySSL: process.env.BROBBOT_XMPP_LEGACYSSL,
        preferredSaslMechanism: process.env.BROBBOT_XMPP_PREFERRED_SASL_MECHANISM,
        disallowTLS: process.env.BROBBOT_XMPP_DISALLOW_TLS
      };
      this.robot.logger.info(util.inspect(options));
      options.password = process.env.BROBBOT_XMPP_PASSWORD;
      this.options = options;
      this.connected = false;
      return this.makeClient();
    };

    XmppBot.prototype.reconnect = function() {
      this.reconnectTryCount += 1;
      if (this.reconnectTryCount > 5) {
        this.robot.logger.error('Unable to reconnect to jabber server dying.');
        process.exit(1);
      }
      this.client.removeListener('error', this.error);
      this.client.removeListener('online', this.online);
      this.client.removeListener('offline', this.offline);
      this.client.removeListener('stanza', this.read);
      return setTimeout((function(_this) {
        return function() {
          return _this.makeClient();
        };
      })(this), 5000);
    };

    XmppBot.prototype.makeClient = function() {
      var options;
      options = this.options;
      this.client = new XmppClient({
        reconnect: true,
        jid: options.username,
        password: options.password,
        host: options.host,
        port: options.port,
        legacySSL: options.legacySSL,
        preferredSaslMechanism: options.preferredSaslMechanism,
        disallowTLS: options.disallowTLS
      });
      return this.configClient(options);
    };

    XmppBot.prototype.configClient = function(options) {
      this.client.connection.socket.setTimeout(0);
      setInterval(this.ping, options.keepaliveInterval);
      this.client.on('error', this.error);
      this.client.on('online', this.online);
      this.client.on('offline', this.offline);
      this.client.on('stanza', this.read);
      return this.client.on('end', (function(_this) {
        return function() {
          _this.robot.logger.info('Connection closed, attempting to reconnect');
          return _this.reconnect();
        };
      })(this));
    };

    XmppBot.prototype.error = function(error) {
      return this.robot.logger.error("Received error " + (error.toString()));
    };

    XmppBot.prototype.online = function() {
      var presence, room, _i, _len, _ref1;
      this.robot.logger.info('Brobbot XMPP client online');
      this.client.connection.socket.setTimeout(0);
      this.client.connection.socket.setKeepAlive(true, this.options.keepaliveInterval);
      presence = new ltx.Element('presence');
      presence.c('nick', {
        xmlns: 'http://jabber.org/protocol/nick'
      }).t(this.robot.name);
      this.client.send(presence);
      this.robot.logger.info('Brobbot XMPP sent initial presence');
      _ref1 = this.options.rooms;
      for (_i = 0, _len = _ref1.length; _i < _len; _i++) {
        room = _ref1[_i];
        this.joinRoom(room);
      }
      this.emit(this.connected ? 'reconnected' : 'connected');
      this.connected = true;
      return this.reconnectTryCount = 0;
    };

    XmppBot.prototype.ping = function() {
      var ping;
      ping = new ltx.Element('iq', {
        type: 'get'
      });
      ping.c('ping', {
        xmlns: 'urn:xmpp:ping'
      });
      this.robot.logger.debug("[sending ping] " + ping);
      return this.client.send(ping);
    };

    XmppBot.prototype.parseRooms = function(items) {
      var index, room, rooms, _i, _len;
      rooms = [];
      for (_i = 0, _len = items.length; _i < _len; _i++) {
        room = items[_i];
        index = room.indexOf(':');
        rooms.push({
          jid: room.slice(0, index > 0 ? index : room.length),
          password: index > 0 ? room.slice(index + 1) : false
        });
      }
      return rooms;
    };

    XmppBot.prototype.joinRoom = function(room) {
      return this.client.send((function(_this) {
        return function() {
          var el, x;
          _this.robot.logger.debug("Joining " + room.jid + "/" + _this.robot.name);
          el = new ltx.Element('presence', {
            to: room.jid + "/" + _this.robot.name
          });
          x = el.c('x', {
            xmlns: 'http://jabber.org/protocol/muc'
          });
          x.c('history', {
            seconds: 1
          });
          if (room.password) {
            x.c('password').t(room.password);
          }
          return x;
        };
      })(this)());
    };

    XmppBot.prototype.leaveRoom = function(room) {
      var index, joined, _i, _len, _ref1;
      _ref1 = this.options.rooms;
      for (index = _i = 0, _len = _ref1.length; _i < _len; index = ++_i) {
        joined = _ref1[index];
        if (joined.jid === room.jid) {
          this.options.rooms.splice(index, 1);
        }
      }
      return this.client.send((function(_this) {
        return function() {
          _this.robot.logger.debug("Leaving " + room.jid + "/" + _this.robot.name);
          return new ltx.Element('presence', {
            to: room.jid + "/" + _this.robot.name,
            type: 'unavailable'
          });
        };
      })(this)());
    };

    XmppBot.prototype.read = function(stanza) {
      if (stanza.attrs.type === 'error') {
        this.robot.logger.error('[xmpp error]' + stanza);
        return;
      }
      switch (stanza.name) {
        case 'message':
          return this.readMessage(stanza);
        case 'presence':
          return this.readPresence(stanza);
        case 'iq':
          return this.readIq(stanza);
      }
    };

    XmppBot.prototype.readIq = function(stanza) {
      var pong;
      this.robot.logger.debug("[received iq] " + stanza);
      if (stanza.attrs.type === 'get' && stanza.children[0].name === 'ping') {
        pong = new ltx.Element('iq', {
          to: stanza.attrs.from,
          from: stanza.attrs.to,
          type: 'result',
          id: stanza.attrs.id
        });
        this.robot.logger.debug("[sending pong] " + pong);
        return this.client.send(pong);
      }
    };

    XmppBot.prototype.readMessage = function(stanza) {
      var body, from, message, privateChatJID, room, user, _ref1, _ref2;
      if ((_ref1 = stanza.attrs.type) !== 'groupchat' && _ref1 !== 'direct' && _ref1 !== 'chat') {
        return;
      }
      if (stanza.attrs.from === void 0) {
        return;
      }
      body = stanza.getChild('body');
      if (!body) {
        return;
      }
      from = stanza.attrs.from;
      message = body.getText();
      if (stanza.attrs.type === 'groupchat') {
        _ref2 = from.split('/'), room = _ref2[0], user = _ref2[1];
        if (user === void 0 || user === "" || user === this.robot.name) {
          return;
        }
        privateChatJID = this.roomToPrivateJID[from];
      } else {
        user = from.split('@')[0];
        room = void 0;
        privateChatJID = from;
      }
      user = this.robot.brain.userForId(user);
      user.type = stanza.attrs.type;
      user.room = room;
      if (privateChatJID) {
        user.privateChatJID = privateChatJID;
      }
      this.robot.logger.debug("Received message: " + message + " in room: " + user.room + ", from: " + user.name + ". Private chat JID is " + user.privateChatJID);
      return this.receive(new TextMessage(user, message));
    };

    XmppBot.prototype.readPresence = function(stanza) {
      var fromJID, privateChatJID, room, user, _base, _ref1, _ref2;
      fromJID = new JID(stanza.attrs.from);
      if ((_base = stanza.attrs).type == null) {
        _base.type = 'available';
      }
      switch (stanza.attrs.type) {
        case 'subscribe':
          this.robot.logger.debug(stanza.attrs.from + " subscribed to me");
          return this.client.send(new ltx.Element('presence', {
            from: stanza.attrs.to,
            to: stanza.attrs.from,
            id: stanza.attrs.id,
            type: 'subscribed'
          }));
        case 'probe':
          this.robot.logger.debug(stanza.attrs.from + " probed me");
          return this.client.send(new ltx.Element('presence', {
            from: stanza.attrs.to,
            to: stanza.attrs.from,
            id: stanza.attrs.id
          }));
        case 'available':
          if (fromJID.resource === this.robot.name || (typeof stanza.getChild === "function" ? (_ref1 = stanza.getChild('nick')) != null ? typeof _ref1.getText === "function" ? _ref1.getText() : void 0 : void 0 : void 0) === this.robot.name) {
            this.heardOwnPresence = true;
            return;
          }
          room = fromJID.bare().toString();
          if (!this.messageFromRoom(room)) {
            return;
          }
          privateChatJID = this.resolvePrivateJID(stanza);
          this.roomToPrivateJID[fromJID.toString()] = privateChatJID != null ? privateChatJID.toString() : void 0;
          this.robot.logger.debug("Available received from " + (fromJID.toString()) + " in room " + room + " and private chat jid is " + (privateChatJID != null ? privateChatJID.toString() : void 0));
          user = this.robot.brain.userForId(fromJID.resource, {
            room: room,
            jid: fromJID.toString(),
            privateChatJID: privateChatJID != null ? privateChatJID.toString() : void 0
          });
          if (!!this.heardOwnPresence) {
            return this.receive(new EnterMessage(user));
          }
          break;
        case 'unavailable':
          _ref2 = stanza.attrs.from.split('/'), room = _ref2[0], user = _ref2[1];
          if (!this.messageFromRoom(room)) {
            return;
          }
          if (user === this.options.username) {
            return;
          }
          this.robot.logger.debug("Unavailable received from " + user + " in room " + room);
          user = this.robot.brain.userForId(user, {
            room: room
          });
          return this.receive(new LeaveMessage(user));
      }
    };

    XmppBot.prototype.resolvePrivateJID = function(stanza) {
      var jid, privateJID, _ref1, _ref2, _ref3;
      jid = new JID(stanza.attrs.from);
      privateJID = (_ref1 = stanza.getChild('x', 'http://jabber.org/protocol/muc#user')) != null ? typeof _ref1.getChild === "function" ? (_ref2 = _ref1.getChild('item')) != null ? (_ref3 = _ref2.attrs) != null ? _ref3.jid : void 0 : void 0 : void 0 : void 0;
      if (!privateJID) {
        if (!this.anonymousGroupChatWarningLogged) {
          this.robot.logger.warning("Could not get private JID from group chat. Make sure the server is configured to broadcast real jid for groupchat (see http://xmpp.org/extensions/xep-0045.html#enter-nonanon)");
          this.anonymousGroupChatWarningLogged = true;
        }
        return null;
      }
      return new JID(privateJID);
    };

    XmppBot.prototype.messageFromRoom = function(room) {
      var joined, _i, _len, _ref1;
      _ref1 = this.options.rooms;
      for (_i = 0, _len = _ref1.length; _i < _len; _i++) {
        joined = _ref1[_i];
        if (joined.jid.toUpperCase() === room.toUpperCase()) {
          return true;
        }
      }
      return false;
    };

    XmppBot.prototype.send = function() {
      var bodyMsg, envelope, message, messages, msg, params, parsedMsg, to, _base, _base1, _i, _len, _ref1, _ref2, _ref3, _ref4, _results;
      envelope = arguments[0], messages = 2 <= arguments.length ? __slice.call(arguments, 1) : [];
      _results = [];
      for (_i = 0, _len = messages.length; _i < _len; _i++) {
        msg = messages[_i];
        this.robot.logger.debug("Sending to " + envelope.room + ": " + msg);
        to = envelope.room;
        if ((_ref1 = (_ref2 = envelope.user) != null ? _ref2.type : void 0) === 'direct' || _ref1 === 'chat') {
          to = (_ref3 = envelope.user.privateChatJID) != null ? _ref3 : envelope.room + "/" + envelope.user.name;
        }
        params = {
          to: to,
          type: ((_ref4 = envelope.user) != null ? _ref4.type : void 0) || 'groupchat'
        };
        if (msg.attrs != null) {
          message = msg.root();
          if ((_base = message.attrs).to == null) {
            _base.to = params.to;
          }
          if ((_base1 = message.attrs).type == null) {
            _base1.type = params.type;
          }
        } else {
          parsedMsg = (function() {
            try {
              return new ltx.parse(msg);
            } catch (_error) {}
          })();
          bodyMsg = new ltx.Element('message', params).c('body').t(msg);
          message = parsedMsg != null ? bodyMsg.up().c('html', {
            xmlns: 'http://jabber.org/protocol/xhtml-im'
          }).c('body', {
            xmlns: 'http://www.w3.org/1999/xhtml'
          }).cnode(parsedMsg) : bodyMsg;
        }
        _results.push(this.client.send(message));
      }
      return _results;
    };

    XmppBot.prototype.reply = function() {
      var envelope, messages, msg, _i, _len, _results;
      envelope = arguments[0], messages = 2 <= arguments.length ? __slice.call(arguments, 1) : [];
      _results = [];
      for (_i = 0, _len = messages.length; _i < _len; _i++) {
        msg = messages[_i];
        if (msg.attrs != null) {
          _results.push(this.send(envelope, msg));
        } else {
          _results.push(this.send(envelope, envelope.user.name + ": " + msg));
        }
      }
      return _results;
    };

    XmppBot.prototype.topic = function() {
      var envelope, message, string, strings;
      envelope = arguments[0], strings = 2 <= arguments.length ? __slice.call(arguments, 1) : [];
      string = strings.join("\n");
      message = new ltx.Element('message', {
        to: envelope.room,
        type: envelope.user.type
      }).c('subject').t(string);
      return this.client.send(message);
    };

    XmppBot.prototype.offline = function() {
      return this.robot.logger.debug("Received offline event");
    };

    return XmppBot;

  })(Adapter);

  exports.use = function(robot) {
    return new XmppBot(robot);
  };

}).call(this);
