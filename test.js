var Bot = require('.');
var XmppClient = require('node-xmpp-client');
var ltx = require('ltx');
var Brobbot = require('brobbot');
var Adapter = Brobbot.Adapter;
var Robot = Brobbot.Robot;
var EnterMessage = Brobbot.EnterMessage;
var LeaveMessage = Brobbot.LeaveMessage;
var TextMessage = Brobbot.TextMessage;
var assert = require('assert');
var sinon = require('sinon');
var Q = require('q');

describe('XmppBot', function() {
  describe('#parseRooms()', function() {
    var bot = new Bot();
    it('should split passwords', function() {
      var result, rooms;
      rooms = ['secretroom:password', 'room'];
      result = bot.parseRooms(rooms);
      assert.equal(result.length, 2);
      assert.equal(result[0].jid, 'secretroom');
      assert.equal(result[0].password, 'password');
      assert.equal(result[1].jid, 'room');
      assert.equal(result[1].password, '');
    });
  });

  describe('#joinRoom()', function() {
    var bot = new Bot();
    bot.client = {
      stub: 'xmpp client'
    };

    bot.robot = {
      name: 'bot',
      logger: {
        debug: function() {}
      }
    };

    var room = {
      jid: 'test@example.com',
      password: false
    };

    it('should call @client.send()', function(done) {
      bot.client.send = function(message) {
        done();
      };
      bot.joinRoom(room);
    });

    it('should call @client.send() with the appropriate protocol message', function(done) {
      bot.client.send = function(message) {
        assert.equal(message.name, 'x');
        assert.equal(message.attrs.xmlns, 'http://jabber.org/protocol/muc');
        assert.ok(message.parent);
        assert.equal(message.parent.name, 'presence');
        assert.equal(message.parent.attrs.to, room.jid + "/" + bot.robot.name);
        assert.equal(message.parent.attrs.type, null);
        assert.equal(message.children.length, 1);
        assert.equal(message.children[0].name, 'history');
        assert.equal(message.children[0].attrs.seconds, 1);
        done();
      };

      bot.joinRoom(room);
    });

    describe('and the room requires a password', function() {
      var protectedRoom = {
        jid: 'test@example.com',
        password: 'password'
      };

      it('should call @client.send() with the password', function(done) {
        bot.client.send = function(message) {
          assert.equal(message.name, 'x');
          assert.equal(message.children.length, 2);
          assert.equal(message.children[1].name, 'password');
          assert.equal(message.children[1].children[0], protectedRoom.password);
          done();
        };

        bot.joinRoom(protectedRoom);
      });
    });
  });

  describe('#ping()', function() {
    var bot = new Bot();
    bot.client = {
      stub: 'xmpp client'
    };

    var room = {
      jid: 'test@example.com',
      password: false
    };

    beforeEach(function() {
      bot.options = {
        rooms: [room]
      };
      bot.robot = {
        name: 'bot',
        logger: {
          debug: function() {}
        }
      };
    });

    it('should call @client.send() with a proper ping element', function(done) {
      bot.client.send = function(message) {
        assert.equal(message.name, 'iq');
        assert.equal(message.attrs.type, 'get');
        done();
      };

      bot.ping();
    });
  });

  describe('#leaveRoom()', function() {
    var bot = new Bot();
    bot.client = {
      stub: 'xmpp client'
    };

    var room = {
      jid: 'test@example.com',
      password: false
    };

    beforeEach(function() {
      bot.options = {
        rooms: [room]
      };
      bot.robot = {
        name: 'bot',
        logger: {
          debug: function() {}
        }
      };
    });

    it('should call @client.send()', function(done) {
      bot.client.send = function(message) {
        done();
      };
      bot.leaveRoom(room);

      assert.deepEqual([], bot.options.rooms);
    });

    it('should call @client.send() with a presence element', function(done) {
      bot.client.send = function(message) {
        assert.equal(message.name, 'presence');
        done();
      };

      bot.leaveRoom(room);
    });

    it('should call @client.send() with the room and bot name', function(done) {
      bot.client.send = function(message) {
        assert.equal(message.attrs.to, room.jid + "/" + bot.robot.name);
        done();
      };

      bot.leaveRoom(room);
    });

    it('should call @client.send() with type unavailable', function(done) {
      bot.client.send = function(message) {
        assert.equal(message.attrs.type, 'unavailable');
        done();
      };

      bot.leaveRoom(room);
    });
  });

  describe('#readIq', function() {
    var stanza = '';
    var bot = new Bot();
    bot.client = {
      stub: 'xmpp client'
    };

    bot.client.send = function() {
      throw new Error("shouldn't have called send.");
    };

    bot.robot = {
      name: 'bot',
      userForId: function() {
        return Q({id: 1});
      },
      logger: {
        debug: function() {}
      }
    };

    beforeEach(function() {
      stanza = {
        attrs: {
          type: 'get',
          from: 'test@example.com/ernie',
          to: 'user@example.com/element84',
          id: '1234'
        },
        children: [
          {
            name: 'query'
          }
        ]
      };
    });

    it('should ignore non-ping iqs', function() {
      assert.equal(bot.readIq(stanza), null);
    });

    it('should reply to ping iqs with a pong result', function(done) {
      stanza.children = [
        {
          name: 'ping'
        }
      ];

      bot.client.send = function(pong) {
        assert.equal(pong.name, 'iq');
        assert.equal(pong.attrs.to, stanza.attrs.from);
        assert.equal(pong.attrs.from, stanza.attrs.to);
        assert.equal(pong.attrs.id, stanza.attrs.id);
        assert.equal(pong.attrs.type, 'result');
        done();
      };

      bot.readIq(stanza);
    });
  });

  describe('#readMessage()', function() {
    var stanza = '';
    var bot = new Bot();

    bot.options = {
      username: 'bot',
      rooms: [
        {
          jid: 'test@example.com',
          password: false
        }
      ]
    };

    bot.receive = function() {
      throw new Error('bad');
    };

    bot.robot = {
      name: 'bot',
      brain: {
        userForId: function(id, options) {
          var k, user;
          user = {};
          user['name'] = id;
          for (k in options || {}) {
            user[k] = options[k];
          }
          return Q(user);
        }
      },
      logger: {
        debug: function() {},
        warning: function() {}
      }
    };

    beforeEach(function() {
      stanza = {
        attrs: {
          type: 'chat',
          from: 'test@example.com/ernie'
        },
        getChild: function() {
          return {
            getText: function() {
              return 'message text';
            }
          };
        }
      };
    });

    it('should refuse types', function() {
      stanza.attrs.type = 'other';
      assert.equal(bot.readMessage(stanza), null);
    });

    it('should ignore messages from self', function() {
      bot.options.username = 'bot';
      stanza.attrs.type = 'groupchat';
      stanza.attrs.from = 'room@example.com/bot';
      assert.equal(bot.readMessage(stanza), null);
    });

    it('should ignore messages from the room', function() {
      stanza.attrs.type = 'groupchat';
      stanza.attrs.from = 'test@example.com';
      assert.equal(bot.readMessage(stanza), null);
    });

    it('should ignore messages with no body', function() {
      stanza.getChild = function() {
        return '';
      };
      assert.equal(bot.readMessage(stanza), null);
    });

    it('should ignore messages we sent part 2', function() {
      stanza.attrs.type = 'groupchat';
      stanza.attrs.from = 'test@example.com/bot';
      assert.equal(bot.readMessage(stanza), null);
    });

    it('should send a message for private message', function(done) {

      bot.receive = function(message) {
        assert.equal(message.user.type, 'chat');
        assert.equal(message.user.name, 'test');
        assert.equal(message.user.privateChatJID, 'test@example.com/ernie');
        assert.equal(message.user.room, null);
        assert.equal(message.text, 'message text');
        done();
      };

      bot.readMessage(stanza);
    });

    it('should send a message for groupchat', function(done) {
      stanza.attrs.type = 'groupchat';

      bot.receive = function(message) {
        assert.equal(message.user.type, 'groupchat');
        assert.equal(message.user.name, 'ernie');
        assert.equal(message.user.room, 'test@example.com');
        assert.equal(message.text, 'message text');
        done();
      };

      bot.readMessage(stanza);
    });
  });

  describe('#reply()', function() {
    var bot = new Bot();
    bot.connectedDefer.resolve();
    var envelope = {
      user: {
        name: 'mark'
      }
    };

    it('should call send()', function(done) {
      bot.send = function(envelope, message) {
        assert.equal(message, 'mark: one');
        done();
      };

      bot.reply(envelope, 'one');
    });

    it('should call send() multiple times', function(done) {
      var called = 0;

      bot.send = function(envelope, message) {
        called += 1;
        if (called === 2) {
          done();
        }
      };

      bot.reply(envelope, 'one', 'two');
    });
  });

  describe('#topic()', function() {
    var bot = new Bot();
    bot.connectedDefer.resolve();

    bot.client = {
      stub: 'xmpp client'
    };

    var envelope = {
      user: {
        name: 'mark'
      },
      room: 'test@example.com'
    };

    it('should call @client.send()', function(done) {
      bot.client.send = function(message) {
        assert.equal(message.parent.attrs.to, envelope.room);
        assert.equal('test', message.children[0]);
        done();
      };

      bot.topic(envelope, 'test');
    });

    it('should call @client.send() with newlines', function(done) {
      bot.client.send = function(message) {
        assert.equal("one\ntwo", message.children[0]);
        done();
      };
      bot.topic(envelope, 'one', 'two');
    });
  });

  describe('#error()', function() {
    var bot = new Bot();

    bot.robot = {
      logger: {
        error: function() {}
      }
    };

    before(function() {
      bot.robot = {
        logger: {
          error: function() {}
        }
      };
    });

    it('should handle ECONNREFUSED', function(done) {
      bot.robot.logger.error = function() {
        assert.ok('error logging happened.');
        done();
      };

      var error = {
        code: 'ECONNREFUSED'
      };

      bot.error(error);
    });

    it('should handle system-shutdown', function(done) {
      bot.robot.logger.error = function() {
        assert.ok('exit was called');
        done();
      };

      var error = {
        children: [
          {
            name: 'system-shutdown'
          }
        ]
      };

      bot.error(error);
    });
  });

  describe('#read()', function() {
    var bot = new Bot();
    bot.robot = {
      logger: {
        error: function() {}
      }
    };

    it('should log errors', function(done) {
      bot.robot.logger.error = function(message) {
        var text = String(message);
        assert.ok(text.indexOf('xmpp error') > 0);
        assert.ok(text.indexOf('fail') > 0);
        done();
      };

      var stanza = {
        attrs: {
          type: 'error'
        },
        toString: function() {
          return 'fail';
        }
      };

      bot.read(stanza);
    });

    it('should delegate to readMessage', function(done) {
      var stanza = {
        attrs: {
          type: 'chat'
        },
        name: 'message'
      };

      bot.readMessage = function(arg) {
        assert.equal(arg.name, stanza.name);
        return done();
      };

      bot.read(stanza);
    });

    it('should delegate to readPresence', function(done) {
      var stanza = {
        attrs: {
          type: 'chat'
        },
        name: 'presence'
      };

      bot.readPresence = function(arg) {
        assert.equal(arg.name, stanza.name);
        done();
      };

      bot.read(stanza);
    });
  });

  describe('#readPresence()', function() {
    var robot = null;
    var bot = null;

    beforeEach(function() {
      robot = {
        name: 'bot',
        logger: {
          debug: function() {}
        },
        brain: {
          userForId: function(id, options) {
            var k, user;
            user = {};
            user['name'] = id;
            for (k in options || {}) {
              user[k] = options[k];
            }
            return Q(user);
          }
        }
      };

      bot = new Bot(robot);

      bot.options = {
        username: 'bot',
        rooms: [
          {
            jid: 'test@example.com',
            password: false
          }
        ]
      };

      bot.client = {
        send: function() {}
      };
    });

    it('should handle subscribe types', function(done) {
      var stanza = {
        attrs: {
          type: 'subscribe',
          to: 'bot@example.com',
          from: 'room@example.com/mark',
          id: '12345'
        }
      };

      bot.client.send = function(el) {
        assert.equal(el.attrs.from, stanza.attrs.to);
        assert.equal(el.attrs.to, stanza.attrs.from);
        assert.equal(el.attrs.type, 'subscribed');
        done();
      };

      bot.readPresence(stanza);
    });

    it('should handle probe types', function(done) {
      var stanza = {
        attrs: {
          type: 'probe',
          to: 'bot@example.com',
          from: 'room@example.com/mark',
          id: '12345'
        }
      };

      bot.client.send = function(el) {
        assert.equal(el.attrs.from, stanza.attrs.to);
        assert.equal(el.attrs.to, stanza.attrs.from);
        assert.equal(el.attrs.type, null);
        done();
      };

      bot.readPresence(stanza);
    });

    it('should do nothing on missing item in available type', function() {
      var stanza = {
        attrs: {
          type: 'available',
          to: 'bot@example.com',
          from: 'room@example.com/mark',
          id: '12345'
        }
      };

      var tmp_userForId = robot.brain.userForId;

      robot.brain.userForId = function(id, user) {
        assert.equal(id, 'mark');
        return Q(user);
      };

      bot.readPresence(stanza);

      robot.brain.userForId = tmp_userForId;
    });

    it('should not trigger @recieve for presences coming from a room the bot is not in', function() {
      bot.receive = function(msg) {
        throw new Error('should not get here');
      };

      var stanza = {
        attrs: {
          type: 'available',
          to: 'bot@example.com',
          from: 'room@example.com/mark',
          id: '12345'
        }
      };

      bot.readPresence(stanza);
    });

    it('should set @heardOwnPresence when the bot presence is received', function() {
      var stanza1 = {
        attrs: {
          type: 'available',
          to: 'bot@example.com',
          from: 'test@example.com/bot'
        },
        getChild: function() {
          return {
            getChild: function() {
              return {
                attrs: {
                  jid: 'bot@example.com'
                }
              };
            }
          };
        }
      };

      var stanza2 = {
        attrs: {
          type: 'available',
          to: 'bot@example.com',
          from: 'test@example.com/2578936351142164331380805'
        },
        getChild: function() {
          return {
            getText: function() {
              return 'bot';
            }
          };
        }
      };
      bot.readPresence(stanza1);
      assert.ok(bot.heardOwnPresence);
      bot.heardOwnPresence = false;
      bot.readPresence(stanza2);
      assert.ok(bot.heardOwnPresence);
    });

    it('should not send event if we have not heard our own presence', function() {
      bot.heardOwnPresence = false;

      bot.receive = function(msg) {
        throw new Error('Should not send a message yet');
      };

      var stanza = {
        attrs: {
          type: 'available',
          to: 'bot@example.com',
          from: 'test@example.com/mark'
        },
        getChild: function() {
          return {
            getChild: function() {
              return {
                attrs: {
                  jid: 'bot@example.com'
                }
              };
            }
          };
        }
      };

      bot.readPresence(stanza);
    });

    it('should call @receive when someone joins', function() {
      bot.heardOwnPresence = true;

      bot.receive = function(msg) {
        assert.ok(msg instanceof EnterMessage);
        assert.equal(msg.user.name, 'mark');
        assert.equal(msg.user.room, 'test@example.com');
        assert.equal(msg.user.privateChatJID, 'mark@example.com/mark');
      };

      var stanza = {
        attrs: {
          type: 'available',
          to: 'bot@example.com',
          from: 'test@example.com/mark'
        },
        getChild: function() {
          return {
            getChild: function() {
              return {
                attrs: {
                  jid: 'mark@example.com/mark'
                }
              };
            }
          };
        }
      };

      bot.readPresence(stanza);
    });

    it('should call @receive when someone leaves', function() {
      bot.receive = function(msg) {
        assert.ok(msg instanceof LeaveMessage);
        return assert.equal(msg.user.room, 'test@example.com');
      };

      var stanza = {
        attrs: {
          type: 'unavailable',
          to: 'bot@example.com',
          from: 'test@example.com/mark'
        }
      };

      bot.readPresence(stanza);
    });
  });

  describe('#send()', function() {
    var bot = new Bot();
    bot.connectedDefer.resolve();

    bot.options = {
      username: 'bot',
      rooms: [
        {
          jid: 'test@example.com',
          password: false
        }
      ]
    };

    bot.client = {
      send: function() {}
    };

    bot.robot = {
      logger: {
        debug: function() {}
      }
    };

    it('should use type groupchat if type is undefined', function(done) {
      var envelope = {
        user: {
          id: 'mark'
        },
        room: 'test@example.com'
      };

      bot.client.send = function(msg) {
        assert.equal(msg.parent.attrs.to, 'test@example.com');
        assert.equal(msg.parent.attrs.type, 'groupchat');
        assert.equal(msg.getText(), 'testing');
        done();
      };

      bot.send(envelope, 'testing');
    });

    it('should send messages directly when message was private', function(done) {
      var envelope = {
        user: {
          id: 'mark',
          type: 'direct',
          privateChatJID: 'mark@example.com'
        },
        room: null
      };

      bot.client.send = function(msg) {
        assert.equal(msg.parent.attrs.to, 'mark@example.com');
        assert.equal(msg.parent.attrs.type, 'direct');
        assert.equal(msg.getText(), 'testing');
        done();
      };

      bot.send(envelope, 'testing');
    });

    it('should send messages directly when message was from groupchat and real JID was provided', function(done) {
      var envelope = {
        user: {
          id: 'room@example.com/mark',
          type: 'direct',
          privateChatJID: 'mark@example.com'
        },
        room: 'room@example.com'
      };

      bot.client.send = function(msg) {
        assert.equal(msg.parent.attrs.to, 'mark@example.com');
        assert.equal(msg.parent.attrs.type, 'direct');
        assert.equal(msg.getText(), 'testing');
        done();
      };

      bot.send(envelope, 'testing');
    });

    it('should send a message to private room JID when message was from groupchat and real JID was not provided', function(done) {
      var envelope = {
        user: {
          name: 'mark',
          room: 'room@example.com',
          type: 'direct'
        },
        room: 'room@example.com'
      };

      bot.client.send = function(msg) {
        assert.equal(msg.parent.attrs.to, 'room@example.com/mark');
        assert.equal(msg.parent.attrs.type, 'direct');
        assert.equal(msg.getText(), 'testing');
        done();
      };

      bot.send(envelope, 'testing');
    });

    it('should send messages to the room', function(done) {
      var envelope = {
        user: {
          name: 'mark',
          type: 'groupchat'
        },
        room: 'test@example.com'
      };

      bot.client.send = function(msg) {
        assert.equal(msg.parent.attrs.to, 'test@example.com');
        assert.equal(msg.parent.attrs.type, 'groupchat');
        assert.equal(msg.getText(), 'testing');
        done();
      };

      bot.send(envelope, 'testing');
    });

    it('should accept ltx.Element objects as messages', function(done) {
      var el, envelope;
      envelope = {
        user: {
          name: 'mark',
          type: 'groupchat'
        },
        room: 'test@example.com'
      };

      el = new ltx.Element('message').c('body').t('testing');

      bot.client.send = function(msg) {
        assert.equal(msg.root().attrs.to, 'test@example.com');
        assert.equal(msg.root().attrs.type, 'groupchat');
        assert.equal(msg.root().getText(), el.root().getText());
        return done();
      };

      bot.send(envelope, el);
    });

    it('should send XHTML messages to the room', function(done) {
      var envelope;
      envelope = {
        user: {
          name: 'mark',
          type: 'groupchat'
        },
        room: 'test@example.com'
      };

      bot.client.send = function(msg) {
        assert.equal(msg.root().attrs.to, 'test@example.com');
        assert.equal(msg.root().attrs.type, 'groupchat');
        assert.equal(msg.root().children[0].getText(), "<p><span style='color: #0000ff;'>testing</span></p>");
        assert.equal(msg.parent.parent.name, 'html');
        assert.equal(msg.parent.parent.attrs.xmlns, 'http://jabber.org/protocol/xhtml-im');
        assert.equal(msg.parent.name, 'body');
        assert.equal(msg.parent.attrs.xmlns, 'http://www.w3.org/1999/xhtml');
        assert.equal(msg.name, 'p');
        assert.equal(msg.children[0].name, 'span');
        assert.equal(msg.children[0].attrs.style, 'color: #0000ff;');
        assert.equal(msg.children[0].getText(), 'testing');
        done();
      };

      bot.send(envelope, "<p><span style='color: #0000ff;'>testing</span></p>");
    });
  });

  describe('#online', function() {
    var bot = null;

    beforeEach(function() {
      bot = new Bot();
      bot.connectedDefer.resolve();

      bot.options = {
        username: 'mybot@example.com',
        rooms: [
          {
            jid: 'test@example.com',
            password: false
          }
        ]
      };

      bot.client = {
        connection: {
          socket: {
            setTimeout: function() {},
            setKeepAlive: function() {}
          }
        },
        send: function() {}
      };

      bot.robot = {
        name: 'bert',
        logger: {
          debug: function() {},
          info: function() {}
        }
      };
    });

    it('should emit connected event', function(done) {
      var callCount = 0;

      bot.connected.then(function() {
        assert.equal(callCount, expected.length, 'Call count is wrong');
        done();
      });

      var expected = [
        function(msg) {
          var nick, root;
          root = msg.tree();
          assert.equal('presence', msg.name, 'Element name is incorrect');
          nick = root.getChild('nick');
          assert.equal('bert', nick.getText());
        }, function(msg) {
          var root;
          root = msg.tree();
          assert.equal('presence', root.name, 'Element name is incorrect');
          assert.equal("test@example.com/bert", root.attrs.to, 'Msg sent to wrong room');
        }
      ];

      bot.client.send = function(msg) {
        if (expected[callCount]) {
          expected[callCount](msg);
        }
        return callCount++;
      };
      bot.online();
    });
  });
  describe('privateChatJID', function() {
    var bot = null;

    beforeEach(function() {
      bot = new Bot();

      bot.heardOwnPresence = true;

      bot.options = {
        username: 'bot',
        rooms: [
          {
            jid: 'test@example.com',
            password: false
          }
        ]
      };

      bot.client = {
        send: function() {}
      };

      bot.robot = {
        name: 'bot',
        on: function() {},
        brain: {
          users: {},
          userForId: function(id, options) {
            var user = this.users[id] || {};
            user['name'] = id;
            for (var k in options || {}) {
              if (options.hasOwnProperty(k)) {
                user[k] = options[k];
              }
            }
            this.users[id] = user;
            return Q(user);
          }
        },
        logger: {
          debug: function() {},
          warning: function() {},
          info: function() {}
        }
      };
    });
    it('should add private jid to user when presence contains http://jabber.org/protocol/muc#user', function() {
      bot.receive = function(msg) {};

      var stanza = {
        attrs: {
          type: 'available',
          to: 'bot@example.com',
          from: 'test@example.com/mark'
        },
        getChild: function() {
          return {
            getChild: function() {
              return {
                attrs: {
                  jid: 'mark@example.com/mark'
                }
              };
            }
          };
        }
      };

      return bot.readPresence(stanza).then(function() {
        stanza = {
          attrs: {
            type: 'groupchat',
            from: 'test@example.com/mark'
          },
          getChild: function() {
            return {
              getText: function() {
                return 'message text';
              }
            };
          }
        };

        bot.receive = function(msg) {
          assert.ok(msg instanceof TextMessage);
          assert.equal(msg.user.name, 'mark');
          assert.equal(msg.user.room, 'test@example.com');
          assert.equal(msg.user.privateChatJID, 'mark@example.com/mark');
        };

        return bot.readMessage(stanza);
      });
    });

    it('should not fail when presence does not contain http://jabber.org/protocol/muc#user', function() {
      bot.receive = function(msg) {};

      var stanza = {
        attrs: {
          type: 'available',
          to: 'bot@example.com',
          from: 'test@example.com/mark'
        },
        getChild: function() {
          return null;
        }
      };

      return bot.readPresence(stanza).then(function() {
        stanza = {
          attrs: {
            type: 'groupchat',
            from: 'test@example.com/mark'
          },
          getChild: function() {
            var body = {
              getText: function() {
                return 'message text';
              }
            };
          }
        };

        bot.receive = function(msg) {
          assert.ok(msg instanceof TextMessage);
          assert.equal(msg.user.name, 'mark');
          assert.equal(msg.user.room, 'test@example.com');
          assert.equal(msg.user.privateChatJID, null);
        };

        return bot.readMessage(stanza);
      });
    });
  });

  describe('#configClient', function() {
    var bot = null;
    var clock = null;
    var options = {
      keepaliveInterval: 30000
    };

    beforeEach(function() {
      clock = sinon.useFakeTimers();
      bot = new Bot();
      bot.connectedDefer.resolve();

      bot.client = {
        connection: {
          socket: {}
        },
        on: function() {},
        send: function() {}
      };
    });

    afterEach(function() {
      clock.restore();
    });

    it('should set timeouts', function() {
      bot.client.connection.socket.setTimeout = function(val) {
        assert.equal(0, val, 'Should be 0');
      };

      bot.ping = sinon.stub();
      bot.configClient(options);

      clock.tick(options.keepaliveInterval);

      assert(bot.ping.called);
    });

    it('should set event listeners', function() {
      var onCalls = [];

      bot.client.connection.socket.setTimeout = function() {};

      bot.client.on = function(event, cb) {
        onCalls.push(event);
      };

      bot.configClient(options);

      var expected = ['error', 'online', 'offline', 'stanza'];

      assert.deepEqual(onCalls, expected);
    });
  });

  describe('#reconnect', function() {
    var bot, clock, mock;
    bot = clock = mock = null;

    beforeEach(function() {
      bot = new Bot();

      bot.robot = {
        logger: {
          info: sinon.stub(),
          error: sinon.stub()
        }
      };

      bot.client = {
        removeListener: function() {}
      };

      clock = sinon.useFakeTimers();
    });

    afterEach(function() {
      clock.restore();
      if (mock) {
        mock.restore();
      }
    });

    it('should attempt a reconnect and increment retry count', function() {
      assert.equal(0, bot.reconnectTryCount);

      bot.reconnect();

      assert.equal(1, bot.reconnectTryCount, 'No time elapsed');

      bot.online();

      return bot.connected.then(function() {
        assert.ok(true, 'Attempted to make a new client');
      });
    });
  });
});
