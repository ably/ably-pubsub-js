'use strict';

define(['ably', 'shared_helper', 'chai', 'materializer'], function (Ably, Helper, chai, Materializer) {
  const expect = chai.expect;
  const MessageMaterializer = Materializer.MessageMaterializer;
  const parsePartialJSON = Materializer.parsePartialJSON;
  const Allow = Materializer.Allow;

  describe('realtime/materializer', function () {
    this.timeout(60 * 1000);

    before(function (done) {
      const helper = Helper.forHook(this);
      helper.setupApp(function (err) {
        if (err) {
          done(err);
          return;
        }
        done();
      });
    });

    describe('partial-json parser', function () {
      it('parses complete JSON', function () {
        expect(parsePartialJSON('{"a": 1, "b": "hello"}')).to.deep.equal({ a: 1, b: 'hello' });
      });

      it('parses incomplete object (missing closing brace)', function () {
        const result = parsePartialJSON('{"a": 1, "b": "hello"');
        expect(result).to.deep.equal({ a: 1, b: 'hello' });
      });

      it('parses incomplete string value', function () {
        const result = parsePartialJSON('{"content": "The quick bro');
        expect(result).to.deep.equal({ content: 'The quick bro' });
      });

      it('parses incomplete nested object', function () {
        const result = parsePartialJSON('{"model": "gpt-4", "choices": [{"message": {"content": "hel');
        expect(result).to.deep.equal({
          model: 'gpt-4',
          choices: [{ message: { content: 'hel' } }],
        });
      });

      it('parses incomplete array', function () {
        const result = parsePartialJSON('[1, 2, 3');
        expect(result).to.deep.equal([1, 2, 3]);
      });

      it('parses empty incomplete object', function () {
        const result = parsePartialJSON('{');
        expect(result).to.deep.equal({});
      });

      it('parses empty incomplete array', function () {
        const result = parsePartialJSON('[');
        expect(result).to.deep.equal([]);
      });

      it('parses incomplete key (no value yet)', function () {
        const result = parsePartialJSON('{"a": 1, "b"');
        expect(result).to.deep.equal({ a: 1 });
      });

      it('parses incomplete key with colon (no value yet)', function () {
        const result = parsePartialJSON('{"a": 1, "b":');
        expect(result).to.deep.equal({ a: 1 });
      });

      it('throws for empty input', function () {
        expect(function () { parsePartialJSON(''); }).to.throw();
        expect(function () { parsePartialJSON('   '); }).to.throw();
      });

      it('parses booleans and null', function () {
        expect(parsePartialJSON('true')).to.equal(true);
        expect(parsePartialJSON('false')).to.equal(false);
        expect(parsePartialJSON('null')).to.equal(null);
      });

      it('parses numbers', function () {
        expect(parsePartialJSON('42')).to.equal(42);
        expect(parsePartialJSON('-3.14')).to.equal(-3.14);
        expect(parsePartialJSON('1e10')).to.equal(1e10);
      });

      it('handles string escapes', function () {
        const result = parsePartialJSON('{"msg": "hello\\nworld"}');
        expect(result).to.deep.equal({ msg: 'hello\nworld' });
      });

      it('handles unicode escapes', function () {
        const result = parsePartialJSON('{"emoji": "\\u0041"}');
        expect(result).to.deep.equal({ emoji: 'A' });
      });

      // Upstream tests from promplate/partial-json-parser-js
      describe('Allow flags (upstream parity)', function () {
        it('partial string with STR flag', function () {
          expect(parsePartialJSON('"', Allow.STR)).to.equal('');
          expect(parsePartialJSON('"hello', Allow.STR)).to.equal('hello');
        });

        it('partial string throws without STR flag', function () {
          expect(function () { parsePartialJSON('"', ~Allow.STR); }).to.throw();
        });

        it('partial array with ARR flag', function () {
          expect(parsePartialJSON('["', Allow.ARR)).to.deep.equal([]);
          expect(parsePartialJSON('["', Allow.ARR | Allow.STR)).to.deep.equal(['']);
        });

        it('partial array throws without ARR flag', function () {
          expect(function () { parsePartialJSON('[', Allow.STR); }).to.throw();
          expect(function () { parsePartialJSON('["', Allow.STR); }).to.throw();
          expect(function () { parsePartialJSON('[""', Allow.STR); }).to.throw();
          expect(function () { parsePartialJSON('["",', Allow.STR); }).to.throw();
        });

        it('partial object with OBJ flag', function () {
          expect(parsePartialJSON('{"": "', Allow.OBJ)).to.deep.equal({});
          expect(parsePartialJSON('{"": "', Allow.OBJ | Allow.STR)).to.deep.equal({ '': '' });
        });

        it('partial object throws without OBJ flag', function () {
          expect(function () { parsePartialJSON('{', Allow.STR); }).to.throw();
          expect(function () { parsePartialJSON('{"', Allow.STR); }).to.throw();
          expect(function () { parsePartialJSON('{""', Allow.STR); }).to.throw();
          expect(function () { parsePartialJSON('{"":', Allow.STR); }).to.throw();
          expect(function () { parsePartialJSON('{"":"', Allow.STR); }).to.throw();
          expect(function () { parsePartialJSON('{"":""', Allow.STR); }).to.throw();
        });

        it('partial singletons with flags', function () {
          expect(parsePartialJSON('n', Allow.NULL)).to.equal(null);
          expect(function () { parsePartialJSON('n', ~Allow.NULL); }).to.throw();

          expect(parsePartialJSON('t', Allow.BOOL)).to.equal(true);
          expect(function () { parsePartialJSON('t', ~Allow.BOOL); }).to.throw();

          expect(parsePartialJSON('f', Allow.BOOL)).to.equal(false);
          expect(function () { parsePartialJSON('f', ~Allow.BOOL); }).to.throw();

          expect(parsePartialJSON('I', Allow.INFINITY)).to.equal(Infinity);
          expect(function () { parsePartialJSON('I', ~Allow.INFINITY); }).to.throw();

          expect(parsePartialJSON('-I', Allow._INFINITY)).to.equal(-Infinity);
          expect(function () { parsePartialJSON('-I', ~Allow._INFINITY); }).to.throw();

          expect(Number.isNaN(parsePartialJSON('N', Allow.NAN))).to.equal(true);
          expect(function () { parsePartialJSON('N', ~Allow.NAN); }).to.throw();
        });

        it('number parsing with and without NUM flag', function () {
          expect(parsePartialJSON('0', ~Allow.NUM)).to.equal(0);
          expect(parsePartialJSON('-1.25e+4', ~Allow.NUM)).to.equal(-1.25e4);
          expect(parsePartialJSON('-1.25e+', Allow.NUM)).to.equal(-1.25);
          expect(parsePartialJSON('-1.25e', Allow.NUM)).to.equal(-1.25);
        });
      });

      describe('edge cases', function () {
        it('handles incomplete escape at end of string', function () {
          expect(parsePartialJSON('"hello\\', Allow.STR)).to.equal('hello');
        });

        it('handles incomplete unicode escape', function () {
          expect(parsePartialJSON('"hello\\u00', Allow.STR)).to.equal('hello');
        });

        it('handles all escape sequences', function () {
          expect(parsePartialJSON('"\\"\\\\\\/\\b\\f\\n\\r\\t"')).to.equal('"\\/\b\f\n\r\t');
        });

        it('handles whitespace around values', function () {
          expect(parsePartialJSON('  { "a" : 1 , "b" : 2 }  ')).to.deep.equal({ a: 1, b: 2 });
        });

        it('handles deeply nested partial structures', function () {
          var result = parsePartialJSON('{"a": {"b": {"c": {"d": "deep');
          expect(result).to.deep.equal({ a: { b: { c: { d: 'deep' } } } });
        });

        it('handles array with trailing comma', function () {
          expect(parsePartialJSON('[1, 2,', Allow.ARR)).to.deep.equal([1, 2]);
        });

        it('handles object with trailing comma', function () {
          expect(parsePartialJSON('{"a": 1,', Allow.OBJ)).to.deep.equal({ a: 1 });
        });

        it('handles negative numbers', function () {
          expect(parsePartialJSON('-', Allow.NUM)).to.equal(0);
          expect(parsePartialJSON('-42')).to.equal(-42);
        });

        it('handles scientific notation variants', function () {
          expect(parsePartialJSON('1E10')).to.equal(1e10);
          expect(parsePartialJSON('1e+10')).to.equal(1e10);
          expect(parsePartialJSON('1e-10')).to.equal(1e-10);
        });

        it('handles mixed nested arrays and objects', function () {
          var result = parsePartialJSON('[{"a": [1, 2]}, {"b": [3');
          expect(result).to.deep.equal([{ a: [1, 2] }, { b: [3] }]);
        });

        it('rejects invalid input types', function () {
          expect(function () { parsePartialJSON(123); }).to.throw(TypeError);
          expect(function () { parsePartialJSON(null); }).to.throw(TypeError);
        });

        it('handles complete Infinity and NaN', function () {
          expect(parsePartialJSON('Infinity')).to.equal(Infinity);
          expect(parsePartialJSON('-Infinity')).to.equal(-Infinity);
          expect(Number.isNaN(parsePartialJSON('NaN'))).to.equal(true);
        });
      });
    });

    describe('MessageMaterializer', function () {
      /**
       * Test that materializer receives create messages and emits them with toPartialJSON
       */
      it('emits create messages with toPartialJSON', async function () {
        const helper = this.test.helper;
        const realtime = helper.AblyRealtime();

        try {
          const channel = realtime.channels.get('mutable:materializer_create_' + Date.now());
          await channel.attach();

          const materializer = new MessageMaterializer(channel);

          const received = new Promise(function (resolve) {
            materializer.subscribe(function (msg) {
              resolve(msg);
            });
          });

          await channel.publish('test', '{"key": "value"}');

          const msg = await received;
          expect(msg.action).to.equal('message.create');
          expect(msg.data).to.equal('{"key": "value"}');
          expect(msg.toPartialJSON).to.be.a('function');

          const parsed = msg.toPartialJSON();
          expect(parsed).to.deep.equal({ key: 'value' });

          materializer.unsubscribe();
        } finally {
          realtime.close();
        }
      });

      /**
       * Test that materializer accumulates appended data
       */
      it('accumulates message.append data', async function () {
        const helper = this.test.helper;
        const realtime = helper.AblyRealtime();

        try {
          const channel = realtime.channels.get('mutable:materializer_append_' + Date.now());
          await channel.attach();

          const materializer = new MessageMaterializer(channel);

          var appendResolve;
          var appendDone = new Promise(function (resolve) {
            appendResolve = resolve;
          });

          materializer.subscribe(function (msg) {
            if (msg.action === 'message.append') {
              appendResolve(msg);
            }
          });

          // Publish original message
          var result = await channel.publish('stream', 'Hello');
          var serial = result.serials[0];

          // Append data
          await channel.appendMessage({ serial: serial, data: ' World' });

          var appendedMsg = await appendDone;

          // The materializer should have accumulated the data
          expect(appendedMsg.data).to.equal('Hello World');
          expect(appendedMsg.action).to.equal('message.append');
          expect(appendedMsg.serial).to.equal(serial);

          materializer.unsubscribe();
        } finally {
          realtime.close();
        }
      });

      /**
       * Test that toPartialJSON works with incomplete JSON being streamed
       */
      it('toPartialJSON renders incomplete JSON during streaming', async function () {
        const helper = this.test.helper;
        const realtime = helper.AblyRealtime();

        try {
          const channel = realtime.channels.get('mutable:materializer_partial_json_' + Date.now());
          await channel.attach();

          const materializer = new MessageMaterializer(channel);

          var latestMsg;
          var appendCount = 0;
          var allDone = new Promise(function (resolve) {
            materializer.subscribe(function (msg) {
              latestMsg = msg;
              if (msg.action === 'message.append') {
                appendCount++;
                if (appendCount === 2) resolve();
              }
            });
          });

          // Publish start of JSON object
          var result = await channel.publish('ai-response', '{"model": "test", "content": "');
          var serial = result.serials[0];

          // Append tokens
          await channel.appendMessage({ serial: serial, data: 'Hello ' });
          await channel.appendMessage({ serial: serial, data: 'World' });

          await allDone;

          // The partial JSON should parse the incomplete JSON
          var parsed = latestMsg.toPartialJSON();
          expect(parsed).to.have.property('model', 'test');
          expect(parsed).to.have.property('content', 'Hello World');

          materializer.unsubscribe();
        } finally {
          realtime.close();
        }
      });

      /**
       * Test that materializer handles multiple appends in sequence
       */
      it('handles multiple sequential appends', async function () {
        const helper = this.test.helper;
        const realtime = helper.AblyRealtime();

        try {
          const channel = realtime.channels.get('mutable:materializer_multi_append_' + Date.now());
          await channel.attach();

          const materializer = new MessageMaterializer(channel);

          var tokens = ['The ', 'quick ', 'brown ', 'fox'];
          var appendCount = 0;
          var allAppendsDone = new Promise(function (resolve) {
            materializer.subscribe(function (msg) {
              if (msg.action === 'message.append') {
                appendCount++;
                if (appendCount === tokens.length) resolve(msg);
              }
            });
          });

          var result = await channel.publish('stream', 'Start: ');
          var serial = result.serials[0];

          for (var i = 0; i < tokens.length; i++) {
            await channel.appendMessage({ serial: serial, data: tokens[i] });
          }

          var finalMsg = await allAppendsDone;
          expect(finalMsg.data).to.equal('Start: The quick brown fox');

          materializer.unsubscribe();
        } finally {
          realtime.close();
        }
      });

      /**
       * Test that materializer caches messages and getMessages() returns them
       */
      it('caches messages accessible via getMessages()', async function () {
        const helper = this.test.helper;
        const realtime = helper.AblyRealtime();

        try {
          const channel = realtime.channels.get('mutable:materializer_cache_' + Date.now());
          await channel.attach();

          const materializer = new MessageMaterializer(channel);

          var count = 0;
          var allReceived = new Promise(function (resolve) {
            materializer.subscribe(function () {
              count++;
              if (count === 2) resolve();
            });
          });

          await channel.publish('msg1', 'data1');
          await channel.publish('msg2', 'data2');

          await allReceived;

          var messages = materializer.getMessages();
          expect(messages).to.have.length(2);
          expect(messages[0].name).to.equal('msg1');
          expect(messages[1].name).to.equal('msg2');

          materializer.unsubscribe();
        } finally {
          realtime.close();
        }
      });

      /**
       * Test getMessage() returns a specific cached message
       */
      it('getMessage() returns specific cached message by serial', async function () {
        const helper = this.test.helper;
        const realtime = helper.AblyRealtime();

        try {
          const channel = realtime.channels.get('mutable:materializer_getmsg_' + Date.now());
          await channel.attach();

          const materializer = new MessageMaterializer(channel);

          var receivedSerial;
          var received = new Promise(function (resolve) {
            materializer.subscribe(function (msg) {
              receivedSerial = msg.serial;
              resolve();
            });
          });

          await channel.publish('test', 'data');
          await received;

          var cached = materializer.getMessage(receivedSerial);
          expect(cached).to.exist;
          expect(cached.data).to.equal('data');
          expect(cached.name).to.equal('test');

          // Non-existent serial returns undefined
          expect(materializer.getMessage('nonexistent')).to.be.undefined;

          materializer.unsubscribe();
        } finally {
          realtime.close();
        }
      });

      /**
       * Test memory cap / eviction
       */
      it('evicts oldest messages when maxMessages is exceeded', async function () {
        const helper = this.test.helper;
        const realtime = helper.AblyRealtime();

        try {
          const channel = realtime.channels.get('mutable:materializer_eviction_' + Date.now());
          await channel.attach();

          // Set a low maxMessages to test eviction
          const materializer = new MessageMaterializer(channel, { maxMessages: 3 });

          var count = 0;
          var allReceived = new Promise(function (resolve) {
            materializer.subscribe(function () {
              count++;
              if (count === 5) resolve();
            });
          });

          // Publish 5 messages
          for (var i = 0; i < 5; i++) {
            await channel.publish('msg' + i, 'data' + i);
          }

          await allReceived;

          // Should only have 3 messages (the 3 most recent)
          var messages = materializer.getMessages();
          expect(messages).to.have.length(3);
          expect(messages[0].name).to.equal('msg2');
          expect(messages[1].name).to.equal('msg3');
          expect(messages[2].name).to.equal('msg4');

          materializer.unsubscribe();
        } finally {
          realtime.close();
        }
      });

      /**
       * Test event-filtered subscription
       */
      it('filters by event name when subscribing', async function () {
        const helper = this.test.helper;
        const realtime = helper.AblyRealtime();

        try {
          const channel = realtime.channels.get('mutable:materializer_filter_' + Date.now());
          await channel.attach();

          const materializer = new MessageMaterializer(channel);

          var received = [];
          var done = new Promise(function (resolve) {
            // Subscribe only to 'target' events
            materializer.subscribe('target', function (msg) {
              received.push(msg.name);
              if (received.length === 2) resolve();
            });
          });

          await channel.publish('other', 'skip this');
          await channel.publish('target', 'want this 1');
          await channel.publish('other', 'skip this too');
          await channel.publish('target', 'want this 2');

          await done;

          expect(received).to.deep.equal(['target', 'target']);

          materializer.unsubscribe();
        } finally {
          realtime.close();
        }
      });

      /**
       * Test unsubscribe removes specific listener
       */
      it('unsubscribe removes specific listener', async function () {
        const helper = this.test.helper;
        const realtime = helper.AblyRealtime();

        try {
          const channel = realtime.channels.get('mutable:materializer_unsub_' + Date.now());
          await channel.attach();

          const materializer = new MessageMaterializer(channel);

          var received1 = [];
          var received2 = [];

          var listener1 = function (msg) { received1.push(msg.name); };
          var listener2 = function (msg) { received2.push(msg.name); };

          await materializer.subscribe(listener1);
          await materializer.subscribe(listener2);

          // Publish first message and wait for listener2 to see it
          var firstDone = new Promise(function (resolve) {
            var origListener2 = listener2;
            // We know listener2 fires after listener1, so when received2 has 'first' we're done
            var checkInterval = setInterval(function () {
              if (received1.length >= 1 && received2.length >= 1) {
                clearInterval(checkInterval);
                resolve();
              }
            }, 50);
          });
          await channel.publish('first', 'data');
          await firstDone;

          // Unsubscribe listener1
          materializer.unsubscribe(listener1);

          // Publish second message and wait for listener2 to see it
          var secondDone = new Promise(function (resolve) {
            var checkInterval = setInterval(function () {
              if (received2.length >= 2) {
                clearInterval(checkInterval);
                resolve();
              }
            }, 50);
          });
          await channel.publish('second', 'data');
          await secondDone;

          // listener1 should only have first, listener2 should have both
          expect(received1).to.deep.equal(['first']);
          expect(received2).to.deep.equal(['first', 'second']);

          materializer.unsubscribe();
        } finally {
          realtime.close();
        }
      });

      /**
       * Test late-join: subscriber connects after messages published,
       * uses rewind to receive materialized state
       */
      it('handles late-join via rewind with materialized state', async function () {
        const helper = this.test.helper;

        // Publisher client
        var publisher = helper.AblyRealtime();

        try {
          var channelName = 'mutable:materializer_latejoin_' + Date.now();
          var pubChannel = publisher.channels.get(channelName);
          await pubChannel.attach();

          // Publish and append before subscriber joins
          var result = await pubChannel.publish('streamed', 'Hello');
          var serial = result.serials[0];
          await pubChannel.appendMessage({ serial: serial, data: ' World' });

          // Small delay to ensure server processes the append
          await new Promise(function (r) { setTimeout(r, 500); });

          // Now create subscriber that uses rewind to get history
          var subscriber = helper.AblyRealtime();
          var subChannel = subscriber.channels.get(channelName, {
            params: { rewind: '100' },
          });

          var materializer = new MessageMaterializer(subChannel);

          var received = new Promise(function (resolve) {
            materializer.subscribe(function (msg) {
              resolve(msg);
            });
          });

          var msg = await received;

          // Via rewind, the server sends the materialized message as message.update
          // with the full accumulated data
          expect(msg.data).to.equal('Hello World');
          expect(msg.serial).to.equal(serial);

          materializer.unsubscribe();
          subscriber.close();
        } finally {
          publisher.close();
        }
      });

      /**
       * Test that toPartialJSON returns undefined for non-JSON data
       */
      it('toPartialJSON returns undefined for non-parseable data', async function () {
        const helper = this.test.helper;
        const realtime = helper.AblyRealtime();

        try {
          const channel = realtime.channels.get('mutable:materializer_nojson_' + Date.now());
          await channel.attach();

          const materializer = new MessageMaterializer(channel);

          var received = new Promise(function (resolve) {
            materializer.subscribe(function (msg) { resolve(msg); });
          });

          await channel.publish('test', 'not json at all >>>');

          var msg = await received;
          expect(msg.toPartialJSON()).to.be.undefined;

          materializer.unsubscribe();
        } finally {
          realtime.close();
        }
      });

      /**
       * Test toPartialJSON with complete JSON returns fully parsed result
       */
      it('toPartialJSON parses complete JSON correctly', async function () {
        const helper = this.test.helper;
        const realtime = helper.AblyRealtime();

        try {
          const channel = realtime.channels.get('mutable:materializer_completejson_' + Date.now());
          await channel.attach();

          const materializer = new MessageMaterializer(channel);

          var received = new Promise(function (resolve) {
            materializer.subscribe(function (msg) { resolve(msg); });
          });

          var data = JSON.stringify({ model: 'test', tokens: [1, 2, 3], done: true });
          await channel.publish('test', data);

          var msg = await received;
          var parsed = msg.toPartialJSON();
          expect(parsed).to.deep.equal({ model: 'test', tokens: [1, 2, 3], done: true });

          materializer.unsubscribe();
        } finally {
          realtime.close();
        }
      });

      /**
       * Test toPartialJSON with null data
       */
      it('toPartialJSON returns undefined for null data', async function () {
        const helper = this.test.helper;
        const realtime = helper.AblyRealtime();

        try {
          const channel = realtime.channels.get('mutable:materializer_nulldata_' + Date.now());
          await channel.attach();

          const materializer = new MessageMaterializer(channel);

          var received = new Promise(function (resolve) {
            materializer.subscribe(function (msg) { resolve(msg); });
          });

          await channel.publish('test', null);

          var msg = await received;
          expect(msg.toPartialJSON()).to.be.undefined;

          materializer.unsubscribe();
        } finally {
          realtime.close();
        }
      });
    });
  });
});
