var Brobbot = require('brobbot');
var Adapter = Brobbot.Adapter;
var Robot = Brobbot.Robot;
var TextMessage = Brobbot.TextMessage;
var EnterMessage = Brobbot.EnterMessage;
var LeaveMessage = Brobbot.LeaveMessage;
var XmppClient = require('node-xmpp-client');
var JID = require('node-xmpp-core').JID;
var ltx = require('ltx');
var util = require('util');
var Q = require('q');

function XmppBot(robot) {
  this.offline = this.offline.bind(this);
  this.readPresence = this.readPresence.bind(this);
  this.readMessage = this.readMessage.bind(this);
  this.readIq = this.readIq.bind(this);
  this.read = this.read.bind(this);
  this.ping = this.ping.bind(this);
  this.online = this.online.bind(this);
  this.error = this.error.bind(this);
  this.robot = robot;
  this.anonymousGroupChatWarningLogged = false;
  this.roomToPrivateJID = {};
  this.connectedDefer = Q.defer();
  this.connected = this.connectedDefer.promise;
  this.rooms = new Map();

  var username = process.env.BROBBOT_XMPP_USERNAME || '';
  var host = process.env.BROBBOT_XMPP_HOST || username.split('@')[1] || '';

  this.options = {
    username: username,
    password: process.env.BROBBOT_XMPP_PASSWORD,
    host: host,
    port: process.env.BROBBOT_XMPP_PORT,
    rooms: this.parseRooms((process.env.BROBBOT_XMPP_ROOMS || '').split(',')),
    keepaliveInterval: 30000,
    legacySSL: process.env.BROBBOT_XMPP_LEGACYSSL,
    preferredSaslMechanism: process.env.BROBBOT_XMPP_PREFERRED_SASL_MECHANISM,
    disallowTLS: process.env.BROBBOT_XMPP_DISALLOW_TLS
  };

  for (var i in this.options.rooms) {
    this.rooms.set(this.options.rooms[i].jid.toLowerCase(), this.options.rooms[i]);
  }
}

XmppBot.prototype = Object.create(Adapter.prototype);
XmppBot.prototype.constructor = XmppBot;

XmppBot.prototype.reconnectTryCount = 0;

XmppBot.prototype.run = function() {
  this.robot.logger.info(util.inspect(this.options));
  return this.makeClient();
};

XmppBot.prototype.reconnect = function() {
  this.robot.logger.info('Connection closed, attempting to reconnect');

  if (!this.connected.isPending()) {
    this.connectedDefer = Q.defer();
    this.connected = this.connectedDefer.promise;
  }

  this.client.removeListener('error', this.error);
  this.client.removeListener('online', this.online);
  this.client.removeListener('offline', this.offline);
  this.client.removeListener('stanza', this.read);

  setTimeout(this.makeClient.bind(this), this.reconnectTimeout());

  this.reconnectTryCount++;

  return this.connected;
};

XmppBot.prototype.reconnectTimeout = function() {
  return Math.pow(2, Math.min(this.reconnectTryCount, 7)) * 1000;
};

XmppBot.prototype.makeClient = function() {
  try {
    this.client = new XmppClient({
      reconnect: false,
      jid: this.options.username,
      password: this.options.password,
      host: this.options.host,
      port: this.options.port,
      legacySSL: this.options.legacySSL,
      preferredSaslMechanism: this.options.preferredSaslMechanism,
      disallowTLS: this.options.disallowTLS
    });

    this.configClient();
  }
  catch (err) {
    this.robot.logger.error(err);
  }
};

XmppBot.prototype.configClient = function() {
  var self = this;

  this.client.connection.socket.setTimeout(0);

  setInterval(this.ping, this.options.keepaliveInterval);

  this.client.on('error', this.error);
  this.client.on('online', this.online);
  this.client.on('offline', this.offline);
  this.client.on('stanza', this.read);
};

XmppBot.prototype.error = function(error) {
  return this.robot.logger.error("Received error " + (error.toString()));
};

XmppBot.prototype.online = function() {
  this.robot.logger.info('Brobbot XMPP client online');

  if (this.client && this.client.connection) {
    this.client.connection.socket.setTimeout(0);
    this.client.connection.socket.setKeepAlive(true, this.options.keepaliveInterval);

    var presence = new ltx.Element('presence');
    presence.c('nick', {
      xmlns: 'http://jabber.org/protocol/nick'
    }).t(this.robot.name);

    this.client.send(presence);

    this.robot.logger.info('Brobbot XMPP sent initial presence');

    //TODO resolve connected after joins
    for (var room of this.rooms.values()) {
      this.joinRoom(room);
    }
  }
  this.connectedDefer.resolve();
  this.reconnectTryCount = 0;
};

XmppBot.prototype.ping = function() {
  var ping = new ltx.Element('iq', {
    type: 'get'
  });
  ping.c('ping', {
    xmlns: 'urn:xmpp:ping'
  });

  this.robot.logger.debug("[sending ping] " + ping);
  return this.client.send(ping);
};

XmppBot.prototype.parseRooms = function(items) {
  var rooms = [];
  var index;

  for (var i = 0; i < items.length; i++) {
    index = items[i].indexOf(':');

    rooms.push({
      jid: items[i].slice(0, index > 0 ? index : items[i].length),
      password: index > 0 ? items[i].slice(index + 1) : false
    });
  }

  return rooms;
};

XmppBot.prototype.joinRoom = function(room) {
  this.robot.logger.debug('Joining ' + room.jid + '/' + this.robot.name);

  var el = new ltx.Element('presence', {
    to: room.jid + "/" + this.robot.name
  });

  var x = el.c('x', {
    xmlns: 'http://jabber.org/protocol/muc'
  });

  x.c('history', {
    seconds: 1
  });

  if (room.password) {
    x.c('password').t(room.password);
  }

  return this.client.send(x);
};

XmppBot.prototype.leaveRoom = function(room) {
  var i = 0;
  var self = this;

  this.rooms.delete(room.jid);

  this.robot.logger.debug("Leaving " + room.jid + "/" + this.robot.name);

  return this.client.send(new ltx.Element('presence', {
    to: room.jid + "/" + this.robot.name,
    type: 'unavailable'
  }));
};

XmppBot.prototype.read = function(stanza) {
  if (stanza.attrs.type === 'error') {
    this.robot.logger.error('[xmpp error] ' + stanza);
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
  this.robot.logger.debug('[received iq] ' + stanza);

  if (stanza.attrs.type === 'get' && stanza.children[0].name === 'ping') {
    var pong = new ltx.Element('iq', {
      to: stanza.attrs.from,
      from: stanza.attrs.to,
      type: 'result',
      id: stanza.attrs.id
    });

    this.robot.logger.debug('[sending pong] ' + pong);

    return this.client.send(pong);
  }
};

XmppBot.prototype.readMessage = function(stanza) {
  if (stanza.attrs.type !== 'groupchat' && stanza.attrs.type !== 'direct' && stanza.attrs.type !== 'chat') {
    return;
  }

  if (!stanza.attrs.from) {
    return;
  }

  var body = stanza.getChild('body');

  if (!body) {
    return;
  }

  var message = body.getText();
  var userId;
  var room;
  var privateChatJID;
  var self = this;

  if (stanza.attrs.type === 'groupchat') {
    var from = stanza.attrs.from.split('/');
    room = from[0];
    userId = from[1];

    if (!userId || userId === this.robot.name) {
      return;
    }

    privateChatJID = this.roomToPrivateJID[from];
  }
  else {
    userId = stanza.attrs.from.split('@')[0];
    room = null;
    privateChatJID = stanza.attrs.from;
  }

  var opts = {type: stanza.attrs.type, room: room};

  if (privateChatJID) {
    opts.privateChatJID = privateChatJID;
  }

  return this.robot.brain.userForId(userId, opts).then(function(user) {
    self.robot.logger.debug('Received message: ' + message + ' in room: ' + user.room + ', from: ' + user.name + '. Private chat JID is ' + user.privateChatJID);

    return self.receive(new TextMessage(user, message));
  });
};

XmppBot.prototype.readPresence = function(stanza) {
  var fromJID = new JID(stanza.attrs.from);
  var self = this;
  var room;

  stanza.attrs.type = stanza.attrs.type || 'available';

  switch (stanza.attrs.type) {
    case 'subscribe':
      this.robot.logger.debug(stanza.attrs.from + ' subscribed to me');

      return this.client.send(new ltx.Element('presence', {
        from: stanza.attrs.to,
        to: stanza.attrs.from,
        id: stanza.attrs.id,
        type: 'subscribed'
      }));
    case 'probe':
      this.robot.logger.debug(stanza.attrs.from + ' probed me');

      return this.client.send(new ltx.Element('presence', {
        from: stanza.attrs.to,
        to: stanza.attrs.from,
        id: stanza.attrs.id
      }));
    case 'available':
      var nick;
      try {
        nick = stanza.getChild('nick').getText();
      }
      catch (err) {
        nick = null;
      }

      if (fromJID.resource === this.robot.name || nick === this.robot.name) {
        this.heardOwnPresence = true;
        return;
      }

      room = fromJID.bare().toString();

      if (!this.messageFromRoom(room)) {
        return;
      }

      var privateChatJID = this.resolvePrivateJID(stanza);
      privateChatJID = privateChatJID && privateChatJID.toString();

      this.robot.logger.debug('Available received from ' + (fromJID.toString()) + ' in room ' + room + ' and private chat jid is ' + privateChatJID);

      var opts = {room: room, jid: fromJID.toString()};

      if (privateChatJID) {
        opts.privateChatJID = privateChatJID;
        this.roomToPrivateJID[fromJID.toString()] = privateChatJID;
      }

      return this.robot.brain.userForId(fromJID.resource, opts).then(function(user) {
        if (self.heardOwnPresence) {
          return self.receive(new EnterMessage(user));
        }
      });
    case 'unavailable':
      var from = stanza.attrs.from.split('/');
      room = from[0];
      var user = from[1];

      if (!this.messageFromRoom(room)) {
        return;
      }
      if (user === this.options.username) {
        return;
      }

      this.robot.logger.debug('Unavailable received from ' + user + ' in room ' + room);

      return this.robot.brain.userForId(user, {room: room}).then(function(user) {
        return self.receive(new LeaveMessage(user));
      });
  }
};

XmppBot.prototype.resolvePrivateJID = function(stanza) {
  var jid = new JID(stanza.attrs.from);

  var privateJID;
  try {
    privateJID = stanza.getChild('x', 'http://jabber.org/protocol/muc#user').getChild('item').attrs.jid;
  }
  catch (err) {
    privateJID = null;
  }

  if (!privateJID) {
    if (!this.anonymousGroupChatWarningLogged) {
      this.robot.logger.warning('Could not get private JID from group chat. Make sure the server is configured to broadcast real jid for groupchat (see http://xmpp.org/extensions/xep-0045.html#enter-nonanon)');
      this.anonymousGroupChatWarningLogged = true;
    }
    return null;
  }
  return new JID(privateJID);
};

XmppBot.prototype.messageFromRoom = function(room) {
  return this.rooms.has(room.toLowerCase());
};

XmppBot.prototype.send = function(envelope) {
  var self = this;
  var messages = Array.prototype.slice.call(arguments, 1);

  return this.connected.then(function() {
    var results = [];
    var msg;
    var to;
    var params;
    var message;
    var parsedMsg;
    var bodyMsg;

    for (var i = 0; i < messages.length; i++) {
      msg = messages[i];

      self.robot.logger.debug('Sending to ' + envelope.room + ': ' + msg);

      to = envelope.room;
      if (envelope.user.type === 'direct' || envelope.user.type === 'chat') {
        to = envelope.user.privateChatJID || envelope.room + "/" + envelope.user.name;
      }

      params = {
        to: to,
        type: envelope.user.type || 'groupchat'
      };

      if (msg.attrs) {
        message = msg.root();

        if (!message.attrs.to) {
          message.attrs.to = params.to;
        }

        if (!message.attrs.type) {
          message.attrs.type = params.type;
        }
      }
      else {
        try {
          parsedMsg = new ltx.parse(msg);
        }
        catch (err) {
          parsedMsg = null;
        }

        bodyMsg = new ltx.Element('message', params).c('body').t(msg);

        if (parsedMsg) {
          message = bodyMsg.up().c('html', {
            xmlns: 'http://jabber.org/protocol/xhtml-im'
          }).c('body', {
            xmlns: 'http://www.w3.org/1999/xhtml'
          }).cnode(parsedMsg);
        }
        else {
          message = bodyMsg;
        }
      }
      results.push(self.client.send(message));
    }

    return Q.all(results);
  });
};

XmppBot.prototype.reply = function(envelope) {
  var self = this;
  var messages = Array.prototype.slice.call(arguments, 1);

  return this.connected.then(function() {
    var results = [];

    for (var i = 0; i < messages.length; i++) {
      if (messages[i].attrs) {
        results.push(self.send(envelope, messages[i]));
      }
      else {
        results.push(self.send(envelope, envelope.user.name + ": " + messages[i]));
      }
    }

    return Q.all(results);
  });
};

XmppBot.prototype.topic = function(envelope) {
  var self = this;
  var string = Array.prototype.slice.call(arguments, 1).join('\n');

  return this.connected.then(function() {
    return self.client.send(new ltx.Element('message', {
      to: envelope.room,
      type: envelope.user.type
    }).c('subject').t(string));
  });
};

XmppBot.prototype.offline = function() {
  this.robot.logger.debug('Received offline event');
  return this.reconnect();
};

module.exports = XmppBot;
