'use strict';

define(['ably', 'shared_helper', 'chai', 'liveobjects', 'liveobjects_helper'], function (
  Ably,
  Helper,
  chai,
  LiveObjectsPlugin,
  LiveObjectsHelper,
) {
  const expect = chai.expect;
  const BufferUtils = Ably.Realtime.Platform.BufferUtils;
  const Utils = Ably.Realtime.Utils;
  const MessageEncoding = Ably.Realtime._MessageEncoding;
  const createPM = Ably.makeProtocolMessageFromDeserialized({ LiveObjectsPlugin });
  const liveobjectsFixturesChannel = 'realtime_liveobjects_fixtures';
  const nextTick = Ably.Realtime.Platform.Config.nextTick;
  const gcIntervalOriginal = LiveObjectsPlugin.RealtimeObject._DEFAULTS.gcInterval;
  const LiveMap = LiveObjectsPlugin.LiveMap;
  const LiveCounter = LiveObjectsPlugin.LiveCounter;
  const expectInstanceOf = Helper.expectInstanceOf;
  const expectToThrowAsync = Helper.expectToThrowAsync;
  const waitFixtureChannelIsReady = LiveObjectsHelper.waitFixtureChannelIsReady;
  const waitForMapKeyUpdate = LiveObjectsHelper.waitForMapKeyUpdate;
  const waitForMapClear = LiveObjectsHelper.waitForMapClear;
  const waitForCounterUpdate = LiveObjectsHelper.waitForCounterUpdate;
  const waitForObjectOperation = LiveObjectsHelper.waitForObjectOperation;
  const waitForObjectSync = LiveObjectsHelper.waitForObjectSync;

  function RealtimeWithLiveObjects(helper, options) {
    return helper.AblyRealtime({ ...options, plugins: { LiveObjects: LiveObjectsPlugin } });
  }

  function RestWithLiveObjects(helper, options) {
    return helper.AblyRest({ ...options, plugins: { LiveObjects: LiveObjectsPlugin } });
  }

  function channelOptionsWithObjectModes(options) {
    return {
      ...options,
      modes: ['OBJECT_SUBSCRIBE', 'OBJECT_PUBLISH'],
    };
  }

  /**
   * Recursively checks that `actual` contains all properties from `expected` (deep subset match).
   *
   * Chai's `deep.include` only does subset matching at the top level of the object - nested
   * object values are compared using strict deep equality. For example,
   * `expect({a: {b: 1, c: 2}}).to.deep.include({a: {b: 1}})` fails because `{b: 1, c: 2}`
   * does not deep-equal `{b: 1}`. This helper performs subset matching at every nesting level,
   * so extra properties in nested objects are allowed.
   */
  function expectDeepSubset(actual, expected, msg) {
    if (typeof expected !== 'object' || expected === null || Array.isArray(expected)) {
      expect(actual).to.deep.equal(expected, msg);
      return;
    }

    // ensure actual is a non-null object when expected is an object (even an empty one)
    expect(actual, msg).to.be.an('object').and.not.be.null;

    for (const [key, expectedVal] of Object.entries(expected)) {
      const desc = msg ? `${msg} (at key '${key}')` : `at key '${key}'`;
      expect(actual, desc).to.have.property(key);
      expectDeepSubset(actual[key], expectedVal, desc);
    }
  }

  function forScenarios(thisInDescribe, scenarios, testFn) {
    for (const scenario of scenarios) {
      if (scenario.allTransportsAndProtocols) {
        Helper.testOnAllTransportsAndProtocols(
          thisInDescribe,
          scenario.description,
          function (options, channelName) {
            return async function () {
              const helper = this.test.helper;
              await testFn(helper, scenario, options, channelName);
            };
          },
          scenario.skip,
          scenario.only,
        );
      } else {
        const itFn = scenario.skip ? it.skip : scenario.only ? it.only : it;

        itFn(scenario.description, async function () {
          const helper = this.test.helper;
          await testFn(helper, scenario, {}, scenario.description);
        });
      }
    }
  }

  function lexicoTimeserial(seriesId, timestamp, counter, index) {
    const paddedTimestamp = timestamp.toString().padStart(14, '0');
    const paddedCounter = counter.toString().padStart(3, '0');
    const paddedIndex = index != null ? index.toString().padStart(3, '0') : undefined;

    // Example:
    //
    //	01726585978590-001@abcdefghij:001
    //	|____________| |_| |________| |_|
    //	      |         |        |     |
    //	timestamp   counter  seriesId  idx
    return `${paddedTimestamp}-${paddedCounter}@${seriesId}` + (paddedIndex ? `:${paddedIndex}` : '');
  }

  function objectMessageFromValues(values) {
    return LiveObjectsPlugin.ObjectMessage.fromValues(values, Utils, MessageEncoding);
  }

  /**
   * Helper function to inject an ATTACHED protocol message
   */
  async function injectAttachedMessage(helper, channel, flags) {
    helper.recordPrivateApi('call.connectionManager.activeProtocol.getTransport');
    helper.recordPrivateApi('call.transport.onProtocolMessage');
    helper.recordPrivateApi('call.makeProtocolMessageFromDeserialized');
    const transport = channel.client.connection.connectionManager.activeProtocol.getTransport();
    const pm = createPM({
      action: 11, // ATTACHED
      channel: channel.name,
      flags,
    });
    await transport.onProtocolMessage(pm);
  }

  /**
   * Creates an interceptor that holds OBJECT messages and allows controlled release, to test ACK-before-echo scenarios.
   * Call when CONNECTING or CONNECTED to intercept messages on the active transport.
   *
   * Note: An echo is a subset of OBJECT messages — specifically, OBJECT messages that originated from
   * this client and are being echoed back. The name "echo" reflects how this interceptor is intended
   * to be used in tests, but it doesn't actually filter for echoes — it intercepts ALL OBJECT messages.
   *
   * Returns an object with:
   *   - heldEchoes: array of { message, release } objects, where `message` is the held OBJECT message
   *     and `release()` returns a Promise that resolves when processing completes
   *   - waitForEcho(): resolves immediately if an OBJECT message has already been intercepted, otherwise
   *     waits until the next OBJECT message is intercepted. Only one call can be pending at a time;
   *     subsequent calls overwrite the previous callback.
   *   - releaseAll(): releases all held OBJECT messages and returns a Promise that resolves when
   *     all processing completes
   *   - restore(): restores normal message handling
   */
  function createEchoInterceptor(helper, client) {
    helper.recordPrivateApi('call.connectionManager.activeProtocol.getTransport');
    const transport = client.connection.connectionManager.activeProtocol.getTransport();
    const originalOnProtocolMessage = transport.onProtocolMessage;
    const heldEchoes = [];
    let onEchoIntercepted = null;

    helper.recordPrivateApi('replace.transport.onProtocolMessage');
    transport.onProtocolMessage = function (message) {
      if (message.action === 19) {
        // OBJECT message
        heldEchoes.push({
          message,
          // release() calls channel.processMessage directly and returns the Promise,
          // allowing callers to await processing completion
          release: () => {
            helper.recordPrivateApi('call.channel.processMessage');
            const channel = client.channels.get(message.channel);
            return channel.processMessage(message);
          },
        });
        if (onEchoIntercepted) {
          onEchoIntercepted();
          onEchoIntercepted = null;
        }
        return;
      }
      helper.recordPrivateApi('call.transport.onProtocolMessage');
      originalOnProtocolMessage.call(transport, message);
    };

    return {
      heldEchoes,
      waitForEcho: () =>
        new Promise((resolve) => {
          if (heldEchoes.length > 0) {
            resolve();
          } else {
            onEchoIntercepted = resolve;
          }
        }),
      releaseAll: async () => {
        while (heldEchoes.length > 0) {
          await heldEchoes.shift().release();
        }
      },
      restore: () => {
        helper.recordPrivateApi('replace.transport.onProtocolMessage');
        transport.onProtocolMessage = originalOnProtocolMessage;
      },
    };
  }

  /**
   * Creates an interceptor that holds ACK messages and allows controlled release, to test echo-before-ACK scenarios.
   * Call when CONNECTING or CONNECTED to intercept messages on the active transport.
   *
   * Returns an object with:
   *   - heldAcks: array of { message, release } objects, where `message` is the held ACK message
   *     and `release` is a function to release it
   *   - waitForAck(): resolves immediately if an ACK has already been intercepted, otherwise waits for one.
   *     Only one call can be pending at a time; subsequent calls overwrite the previous callback.
   *   - releaseAll(): releases all held ACKs
   *   - restore(): restores normal message handling
   */
  function createAckInterceptor(helper, client) {
    helper.recordPrivateApi('call.connectionManager.activeProtocol.getTransport');
    const transport = client.connection.connectionManager.activeProtocol.getTransport();
    const originalOnProtocolMessage = transport.onProtocolMessage;
    const heldAcks = [];
    let onAckIntercepted = null;

    helper.recordPrivateApi('replace.transport.onProtocolMessage');
    transport.onProtocolMessage = function (message) {
      if (message.action === 1) {
        // ACK
        heldAcks.push({
          message,
          release: () => {
            helper.recordPrivateApi('call.transport.onProtocolMessage');
            originalOnProtocolMessage.call(transport, message);
          },
        });
        if (onAckIntercepted) {
          onAckIntercepted();
          onAckIntercepted = null;
        }
        return;
      }
      helper.recordPrivateApi('call.transport.onProtocolMessage');
      originalOnProtocolMessage.call(transport, message);
    };

    return {
      heldAcks,
      waitForAck: () =>
        new Promise((resolve) => {
          if (heldAcks.length > 0) {
            resolve();
          } else {
            onAckIntercepted = resolve;
          }
        }),
      releaseAll: () => {
        while (heldAcks.length > 0) {
          heldAcks.shift().release();
        }
      },
      restore: () => {
        helper.recordPrivateApi('replace.transport.onProtocolMessage');
        transport.onProtocolMessage = originalOnProtocolMessage;
      },
    };
  }

  describe('realtime/liveobjects', function () {
    this.timeout(60 * 1000);

    before(function (done) {
      const helper = Helper.forHook(this);

      helper.setupApp(function (err) {
        if (err) {
          done(err);
          return;
        }

        new LiveObjectsHelper(helper)
          .initForChannel(liveobjectsFixturesChannel)
          .then(done)
          .catch((err) => done(err));
      });
    });

    describe('Realtime without LiveObjects plugin', () => {
      /** @nospec */
      it("throws an error when attempting to access the channel's `object` property", async function () {
        const helper = this.test.helper;
        const client = helper.AblyRealtime({ autoConnect: false });
        const channel = client.channels.get('channel');
        expect(() => channel.object).to.throw('LiveObjects plugin not provided');
      });

      /** @nospec */
      it(`doesn't break when it receives an OBJECT ProtocolMessage`, async function () {
        const helper = this.test.helper;
        const objectsHelper = new LiveObjectsHelper(helper);
        const testClient = helper.AblyRealtime();

        await helper.monitorConnectionThenCloseAndFinishAsync(async () => {
          const testChannel = testClient.channels.get('channel');
          await testChannel.attach();

          const receivedMessagePromise = new Promise((resolve) => testChannel.subscribe(resolve));

          const publishClient = helper.AblyRealtime();

          await helper.monitorConnectionThenCloseAndFinishAsync(async () => {
            // inject OBJECT message that should be ignored and not break anything without the plugin
            await objectsHelper.processObjectOperationMessageOnChannel({
              channel: testChannel,
              serial: lexicoTimeserial('aaa', 0, 0),
              siteCode: 'aaa',
              state: [objectsHelper.mapSetOp({ objectId: 'root', key: 'stringKey', data: { string: 'stringValue' } })],
            });

            const publishChannel = publishClient.channels.get('channel');
            await publishChannel.publish(null, 'test');

            // regular message subscriptions should still work after processing OBJECT_SYNC message without the plugin
            await receivedMessagePromise;
          }, publishClient);
        }, testClient);
      });

      /** @nospec */
      it(`doesn't break when it receives an OBJECT_SYNC ProtocolMessage`, async function () {
        const helper = this.test.helper;
        const objectsHelper = new LiveObjectsHelper(helper);
        const testClient = helper.AblyRealtime();

        await helper.monitorConnectionThenCloseAndFinishAsync(async () => {
          const testChannel = testClient.channels.get('channel');
          await testChannel.attach();

          const receivedMessagePromise = new Promise((resolve) => testChannel.subscribe(resolve));

          const publishClient = helper.AblyRealtime();

          await helper.monitorConnectionThenCloseAndFinishAsync(async () => {
            // inject OBJECT_SYNC message that should be ignored and not break anything without the plugin
            await objectsHelper.processObjectStateMessageOnChannel({
              channel: testChannel,
              syncSerial: 'serial:',
              state: [
                objectsHelper.mapObject({
                  objectId: 'root',
                  siteTimeserials: { aaa: lexicoTimeserial('aaa', 0, 0) },
                }),
              ],
            });

            const publishChannel = publishClient.channels.get('channel');
            await publishChannel.publish(null, 'test');

            // regular message subscriptions should still work after processing OBJECT_SYNC message without the plugin
            await receivedMessagePromise;
          }, publishClient);
        }, testClient);
      });
    });

    describe('Realtime with LiveObjects plugin', () => {
      /** @nospec */
      it("returns RealtimeObject class instance when accessing channel's `object` property", async function () {
        const helper = this.test.helper;
        const client = RealtimeWithLiveObjects(helper, { autoConnect: false });
        const channel = client.channels.get('channel');
        expectInstanceOf(channel.object, 'RealtimeObject');
      });

      /** @nospec */
      it('RealtimeObject.get() returns LiveObject with id "root"', async function () {
        const helper = this.test.helper;
        const client = RealtimeWithLiveObjects(helper);

        await helper.monitorConnectionThenCloseAndFinishAsync(async () => {
          const channel = client.channels.get('channel', channelOptionsWithObjectModes());

          await channel.attach();
          const entryPathObject = await channel.object.get();

          expect(entryPathObject.instance().id).to.equal('root', 'root object should have an object id "root"');
        }, client);
      });

      /** @nospec */
      it('RealtimeObject.get() returns empty root when no objects exist on a channel', async function () {
        const helper = this.test.helper;
        const client = RealtimeWithLiveObjects(helper);

        await helper.monitorConnectionThenCloseAndFinishAsync(async () => {
          const channel = client.channels.get('channel', channelOptionsWithObjectModes());

          await channel.attach();
          const entryPathObject = await channel.object.get();

          expect(entryPathObject.size()).to.equal(0, 'Check root has no keys');
        }, client);
      });

      /** @nospec */
      it('RealtimeObject.get() waits for initial OBJECT_SYNC to be completed before resolving', async function () {
        const helper = this.test.helper;
        const client = RealtimeWithLiveObjects(helper);

        await helper.monitorConnectionThenCloseAndFinishAsync(async () => {
          const channel = client.channels.get('channel', channelOptionsWithObjectModes());

          const getPromise = channel.object.get();

          let getResolved = false;
          getPromise.then(() => {
            getResolved = true;
          });

          // give a chance for RealtimeObject.get() to resolve and proc its handler. it should not
          helper.recordPrivateApi('call.Platform.nextTick');
          await new Promise((res) => nextTick(res));
          expect(getResolved, 'Check RealtimeObject.get() is not resolved until OBJECT_SYNC sequence is completed').to
            .be.false;

          await channel.attach();

          // should resolve eventually after attach
          await getPromise;
        }, client);
      });

      /** @nospec */
      it('RealtimeObject.get() resolves immediately when OBJECT_SYNC sequence is completed', async function () {
        const helper = this.test.helper;
        const client = RealtimeWithLiveObjects(helper);

        await helper.monitorConnectionThenCloseAndFinishAsync(async () => {
          const channel = client.channels.get('channel', channelOptionsWithObjectModes());

          await channel.attach();
          // wait for sync sequence to complete by accessing root for the first time
          await channel.object.get();

          let resolvedImmediately = false;
          channel.object.get().then(() => {
            resolvedImmediately = true;
          });

          // wait for next tick for RealtimeObject.get() handler to process
          helper.recordPrivateApi('call.Platform.nextTick');
          await new Promise((res) => nextTick(res));

          expect(resolvedImmediately, 'Check RealtimeObject.get() is resolved on next tick').to.be.true;
        }, client);
      });

      /** @nospec */
      it('RealtimeObject.get() waits for OBJECT_SYNC with empty cursor before resolving', async function () {
        const helper = this.test.helper;
        const objectsHelper = new LiveObjectsHelper(helper);
        const client = RealtimeWithLiveObjects(helper);

        await helper.monitorConnectionThenCloseAndFinishAsync(async () => {
          const channel = client.channels.get('channel', channelOptionsWithObjectModes());

          await channel.attach();
          // wait for initial sync sequence to complete
          await channel.object.get();

          // inject OBJECT_SYNC message to emulate start of a new sequence
          await objectsHelper.processObjectStateMessageOnChannel({
            channel,
            // have cursor so client awaits for additional OBJECT_SYNC messages
            syncSerial: 'serial:cursor',
          });

          let getResolved = false;
          let entryInstance;
          channel.object.get().then((value) => {
            getResolved = true;
            entryInstance = value;
          });

          // wait for next tick to check that RealtimeObject.get() promise handler didn't proc
          helper.recordPrivateApi('call.Platform.nextTick');
          await new Promise((res) => nextTick(res));

          expect(getResolved, 'Check RealtimeObject.get() is not resolved while OBJECT_SYNC is in progress').to.be
            .false;

          // inject final OBJECT_SYNC message
          await objectsHelper.processObjectStateMessageOnChannel({
            channel,
            // no cursor to indicate the end of OBJECT_SYNC messages
            syncSerial: 'serial:',
            state: [
              objectsHelper.mapObject({
                objectId: 'root',
                siteTimeserials: { aaa: lexicoTimeserial('aaa', 0, 0) },
                initialEntries: { key: { timeserial: lexicoTimeserial('aaa', 0, 0), data: { number: 1 } } },
              }),
            ],
          });

          // wait for next tick for RealtimeObject.get() handler to process
          helper.recordPrivateApi('call.Platform.nextTick');
          await new Promise((res) => nextTick(res));

          expect(getResolved, 'Check RealtimeObject.get() is resolved when OBJECT_SYNC sequence has ended').to.be.true;
          expect(entryInstance.get('key').value()).to.equal(
            1,
            'Check new root after OBJECT_SYNC sequence has expected key',
          );
        }, client);
      });

      /** @nospec */
      it('RealtimeObject.get() on unattached channel implicitly attaches and waits for sync', async function () {
        const helper = this.test.helper;
        const client = RealtimeWithLiveObjects(helper);

        await helper.monitorConnectionThenCloseAndFinishAsync(async () => {
          const channel = client.channels.get('channel', channelOptionsWithObjectModes());
          expect(channel.state).to.equal('initialized', 'Channel should be in initialized state');

          // Set up a timeout to catch if get() hangs
          const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('RealtimeObject.get() timed out')), 10000);
          });

          // Call get() on unattached channel - this should automatically attach and resolve
          const getPromise = channel.object.get();

          // Race between get() and timeout - get() should win by implicitly attaching and syncing state
          const entryPathObject = await Promise.race([getPromise, timeoutPromise]);

          // Channel should now be attached, and root object returned
          expect(channel.state).to.equal('attached', 'Channel should be attached after RealtimeObject.get() call');

          expectInstanceOf(entryPathObject, 'DefaultPathObject', 'entrypoint should be of DefaultPathObject type');
          expect(entryPathObject.instance().id).to.equal('root', 'entrypoint should have an object id "root"');
        }, client);
      });

      /**
       * Checks that a path object's value at the given key matches the expected value from a
       * `primitiveKeyData` entry (from LiveObjectsHelper). Handles type-specific comparison
       * for bytes (buffer equality), json (deep equality), and other primitives (strict equality).
       */
      function checkKeyDataOnPathObject({ helper, key, keyData, pathObject, msg }) {
        if (keyData.jsonData.bytes != null) {
          helper.recordPrivateApi('call.BufferUtils.base64Decode');
          helper.recordPrivateApi('call.BufferUtils.areBuffersEqual');
          expect(
            BufferUtils.areBuffersEqual(pathObject.get(key).value(), BufferUtils.base64Decode(keyData.jsonData.bytes)),
            msg,
          ).to.be.true;
        } else if (keyData.jsonData.json != null) {
          const expectedObject = JSON.parse(keyData.jsonData.json);
          expect(pathObject.get(key).value()).to.deep.equal(expectedObject, msg);
        } else {
          const expectedValue = keyData.jsonData.string ?? keyData.jsonData.number ?? keyData.jsonData.boolean;
          expect(pathObject.get(key).value()).to.equal(expectedValue, msg);
        }
      }

      /**
       * Checks that a DefaultInstance's value at the given key matches the expected value from a
       * `primitiveKeyData` entry (from LiveObjectsHelper). Handles type-specific comparison
       * for bytes (buffer equality), json (deep equality), and other primitives (strict equality).
       */
      function checkKeyDataOnInstance({ helper, key, keyData, instance, msg }) {
        const entryInstance = instance.get(key);

        expect(entryInstance, `Check instance exists for "${keyData.key}"`).to.exist;
        expectInstanceOf(entryInstance, 'DefaultInstance', `Check instance for "${keyData.key}" is DefaultInstance`);

        if (keyData.jsonData.bytes != null) {
          helper.recordPrivateApi('call.BufferUtils.base64Decode');
          helper.recordPrivateApi('call.BufferUtils.areBuffersEqual');
          expect(
            BufferUtils.areBuffersEqual(entryInstance.value(), BufferUtils.base64Decode(keyData.jsonData.bytes)),
            msg,
          ).to.be.true;
        } else if (keyData.jsonData.json != null) {
          const expectedObject = JSON.parse(keyData.jsonData.json);
          expect(entryInstance.value()).to.deep.equal(expectedObject, msg);
        } else {
          const expectedValue = keyData.jsonData.string ?? keyData.jsonData.number ?? keyData.jsonData.boolean;
          expect(entryInstance.value()).to.equal(expectedValue, msg);
        }
      }

      const primitiveKeyData = LiveObjectsHelper.primitiveKeyData;
      const primitiveMapsFixtures = [
        { name: 'emptyMap', entries: [] },
        { name: 'valuesMap', entries: primitiveKeyData },
      ];
      const countersFixtures = [
        { name: 'emptyCounter' },
        { name: 'zeroCounter', count: 0 },
        { name: 'valueCounter', count: 10 },
        { name: 'negativeValueCounter', count: -10 },
        { name: 'maxSafeIntegerCounter', count: Number.MAX_SAFE_INTEGER },
        { name: 'negativeMaxSafeIntegerCounter', count: -Number.MAX_SAFE_INTEGER },
      ];

      const objectSyncSequenceScenarios = [
        {
          description: 'on ATTACHED without HAS_OBJECTS clears local state',
          action: async (ctx) => {
            const { entryInstance, channel, helper } = ctx;

            // set a key on root so we can verify it gets cleared after ATTACHED
            await entryInstance.set('foo', 'bar');
            expect(entryInstance.get('foo').value()).to.equal('bar', 'Check root has key before ATTACHED');

            // inject ATTACHED without HAS_OBJECTS flag
            await injectAttachedMessage(helper, channel, 0); // no HAS_OBJECTS flag

            // local state should be cleared — root should have no keys
            expect(entryInstance.size()).to.equal(0, 'Check root has no keys after ATTACHED without HAS_OBJECTS');
          },
        },

        {
          allTransportsAndProtocols: true,
          description: 'OBJECT_SYNC sequence builds object tree on channel attachment',
          action: async (ctx) => {
            const { client, helper } = ctx;

            await waitFixtureChannelIsReady(client, liveobjectsFixturesChannel);

            const channel = client.channels.get(liveobjectsFixturesChannel, channelOptionsWithObjectModes());

            await channel.attach();
            const entryPathObject = await channel.object.get();
            const entryInstance = entryPathObject.instance();

            const counterKeys = ['emptyCounter', 'initialValueCounter', 'referencedCounter'];
            const mapKeys = ['emptyMap', 'referencedMap', 'valuesMap'];
            const rootKeysCount = counterKeys.length + mapKeys.length;

            expect(entryInstance, 'Check RealtimeObject.get() is resolved when OBJECT_SYNC sequence ends').to.exist;
            expect(entryInstance.size()).to.equal(rootKeysCount, 'Check root has correct number of keys');

            counterKeys.forEach((key) => {
              const counter = entryInstance.get(key);
              expect(counter, `Check counter at key="${key}" in root exists`).to.exist;
              helper.recordPrivateApi('read.DefaultInstance._value');
              expectInstanceOf(
                counter._value,
                'LiveCounter',
                `Check counter at key="${key}" in root is of type LiveCounter`,
              );
            });

            mapKeys.forEach((key) => {
              const map = entryInstance.get(key);
              expect(map, `Check map at key="${key}" in root exists`).to.exist;
              helper.recordPrivateApi('read.DefaultInstance._value');
              expectInstanceOf(map._value, 'LiveMap', `Check map at key="${key}" in root is of type LiveMap`);
            });

            const valuesMap = entryInstance.get('valuesMap');
            const valueMapKeys = [
              'stringKey',
              'emptyStringKey',
              'bytesKey',
              'emptyBytesKey',
              'maxSafeIntegerKey',
              'negativeMaxSafeIntegerKey',
              'numberKey',
              'zeroKey',
              'trueKey',
              'falseKey',
              'objectKey',
              'arrayKey',
              'mapKey',
            ];
            expect(valuesMap.size()).to.equal(valueMapKeys.length, 'Check nested map has correct number of keys');
            valueMapKeys.forEach((key) => {
              expect(valuesMap.get(key), `Check value at key="${key}" in nested map exists`).to.exist;
            });
          },
        },

        {
          allTransportsAndProtocols: true,
          description: 'OBJECT_SYNC sequence builds object tree with all operations applied',
          action: async (ctx) => {
            const { helper, clientOptions, channelName, entryInstance } = ctx;

            const objectsCreatedPromise = Promise.all([
              waitForMapKeyUpdate(entryInstance, 'counter'),
              waitForMapKeyUpdate(entryInstance, 'map'),
            ]);
            await Promise.all([
              // MAP_CREATE
              entryInstance.set('map', LiveMap.create({ shouldStay: 'foo', shouldDelete: 'bar' })),
              // COUNTER_CREATE
              entryInstance.set('counter', LiveCounter.create(1)),
              objectsCreatedPromise,
            ]);

            const map = entryInstance.get('map');
            const counter = entryInstance.get('counter');

            const operationsAppliedPromise = Promise.all([
              waitForMapKeyUpdate(map, 'anotherKey'),
              waitForMapKeyUpdate(map, 'shouldDelete'),
              waitForCounterUpdate(counter),
            ]);

            await Promise.all([
              // MAP_SET
              map.set('anotherKey', 'baz'),
              // MAP_REMOVE
              map.remove('shouldDelete'),
              // COUNTER_INC
              counter.increment(10),
              operationsAppliedPromise,
            ]);

            // create a new client and check it syncs with the aggregated data
            const client2 = RealtimeWithLiveObjects(helper, clientOptions);

            await helper.monitorConnectionThenCloseAndFinishAsync(async () => {
              const channel2 = client2.channels.get(channelName, channelOptionsWithObjectModes());

              await channel2.attach();
              const pathObject2 = await channel2.object.get();
              const entryInstance2 = pathObject2.instance();

              expect(entryInstance2.get('counter'), 'Check counter exists').to.exist;
              expect(entryInstance2.get('counter').value()).to.equal(11, 'Check counter has correct value');

              expect(entryInstance2.get('map'), 'Check map exists').to.exist;
              expect(entryInstance2.get('map').size()).to.equal(2, 'Check map has correct number of keys');
              expect(entryInstance2.get('map').get('shouldStay').value()).to.equal(
                'foo',
                'Check map has correct value for "shouldStay" key',
              );
              expect(entryInstance2.get('map').get('anotherKey').value()).to.equal(
                'baz',
                'Check map has correct value for "anotherKey" key',
              );
              expect(entryInstance2.get('map').get('shouldDelete'), 'Check map does not have "shouldDelete" key').to.not
                .exist;
            }, client2);
          },
        },

        {
          description: 'OBJECT_SYNC sequence does not change references to existing objects',
          action: async (ctx) => {
            const { helper, channel, entryInstance } = ctx;

            const objectsCreatedPromise = Promise.all([
              waitForMapKeyUpdate(entryInstance, 'counter'),
              waitForMapKeyUpdate(entryInstance, 'map'),
            ]);
            await Promise.all([
              entryInstance.set('map', LiveMap.create()),
              entryInstance.set('counter', LiveCounter.create()),
              objectsCreatedPromise,
            ]);
            const map = entryInstance.get('map');
            const counter = entryInstance.get('counter');

            await channel.detach();

            // wait for the actual OBJECT_SYNC message to confirm it was received and processed
            const objectSyncPromise = waitForObjectSync(helper, channel.client);
            await channel.attach();
            await objectSyncPromise;

            const newEntryPathObject = await channel.object.get();
            const newEntryInstance = newEntryPathObject.instance();
            const newMapRef = newEntryInstance.get('map');
            const newCounterRef = newEntryInstance.get('counter');

            helper.recordPrivateApi('read.DefaultInstance._value');
            expect(newEntryInstance._value).to.equal(
              entryInstance._value,
              'Check root reference is the same after OBJECT_SYNC sequence',
            );
            helper.recordPrivateApi('read.DefaultInstance._value');
            expect(newMapRef._value).to.equal(map._value, 'Check map reference is the same after OBJECT_SYNC sequence');
            helper.recordPrivateApi('read.DefaultInstance._value');
            expect(newCounterRef._value).to.equal(
              counter._value,
              'Check counter reference is the same after OBJECT_SYNC sequence',
            );
          },
        },

        {
          description: 'OBJECT_SYNC sequence builds object tree across multiple sync messages',
          action: async (ctx) => {
            const { channel, objectsHelper, entryPathObject } = ctx;

            const counterId = objectsHelper.fakeCounterObjectId();
            const mapId = objectsHelper.fakeMapObjectId();

            // send three separate OBJECT_SYNC messages: one for root, one for counter, one for map
            await objectsHelper.processObjectStateMessageOnChannel({
              channel,
              syncSerial: 'serial:cursor1',
              state: [
                objectsHelper.mapObject({
                  objectId: 'root',
                  siteTimeserials: { aaa: lexicoTimeserial('aaa', 0, 0) },
                  initialEntries: {
                    stringKey: { timeserial: lexicoTimeserial('aaa', 0, 0), data: { string: 'hello' } },
                    counter: { timeserial: lexicoTimeserial('aaa', 0, 0), data: { objectId: counterId } },
                    map: { timeserial: lexicoTimeserial('aaa', 0, 0), data: { objectId: mapId } },
                  },
                }),
              ],
            });

            await objectsHelper.processObjectStateMessageOnChannel({
              channel,
              syncSerial: 'serial:cursor2',
              state: [
                objectsHelper.counterObject({
                  objectId: counterId,
                  siteTimeserials: { aaa: lexicoTimeserial('aaa', 0, 0) },
                  initialCount: 10,
                  materialisedCount: 5,
                }),
              ],
            });

            await objectsHelper.processObjectStateMessageOnChannel({
              channel,
              syncSerial: 'serial:', // end sync sequence
              state: [
                objectsHelper.mapObject({
                  objectId: mapId,
                  siteTimeserials: { aaa: lexicoTimeserial('aaa', 0, 0) },
                  initialEntries: {
                    foo: { timeserial: lexicoTimeserial('aaa', 0, 0), data: { string: 'bar' } },
                  },
                  materialisedEntries: {
                    baz: { timeserial: lexicoTimeserial('bbb', 0, 0), data: { string: 'qux' } },
                  },
                }),
              ],
            });

            expect(entryPathObject.get('stringKey').value()).to.equal('hello', 'Check root has correct string value');
            expect(entryPathObject.get('counter').value()).to.equal(15, 'Check counter has correct aggregated value');
            expect(entryPathObject.get('map').get('foo').value()).to.equal('bar', 'Check map has initial entries');
            expect(entryPathObject.get('map').get('baz').value()).to.equal('qux', 'Check map has materialised entries');
          },
        },

        {
          description: 'OBJECT_SYNC does not break when receiving an unknown object type',
          action: async (ctx) => {
            const { channel, objectsHelper } = ctx;

            // first message: unknown object type (no counter or map field set)
            await objectsHelper.processObjectStateMessageOnChannel({
              channel,
              syncSerial: 'serial:cursor',
              state: [
                {
                  object: {
                    objectId: 'unknown:object123',
                    siteTimeserials: { aaa: lexicoTimeserial('aaa', 0, 0) },
                    tombstone: false,
                    // intentionally not setting counter or map fields
                  },
                },
              ],
            });

            // second message: root with a key, ends sync sequence
            await objectsHelper.processObjectStateMessageOnChannel({
              channel,
              syncSerial: 'serial:',
              state: [
                objectsHelper.mapObject({
                  objectId: 'root',
                  siteTimeserials: { aaa: lexicoTimeserial('aaa', 0, 0) },
                  initialEntries: {
                    foo: { timeserial: lexicoTimeserial('aaa', 0, 0), data: { string: 'bar' } },
                  },
                }),
              ],
            });

            const root = await channel.object.get();

            // verify root has the expected key - SDK should not break due to unknown object type
            expect(root.get('foo').value()).to.equal(
              'bar',
              'Check root has correct value after unknown object type in sync',
            );
          },
        },

        {
          allTransportsAndProtocols: true,
          description: 'partial OBJECT_SYNC merges map entries across multiple messages for the same objectId',
          action: async (ctx) => {
            const { helper, client, clientOptions, channelName, entryInstance, restChannel } = ctx;

            helper.recordPrivateApi('read.realtime.options.maxMessageSize');
            const maxMessageSize = client.options.maxMessageSize;

            // create 3 keys on root, each with a string value nearly maxMessageSize in length.
            // this ensures the server must split the sync across multiple OBJECT_SYNC messages
            // since each key alone nearly fills a single message.
            const keyNames = ['largeKey1', 'largeKey2', 'largeKey3'];
            // map set op size = key length + data string length, so this reaches exactly maxMessageSize
            const largeValue = 'x'.repeat(maxMessageSize - keyNames[0].length);

            // set keys via the REST client to guarantee they are persisted on the server before the second client syncs.
            // wait for each key update on the realtime client to confirm the server has processed the operation.
            const keysUpdatedPromise = Promise.all(keyNames.map((key) => waitForMapKeyUpdate(entryInstance, key)));
            for (const key of keyNames) {
              await restChannel.object.publish({
                objectId: 'root',
                mapSet: { key, value: { string: largeValue } },
              });
            }
            await keysUpdatedPromise;

            // use a separate client to sync and verify the values, so we can be confident
            // the values came from the partial sync and aren't leftover pre-existing state
            const client2 = RealtimeWithLiveObjects(helper, clientOptions);

            await helper.monitorConnectionThenCloseAndFinishAsync(async () => {
              await client2.connection.whenState('connected');
              helper.recordPrivateApi('read.realtime.options.maxMessageSize');
              expect(client2.options.maxMessageSize).to.equal(
                maxMessageSize,
                'Check second client has the same maxMessageSize',
              );

              // count OBJECT_SYNC messages received during sync
              helper.recordPrivateApi('call.connectionManager.activeProtocol.getTransport');
              const transport = client2.connection.connectionManager.activeProtocol.getTransport();
              const onProtocolMessageOriginal = transport.onProtocolMessage;
              let objectSyncMessageCount = 0;

              helper.recordPrivateApi('replace.transport.onProtocolMessage');
              transport.onProtocolMessage = function (message) {
                if (message.action === 20) {
                  objectSyncMessageCount++;
                }
                helper.recordPrivateApi('call.transport.onProtocolMessage');
                onProtocolMessageOriginal.call(transport, message);
              };

              const channel2 = client2.channels.get(channelName, channelOptionsWithObjectModes());
              const syncedPromise = new Promise((resolve) => channel2.object.on('synced', resolve));
              await channel2.attach();
              await syncedPromise;

              // verify the server sent multiple OBJECT_SYNC messages due to the partial sync, one for each large key
              expect(objectSyncMessageCount).to.be.at.least(
                3,
                'Check that multiple OBJECT_SYNC messages were received (partial sync)',
              );

              // verify all keys were synced correctly on the new client
              const entryPathObject2 = await channel2.object.get();
              for (const key of keyNames) {
                expect(entryPathObject2.get(key).value()).to.equal(
                  largeValue,
                  `Check ${key} was synced correctly after partial OBJECT_SYNC`,
                );
              }
            }, client2);
          },
        },

        {
          allTransportsAndProtocols: true,
          description: 'LiveCounter is initialized with initial value from OBJECT_SYNC sequence',
          action: async (ctx) => {
            const { client } = ctx;

            await waitFixtureChannelIsReady(client, liveobjectsFixturesChannel);

            const channel = client.channels.get(liveobjectsFixturesChannel, channelOptionsWithObjectModes());

            await channel.attach();
            const entryPathObject = await channel.object.get();

            const counters = [
              { key: 'emptyCounter', value: 0 },
              { key: 'initialValueCounter', value: 10 },
              { key: 'referencedCounter', value: 20 },
            ];

            counters.forEach((x) => {
              const counter = entryPathObject.get(x.key);
              expect(counter.value()).to.equal(x.value, `Check counter at key="${x.key}" in root has correct value`);
            });
          },
        },

        {
          allTransportsAndProtocols: true,
          description: 'LiveMap is initialized with initial value from OBJECT_SYNC sequence',
          action: async (ctx) => {
            const { helper, client } = ctx;

            await waitFixtureChannelIsReady(client, liveobjectsFixturesChannel);

            const channel = client.channels.get(liveobjectsFixturesChannel, channelOptionsWithObjectModes());

            await channel.attach();
            const entryPathObject = await channel.object.get();

            const emptyMap = entryPathObject.get('emptyMap');
            expect(emptyMap.size()).to.equal(0, 'Check empty map in root has no keys');

            const referencedMap = entryPathObject.get('referencedMap');
            expect(referencedMap.size()).to.equal(1, 'Check referenced map in root has correct number of keys');

            const counterFromReferencedMap = referencedMap.get('counterKey');
            expect(counterFromReferencedMap.value()).to.equal(20, 'Check nested counter has correct value');

            const valuesMap = entryPathObject.get('valuesMap');
            expect(valuesMap.size()).to.equal(13, 'Check values map in root has correct number of keys');

            expect(valuesMap.get('stringKey').value()).to.equal(
              'stringValue',
              'Check values map has correct string value key',
            );
            expect(valuesMap.get('emptyStringKey').value()).to.equal(
              '',
              'Check values map has correct empty string value key',
            );
            helper.recordPrivateApi('call.BufferUtils.base64Decode');
            helper.recordPrivateApi('call.BufferUtils.areBuffersEqual');
            expect(
              BufferUtils.areBuffersEqual(
                valuesMap.get('bytesKey').value(),
                BufferUtils.base64Decode('eyJwcm9kdWN0SWQiOiAiMDAxIiwgInByb2R1Y3ROYW1lIjogImNhciJ9'),
              ),
              'Check values map has correct bytes value key',
            ).to.be.true;
            helper.recordPrivateApi('call.BufferUtils.base64Decode');
            helper.recordPrivateApi('call.BufferUtils.areBuffersEqual');
            expect(
              BufferUtils.areBuffersEqual(valuesMap.get('emptyBytesKey').value(), BufferUtils.base64Decode('')),
              'Check values map has correct empty bytes value key',
            ).to.be.true;
            expect(valuesMap.get('maxSafeIntegerKey').value()).to.equal(
              Number.MAX_SAFE_INTEGER,
              'Check values map has correct maxSafeIntegerKey value',
            );
            expect(valuesMap.get('negativeMaxSafeIntegerKey').value()).to.equal(
              -Number.MAX_SAFE_INTEGER,
              'Check values map has correct negativeMaxSafeIntegerKey value',
            );
            expect(valuesMap.get('numberKey').value()).to.equal(1, 'Check values map has correct number value key');
            expect(valuesMap.get('zeroKey').value()).to.equal(0, 'Check values map has correct zero number value key');
            expect(valuesMap.get('trueKey').value()).to.equal(true, `Check values map has correct 'true' value key`);
            expect(valuesMap.get('falseKey').value()).to.equal(false, `Check values map has correct 'false' value key`);
            expect(valuesMap.get('objectKey').value()).to.deep.equal(
              { foo: 'bar' },
              `Check values map has correct objectKey value`,
            );
            expect(valuesMap.get('arrayKey').value()).to.deep.equal(
              ['foo', 'bar', 'baz'],
              `Check values map has correct arrayKey value`,
            );

            const mapFromValuesMap = valuesMap.get('mapKey');
            expect(mapFromValuesMap.size()).to.equal(1, 'Check nested map has correct number of keys');
          },
        },

        {
          description: 'OBJECT_SYNC sequence with "tombstone=true" for an object creates tombstoned object',
          action: async (ctx) => {
            const { entryInstance, objectsHelper, channel } = ctx;

            const mapId = objectsHelper.fakeMapObjectId();
            const counterId = objectsHelper.fakeCounterObjectId();
            await objectsHelper.processObjectStateMessageOnChannel({
              channel,
              syncSerial: 'serial:', // empty serial so sync sequence ends immediately
              // add object states with tombstone=true
              state: [
                objectsHelper.mapObject({
                  objectId: mapId,
                  siteTimeserials: {
                    aaa: lexicoTimeserial('aaa', 0, 0),
                  },
                  tombstone: true,
                  initialEntries: {},
                }),
                objectsHelper.counterObject({
                  objectId: counterId,
                  siteTimeserials: {
                    aaa: lexicoTimeserial('aaa', 0, 0),
                  },
                  tombstone: true,
                  initialCount: 1,
                }),
                objectsHelper.mapObject({
                  objectId: 'root',
                  siteTimeserials: { aaa: lexicoTimeserial('aaa', 0, 0) },
                  initialEntries: {
                    map: { timeserial: lexicoTimeserial('aaa', 0, 0), data: { objectId: mapId } },
                    counter: { timeserial: lexicoTimeserial('aaa', 0, 0), data: { objectId: counterId } },
                    foo: { timeserial: lexicoTimeserial('aaa', 0, 0), data: { string: 'bar' } },
                  },
                }),
              ],
            });

            expect(
              entryInstance.get('map'),
              'Check map does not exist on root after OBJECT_SYNC with "tombstone=true" for a map object',
            ).to.not.exist;
            expect(
              entryInstance.get('counter'),
              'Check counter does not exist on root after OBJECT_SYNC with "tombstone=true" for a counter object',
            ).to.not.exist;
            // control check that OBJECT_SYNC was applied at all
            expect(entryInstance.get('foo'), 'Check property exists on root after OBJECT_SYNC').to.exist;
          },
        },

        {
          allTransportsAndProtocols: true,
          description: 'OBJECT_SYNC sequence with "tombstone=true" for an object deletes existing object',
          action: async (ctx) => {
            const { objectsHelper, channelName, channel, entryInstance } = ctx;

            const counterCreatedPromise = waitForMapKeyUpdate(entryInstance, 'counter');
            const { objectId: counterId } = await objectsHelper.createAndSetOnMap(channelName, {
              mapObjectId: 'root',
              key: 'counter',
              createOp: objectsHelper.counterCreateRestOp({ number: 1 }),
            });
            await counterCreatedPromise;

            expect(
              entryInstance.get('counter'),
              'Check counter exists on root before OBJECT_SYNC sequence with "tombstone=true"',
            ).to.exist;

            // inject an OBJECT_SYNC message where a counter is now tombstoned
            await objectsHelper.processObjectStateMessageOnChannel({
              channel,
              syncSerial: 'serial:', // empty serial so sync sequence ends immediately
              state: [
                objectsHelper.counterObject({
                  objectId: counterId,
                  siteTimeserials: {
                    aaa: lexicoTimeserial('aaa', 0, 0),
                  },
                  tombstone: true,
                  initialCount: 1,
                }),
                objectsHelper.mapObject({
                  objectId: 'root',
                  siteTimeserials: { aaa: lexicoTimeserial('aaa', 0, 0) },
                  initialEntries: {
                    counter: { timeserial: lexicoTimeserial('aaa', 0, 0), data: { objectId: counterId } },
                    foo: { timeserial: lexicoTimeserial('aaa', 0, 0), data: { string: 'bar' } },
                  },
                }),
              ],
            });

            expect(
              entryInstance.get('counter'),
              'Check counter does not exist on root after OBJECT_SYNC with "tombstone=true" for an existing counter object',
            ).to.not.exist;
            // control check that OBJECT_SYNC was applied at all
            expect(entryInstance.get('foo'), 'Check property exists on root after OBJECT_SYNC').to.exist;
          },
        },

        {
          allTransportsAndProtocols: true,
          description:
            'OBJECT_SYNC sequence with "tombstone=true" for an object triggers subscription callback for existing object',
          action: async (ctx) => {
            const { objectsHelper, channelName, channel, entryInstance } = ctx;

            const counterCreatedPromise = waitForMapKeyUpdate(entryInstance, 'counter');
            const { objectId: counterId } = await objectsHelper.createAndSetOnMap(channelName, {
              mapObjectId: 'root',
              key: 'counter',
              createOp: objectsHelper.counterCreateRestOp({ number: 1 }),
            });
            await counterCreatedPromise;

            const counter = entryInstance.get('counter');

            const counterSubPromise = new Promise((resolve, reject) =>
              counter.subscribe((event) => {
                try {
                  expect(event.object).to.equal(
                    counter,
                    'Check counter subscription callback is called with the correct object',
                  );
                  resolve();
                } catch (error) {
                  reject(error);
                }
              }),
            );

            // inject an OBJECT_SYNC message where counter is now tombstoned
            await objectsHelper.processObjectStateMessageOnChannel({
              channel,
              syncSerial: 'serial:', // empty serial so sync sequence ends immediately
              state: [
                objectsHelper.counterObject({
                  objectId: counterId,
                  siteTimeserials: {
                    aaa: lexicoTimeserial('aaa', 0, 0),
                  },
                  tombstone: true,
                  initialCount: 1,
                }),
                objectsHelper.mapObject({
                  objectId: 'root',
                  siteTimeserials: { aaa: lexicoTimeserial('aaa', 0, 0) },
                  initialEntries: {
                    counter: { timeserial: lexicoTimeserial('aaa', 0, 0), data: { objectId: counterId } },
                  },
                }),
              ],
            });

            await counterSubPromise;
          },
        },

        {
          description:
            'OBJECT_SYNC sequence with "tombstone=true" for an object sets "tombstoneAt" from "serialTimestamp"',
          action: async (ctx) => {
            const { helper, objectsHelper, channel, realtimeObject } = ctx;

            const counterId = objectsHelper.fakeCounterObjectId();
            const serialTimestamp = 1234567890;
            await objectsHelper.processObjectStateMessageOnChannel({
              channel,
              syncSerial: 'serial:', // empty serial so sync sequence ends immediately
              serialTimestamp,
              state: [
                objectsHelper.counterObject({
                  objectId: counterId,
                  siteTimeserials: {
                    aaa: lexicoTimeserial('aaa', 0, 0),
                  },
                  tombstone: true,
                  initialCount: 1,
                }),
                objectsHelper.mapObject({
                  objectId: 'root',
                  siteTimeserials: { aaa: lexicoTimeserial('aaa', 0, 0) },
                  initialEntries: {
                    counter: { timeserial: lexicoTimeserial('aaa', 0, 0), data: { objectId: counterId } },
                  },
                }),
              ],
            });

            helper.recordPrivateApi('call.RealtimeObject._objectsPool.get');
            const obj = realtimeObject._objectsPool.get(counterId);
            expect(obj, 'Check object added to the pool OBJECT_SYNC sequence with "tombstone=true"').to.exist;
            helper.recordPrivateApi('call.LiveObject.tombstonedAt');
            expect(obj.tombstonedAt()).to.equal(
              serialTimestamp,
              `Check object's "tombstonedAt" value is set to "serialTimestamp" from OBJECT_SYNC sequence`,
            );
          },
        },

        {
          description:
            'OBJECT_SYNC sequence with "tombstone=true" for an object sets "tombstoneAt" using local clock if missing "serialTimestamp"',
          action: async (ctx) => {
            const { helper, objectsHelper, channel, realtimeObject } = ctx;

            const tsBeforeMsg = Date.now();
            const counterId = objectsHelper.fakeCounterObjectId();
            await objectsHelper.processObjectStateMessageOnChannel({
              // don't provide serialTimestamp
              channel,
              syncSerial: 'serial:', // empty serial so sync sequence ends immediately
              state: [
                objectsHelper.counterObject({
                  objectId: counterId,
                  siteTimeserials: {
                    aaa: lexicoTimeserial('aaa', 0, 0),
                  },
                  tombstone: true,
                  initialCount: 1,
                }),
                objectsHelper.mapObject({
                  objectId: 'root',
                  siteTimeserials: { aaa: lexicoTimeserial('aaa', 0, 0) },
                  initialEntries: {
                    counter: { timeserial: lexicoTimeserial('aaa', 0, 0), data: { objectId: counterId } },
                  },
                }),
              ],
            });
            const tsAfterMsg = Date.now();

            helper.recordPrivateApi('call.RealtimeObject._objectsPool.get');
            const obj = realtimeObject._objectsPool.get(counterId);
            expect(obj, 'Check object added to the pool OBJECT_SYNC sequence with "tombstone=true"').to.exist;
            helper.recordPrivateApi('call.LiveObject.tombstonedAt');
            expect(
              tsBeforeMsg <= obj.tombstonedAt() && obj.tombstonedAt() <= tsAfterMsg,
              `Check object's "tombstonedAt" value is set using local clock if no "serialTimestamp" provided`,
            ).to.be.true;
          },
        },

        {
          description:
            'OBJECT_SYNC sequence with "tombstone=true" for a map entry sets "tombstoneAt" from "serialTimestamp"',
          action: async (ctx) => {
            const { helper, entryInstance, objectsHelper, channel } = ctx;

            const serialTimestamp = 1234567890;
            await objectsHelper.processObjectStateMessageOnChannel({
              channel,
              syncSerial: 'serial:', // empty serial so sync sequence ends immediately
              state: [
                objectsHelper.mapObject({
                  objectId: 'root',
                  siteTimeserials: { aaa: lexicoTimeserial('aaa', 0, 0) },
                  initialEntries: {
                    foo: {
                      timeserial: lexicoTimeserial('aaa', 0, 0),
                      data: { string: 'bar' },
                      tombstone: true,
                      serialTimestamp,
                    },
                  },
                }),
              ],
            });

            helper.recordPrivateApi('read.DefaultInstance._value');
            helper.recordPrivateApi('read.LiveMap._dataRef.data');
            const mapEntry = entryInstance._value._dataRef.data.get('foo');
            expect(
              mapEntry,
              'Check map entry is added to root internal data after OBJECT_SYNC sequence with "tombstone=true" for a map entry',
            ).to.exist;
            expect(mapEntry.tombstonedAt).to.equal(
              serialTimestamp,
              `Check map entry's "tombstonedAt" value is set to "serialTimestamp" from OBJECT_SYNC sequence`,
            );
          },
        },

        {
          description:
            'OBJECT_SYNC sequence with "tombstone=true" for a map entry sets "tombstoneAt" using local clock if missing "serialTimestamp"',
          action: async (ctx) => {
            const { helper, entryInstance, objectsHelper, channel } = ctx;

            const tsBeforeMsg = Date.now();
            await objectsHelper.processObjectStateMessageOnChannel({
              channel,
              syncSerial: 'serial:', // empty serial so sync sequence ends immediately
              state: [
                objectsHelper.mapObject({
                  objectId: 'root',
                  siteTimeserials: { aaa: lexicoTimeserial('aaa', 0, 0) },
                  initialEntries: {
                    foo: {
                      timeserial: lexicoTimeserial('aaa', 0, 0),
                      data: { string: 'bar' },
                      tombstone: true,
                      // don't provide serialTimestamp
                    },
                  },
                }),
              ],
            });
            const tsAfterMsg = Date.now();

            helper.recordPrivateApi('read.DefaultInstance._value');
            helper.recordPrivateApi('read.LiveMap._dataRef.data');
            const mapEntry = entryInstance._value._dataRef.data.get('foo');
            expect(
              mapEntry,
              'Check map entry is added to root internal data after OBJECT_SYNC sequence with "tombstone=true" for a map entry',
            ).to.exist;
            expect(
              tsBeforeMsg <= mapEntry.tombstonedAt && mapEntry.tombstonedAt <= tsAfterMsg,
              `Check map entry's "tombstonedAt" value is set using local clock if no "serialTimestamp" provided`,
            ).to.be.true;
          },
        },

        {
          description: 'OBJECT_SYNC sequence with clearTimeserial records the clearTimeserial',
          action: async (ctx) => {
            const { entryInstance, objectsHelper, channel } = ctx;

            const clearTimeserial = lexicoTimeserial('aaa', 5, 0);

            // send OBJECT_SYNC with a map that has clearTimeserial and no entries
            await objectsHelper.processObjectStateMessageOnChannel({
              channel,
              syncSerial: 'serial:', // empty cursor so sync completes immediately
              state: [
                objectsHelper.mapObject({
                  objectId: 'root',
                  siteTimeserials: { aaa: lexicoTimeserial('aaa', 5, 0) },
                  clearTimeserial,
                }),
              ],
            });

            expect(entryInstance.size(), 'Check root is empty after sync').to.equal(0);

            // verify subsequent MAP_SETs are filtered based on clearTimeserial.
            // use different sites so operations pass siteTimeserials check
            const ops = [
              { serial: lexicoTimeserial('bbb', 4, 0), siteCode: 'bbb', key: 'earlyKey', applied: false }, // < clearTimeserial
              { serial: lexicoTimeserial('ccc', 6, 0), siteCode: 'ccc', key: 'laterKey', applied: true }, // > clearTimeserial
            ];

            for (const { serial, siteCode, key, applied } of ops) {
              await objectsHelper.processObjectOperationMessageOnChannel({
                channel,
                serial,
                siteCode,
                state: [objectsHelper.mapSetOp({ objectId: 'root', key, data: { string: 'value' } })],
              });

              if (applied) {
                expect(entryInstance.get(key)?.value(), `Check MAP_SET for "${key}" is applied`).to.equal('value');
              } else {
                expect(entryInstance.get(key), `Check MAP_SET for "${key}" is rejected`).to.not.exist;
              }
            }
          },
        },

        {
          description: 'OBJECT_SYNC sequence with clearTimeserial does not surface initial entries from createOp',
          action: async (ctx) => {
            const { entryInstance, objectsHelper, channel } = ctx;

            const clearTimeserial = lexicoTimeserial('aaa', 5, 0);

            // send OBJECT_SYNC with a map that has clearTimeserial and initial entries via createOp.
            // initial entries do not have timeserials set, so they should all be considered
            // as predating the clear and not be surfaced to the end user.
            await objectsHelper.processObjectStateMessageOnChannel({
              channel,
              syncSerial: 'serial:', // empty cursor so sync completes immediately
              state: [
                objectsHelper.mapObject({
                  objectId: 'root',
                  siteTimeserials: { aaa: lexicoTimeserial('aaa', 5, 0) },
                  clearTimeserial,
                  initialEntries: {
                    foo: { data: { string: 'bar' } },
                    baz: { data: { number: 123 } },
                  },
                }),
              ],
            });

            expect(entryInstance.get('foo'), 'Check "foo" from initialEntries is not visible').to.not.exist;
            expect(entryInstance.get('baz'), 'Check "baz" from initialEntries is not visible').to.not.exist;
            expect(entryInstance.size(), 'Check root has no visible keys').to.equal(0);
          },
        },

        {
          description: 'OBJECT_SYNC sequence with clearTimeserial and materialised entries processes entries correctly',
          action: async (ctx) => {
            const { entryInstance, objectsHelper, channel } = ctx;

            const clearTimeserial = lexicoTimeserial('aaa', 5, 0);

            // check that even with clearTimeserial set, the entries from materialised entries are
            // processed correctly.
            await objectsHelper.processObjectStateMessageOnChannel({
              channel,
              syncSerial: 'serial:', // empty cursor so sync completes immediately
              state: [
                objectsHelper.mapObject({
                  objectId: 'root',
                  siteTimeserials: { aaa: lexicoTimeserial('aaa', 8, 0) },
                  clearTimeserial,
                  materialisedEntries: {
                    // entry set after the clear - should be visible
                    lateKey: {
                      timeserial: lexicoTimeserial('aaa', 8, 0),
                      data: { string: 'late' },
                    },
                  },
                }),
              ],
            });

            expect(entryInstance.get('lateKey').value(), 'Check lateKey is visible (postdates clear)').to.equal('late');
            expect(entryInstance.size(), 'Check root has 1 visible key').to.equal(1);
          },
        },

        {
          description: 'reattach with HAS_OBJECTS=false resets clearTimeserial to null on root map',
          action: async (ctx) => {
            const { objectsHelper, channel, entryInstance, helper } = ctx;

            // apply MAP_CLEAR to set clearTimeserial on root
            await objectsHelper.processObjectOperationMessageOnChannel({
              channel,
              serial: lexicoTimeserial('aaa', 10, 0),
              siteCode: 'aaa',
              state: [objectsHelper.mapClearOp({ objectId: 'root' })],
            });

            // verify clearTimeserial is set
            helper.recordPrivateApi('read.DefaultInstance._value');
            helper.recordPrivateApi('read.LiveMap._clearTimeserial');
            expect(entryInstance._value._clearTimeserial, 'Check clearTimeserial is set after MAP_CLEAR').to.equal(
              lexicoTimeserial('aaa', 10, 0),
            );

            // simulate reattach with HAS_OBJECTS=false, which resets root to a zero-value
            await injectAttachedMessage(helper, channel, false);

            // clearTimeserial should be now set to null for root
            expect(
              entryInstance._value._clearTimeserial,
              'Check clearTimeserial is null after reattach with HAS_OBJECTS=false',
            ).to.not.exist;
          },
        },
      ];

      /**
       * These scenarios test that operations received over the Realtime connection
       * (triggered via REST API) are correctly applied. All operations here are sent
       * via REST, so the client receives them as echoes over Realtime.
       *
       * For tests of operations applied locally on ACK (via SDK write methods),
       * see the "Apply on ACK" test section.
       */
      const applyOperationsScenarios = [
        {
          allTransportsAndProtocols: true,
          description: 'can apply MAP_CREATE with primitives object operation messages',
          action: async (ctx) => {
            const { objectsHelper, channelName, helper, entryInstance } = ctx;

            // Objects public API allows us to check value of objects we've created based on MAP_CREATE ops
            // if we assign those objects to another map (root for example), as there is no way to access those objects from the internal pool directly.
            // however, in this test we put heavy focus on the data that is being created as the result of the MAP_CREATE op.

            // check no maps exist on root
            primitiveMapsFixtures.forEach((fixture) => {
              const key = fixture.name;
              expect(entryInstance.get(key), `Check "${key}" key doesn't exist on root before applying MAP_CREATE ops`)
                .to.not.exist;
            });

            const mapsCreatedPromise = Promise.all(
              primitiveMapsFixtures.map((x) => waitForMapKeyUpdate(entryInstance, x.name)),
            );
            // create new maps and set on root
            await Promise.all(
              primitiveMapsFixtures.map((fixture) =>
                objectsHelper.createAndSetOnMap(channelName, {
                  mapObjectId: 'root',
                  key: fixture.name,
                  createOp: objectsHelper.mapCreateRestOp({
                    data: Object.fromEntries(fixture.entries.map((v) => [v.key, v.jsonData])),
                  }),
                }),
              ),
            );
            await mapsCreatedPromise;

            // check created maps
            primitiveMapsFixtures.forEach((fixture) => {
              const mapKey = fixture.name;
              const map = entryInstance.get(mapKey);

              // check all maps exist on root
              expect(map, `Check map at "${mapKey}" key in root exists`).to.exist;
              helper.recordPrivateApi('read.DefaultInstance._value');
              expectInstanceOf(map._value, 'LiveMap', `Check map at "${mapKey}" key in root is of type LiveMap`);

              // check primitive maps have correct values
              expect(map.size()).to.equal(fixture.entries.length, `Check map "${mapKey}" has correct number of keys`);

              fixture.entries.forEach((keyData) => {
                checkKeyDataOnInstance({
                  helper,
                  key: keyData.key,
                  keyData,
                  instance: map,
                  msg: `Check map "${mapKey}" has correct value for "${keyData.key}" key`,
                });
              });
            });
          },
        },

        {
          allTransportsAndProtocols: true,
          description: 'can apply MAP_CREATE with object ids object operation messages',
          action: async (ctx) => {
            const { objectsHelper, channelName, entryInstance, helper } = ctx;
            const withReferencesMapKey = 'withReferencesMap';

            // Objects public API allows us to check value of objects we've created based on MAP_CREATE ops
            // if we assign those objects to another map (root for example), as there is no way to access those objects from the internal pool directly.
            // however, in this test we put heavy focus on the data that is being created as the result of the MAP_CREATE op.

            // check map does not exist on root
            expect(
              entryInstance.get(withReferencesMapKey),
              `Check "${withReferencesMapKey}" key doesn't exist on root before applying MAP_CREATE ops`,
            ).to.not.exist;

            const mapCreatedPromise = waitForMapKeyUpdate(entryInstance, withReferencesMapKey);
            // create map with references. need to create referenced objects first to obtain their object ids
            const { objectId: referencedMapObjectId } = await objectsHelper.operationRequest(
              channelName,
              objectsHelper.mapCreateRestOp({ data: { stringKey: { string: 'stringValue' } } }),
            );
            const { objectId: referencedCounterObjectId } = await objectsHelper.operationRequest(
              channelName,
              objectsHelper.counterCreateRestOp({ number: 1 }),
            );
            await objectsHelper.createAndSetOnMap(channelName, {
              mapObjectId: 'root',
              key: withReferencesMapKey,
              createOp: objectsHelper.mapCreateRestOp({
                data: {
                  mapReference: { objectId: referencedMapObjectId },
                  counterReference: { objectId: referencedCounterObjectId },
                },
              }),
            });
            await mapCreatedPromise;

            // check map with references exist on root
            const withReferencesMap = entryInstance.get(withReferencesMapKey);
            expect(withReferencesMap, `Check map at "${withReferencesMapKey}" key in root exists`).to.exist;
            helper.recordPrivateApi('read.DefaultInstance._value');
            expectInstanceOf(
              withReferencesMap._value,
              'LiveMap',
              `Check map at "${withReferencesMapKey}" key in root is of type LiveMap`,
            );

            // check map with references has correct values
            expect(withReferencesMap.size()).to.equal(
              2,
              `Check map "${withReferencesMapKey}" has correct number of keys`,
            );

            const referencedCounter = withReferencesMap.get('counterReference');
            const referencedMap = withReferencesMap.get('mapReference');

            expect(referencedCounter, `Check counter at "counterReference" exists`).to.exist;
            helper.recordPrivateApi('read.DefaultInstance._value');
            expectInstanceOf(
              referencedCounter._value,
              'LiveCounter',
              `Check counter at "counterReference" key is of type LiveCounter`,
            );
            expect(referencedCounter.value()).to.equal(1, 'Check counter at "counterReference" key has correct value');

            expect(referencedMap, `Check map at "mapReference" key exists`).to.exist;
            helper.recordPrivateApi('read.DefaultInstance._value');
            expectInstanceOf(referencedMap._value, 'LiveMap', `Check map at "mapReference" key is of type LiveMap`);

            expect(referencedMap.size()).to.equal(1, 'Check map at "mapReference" key has correct number of keys');
            expect(referencedMap.get('stringKey').value()).to.equal(
              'stringValue',
              'Check map at "mapReference" key has correct "stringKey" value',
            );
          },
        },

        {
          description:
            'MAP_CREATE object operation messages are applied based on the site timeserials vector of the object',
          action: async (ctx) => {
            const { entryInstance, objectsHelper, channel } = ctx;

            // need to use multiple maps as MAP_CREATE op can only be applied once to a map object
            const mapIds = [
              objectsHelper.fakeMapObjectId(),
              objectsHelper.fakeMapObjectId(),
              objectsHelper.fakeMapObjectId(),
              objectsHelper.fakeMapObjectId(),
              objectsHelper.fakeMapObjectId(),
            ];
            await Promise.all(
              mapIds.map(async (mapId, i) => {
                // send a MAP_SET op first to create a zero-value map with forged site timeserials vector (from the op), and set it on a root.
                await objectsHelper.processObjectOperationMessageOnChannel({
                  channel,
                  serial: lexicoTimeserial('bbb', 1, 0),
                  siteCode: 'bbb',
                  state: [objectsHelper.mapSetOp({ objectId: mapId, key: 'foo', data: { string: 'bar' } })],
                });
                await objectsHelper.processObjectOperationMessageOnChannel({
                  channel,
                  serial: lexicoTimeserial('aaa', i, 0),
                  siteCode: 'aaa',
                  state: [objectsHelper.mapSetOp({ objectId: 'root', key: mapId, data: { objectId: mapId } })],
                });
              }),
            );

            // inject operations with various timeserial values
            for (const [i, { serial, siteCode }] of [
              { serial: lexicoTimeserial('bbb', 0, 0), siteCode: 'bbb' }, // existing site, earlier CGO, not applied
              { serial: lexicoTimeserial('bbb', 1, 0), siteCode: 'bbb' }, // existing site, same CGO, not applied
              { serial: lexicoTimeserial('bbb', 2, 0), siteCode: 'bbb' }, // existing site, later CGO, applied
              { serial: lexicoTimeserial('aaa', 0, 0), siteCode: 'aaa' }, // different site, earlier CGO, applied
              { serial: lexicoTimeserial('ccc', 9, 0), siteCode: 'ccc' }, // different site, later CGO, applied
            ].entries()) {
              await objectsHelper.processObjectOperationMessageOnChannel({
                channel,
                serial,
                siteCode,
                state: [
                  objectsHelper.mapCreateOp({
                    objectId: mapIds[i],
                    entries: {
                      baz: { timeserial: serial, data: { string: 'qux' } },
                    },
                  }),
                ],
              });
            }

            // check only operations with correct timeserials were applied
            const expectedMapValues = [
              { foo: 'bar' },
              { foo: 'bar' },
              { foo: 'bar', baz: 'qux' }, // applied MAP_CREATE
              { foo: 'bar', baz: 'qux' }, // applied MAP_CREATE
              { foo: 'bar', baz: 'qux' }, // applied MAP_CREATE
            ];

            for (const [i, mapId] of mapIds.entries()) {
              const expectedMapValue = expectedMapValues[i];
              const expectedKeysCount = Object.keys(expectedMapValue).length;

              expect(entryInstance.get(mapId).size()).to.equal(
                expectedKeysCount,
                `Check map #${i + 1} has expected number of keys after MAP_CREATE ops`,
              );
              Object.entries(expectedMapValue).forEach(([key, value]) => {
                expect(entryInstance.get(mapId).get(key).value()).to.equal(
                  value,
                  `Check map #${i + 1} has expected value for "${key}" key after MAP_CREATE ops`,
                );
              });
            }
          },
        },

        {
          description: 'only one MAP_CREATE operation is applied for the same object ID',
          action: async (ctx) => {
            const { entryInstance, objectsHelper, channel } = ctx;

            // It's possible for multiple MAP_CREATE operations, with different serials, to be received
            // for the same object ID. The object ID is derived from the operation's content, so they will
            // have identical content. The client should only merge one of these operations into the object's data.

            // create new map and set on root
            const mapId = objectsHelper.fakeMapObjectId();
            await objectsHelper.processObjectOperationMessageOnChannel({
              channel,
              serial: lexicoTimeserial('aaa', 0, 0),
              siteCode: 'aaa',
              state: [
                objectsHelper.mapCreateOp({
                  objectId: mapId,
                  entries: {
                    foo: { timeserial: lexicoTimeserial('aaa', 0, 0), data: { string: 'bar' } },
                  },
                }),
              ],
            });
            await objectsHelper.processObjectOperationMessageOnChannel({
              channel,
              serial: lexicoTimeserial('aaa', 1, 0),
              siteCode: 'aaa',
              state: [objectsHelper.mapSetOp({ objectId: 'root', key: mapId, data: { objectId: mapId } })],
            });

            expect(entryInstance.get(mapId).size()).to.equal(1, 'Check map has 1 key after first MAP_CREATE');
            expect(entryInstance.get(mapId).get('foo').value()).to.equal(
              'bar',
              'Check map has correct "foo" value after first MAP_CREATE',
            );

            // send another MAP_CREATE op for the same object ID, from a different site, with a later entry timeserial
            await objectsHelper.processObjectOperationMessageOnChannel({
              channel,
              serial: lexicoTimeserial('ccc', 0, 0),
              siteCode: 'ccc',
              state: [
                objectsHelper.mapCreateOp({
                  objectId: mapId,
                  entries: {
                    foo: { timeserial: lexicoTimeserial('ccc', 0, 0), data: { string: 'bar' } },
                  },
                }),
              ],
            });

            // verify the second CREATE was not applied by checking that a MAP_SET with an intermediate
            // timeserial ('bbb') can still be applied. if the second CREATE had been wrongly applied,
            // the entry's timeserial would be 'ccc' and this MAP_SET would be rejected.
            await objectsHelper.processObjectOperationMessageOnChannel({
              channel,
              serial: lexicoTimeserial('bbb', 0, 0),
              siteCode: 'bbb',
              state: [objectsHelper.mapSetOp({ objectId: mapId, key: 'foo', data: { string: 'updated' } })],
            });

            expect(entryInstance.get(mapId).get('foo').value()).to.equal(
              'updated',
              'Check MAP_SET was applied, proving second MAP_CREATE did not update entry timeserial',
            );
          },
        },

        {
          allTransportsAndProtocols: true,
          description: 'can apply MAP_SET with primitives object operation messages',
          action: async (ctx) => {
            const { objectsHelper, channelName, helper, entryInstance } = ctx;

            // check root is empty before ops
            primitiveKeyData.forEach((keyData) => {
              expect(
                entryInstance.get(keyData.key),
                `Check "${keyData.key}" key doesn't exist on root before applying MAP_SET ops`,
              ).to.not.exist;
            });

            const keysUpdatedPromise = Promise.all(
              primitiveKeyData.map((x) => waitForMapKeyUpdate(entryInstance, x.key)),
            );
            // apply MAP_SET ops
            await Promise.all(
              primitiveKeyData.map((keyData) =>
                objectsHelper.operationRequest(
                  channelName,
                  objectsHelper.mapSetRestOp({
                    objectId: 'root',
                    key: keyData.key,
                    value: keyData.jsonData,
                  }),
                ),
              ),
            );
            await keysUpdatedPromise;

            // check everything is applied correctly
            primitiveKeyData.forEach((keyData) => {
              checkKeyDataOnInstance({
                helper,
                key: keyData.key,
                keyData,
                instance: entryInstance,
                msg: `Check root has correct value for "${keyData.key}" key after MAP_SET op`,
              });
            });
          },
        },

        {
          allTransportsAndProtocols: true,
          description: 'can apply MAP_SET with object ids object operation messages',
          action: async (ctx) => {
            const { objectsHelper, channelName, entryInstance, helper } = ctx;

            // check no object ids are set on root
            expect(
              entryInstance.get('keyToCounter'),
              `Check "keyToCounter" key doesn't exist on root before applying MAP_SET ops`,
            ).to.not.exist;
            expect(
              entryInstance.get('keyToMap'),
              `Check "keyToMap" key doesn't exist on root before applying MAP_SET ops`,
            ).to.not.exist;

            const objectsCreatedPromise = Promise.all([
              waitForMapKeyUpdate(entryInstance, 'keyToCounter'),
              waitForMapKeyUpdate(entryInstance, 'keyToMap'),
            ]);
            // create new objects and set on root
            await objectsHelper.createAndSetOnMap(channelName, {
              mapObjectId: 'root',
              key: 'keyToCounter',
              createOp: objectsHelper.counterCreateRestOp({ number: 1 }),
            });

            await objectsHelper.createAndSetOnMap(channelName, {
              mapObjectId: 'root',
              key: 'keyToMap',
              createOp: objectsHelper.mapCreateRestOp({
                data: {
                  stringKey: { string: 'stringValue' },
                },
              }),
            });
            await objectsCreatedPromise;

            // check root has refs to new objects and they are not zero-value
            const counter = entryInstance.get('keyToCounter');
            const map = entryInstance.get('keyToMap');

            expect(counter, 'Check counter at "keyToCounter" key in root exists').to.exist;
            helper.recordPrivateApi('read.DefaultInstance._value');
            expectInstanceOf(
              counter._value,
              'LiveCounter',
              'Check counter at "keyToCounter" key in root is of type LiveCounter',
            );
            expect(counter.value()).to.equal(1, 'Check counter at "keyToCounter" key in root has correct value');

            expect(map, 'Check map at "keyToMap" key in root exists').to.exist;
            helper.recordPrivateApi('read.DefaultInstance._value');
            expectInstanceOf(map._value, 'LiveMap', 'Check map at "keyToMap" key in root is of type LiveMap');
            expect(map.size()).to.equal(1, 'Check map at "keyToMap" key in root has correct number of keys');
            expect(map.get('stringKey').value()).to.equal(
              'stringValue',
              'Check map at "keyToMap" key in root has correct "stringKey" value',
            );
          },
        },

        {
          description:
            'MAP_SET object operation messages are applied based on the site timeserials vector of the object',
          action: async (ctx) => {
            const { entryInstance, objectsHelper, channel } = ctx;

            // create new map and set it on a root with forged timeserials
            const mapId = objectsHelper.fakeMapObjectId();
            await objectsHelper.processObjectOperationMessageOnChannel({
              channel,
              serial: lexicoTimeserial('bbb', 1, 0),
              siteCode: 'bbb',
              state: [
                objectsHelper.mapCreateOp({
                  objectId: mapId,
                  entries: {
                    foo1: { timeserial: lexicoTimeserial('bbb', 0, 0), data: { string: 'bar' } },
                    foo2: { timeserial: lexicoTimeserial('bbb', 0, 0), data: { string: 'bar' } },
                    foo3: { timeserial: lexicoTimeserial('bbb', 0, 0), data: { string: 'bar' } },
                    foo4: { timeserial: lexicoTimeserial('bbb', 0, 0), data: { string: 'bar' } },
                    foo5: { timeserial: lexicoTimeserial('bbb', 0, 0), data: { string: 'bar' } },
                    foo6: { timeserial: lexicoTimeserial('bbb', 0, 0), data: { string: 'bar' } },
                  },
                }),
              ],
            });
            await objectsHelper.processObjectOperationMessageOnChannel({
              channel,
              serial: lexicoTimeserial('aaa', 0, 0),
              siteCode: 'aaa',
              state: [objectsHelper.mapSetOp({ objectId: 'root', key: 'map', data: { objectId: mapId } })],
            });

            // inject operations with various timeserial values
            for (const [i, { serial, siteCode }] of [
              { serial: lexicoTimeserial('bbb', 0, 0), siteCode: 'bbb' }, // existing site, earlier site CGO, not applied
              { serial: lexicoTimeserial('bbb', 1, 0), siteCode: 'bbb' }, // existing site, same site CGO, not applied
              { serial: lexicoTimeserial('bbb', 2, 0), siteCode: 'bbb' }, // existing site, later site CGO, applied, site timeserials updated
              { serial: lexicoTimeserial('bbb', 2, 0), siteCode: 'bbb' }, // existing site, same site CGO (updated from last op), not applied
              { serial: lexicoTimeserial('aaa', 0, 0), siteCode: 'aaa' }, // different site, earlier entry CGO, not applied
              { serial: lexicoTimeserial('ccc', 9, 0), siteCode: 'ccc' }, // different site, later entry CGO, applied
            ].entries()) {
              await objectsHelper.processObjectOperationMessageOnChannel({
                channel,
                serial,
                siteCode,
                state: [objectsHelper.mapSetOp({ objectId: mapId, key: `foo${i + 1}`, data: { string: 'baz' } })],
              });
            }

            // check only operations with correct timeserials were applied
            const expectedMapKeys = [
              { key: 'foo1', value: 'bar' },
              { key: 'foo2', value: 'bar' },
              { key: 'foo3', value: 'baz' }, // updated
              { key: 'foo4', value: 'bar' },
              { key: 'foo5', value: 'bar' },
              { key: 'foo6', value: 'baz' }, // updated
            ];

            expectedMapKeys.forEach(({ key, value }) => {
              expect(entryInstance.get('map').get(key).value()).to.equal(
                value,
                `Check "${key}" key on map has expected value after MAP_SET ops`,
              );
            });
          },
        },

        {
          allTransportsAndProtocols: true,
          description: 'can apply MAP_REMOVE object operation messages',
          action: async (ctx) => {
            const { objectsHelper, channelName, entryInstance } = ctx;
            const mapKey = 'map';

            const mapCreatedPromise = waitForMapKeyUpdate(entryInstance, mapKey);
            // create new map and set on root
            const { objectId: mapObjectId } = await objectsHelper.createAndSetOnMap(channelName, {
              mapObjectId: 'root',
              key: mapKey,
              createOp: objectsHelper.mapCreateRestOp({
                data: {
                  shouldStay: { string: 'foo' },
                  shouldDelete: { string: 'bar' },
                },
              }),
            });
            await mapCreatedPromise;

            const map = entryInstance.get(mapKey);
            // check map has expected keys before MAP_REMOVE ops
            expect(map.size()).to.equal(
              2,
              `Check map at "${mapKey}" key in root has correct number of keys before MAP_REMOVE`,
            );
            expect(map.get('shouldStay').value()).to.equal(
              'foo',
              `Check map at "${mapKey}" key in root has correct "shouldStay" value before MAP_REMOVE`,
            );
            expect(map.get('shouldDelete').value()).to.equal(
              'bar',
              `Check map at "${mapKey}" key in root has correct "shouldDelete" value before MAP_REMOVE`,
            );

            const keyRemovedPromise = waitForMapKeyUpdate(map, 'shouldDelete');
            // send MAP_REMOVE op
            await objectsHelper.operationRequest(
              channelName,
              objectsHelper.mapRemoveRestOp({
                objectId: mapObjectId,
                key: 'shouldDelete',
              }),
            );
            await keyRemovedPromise;

            // check map has correct keys after MAP_REMOVE ops
            expect(map.size()).to.equal(
              1,
              `Check map at "${mapKey}" key in root has correct number of keys after MAP_REMOVE`,
            );
            expect(map.get('shouldStay').value()).to.equal(
              'foo',
              `Check map at "${mapKey}" key in root has correct "shouldStay" value after MAP_REMOVE`,
            );
            expect(
              map.get('shouldDelete'),
              `Check map at "${mapKey}" key in root has no "shouldDelete" key after MAP_REMOVE`,
            ).to.not.exist;
          },
        },

        {
          description:
            'MAP_REMOVE object operation messages are applied based on the site timeserials vector of the object',
          action: async (ctx) => {
            const { entryInstance, objectsHelper, channel } = ctx;

            // create new map and set it on a root with forged timeserials
            const mapId = objectsHelper.fakeMapObjectId();
            await objectsHelper.processObjectOperationMessageOnChannel({
              channel,
              serial: lexicoTimeserial('bbb', 1, 0),
              siteCode: 'bbb',
              state: [
                objectsHelper.mapCreateOp({
                  objectId: mapId,
                  entries: {
                    foo1: { timeserial: lexicoTimeserial('bbb', 0, 0), data: { string: 'bar' } },
                    foo2: { timeserial: lexicoTimeserial('bbb', 0, 0), data: { string: 'bar' } },
                    foo3: { timeserial: lexicoTimeserial('bbb', 0, 0), data: { string: 'bar' } },
                    foo4: { timeserial: lexicoTimeserial('bbb', 0, 0), data: { string: 'bar' } },
                    foo5: { timeserial: lexicoTimeserial('bbb', 0, 0), data: { string: 'bar' } },
                    foo6: { timeserial: lexicoTimeserial('bbb', 0, 0), data: { string: 'bar' } },
                  },
                }),
              ],
            });
            await objectsHelper.processObjectOperationMessageOnChannel({
              channel,
              serial: lexicoTimeserial('aaa', 0, 0),
              siteCode: 'aaa',
              state: [objectsHelper.mapSetOp({ objectId: 'root', key: 'map', data: { objectId: mapId } })],
            });

            // inject operations with various timeserial values
            for (const [i, { serial, siteCode }] of [
              { serial: lexicoTimeserial('bbb', 0, 0), siteCode: 'bbb' }, // existing site, earlier site CGO, not applied
              { serial: lexicoTimeserial('bbb', 1, 0), siteCode: 'bbb' }, // existing site, same site CGO, not applied
              { serial: lexicoTimeserial('bbb', 2, 0), siteCode: 'bbb' }, // existing site, later site CGO, applied, site timeserials updated
              { serial: lexicoTimeserial('bbb', 2, 0), siteCode: 'bbb' }, // existing site, same site CGO (updated from last op), not applied
              { serial: lexicoTimeserial('aaa', 0, 0), siteCode: 'aaa' }, // different site, earlier entry CGO, not applied
              { serial: lexicoTimeserial('ccc', 9, 0), siteCode: 'ccc' }, // different site, later entry CGO, applied
            ].entries()) {
              await objectsHelper.processObjectOperationMessageOnChannel({
                channel,
                serial,
                siteCode,
                state: [objectsHelper.mapRemoveOp({ objectId: mapId, key: `foo${i + 1}` })],
              });
            }

            // check only operations with correct timeserials were applied
            const expectedMapKeys = [
              { key: 'foo1', exists: true },
              { key: 'foo2', exists: true },
              { key: 'foo3', exists: false }, // removed
              { key: 'foo4', exists: true },
              { key: 'foo5', exists: true },
              { key: 'foo6', exists: false }, // removed
            ];

            expectedMapKeys.forEach(({ key, exists }) => {
              if (exists) {
                expect(entryInstance.get('map').get(key), `Check "${key}" key on map still exists after MAP_REMOVE ops`)
                  .to.exist;
              } else {
                expect(
                  entryInstance.get('map').get(key),
                  `Check "${key}" key on map does not exist after MAP_REMOVE ops`,
                ).to.not.exist;
              }
            });
          },
        },

        {
          description: 'MAP_REMOVE for a map entry sets "tombstoneAt" from "serialTimestamp"',
          action: async (ctx) => {
            const { helper, channel, entryInstance, objectsHelper } = ctx;

            const serialTimestamp = 1234567890;
            await objectsHelper.processObjectOperationMessageOnChannel({
              channel,
              serial: lexicoTimeserial('aaa', 0, 0),
              serialTimestamp,
              siteCode: 'aaa',
              state: [objectsHelper.mapRemoveOp({ objectId: 'root', key: 'foo' })],
            });

            helper.recordPrivateApi('read.DefaultInstance._value');
            helper.recordPrivateApi('read.LiveMap._dataRef.data');
            const mapEntry = entryInstance._value._dataRef.data.get('foo');
            expect(mapEntry, 'Check map entry is added to root internal data after MAP_REMOVE for a map entry').to
              .exist;
            expect(mapEntry.tombstonedAt).to.equal(
              serialTimestamp,
              `Check map entry's "tombstonedAt" value is set to "serialTimestamp" from MAP_REMOVE`,
            );
          },
        },

        {
          description: 'MAP_REMOVE for a map entry sets "tombstoneAt" using local clock if missing "serialTimestamp"',
          action: async (ctx) => {
            const { helper, channel, entryInstance, objectsHelper } = ctx;

            const tsBeforeMsg = Date.now();
            await objectsHelper.processObjectOperationMessageOnChannel({
              channel,
              serial: lexicoTimeserial('aaa', 0, 0),
              // don't provide serialTimestamp
              siteCode: 'aaa',
              state: [objectsHelper.mapRemoveOp({ objectId: 'root', key: 'foo' })],
            });
            const tsAfterMsg = Date.now();

            helper.recordPrivateApi('read.DefaultInstance._value');
            helper.recordPrivateApi('read.LiveMap._dataRef.data');
            const mapEntry = entryInstance._value._dataRef.data.get('foo');
            expect(mapEntry, 'Check map entry is added to root internal data after MAP_REMOVE for a map entry').to
              .exist;
            expect(
              tsBeforeMsg <= mapEntry.tombstonedAt && mapEntry.tombstonedAt <= tsAfterMsg,
              `Check map entry's "tombstonedAt" value is set using local clock if no "serialTimestamp" provided`,
            ).to.be.true;
          },
        },

        {
          allTransportsAndProtocols: true,
          description: 'can apply COUNTER_CREATE object operation messages',
          action: async (ctx) => {
            const { objectsHelper, channelName, entryInstance, helper } = ctx;

            // Objects public API allows us to check value of objects we've created based on COUNTER_CREATE ops
            // if we assign those objects to another map (root for example), as there is no way to access those objects from the internal pool directly.
            // however, in this test we put heavy focus on the data that is being created as the result of the COUNTER_CREATE op.

            // check no counters exist on root
            countersFixtures.forEach((fixture) => {
              const key = fixture.name;
              expect(
                entryInstance.get(key),
                `Check "${key}" key doesn't exist on root before applying COUNTER_CREATE ops`,
              ).to.not.exist;
            });

            const countersCreatedPromise = Promise.all(
              countersFixtures.map((x) => waitForMapKeyUpdate(entryInstance, x.name)),
            );
            // create new counters and set on root
            await Promise.all(
              countersFixtures.map((fixture) =>
                objectsHelper.createAndSetOnMap(channelName, {
                  mapObjectId: 'root',
                  key: fixture.name,
                  createOp: objectsHelper.counterCreateRestOp({ number: fixture.count }),
                }),
              ),
            );
            await countersCreatedPromise;

            // check created counters
            countersFixtures.forEach((fixture) => {
              const key = fixture.name;
              const counter = entryInstance.get(key);

              // check all counters exist on root
              expect(counter, `Check counter at "${key}" key in root exists`).to.exist;
              helper.recordPrivateApi('read.DefaultInstance._value');
              expectInstanceOf(
                counter._value,
                'LiveCounter',
                `Check counter at "${key}" key in root is of type LiveCounter`,
              );

              // check counters have correct values
              expect(counter.value()).to.equal(
                // if count was not set, should default to 0
                fixture.count ?? 0,
                `Check counter at "${key}" key in root has correct value`,
              );
            });
          },
        },

        {
          description:
            'COUNTER_CREATE object operation messages are applied based on the site timeserials vector of the object',
          action: async (ctx) => {
            const { entryInstance, objectsHelper, channel } = ctx;

            // need to use multiple counters as COUNTER_CREATE op can only be applied once to a counter object
            const counterIds = [
              objectsHelper.fakeCounterObjectId(),
              objectsHelper.fakeCounterObjectId(),
              objectsHelper.fakeCounterObjectId(),
              objectsHelper.fakeCounterObjectId(),
              objectsHelper.fakeCounterObjectId(),
            ];
            await Promise.all(
              counterIds.map(async (counterId, i) => {
                // send a COUNTER_INC op first to create a zero-value counter with forged site timeserials vector (from the op), and set it on a root.
                await objectsHelper.processObjectOperationMessageOnChannel({
                  channel,
                  serial: lexicoTimeserial('bbb', 1, 0),
                  siteCode: 'bbb',
                  state: [objectsHelper.counterIncOp({ objectId: counterId, amount: 1 })],
                });
                await objectsHelper.processObjectOperationMessageOnChannel({
                  channel,
                  serial: lexicoTimeserial('aaa', i, 0),
                  siteCode: 'aaa',
                  state: [objectsHelper.mapSetOp({ objectId: 'root', key: counterId, data: { objectId: counterId } })],
                });
              }),
            );

            // inject operations with various timeserial values
            for (const [i, { serial, siteCode }] of [
              { serial: lexicoTimeserial('bbb', 0, 0), siteCode: 'bbb' }, // existing site, earlier CGO, not applied
              { serial: lexicoTimeserial('bbb', 1, 0), siteCode: 'bbb' }, // existing site, same CGO, not applied
              { serial: lexicoTimeserial('bbb', 2, 0), siteCode: 'bbb' }, // existing site, later CGO, applied
              { serial: lexicoTimeserial('aaa', 0, 0), siteCode: 'aaa' }, // different site, earlier CGO, applied
              { serial: lexicoTimeserial('ccc', 9, 0), siteCode: 'ccc' }, // different site, later CGO, applied
            ].entries()) {
              await objectsHelper.processObjectOperationMessageOnChannel({
                channel,
                serial,
                siteCode,
                state: [objectsHelper.counterCreateOp({ objectId: counterIds[i], count: 10 })],
              });
            }

            // check only operations with correct timeserials were applied
            const expectedCounterValues = [
              1,
              1,
              11, // applied COUNTER_CREATE
              11, // applied COUNTER_CREATE
              11, // applied COUNTER_CREATE
            ];

            for (const [i, counterId] of counterIds.entries()) {
              const expectedValue = expectedCounterValues[i];

              expect(entryInstance.get(counterId).value()).to.equal(
                expectedValue,
                `Check counter #${i + 1} has expected value after COUNTER_CREATE ops`,
              );
            }
          },
        },

        {
          description: 'only one COUNTER_CREATE operation is applied for the same object ID',
          action: async (ctx) => {
            const { entryInstance, objectsHelper, channel } = ctx;

            // It's possible for multiple COUNTER_CREATE operations, with different serials, to be received
            // for the same object ID. The object ID is derived from the operation's content, so they will
            // have identical content. The client should only merge one of these operations into the object's data.

            // create new counter and set on root
            const counterId = objectsHelper.fakeCounterObjectId();
            await objectsHelper.processObjectOperationMessageOnChannel({
              channel,
              serial: lexicoTimeserial('aaa', 0, 0),
              siteCode: 'aaa',
              state: [objectsHelper.counterCreateOp({ objectId: counterId, count: 10 })],
            });
            await objectsHelper.processObjectOperationMessageOnChannel({
              channel,
              serial: lexicoTimeserial('aaa', 1, 0),
              siteCode: 'aaa',
              state: [objectsHelper.mapSetOp({ objectId: 'root', key: counterId, data: { objectId: counterId } })],
            });

            expect(entryInstance.get(counterId).value()).to.equal(
              10,
              'Check counter has value 10 after first COUNTER_CREATE',
            );

            // send another COUNTER_CREATE op for the same object ID, from a different site
            await objectsHelper.processObjectOperationMessageOnChannel({
              channel,
              serial: lexicoTimeserial('bbb', 0, 0),
              siteCode: 'bbb',
              state: [objectsHelper.counterCreateOp({ objectId: counterId, count: 10 })],
            });

            // verify the second CREATE was not applied - if it had been, the count would have been
            // added again (10 + 10 = 20) due to how COUNTER_CREATE merges into existing state
            expect(entryInstance.get(counterId).value()).to.equal(
              10,
              'Check counter still has value 10 after second COUNTER_CREATE (not applied)',
            );
          },
        },

        {
          allTransportsAndProtocols: true,
          description: 'can apply COUNTER_INC object operation messages',
          action: async (ctx) => {
            const { objectsHelper, channelName, entryInstance } = ctx;
            const counterKey = 'counter';
            let expectedCounterValue = 0;

            const counterCreated = waitForMapKeyUpdate(entryInstance, counterKey);
            // create new counter and set on root
            const { objectId: counterObjectId } = await objectsHelper.createAndSetOnMap(channelName, {
              mapObjectId: 'root',
              key: counterKey,
              createOp: objectsHelper.counterCreateRestOp({ number: expectedCounterValue }),
            });
            await counterCreated;

            const counter = entryInstance.get(counterKey);
            // check counter has expected value before COUNTER_INC
            expect(counter.value()).to.equal(
              expectedCounterValue,
              `Check counter at "${counterKey}" key in root has correct value before COUNTER_INC`,
            );

            const increments = [
              1, // value=1
              10, // value=11
              100, // value=111
              1000000, // value=1000111
              -1000111, // value=0
              -1, // value=-1
              -10, // value=-11
              -100, // value=-111
              -1000000, // value=-1000111
              1000111, // value=0
              Number.MAX_SAFE_INTEGER, // value=9007199254740991
              // do next decrements in 2 steps as opposed to multiplying by -2 to prevent overflow
              -Number.MAX_SAFE_INTEGER, // value=0
              -Number.MAX_SAFE_INTEGER, // value=-9007199254740991
            ];

            // send increments one at a time and check expected value
            for (let i = 0; i < increments.length; i++) {
              const increment = increments[i];
              expectedCounterValue += increment;

              const counterUpdatedPromise = waitForCounterUpdate(counter);
              await objectsHelper.operationRequest(
                channelName,
                objectsHelper.counterIncRestOp({
                  objectId: counterObjectId,
                  number: increment,
                }),
              );
              await counterUpdatedPromise;

              expect(counter.value()).to.equal(
                expectedCounterValue,
                `Check counter at "${counterKey}" key in root has correct value after ${i + 1} COUNTER_INC ops`,
              );
            }
          },
        },

        {
          description:
            'COUNTER_INC object operation messages are applied based on the site timeserials vector of the object',
          action: async (ctx) => {
            const { entryInstance, objectsHelper, channel } = ctx;

            // create new counter and set it on a root with forged timeserials
            const counterId = objectsHelper.fakeCounterObjectId();
            await objectsHelper.processObjectOperationMessageOnChannel({
              channel,
              serial: lexicoTimeserial('bbb', 1, 0),
              siteCode: 'bbb',
              state: [objectsHelper.counterCreateOp({ objectId: counterId, count: 1 })],
            });
            await objectsHelper.processObjectOperationMessageOnChannel({
              channel,
              serial: lexicoTimeserial('aaa', 0, 0),
              siteCode: 'aaa',
              state: [objectsHelper.mapSetOp({ objectId: 'root', key: 'counter', data: { objectId: counterId } })],
            });

            // inject operations with various timeserial values
            for (const [i, { serial, siteCode }] of [
              { serial: lexicoTimeserial('bbb', 0, 0), siteCode: 'bbb' }, // +10       existing site, earlier CGO, not applied
              { serial: lexicoTimeserial('bbb', 1, 0), siteCode: 'bbb' }, // +100      existing site, same CGO, not applied
              { serial: lexicoTimeserial('bbb', 2, 0), siteCode: 'bbb' }, // +1000     existing site, later CGO, applied, site timeserials updated
              { serial: lexicoTimeserial('bbb', 2, 0), siteCode: 'bbb' }, // +10000    existing site, same CGO (updated from last op), not applied
              { serial: lexicoTimeserial('aaa', 0, 0), siteCode: 'aaa' }, // +100000   different site, earlier CGO, applied
              { serial: lexicoTimeserial('ccc', 9, 0), siteCode: 'ccc' }, // +1000000  different site, later CGO, applied
            ].entries()) {
              await objectsHelper.processObjectOperationMessageOnChannel({
                channel,
                serial,
                siteCode,
                state: [objectsHelper.counterIncOp({ objectId: counterId, amount: Math.pow(10, i + 1) })],
              });
            }

            // check only operations with correct timeserials were applied
            expect(entryInstance.get('counter').value()).to.equal(
              1 + 1000 + 100000 + 1000000, // sum of passing operations and the initial value
              `Check counter has expected value after COUNTER_INC ops`,
            );
          },
        },

        {
          description: 'can apply OBJECT_DELETE object operation messages',
          action: async (ctx) => {
            const { objectsHelper, channelName, channel, entryInstance } = ctx;

            const objectsCreatedPromise = Promise.all([
              waitForMapKeyUpdate(entryInstance, 'map'),
              waitForMapKeyUpdate(entryInstance, 'counter'),
            ]);
            // create initial objects and set on root
            const { objectId: mapObjectId } = await objectsHelper.createAndSetOnMap(channelName, {
              mapObjectId: 'root',
              key: 'map',
              createOp: objectsHelper.mapCreateRestOp(),
            });
            const { objectId: counterObjectId } = await objectsHelper.createAndSetOnMap(channelName, {
              mapObjectId: 'root',
              key: 'counter',
              createOp: objectsHelper.counterCreateRestOp(),
            });
            await objectsCreatedPromise;

            expect(entryInstance.get('map'), 'Check map exists on root before OBJECT_DELETE').to.exist;
            expect(entryInstance.get('counter'), 'Check counter exists on root before OBJECT_DELETE').to.exist;

            // inject OBJECT_DELETE
            await objectsHelper.processObjectOperationMessageOnChannel({
              channel,
              serial: lexicoTimeserial('aaa', 0, 0),
              siteCode: 'aaa',
              state: [objectsHelper.objectDeleteOp({ objectId: mapObjectId })],
            });
            await objectsHelper.processObjectOperationMessageOnChannel({
              channel,
              serial: lexicoTimeserial('aaa', 1, 0),
              siteCode: 'aaa',
              state: [objectsHelper.objectDeleteOp({ objectId: counterObjectId })],
            });

            expect(entryInstance.get('map'), 'Check map is not accessible on root after OBJECT_DELETE').to.not.exist;
            expect(entryInstance.get('counter'), 'Check counter is not accessible on root after OBJECT_DELETE').to.not
              .exist;
          },
        },

        {
          description: 'OBJECT_DELETE for unknown object id creates zero-value tombstoned object',
          action: async (ctx) => {
            const { entryInstance, objectsHelper, channel } = ctx;

            const counterId = objectsHelper.fakeCounterObjectId();
            // inject OBJECT_DELETE. should create a zero-value tombstoned object which can't be modified
            await objectsHelper.processObjectOperationMessageOnChannel({
              channel,
              serial: lexicoTimeserial('aaa', 0, 0),
              siteCode: 'aaa',
              state: [objectsHelper.objectDeleteOp({ objectId: counterId })],
            });

            // try to create and set tombstoned object on root
            await objectsHelper.processObjectOperationMessageOnChannel({
              channel,
              serial: lexicoTimeserial('bbb', 0, 0),
              siteCode: 'bbb',
              state: [objectsHelper.counterCreateOp({ objectId: counterId })],
            });
            await objectsHelper.processObjectOperationMessageOnChannel({
              channel,
              serial: lexicoTimeserial('bbb', 1, 0),
              siteCode: 'bbb',
              state: [objectsHelper.mapSetOp({ objectId: 'root', key: 'counter', data: { objectId: counterId } })],
            });

            expect(entryInstance.get('counter'), 'Check counter is not accessible on root').to.not.exist;
          },
        },

        {
          description:
            'OBJECT_DELETE object operation messages are applied based on the site timeserials vector of the object',
          action: async (ctx) => {
            const { entryInstance, objectsHelper, channel } = ctx;

            // need to use multiple objects as OBJECT_DELETE op can only be applied once to an object
            const counterIds = [
              objectsHelper.fakeCounterObjectId(),
              objectsHelper.fakeCounterObjectId(),
              objectsHelper.fakeCounterObjectId(),
              objectsHelper.fakeCounterObjectId(),
              objectsHelper.fakeCounterObjectId(),
            ];
            await Promise.all(
              counterIds.map(async (counterId, i) => {
                // create objects and set them on root with forged timeserials
                await objectsHelper.processObjectOperationMessageOnChannel({
                  channel,
                  serial: lexicoTimeserial('bbb', 1, 0),
                  siteCode: 'bbb',
                  state: [objectsHelper.counterCreateOp({ objectId: counterId })],
                });
                await objectsHelper.processObjectOperationMessageOnChannel({
                  channel,
                  serial: lexicoTimeserial('aaa', i, 0),
                  siteCode: 'aaa',
                  state: [objectsHelper.mapSetOp({ objectId: 'root', key: counterId, data: { objectId: counterId } })],
                });
              }),
            );

            // inject OBJECT_DELETE operations with various timeserial values
            for (const [i, { serial, siteCode }] of [
              { serial: lexicoTimeserial('bbb', 0, 0), siteCode: 'bbb' }, // existing site, earlier CGO, not applied
              { serial: lexicoTimeserial('bbb', 1, 0), siteCode: 'bbb' }, // existing site, same CGO, not applied
              { serial: lexicoTimeserial('bbb', 2, 0), siteCode: 'bbb' }, // existing site, later CGO, applied
              { serial: lexicoTimeserial('aaa', 0, 0), siteCode: 'aaa' }, // different site, earlier CGO, applied
              { serial: lexicoTimeserial('ccc', 9, 0), siteCode: 'ccc' }, // different site, later CGO, applied
            ].entries()) {
              await objectsHelper.processObjectOperationMessageOnChannel({
                channel,
                serial,
                siteCode,
                state: [objectsHelper.objectDeleteOp({ objectId: counterIds[i] })],
              });
            }

            // check only operations with correct timeserials were applied
            const expectedCounters = [
              { exists: true },
              { exists: true },
              { exists: false }, // OBJECT_DELETE applied
              { exists: false }, // OBJECT_DELETE applied
              { exists: false }, // OBJECT_DELETE applied
            ];

            for (const [i, counterId] of counterIds.entries()) {
              const { exists } = expectedCounters[i];

              if (exists) {
                expect(
                  entryInstance.get(counterId),
                  `Check counter #${i + 1} exists on root as OBJECT_DELETE op was not applied`,
                ).to.exist;
              } else {
                expect(
                  entryInstance.get(counterId),
                  `Check counter #${i + 1} does not exist on root as OBJECT_DELETE op was applied`,
                ).to.not.exist;
              }
            }
          },
        },

        {
          description: 'OBJECT_DELETE triggers subscription callback with deleted data',
          action: async (ctx) => {
            const { objectsHelper, channelName, channel, entryInstance } = ctx;

            const objectsCreatedPromise = Promise.all([
              waitForMapKeyUpdate(entryInstance, 'map'),
              waitForMapKeyUpdate(entryInstance, 'counter'),
            ]);
            // create initial objects and set on root
            const { objectId: mapObjectId } = await objectsHelper.createAndSetOnMap(channelName, {
              mapObjectId: 'root',
              key: 'map',
              createOp: objectsHelper.mapCreateRestOp({
                data: {
                  foo: { string: 'bar' },
                  baz: { number: 1 },
                },
              }),
            });
            const { objectId: counterObjectId } = await objectsHelper.createAndSetOnMap(channelName, {
              mapObjectId: 'root',
              key: 'counter',
              createOp: objectsHelper.counterCreateRestOp({ number: 1 }),
            });
            await objectsCreatedPromise;

            const mapId = entryInstance.get('map').id;
            const counterId = entryInstance.get('counter').id;

            const mapSubPromise = new Promise((resolve, reject) =>
              entryInstance.get('map').subscribe((event) => {
                try {
                  expect(event?.message?.operation).to.deep.include(
                    { action: 'object.delete', objectId: mapId },
                    'Check map subscription callback is called with an expected event message after OBJECT_DELETE operation',
                  );
                  resolve();
                } catch (error) {
                  reject(error);
                }
              }),
            );
            const counterSubPromise = new Promise((resolve, reject) =>
              entryInstance.get('counter').subscribe((event) => {
                try {
                  expect(event?.message?.operation).to.deep.include(
                    { action: 'object.delete', objectId: counterId },
                    'Check counter subscription callback is called with an expected event message after OBJECT_DELETE operation',
                  );
                  resolve();
                } catch (error) {
                  reject(error);
                }
              }),
            );

            // inject OBJECT_DELETE
            await objectsHelper.processObjectOperationMessageOnChannel({
              channel,
              serial: lexicoTimeserial('aaa', 0, 0),
              siteCode: 'aaa',
              state: [objectsHelper.objectDeleteOp({ objectId: mapObjectId })],
            });
            await objectsHelper.processObjectOperationMessageOnChannel({
              channel,
              serial: lexicoTimeserial('aaa', 1, 0),
              siteCode: 'aaa',
              state: [objectsHelper.objectDeleteOp({ objectId: counterObjectId })],
            });

            await Promise.all([mapSubPromise, counterSubPromise]);
          },
        },

        {
          description: 'OBJECT_DELETE for an object sets "tombstoneAt" from "serialTimestamp"',
          action: async (ctx) => {
            const { objectsHelper, channelName, channel, helper, realtimeObject, entryInstance } = ctx;

            const objectCreatedPromise = waitForMapKeyUpdate(entryInstance, 'object');
            const { objectId } = await objectsHelper.createAndSetOnMap(channelName, {
              mapObjectId: 'root',
              key: 'object',
              createOp: objectsHelper.counterCreateRestOp(),
            });
            await objectCreatedPromise;

            expect(entryInstance.get('object'), 'Check object exists on root before OBJECT_DELETE').to.exist;

            // inject OBJECT_DELETE
            const serialTimestamp = 1234567890;
            await objectsHelper.processObjectOperationMessageOnChannel({
              channel,
              serial: lexicoTimeserial('aaa', 1, 0),
              serialTimestamp,
              siteCode: 'aaa',
              state: [objectsHelper.objectDeleteOp({ objectId })],
            });

            helper.recordPrivateApi('call.RealtimeObject._objectsPool.get');
            const obj = realtimeObject._objectsPool.get(objectId);
            helper.recordPrivateApi('call.LiveObject.isTombstoned');
            expect(obj.isTombstoned()).to.equal(true, `Check object is tombstoned after OBJECT_DELETE`);
            helper.recordPrivateApi('call.LiveObject.tombstonedAt');
            expect(obj.tombstonedAt()).to.equal(
              serialTimestamp,
              `Check object's "tombstonedAt" value is set to "serialTimestamp" from OBJECT_DELETE`,
            );
          },
        },

        {
          description: 'OBJECT_DELETE for an object sets "tombstoneAt" using local clock if missing "serialTimestamp"',
          action: async (ctx) => {
            const { objectsHelper, channelName, channel, helper, realtimeObject, entryInstance } = ctx;

            const objectCreatedPromise = waitForMapKeyUpdate(entryInstance, 'object');
            const { objectId } = await objectsHelper.createAndSetOnMap(channelName, {
              mapObjectId: 'root',
              key: 'object',
              createOp: objectsHelper.counterCreateRestOp(),
            });
            await objectCreatedPromise;

            expect(entryInstance.get('object'), 'Check object exists on root before OBJECT_DELETE').to.exist;

            const tsBeforeMsg = Date.now();
            // inject OBJECT_DELETE
            await objectsHelper.processObjectOperationMessageOnChannel({
              channel,
              serial: lexicoTimeserial('aaa', 1, 0),
              // don't provide serialTimestamp
              siteCode: 'aaa',
              state: [objectsHelper.objectDeleteOp({ objectId })],
            });
            const tsAfterMsg = Date.now();

            helper.recordPrivateApi('call.RealtimeObject._objectsPool.get');
            const obj = realtimeObject._objectsPool.get(objectId);
            helper.recordPrivateApi('call.LiveObject.isTombstoned');
            expect(obj.isTombstoned()).to.equal(true, `Check object is tombstoned after OBJECT_DELETE`);
            helper.recordPrivateApi('call.LiveObject.tombstonedAt');
            expect(
              tsBeforeMsg <= obj.tombstonedAt() && obj.tombstonedAt() <= tsAfterMsg,
              `Check object's "tombstonedAt" value is set using local clock if no "serialTimestamp" provided`,
            ).to.be.true;
          },
        },

        {
          description: 'MAP_SET with reference to a tombstoned object results in undefined value on key',
          action: async (ctx) => {
            const { objectsHelper, channelName, channel, entryInstance } = ctx;

            const objectCreatedPromise = waitForMapKeyUpdate(entryInstance, 'foo');
            // create initial objects and set on root
            const { objectId: counterObjectId } = await objectsHelper.createAndSetOnMap(channelName, {
              mapObjectId: 'root',
              key: 'foo',
              createOp: objectsHelper.counterCreateRestOp(),
            });
            await objectCreatedPromise;

            expect(entryInstance.get('foo'), 'Check counter exists on root before OBJECT_DELETE').to.exist;

            // inject OBJECT_DELETE
            await objectsHelper.processObjectOperationMessageOnChannel({
              channel,
              serial: lexicoTimeserial('aaa', 0, 0),
              siteCode: 'aaa',
              state: [objectsHelper.objectDeleteOp({ objectId: counterObjectId })],
            });

            // set tombstoned counter to another key on root
            await objectsHelper.processObjectOperationMessageOnChannel({
              channel,
              serial: lexicoTimeserial('aaa', 0, 0),
              siteCode: 'aaa',
              state: [objectsHelper.mapSetOp({ objectId: 'root', key: 'bar', data: { objectId: counterObjectId } })],
            });

            expect(entryInstance.get('bar'), 'Check counter is not accessible on new key in root after OBJECT_DELETE')
              .to.not.exist;
          },
        },

        {
          description: 'object operation message on a tombstoned object does not revive it',
          action: async (ctx) => {
            const { objectsHelper, channelName, channel, entryInstance } = ctx;

            const objectsCreatedPromise = Promise.all([
              waitForMapKeyUpdate(entryInstance, 'map1'),
              waitForMapKeyUpdate(entryInstance, 'map2'),
              waitForMapKeyUpdate(entryInstance, 'counter1'),
            ]);
            // create initial objects and set on root
            const { objectId: mapId1 } = await objectsHelper.createAndSetOnMap(channelName, {
              mapObjectId: 'root',
              key: 'map1',
              createOp: objectsHelper.mapCreateRestOp(),
            });
            const { objectId: mapId2 } = await objectsHelper.createAndSetOnMap(channelName, {
              mapObjectId: 'root',
              key: 'map2',
              createOp: objectsHelper.mapCreateRestOp({ data: { foo: { string: 'bar' } } }),
            });
            const { objectId: counterId1 } = await objectsHelper.createAndSetOnMap(channelName, {
              mapObjectId: 'root',
              key: 'counter1',
              createOp: objectsHelper.counterCreateRestOp(),
            });
            await objectsCreatedPromise;

            expect(entryInstance.get('map1'), 'Check map1 exists on root before OBJECT_DELETE').to.exist;
            expect(entryInstance.get('map2'), 'Check map2 exists on root before OBJECT_DELETE').to.exist;
            expect(entryInstance.get('counter1'), 'Check counter1 exists on root before OBJECT_DELETE').to.exist;

            // inject OBJECT_DELETE
            await objectsHelper.processObjectOperationMessageOnChannel({
              channel,
              serial: lexicoTimeserial('aaa', 0, 0),
              siteCode: 'aaa',
              state: [objectsHelper.objectDeleteOp({ objectId: mapId1 })],
            });
            await objectsHelper.processObjectOperationMessageOnChannel({
              channel,
              serial: lexicoTimeserial('aaa', 1, 0),
              siteCode: 'aaa',
              state: [objectsHelper.objectDeleteOp({ objectId: mapId2 })],
            });
            await objectsHelper.processObjectOperationMessageOnChannel({
              channel,
              serial: lexicoTimeserial('aaa', 2, 0),
              siteCode: 'aaa',
              state: [objectsHelper.objectDeleteOp({ objectId: counterId1 })],
            });

            // inject object operations on tombstoned objects
            await objectsHelper.processObjectOperationMessageOnChannel({
              channel,
              serial: lexicoTimeserial('aaa', 3, 0),
              siteCode: 'aaa',
              state: [objectsHelper.mapSetOp({ objectId: mapId1, key: 'baz', data: { string: 'qux' } })],
            });
            await objectsHelper.processObjectOperationMessageOnChannel({
              channel,
              serial: lexicoTimeserial('aaa', 4, 0),
              siteCode: 'aaa',
              state: [objectsHelper.mapRemoveOp({ objectId: mapId2, key: 'foo' })],
            });
            await objectsHelper.processObjectOperationMessageOnChannel({
              channel,
              serial: lexicoTimeserial('aaa', 5, 0),
              siteCode: 'aaa',
              state: [objectsHelper.counterIncOp({ objectId: counterId1, amount: 1 })],
            });

            // objects should still be deleted
            expect(
              entryInstance.get('map1'),
              'Check map1 does not exist on root after OBJECT_DELETE and another object op',
            ).to.not.exist;
            expect(
              entryInstance.get('map2'),
              'Check map2 does not exist on root after OBJECT_DELETE and another object op',
            ).to.not.exist;
            expect(
              entryInstance.get('counter1'),
              'Check counter1 does not exist on root after OBJECT_DELETE and another object op',
            ).to.not.exist;
          },
        },

        {
          description: 'can apply MAP_CLEAR object operation messages on root',
          action: async (ctx) => {
            const { objectsHelper, channel, entryInstance } = ctx;

            // set some keys on root
            await entryInstance.set('foo', 'bar');
            await entryInstance.set('baz', 42);

            // verify keys exist before clear
            expect(entryInstance.get('foo').value(), 'Check foo exists before MAP_CLEAR').to.equal('bar');
            expect(entryInstance.get('baz').value(), 'Check baz exists before MAP_CLEAR').to.equal(42);
            expect(entryInstance.size(), 'Check root has 2 keys before MAP_CLEAR').to.equal(2);

            // send MAP_CLEAR
            const clearAppliedPromise = waitForMapClear(entryInstance);
            await objectsHelper.sendMapClearOnChannel(channel, 'root');
            await clearAppliedPromise;

            // verify all keys are cleared
            expect(entryInstance.size(), 'Check root has 0 keys after MAP_CLEAR').to.equal(0);
            expect(entryInstance.get('foo'), 'Check foo does not exist after MAP_CLEAR').to.not.exist;
            expect(entryInstance.get('baz'), 'Check baz does not exist after MAP_CLEAR').to.not.exist;
          },
        },

        {
          // MAP_CLEAR is currently server-initiated and only emitted for root objects,
          // but the client must be future-proof and support it for any map object.
          description: 'can apply MAP_CLEAR object operation messages on non-root map objects',
          action: async (ctx) => {
            const { objectsHelper, channel, entryInstance } = ctx;

            // create a non-root map with entries
            await entryInstance.set('map', LiveMap.create({ foo: 'bar', baz: 42 }));

            const map = entryInstance.get('map');
            expect(map, 'Check map exists on root').to.exist;
            expect(map.size(), 'Check map has 2 keys before MAP_CLEAR').to.equal(2);
            expect(map.get('foo').value(), 'Check "foo" key has correct value').to.equal('bar');
            expect(map.get('baz').value(), 'Check "baz" key has correct value').to.equal(42);

            // apply MAP_CLEAR on non-root map via internal API call,
            // as the server won't accept MAP_CLEAR for non-root object ids.
            await objectsHelper.processObjectOperationMessageOnChannel({
              channel,
              serial: lexicoTimeserial('zzz', 99999999999999, 0),
              siteCode: 'zzz',
              state: [objectsHelper.mapClearOp({ objectId: map.id })],
            });

            // verify all keys are cleared
            expect(map.size(), 'Check map has 0 keys after MAP_CLEAR').to.equal(0);
            expect(map.get('foo'), 'Check "foo" key does not exist after MAP_CLEAR').to.not.exist;
            expect(map.get('baz'), 'Check "baz" key does not exist after MAP_CLEAR').to.not.exist;
          },
        },

        {
          description: 'MAP_CLEAR with older serial than current clearTimeserial is a noop',
          action: async (ctx) => {
            const { objectsHelper, channel, entryInstance } = ctx;

            await objectsHelper.processObjectOperationMessageOnChannel({
              channel,
              serial: lexicoTimeserial('aaa', 0, 0),
              siteCode: 'aaa',
              state: [objectsHelper.mapSetOp({ objectId: 'root', key: 'foo', data: { string: 'bar' } })],
            });

            // apply a sequence of operations and check expected state after each
            const steps = [
              {
                op: objectsHelper.mapClearOp({ objectId: 'root' }),
                serial: lexicoTimeserial('aaa', 10, 0),
                siteCode: 'aaa',
                description: 'first MAP_CLEAR',
                expectedSize: 0,
              },
              {
                op: objectsHelper.mapSetOp({ objectId: 'root', key: 'key1', data: { string: 'value' } }),
                serial: lexicoTimeserial('aaa', 11, 0),
                siteCode: 'aaa',
                description: 'MAP_SET #1 after clear',
                expectedSize: 1,
                expectedKeys: { key1: 'value' },
              },
              {
                op: objectsHelper.mapClearOp({ objectId: 'root' }),
                serial: lexicoTimeserial('bbb', 0, 0), // different site so siteTimeserials check passes, older than first clear - noop
                siteCode: 'bbb',
                description: 'second MAP_CLEAR with older serial (noop)',
                expectedSize: 1,
                expectedKeys: { key1: 'value' },
              },
            ];

            for (const step of steps) {
              await objectsHelper.processObjectOperationMessageOnChannel({
                channel,
                serial: step.serial,
                siteCode: step.siteCode,
                state: [step.op],
              });

              expect(entryInstance.size(), `Check map size after ${step.description}`).to.equal(step.expectedSize);
              for (const [key, value] of Object.entries(step.expectedKeys ?? {})) {
                expect(entryInstance.get(key)?.value(), `Check "${key}" after ${step.description}`).to.equal(value);
              }
            }
          },
        },

        {
          description: 'MAP_CLEAR does not remove entries with serial greater than clearTimeserial',
          action: async (ctx) => {
            const { objectsHelper, channel, entryInstance } = ctx;

            // set keys with different timeserials;
            const keys = [
              { key: 'key1', serial: lexicoTimeserial('aaa', 0, 0), siteCode: 'aaa', survivesClear: false }, // different site, earlier CGO, cleared
              { key: 'key2', serial: lexicoTimeserial('aaa', 999, 0), siteCode: 'aaa', survivesClear: true }, // different site, later CGO, survives
              { key: 'key3', serial: lexicoTimeserial('bbb', 5, 0), siteCode: 'bbb', survivesClear: false }, // same site, earlier CGO, cleared
              { key: 'key4', serial: lexicoTimeserial('ccc', 0, 0), siteCode: 'ccc', survivesClear: false }, // different site, earlier CGO, cleared
              { key: 'key5', serial: lexicoTimeserial('ccc', 999, 0), siteCode: 'ccc', survivesClear: true }, // different site, later CGO, survives
            ];

            for (const { key, serial, siteCode } of keys) {
              await objectsHelper.processObjectOperationMessageOnChannel({
                channel,
                serial,
                siteCode,
                state: [objectsHelper.mapSetOp({ objectId: 'root', key, data: { string: key } })],
              });
            }

            expect(entryInstance.size(), 'Check map has correct number of keys before MAP_CLEAR').to.equal(keys.length);

            // apply MAP_CLEAR with serial between existing keys
            await objectsHelper.processObjectOperationMessageOnChannel({
              channel,
              serial: lexicoTimeserial('bbb', 6, 0),
              siteCode: 'bbb',
              state: [objectsHelper.mapClearOp({ objectId: 'root' })],
            });

            let expectedToSurviveCount = 0;
            for (const { key, survivesClear } of keys) {
              expectedToSurviveCount += survivesClear ? 1 : 0;
              if (survivesClear) {
                expect(entryInstance.get(key)?.value(), `Check ${key} survives MAP_CLEAR`).to.equal(key);
              } else {
                expect(entryInstance.get(key), `Check ${key} is cleared`).to.not.exist;
              }
            }
            expect(entryInstance.size(), `Check map has ${expectedToSurviveCount} keys after MAP_CLEAR`).to.equal(
              expectedToSurviveCount,
            );
          },
        },

        {
          description:
            'MAP_CLEAR object operation messages are applied based on the site timeserials vector of the object',
          action: async (ctx) => {
            const { entryInstance, objectsHelper, channel } = ctx;

            const mapIds = [
              objectsHelper.fakeMapObjectId(),
              objectsHelper.fakeMapObjectId(),
              objectsHelper.fakeMapObjectId(),
              objectsHelper.fakeMapObjectId(),
              objectsHelper.fakeMapObjectId(),
            ];

            await Promise.all(
              mapIds.map(async (mapId, i) => {
                // for each map, send two operations:
                // 1. create a map with visible data that can be verified after MAP_CLEAR.
                // use earliest possible timeserial to ensure entries can be cleared by MAP_CLEAR ops
                await objectsHelper.processObjectOperationMessageOnChannel({
                  channel,
                  serial: lexicoTimeserial('aaa', 0, 0),
                  siteCode: 'aaa',
                  state: [
                    objectsHelper.mapCreateOp({
                      objectId: mapId,
                      entries: { foo: { timeserial: lexicoTimeserial('aaa', 0, 0), data: { string: 'bar' } } },
                    }),
                  ],
                });
                // 2. send a no-op remove to establish site 'ccc' in the map's siteTimeserials at a known serial,
                // which the MAP_CLEAR ops below will be compared against
                await objectsHelper.processObjectOperationMessageOnChannel({
                  channel,
                  serial: lexicoTimeserial('ccc', 5, 0),
                  siteCode: 'ccc',
                  state: [objectsHelper.mapRemoveOp({ objectId: mapId, key: 'baz' })],
                });

                // set map on root
                await objectsHelper.processObjectOperationMessageOnChannel({
                  channel,
                  serial: lexicoTimeserial('aaa', i, 0),
                  siteCode: 'aaa',
                  state: [objectsHelper.mapSetOp({ objectId: 'root', key: mapId, data: { objectId: mapId } })],
                });
              }),
            );

            // inject MAP_CLEAR operations with various timeserial values
            // relative to the lexicoTimeserial('ccc', 5, 0) from the remove op above
            const ops = [
              { serial: lexicoTimeserial('ccc', 4, 0), siteCode: 'ccc', cleared: false }, // existing site, earlier CGO, not applied
              { serial: lexicoTimeserial('ccc', 5, 0), siteCode: 'ccc', cleared: false }, // existing site, same CGO, not applied
              { serial: lexicoTimeserial('ccc', 6, 0), siteCode: 'ccc', cleared: true }, // existing site, later CGO, applied
              { serial: lexicoTimeserial('bbb', 1, 0), siteCode: 'bbb', cleared: true }, // different site, earlier CGO, applied
              { serial: lexicoTimeserial('ddd', 9, 0), siteCode: 'ddd', cleared: true }, // different site, later CGO, applied
            ];

            for (const [i, { serial, siteCode, cleared }] of ops.entries()) {
              const mapId = mapIds[i];

              await objectsHelper.processObjectOperationMessageOnChannel({
                channel,
                serial,
                siteCode,
                state: [objectsHelper.mapClearOp({ objectId: mapId })],
              });

              const map = entryInstance.get(mapId);
              if (cleared) {
                expect(map.size(), `Check map #${i + 1} is cleared`).to.equal(0);
              } else {
                expect(map.size(), `Check map #${i + 1} is not cleared`).to.equal(1);
                expect(map.get('foo').value(), `Check map #${i + 1} retains "foo" key`).to.equal('bar');
              }
            }
          },
        },

        {
          description: 'MAP_SET with serial <= clearTimeserial is ignored after MAP_CLEAR',
          action: async (ctx) => {
            const { objectsHelper, channel, entryInstance } = ctx;

            // apply MAP_CLEAR, stores clearTimeserial on a map
            await objectsHelper.processObjectOperationMessageOnChannel({
              channel,
              serial: lexicoTimeserial('aaa', 10, 0),
              siteCode: 'aaa',
              state: [objectsHelper.mapClearOp({ objectId: 'root' })],
            });

            // inject MAP_SET operations with various serials relative to clearTimeserial.
            // use different site codes to pass siteTimeserials check
            const ops = [
              { serial: lexicoTimeserial('bbb', 5, 0), siteCode: 'bbb', key: 'early', applied: false }, // earlier than clear, ignored
              { serial: lexicoTimeserial('aaa', 10, 0), siteCode: 'aaa', key: 'equal', applied: false }, // equal to clear, ignored
              { serial: lexicoTimeserial('bbb', 999, 0), siteCode: 'bbb', key: 'later', applied: true }, // later than clear, applied
            ];

            for (const { serial, siteCode, key, applied } of ops) {
              await objectsHelper.processObjectOperationMessageOnChannel({
                channel,
                serial,
                siteCode,
                state: [objectsHelper.mapSetOp({ objectId: 'root', key, data: { string: 'value' } })],
              });

              if (applied) {
                expect(entryInstance.get(key)?.value(), `Check MAP_SET for "${key}" is applied`).to.equal('value');
              } else {
                expect(entryInstance.get(key), `Check MAP_SET for "${key}" is ignored`).to.not.exist;
              }
            }
          },
        },

        {
          description: 'MAP_REMOVE with serial <= clearTimeserial is ignored after MAP_CLEAR',
          action: async (ctx) => {
            const { objectsHelper, channel, entryInstance, helper } = ctx;

            // apply MAP_CLEAR, stores clearTimeserial on a map
            await objectsHelper.processObjectOperationMessageOnChannel({
              channel,
              serial: lexicoTimeserial('aaa', 10, 0),
              siteCode: 'aaa',
              state: [objectsHelper.mapClearOp({ objectId: 'root' })],
            });

            // inject MAP_REMOVE operations with various serials relative to clearTimeserial.
            // use different site codes to pass siteTimeserials check
            const ops = [
              { serial: lexicoTimeserial('bbb', 5, 0), siteCode: 'bbb', key: 'early', applied: false }, // earlier than clear, ignored
              { serial: lexicoTimeserial('aaa', 10, 0), siteCode: 'aaa', key: 'equal', applied: false }, // equal to clear, ignored
              { serial: lexicoTimeserial('bbb', 999, 0), siteCode: 'bbb', key: 'later', applied: true }, // later than clear, applied
            ];

            for (const { serial, siteCode, key, applied } of ops) {
              await objectsHelper.processObjectOperationMessageOnChannel({
                channel,
                serial,
                siteCode,
                state: [objectsHelper.mapRemoveOp({ objectId: 'root', key })],
              });

              helper.recordPrivateApi('read.DefaultInstance._value');
              helper.recordPrivateApi('read.LiveMap._dataRef.data');
              if (applied) {
                const mapEntry = entryInstance._value._dataRef.data.get(key);
                expect(mapEntry, `Check MAP_REMOVE for "${key}" created an entry in internal data`).to.exist;
                expect(mapEntry.tombstone, `Check MAP_REMOVE for "${key}" is tombstoned`).to.be.true;
              } else {
                expect(entryInstance._value._dataRef.data.has(key), `Check MAP_REMOVE for "${key}" is ignored`).to.be
                  .false;
              }
            }
          },
        },

        {
          description: 'MAP_CLEAR removes entries from internal data map',
          action: async (ctx) => {
            const { helper, channel, entryInstance, objectsHelper } = ctx;

            // set a key on root so the clear has something to remove
            await objectsHelper.processObjectOperationMessageOnChannel({
              channel,
              serial: lexicoTimeserial('aaa', 0, 0),
              siteCode: 'aaa',
              state: [objectsHelper.mapSetOp({ objectId: 'root', key: 'foo', data: { string: 'bar' } })],
            });
            expect(entryInstance.get('foo'), 'Check "foo" exists before clear').to.exist;

            await objectsHelper.processObjectOperationMessageOnChannel({
              channel,
              serial: lexicoTimeserial('aaa', 5, 0),
              siteCode: 'aaa',
              state: [objectsHelper.mapClearOp({ objectId: 'root' })],
            });

            // entry should be fully removed from internal data
            helper.recordPrivateApi('read.DefaultInstance._value');
            helper.recordPrivateApi('read.LiveMap._dataRef.data');
            expect(entryInstance._value._dataRef.data.has('foo'), 'Check "foo" is removed from internal data').to.be
              .false;
          },
        },

        {
          description: 'MAP_CLEAR removes parent references for object reference entries',
          action: async (ctx) => {
            const { objectsHelper, channelName, channel, entryInstance, helper, realtimeObject } = ctx;

            const counterCreatedPromise = waitForMapKeyUpdate(entryInstance, 'counter');
            const { objectId: counterId } = await objectsHelper.createAndSetOnMap(channelName, {
              mapObjectId: 'root',
              key: 'counter',
              createOp: objectsHelper.counterCreateRestOp(),
            });
            await counterCreatedPromise;

            // verify counter has parent reference before clear
            helper.recordPrivateApi('call.RealtimeObject._objectsPool.get');
            const counterObj = realtimeObject._objectsPool.get(counterId);
            helper.recordPrivateApi('read.LiveObject._parentReferences');
            expect(counterObj._parentReferences.size, 'Check counter has parent references before MAP_CLEAR').to.equal(
              1,
            );

            // apply MAP_CLEAR on root
            await objectsHelper.sendMapClearOnChannel(channel, 'root');

            // verify counter no longer has parent reference
            helper.recordPrivateApi('read.LiveObject._parentReferences');
            expect(
              counterObj._parentReferences.size,
              'Check counter has no parent references after MAP_CLEAR',
            ).to.equal(0);
          },
        },
      ];

      const applyOperationsDuringSyncScenarios = [
        {
          description: 'object operation messages are buffered during OBJECT_SYNC sequence',
          action: async (ctx) => {
            const { entryInstance, objectsHelper, channel, client, helper } = ctx;

            // start new sync sequence with a cursor so client will wait for the next OBJECT_SYNC messages
            await objectsHelper.processObjectStateMessageOnChannel({
              channel,
              syncSerial: 'serial:cursor',
            });

            // inject operations, it should not be applied as sync is in progress
            await Promise.all(
              primitiveKeyData.map(async (keyData) => {
                // copy data object as library will modify it
                const data = { ...keyData.jsonData };
                helper.recordPrivateApi('read.realtime.options.useBinaryProtocol');
                if (data.bytes != null && client.options.useBinaryProtocol) {
                  // decode base64 data to binary for binary protocol
                  helper.recordPrivateApi('call.BufferUtils.base64Decode');
                  data.bytes = BufferUtils.base64Decode(data.bytes);
                }

                return objectsHelper.processObjectOperationMessageOnChannel({
                  channel,
                  serial: lexicoTimeserial('aaa', 0, 0),
                  siteCode: 'aaa',
                  state: [objectsHelper.mapSetOp({ objectId: 'root', key: keyData.key, data })],
                });
              }),
            );

            // check root doesn't have data from operations
            primitiveKeyData.forEach((keyData) => {
              expect(
                entryInstance.get(keyData.key),
                `Check "${keyData.key}" key doesn't exist on root during OBJECT_SYNC`,
              ).to.not.exist;
            });
          },
        },

        {
          description: 'buffered object operation messages are applied when OBJECT_SYNC sequence ends',
          action: async (ctx) => {
            const { entryInstance, objectsHelper, channel, helper, client } = ctx;

            // start new sync sequence with a cursor so client will wait for the next OBJECT_SYNC messages
            await objectsHelper.processObjectStateMessageOnChannel({
              channel,
              syncSerial: 'serial:cursor',
            });

            // inject operations, they should be applied when sync ends
            await Promise.all(
              primitiveKeyData.map(async (keyData, i) => {
                // copy data object as library will modify it
                const data = { ...keyData.jsonData };
                helper.recordPrivateApi('read.realtime.options.useBinaryProtocol');
                if (data.bytes != null && client.options.useBinaryProtocol) {
                  // decode base64 data to binary for binary protocol
                  helper.recordPrivateApi('call.BufferUtils.base64Decode');
                  data.bytes = BufferUtils.base64Decode(data.bytes);
                }

                return objectsHelper.processObjectOperationMessageOnChannel({
                  channel,
                  serial: lexicoTimeserial('aaa', i, 0),
                  siteCode: 'aaa',
                  state: [objectsHelper.mapSetOp({ objectId: 'root', key: keyData.key, data })],
                });
              }),
            );

            // end the sync with empty cursor
            await objectsHelper.processObjectStateMessageOnChannel({
              channel,
              syncSerial: 'serial:',
            });

            // check everything is applied correctly
            primitiveKeyData.forEach((keyData) => {
              checkKeyDataOnInstance({
                helper,
                key: keyData.key,
                keyData,
                instance: entryInstance,
                msg: `Check root has correct value for "${keyData.key}" key after OBJECT_SYNC has ended and buffered operations are applied`,
              });
            });
          },
        },

        {
          description: 'buffered object operation messages are discarded on ATTACHED',
          action: async (ctx) => {
            const { entryInstance, objectsHelper, channel, helper } = ctx;

            // start new sync sequence with a cursor so client will wait for the next OBJECT_SYNC messages
            await objectsHelper.processObjectStateMessageOnChannel({
              channel,
              syncSerial: 'serial:cursor',
            });

            // inject operation during sync sequence, expect it to be discarded when ATTACHED arrives
            await objectsHelper.processObjectOperationMessageOnChannel({
              channel,
              serial: lexicoTimeserial('aaa', 0, 0),
              siteCode: 'aaa',
              state: [objectsHelper.mapSetOp({ objectId: 'root', key: 'foo', data: { string: 'bar' } })],
            });

            // any ATTACHED message must clear buffered operations and start a new sync sequence
            await injectAttachedMessage(helper, channel, 1 << 7); // HAS_OBJECTS flag is bit 7

            // inject another operation that should be applied when sync ends
            await objectsHelper.processObjectOperationMessageOnChannel({
              channel,
              serial: lexicoTimeserial('bbb', 0, 0),
              siteCode: 'bbb',
              state: [objectsHelper.mapSetOp({ objectId: 'root', key: 'baz', data: { string: 'qux' } })],
            });

            // end sync
            await objectsHelper.processObjectStateMessageOnChannel({
              channel,
              syncSerial: 'serial:',
            });

            // check root doesn't have data from operations received before ATTACHED
            expect(
              entryInstance.get('foo'),
              'Check buffered ops before ATTACHED were discarded and not applied on root',
            ).to.not.exist;

            // check root has data from operations received after ATTACHED
            expect(entryInstance.get('baz').value()).to.equal(
              'qux',
              'Check root has data from operations received after ATTACHED',
            );
          },
        },

        {
          // Regression test: an earlier implementation did not clear buffered operations when receiving
          // an ATTACHED with RESUMED=true on an already-attached channel. The RESUMED flag is irrelevant
          // - buffering is determined by HAS_OBJECTS, and any ATTACHED must clear buffered operations.
          description:
            'buffered object operation messages are discarded when already-attached channel receives ATTACHED with RESUMED flag',
          action: async (ctx) => {
            const { entryInstance, objectsHelper, channel, helper } = ctx;

            // channel is already attached from the test setup
            expect(channel.state).to.equal('attached', 'Check channel is already attached before test begins');

            // start new sync sequence with a cursor so client will wait for the next OBJECT_SYNC messages
            await objectsHelper.processObjectStateMessageOnChannel({
              channel,
              syncSerial: 'serial:cursor',
            });

            // inject operation, expect it to be discarded when ATTACHED arrives (even with RESUMED)
            await objectsHelper.processObjectOperationMessageOnChannel({
              channel,
              serial: lexicoTimeserial('aaa', 0, 0),
              siteCode: 'aaa',
              state: [objectsHelper.mapSetOp({ objectId: 'root', key: 'foo', data: { string: 'bar' } })],
            });

            // the RESUMED flag is irrelevant for LiveObjects buffering — any ATTACHED must clear
            // buffered operations and start a new sync sequence
            await injectAttachedMessage(helper, channel, (1 << 7) | (1 << 2)); // HAS_OBJECTS flag and RESUMED flag

            // inject another operation after ATTACHED
            await objectsHelper.processObjectOperationMessageOnChannel({
              channel,
              serial: lexicoTimeserial('bbb', 0, 0),
              siteCode: 'bbb',
              state: [objectsHelper.mapSetOp({ objectId: 'root', key: 'baz', data: { string: 'qux' } })],
            });

            // end sync
            await objectsHelper.processObjectStateMessageOnChannel({
              channel,
              syncSerial: 'serial:',
            });

            // check root doesn't have data from operations received before ATTACHED
            expect(
              entryInstance.get('foo'),
              'Check buffered ops before RESUMED ATTACHED were discarded and not applied on root',
            ).to.not.exist;

            // check root has data from operations received after ATTACHED
            expect(entryInstance.get('baz').value()).to.equal(
              'qux',
              'Check root has data from operations received after RESUMED ATTACHED',
            );
          },
        },

        {
          // Regression test: an earlier implementation incorrectly cleared buffered operations when a new
          // OBJECT_SYNC sequence started. Only an ATTACHED message should clear buffered operations, not
          // a new OBJECT_SYNC sequence.
          description: 'buffered object operation messages are NOT discarded on new OBJECT_SYNC sequence',
          action: async (ctx) => {
            const { entryInstance, objectsHelper, channel } = ctx;

            // start new sync sequence with a cursor so client will wait for the next OBJECT_SYNC messages
            await objectsHelper.processObjectStateMessageOnChannel({
              channel,
              syncSerial: 'serial:cursor',
            });

            // inject operation during first sync sequence
            await objectsHelper.processObjectOperationMessageOnChannel({
              channel,
              serial: lexicoTimeserial('aaa', 0, 0),
              siteCode: 'aaa',
              state: [objectsHelper.mapSetOp({ objectId: 'root', key: 'foo', data: { string: 'bar' } })],
            });

            // start new sync with new sequence id - buffered operations should NOT be discarded.
            await objectsHelper.processObjectStateMessageOnChannel({
              channel,
              syncSerial: 'otherserial:cursor',
            });

            // inject another operation during second sync sequence
            await objectsHelper.processObjectOperationMessageOnChannel({
              channel,
              serial: lexicoTimeserial('bbb', 0, 0),
              siteCode: 'bbb',
              state: [objectsHelper.mapSetOp({ objectId: 'root', key: 'baz', data: { string: 'qux' } })],
            });

            // end sync
            await objectsHelper.processObjectStateMessageOnChannel({
              channel,
              syncSerial: 'otherserial:',
            });

            // check root has data from operations received during first sync sequences
            expect(entryInstance.get('foo').value()).to.equal(
              'bar',
              'Check root has data from operations received during first OBJECT_SYNC sequence',
            );

            // check root has data from operations received during second sync
            expect(entryInstance.get('baz').value()).to.equal(
              'qux',
              'Check root has data from operations received during second OBJECT_SYNC sequence',
            );
          },
        },

        {
          description:
            'operations are buffered when OBJECT_SYNC is received after completed sync without expected preceding ATTACHED',
          action: async (ctx) => {
            const { entryInstance, objectsHelper, channel } = ctx;

            // complete an initial sync sequence first
            await objectsHelper.processObjectStateMessageOnChannel({
              channel,
              syncSerial: 'serial:',
            });

            // Simulate receiving OBJECT_SYNC without preceding ATTACHED.
            // Normally, for server-initiated resync the server is expected to send ATTACHED with RESUMED=false first.
            // However, if that doesn't happen, the client handles it as a best-effort case by starting to buffer from this point.
            await objectsHelper.processObjectStateMessageOnChannel({
              channel,
              syncSerial: 'resync:cursor',
            });

            // inject operations during this server-initiated resync - they should be buffered
            await objectsHelper.processObjectOperationMessageOnChannel({
              channel,
              serial: lexicoTimeserial('aaa', 0, 0),
              siteCode: 'aaa',
              state: [objectsHelper.mapSetOp({ objectId: 'root', key: 'foo', data: { string: 'bar' } })],
            });

            // check root doesn't have data yet - operations should be buffered during resync
            expect(entryInstance.get('foo'), `Check "foo" key doesn't exist during server-initiated resync`).to.not
              .exist;

            // end the resync
            await objectsHelper.processObjectStateMessageOnChannel({
              channel,
              syncSerial: 'resync:',
            });

            // check buffered operations are now applied
            expect(entryInstance.get('foo').value()).to.equal(
              'bar',
              `Check root has correct value for "foo" key after server-initiated resync completed`,
            );
          },
        },

        {
          description:
            'buffered object operation messages are applied based on the site timeserials vector of the object',
          action: async (ctx) => {
            const { entryInstance, objectsHelper, channel } = ctx;

            // start new sync sequence with a cursor so client will wait for the next OBJECT_SYNC messages
            const mapId = objectsHelper.fakeMapObjectId();
            const counterId = objectsHelper.fakeCounterObjectId();
            await objectsHelper.processObjectStateMessageOnChannel({
              channel,
              syncSerial: 'serial:cursor',
              // add object state messages with non-empty site timeserials
              state: [
                // next map and counter objects will be checked to have correct operations applied on them based on site timeserials
                objectsHelper.mapObject({
                  objectId: mapId,
                  siteTimeserials: {
                    bbb: lexicoTimeserial('bbb', 2, 0),
                    ccc: lexicoTimeserial('ccc', 5, 0),
                  },
                  materialisedEntries: {
                    foo1: { timeserial: lexicoTimeserial('bbb', 0, 0), data: { string: 'bar' } },
                    foo2: { timeserial: lexicoTimeserial('bbb', 0, 0), data: { string: 'bar' } },
                    foo3: { timeserial: lexicoTimeserial('ccc', 5, 0), data: { string: 'bar' } },
                    foo4: { timeserial: lexicoTimeserial('bbb', 0, 0), data: { string: 'bar' } },
                    foo5: { timeserial: lexicoTimeserial('bbb', 2, 0), data: { string: 'bar' } },
                    foo6: { timeserial: lexicoTimeserial('ccc', 2, 0), data: { string: 'bar' } },
                    foo7: { timeserial: lexicoTimeserial('ccc', 0, 0), data: { string: 'bar' } },
                    foo8: { timeserial: lexicoTimeserial('ccc', 0, 0), data: { string: 'bar' } },
                  },
                }),
                objectsHelper.counterObject({
                  objectId: counterId,
                  siteTimeserials: {
                    bbb: lexicoTimeserial('bbb', 1, 0),
                  },
                  initialCount: 1,
                }),
                // add objects to the root so they're discoverable in the object tree
                objectsHelper.mapObject({
                  objectId: 'root',
                  siteTimeserials: { aaa: lexicoTimeserial('aaa', 0, 0) },
                  initialEntries: {
                    map: { timeserial: lexicoTimeserial('aaa', 0, 0), data: { objectId: mapId } },
                    counter: { timeserial: lexicoTimeserial('aaa', 0, 0), data: { objectId: counterId } },
                  },
                }),
              ],
            });

            // inject operations with various timeserial values
            // Map:
            for (const [i, { serial, siteCode }] of [
              { serial: lexicoTimeserial('bbb', 1, 0), siteCode: 'bbb' }, // existing site, earlier site CGO, not applied
              { serial: lexicoTimeserial('bbb', 2, 0), siteCode: 'bbb' }, // existing site, same site CGO, not applied
              { serial: lexicoTimeserial('bbb', 3, 0), siteCode: 'bbb' }, // existing site, later site CGO, earlier entry CGO, not applied but site timeserial updated
              // message with later site CGO, same entry CGO case is not possible, as timeserial from entry would be set for the corresponding site code or be less than that
              { serial: lexicoTimeserial('bbb', 3, 0), siteCode: 'bbb' }, // existing site, same site CGO (updated from last op), later entry CGO, not applied
              { serial: lexicoTimeserial('bbb', 4, 0), siteCode: 'bbb' }, // existing site, later site CGO, later entry CGO, applied
              { serial: lexicoTimeserial('aaa', 1, 0), siteCode: 'aaa' }, // different site, earlier entry CGO, not applied but site timeserial updated
              { serial: lexicoTimeserial('aaa', 1, 0), siteCode: 'aaa' }, // different site, same site CGO (updated from last op), later entry CGO, not applied
              // different site with matching entry CGO case is not possible, as matching entry timeserial means that that timeserial is in the site timeserials vector
              { serial: lexicoTimeserial('ddd', 1, 0), siteCode: 'ddd' }, // different site, later entry CGO, applied
            ].entries()) {
              await objectsHelper.processObjectOperationMessageOnChannel({
                channel,
                serial,
                siteCode,
                state: [objectsHelper.mapSetOp({ objectId: mapId, key: `foo${i + 1}`, data: { string: 'baz' } })],
              });
            }

            // Counter:
            for (const [i, { serial, siteCode }] of [
              { serial: lexicoTimeserial('bbb', 0, 0), siteCode: 'bbb' }, // +10       existing site, earlier CGO, not applied
              { serial: lexicoTimeserial('bbb', 1, 0), siteCode: 'bbb' }, // +100      existing site, same CGO, not applied
              { serial: lexicoTimeserial('bbb', 2, 0), siteCode: 'bbb' }, // +1000     existing site, later CGO, applied, site timeserials updated
              { serial: lexicoTimeserial('bbb', 2, 0), siteCode: 'bbb' }, // +10000    existing site, same CGO (updated from last op), not applied
              { serial: lexicoTimeserial('aaa', 0, 0), siteCode: 'aaa' }, // +100000   different site, earlier CGO, applied
              { serial: lexicoTimeserial('ccc', 9, 0), siteCode: 'ccc' }, // +1000000  different site, later CGO, applied
            ].entries()) {
              await objectsHelper.processObjectOperationMessageOnChannel({
                channel,
                serial,
                siteCode,
                state: [objectsHelper.counterIncOp({ objectId: counterId, amount: Math.pow(10, i + 1) })],
              });
            }

            // end sync
            await objectsHelper.processObjectStateMessageOnChannel({
              channel,
              syncSerial: 'serial:',
            });

            // check only operations with correct timeserials were applied
            const expectedMapKeys = [
              { key: 'foo1', value: 'bar' },
              { key: 'foo2', value: 'bar' },
              { key: 'foo3', value: 'bar' },
              { key: 'foo4', value: 'bar' },
              { key: 'foo5', value: 'baz' }, // updated
              { key: 'foo6', value: 'bar' },
              { key: 'foo7', value: 'bar' },
              { key: 'foo8', value: 'baz' }, // updated
            ];

            expectedMapKeys.forEach(({ key, value }) => {
              expect(entryInstance.get('map').get(key).value()).to.equal(
                value,
                `Check "${key}" key on map has expected value after OBJECT_SYNC has ended`,
              );
            });

            expect(entryInstance.get('counter').value()).to.equal(
              1 + 1000 + 100000 + 1000000, // sum of passing operations and the initial value
              `Check counter has expected value after OBJECT_SYNC has ended`,
            );
          },
        },

        {
          description:
            'subsequent object operation messages are applied immediately after OBJECT_SYNC ended and buffered operations are applied',
          action: async (ctx) => {
            const { objectsHelper, channel, channelName, helper, client, entryInstance } = ctx;

            // start new sync sequence with a cursor so client will wait for the next OBJECT_SYNC messages
            await objectsHelper.processObjectStateMessageOnChannel({
              channel,
              syncSerial: 'serial:cursor',
            });

            // inject operations, they should be applied when sync ends
            await Promise.all(
              primitiveKeyData.map(async (keyData, i) => {
                // copy data object as library will modify it
                const data = { ...keyData.jsonData };
                helper.recordPrivateApi('read.realtime.options.useBinaryProtocol');
                if (data.bytes != null && client.options.useBinaryProtocol) {
                  // decode base64 data to binary for binary protocol
                  helper.recordPrivateApi('call.BufferUtils.base64Decode');
                  data.bytes = BufferUtils.base64Decode(data.bytes);
                }

                return objectsHelper.processObjectOperationMessageOnChannel({
                  channel,
                  serial: lexicoTimeserial('aaa', i, 0),
                  siteCode: 'aaa',
                  state: [objectsHelper.mapSetOp({ objectId: 'root', key: keyData.key, data })],
                });
              }),
            );

            // end the sync with empty cursor
            await objectsHelper.processObjectStateMessageOnChannel({
              channel,
              syncSerial: 'serial:',
            });

            const keyUpdatedPromise = waitForMapKeyUpdate(entryInstance, 'foo');
            // send some more operations
            await objectsHelper.operationRequest(
              channelName,
              objectsHelper.mapSetRestOp({
                objectId: 'root',
                key: 'foo',
                value: { string: 'bar' },
              }),
            );
            await keyUpdatedPromise;

            // check buffered operations are applied, as well as the most recent operation outside of the sync sequence is applied
            primitiveKeyData.forEach((keyData) => {
              checkKeyDataOnInstance({
                helper,
                key: keyData.key,
                keyData,
                instance: entryInstance,
                msg: `Check root has correct value for "${keyData.key}" key after OBJECT_SYNC has ended and buffered operations are applied`,
              });
            });
            expect(entryInstance.get('foo').value()).to.equal(
              'bar',
              'Check root has correct value for "foo" key from operation received outside of OBJECT_SYNC after other buffered operations were applied',
            );
          },
        },
      ];

      const writeApiScenarios = [
        {
          allTransportsAndProtocols: true,
          description: 'LiveCounter.increment sends COUNTER_INC operation',
          action: async (ctx) => {
            const { objectsHelper, channelName, entryInstance } = ctx;

            const counterCreatedPromise = waitForMapKeyUpdate(entryInstance, 'counter');
            await objectsHelper.createAndSetOnMap(channelName, {
              mapObjectId: 'root',
              key: 'counter',
              createOp: objectsHelper.counterCreateRestOp(),
            });
            await counterCreatedPromise;

            const counter = entryInstance.get('counter');
            const increments = [
              1, // value=1
              10, // value=11
              -11, // value=0
              -1, // value=-1
              -10, // value=-11
              11, // value=0
              Number.MAX_SAFE_INTEGER, // value=9007199254740991
              -Number.MAX_SAFE_INTEGER, // value=0
              -Number.MAX_SAFE_INTEGER, // value=-9007199254740991
            ];
            let expectedCounterValue = 0;

            for (let i = 0; i < increments.length; i++) {
              const increment = increments[i];
              expectedCounterValue += increment;

              await counter.increment(increment);

              expect(counter.value()).to.equal(
                expectedCounterValue,
                `Check counter has correct value after ${i + 1} LiveCounter.increment calls`,
              );
            }
          },
        },

        {
          description: 'LiveCounter.increment throws on invalid input',
          action: async (ctx) => {
            const { objectsHelper, channelName, entryInstance } = ctx;

            const counterCreatedPromise = waitForMapKeyUpdate(entryInstance, 'counter');
            await objectsHelper.createAndSetOnMap(channelName, {
              mapObjectId: 'root',
              key: 'counter',
              createOp: objectsHelper.counterCreateRestOp(),
            });
            await counterCreatedPromise;

            const counter = entryInstance.get('counter');

            await expectToThrowAsync(
              async () => counter.increment(Number.NaN),
              'Counter value increment should be a valid number',
            );
            await expectToThrowAsync(
              async () => counter.increment(Number.POSITIVE_INFINITY),
              'Counter value increment should be a valid number',
            );
            await expectToThrowAsync(
              async () => counter.increment(Number.NEGATIVE_INFINITY),
              'Counter value increment should be a valid number',
            );
            await expectToThrowAsync(
              async () => counter.increment('foo'),
              'Counter value increment should be a valid number',
            );
            await expectToThrowAsync(
              async () => counter.increment(BigInt(1)),
              'Counter value increment should be a valid number',
            );
            await expectToThrowAsync(
              async () => counter.increment(true),
              'Counter value increment should be a valid number',
            );
            await expectToThrowAsync(
              async () => counter.increment(Symbol()),
              'Counter value increment should be a valid number',
            );
            await expectToThrowAsync(
              async () => counter.increment({}),
              'Counter value increment should be a valid number',
            );
            await expectToThrowAsync(
              async () => counter.increment([]),
              'Counter value increment should be a valid number',
            );
            await expectToThrowAsync(
              async () => counter.increment(counter),
              'Counter value increment should be a valid number',
            );
          },
        },

        {
          allTransportsAndProtocols: true,
          description: 'LiveCounter.decrement sends COUNTER_INC operation',
          action: async (ctx) => {
            const { objectsHelper, channelName, entryInstance } = ctx;

            const counterCreatedPromise = waitForMapKeyUpdate(entryInstance, 'counter');
            await objectsHelper.createAndSetOnMap(channelName, {
              mapObjectId: 'root',
              key: 'counter',
              createOp: objectsHelper.counterCreateRestOp(),
            });
            await counterCreatedPromise;

            const counter = entryInstance.get('counter');
            const decrements = [
              1, // value=-1
              10, // value=-11
              -11, // value=0
              -1, // value=1
              -10, // value=11
              11, // value=0
              Number.MAX_SAFE_INTEGER, // value=-9007199254740991
              -Number.MAX_SAFE_INTEGER, // value=0
              -Number.MAX_SAFE_INTEGER, // value=9007199254740991
            ];
            let expectedCounterValue = 0;

            for (let i = 0; i < decrements.length; i++) {
              const decrement = decrements[i];
              expectedCounterValue -= decrement;

              await counter.decrement(decrement);

              expect(counter.value()).to.equal(
                expectedCounterValue,
                `Check counter has correct value after ${i + 1} LiveCounter.decrement calls`,
              );
            }
          },
        },

        {
          description: 'LiveCounter.decrement throws on invalid input',
          action: async (ctx) => {
            const { objectsHelper, channelName, entryInstance } = ctx;

            const counterCreatedPromise = waitForMapKeyUpdate(entryInstance, 'counter');
            await objectsHelper.createAndSetOnMap(channelName, {
              mapObjectId: 'root',
              key: 'counter',
              createOp: objectsHelper.counterCreateRestOp(),
            });
            await counterCreatedPromise;

            const counter = entryInstance.get('counter');

            await expectToThrowAsync(
              async () => counter.decrement(Number.NaN),
              'Counter value decrement should be a valid number',
            );
            await expectToThrowAsync(
              async () => counter.decrement(Number.POSITIVE_INFINITY),
              'Counter value decrement should be a valid number',
            );
            await expectToThrowAsync(
              async () => counter.decrement(Number.NEGATIVE_INFINITY),
              'Counter value decrement should be a valid number',
            );
            await expectToThrowAsync(
              async () => counter.decrement('foo'),
              'Counter value decrement should be a valid number',
            );
            await expectToThrowAsync(
              async () => counter.decrement(BigInt(1)),
              'Counter value decrement should be a valid number',
            );
            await expectToThrowAsync(
              async () => counter.decrement(true),
              'Counter value decrement should be a valid number',
            );
            await expectToThrowAsync(
              async () => counter.decrement(Symbol()),
              'Counter value decrement should be a valid number',
            );
            await expectToThrowAsync(
              async () => counter.decrement({}),
              'Counter value decrement should be a valid number',
            );
            await expectToThrowAsync(
              async () => counter.decrement([]),
              'Counter value decrement should be a valid number',
            );
            await expectToThrowAsync(
              async () => counter.decrement(counter),
              'Counter value decrement should be a valid number',
            );
          },
        },

        {
          allTransportsAndProtocols: true,
          description: 'LiveMap.set sends MAP_SET operation with primitive values',
          action: async (ctx) => {
            const { helper, entryInstance } = ctx;

            await Promise.all(
              primitiveKeyData.map(async (keyData) => {
                let value;
                if (keyData.jsonData.bytes != null) {
                  helper.recordPrivateApi('call.BufferUtils.base64Decode');
                  value = BufferUtils.base64Decode(keyData.jsonData.bytes);
                } else if (keyData.jsonData.json != null) {
                  value = JSON.parse(keyData.jsonData.json);
                } else {
                  value = keyData.jsonData.number ?? keyData.jsonData.string ?? keyData.jsonData.boolean;
                }

                await entryInstance.set(keyData.key, value);
              }),
            );

            // check everything is applied correctly
            primitiveKeyData.forEach((keyData) => {
              checkKeyDataOnInstance({
                helper,
                key: keyData.key,
                keyData,
                instance: entryInstance,
                msg: `Check root has correct value for "${keyData.key}" key after LiveMap.set call`,
              });
            });
          },
        },

        {
          allTransportsAndProtocols: true,
          description: 'LiveMap.set sends MAP_SET operation with reference to another LiveObject',
          action: async (ctx) => {
            const { entryInstance, helper } = ctx;

            await entryInstance.set('counter', LiveCounter.create(1));
            await entryInstance.set('map', LiveMap.create({ foo: 'bar' }));

            const counter = entryInstance.get('counter');
            const map = entryInstance.get('map');

            helper.recordPrivateApi('read.DefaultInstance._value');
            expectInstanceOf(counter._value, 'LiveCounter', 'Check counter set on root is a LiveCounter object');
            expect(counter.value()).to.equal(1, 'Check counter initial value is correct');
            helper.recordPrivateApi('read.DefaultInstance._value');
            expectInstanceOf(map._value, 'LiveMap', 'Check map set on root is a LiveMap object');
            expect(map.get('foo').value()).to.equal('bar', 'Check map initial value is correct');
          },
        },

        {
          description: 'LiveMap.set throws on invalid input',
          action: async (ctx) => {
            const { objectsHelper, channelName, entryInstance } = ctx;

            const mapCreatedPromise = waitForMapKeyUpdate(entryInstance, 'map');
            await objectsHelper.createAndSetOnMap(channelName, {
              mapObjectId: 'root',
              key: 'map',
              createOp: objectsHelper.mapCreateRestOp(),
            });
            await mapCreatedPromise;

            const map = entryInstance.get('map');

            await expectToThrowAsync(async () => map.set(), 'Map key should be string');
            await expectToThrowAsync(async () => map.set(null), 'Map key should be string');
            await expectToThrowAsync(async () => map.set(1), 'Map key should be string');
            await expectToThrowAsync(async () => map.set(BigInt(1)), 'Map key should be string');
            await expectToThrowAsync(async () => map.set(true), 'Map key should be string');
            await expectToThrowAsync(async () => map.set(Symbol()), 'Map key should be string');
            await expectToThrowAsync(async () => map.set({}), 'Map key should be string');
            await expectToThrowAsync(async () => map.set([]), 'Map key should be string');
            await expectToThrowAsync(async () => map.set(map), 'Map key should be string');

            await expectToThrowAsync(async () => map.set('key'), 'Map value data type is unsupported');
            await expectToThrowAsync(async () => map.set('key', null), 'Map value data type is unsupported');
            await expectToThrowAsync(async () => map.set('key', BigInt(1)), 'Map value data type is unsupported');
            await expectToThrowAsync(async () => map.set('key', Symbol()), 'Map value data type is unsupported');
          },
        },

        {
          allTransportsAndProtocols: true,
          description: 'LiveMap.remove sends MAP_REMOVE operation',
          action: async (ctx) => {
            const { objectsHelper, channelName, entryInstance } = ctx;

            const mapCreatedPromise = waitForMapKeyUpdate(entryInstance, 'map');
            await objectsHelper.createAndSetOnMap(channelName, {
              mapObjectId: 'root',
              key: 'map',
              createOp: objectsHelper.mapCreateRestOp({
                data: {
                  foo: { number: 1 },
                  bar: { number: 1 },
                  baz: { number: 1 },
                },
              }),
            });
            await mapCreatedPromise;

            const map = entryInstance.get('map');

            await map.remove('foo');
            await map.remove('bar');

            expect(map.get('foo'), 'Check can remove a key from a root via a LiveMap.remove call').to.not.exist;
            expect(map.get('bar'), 'Check can remove a key from a root via a LiveMap.remove call').to.not.exist;
            expect(
              map.get('baz').value(),
              'Check non-removed keys are still present on a root after LiveMap.remove call for another keys',
            ).to.equal(1);
          },
        },

        {
          description: 'LiveMap.remove throws on invalid input',
          action: async (ctx) => {
            const { objectsHelper, channelName, entryInstance } = ctx;

            const mapCreatedPromise = waitForMapKeyUpdate(entryInstance, 'map');
            await objectsHelper.createAndSetOnMap(channelName, {
              mapObjectId: 'root',
              key: 'map',
              createOp: objectsHelper.mapCreateRestOp(),
            });
            await mapCreatedPromise;

            const map = entryInstance.get('map');

            await expectToThrowAsync(async () => map.remove(), 'Map key should be string');
            await expectToThrowAsync(async () => map.remove(null), 'Map key should be string');
            await expectToThrowAsync(async () => map.remove(1), 'Map key should be string');
            await expectToThrowAsync(async () => map.remove(BigInt(1)), 'Map key should be string');
            await expectToThrowAsync(async () => map.remove(true), 'Map key should be string');
            await expectToThrowAsync(async () => map.remove(Symbol()), 'Map key should be string');
            await expectToThrowAsync(async () => map.remove({}), 'Map key should be string');
            await expectToThrowAsync(async () => map.remove([]), 'Map key should be string');
            await expectToThrowAsync(async () => map.remove(map), 'Map key should be string');
          },
        },

        {
          description: 'LiveCounter.create() returns value type object',
          action: async () => {
            const valueType = LiveCounter.create();
            expectInstanceOf(valueType, 'LiveCounterValueType', `Check LiveCounter.create() returns value type object`);
          },
        },

        {
          allTransportsAndProtocols: true,
          description: 'value type created with LiveCounter.create() can be assigned to the object tree',
          action: async (ctx) => {
            const { entryInstance, helper } = ctx;

            await entryInstance.set('counter', LiveCounter.create(1));

            const counter = entryInstance.get('counter');

            helper.recordPrivateApi('read.DefaultInstance._value');
            expectInstanceOf(counter._value, 'LiveCounter', `Check counter instance on root is of an expected class`);
            expect(counter.value()).to.equal(1, 'Check counter assigned to the object tree has the expected value');
          },
        },

        {
          allTransportsAndProtocols: true,
          description: 'LiveCounter.create() sends COUNTER_CREATE operation',
          action: async (ctx) => {
            const { entryInstance, helper } = ctx;

            await Promise.all(
              countersFixtures.map(async (x) => entryInstance.set(x.name, LiveCounter.create(x.count))),
            );

            for (let i = 0; i < countersFixtures.length; i++) {
              const counter = entryInstance.get(countersFixtures[i].name);
              const fixture = countersFixtures[i];

              expect(counter, `Check counter #${i + 1} exists`).to.exist;
              helper.recordPrivateApi('read.DefaultInstance._value');
              expectInstanceOf(
                counter._value,
                'LiveCounter',
                `Check counter instance #${i + 1} is of an expected class`,
              );
              expect(counter.value()).to.equal(
                fixture.count ?? 0,
                `Check counter #${i + 1} has expected initial value`,
              );
            }
          },
        },

        {
          description:
            'value type created with LiveCounter.create() with an invalid input throws when assigned to the object tree',
          action: async (ctx) => {
            const { entryInstance } = ctx;

            await expectToThrowAsync(
              async () => entryInstance.set('counter', LiveCounter.create(null)),
              'Counter value should be a valid number',
            );
            await expectToThrowAsync(
              async () => entryInstance.set('counter', LiveCounter.create(Number.NaN)),
              'Counter value should be a valid number',
            );
            await expectToThrowAsync(
              async () => entryInstance.set('counter', LiveCounter.create(Number.POSITIVE_INFINITY)),
              'Counter value should be a valid number',
            );
            await expectToThrowAsync(
              async () => entryInstance.set('counter', LiveCounter.create(Number.NEGATIVE_INFINITY)),
              'Counter value should be a valid number',
            );
            await expectToThrowAsync(
              async () => entryInstance.set('counter', LiveCounter.create('foo')),
              'Counter value should be a valid number',
            );
            await expectToThrowAsync(
              async () => entryInstance.set('counter', LiveCounter.create(BigInt(1))),
              'Counter value should be a valid number',
            );
            await expectToThrowAsync(
              async () => entryInstance.set('counter', LiveCounter.create(true)),
              'Counter value should be a valid number',
            );
            await expectToThrowAsync(
              async () => entryInstance.set('counter', LiveCounter.create(Symbol())),
              'Counter value should be a valid number',
            );
            await expectToThrowAsync(
              async () => entryInstance.set('counter', LiveCounter.create({})),
              'Counter value should be a valid number',
            );
            await expectToThrowAsync(
              async () => entryInstance.set('counter', LiveCounter.create([])),
              'Counter value should be a valid number',
            );
            await expectToThrowAsync(
              async () => entryInstance.set('counter', LiveCounter.create(entryInstance)),
              'Counter value should be a valid number',
            );
          },
        },

        {
          description: 'LiveMap.create() returns value type object',
          action: async () => {
            const valueType = LiveMap.create();
            expectInstanceOf(valueType, 'LiveMapValueType', `Check LiveMap.create() returns value type object`);
          },
        },

        {
          allTransportsAndProtocols: true,
          description: 'value type created with LiveMap.create() can be assigned to the object tree',
          action: async (ctx) => {
            const { entryInstance, helper } = ctx;

            await entryInstance.set('map', LiveMap.create({ foo: 'bar' }));

            const map = entryInstance.get('map');

            helper.recordPrivateApi('read.DefaultInstance._value');
            expectInstanceOf(map._value, 'LiveMap', `Check map instance on root is of an expected class`);
            expect(map.size()).to.equal(1, 'Check map assigned to the object tree has the expected number of keys');
            expect(map.get('foo').value()).to.equal(
              'bar',
              'Check map assigned to the object tree has the expected value for its string key',
            );
          },
        },

        {
          allTransportsAndProtocols: true,
          description: 'LiveMap.create() sends MAP_CREATE operation with primitive values',
          action: async (ctx) => {
            const { helper, entryInstance } = ctx;

            await Promise.all(
              primitiveMapsFixtures.map(async (mapFixture) => {
                const entries = Object.fromEntries(
                  mapFixture.entries.map((keyData) => {
                    let value;
                    if (keyData.jsonData.bytes != null) {
                      helper.recordPrivateApi('call.BufferUtils.base64Decode');
                      value = BufferUtils.base64Decode(keyData.jsonData.bytes);
                    } else if (keyData.jsonData.json != null) {
                      value = JSON.parse(keyData.jsonData.json);
                    } else {
                      value = keyData.jsonData.number ?? keyData.jsonData.string ?? keyData.jsonData.boolean;
                    }
                    return [keyData.key, value];
                  }),
                );

                return entryInstance.set(mapFixture.name, LiveMap.create(entries));
              }),
            );

            for (let i = 0; i < primitiveMapsFixtures.length; i++) {
              const map = entryInstance.get(primitiveMapsFixtures[i].name);
              const fixture = primitiveMapsFixtures[i];

              expect(map, `Check map #${i + 1} exists`).to.exist;
              helper.recordPrivateApi('read.DefaultInstance._value');
              expectInstanceOf(map._value, 'LiveMap', `Check map instance #${i + 1} is of an expected class`);

              expect(map.size()).to.equal(fixture.entries.length, `Check map #${i + 1} has correct number of keys`);

              fixture.entries.forEach((keyData) => {
                checkKeyDataOnInstance({
                  helper,
                  key: keyData.key,
                  keyData,
                  instance: map,
                  msg: `Check map #${i + 1} has correct value for "${keyData.key}" key`,
                });
              });
            }
          },
        },

        {
          allTransportsAndProtocols: true,
          description: 'LiveMap.create() sends MAP_CREATE operation with reference to another LiveObject',
          action: async (ctx) => {
            const { entryInstance, helper } = ctx;

            await entryInstance.set(
              'map',
              LiveMap.create({
                map: LiveMap.create(),
                counter: LiveCounter.create(),
              }),
            );

            const map = entryInstance.get('map');
            const nestedMap = map.get('map');
            const nestedCounter = map.get('counter');

            expect(map, 'Check map exists').to.exist;
            helper.recordPrivateApi('read.DefaultInstance._value');
            expectInstanceOf(map._value, 'LiveMap', 'Check map instance is of an expected class');

            expect(nestedMap, 'Check nested map exists').to.exist;
            helper.recordPrivateApi('read.DefaultInstance._value');
            expectInstanceOf(nestedMap._value, 'LiveMap', 'Check nested map instance is of an expected class');

            expect(nestedCounter, 'Check nested counter exists').to.exist;
            helper.recordPrivateApi('read.DefaultInstance._value');
            expectInstanceOf(
              nestedCounter._value,
              'LiveCounter',
              'Check nested counter instance is of an expected class',
            );
          },
        },

        {
          description:
            'value type created with LiveMap.create() with an invalid input throws when assigned to the object tree',
          action: async (ctx) => {
            const { entryInstance } = ctx;

            await expectToThrowAsync(
              async () => entryInstance.set('map', LiveMap.create(null)),
              'Map entries should be a key-value object',
            );
            await expectToThrowAsync(
              async () => entryInstance.set('map', LiveMap.create('foo')),
              'Map entries should be a key-value object',
            );
            await expectToThrowAsync(
              async () => entryInstance.set('map', LiveMap.create(1)),
              'Map entries should be a key-value object',
            );
            await expectToThrowAsync(
              async () => entryInstance.set('map', LiveMap.create(BigInt(1))),
              'Map entries should be a key-value object',
            );
            await expectToThrowAsync(
              async () => entryInstance.set('map', LiveMap.create(true)),
              'Map entries should be a key-value object',
            );
            await expectToThrowAsync(
              async () => entryInstance.set('map', LiveMap.create(Symbol())),
              'Map entries should be a key-value object',
            );

            await expectToThrowAsync(
              async () => entryInstance.set('map', LiveMap.create({ key: undefined })),
              'Map value data type is unsupported',
            );
            await expectToThrowAsync(
              async () => entryInstance.set('map', LiveMap.create({ key: null })),
              'Map value data type is unsupported',
            );
            await expectToThrowAsync(
              async () => entryInstance.set('map', LiveMap.create({ key: BigInt(1) })),
              'Map value data type is unsupported',
            );
            await expectToThrowAsync(
              async () => entryInstance.set('map', LiveMap.create({ key: Symbol() })),
              'Map value data type is unsupported',
            );
          },
        },

        {
          description: 'DefaultBatchContext.get() returns child DefaultBatchContext instances',
          action: async (ctx) => {
            const { entryInstance } = ctx;

            await entryInstance.set('counter', LiveCounter.create(1));
            await entryInstance.set('map', LiveMap.create({ nestedCounter: LiveCounter.create(1) }));
            await entryInstance.set('primitive', 'foo');

            await entryInstance.batch((ctx) => {
              const ctxCounter = ctx.get('counter');
              const ctxMap = ctx.get('map');
              const ctxPrimitive = ctx.get('primitive');
              const ctxNestedCounter = ctxMap.get('nestedCounter');

              expect(ctxCounter, 'Check counter object can be accessed from a map in a batch context').to.exist;
              expectInstanceOf(
                ctxCounter,
                'DefaultBatchContext',
                'Check counter object obtained in a batch context is of a DefaultBatchContext type',
              );
              expect(ctxMap, 'Check map object can be accessed from a map in a batch context').to.exist;
              expectInstanceOf(
                ctxMap,
                'DefaultBatchContext',
                'Check map object obtained in a batch context is of a DefaultBatchContext type',
              );
              expect(ctxPrimitive, 'Check primitive value can be accessed from a map in a batch context').to.exist;
              expectInstanceOf(
                ctxPrimitive,
                'DefaultBatchContext',
                'Check primitive value obtained in a batch context is of a DefaultBatchContext type',
              );
              expect(ctxNestedCounter, 'Check nested counter object can be accessed from a map in a batch context').to
                .exist;
              expectInstanceOf(
                ctxNestedCounter,
                'DefaultBatchContext',
                'Check nested counter object value obtained in a batch context is of a DefaultBatchContext type',
              );
            });
          },
        },

        {
          description: 'DefaultBatchContext access API methods on objects work and are synchronous',
          action: async (ctx) => {
            const { entryInstance } = ctx;

            await entryInstance.set('counter', LiveCounter.create(1));
            await entryInstance.set('map', LiveMap.create({ foo: 'bar' }));

            await entryInstance.batch((ctx) => {
              const ctxCounter = ctx.get('counter');
              const ctxMap = ctx.get('map');

              expect(ctxCounter.value()).to.equal(
                1,
                'Check DefaultBatchContext.value() method works for counters and is synchronous',
              );
              expect(ctxMap.get('foo').value()).to.equal(
                'bar',
                'Check DefaultBatchContext.get() method works for maps and is synchronous',
              );
              expect(ctxMap.size()).to.equal(
                1,
                'Check DefaultBatchContext.size() method works for maps and is synchronous',
              );
              expect([...ctxMap.entries()].map(([key, val]) => [key, val.value()])).to.deep.equal(
                [['foo', 'bar']],
                'Check DefaultBatchContext.entries() method works for maps and is synchronous',
              );
              expect([...ctxMap.keys()]).to.deep.equal(
                ['foo'],
                'Check DefaultBatchContext.keys() method works for maps and is synchronous',
              );
              expect([...ctxMap.values()].map((x) => x.value())).to.deep.equal(
                ['bar'],
                'Check DefaultBatchContext.values() method works for maps and is synchronous',
              );
            });
          },
        },

        {
          description:
            'DefaultBatchContext write API methods on objects do not mutate objects inside the batch function',
          action: async (ctx) => {
            const { entryInstance } = ctx;

            await entryInstance.set('counter', LiveCounter.create(1));
            await entryInstance.set('map', LiveMap.create({ foo: 'bar' }));

            await entryInstance.batch((ctx) => {
              const ctxCounter = ctx.get('counter');
              const ctxMap = ctx.get('map');

              ctxCounter.increment(10);
              expect(ctxCounter.value()).to.equal(
                1,
                'Check DefaultBatchContext.increment() method does not mutate the counter object inside the batch function',
              );

              ctxCounter.decrement(100);
              expect(ctxCounter.value()).to.equal(
                1,
                'Check DefaultBatchContext.decrement() method does not mutate the counter object inside the batch function',
              );

              ctxMap.set('baz', 'qux');
              expect(
                ctxMap.get('baz'),
                'Check DefaultBatchContext.set() method does not mutate the map object inside the batch function',
              ).to.not.exist;

              ctxMap.remove('foo');
              expect(ctxMap.get('foo').value()).to.equal(
                'bar',
                'Check DefaultBatchContext.remove() method does not mutate the map object inside the batch function',
              );
            });
          },
        },

        {
          allTransportsAndProtocols: true,
          description: 'DefaultBatchContext scheduled mutation operations are applied when batch function finishes',
          action: async (ctx) => {
            const { entryInstance } = ctx;

            await entryInstance.set('counter', LiveCounter.create(1));
            await entryInstance.set('map', LiveMap.create({ foo: 'bar' }));

            await entryInstance.batch((ctx) => {
              const ctxCounter = ctx.get('counter');
              const ctxMap = ctx.get('map');

              ctxCounter.increment(10);
              ctxCounter.decrement(100);

              ctxMap.set('baz', 'qux');
              ctxMap.remove('foo');
            });

            const counter = entryInstance.get('counter');
            const map = entryInstance.get('map');

            expect(counter.value()).to.equal(1 + 10 - 100, 'Check counter has an expected value after batch call');
            expect(map.get('baz').value()).to.equal(
              'qux',
              'Check key "baz" has an expected value in a map after batch call',
            );
            expect(map.get('foo'), 'Check key "foo" is removed from map after batch call').to.not.exist;
          },
        },

        {
          description:
            'PathObject.batch()/DefaultInstance.batch() can be called without scheduling any mutation operations',
          action: async (ctx) => {
            const { entryPathObject, entryInstance } = ctx;

            let caughtError;
            try {
              await entryPathObject.batch((ctx) => {});
              await entryInstance.batch((ctx) => {});
            } catch (error) {
              caughtError = error;
            }
            expect(
              caughtError,
              `Check batch operation can be called without scheduling any mutation operations, but got error: ${caughtError?.toString()}`,
            ).to.not.exist;
          },
        },

        {
          description:
            'DefaultBatchContext scheduled mutation operations can be canceled by throwing an error in the batch function',
          action: async (ctx) => {
            const { entryInstance } = ctx;

            await entryInstance.set('counter', LiveCounter.create(1));
            await entryInstance.set('map', LiveMap.create({ foo: 'bar' }));

            const cancelError = new Error('cancel batch');
            let caughtError;
            try {
              await entryInstance.batch((ctx) => {
                const ctxCounter = ctx.get('counter');
                const ctxMap = ctx.get('map');

                ctxCounter.increment(10);
                ctxCounter.decrement(100);

                ctxMap.set('baz', 'qux');
                ctxMap.remove('foo');

                throw cancelError;
              });
            } catch (error) {
              caughtError = error;
            }

            const counter = entryInstance.get('counter');
            const map = entryInstance.get('map');

            expect(counter.value()).to.equal(1, 'Check counter value is not changed after canceled batch call');
            expect(map.get('baz'), 'Check key "baz" does not exist on a map after canceled batch call').to.not.exist;
            expect(map.get('foo').value()).to.equal(
              'bar',
              'Check key "foo" is not changed on a map after canceled batch call',
            );
            expect(caughtError).to.equal(
              cancelError,
              'Check error from a batch function was rethrown by a batch method',
            );
          },
        },

        {
          description: `DefaultBatchContext can't be interacted with after batch function finishes`,
          action: async (ctx) => {
            const { entryInstance } = ctx;

            let savedCtx;

            await entryInstance.batch((ctx) => {
              savedCtx = ctx;
            });

            checkBatchContextAccessApiErrors({
              ctx: savedCtx,
              errorMsg: 'Batch is closed',
              skipId: true,
            });
            checkBatchContextWriteApiErrors({
              ctx: savedCtx,
              errorMsg: 'Batch is closed',
            });
          },
        },

        {
          description: `DefaultBatchContext can't be interacted with after error was thrown from batch function`,
          action: async (ctx) => {
            const { entryInstance } = ctx;

            let savedCtx;
            let caughtError;
            try {
              await entryInstance.batch((ctx) => {
                savedCtx = ctx;
                throw new Error('cancel batch');
              });
            } catch (error) {
              caughtError = error;
            }

            expect(caughtError, 'Check batch call failed with an error').to.exist;
            checkBatchContextAccessApiErrors({
              ctx: savedCtx,
              errorMsg: 'Batch is closed',
              skipId: true,
            });
            checkBatchContextWriteApiErrors({
              ctx: savedCtx,
              errorMsg: 'Batch is closed',
            });
          },
        },
      ];

      const pathObjectScenarios = [
        {
          description: 'RealtimeObject.get() returns PathObject instance',
          action: async (ctx) => {
            const { entryPathObject } = ctx;

            expect(entryPathObject, 'Check entry path object exists').to.exist;
            expectInstanceOf(entryPathObject, 'DefaultPathObject', 'entrypoint should be of DefaultPathObject type');
          },
        },

        {
          description: 'PathObject.get() returns child PathObject instances',
          action: async (ctx) => {
            const { entryPathObject } = ctx;

            const stringPathObj = entryPathObject.get('stringKey');
            const numberPathObj = entryPathObject.get('numberKey');

            expect(stringPathObj, 'Check string PathObject exists').to.exist;
            expect(stringPathObj.path()).to.equal('stringKey', 'Check string PathObject has correct path');

            expect(numberPathObj, 'Check number PathObject exists').to.exist;
            expect(numberPathObj.path()).to.equal('numberKey', 'Check number PathObject has correct path');
          },
        },

        {
          description: 'PathObject.path() returns correct path strings',
          action: async (ctx) => {
            const { entryPathObject, entryInstance } = ctx;

            await entryPathObject.set(
              'nested',
              LiveMap.create({
                simple: 'value',
                'key.with.dots': 'dottedValue',
                'key\\escaped': 'escapedValue',
                deep: LiveMap.create({ nested: 'deepValue' }),
              }),
            );

            // Test path with .get() method
            expect(entryPathObject.path()).to.equal('', 'Check root PathObject has empty path');
            expect(entryPathObject.get('nested').path()).to.equal('nested', 'Check simple child path');
            expect(entryPathObject.get('nested').get('simple').path()).to.equal(
              'nested.simple',
              'Check nested path via get()',
            );
            expect(entryPathObject.get('nested').get('deep').get('nested').path()).to.equal(
              'nested.deep.nested',
              'Check complex nested path',
            );
            expect(entryPathObject.get('nested').get('key.with.dots').path()).to.equal(
              'nested.key\\.with\\.dots',
              'Check path with dots in key name is properly escaped',
            );
            expect(entryPathObject.get('nested').get('key\\escaped').path()).to.equal(
              'nested.key\\escaped',
              'Check path with escaped symbols',
            );

            // Test path with .at() method
            expect(entryPathObject.at('nested.simple').path()).to.equal('nested.simple', 'Check nested path via at()');
            expect(entryPathObject.at('nested.key\\.with\\.dots').path()).to.equal(
              'nested.key\\.with\\.dots',
              'Check path via at() method with dots in key name is properly escaped',
            );
            expect(entryPathObject.at('nested.key\\escaped').path()).to.equal(
              'nested.key\\escaped',
              'Check path via at() method with escaped symbols',
            );
          },
        },

        {
          description: 'PathObject.at() navigates using dot-separated paths',
          action: async (ctx) => {
            const { entryPathObject, entryInstance } = ctx;

            // Create nested structure
            await entryPathObject.set(
              'nested',
              LiveMap.create({ deepKey: 'deepValue', 'key.with.dots': 'dottedValue' }),
            );

            const nestedPathObj = entryPathObject.at('nested.deepKey');
            expect(nestedPathObj, 'Check nested PathObject exists').to.exist;
            expect(nestedPathObj.path()).to.equal('nested.deepKey', 'Check nested PathObject has correct path');
            expect(nestedPathObj.value()).to.equal('deepValue', 'Check nested PathObject has correct value');

            const nestedPathWithDotsObj = entryPathObject.at('nested.key\\.with\\.dots');
            expect(nestedPathWithDotsObj, 'Check nested PathObject with dots in path exists').to.exist;
            expect(nestedPathWithDotsObj.path()).to.equal(
              'nested.key\\.with\\.dots',
              'Check nested PathObject with dots in path has correct path',
            );
            expect(nestedPathWithDotsObj.value()).to.equal(
              'dottedValue',
              'Check nested PathObject with dots in path has correct value',
            );
          },
        },

        {
          description: 'PathObject resolves complex path strings',
          action: async (ctx) => {
            const { entryPathObject, entryInstance } = ctx;

            await entryPathObject.set(
              'nested.key',
              LiveMap.create({
                'key.with.dots.and\\escaped\\characters': 'nestedValue',
              }),
            );

            // Test complex path via chaining .get()
            const pathObjViaGetChain = entryPathObject.get('nested.key').get('key.with.dots.and\\escaped\\characters');
            expect(pathObjViaGetChain.value()).to.equal(
              'nestedValue',
              'Check PathObject resolves value for a complex path via chain of get() calls',
            );
            expect(pathObjViaGetChain.path()).to.equal(
              'nested\\.key.key\\.with\\.dots\\.and\\escaped\\characters',
              'Check PathObject returns correct path for a complex path via chain of get() calls',
            );

            // Test complex path via .at()
            const pathObjViaAt = entryPathObject.at('nested\\.key.key\\.with\\.dots\\.and\\escaped\\characters');
            expect(pathObjViaAt.value()).to.equal(
              'nestedValue',
              'Check PathObject resolves value for a complex path via at() call',
            );
            expect(pathObjViaAt.path()).to.equal(
              'nested\\.key.key\\.with\\.dots\\.and\\escaped\\characters',
              'Check PathObject returns correct path for a complex path via at() call',
            );
          },
        },

        {
          description: 'PathObject.value() returns primitive values correctly',
          action: async (ctx) => {
            const { entryPathObject, helper, entryInstance } = ctx;

            await Promise.all(
              primitiveKeyData.map(async (keyData) => {
                let value;
                if (keyData.jsonData.bytes != null) {
                  helper.recordPrivateApi('call.BufferUtils.base64Decode');
                  value = BufferUtils.base64Decode(keyData.jsonData.bytes);
                } else if (keyData.jsonData.json != null) {
                  value = JSON.parse(keyData.jsonData.json);
                } else {
                  value = keyData.jsonData.number ?? keyData.jsonData.string ?? keyData.jsonData.boolean;
                }

                await entryPathObject.set(keyData.key, value);
              }),
            );

            // check PathObject returns primitive values correctly
            primitiveKeyData.forEach((keyData) => {
              checkKeyDataOnPathObject({
                helper,
                key: keyData.key,
                keyData,
                pathObject: entryPathObject,
                msg: `Check PathObject returns correct value for "${keyData.key}" key after LiveMap.set call`,
              });
            });
          },
        },

        {
          description: 'PathObject.value() returns LiveCounter values',
          action: async (ctx) => {
            const { entryPathObject, entryInstance } = ctx;

            await entryPathObject.set('counter', LiveCounter.create(10));

            const counterPathObj = entryPathObject.get('counter');

            expect(counterPathObj.value()).to.equal(10, 'Check counter value is returned correctly');
          },
        },

        {
          description: 'PathObject.instance() returns DefaultInstance for LiveMap and LiveCounter',
          action: async (ctx) => {
            const { entryPathObject, entryInstance } = ctx;

            await entryPathObject.set('map', LiveMap.create());
            await entryPathObject.set('counter', LiveCounter.create());

            const counterInstance = entryPathObject.get('counter').instance();
            expect(counterInstance, 'Check instance exists for counter path').to.exist;
            expectInstanceOf(counterInstance, 'DefaultInstance', 'Check counter instance is DefaultInstance');

            const mapInstance = entryPathObject.get('map').instance();
            expect(mapInstance, 'Check instance exists for map path').to.exist;
            expectInstanceOf(mapInstance, 'DefaultInstance', 'Check map instance is DefaultInstance');
          },
        },

        {
          description: 'PathObject collection methods work for LiveMap objects',
          action: async (ctx) => {
            const { entryPathObject, entryInstance } = ctx;

            await entryPathObject.set('key1', 'value1');
            await entryPathObject.set('key2', 'value2');
            await entryPathObject.set('key3', 'value3');

            // Test size
            expect(entryPathObject.size()).to.equal(3, 'Check PathObject size');

            // Test keys
            const keys = [...entryPathObject.keys()];
            expect(keys).to.have.members(['key1', 'key2', 'key3'], 'Check PathObject keys');

            // Test entries
            const entries = [...entryPathObject.entries()];
            expect(entries).to.have.lengthOf(3, 'Check PathObject entries length');

            const entryKeys = entries.map(([key]) => key);
            expect(entryKeys).to.have.members(['key1', 'key2', 'key3'], 'Check entry keys');

            const entryValues = entries.map(([key, pathObj]) => pathObj.value());
            expect(entryValues).to.have.members(['value1', 'value2', 'value3'], 'Check PathObject entries values');

            expectInstanceOf(entries[0][1], 'DefaultPathObject', 'Check entry value is DefaultPathObject');

            // Test values
            const values = [...entryPathObject.values()];
            expect(values).to.have.lengthOf(3, 'Check PathObject values length');

            const valueValues = values.map((pathObj) => pathObj.value());
            expect(valueValues).to.have.members(['value1', 'value2', 'value3'], 'Check PathObject values');

            expectInstanceOf(values[0], 'DefaultPathObject', 'Check value is DefaultPathObject');
          },
        },

        {
          description: 'PathObject.set() works for LiveMap objects with primitive values',
          action: async (ctx) => {
            const { entryPathObject, helper, entryInstance } = ctx;

            await Promise.all(
              primitiveKeyData.map(async (keyData) => {
                let value;
                if (keyData.jsonData.bytes != null) {
                  helper.recordPrivateApi('call.BufferUtils.base64Decode');
                  value = BufferUtils.base64Decode(keyData.jsonData.bytes);
                } else if (keyData.jsonData.json != null) {
                  value = JSON.parse(keyData.jsonData.json);
                } else {
                  value = keyData.jsonData.number ?? keyData.jsonData.string ?? keyData.jsonData.boolean;
                }

                await entryPathObject.set(keyData.key, value);
              }),
            );

            // check primitive values were set correctly via PathObject
            primitiveKeyData.forEach((keyData) => {
              checkKeyDataOnPathObject({
                helper,
                key: keyData.key,
                keyData,
                pathObject: entryPathObject,
                msg: `Check PathObject returns correct value for "${keyData.key}" key after PathObject.set call`,
              });
            });
          },
        },

        {
          description: 'PathObject.set() works for LiveMap objects with LiveObject references',
          action: async (ctx) => {
            const { entryPathObject, entryInstance } = ctx;

            await entryPathObject.set('counterKey', LiveCounter.create(5));

            expect(entryInstance.get('counterKey'), 'Check counter object was set via PathObject').to.exist;
            expect(entryPathObject.get('counterKey').value()).to.equal(5, 'Check PathObject reflects counter value');
          },
        },

        {
          description: 'PathObject.remove() works for LiveMap objects',
          action: async (ctx) => {
            const { entryPathObject, entryInstance } = ctx;

            await entryPathObject.set('keyToRemove', 'valueToRemove');

            expect(entryPathObject.get('keyToRemove'), 'Check key exists on root').to.exist;

            await entryPathObject.remove('keyToRemove');

            expect(entryInstance.get('keyToRemove'), 'Check key on root is removed after PathObject.remove()').to.be
              .undefined;
            expect(
              entryPathObject.get('keyToRemove').value(),
              'Check value for path is undefined after PathObject.remove()',
            ).to.be.undefined;
          },
        },

        {
          description: 'PathObject.increment() and PathObject.decrement() work for LiveCounter objects',
          action: async (ctx) => {
            const { entryPathObject, entryInstance } = ctx;

            await entryPathObject.set('counter', LiveCounter.create(10));

            const counter = entryInstance.get('counter');
            const counterPathObj = entryPathObject.get('counter');

            await counterPathObj.increment(5);

            expect(counter.value()).to.equal(15, 'Check counter incremented via PathObject');
            expect(counterPathObj.value()).to.equal(15, 'Check PathObject reflects incremented value');

            await counterPathObj.decrement(3);

            expect(counter.value()).to.equal(12, 'Check counter decremented via PathObject');
            expect(counterPathObj.value()).to.equal(12, 'Check PathObject reflects decremented value');

            // test increment/decrement without argument (should increment/decrement by 1)
            await counterPathObj.increment();

            expect(counter.value()).to.equal(13, 'Check counter incremented via PathObject without argument');
            expect(counterPathObj.value()).to.equal(13, 'Check PathObject reflects incremented value');

            await counterPathObj.decrement();

            expect(counter.value()).to.equal(12, 'Check counter decremented via PathObject without argument');
            expect(counterPathObj.value()).to.equal(12, 'Check PathObject reflects decremented value');
          },
        },

        {
          description: 'PathObject.get() throws error for non-string keys',
          action: async (ctx) => {
            const { entryPathObject } = ctx;

            expect(() => entryPathObject.get()).to.throw('Path key must be a string');
            expect(() => entryPathObject.get(null)).to.throw('Path key must be a string');
            expect(() => entryPathObject.get(123)).to.throw('Path key must be a string');
            expect(() => entryPathObject.get(BigInt(1))).to.throw('Path key must be a string');
            expect(() => entryPathObject.get(true)).to.throw('Path key must be a string');
            expect(() => entryPathObject.get({})).to.throw('Path key must be a string');
            expect(() => entryPathObject.get([])).to.throw('Path key must be a string');
          },
        },

        {
          description: 'PathObject.at() throws error for non-string paths',
          action: async (ctx) => {
            const { entryPathObject } = ctx;

            expect(() => entryPathObject.at()).to.throw('Path must be a string');
            expect(() => entryPathObject.at(null)).to.throw('Path must be a string');
            expect(() => entryPathObject.at(123)).to.throw('Path must be a string');
            expect(() => entryPathObject.at(BigInt(1))).to.throw('Path must be a string');
            expect(() => entryPathObject.at(true)).to.throw('Path must be a string');
            expect(() => entryPathObject.at({})).to.throw('Path must be a string');
            expect(() => entryPathObject.at([])).to.throw('Path must be a string');
          },
        },

        {
          description: 'PathObject handling of operations on non-existent paths',
          action: async (ctx) => {
            const { entryPathObject } = ctx;

            const nonExistentPathObj = entryPathObject.at('non.existent.path');
            const errorMsg = 'Could not resolve value at path';

            // Next operations should not throw and silently handle non-existent path
            expect(nonExistentPathObj.compact(), 'Check PathObject.compact() for non-existent path returns undefined')
              .to.be.undefined;
            expect(
              nonExistentPathObj.compactJson(),
              'Check PathObject.compactJson() for non-existent path returns undefined',
            ).to.be.undefined;
            expect(nonExistentPathObj.value(), 'Check PathObject.value() for non-existent path returns undefined').to.be
              .undefined;
            expect(nonExistentPathObj.instance(), 'Check PathObject.instance() for non-existent path returns undefined')
              .to.be.undefined;
            expect([...nonExistentPathObj.entries()]).to.deep.equal(
              [],
              'Check PathObject.entries() for non-existent path returns empty iterator',
            );
            expect([...nonExistentPathObj.keys()]).to.deep.equal(
              [],
              'Check PathObject.keys() for non-existent path returns empty iterator',
            );
            expect([...nonExistentPathObj.values()]).to.deep.equal(
              [],
              'Check PathObject.values() for non-existent path returns empty iterator',
            );
            expect(nonExistentPathObj.size(), 'Check PathObject.size() for non-existent path returns undefined').to.be
              .undefined;

            // Next operations should throw due to path resolution failure
            await expectToThrowAsync(async () => nonExistentPathObj.set('key', 'value'), errorMsg, { withCode: 92005 });
            await expectToThrowAsync(async () => nonExistentPathObj.remove('key'), errorMsg, {
              withCode: 92005,
            });
            await expectToThrowAsync(async () => nonExistentPathObj.increment(), errorMsg, {
              withCode: 92005,
            });
            await expectToThrowAsync(async () => nonExistentPathObj.decrement(), errorMsg, {
              withCode: 92005,
            });
            await expectToThrowAsync(async () => nonExistentPathObj.batch(), errorMsg, {
              withCode: 92005,
            });
          },
        },

        {
          description: 'PathObject handling of operations for paths with non-collection intermediate segments',
          action: async (ctx) => {
            const { entryPathObject, entryInstance } = ctx;

            const keyUpdatedPromise = waitForMapKeyUpdate(entryInstance, 'counter');
            await entryPathObject.set('counter', LiveCounter.create());
            await keyUpdatedPromise;

            const wrongTypePathObj = entryPathObject.at('counter.nested.path');
            const errorMsg = `Cannot resolve path segment 'nested' on non-collection type at path`;

            // Next operations should not throw and silently handle incorrect path
            expect(wrongTypePathObj.compact(), 'Check PathObject.compact() for non-collection path returns undefined')
              .to.be.undefined;
            expect(
              wrongTypePathObj.compactJson(),
              'Check PathObject.compactJson() for non-collection path returns undefined',
            ).to.be.undefined;
            expect(wrongTypePathObj.value(), 'Check PathObject.value() for non-collection path returns undefined').to.be
              .undefined;
            expect(wrongTypePathObj.instance(), 'Check PathObject.instance() for non-collection path returns undefined')
              .to.be.undefined;
            expect([...wrongTypePathObj.entries()]).to.deep.equal(
              [],
              'Check PathObject.entries() for non-collection path returns empty iterator',
            );
            expect([...wrongTypePathObj.keys()]).to.deep.equal(
              [],
              'Check PathObject.keys() for non-collection path returns empty iterator',
            );
            expect([...wrongTypePathObj.values()]).to.deep.equal(
              [],
              'Check PathObject.values() for non-collection path returns empty iterator',
            );
            expect(wrongTypePathObj.size(), 'Check PathObject.size() for non-collection path returns undefined').to.be
              .undefined;

            // These should throw due to path resolution failure
            await expectToThrowAsync(async () => wrongTypePathObj.set('key', 'value'), errorMsg, { withCode: 92005 });
            await expectToThrowAsync(async () => wrongTypePathObj.remove('key'), errorMsg, {
              withCode: 92005,
            });
            await expectToThrowAsync(async () => wrongTypePathObj.increment(), errorMsg, {
              withCode: 92005,
            });
            await expectToThrowAsync(async () => wrongTypePathObj.decrement(), errorMsg, {
              withCode: 92005,
            });
            await expectToThrowAsync(async () => wrongTypePathObj.batch(), errorMsg, {
              withCode: 92005,
            });
          },
        },

        {
          description: 'PathObject handling of operations on wrong underlying object type',
          action: async (ctx) => {
            const { entryPathObject, entryInstance } = ctx;

            const keysUpdatedPromise = Promise.all([
              waitForMapKeyUpdate(entryInstance, 'map'),
              waitForMapKeyUpdate(entryInstance, 'counter'),
              waitForMapKeyUpdate(entryInstance, 'primitive'),
            ]);
            await entryPathObject.set('map', LiveMap.create());
            await entryPathObject.set('counter', LiveCounter.create());
            await entryPathObject.set('primitive', 'value');
            await keysUpdatedPromise;

            const mapPathObj = entryPathObject.get('map');
            const counterPathObj = entryPathObject.get('counter');
            const primitivePathObj = entryPathObject.get('primitive');

            // next methods silently handle incorrect underlying type
            expect(mapPathObj.value(), 'Check PathObject.value() for wrong underlying object type returns undefined').to
              .be.undefined;
            // instance() is not type-constrained: it wraps primitives too (RTPO8f)
            const primitiveInstance = primitivePathObj.instance();
            expect(primitiveInstance, 'Check PathObject.instance() for primitive path returns an Instance').to.exist;
            expect(primitiveInstance.id, 'Check primitive instance has no object id').to.be.undefined;
            expect(primitiveInstance.value(), 'Check primitive instance wraps the primitive value').to.equal('value');
            expect([...primitivePathObj.entries()]).to.deep.equal(
              [],
              'Check PathObject.entries() for wrong underlying object type returns empty iterator',
            );
            expect([...primitivePathObj.keys()]).to.deep.equal(
              [],
              'Check PathObject.keys() for wrong underlying object type returns empty iterator',
            );
            expect([...primitivePathObj.values()]).to.deep.equal(
              [],
              'Check PathObject.values() for wrong underlying object type returns empty iterator',
            );
            expect(
              primitivePathObj.size(),
              'Check PathObject.size() for wrong underlying object type returns undefined',
            ).to.be.undefined;

            // map mutation methods throw errors for non-LiveMap objects
            await expectToThrowAsync(
              async () => primitivePathObj.set('key', 'value'),
              'Cannot set a key on a non-LiveMap object at path',
              { withCode: 92007 },
            );
            await expectToThrowAsync(
              async () => counterPathObj.set('key', 'value'),
              'Cannot set a key on a non-LiveMap object at path',
              { withCode: 92007 },
            );

            await expectToThrowAsync(
              async () => primitivePathObj.remove('key'),
              'Cannot remove a key from a non-LiveMap object at path',
              { withCode: 92007 },
            );
            await expectToThrowAsync(
              async () => counterPathObj.remove('key'),
              'Cannot remove a key from a non-LiveMap object at path',
              { withCode: 92007 },
            );

            // counter mutation methods throw errors for non-LiveCounter objects
            await expectToThrowAsync(
              async () => primitivePathObj.increment(),
              'Cannot increment a non-LiveCounter object at path',
              { withCode: 92007 },
            );
            await expectToThrowAsync(
              async () => mapPathObj.increment(),
              'Cannot increment a non-LiveCounter object at path',
              {
                withCode: 92007,
              },
            );

            await expectToThrowAsync(
              async () => primitivePathObj.decrement(),
              'Cannot decrement a non-LiveCounter object at path',
              { withCode: 92007 },
            );
            await expectToThrowAsync(
              async () => mapPathObj.decrement(),
              'Cannot decrement a non-LiveCounter object at path',
              { withCode: 92007 },
            );

            // next mutation methods throw errors for non-LiveObjects
            await expectToThrowAsync(
              async () => primitivePathObj.batch(),
              'Cannot batch operations on a non-LiveObject at path',
              { withCode: 92007 },
            );
          },
        },

        {
          description: 'PathObject.subscribe() receives events for direct changes to the subscribed path',
          action: async (ctx) => {
            const { entryPathObject } = ctx;

            const subscriptionPromise = new Promise((resolve, reject) => {
              entryPathObject.subscribe((event) => {
                try {
                  expect(event.object, 'Check event object exists').to.exist;
                  expect(event.object.path()).to.equal('', 'Check event object path is root');
                  expect(event.message, 'Check event message exists').to.exist;
                  resolve();
                } catch (error) {
                  reject(error);
                }
              });
            });

            await entryPathObject.set('testKey', 'testValue');
            await subscriptionPromise;
          },
        },

        {
          description: 'PathObject.subscribe() receives events for nested changes with unlimited depth by default',
          action: async (ctx) => {
            const { entryPathObject, entryInstance } = ctx;

            let eventCount = 0;
            const subscriptionPromise = new Promise((resolve, reject) => {
              entryPathObject.subscribe((event) => {
                try {
                  eventCount++;
                  expect(event.object, 'Check event object exists').to.exist;
                  if (eventCount === 1) {
                    expect(event.object.path()).to.equal('', 'First event is at root path');
                  } else if (eventCount === 2) {
                    expect(event.object.path()).to.equal('nested', 'Second event is at nested path');
                  } else if (eventCount === 3) {
                    expect(event.object.path()).to.equal('nested.child', 'Third event is at nested.child path');
                    resolve();
                  }
                } catch (error) {
                  reject(error);
                }
              });
            });

            // root level change
            let keyUpdatedPromise = waitForMapKeyUpdate(entryInstance, 'nested');
            await entryPathObject.set('nested', LiveMap.create());
            await keyUpdatedPromise;

            // nested change
            keyUpdatedPromise = waitForMapKeyUpdate(entryInstance.get('nested'), 'child');
            await entryPathObject.get('nested').set('child', LiveMap.create());
            await keyUpdatedPromise;

            // nested child change
            keyUpdatedPromise = waitForMapKeyUpdate(entryInstance.get('nested').get('child'), 'foo');
            await entryPathObject.get('nested').get('child').set('foo', 'bar');
            await keyUpdatedPromise;

            await subscriptionPromise;
          },
        },

        {
          description: 'PathObject.subscribe() with depth parameter receives expected events',
          action: async (ctx) => {
            const { entryPathObject, entryInstance } = ctx;

            // Create nested structure
            let keyUpdatedPromise = waitForMapKeyUpdate(entryInstance, 'nested');
            await entryPathObject.set('nested', LiveMap.create({ counter: LiveCounter.create() }));
            await keyUpdatedPromise;

            // Create two subscriptions to root, with depth=1 and depth=2
            const subscriptionDepthOnePromise = new Promise((resolve, reject) => {
              entryPathObject.subscribe(
                (event) => {
                  try {
                    expect(event.object.path()).to.equal('', 'First event is at root path for depth=1 subscription');
                    resolve();
                  } catch (error) {
                    reject(error);
                  }
                },
                { depth: 1 },
              );
            });
            let eventCount = 0;
            const subscriptionDepthTwoPromise = new Promise((resolve, reject) => {
              entryPathObject.subscribe(
                (event) => {
                  eventCount++;
                  try {
                    if (eventCount === 1) {
                      expect(event.object.path()).to.equal(
                        'nested',
                        'First event is at nested path for depth=2 subscription',
                      );
                    } else if (eventCount === 2) {
                      expect(event.object.path()).to.equal('', 'Second event is at root path for depth=2 subscription');
                      resolve();
                    }
                  } catch (error) {
                    reject(error);
                  }
                },
                { depth: 2 },
              );
            });

            // Make nested changes couple of levels deep, different subscriptions should get different events
            const counterUpdatedPromise = waitForCounterUpdate(entryInstance.get('nested').get('counter'));
            await entryPathObject.get('nested').get('counter').increment();
            await counterUpdatedPromise;

            keyUpdatedPromise = waitForMapKeyUpdate(entryInstance.get('nested'), 'nestedKey');
            await entryPathObject.get('nested').set('nestedKey', 'foo');
            await keyUpdatedPromise;

            // Now make a direct change to the root object, should trigger the callback
            keyUpdatedPromise = waitForMapKeyUpdate(entryInstance, 'directKey');
            await entryPathObject.set('directKey', 'bar');
            await keyUpdatedPromise;

            await Promise.all([subscriptionDepthOnePromise, subscriptionDepthTwoPromise]);
          },
        },

        {
          description: 'PathObject.subscribe() on nested path receives events for that path and its children',
          action: async (ctx) => {
            const { entryPathObject, entryInstance } = ctx;

            // Create nested structure
            let keyUpdatedPromise = waitForMapKeyUpdate(entryInstance, 'nested');
            await entryPathObject.set('nested', LiveMap.create({ counter: LiveCounter.create() }));
            await keyUpdatedPromise;

            let eventCount = 0;
            const subscriptionPromise = new Promise((resolve, reject) => {
              entryPathObject.get('nested').subscribe((event) => {
                eventCount++;
                try {
                  if (eventCount === 1) {
                    expect(event.object.path()).to.equal('nested', 'First event is at nested path');
                  } else if (eventCount === 2) {
                    expect(event.object.path()).to.equal(
                      'nested.counter',
                      'Second event is for a child of a nested path',
                    );
                  } else if (eventCount === 3) {
                    expect(event.object.path()).to.equal('nested', 'Third event is at nested path');
                    resolve();
                  }
                } catch (error) {
                  reject(error);
                }
              });
            });

            // root change should not trigger the subscription
            keyUpdatedPromise = waitForMapKeyUpdate(entryInstance, 'foo');
            await entryPathObject.set('foo', 'bar');
            await keyUpdatedPromise;

            // Next changes should trigger the subscription
            keyUpdatedPromise = waitForMapKeyUpdate(entryInstance.get('nested'), 'foo');
            await entryPathObject.get('nested').set('foo', 'bar');
            await keyUpdatedPromise;

            const counterUpdatedPromise = waitForCounterUpdate(entryInstance.get('nested').get('counter'));
            await entryPathObject.get('nested').get('counter').increment();
            await counterUpdatedPromise;

            // If object at the subscribed path is replaced, that should also trigger the subscription
            keyUpdatedPromise = waitForMapKeyUpdate(entryInstance, 'nested');
            await entryPathObject.set('nested', LiveMap.create());
            await keyUpdatedPromise;

            await subscriptionPromise;
          },
        },

        {
          description: 'PathObject.subscribe() works with complex nested paths and escaped dots',
          action: async (ctx) => {
            const { entryPathObject, entryInstance } = ctx;

            const keyUpdatedPromise = waitForMapKeyUpdate(entryInstance, 'escaped\\key');
            await entryPathObject.set('escaped\\key', LiveMap.create({ 'key.with.dots': LiveCounter.create() }));
            await keyUpdatedPromise;

            const complexPathObject = entryPathObject.get('escaped\\key').get('key.with.dots');
            const subscriptionPromise = new Promise((resolve, reject) => {
              complexPathObject.subscribe((event) => {
                try {
                  expect(event.object.path()).to.equal(
                    'escaped\\key.key\\.with\\.dots',
                    'Check complex subscription path',
                  );
                  expect(event.message, 'Check event message exists').to.exist;
                  expect(event.object.value()).to.equal(1, 'Check correct counter value at complex path');
                  resolve();
                } catch (error) {
                  reject(error);
                }
              });
            });

            const counterUpdatedPromise = waitForCounterUpdate(entryInstance.get('escaped\\key').get('key.with.dots'));
            await complexPathObject.increment();
            await counterUpdatedPromise;

            await subscriptionPromise;
          },
        },

        {
          description: 'PathObject.subscribe() on LiveMap path receives set/remove/clear events',
          action: async (ctx) => {
            const { entryPathObject, entryInstance, objectsHelper, channel } = ctx;

            await entryPathObject.set('map', LiveMap.create());

            let eventCount = 0;
            const subscriptionPromise = new Promise((resolve, reject) => {
              entryPathObject.get('map').subscribe((event) => {
                eventCount++;

                try {
                  expect(event.object.path()).to.equal('map', 'Check map subscription event path');
                  expect(event.message, 'Check event message exists').to.exist;

                  if (eventCount === 1) {
                    expect(event.message.operation.action).to.equal('map.set', 'Check first event is MAP_SET');
                  } else if (eventCount === 2) {
                    expect(event.message.operation.action).to.equal('map.remove', 'Check second event is MAP_REMOVE');
                  } else if (eventCount === 3) {
                    expect(event.message.operation.action).to.equal('map.clear', 'Check third event is MAP_CLEAR');
                    resolve();
                  }
                } catch (error) {
                  reject(error);
                }
              });
            });

            await entryPathObject.get('map').set('foo', 'bar');
            await entryPathObject.get('map').remove('foo');

            const mapInstance = entryInstance.get('map');
            await objectsHelper.processObjectOperationMessageOnChannel({
              channel,
              serial: lexicoTimeserial('zzz', 99999999999999, 0),
              siteCode: 'zzz',
              state: [objectsHelper.mapClearOp({ objectId: mapInstance.id })],
            });

            await subscriptionPromise;
          },
        },

        {
          description: 'PathObject.subscribe() on child paths receives events for each key cleared by MAP_CLEAR',
          action: async (ctx) => {
            const { entryPathObject, objectsHelper, channel } = ctx;

            // set two keys on a child map
            await entryPathObject.set('map', LiveMap.create());
            const map = entryPathObject.get('map');
            await map.set('key1', 'value1');
            await map.set('key2', 'value2');

            // subscribe to each child key path individually
            const receivedPaths = new Set();
            const subscriptionPromise = new Promise((resolve, reject) => {
              const checkDone = () => {
                if (receivedPaths.size === 2) resolve();
              };

              map.get('key1').subscribe((event) => {
                try {
                  expect(event.message.operation.action).to.equal('map.clear', 'Check MAP_CLEAR event for key1');
                  receivedPaths.add('key1');
                  checkDone();
                } catch (error) {
                  reject(error);
                }
              });

              map.get('key2').subscribe((event) => {
                try {
                  expect(event.message.operation.action).to.equal('map.clear', 'Check MAP_CLEAR event for key2');
                  receivedPaths.add('key2');
                  checkDone();
                } catch (error) {
                  reject(error);
                }
              });
            });

            // inject MAP_CLEAR on the child map
            const mapObjectId = map.instance().id;
            await objectsHelper.processObjectOperationMessageOnChannel({
              channel,
              serial: lexicoTimeserial('zzz', 99999999999999, 0),
              siteCode: 'zzz',
              state: [objectsHelper.mapClearOp({ objectId: mapObjectId })],
            });

            await subscriptionPromise;
          },
        },

        {
          description:
            'PathObject.subscribe() fires once per path when the same object is referenced from multiple paths',
          action: async (ctx) => {
            const { entryPathObject, entryInstance, objectsHelper, channel } = ctx;

            // Inject ObjectMessages directly because the Realtime public API doesn't expose a way to
            // alias the same underlying object at multiple paths.
            // Create a single counter and reference it from two keys on root, so it has two full paths.
            const counterId = objectsHelper.fakeCounterObjectId();
            await objectsHelper.processObjectOperationMessageOnChannel({
              channel,
              serial: lexicoTimeserial('aaa', 0, 0),
              siteCode: 'aaa',
              state: [objectsHelper.counterCreateOp({ objectId: counterId })],
            });
            const keyAUpdatedPromise = waitForMapKeyUpdate(entryInstance, 'counterA');
            await objectsHelper.processObjectOperationMessageOnChannel({
              channel,
              serial: lexicoTimeserial('aaa', 1, 0),
              siteCode: 'aaa',
              state: [objectsHelper.mapSetOp({ objectId: 'root', key: 'counterA', data: { objectId: counterId } })],
            });
            await keyAUpdatedPromise;
            const keyBUpdatedPromise = waitForMapKeyUpdate(entryInstance, 'counterB');
            await objectsHelper.processObjectOperationMessageOnChannel({
              channel,
              serial: lexicoTimeserial('aaa', 2, 0),
              siteCode: 'aaa',
              state: [objectsHelper.mapSetOp({ objectId: 'root', key: 'counterB', data: { objectId: counterId } })],
            });
            await keyBUpdatedPromise;

            // subscribe at root with unlimited depth — the increment below should be reported once per path
            const receivedPaths = [];
            entryPathObject.subscribe((event) => {
              receivedPaths.push(event.object.path());
            });

            // a single COUNTER_INC op produces a single LiveObjectUpdate on a single counter object,
            // but that counter is reachable from two paths, so the subscription should fire twice
            const counterUpdatedPromise = waitForCounterUpdate(entryInstance.get('counterA'));
            await objectsHelper.processObjectOperationMessageOnChannel({
              channel,
              serial: lexicoTimeserial('aaa', 3, 0),
              siteCode: 'aaa',
              state: [objectsHelper.counterIncOp({ objectId: counterId, amount: 1 })],
            });
            await counterUpdatedPromise;

            expect(receivedPaths).to.have.lengthOf(2, 'Check one event was received per path');
            expect(receivedPaths.slice().sort()).to.deep.equal(
              ['counterA', 'counterB'],
              'Check events were received at both paths',
            );
          },
        },

        {
          description: 'PathObject.subscribe() on LiveCounter path receives increment/decrement events',
          action: async (ctx) => {
            const { entryPathObject, entryInstance } = ctx;

            let keyUpdatedPromise = waitForMapKeyUpdate(entryInstance, 'counter');
            await entryPathObject.set('counter', LiveCounter.create());
            await keyUpdatedPromise;

            let eventCount = 0;
            const subscriptionPromise = new Promise((resolve, reject) => {
              entryPathObject.get('counter').subscribe((event) => {
                eventCount++;

                try {
                  expect(event.object.path()).to.equal('counter', 'Check counter subscription event path');
                  expect(event.message, 'Check event message exists').to.exist;

                  if (eventCount === 1) {
                    expect(event.message.operation.action).to.equal(
                      'counter.inc',
                      'Check first event is COUNTER_INC with positive value',
                    );
                    expect(event.message.operation.counterInc.number).to.equal(
                      1,
                      'Check first event is COUNTER_INC with positive value',
                    );
                  } else if (eventCount === 2) {
                    expect(event.message.operation.action).to.equal(
                      'counter.inc',
                      'Check second event is COUNTER_INC with negative value',
                    );
                    expect(event.message.operation.counterInc.number).to.equal(
                      -1,
                      'Check first event is COUNTER_INC with positive value',
                    );

                    resolve();
                  }
                } catch (error) {
                  reject(error);
                }
              });
            });

            let counterUpdatedPromise = waitForCounterUpdate(entryInstance.get('counter'));
            await entryPathObject.get('counter').increment();
            await counterUpdatedPromise;

            counterUpdatedPromise = waitForCounterUpdate(entryInstance.get('counter'));
            await entryPathObject.get('counter').decrement();
            await counterUpdatedPromise;

            await subscriptionPromise;
          },
        },

        {
          description: 'PathObject.subscribe() on Primitive path receives changes to the primitive value',
          action: async (ctx) => {
            const { entryPathObject, entryInstance } = ctx;

            let keyUpdatedPromise = waitForMapKeyUpdate(entryInstance, 'primitive');
            await entryPathObject.set('primitive', 'foo');
            await keyUpdatedPromise;

            let eventCount = 0;
            const subscriptionPromise = new Promise((resolve, reject) => {
              entryPathObject.get('primitive').subscribe((event) => {
                eventCount++;

                try {
                  expect(event.object.path()).to.equal('primitive', 'Check primitive subscription event path');
                  expect(event.message, 'Check event message exists').to.exist;

                  if (eventCount === 1) {
                    expect(event.object.value()).to.equal('baz', 'Check first event has correct value');
                  } else if (eventCount === 2) {
                    expect(event.object.value()).to.equal(42, 'Check second event has correct value');
                  } else if (eventCount === 3) {
                    expect(event.object.value()).to.equal(true, 'Check third event has correct value');
                    resolve();
                  }
                } catch (error) {
                  reject(error);
                }
              });
            });

            // Update to other keys on root should not trigger the subscription
            keyUpdatedPromise = waitForMapKeyUpdate(entryInstance, 'other');
            await entryPathObject.set('other', 'bar');
            await keyUpdatedPromise;

            // Only changes to the primitive path should trigger the subscription
            keyUpdatedPromise = waitForMapKeyUpdate(entryInstance, 'primitive');
            await entryPathObject.set('primitive', 'baz');
            await keyUpdatedPromise;

            keyUpdatedPromise = waitForMapKeyUpdate(entryInstance, 'primitive');
            await entryPathObject.set('primitive', 42);
            await keyUpdatedPromise;

            keyUpdatedPromise = waitForMapKeyUpdate(entryInstance, 'primitive');
            await entryPathObject.set('primitive', true);
            await keyUpdatedPromise;

            await subscriptionPromise;
          },
        },

        {
          description: 'PathObject.subscribe() returns "unsubscribe" function',
          action: async (ctx) => {
            const { entryPathObject } = ctx;

            const subscribeResponse = entryPathObject.subscribe(() => {});

            expect(subscribeResponse, 'Check subscribe response exists').to.exist;
            expect(subscribeResponse.unsubscribe).to.be.a('function', 'Check unsubscribe is a function');

            // Should not throw when called
            subscribeResponse.unsubscribe();
          },
        },

        {
          description: 'can unsubscribe from PathObject.subscribe() updates using returned "unsubscribe" function',
          action: async (ctx) => {
            const { entryPathObject, entryInstance } = ctx;

            let eventCount = 0;
            const { unsubscribe } = entryPathObject.subscribe(() => {
              eventCount++;
            });

            // Make first change - should receive event
            let keyUpdatedPromise = waitForMapKeyUpdate(entryInstance, 'key1');
            await entryPathObject.set('key1', 'value1');
            await keyUpdatedPromise;

            unsubscribe();

            // Make second change - should NOT receive event
            keyUpdatedPromise = waitForMapKeyUpdate(entryInstance, 'key2');
            await entryPathObject.set('key2', 'value2');
            await keyUpdatedPromise;

            expect(eventCount).to.equal(1, 'Check only first event was received after unsubscribe');
          },
        },

        {
          description: 'PathObject.subscribe() handles multiple subscriptions independently',
          action: async (ctx) => {
            const { entryPathObject, entryInstance } = ctx;

            let subscription1Events = 0;
            let subscription2Events = 0;

            const { unsubscribe: unsubscribe1 } = entryPathObject.subscribe(() => {
              subscription1Events++;
            });

            entryPathObject.subscribe(() => {
              subscription2Events++;
            });

            // Make change - both should receive event
            let keyUpdatedPromise = waitForMapKeyUpdate(entryInstance, 'key1');
            await entryPathObject.set('key1', 'value1');
            await keyUpdatedPromise;

            // Unsubscribe first subscription
            unsubscribe1();

            // Make another change - only second should receive event
            keyUpdatedPromise = waitForMapKeyUpdate(entryInstance, 'key2');
            await entryPathObject.set('key2', 'value2');
            await keyUpdatedPromise;

            expect(subscription1Events).to.equal(1, 'Check first subscription received one event');
            expect(subscription2Events).to.equal(2, 'Check second subscription received two events');
          },
        },

        {
          description: 'PathObject.subscribe() event object provides correct PathObject instance',
          action: async (ctx) => {
            const { entryPathObject, entryInstance } = ctx;

            const subscriptionPromise = new Promise((resolve, reject) => {
              entryPathObject.subscribe((event) => {
                try {
                  expect(event.object, 'Check event object exists').to.exist;
                  expectInstanceOf(event.object, 'DefaultPathObject', 'Check event object is PathObject instance');
                  expect(event.object.path()).to.equal('', 'Check event object has correct path');
                  resolve();
                } catch (error) {
                  reject(error);
                }
              });
            });

            const keyUpdatedPromise = waitForMapKeyUpdate(entryInstance, 'foo');
            await entryPathObject.set('foo', 'bar');
            await keyUpdatedPromise;

            await subscriptionPromise;
          },
        },

        {
          description: 'PathObject.subscribe() handles subscription listener errors gracefully',
          action: async (ctx) => {
            const { entryPathObject, entryInstance } = ctx;

            let goodListenerCalled = false;

            // Add a listener that throws an error
            entryPathObject.subscribe(() => {
              throw new Error('Test subscription error');
            });

            // Add a good listener to ensure other subscriptions still work
            entryPathObject.subscribe(() => {
              goodListenerCalled = true;
            });

            const keyUpdatedPromise = waitForMapKeyUpdate(entryInstance, 'foo');
            await entryPathObject.set('foo', 'bar');
            await keyUpdatedPromise;

            // Wait for next tick to ensure both listeners had a chance to process the event
            await new Promise((res) => nextTick(res));

            expect(goodListenerCalled, 'Check good listener was called').to.be.true;
          },
        },

        {
          description: 'PathObject.subscribe() throws error for invalid options',
          action: async (ctx) => {
            const { entryPathObject } = ctx;

            expect(() => {
              entryPathObject.subscribe(() => {}, 'invalid');
            }).to.throw('Subscription options must be an object');

            expect(() => {
              entryPathObject.subscribe(() => {}, { depth: 0 });
            }).to.throw('Subscription depth must be greater than 0 or undefined for infinite depth');

            expect(() => {
              entryPathObject.subscribe(() => {}, { depth: -1 });
            }).to.throw('Subscription depth must be greater than 0 or undefined for infinite depth');
          },
        },

        {
          description: 'PathObject.subscribeIterator() yields events for changes to the subscribed path',
          action: async (ctx) => {
            const { entryInstance, entryPathObject } = ctx;

            const iteratorPromise = (async () => {
              const events = [];
              for await (const event of entryPathObject.subscribeIterator()) {
                expect(event.object, 'Check event object exists').to.exist;
                expect(event.message, 'Check event message exists').to.exist;
                events.push(event);
                if (events.length >= 2) break;
              }
              return events;
            })();

            const keysUpdatedPromise = Promise.all([
              waitForMapKeyUpdate(entryInstance, 'testKey1'),
              waitForMapKeyUpdate(entryInstance, 'testKey2'),
            ]);
            await entryPathObject.set('testKey1', 'testValue1');
            await entryPathObject.set('testKey2', 'testValue2');
            await keysUpdatedPromise;

            const events = await iteratorPromise;

            expect(events).to.have.lengthOf(2, 'Check received expected number of events');
          },
        },

        {
          description: 'PathObject.subscribeIterator() with depth option works correctly',
          action: async (ctx) => {
            const { entryInstance, entryPathObject } = ctx;

            const mapCreatedPromise = waitForMapKeyUpdate(entryInstance, 'map');
            await entryPathObject.set('map', LiveMap.create({}));
            await mapCreatedPromise;

            const iteratorPromise = (async () => {
              const events = [];
              for await (const event of entryPathObject.get('map').subscribeIterator({ depth: 1 })) {
                expect(event.object, 'Check event object exists').to.exist;
                expect(event.message, 'Check event message exists').to.exist;
                expectDeepSubset(
                  event.message.operation,
                  {
                    action: 'map.set',
                    objectId: entryPathObject.get('map').instance().id,
                    mapSet: { key: 'directKey' },
                  },
                  'Check event message operation',
                );

                events.push(event);
                if (events.length >= 2) break;
              }
              return events;
            })();

            const map = entryInstance.get('map');
            // direct change - should register
            let keyUpdatedPromise = waitForMapKeyUpdate(map, 'directKey');
            await map.set('directKey', LiveMap.create({}));
            await keyUpdatedPromise;

            // nested change - should not register
            keyUpdatedPromise = waitForMapKeyUpdate(map.get('directKey'), 'nestedKey');
            await map.get('directKey').set('nestedKey', 'nestedValue');
            await keyUpdatedPromise;

            // another direct change - should register
            keyUpdatedPromise = waitForMapKeyUpdate(map, 'directKey');
            await map.set('directKey', LiveMap.create({}));
            await keyUpdatedPromise;

            const events = await iteratorPromise;

            expect(events).to.have.lengthOf(2, 'Check received expected number of events');
          },
        },

        {
          description: 'PathObject.subscribeIterator() can be broken out of and subscription is removed properly',
          action: async (ctx) => {
            const { entryInstance, realtimeObject, entryPathObject, helper } = ctx;

            let eventCount = 0;

            const iteratorPromise = (async () => {
              for await (const _ of entryPathObject.subscribeIterator()) {
                eventCount++;
                if (eventCount >= 2) break;
              }
            })();

            helper.recordPrivateApi('call.RealtimeObject.getPathObjectSubscriptionRegister');
            helper.recordPrivateApi('read.PathObjectSubscriptionRegister._subscriptions');
            expect(realtimeObject.getPathObjectSubscriptionRegister()._subscriptions.size).to.equal(
              1,
              'Check one active subscription',
            );

            const keysUpdatedPromise = Promise.all([
              waitForMapKeyUpdate(entryInstance, 'testKey1'),
              waitForMapKeyUpdate(entryInstance, 'testKey2'),
              waitForMapKeyUpdate(entryInstance, 'testKey3'),
            ]);
            await entryPathObject.set('testKey1', 'testValue1');
            await entryPathObject.set('testKey2', 'testValue2');
            await entryPathObject.set('testKey3', 'testValue3'); // This shouldn't be processed
            await keysUpdatedPromise;

            await iteratorPromise;

            helper.recordPrivateApi('call.RealtimeObject.getPathObjectSubscriptionRegister');
            helper.recordPrivateApi('read.PathObjectSubscriptionRegister._subscriptions');
            expect(realtimeObject.getPathObjectSubscriptionRegister()._subscriptions.size).to.equal(
              0,
              'Check no active subscriptions after breaking out of iterator',
            );
            expect(eventCount).to.equal(2, 'Check only expected number of events received');
          },
        },

        {
          description: 'PathObject.subscribeIterator() handles multiple concurrent iterators independently',
          action: async (ctx) => {
            const { entryInstance, entryPathObject } = ctx;

            let iterator1Events = 0;
            let iterator2Events = 0;

            const iterator1Promise = (async () => {
              for await (const event of entryPathObject.subscribeIterator()) {
                expect(event.object, 'Check event object exists').to.exist;
                expect(event.message, 'Check event message exists').to.exist;
                iterator1Events++;
                if (iterator1Events >= 2) break;
              }
            })();

            const iterator2Promise = (async () => {
              for await (const event of entryPathObject.subscribeIterator()) {
                expect(event.object, 'Check event object exists').to.exist;
                expect(event.message, 'Check event message exists').to.exist;
                iterator2Events++;
                if (iterator2Events >= 1) break; // This iterator breaks after 1 event
              }
            })();

            const keysUpdatedPromise = Promise.all([
              waitForMapKeyUpdate(entryInstance, 'testKey1'),
              waitForMapKeyUpdate(entryInstance, 'testKey2'),
            ]);
            await entryPathObject.set('testKey1', 'testValue1');
            await entryPathObject.set('testKey2', 'testValue2');
            await keysUpdatedPromise;

            await Promise.all([iterator1Promise, iterator2Promise]);

            expect(iterator1Events).to.equal(2, 'Check iterator1 received expected events');
            expect(iterator2Events).to.equal(1, 'Check iterator2 received expected events');
          },
        },

        {
          description: 'PathObject.compact() returns value as is for primitive values',
          action: async (ctx) => {
            const { entryPathObject, entryInstance, helper } = ctx;

            const keysUpdatedPromise = Promise.all(
              primitiveKeyData.map((x) => waitForMapKeyUpdate(entryInstance, x.key)),
            );
            await Promise.all(
              primitiveKeyData.map(async (keyData) => {
                let value;
                if (keyData.jsonData.bytes != null) {
                  helper.recordPrivateApi('call.BufferUtils.base64Decode');
                  value = BufferUtils.base64Decode(keyData.jsonData.bytes);
                } else if (keyData.jsonData.json != null) {
                  value = JSON.parse(keyData.jsonData.json);
                } else {
                  value = keyData.jsonData.number ?? keyData.jsonData.string ?? keyData.jsonData.boolean;
                }

                await entryPathObject.set(keyData.key, value);
              }),
            );
            await keysUpdatedPromise;

            primitiveKeyData.forEach((keyData) => {
              const pathObj = entryPathObject.get(keyData.key);
              const compactValue = pathObj.compact();
              const expectedValue = pathObj.value();

              expect(compactValue).to.deep.equal(
                expectedValue,
                `Check PathObject.compact() returns correct value for primitive "${keyData.key}"`,
              );
            });
          },
        },

        {
          description: 'PathObject.compact() returns number for LiveCounter objects',
          action: async (ctx) => {
            const { entryInstance, entryPathObject } = ctx;

            const keyUpdatedPromise = waitForMapKeyUpdate(entryInstance, 'counter');
            await entryPathObject.set('counter', LiveCounter.create(42));
            await keyUpdatedPromise;

            const compactValue = entryPathObject.get('counter').compact();
            expect(compactValue).to.equal(42, 'Check PathObject.compact() returns number for LiveCounter');
          },
        },

        {
          description: 'PathObject.compact() returns plain object for LiveMap objects with buffers as-is',
          action: async (ctx) => {
            const { entryInstance, entryPathObject, helper } = ctx;

            // Create nested structure with different value types
            const keysUpdatedPromise = Promise.all([waitForMapKeyUpdate(entryInstance, 'nestedMap')]);
            helper.recordPrivateApi('call.BufferUtils.utf8Encode');
            const bufferValue = BufferUtils.utf8Encode('value');
            await entryPathObject.set(
              'nestedMap',
              LiveMap.create({
                stringKey: 'stringValue',
                numberKey: 123,
                booleanKey: true,
                counterKey: LiveCounter.create(99),
                array: [1, 2, 3],
                obj: { nested: 'value' },
                buffer: bufferValue,
              }),
            );
            await keysUpdatedPromise;

            const compactValue = entryPathObject.get('nestedMap').compact();
            const expected = {
              stringKey: 'stringValue',
              numberKey: 123,
              booleanKey: true,
              counterKey: 99,
              array: [1, 2, 3],
              obj: { nested: 'value' },
              buffer: bufferValue,
            };

            expect(compactValue).to.deep.equal(expected, 'Check compact object has expected value');
          },
        },

        {
          description: 'PathObject.compact() handles complex nested structures',
          action: async (ctx) => {
            const { entryInstance, entryPathObject } = ctx;

            const keyUpdatedPromise = waitForMapKeyUpdate(entryInstance, 'complex');
            await entryPathObject.set(
              'complex',
              LiveMap.create({
                level1: LiveMap.create({
                  level2: LiveMap.create({
                    counter: LiveCounter.create(10),
                    primitive: 'deep value',
                  }),
                  directCounter: LiveCounter.create(20),
                }),
                topLevelCounter: LiveCounter.create(30),
              }),
            );
            await keyUpdatedPromise;

            const compactValue = entryPathObject.get('complex').compact();
            const expected = {
              level1: {
                level2: {
                  counter: 10,
                  primitive: 'deep value',
                },
                directCounter: 20,
              },
              topLevelCounter: 30,
            };

            expect(compactValue).to.deep.equal(expected, 'Check complex nested structure is compacted correctly');
          },
        },

        {
          description: 'PathObject.compact() handles cyclic references',
          action: async (ctx) => {
            const { objectsHelper, channelName, entryInstance, entryPathObject } = ctx;

            // Create a structure with cyclic references using REST API (realtime does not allow referencing objects by id):
            // root -> map1 -> map2 -> map1 pointer (back reference)

            const { objectId: map1Id } = await objectsHelper.operationRequest(
              channelName,
              objectsHelper.mapCreateRestOp({ data: { foo: { string: 'bar' } } }),
            );
            const { objectId: map2Id } = await objectsHelper.operationRequest(
              channelName,
              objectsHelper.mapCreateRestOp({ data: { baz: { number: 42 } } }),
            );

            // Set up the cyclic references
            let keyUpdatedPromise = waitForMapKeyUpdate(entryInstance, 'map1');
            await objectsHelper.operationRequest(
              channelName,
              objectsHelper.mapSetRestOp({
                objectId: 'root',
                key: 'map1',
                value: { objectId: map1Id },
              }),
            );
            await keyUpdatedPromise;

            keyUpdatedPromise = waitForMapKeyUpdate(entryInstance.get('map1'), 'map2');
            await objectsHelper.operationRequest(
              channelName,
              objectsHelper.mapSetRestOp({
                objectId: map1Id,
                key: 'map2',
                value: { objectId: map2Id },
              }),
            );
            await keyUpdatedPromise;

            keyUpdatedPromise = waitForMapKeyUpdate(entryInstance.get('map1').get('map2'), 'map1BackRef');
            await objectsHelper.operationRequest(
              channelName,
              objectsHelper.mapSetRestOp({
                objectId: map2Id,
                key: 'map1BackRef',
                value: { objectId: map1Id },
              }),
            );
            await keyUpdatedPromise;

            // Test that compact() handles cyclic references correctly
            const compactEntry = entryPathObject.compact();

            expect(compactEntry).to.exist;
            expect(compactEntry.map1).to.exist;
            expect(compactEntry.map1.foo).to.equal('bar', 'Check primitive value is preserved');
            expect(compactEntry.map1.map2).to.exist;
            expect(compactEntry.map1.map2.baz).to.equal(42, 'Check nested primitive value is preserved');
            expect(compactEntry.map1.map2.map1BackRef).to.exist;

            // The back reference should point to the same object reference
            expect(compactEntry.map1.map2.map1BackRef).to.equal(
              compactEntry.map1,
              'Check cyclic reference returns the same memoized result object',
            );
          },
        },

        {
          description: 'PathObject.compactJson() returns JSON-encodable value for primitive values',
          action: async (ctx) => {
            const { entryPathObject, entryInstance, helper } = ctx;

            const keysUpdatedPromise = Promise.all(
              primitiveKeyData.map((x) => waitForMapKeyUpdate(entryInstance, x.key)),
            );
            await Promise.all(
              primitiveKeyData.map(async (keyData) => {
                let value;
                if (keyData.jsonData.bytes != null) {
                  helper.recordPrivateApi('call.BufferUtils.base64Decode');
                  value = BufferUtils.base64Decode(keyData.jsonData.bytes);
                } else if (keyData.jsonData.json != null) {
                  value = JSON.parse(keyData.jsonData.json);
                } else {
                  value = keyData.jsonData.number ?? keyData.jsonData.string ?? keyData.jsonData.boolean;
                }

                await entryPathObject.set(keyData.key, value);
              }),
            );
            await keysUpdatedPromise;

            primitiveKeyData.forEach((keyData) => {
              const pathObj = entryPathObject.get(keyData.key);
              const compactJsonValue = pathObj.compactJson();
              // expect buffer values to be base64-encoded strings
              helper.recordPrivateApi('call.BufferUtils.isBuffer');
              helper.recordPrivateApi('call.BufferUtils.base64Encode');
              const expectedValue = BufferUtils.isBuffer(pathObj.value())
                ? BufferUtils.base64Encode(pathObj.value())
                : pathObj.value();

              expect(compactJsonValue).to.deep.equal(
                expectedValue,
                `Check PathObject.compactJson() returns correct value for primitive "${keyData.key}"`,
              );
            });
          },
        },

        {
          description: 'PathObject.compactJson() returns number for LiveCounter objects',
          action: async (ctx) => {
            const { entryInstance, entryPathObject } = ctx;

            const keyUpdatedPromise = waitForMapKeyUpdate(entryInstance, 'counter');
            await entryPathObject.set('counter', LiveCounter.create(42));
            await keyUpdatedPromise;

            const compactJsonValue = entryPathObject.get('counter').compactJson();
            expect(compactJsonValue).to.equal(42, 'Check PathObject.compactJson() returns number for LiveCounter');
          },
        },

        {
          description: 'PathObject.compactJson() returns plain object for LiveMap with base64-encoded buffers',
          action: async (ctx) => {
            const { entryInstance, entryPathObject, helper } = ctx;

            // Create nested structure with different value types
            const keysUpdatedPromise = Promise.all([waitForMapKeyUpdate(entryInstance, 'nestedMap')]);
            helper.recordPrivateApi('call.BufferUtils.utf8Encode');
            await entryPathObject.set(
              'nestedMap',
              LiveMap.create({
                stringKey: 'stringValue',
                numberKey: 123,
                booleanKey: true,
                counterKey: LiveCounter.create(99),
                array: [1, 2, 3],
                obj: { nested: 'value' },
                buffer: BufferUtils.utf8Encode('value'),
              }),
            );
            await keysUpdatedPromise;

            const compactJsonValue = entryPathObject.get('nestedMap').compactJson();
            helper.recordPrivateApi('call.BufferUtils.utf8Encode');
            helper.recordPrivateApi('call.BufferUtils.base64Encode');
            const expected = {
              stringKey: 'stringValue',
              numberKey: 123,
              booleanKey: true,
              counterKey: 99,
              array: [1, 2, 3],
              obj: { nested: 'value' },
              buffer: BufferUtils.base64Encode(BufferUtils.utf8Encode('value')),
            };

            expect(compactJsonValue).to.deep.equal(expected, 'Check compact object has expected value');
          },
        },

        {
          description: 'PathObject.compactJson() handles complex nested structures',
          action: async (ctx) => {
            const { entryInstance, entryPathObject } = ctx;

            const keyUpdatedPromise = waitForMapKeyUpdate(entryInstance, 'complex');
            await entryPathObject.set(
              'complex',
              LiveMap.create({
                level1: LiveMap.create({
                  level2: LiveMap.create({
                    counter: LiveCounter.create(10),
                    primitive: 'deep value',
                  }),
                  directCounter: LiveCounter.create(20),
                }),
                topLevelCounter: LiveCounter.create(30),
              }),
            );
            await keyUpdatedPromise;

            const compactJsonValue = entryPathObject.get('complex').compactJson();
            const expected = {
              level1: {
                level2: {
                  counter: 10,
                  primitive: 'deep value',
                },
                directCounter: 20,
              },
              topLevelCounter: 30,
            };

            expect(compactJsonValue).to.deep.equal(expected, 'Check complex nested structure is compacted correctly');
          },
        },

        {
          description: 'PathObject.compactJson() handles cyclic references with objectId',
          action: async (ctx) => {
            const { objectsHelper, channelName, entryInstance, entryPathObject } = ctx;

            // Create a structure with cyclic references using REST API (realtime does not allow referencing objects by id):
            // root -> map1 -> map2 -> map1BackRef = { objectId: map1Id }

            const { objectId: map1Id } = await objectsHelper.operationRequest(
              channelName,
              objectsHelper.mapCreateRestOp({ data: { foo: { string: 'bar' } } }),
            );
            const { objectId: map2Id } = await objectsHelper.operationRequest(
              channelName,
              objectsHelper.mapCreateRestOp({ data: { baz: { number: 42 } } }),
            );

            // Set up the cyclic references
            let keyUpdatedPromise = waitForMapKeyUpdate(entryInstance, 'map1');
            await objectsHelper.operationRequest(
              channelName,
              objectsHelper.mapSetRestOp({
                objectId: 'root',
                key: 'map1',
                value: { objectId: map1Id },
              }),
            );
            await keyUpdatedPromise;

            keyUpdatedPromise = waitForMapKeyUpdate(entryInstance.get('map1'), 'map2');
            await objectsHelper.operationRequest(
              channelName,
              objectsHelper.mapSetRestOp({
                objectId: map1Id,
                key: 'map2',
                value: { objectId: map2Id },
              }),
            );
            await keyUpdatedPromise;

            keyUpdatedPromise = waitForMapKeyUpdate(entryInstance.get('map1').get('map2'), 'map1BackRef');
            await objectsHelper.operationRequest(
              channelName,
              objectsHelper.mapSetRestOp({
                objectId: map2Id,
                key: 'map1BackRef',
                value: { objectId: map1Id },
              }),
            );
            await keyUpdatedPromise;

            // Test that compactJson() handles cyclic references by returning objectId
            const compactJsonEntry = entryPathObject.compactJson();

            expect(compactJsonEntry).to.exist;
            expect(compactJsonEntry.map1).to.exist;
            expect(compactJsonEntry.map1.foo).to.equal('bar', 'Check primitive value is preserved');
            expect(compactJsonEntry.map1.map2).to.exist;
            expect(compactJsonEntry.map1.map2.baz).to.equal(42, 'Check nested primitive value is preserved');
            expect(compactJsonEntry.map1.map2.map1BackRef).to.exist;

            // The back reference should be { objectId: string } instead of in-memory pointer
            expect(compactJsonEntry.map1.map2.map1BackRef).to.deep.equal(
              { objectId: map1Id },
              'Check cyclic reference returns objectId structure for JSON serialization',
            );

            // Verify the result can be JSON stringified (no circular reference error)
            expect(() => JSON.stringify(compactJsonEntry)).to.not.throw();
          },
        },

        {
          description: 'PathObject.batch() passes RootBatchContext to its batch function',
          action: async (ctx) => {
            const { entryPathObject } = ctx;

            await entryPathObject.batch((ctx) => {
              expect(ctx, 'Check batch context exists').to.exist;
              expectInstanceOf(ctx, 'RootBatchContext', 'Check batch context is of RootBatchContext type');
            });
          },
        },
      ];

      const instanceScenarios = [
        {
          description: 'DefaultInstance.id returns object ID of the underlying LiveObject',
          action: async (ctx) => {
            const { objectsHelper, channelName, entryInstance } = ctx;

            const keysUpdatedPromise = Promise.all([
              waitForMapKeyUpdate(entryInstance, 'map'),
              waitForMapKeyUpdate(entryInstance, 'counter'),
            ]);
            const { objectId: mapId } = await objectsHelper.createAndSetOnMap(channelName, {
              mapObjectId: 'root',
              key: 'map',
              createOp: objectsHelper.mapCreateRestOp(),
            });
            const { objectId: counterId } = await objectsHelper.createAndSetOnMap(channelName, {
              mapObjectId: 'root',
              key: 'counter',
              createOp: objectsHelper.counterCreateRestOp(),
            });
            await keysUpdatedPromise;

            const map = entryInstance.get('map');
            const counter = entryInstance.get('counter');

            expect(map.id).to.equal(mapId, 'Check DefaultInstance.id for map matches expected value');
            expect(counter.id).to.equal(counterId, 'Check DefaultInstance.id for counter matches expected value');
          },
        },

        {
          description: 'DefaultInstance.get() returns child DefaultInstance instances',
          action: async (ctx) => {
            const { entryPathObject, entryInstance } = ctx;

            const keysUpdatedPromise = Promise.all([
              waitForMapKeyUpdate(entryInstance, 'stringKey'),
              waitForMapKeyUpdate(entryInstance, 'counterKey'),
            ]);
            await entryPathObject.set('stringKey', 'value');
            await entryPathObject.set('counterKey', LiveCounter.create(42));
            await keysUpdatedPromise;

            const rootInstance = entryPathObject.instance();

            const stringInstance = rootInstance.get('stringKey');
            expect(stringInstance, 'Check string DefaultInstance exists').to.exist;
            expectInstanceOf(stringInstance, 'DefaultInstance', 'string instance should be of DefaultInstance type');
            expect(stringInstance.value()).to.equal('value', 'Check string instance has correct value');

            const counterInstance = rootInstance.get('counterKey');
            expect(counterInstance, 'Check counter DefaultInstance exists').to.exist;
            expectInstanceOf(counterInstance, 'DefaultInstance', 'counter instance should be of DefaultInstance type');
            expect(counterInstance.value()).to.equal(42, 'Check counter instance has correct value');
          },
        },

        {
          description: 'DefaultInstance.value() returns primitive values correctly',
          action: async (ctx) => {
            const { entryPathObject, helper, entryInstance } = ctx;

            const keysUpdatedPromise = Promise.all(
              primitiveKeyData.map((x) => waitForMapKeyUpdate(entryInstance, x.key)),
            );
            await Promise.all(
              primitiveKeyData.map(async (keyData) => {
                let value;
                if (keyData.jsonData.bytes != null) {
                  helper.recordPrivateApi('call.BufferUtils.base64Decode');
                  value = BufferUtils.base64Decode(keyData.jsonData.bytes);
                } else if (keyData.jsonData.json != null) {
                  value = JSON.parse(keyData.jsonData.json);
                } else {
                  value = keyData.jsonData.number ?? keyData.jsonData.string ?? keyData.jsonData.boolean;
                }

                await entryPathObject.set(keyData.key, value);
              }),
            );
            await keysUpdatedPromise;

            const rootInstance = entryPathObject.instance();

            primitiveKeyData.forEach((keyData) => {
              checkKeyDataOnInstance({
                helper,
                key: keyData.key,
                keyData,
                instance: rootInstance,
                msg: `Check DefaultInstance returns correct value for "${keyData.key}" key after PathObject.set call`,
              });
            });
          },
        },

        {
          description: 'DefaultInstance.value() returns LiveCounter values',
          action: async (ctx) => {
            const { entryPathObject, entryInstance } = ctx;

            const keyUpdatedPromise = waitForMapKeyUpdate(entryInstance, 'counter');
            await entryPathObject.set('counter', LiveCounter.create(10));
            await keyUpdatedPromise;

            const counterInstance = entryPathObject.get('counter').instance();

            expect(counterInstance.value()).to.equal(10, 'Check counter value is returned correctly');
          },
        },

        {
          description: 'DefaultInstance collection methods work for LiveMap objects',
          action: async (ctx) => {
            const { entryPathObject, entryInstance } = ctx;

            const keysUpdatedPromise = Promise.all([
              waitForMapKeyUpdate(entryInstance, 'key1'),
              waitForMapKeyUpdate(entryInstance, 'key2'),
              waitForMapKeyUpdate(entryInstance, 'key3'),
            ]);
            await entryPathObject.set('key1', 'value1');
            await entryPathObject.set('key2', 'value2');
            await entryPathObject.set('key3', 'value3');
            await keysUpdatedPromise;

            const rootInstance = entryPathObject.instance();

            // Test size
            expect(rootInstance.size()).to.equal(3, 'Check DefaultInstance size');

            // Test keys
            const keys = [...rootInstance.keys()];
            expect(keys).to.have.members(['key1', 'key2', 'key3'], 'Check DefaultInstance keys');

            // Test entries
            const entries = [...rootInstance.entries()];
            expect(entries).to.have.lengthOf(3, 'Check DefaultInstance entries length');

            const entryKeys = entries.map(([key]) => key);
            expect(entryKeys).to.have.members(['key1', 'key2', 'key3'], 'Check entry keys');

            const entryValues = entries.map(([key, instance]) => instance.value());
            expect(entryValues).to.have.members(['value1', 'value2', 'value3'], 'Check DefaultInstance entries values');

            expectInstanceOf(entries[0][1], 'DefaultInstance', 'Check entry value is DefaultInstance');

            // Test values
            const values = [...rootInstance.values()];
            expect(values).to.have.lengthOf(3, 'Check DefaultInstance values length');

            const valueValues = values.map((instance) => instance.value());
            expect(valueValues).to.have.members(['value1', 'value2', 'value3'], 'Check DefaultInstance values');

            expectInstanceOf(values[0], 'DefaultInstance', 'Check value is DefaultInstance');
          },
        },

        {
          description: 'DefaultInstance.set() works for LiveMap objects with primitive values',
          action: async (ctx) => {
            const { entryPathObject, helper, entryInstance } = ctx;

            const rootInstance = entryPathObject.instance();

            const keysUpdatedPromise = Promise.all(
              primitiveKeyData.map((x) => waitForMapKeyUpdate(entryInstance, x.key)),
            );
            await Promise.all(
              primitiveKeyData.map(async (keyData) => {
                let value;
                if (keyData.jsonData.bytes != null) {
                  helper.recordPrivateApi('call.BufferUtils.base64Decode');
                  value = BufferUtils.base64Decode(keyData.jsonData.bytes);
                } else if (keyData.jsonData.json != null) {
                  value = JSON.parse(keyData.jsonData.json);
                } else {
                  value = keyData.jsonData.number ?? keyData.jsonData.string ?? keyData.jsonData.boolean;
                }

                await rootInstance.set(keyData.key, value);
              }),
            );
            await keysUpdatedPromise;

            // check primitive values were set correctly via Instance
            primitiveKeyData.forEach((keyData) => {
              checkKeyDataOnInstance({
                helper,
                key: keyData.key,
                keyData,
                instance: rootInstance,
                msg: `Check DefaultInstance returns correct value for "${keyData.key}" key after DefaultInstance.set call`,
              });
            });
          },
        },

        {
          description: 'DefaultInstance.set() works for LiveMap objects with LiveObject references',
          action: async (ctx) => {
            const { entryInstance } = ctx;

            const keyUpdatedPromise = waitForMapKeyUpdate(entryInstance, 'counterKey');
            await entryInstance.set('counterKey', LiveCounter.create(5));
            await keyUpdatedPromise;

            expect(entryInstance.get('counterKey'), 'Check counter object was set via DefaultInstance').to.exist;
            expect(entryInstance.get('counterKey').value()).to.equal(5, 'Check DefaultInstance reflects counter value');
          },
        },

        {
          description: 'DefaultInstance.remove() works for LiveMap objects',
          action: async (ctx) => {
            const { entryPathObject, entryInstance } = ctx;

            const keyAddedPromise = waitForMapKeyUpdate(entryInstance, 'keyToRemove');
            await entryPathObject.set('keyToRemove', 'valueToRemove');
            await keyAddedPromise;

            expect(entryPathObject.get('keyToRemove').value(), 'Check key exists on root').to.exist;

            const keyRemovedPromise = waitForMapKeyUpdate(entryInstance, 'keyToRemove');
            await entryInstance.remove('keyToRemove');
            await keyRemovedPromise;

            expect(
              entryInstance.get('keyToRemove'),
              'Check value for instance is undefined after DefaultInstance.remove()',
            ).to.be.undefined;
          },
        },

        {
          description: 'DefaultInstance.increment() and DefaultInstance.decrement() work for LiveCounter objects',
          action: async (ctx) => {
            const { entryPathObject, entryInstance } = ctx;

            const keyUpdatedPromise = waitForMapKeyUpdate(entryInstance, 'counter');
            await entryPathObject.set('counter', LiveCounter.create(10));
            await keyUpdatedPromise;

            const counter = entryInstance.get('counter');

            let counterUpdatedPromise = waitForCounterUpdate(counter);
            await counter.increment(5);
            await counterUpdatedPromise;

            expect(counter.value()).to.equal(15, 'Check DefaultInstance reflects incremented value');

            counterUpdatedPromise = waitForCounterUpdate(counter);
            await counter.decrement(3);
            await counterUpdatedPromise;

            expect(counter.value()).to.equal(12, 'Check DefaultInstance reflects decremented value');

            // test increment/decrement without argument (should increment/decrement by 1)
            counterUpdatedPromise = waitForCounterUpdate(counter);
            await counter.increment();
            await counterUpdatedPromise;

            expect(counter.value()).to.equal(13, 'Check DefaultInstance reflects incremented value');

            counterUpdatedPromise = waitForCounterUpdate(counter);
            await counter.decrement();
            await counterUpdatedPromise;

            expect(counter.value()).to.equal(12, 'Check DefaultInstance reflects decremented value');
          },
        },

        {
          description: 'DefaultInstance.get() throws error for non-string keys',
          action: async (ctx) => {
            const { entryPathObject } = ctx;

            const rootInstance = entryPathObject.instance();

            expect(() => rootInstance.get()).to.throw('Key must be a string');
            expect(() => rootInstance.get(null)).to.throw('Key must be a string');
            expect(() => rootInstance.get(123)).to.throw('Key must be a string');
            expect(() => rootInstance.get(BigInt(1))).to.throw('Key must be a string');
            expect(() => rootInstance.get(true)).to.throw('Key must be a string');
            expect(() => rootInstance.get({})).to.throw('Key must be a string');
            expect(() => rootInstance.get([])).to.throw('Key must be a string');
          },
        },

        {
          description: 'DefaultInstance handling of operations on wrong underlying object type',
          action: async (ctx) => {
            const { entryPathObject, entryInstance } = ctx;

            const keysUpdatedPromise = Promise.all([
              waitForMapKeyUpdate(entryInstance, 'map'),
              waitForMapKeyUpdate(entryInstance, 'counter'),
              waitForMapKeyUpdate(entryInstance, 'primitive'),
            ]);
            await entryPathObject.set('map', LiveMap.create({ foo: 'bar' }));
            await entryPathObject.set('counter', LiveCounter.create());
            await entryPathObject.set('primitive', 'value');
            await keysUpdatedPromise;

            const mapInstance = entryPathObject.get('map').instance();
            const counterInstance = entryPathObject.get('counter').instance();
            const primitiveInstance = mapInstance.get('foo');

            // next methods silently handle incorrect underlying type
            expect(primitiveInstance.id, 'Check DefaultInstance.id for wrong underlying object type returns undefined')
              .to.be.undefined;
            expect(
              primitiveInstance.get('foo'),
              'Check DefaultInstance.get() for wrong underlying object type returns undefined',
            ).to.be.undefined;
            expect(
              mapInstance.value(),
              'Check DefaultInstance.value() for wrong underlying object type returns undefined',
            ).to.be.undefined;
            expect([...primitiveInstance.entries()]).to.deep.equal(
              [],
              'Check DefaultInstance.entries() for wrong underlying object type returns empty iterator',
            );
            expect([...primitiveInstance.keys()]).to.deep.equal(
              [],
              'Check DefaultInstance.keys() for wrong underlying object type returns empty iterator',
            );
            expect([...primitiveInstance.values()]).to.deep.equal(
              [],
              'Check DefaultInstance.values() for wrong underlying object type returns empty iterator',
            );
            expect(
              primitiveInstance.size(),
              'Check DefaultInstance.size() for wrong underlying object type returns undefined',
            ).to.be.undefined;

            // map mutation methods throw errors for non-LiveMap objects
            await expectToThrowAsync(
              async () => primitiveInstance.set('key', 'value'),
              'Cannot set a key on a non-LiveMap instance',
              { withCode: 92007 },
            );
            await expectToThrowAsync(
              async () => counterInstance.set('key', 'value'),
              'Cannot set a key on a non-LiveMap instance',
              { withCode: 92007 },
            );

            await expectToThrowAsync(
              async () => primitiveInstance.remove('key'),
              'Cannot remove a key from a non-LiveMap instance',
              { withCode: 92007 },
            );
            await expectToThrowAsync(
              async () => counterInstance.remove('key'),
              'Cannot remove a key from a non-LiveMap instance',
              { withCode: 92007 },
            );

            // counter mutation methods throw errors for non-LiveCounter objects
            await expectToThrowAsync(
              async () => primitiveInstance.increment(),
              'Cannot increment a non-LiveCounter instance',
              { withCode: 92007 },
            );
            await expectToThrowAsync(
              async () => mapInstance.increment(),
              'Cannot increment a non-LiveCounter instance',
              {
                withCode: 92007,
              },
            );

            await expectToThrowAsync(
              async () => primitiveInstance.decrement(),
              'Cannot decrement a non-LiveCounter instance',
              { withCode: 92007 },
            );
            await expectToThrowAsync(
              async () => mapInstance.decrement(),
              'Cannot decrement a non-LiveCounter instance',
              { withCode: 92007 },
            );

            // next methods throw errors for non-LiveObjects
            expect(() => {
              primitiveInstance.subscribe(() => {});
            })
              .to.throw('Cannot subscribe to a non-LiveObject instance')
              .with.property('code', 92007);
            expect(() => {
              primitiveInstance.subscribeIterator();
            })
              .to.throw('Cannot subscribe to a non-LiveObject instance')
              .with.property('code', 92007);
            await expectToThrowAsync(
              async () => primitiveInstance.batch(),
              'Cannot batch operations on a non-LiveObject instance',
              { withCode: 92007 },
            );
          },
        },

        {
          description: 'DefaultInstance.subscribe() receives events for LiveMap set/remove/clear operations',
          action: async (ctx) => {
            const { entryInstance, objectsHelper, channel } = ctx;

            await entryInstance.set('map', LiveMap.create());
            const mapInstance = entryInstance.get('map');
            let eventCount = 0;

            const subscriptionPromise = new Promise((resolve, reject) => {
              mapInstance.subscribe((event) => {
                eventCount++;

                try {
                  expect(event.object).to.equal(mapInstance, 'Check event object is the same instance');
                  expect(event.message, 'Check event message exists').to.exist;

                  if (eventCount === 1) {
                    expect(event.message.operation.action).to.equal('map.set', 'Check first event is MAP_SET');
                  } else if (eventCount === 2) {
                    expect(event.message.operation.action).to.equal('map.remove', 'Check second event is MAP_REMOVE');
                  } else if (eventCount === 3) {
                    expect(event.message.operation.action).to.equal('map.clear', 'Check third event is MAP_CLEAR');
                    resolve();
                  }
                } catch (error) {
                  reject(error);
                }
              });
            });

            await entryInstance.get('map').set('foo', 'bar');
            await entryInstance.get('map').remove('foo');

            await objectsHelper.processObjectOperationMessageOnChannel({
              channel,
              serial: lexicoTimeserial('zzz', 99999999999999, 0),
              siteCode: 'zzz',
              state: [objectsHelper.mapClearOp({ objectId: mapInstance.id })],
            });

            await subscriptionPromise;
          },
        },

        {
          description: 'DefaultInstance.subscribe() receives events for LiveCounter increment/decrement',
          action: async (ctx) => {
            const { entryPathObject, entryInstance } = ctx;

            let keyUpdatedPromise = waitForMapKeyUpdate(entryInstance, 'counter');
            await entryPathObject.set('counter', LiveCounter.create());
            await keyUpdatedPromise;

            const counterInstance = entryPathObject.get('counter').instance();
            let eventCount = 0;

            const subscriptionPromise = new Promise((resolve, reject) => {
              counterInstance.subscribe((event) => {
                eventCount++;

                try {
                  expect(event.object).to.equal(counterInstance, 'Check event object is the same instance');
                  expect(event.message, 'Check event message exists').to.exist;

                  if (eventCount === 1) {
                    expect(event.message.operation.action).to.equal(
                      'counter.inc',
                      'Check first event is COUNTER_INC with positive value',
                    );
                    expect(event.message.operation.counterInc.number).to.equal(
                      1,
                      'Check first event is COUNTER_INC with positive value',
                    );
                  } else if (eventCount === 2) {
                    expect(event.message.operation.action).to.equal(
                      'counter.inc',
                      'Check second event is COUNTER_INC with negative value',
                    );
                    expect(event.message.operation.counterInc.number).to.equal(
                      -1,
                      'Check first event is COUNTER_INC with positive value',
                    );

                    resolve();
                  }
                } catch (error) {
                  reject(error);
                }
              });
            });

            let counterUpdatedPromise = waitForCounterUpdate(entryInstance.get('counter'));
            await entryPathObject.get('counter').increment();
            await counterUpdatedPromise;

            counterUpdatedPromise = waitForCounterUpdate(entryInstance.get('counter'));
            await entryPathObject.get('counter').decrement();
            await counterUpdatedPromise;

            await subscriptionPromise;
          },
        },

        {
          description: 'DefaultInstance.subscribe() returns "unsubscribe" function',
          action: async (ctx) => {
            const { entryPathObject } = ctx;

            const subscribeResponse = entryPathObject.instance().subscribe(() => {});

            expect(subscribeResponse, 'Check subscribe response exists').to.exist;
            expect(subscribeResponse.unsubscribe).to.be.a('function', 'Check unsubscribe is a function');

            // Should not throw when called
            subscribeResponse.unsubscribe();
          },
        },

        {
          description: 'can unsubscribe from DefaultInstance.subscribe() updates using returned "unsubscribe" function',
          action: async (ctx) => {
            const { entryPathObject, entryInstance } = ctx;

            let eventCount = 0;
            const { unsubscribe } = entryPathObject.instance().subscribe(() => {
              eventCount++;
            });

            // Make first change - should receive event
            let keyUpdatedPromise = waitForMapKeyUpdate(entryInstance, 'key1');
            await entryPathObject.set('key1', 'value1');
            await keyUpdatedPromise;

            unsubscribe();

            // Make second change - should NOT receive event
            keyUpdatedPromise = waitForMapKeyUpdate(entryInstance, 'key2');
            await entryPathObject.set('key2', 'value2');
            await keyUpdatedPromise;

            expect(eventCount).to.equal(1, 'Check only first event was received after unsubscribe');
          },
        },

        {
          description: 'DefaultInstance.subscribe() handles multiple subscriptions independently',
          action: async (ctx) => {
            const { entryPathObject, entryInstance } = ctx;

            let subscription1Events = 0;
            let subscription2Events = 0;

            const { unsubscribe: unsubscribe1 } = entryPathObject.instance().subscribe(() => {
              subscription1Events++;
            });

            entryPathObject.instance().subscribe(() => {
              subscription2Events++;
            });

            // Make change - both should receive event
            let keyUpdatedPromise = waitForMapKeyUpdate(entryInstance, 'key1');
            await entryPathObject.set('key1', 'value1');
            await keyUpdatedPromise;

            // Unsubscribe first subscription
            unsubscribe1();

            // Make another change - only second should receive event
            keyUpdatedPromise = waitForMapKeyUpdate(entryInstance, 'key2');
            await entryPathObject.set('key2', 'value2');
            await keyUpdatedPromise;

            expect(subscription1Events).to.equal(1, 'Check first subscription received one event');
            expect(subscription2Events).to.equal(2, 'Check second subscription received two events');
          },
        },

        {
          description: 'DefaultInstance.subscribe() event object provides correct DefaultInstance reference',
          action: async (ctx) => {
            const { entryPathObject, entryInstance } = ctx;

            const subscriptionPromise = new Promise((resolve, reject) => {
              entryInstance.subscribe((event) => {
                try {
                  expect(event.object, 'Check event object exists').to.exist;
                  expectInstanceOf(event.object, 'DefaultInstance', 'Check event object is DefaultInstance');
                  expect(event.object.id).to.equal('root', 'Check event object has correct object ID');
                  expect(event.object).to.equal(entryInstance, 'Check event object is the same instance');
                  resolve();
                } catch (error) {
                  reject(error);
                }
              });
            });

            const keyUpdatedPromise = waitForMapKeyUpdate(entryInstance, 'foo');
            await entryPathObject.set('foo', 'bar');
            await keyUpdatedPromise;

            await subscriptionPromise;
          },
        },

        {
          description: 'DefaultInstance.subscribe() handles subscription listener errors gracefully',
          action: async (ctx) => {
            const { entryPathObject, entryInstance } = ctx;

            let goodListenerCalled = false;

            // Add a listener that throws an error
            entryPathObject.instance().subscribe(() => {
              throw new Error('Test subscription error');
            });

            // Add a good listener to ensure other subscriptions still work
            entryPathObject.instance().subscribe(() => {
              goodListenerCalled = true;
            });

            const keyUpdatedPromise = waitForMapKeyUpdate(entryInstance, 'foo');
            await entryPathObject.set('foo', 'bar');
            await keyUpdatedPromise;

            // Wait for next tick to ensure both listeners had a chance to process the event
            await new Promise((res) => nextTick(res));

            expect(goodListenerCalled, 'Check good listener was called').to.be.true;
          },
        },

        {
          description: 'DefaultInstance.subscribeIterator() yields events for LiveMap set/remove/clear operations',
          action: async (ctx) => {
            const { channel, entryInstance, objectsHelper } = ctx;

            await entryInstance.set('map', LiveMap.create());
            const map = entryInstance.get('map');

            const expectedEventOperations = [
              { action: 'map.set', objectId: map.id, mapSet: { key: 'foo', value: { string: 'bar' } } },
              { action: 'map.remove', objectId: map.id, mapRemove: { key: 'foo' } },
              { action: 'map.clear', objectId: map.id, mapClear: {} },
            ];

            const iteratorPromise = (async () => {
              const events = [];
              for await (const event of map.subscribeIterator()) {
                expect(event.object, 'Check event object exists').to.exist;
                expect(event.object).to.equal(map, 'Check event object is the same map instance');
                expect(event.message, 'Check event message exists').to.exist;
                expectDeepSubset(
                  event.message.operation,
                  expectedEventOperations[events.length],
                  'Check event message operation',
                );

                events.push(event);
                if (events.length >= 3) break;
              }
              return events;
            })();

            await map.set('foo', 'bar');
            await map.remove('foo');

            await objectsHelper.processObjectOperationMessageOnChannel({
              channel,
              serial: lexicoTimeserial('zzz', 99999999999999, 0),
              siteCode: 'zzz',
              state: [objectsHelper.mapClearOp({ objectId: map.id })],
            });

            const events = await iteratorPromise;
            expect(events).to.have.lengthOf(3, 'Check received expected number of events');
          },
        },

        {
          description: 'DefaultInstance.subscribeIterator() yields events for LiveCounter increment/decrement',
          action: async (ctx) => {
            const { entryInstance, entryPathObject } = ctx;

            const keyUpdatedPromise = waitForMapKeyUpdate(entryInstance, 'counter');
            await entryPathObject.set('counter', LiveCounter.create());
            await keyUpdatedPromise;

            const counter = entryInstance.get('counter');

            const iteratorPromise = (async () => {
              const events = [];
              for await (const event of counter.subscribeIterator()) {
                expect(event.object, 'Check event object exists').to.exist;
                expect(event.object).to.equal(counter, 'Check event object is the same counter instance');
                expect(event.message, 'Check event message exists').to.exist;
                expect(event.message.operation).to.deep.include(
                  {
                    action: 'counter.inc',
                    objectId: counter.id,
                    counterInc: { number: events.length === 0 ? 1 : -2 },
                  },
                  'Check event message operation',
                );
                events.push(event);
                if (events.length >= 2) break;
              }
              return events;
            })();

            let counterUpdatedPromise = waitForCounterUpdate(counter);
            await counter.increment(1);
            await counterUpdatedPromise;

            counterUpdatedPromise = waitForCounterUpdate(counter);
            await counter.decrement(2);
            await counterUpdatedPromise;

            const events = await iteratorPromise;
            expect(events).to.have.lengthOf(2, 'Check received expected number of events');
          },
        },

        {
          description: 'DefaultInstance.subscribeIterator() can be broken out of and subscription is removed properly',
          action: async (ctx) => {
            const { entryInstance, entryPathObject, helper } = ctx;

            const registeredListeners = (instance) => {
              helper.recordPrivateApi('read.DefaultInstance._value');
              helper.recordPrivateApi('read.LiveObject._subscriptions');
              helper.recordPrivateApi('call.EventEmitter.listeners');
              return instance._value._subscriptions.listeners('updated');
            };

            const instance = entryPathObject.instance();
            let eventCount = 0;

            const iteratorPromise = (async () => {
              for await (const _ of instance.subscribeIterator()) {
                eventCount++;
                if (eventCount >= 2) break;
              }
            })();

            expect(registeredListeners(instance).length).to.equal(1, 'Check one active listener');

            const keysUpdatedPromise = Promise.all([
              waitForMapKeyUpdate(entryInstance, 'testKey1'),
              waitForMapKeyUpdate(entryInstance, 'testKey2'),
              waitForMapKeyUpdate(entryInstance, 'testKey3'),
            ]);
            await entryPathObject.set('testKey1', 'testValue1');
            await entryPathObject.set('testKey2', 'testValue2');
            await entryPathObject.set('testKey3', 'testValue3'); // This shouldn't be received
            await keysUpdatedPromise;

            await iteratorPromise;

            expect(registeredListeners(instance)?.length ?? 0).to.equal(
              0,
              'Check no active listeners after breaking out of iterator',
            );
            expect(eventCount).to.equal(2, 'Check only expected number of events received');
          },
        },

        {
          description: 'DefaultInstance.subscribeIterator() handles multiple concurrent iterators independently',
          action: async (ctx) => {
            const { entryInstance, entryPathObject } = ctx;

            const instance = entryPathObject.instance();
            let iterator1Events = 0;
            let iterator2Events = 0;

            const iterator1Promise = (async () => {
              for await (const event of instance.subscribeIterator()) {
                expect(event.object, 'Check event object exists').to.exist;
                expect(event.message, 'Check event message exists').to.exist;
                iterator1Events++;
                if (iterator1Events >= 2) break;
              }
            })();

            const iterator2Promise = (async () => {
              for await (const event of instance.subscribeIterator()) {
                expect(event.object, 'Check event object exists').to.exist;
                expect(event.message, 'Check event message exists').to.exist;
                iterator2Events++;
                if (iterator2Events >= 1) break; // This iterator breaks after 1 event
              }
            })();

            const keysUpdatedPromise = Promise.all([
              waitForMapKeyUpdate(entryInstance, 'testKey1'),
              waitForMapKeyUpdate(entryInstance, 'testKey2'),
            ]);
            await entryPathObject.set('testKey1', 'testValue1');
            await entryPathObject.set('testKey2', 'testValue2');
            await keysUpdatedPromise;

            await Promise.all([iterator1Promise, iterator2Promise]);

            expect(iterator1Events).to.equal(2, 'Check iterator1 received expected events');
            expect(iterator2Events).to.equal(1, 'Check iterator2 received expected events');
          },
        },

        {
          description: 'DefaultInstance.compact() returns value as is for primitive values',
          action: async (ctx) => {
            const { entryInstance, entryPathObject, helper } = ctx;

            const keysUpdatedPromise = Promise.all(
              primitiveKeyData.map((x) => waitForMapKeyUpdate(entryInstance, x.key)),
            );
            await Promise.all(
              primitiveKeyData.map(async (keyData) => {
                let value;
                if (keyData.jsonData.bytes != null) {
                  helper.recordPrivateApi('call.BufferUtils.base64Decode');
                  value = BufferUtils.base64Decode(keyData.jsonData.bytes);
                } else if (keyData.jsonData.json != null) {
                  value = JSON.parse(keyData.jsonData.json);
                } else {
                  value = keyData.jsonData.number ?? keyData.jsonData.string ?? keyData.jsonData.boolean;
                }

                await entryPathObject.set(keyData.key, value);
              }),
            );
            await keysUpdatedPromise;

            primitiveKeyData.forEach((keyData) => {
              const instance = entryInstance.get(keyData.key);
              const compactValue = instance.compact();
              const expectedValue = instance.value();

              expect(compactValue).to.deep.equal(
                expectedValue,
                `Check DefaultInstance.compact() returns correct value for primitive "${keyData.key}"`,
              );
            });
          },
        },

        {
          description: 'DefaultInstance.compact() returns number for LiveCounter objects',
          action: async (ctx) => {
            const { entryInstance, entryPathObject } = ctx;

            const keyUpdatedPromise = waitForMapKeyUpdate(entryInstance, 'counter');
            await entryPathObject.set('counter', LiveCounter.create(42));
            await keyUpdatedPromise;

            const compactValue = entryInstance.get('counter').compact();
            expect(compactValue).to.equal(42, 'Check DefaultInstance.compact() returns number for LiveCounter');
          },
        },

        {
          description: 'DefaultInstance.compact() returns plain object for LiveMap objects with buffers as-is',
          action: async (ctx) => {
            const { entryInstance, entryPathObject, helper } = ctx;

            // Create nested structure with different value types
            const keysUpdatedPromise = Promise.all([waitForMapKeyUpdate(entryInstance, 'nestedMap')]);
            helper.recordPrivateApi('call.BufferUtils.utf8Encode');
            const bufferValue = BufferUtils.utf8Encode('value');
            await entryPathObject.set(
              'nestedMap',
              LiveMap.create({
                stringKey: 'stringValue',
                numberKey: 456,
                booleanKey: false,
                counterKey: LiveCounter.create(111),
                array: [1, 2, 3],
                obj: { nested: 'value' },
                buffer: bufferValue,
              }),
            );
            await keysUpdatedPromise;

            const compactValue = entryInstance.get('nestedMap').compact();
            const expected = {
              stringKey: 'stringValue',
              numberKey: 456,
              booleanKey: false,
              counterKey: 111,
              array: [1, 2, 3],
              obj: { nested: 'value' },
              buffer: bufferValue,
            };

            expect(compactValue).to.deep.equal(expected, 'Check compact object has expected value');
          },
        },

        {
          description: 'DefaultInstance.compact() handles complex nested structures',
          action: async (ctx) => {
            const { entryInstance, entryPathObject } = ctx;

            const keyUpdatedPromise = waitForMapKeyUpdate(entryInstance, 'complex');
            await entryPathObject.set(
              'complex',
              LiveMap.create({
                level1: LiveMap.create({
                  level2: LiveMap.create({
                    counter: LiveCounter.create(100),
                    primitive: 'instance deep value',
                  }),
                  directCounter: LiveCounter.create(200),
                }),
                topLevelCounter: LiveCounter.create(300),
              }),
            );
            await keyUpdatedPromise;

            const compactValue = entryInstance.get('complex').compact();
            const expected = {
              level1: {
                level2: {
                  counter: 100,
                  primitive: 'instance deep value',
                },
                directCounter: 200,
              },
              topLevelCounter: 300,
            };

            expect(compactValue).to.deep.equal(expected, 'Check complex nested structure is compacted correctly');
          },
        },

        {
          description: 'DefaultInstance.compact() and PathObject.compact() return equivalent results',
          action: async (ctx) => {
            const { entryInstance, entryPathObject, helper } = ctx;

            const keyUpdatedPromise = waitForMapKeyUpdate(entryInstance, 'comparison');
            helper.recordPrivateApi('call.BufferUtils.utf8Encode');
            await entryPathObject.set(
              'comparison',
              LiveMap.create({
                counter: LiveCounter.create(50),
                nested: LiveMap.create({
                  value: 'test',
                  innerCounter: LiveCounter.create(25),
                }),
                primitive: 'comparison test',
                buffer: BufferUtils.utf8Encode('value'),
              }),
            );
            await keyUpdatedPromise;

            const pathCompact = entryPathObject.get('comparison').compact();
            const instanceCompact = entryInstance.get('comparison').compact();

            expect(pathCompact).to.deep.equal(
              instanceCompact,
              'Check PathObject.compact() and DefaultInstance.compact() return equivalent results',
            );
          },
        },

        {
          description: 'DefaultInstance.compact() handles cyclic references',
          action: async (ctx) => {
            const { objectsHelper, channelName, entryInstance } = ctx;

            // Create a structure with cyclic references using REST API (realtime does not allow referencing objects by id):
            // root -> map1 -> map2 -> map1 pointer (back reference)

            const { objectId: map1Id } = await objectsHelper.operationRequest(
              channelName,
              objectsHelper.mapCreateRestOp({ data: { foo: { string: 'bar' } } }),
            );
            const { objectId: map2Id } = await objectsHelper.operationRequest(
              channelName,
              objectsHelper.mapCreateRestOp({ data: { baz: { number: 42 } } }),
            );

            // Set up the cyclic references
            let keyUpdatedPromise = waitForMapKeyUpdate(entryInstance, 'map1');
            await objectsHelper.operationRequest(
              channelName,
              objectsHelper.mapSetRestOp({
                objectId: 'root',
                key: 'map1',
                value: { objectId: map1Id },
              }),
            );
            await keyUpdatedPromise;

            keyUpdatedPromise = waitForMapKeyUpdate(entryInstance.get('map1'), 'map2');
            await objectsHelper.operationRequest(
              channelName,
              objectsHelper.mapSetRestOp({
                objectId: map1Id,
                key: 'map2',
                value: { objectId: map2Id },
              }),
            );
            await keyUpdatedPromise;

            keyUpdatedPromise = waitForMapKeyUpdate(entryInstance.get('map1').get('map2'), 'map1BackRef');
            await objectsHelper.operationRequest(
              channelName,
              objectsHelper.mapSetRestOp({
                objectId: map2Id,
                key: 'map1BackRef',
                value: { objectId: map1Id },
              }),
            );
            await keyUpdatedPromise;

            // Test that compact() handles cyclic references correctly
            const compactEntry = entryInstance.compact();

            expect(compactEntry).to.exist;
            expect(compactEntry.map1).to.exist;
            expect(compactEntry.map1.foo).to.equal('bar', 'Check primitive value is preserved');
            expect(compactEntry.map1.map2).to.exist;
            expect(compactEntry.map1.map2.baz).to.equal(42, 'Check nested primitive value is preserved');
            expect(compactEntry.map1.map2.map1BackRef).to.exist;

            // The back reference should point to the same object reference
            expect(compactEntry.map1.map2.map1BackRef).to.equal(
              compactEntry.map1,
              'Check cyclic reference returns the same memoized result object',
            );
          },
        },

        {
          description: 'DefaultInstance.compactJson() returns JSON-encodable value for primitive values',
          action: async (ctx) => {
            const { entryInstance, entryPathObject, helper } = ctx;

            const keysUpdatedPromise = Promise.all(
              primitiveKeyData.map((x) => waitForMapKeyUpdate(entryInstance, x.key)),
            );
            await Promise.all(
              primitiveKeyData.map(async (keyData) => {
                let value;
                if (keyData.jsonData.bytes != null) {
                  helper.recordPrivateApi('call.BufferUtils.base64Decode');
                  value = BufferUtils.base64Decode(keyData.jsonData.bytes);
                } else if (keyData.jsonData.json != null) {
                  value = JSON.parse(keyData.jsonData.json);
                } else {
                  value = keyData.jsonData.number ?? keyData.jsonData.string ?? keyData.jsonData.boolean;
                }

                await entryPathObject.set(keyData.key, value);
              }),
            );
            await keysUpdatedPromise;

            primitiveKeyData.forEach((keyData) => {
              const instance = entryInstance.get(keyData.key);
              const compactJsonValue = instance.compactJson();
              // expect buffer values to be base64-encoded strings
              helper.recordPrivateApi('call.BufferUtils.isBuffer');
              helper.recordPrivateApi('call.BufferUtils.base64Encode');
              const expectedValue = BufferUtils.isBuffer(instance.value())
                ? BufferUtils.base64Encode(instance.value())
                : instance.value();

              expect(compactJsonValue).to.deep.equal(
                expectedValue,
                `Check DefaultInstance.compactJson() returns correct value for primitive "${keyData.key}"`,
              );
            });
          },
        },

        {
          description: 'DefaultInstance.compactJson() returns number for LiveCounter objects',
          action: async (ctx) => {
            const { entryInstance, entryPathObject } = ctx;

            const keyUpdatedPromise = waitForMapKeyUpdate(entryInstance, 'counter');
            await entryPathObject.set('counter', LiveCounter.create(42));
            await keyUpdatedPromise;

            const compactJsonValue = entryInstance.get('counter').compactJson();
            expect(compactJsonValue).to.equal(42, 'Check DefaultInstance.compactJson() returns number for LiveCounter');
          },
        },

        {
          description: 'DefaultInstance.compactJson() returns plain object for LiveMap with base64-encoded buffers',
          action: async (ctx) => {
            const { entryInstance, entryPathObject, helper } = ctx;

            // Create nested structure with different value types
            const keysUpdatedPromise = Promise.all([waitForMapKeyUpdate(entryInstance, 'nestedMapInstance')]);
            helper.recordPrivateApi('call.BufferUtils.utf8Encode');
            await entryPathObject.set(
              'nestedMapInstance',
              LiveMap.create({
                stringKey: 'stringValue',
                numberKey: 456,
                booleanKey: false,
                counterKey: LiveCounter.create(111),
                array: [1, 2, 3],
                obj: { nested: 'value' },
                buffer: BufferUtils.utf8Encode('value'),
              }),
            );
            await keysUpdatedPromise;

            const compactJsonValue = entryInstance.get('nestedMapInstance').compactJson();
            helper.recordPrivateApi('call.BufferUtils.utf8Encode');
            helper.recordPrivateApi('call.BufferUtils.base64Encode');
            const expected = {
              stringKey: 'stringValue',
              numberKey: 456,
              booleanKey: false,
              counterKey: 111,
              array: [1, 2, 3],
              obj: { nested: 'value' },
              buffer: BufferUtils.base64Encode(BufferUtils.utf8Encode('value')),
            };

            expect(compactJsonValue).to.deep.equal(expected, 'Check compact object has expected value');
          },
        },

        {
          description: 'DefaultInstance.compactJson() handles complex nested structures',
          action: async (ctx) => {
            const { entryInstance, entryPathObject } = ctx;

            const keyUpdatedPromise = waitForMapKeyUpdate(entryInstance, 'complex');
            await entryPathObject.set(
              'complex',
              LiveMap.create({
                level1: LiveMap.create({
                  level2: LiveMap.create({
                    counter: LiveCounter.create(100),
                    primitive: 'instance deep value',
                  }),
                  directCounter: LiveCounter.create(200),
                }),
                topLevelCounter: LiveCounter.create(300),
              }),
            );
            await keyUpdatedPromise;

            const compactJsonValue = entryInstance.get('complex').compactJson();
            const expected = {
              level1: {
                level2: {
                  counter: 100,
                  primitive: 'instance deep value',
                },
                directCounter: 200,
              },
              topLevelCounter: 300,
            };

            expect(compactJsonValue).to.deep.equal(expected, 'Check complex nested structure is compacted correctly');
          },
        },

        {
          description: 'DefaultInstance.compactJson() and PathObject.compactJson() return equivalent results',
          action: async (ctx) => {
            const { entryInstance, entryPathObject, helper } = ctx;

            const keyUpdatedPromise = waitForMapKeyUpdate(entryInstance, 'comparison');
            helper.recordPrivateApi('call.BufferUtils.utf8Encode');
            await entryPathObject.set(
              'comparison',
              LiveMap.create({
                counter: LiveCounter.create(50),
                nested: LiveMap.create({
                  value: 'test',
                  innerCounter: LiveCounter.create(25),
                }),
                primitive: 'comparison test',
                buffer: BufferUtils.utf8Encode('value'),
              }),
            );
            await keyUpdatedPromise;

            const pathCompactJson = entryPathObject.get('comparison').compactJson();
            const instanceCompactJson = entryInstance.get('comparison').compactJson();

            expect(pathCompactJson).to.deep.equal(
              instanceCompactJson,
              'Check PathObject.compactJson() and DefaultInstance.compactJson() return equivalent results',
            );
          },
        },

        {
          description: 'DefaultInstance.compactJson() handles cyclic references with objectId',
          action: async (ctx) => {
            const { objectsHelper, channelName, entryInstance } = ctx;

            // Create a structure with cyclic references using REST API (realtime does not allow referencing objects by id):
            // root -> map1 -> map2 -> map1BackRef = { objectId: map1Id }

            const { objectId: map1Id } = await objectsHelper.operationRequest(
              channelName,
              objectsHelper.mapCreateRestOp({ data: { foo: { string: 'bar' } } }),
            );
            const { objectId: map2Id } = await objectsHelper.operationRequest(
              channelName,
              objectsHelper.mapCreateRestOp({ data: { baz: { number: 42 } } }),
            );

            // Set up the cyclic references
            let keyUpdatedPromise = waitForMapKeyUpdate(entryInstance, 'map1Instance');
            await objectsHelper.operationRequest(
              channelName,
              objectsHelper.mapSetRestOp({
                objectId: 'root',
                key: 'map1Instance',
                value: { objectId: map1Id },
              }),
            );
            await keyUpdatedPromise;

            keyUpdatedPromise = waitForMapKeyUpdate(entryInstance.get('map1Instance'), 'map2Instance');
            await objectsHelper.operationRequest(
              channelName,
              objectsHelper.mapSetRestOp({
                objectId: map1Id,
                key: 'map2Instance',
                value: { objectId: map2Id },
              }),
            );
            await keyUpdatedPromise;

            keyUpdatedPromise = waitForMapKeyUpdate(
              entryInstance.get('map1Instance').get('map2Instance'),
              'map1BackRefInstance',
            );
            await objectsHelper.operationRequest(
              channelName,
              objectsHelper.mapSetRestOp({
                objectId: map2Id,
                key: 'map1BackRefInstance',
                value: { objectId: map1Id },
              }),
            );
            await keyUpdatedPromise;

            // Test that compactJson() handles cyclic references with objectId structure
            const compactJsonEntry = entryInstance.compactJson();

            expect(compactJsonEntry).to.exist;
            expect(compactJsonEntry.map1Instance).to.exist;
            expect(compactJsonEntry.map1Instance.foo).to.equal('bar', 'Check primitive value is preserved');
            expect(compactJsonEntry.map1Instance.map2Instance).to.exist;
            expect(compactJsonEntry.map1Instance.map2Instance.baz).to.equal(
              42,
              'Check nested primitive value is preserved',
            );
            expect(compactJsonEntry.map1Instance.map2Instance.map1BackRefInstance).to.exist;

            // The back reference should be { objectId: string } instead of in-memory pointer
            expect(compactJsonEntry.map1Instance.map2Instance.map1BackRefInstance).to.deep.equal(
              { objectId: map1Id },
              'Check cyclic reference returns objectId structure for JSON serialization',
            );

            // Verify the result can be JSON stringified (no circular reference error)
            expect(() => JSON.stringify(compactJsonEntry)).to.not.throw();
          },
        },

        {
          description: 'DefaultInstance.batch() passes RootBatchContext to its batch function',
          action: async (ctx) => {
            const { entryInstance } = ctx;

            await entryInstance.batch((ctx) => {
              expect(ctx, 'Check batch context exists').to.exist;
              expectInstanceOf(ctx, 'RootBatchContext', 'Check batch context is of RootBatchContext type');
            });
          },
        },
      ];

      /** @nospec */
      forScenarios(
        this,
        [
          ...objectSyncSequenceScenarios,
          ...applyOperationsScenarios,
          ...applyOperationsDuringSyncScenarios,
          ...writeApiScenarios,
          ...pathObjectScenarios,
          ...instanceScenarios,
        ],
        async function (helper, scenario, clientOptions, channelName) {
          const objectsHelper = new LiveObjectsHelper(helper);
          const client = RealtimeWithLiveObjects(helper, clientOptions);
          const restClient = RestWithLiveObjects(helper, clientOptions);

          await helper.monitorConnectionThenCloseAndFinishAsync(async () => {
            const channel = client.channels.get(channelName, channelOptionsWithObjectModes());
            const restChannel = restClient.channels.get(channelName);
            const realtimeObject = channel.object;

            await channel.attach();
            const entryPathObject = await realtimeObject.get();
            const entryInstance = entryPathObject.instance();

            await scenario.action({
              realtimeObject,
              entryPathObject,
              entryInstance,
              objectsHelper,
              channelName,
              channel,
              restChannel,
              client,
              helper,
              clientOptions,
            });
          }, client);
        },
      );

      const subscriptionCallbacksScenarios = [
        {
          allTransportsAndProtocols: true,
          description: 'can subscribe to the incoming COUNTER_INC operation on a LiveCounter',
          action: async (ctx) => {
            const { objectsHelper, channelName, sampleCounterKey, sampleCounterObjectId, entryInstance } = ctx;

            const counter = entryInstance.get(sampleCounterKey);
            const subscriptionPromise = new Promise((resolve, reject) =>
              counter.subscribe((event) => {
                try {
                  expect(event?.message?.operation).to.deep.include(
                    {
                      action: 'counter.inc',
                      objectId: counter.id,
                      counterInc: { number: 1 },
                    },
                    'Check counter subscription callback is called with an expected event message for COUNTER_INC operation',
                  );
                  resolve();
                } catch (error) {
                  reject(error);
                }
              }),
            );

            await objectsHelper.operationRequest(
              channelName,
              objectsHelper.counterIncRestOp({
                objectId: sampleCounterObjectId,
                number: 1,
              }),
            );

            await subscriptionPromise;
          },
        },

        {
          allTransportsAndProtocols: true,
          description: 'can subscribe to multiple incoming operations on a LiveCounter',
          action: async (ctx) => {
            const { objectsHelper, channelName, sampleCounterKey, sampleCounterObjectId, entryInstance } = ctx;

            const counter = entryInstance.get(sampleCounterKey);
            const expectedCounterIncrements = [100, -100, Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER];
            let currentUpdateIndex = 0;

            const subscriptionPromise = new Promise((resolve, reject) =>
              counter.subscribe((event) => {
                try {
                  const expectedInc = expectedCounterIncrements[currentUpdateIndex];
                  expect(event?.message?.operation).to.deep.include(
                    {
                      action: 'counter.inc',
                      objectId: counter.id,
                      counterInc: { number: expectedInc },
                    },
                    `Check counter subscription callback is called with an expected event message operation for ${currentUpdateIndex + 1} times`,
                  );

                  if (currentUpdateIndex === expectedCounterIncrements.length - 1) {
                    resolve();
                  }

                  currentUpdateIndex++;
                } catch (error) {
                  reject(error);
                }
              }),
            );

            for (const increment of expectedCounterIncrements) {
              await objectsHelper.operationRequest(
                channelName,
                objectsHelper.counterIncRestOp({
                  objectId: sampleCounterObjectId,
                  number: increment,
                }),
              );
            }

            await subscriptionPromise;
          },
        },

        {
          allTransportsAndProtocols: true,
          description: 'can subscribe to the incoming MAP_SET operation on a LiveMap',
          action: async (ctx) => {
            const { objectsHelper, channelName, sampleMapKey, sampleMapObjectId, entryInstance } = ctx;

            const map = entryInstance.get(sampleMapKey);
            const subscriptionPromise = new Promise((resolve, reject) =>
              map.subscribe((event) => {
                try {
                  expectDeepSubset(
                    event?.message?.operation,
                    {
                      action: 'map.set',
                      objectId: map.id,
                      mapSet: { key: 'stringKey', value: { string: 'stringValue' } },
                    },
                    'Check map subscription callback is called with an expected event message for MAP_SET operation',
                  );
                  resolve();
                } catch (error) {
                  reject(error);
                }
              }),
            );

            await objectsHelper.operationRequest(
              channelName,
              objectsHelper.mapSetRestOp({
                objectId: sampleMapObjectId,
                key: 'stringKey',
                value: { string: 'stringValue' },
              }),
            );

            await subscriptionPromise;
          },
        },

        {
          allTransportsAndProtocols: true,
          description: 'can subscribe to the incoming MAP_REMOVE operation on a LiveMap',
          action: async (ctx) => {
            const { objectsHelper, channelName, sampleMapKey, sampleMapObjectId, entryInstance } = ctx;

            const map = entryInstance.get(sampleMapKey);
            const subscriptionPromise = new Promise((resolve, reject) =>
              map.subscribe((event) => {
                try {
                  expect(event?.message?.operation).to.deep.include(
                    { action: 'map.remove', objectId: map.id, mapRemove: { key: 'stringKey' } },
                    'Check map subscription callback is called with an expected event message for MAP_REMOVE operation',
                  );
                  resolve();
                } catch (error) {
                  reject(error);
                }
              }),
            );

            await objectsHelper.operationRequest(
              channelName,
              objectsHelper.mapRemoveRestOp({
                objectId: sampleMapObjectId,
                key: 'stringKey',
              }),
            );

            await subscriptionPromise;
          },
        },

        {
          description: 'can subscribe to the incoming MAP_CLEAR operation on a LiveMap',
          action: async (ctx) => {
            const { objectsHelper, channel, entryInstance } = ctx;

            const subscriptionPromise = new Promise((resolve, reject) =>
              entryInstance.subscribe((event) => {
                try {
                  expect(event?.message?.operation).to.deep.include(
                    { action: 'map.clear', objectId: entryInstance.id, mapClear: {} },
                    'Check root subscription callback is called with an expected event message for MAP_CLEAR operation',
                  );
                  resolve();
                } catch (error) {
                  reject(error);
                }
              }),
            );

            await objectsHelper.sendMapClearOnChannel(channel, 'root');

            await subscriptionPromise;
          },
        },

        {
          allTransportsAndProtocols: true,
          description: 'can subscribe to multiple incoming operations on a LiveMap',
          action: async (ctx) => {
            const { objectsHelper, channelName, sampleMapKey, sampleMapObjectId, entryInstance } = ctx;

            const map = entryInstance.get(sampleMapKey);
            const expectedMapUpdates = [
              { action: 'map.set', mapSet: { key: 'foo', value: { string: '1' } } },
              { action: 'map.set', mapSet: { key: 'bar', value: { string: '2' } } },
              { action: 'map.remove', mapRemove: { key: 'foo' } },
              { action: 'map.set', mapSet: { key: 'baz', value: { string: '3' } } },
              { action: 'map.remove', mapRemove: { key: 'bar' } },
            ];
            let currentUpdateIndex = 0;

            const subscriptionPromise = new Promise((resolve, reject) =>
              map.subscribe(({ message }) => {
                try {
                  expectDeepSubset(
                    message?.operation,
                    expectedMapUpdates[currentUpdateIndex],
                    `Check map subscription callback is called with an expected event message operation for ${currentUpdateIndex + 1} times`,
                  );

                  if (currentUpdateIndex === expectedMapUpdates.length - 1) {
                    resolve();
                  }

                  currentUpdateIndex++;
                } catch (error) {
                  reject(error);
                }
              }),
            );

            await objectsHelper.operationRequest(
              channelName,
              objectsHelper.mapSetRestOp({
                objectId: sampleMapObjectId,
                key: 'foo',
                value: { string: '1' },
              }),
            );

            await objectsHelper.operationRequest(
              channelName,
              objectsHelper.mapSetRestOp({
                objectId: sampleMapObjectId,
                key: 'bar',
                value: { string: '2' },
              }),
            );

            await objectsHelper.operationRequest(
              channelName,
              objectsHelper.mapRemoveRestOp({
                objectId: sampleMapObjectId,
                key: 'foo',
              }),
            );

            await objectsHelper.operationRequest(
              channelName,
              objectsHelper.mapSetRestOp({
                objectId: sampleMapObjectId,
                key: 'baz',
                value: { string: '3' },
              }),
            );

            await objectsHelper.operationRequest(
              channelName,
              objectsHelper.mapRemoveRestOp({
                objectId: sampleMapObjectId,
                key: 'bar',
              }),
            );

            await subscriptionPromise;
          },
        },

        {
          description: 'subscription event message contains the metadata of the update',
          action: async (ctx) => {
            const {
              channelName,
              channel,
              sampleMapKey,
              sampleCounterKey,
              helper,
              objectsHelper,
              entryPathObject,
              entryInstance,
            } = ctx;
            const publishClientId = 'publish-clientId';
            const publishClient = RealtimeWithLiveObjects(helper, { clientId: publishClientId });

            // get the connection ID from the publish client once connected
            let publishConnectionId;

            const createCheckMessageMetadataPromise = (subscribeFn, msg) => {
              return new Promise((resolve, reject) =>
                subscribeFn((event) => {
                  try {
                    expect(event.message, msg + 'object message exists').to.exist;
                    expect(event.message.id, msg + 'message id exists').to.exist;
                    expect(event.message.clientId).to.equal(publishClientId, msg + 'clientId matches expected');
                    expect(event.message.connectionId).to.equal(
                      publishConnectionId,
                      msg + 'connectionId matches expected',
                    );
                    expect(event.message.timestamp, msg + 'timestamp exists').to.exist;
                    expect(event.message.channel).to.equal(channelName, msg + 'channel name matches expected');
                    expect(event.message.serial, msg + 'serial exists').to.exist;
                    expect(event.message.serialTimestamp, msg + 'serialTimestamp exists').to.exist;
                    expect(event.message.siteCode, msg + 'siteCode exists').to.exist;

                    resolve();
                  } catch (error) {
                    reject(error);
                  }
                }),
              );
            };

            // check message metadata is surfaced for object operations
            const checkPromises = Promise.all([
              // path object
              createCheckMessageMetadataPromise(
                (cb) => entryPathObject.get(sampleCounterKey).subscribe(cb),
                'Check event message metadata for COUNTER_INC PathObject subscriptions: ',
              ),
              createCheckMessageMetadataPromise(
                (cb) =>
                  entryPathObject.get(sampleMapKey).subscribe((event) => {
                    if (event.message.operation.action === 'map.set') {
                      cb(event);
                    }
                  }),
                'Check event message metadata for MAP_SET PathObject subscriptions: ',
              ),
              createCheckMessageMetadataPromise(
                (cb) =>
                  entryPathObject.get(sampleMapKey).subscribe((event) => {
                    if (event.message.operation.action === 'map.remove') {
                      cb(event);
                    }
                  }),
                'Check event message metadata for MAP_REMOVE PathObject subscriptions: ',
              ),
              createCheckMessageMetadataPromise(
                (cb) =>
                  entryPathObject.subscribe((event) => {
                    if (event.message.operation.action === 'map.clear') {
                      cb(event);
                    }
                  }),
                'Check event message metadata for MAP_CLEAR PathObject subscriptions: ',
              ),

              // instance
              createCheckMessageMetadataPromise(
                (cb) => entryInstance.get(sampleCounterKey).subscribe(cb),
                'Check event message metadata for COUNTER_INC DefaultInstance subscriptions: ',
              ),
              createCheckMessageMetadataPromise(
                (cb) =>
                  entryInstance.get(sampleMapKey).subscribe((event) => {
                    if (event.message.operation.action === 'map.set') {
                      cb(event);
                    }
                  }),
                'Check event message metadata for MAP_SET DefaultInstance subscriptions: ',
              ),
              createCheckMessageMetadataPromise(
                (cb) =>
                  entryInstance.get(sampleMapKey).subscribe((event) => {
                    if (event.message.operation.action === 'map.remove') {
                      cb(event);
                    }
                  }),
                'Check event message metadata for MAP_REMOVE DefaultInstance subscriptions: ',
              ),
              createCheckMessageMetadataPromise(
                (cb) =>
                  entryInstance.subscribe((event) => {
                    if (event.message.operation.action === 'map.clear') {
                      cb(event);
                    }
                  }),
                'Check event message metadata for MAP_CLEAR DefaultInstance subscriptions: ',
              ),
            ]);

            await helper.monitorConnectionThenCloseAndFinishAsync(async () => {
              const publishChannel = publishClient.channels.get(channelName, channelOptionsWithObjectModes());
              await publishChannel.attach();
              const publishRoot = await publishChannel.object.get();

              // capture the connection ID once the client is connected
              publishConnectionId = publishClient.connection.id;

              await publishRoot.get(sampleCounterKey).increment(1);
              await publishRoot.get(sampleMapKey).set('foo', 'bar');
              await publishRoot.get(sampleMapKey).remove('foo');

              await objectsHelper.sendMapClearOnChannel(publishChannel, 'root');
            }, publishClient);

            await checkPromises;
          },
        },

        {
          description: 'can unsubscribe from LiveCounter updates via returned "unsubscribe" callback',
          action: async (ctx) => {
            const { objectsHelper, channelName, sampleCounterKey, sampleCounterObjectId, entryInstance } = ctx;

            const counter = entryInstance.get(sampleCounterKey);
            let callbackCalled = 0;
            const subscriptionPromise = new Promise((resolve) => {
              const { unsubscribe } = counter.subscribe(() => {
                callbackCalled++;
                // unsubscribe from future updates after the first call
                unsubscribe();
                resolve();
              });
            });

            const increments = 3;
            for (let i = 0; i < increments; i++) {
              const counterUpdatedPromise = waitForCounterUpdate(counter);
              await objectsHelper.operationRequest(
                channelName,
                objectsHelper.counterIncRestOp({
                  objectId: sampleCounterObjectId,
                  number: 1,
                }),
              );
              await counterUpdatedPromise;
            }

            await subscriptionPromise;

            expect(counter.value()).to.equal(3, 'Check counter has final expected value after all increments');
            expect(callbackCalled).to.equal(1, 'Check subscription callback was only called once');
          },
        },

        {
          skip: true, // TODO: replace with instance/pathobject .unsubscribe() call
          description: 'can unsubscribe from LiveCounter updates via LiveCounter.unsubscribe() call',
          action: async (ctx) => {
            const { objectsHelper, channelName, sampleCounterKey, sampleCounterObjectId, entryInstance } = ctx;

            const counter = entryInstance.get(sampleCounterKey);
            let callbackCalled = 0;
            const subscriptionPromise = new Promise((resolve) => {
              const listener = () => {
                callbackCalled++;
                // unsubscribe from future updates after the first call
                counter.unsubscribe(listener);
                resolve();
              };

              counter.subscribe(listener);
            });

            const increments = 3;
            for (let i = 0; i < increments; i++) {
              const counterUpdatedPromise = waitForCounterUpdate(counter);
              await objectsHelper.operationRequest(
                channelName,
                objectsHelper.counterIncRestOp({
                  objectId: sampleCounterObjectId,
                  number: 1,
                }),
              );
              await counterUpdatedPromise;
            }

            await subscriptionPromise;

            expect(counter.value()).to.equal(3, 'Check counter has final expected value after all increments');
            expect(callbackCalled).to.equal(1, 'Check subscription callback was only called once');
          },
        },

        {
          description: 'can unsubscribe from LiveMap updates via returned "unsubscribe" callback',
          action: async (ctx) => {
            const { objectsHelper, channelName, sampleMapKey, sampleMapObjectId, entryInstance } = ctx;

            const map = entryInstance.get(sampleMapKey);
            let callbackCalled = 0;
            const subscriptionPromise = new Promise((resolve) => {
              const { unsubscribe } = map.subscribe(() => {
                callbackCalled++;
                // unsubscribe from future updates after the first call
                unsubscribe();
                resolve();
              });
            });

            const mapSets = 3;
            for (let i = 0; i < mapSets; i++) {
              const mapUpdatedPromise = waitForMapKeyUpdate(map, `foo-${i}`);
              await objectsHelper.operationRequest(
                channelName,
                objectsHelper.mapSetRestOp({
                  objectId: sampleMapObjectId,
                  key: `foo-${i}`,
                  value: { string: 'exists' },
                }),
              );
              await mapUpdatedPromise;
            }

            await subscriptionPromise;

            for (let i = 0; i < mapSets; i++) {
              expect(map.get(`foo-${i}`).value()).to.equal(
                'exists',
                `Check map has value for key "foo-${i}" after all map sets`,
              );
            }
            expect(callbackCalled).to.equal(1, 'Check subscription callback was only called once');
          },
        },

        {
          skip: true, // TODO: replace with instance/pathobject .unsubscribe() call
          description: 'can unsubscribe from LiveMap updates via LiveMap.unsubscribe() call',
          action: async (ctx) => {
            const { objectsHelper, channelName, sampleMapKey, sampleMapObjectId, entryInstance } = ctx;

            const map = entryInstance.get(sampleMapKey);
            let callbackCalled = 0;
            const subscriptionPromise = new Promise((resolve) => {
              const listener = () => {
                callbackCalled++;
                // unsubscribe from future updates after the first call
                map.unsubscribe(listener);
                resolve();
              };

              map.subscribe(listener);
            });

            const mapSets = 3;
            for (let i = 0; i < mapSets; i++) {
              const mapUpdatedPromise = waitForMapKeyUpdate(map, `foo-${i}`);
              await objectsHelper.operationRequest(
                channelName,
                objectsHelper.mapSetRestOp({
                  objectId: sampleMapObjectId,
                  key: `foo-${i}`,
                  value: { string: 'exists' },
                }),
              );
              await mapUpdatedPromise;
            }

            await subscriptionPromise;

            for (let i = 0; i < mapSets; i++) {
              expect(map.get(`foo-${i}`)).to.equal(
                'exists',
                `Check map has value for key "foo-${i}" after all map sets`,
              );
            }
            expect(callbackCalled).to.equal(1, 'Check subscription callback was only called once');
          },
        },
      ];

      /** @nospec */
      forScenarios(this, subscriptionCallbacksScenarios, async function (helper, scenario, clientOptions, channelName) {
        const objectsHelper = new LiveObjectsHelper(helper);
        const client = RealtimeWithLiveObjects(helper, clientOptions);

        await helper.monitorConnectionThenCloseAndFinishAsync(async () => {
          const channel = client.channels.get(channelName, channelOptionsWithObjectModes());

          await channel.attach();
          const entryPathObject = await channel.object.get();
          const entryInstance = entryPathObject.instance();

          const sampleMapKey = 'sampleMap';
          const sampleCounterKey = 'sampleCounter';

          const objectsCreatedPromise = Promise.all([
            waitForMapKeyUpdate(entryInstance, sampleMapKey),
            waitForMapKeyUpdate(entryInstance, sampleCounterKey),
          ]);
          // prepare map and counter objects for use by the scenario
          const { objectId: sampleMapObjectId } = await objectsHelper.createAndSetOnMap(channelName, {
            mapObjectId: 'root',
            key: sampleMapKey,
            createOp: objectsHelper.mapCreateRestOp(),
          });
          const { objectId: sampleCounterObjectId } = await objectsHelper.createAndSetOnMap(channelName, {
            mapObjectId: 'root',
            key: sampleCounterKey,
            createOp: objectsHelper.counterCreateRestOp(),
          });
          await objectsCreatedPromise;

          await scenario.action({
            entryPathObject,
            entryInstance,
            objectsHelper,
            channelName,
            channel,
            sampleMapKey,
            sampleMapObjectId,
            sampleCounterKey,
            sampleCounterObjectId,
            helper,
          });
        }, client);
      });

      it('gcGracePeriod is set from connectionDetails.objectsGCGracePeriod', async function () {
        const helper = this.test.helper;
        const client = RealtimeWithLiveObjects(helper);

        await helper.monitorConnectionThenCloseAndFinishAsync(async () => {
          await client.connection.once('connected');

          const channel = client.channels.get('channel', channelOptionsWithObjectModes());
          const realtimeObject = channel.object;
          const connectionManager = client.connection.connectionManager;
          const connectionDetails = connectionManager.connectionDetails;

          // gcGracePeriod should be set after the initial connection
          helper.recordPrivateApi('read.RealtimeObject.gcGracePeriod');
          expect(
            realtimeObject.gcGracePeriod,
            'Check gcGracePeriod is set after initial connection from connectionDetails.objectsGCGracePeriod',
          ).to.exist;
          helper.recordPrivateApi('read.RealtimeObject.gcGracePeriod');
          expect(realtimeObject.gcGracePeriod).to.equal(
            connectionDetails.objectsGCGracePeriod,
            'Check gcGracePeriod is set to equal connectionDetails.objectsGCGracePeriod',
          );

          const connectionDetailsPromise = connectionManager.once('connectiondetails');

          helper.recordPrivateApi('call.connectionManager.activeProtocol.getTransport');
          helper.recordPrivateApi('call.transport.onProtocolMessage');
          helper.recordPrivateApi('call.makeProtocolMessageFromDeserialized');
          connectionManager.activeProtocol.getTransport().onProtocolMessage(
            createPM({
              action: 4, // CONNECTED
              connectionDetails: {
                ...connectionDetails,
                objectsGCGracePeriod: 999,
              },
            }),
          );

          helper.recordPrivateApi('listen.connectionManager.connectiondetails');
          await connectionDetailsPromise;
          // wait for next tick to ensure the connectionDetails event was processed by LiveObjects plugin
          await new Promise((res) => nextTick(res));

          helper.recordPrivateApi('read.RealtimeObject.gcGracePeriod');
          expect(realtimeObject.gcGracePeriod).to.equal(999, 'Check gcGracePeriod is updated on new CONNECTED event');
        }, client);
      });

      it('gcGracePeriod has a default value if connectionDetails.objectsGCGracePeriod is missing', async function () {
        const helper = this.test.helper;
        const client = RealtimeWithLiveObjects(helper);

        await helper.monitorConnectionThenCloseAndFinishAsync(async () => {
          await client.connection.once('connected');

          const channel = client.channels.get('channel', channelOptionsWithObjectModes());
          const realtimeObject = channel.object;
          const connectionManager = client.connection.connectionManager;
          const connectionDetails = connectionManager.connectionDetails;

          helper.recordPrivateApi('read.RealtimeObject._DEFAULTS.gcGracePeriod');
          helper.recordPrivateApi('write.RealtimeObject.gcGracePeriod');
          // set gcGracePeriod to a value different from the default
          realtimeObject.gcGracePeriod = LiveObjectsPlugin.RealtimeObject._DEFAULTS.gcGracePeriod + 1;

          const connectionDetailsPromise = connectionManager.once('connectiondetails');

          // send a CONNECTED event without objectsGCGracePeriod, it should use the default value instead
          helper.recordPrivateApi('call.connectionManager.activeProtocol.getTransport');
          helper.recordPrivateApi('call.transport.onProtocolMessage');
          helper.recordPrivateApi('call.makeProtocolMessageFromDeserialized');
          connectionManager.activeProtocol.getTransport().onProtocolMessage(
            createPM({
              action: 4, // CONNECTED
              connectionDetails,
            }),
          );

          helper.recordPrivateApi('listen.connectionManager.connectiondetails');
          await connectionDetailsPromise;
          // wait for next tick to ensure the connectionDetails event was processed by LiveObjects plugin
          await new Promise((res) => nextTick(res));

          helper.recordPrivateApi('read.RealtimeObject._DEFAULTS.gcGracePeriod');
          helper.recordPrivateApi('read.RealtimeObject.gcGracePeriod');
          expect(realtimeObject.gcGracePeriod).to.equal(
            LiveObjectsPlugin.RealtimeObject._DEFAULTS.gcGracePeriod,
            'Check gcGracePeriod is set to a default value if connectionDetails.objectsGCGracePeriod is missing',
          );
        }, client);
      });

      const tombstonesGCScenarios = [
        // for the next tests we need to access the private API of LiveObjects plugin in order to verify that tombstoned entities were indeed deleted after the GC grace period.
        // public API hides that kind of information from the user and returns undefined for tombstoned entities even if realtime client still keeps a reference to them.
        {
          description: 'tombstoned object is removed from the pool after the GC grace period',
          action: async (ctx) => {
            const { objectsHelper, channelName, channel, realtimeObject, helper, waitForGCCycles, client } = ctx;

            const counterCreatedPromise = waitForObjectOperation(
              helper,
              client,
              LiveObjectsHelper.ACTIONS.COUNTER_CREATE,
            );
            // send a CREATE op, this adds an object to the pool
            const { objectId } = await objectsHelper.operationRequest(
              channelName,
              objectsHelper.counterCreateRestOp({ number: 1 }),
            );
            await counterCreatedPromise;

            helper.recordPrivateApi('call.RealtimeObject._objectsPool.get');
            expect(realtimeObject._objectsPool.get(objectId), 'Check object exists in the pool after creation').to
              .exist;

            // inject OBJECT_DELETE for the object. this should tombstone the object and make it inaccessible to the end user, but still keep it in memory in the local pool
            await objectsHelper.processObjectOperationMessageOnChannel({
              channel,
              serial: lexicoTimeserial('aaa', 0, 0),
              siteCode: 'aaa',
              state: [objectsHelper.objectDeleteOp({ objectId })],
            });

            helper.recordPrivateApi('call.RealtimeObject._objectsPool.get');
            expect(
              realtimeObject._objectsPool.get(objectId),
              'Check object exists in the pool immediately after OBJECT_DELETE',
            ).to.exist;
            helper.recordPrivateApi('call.RealtimeObject._objectsPool.get');
            helper.recordPrivateApi('call.LiveObject.isTombstoned');
            expect(realtimeObject._objectsPool.get(objectId).isTombstoned()).to.equal(
              true,
              `Check object's "tombstone" flag is set to "true" after OBJECT_DELETE`,
            );

            // we expect 2 cycles to guarantee that grace period has expired, which will always be true based on the test config used
            await waitForGCCycles(2);

            // object should be removed from the local pool entirely now, as the GC grace period has passed
            helper.recordPrivateApi('call.RealtimeObject._objectsPool.get');
            expect(
              realtimeObject._objectsPool.get(objectId),
              'Check object exists does not exist in the pool after the GC grace period expiration',
            ).to.not.exist;
          },
        },

        {
          allTransportsAndProtocols: true,
          description: 'tombstoned map entry is removed from the LiveMap after the GC grace period',
          action: async (ctx) => {
            const { entryInstance, objectsHelper, channelName, helper, waitForGCCycles } = ctx;

            const keyUpdatedPromise = waitForMapKeyUpdate(entryInstance, 'foo');
            // set a key on a root
            await objectsHelper.operationRequest(
              channelName,
              objectsHelper.mapSetRestOp({ objectId: 'root', key: 'foo', value: { string: 'bar' } }),
            );
            await keyUpdatedPromise;

            expect(entryInstance.get('foo').value()).to.equal('bar', 'Check key "foo" exists on root after MAP_SET');

            const keyUpdatedPromise2 = waitForMapKeyUpdate(entryInstance, 'foo');
            // remove the key from the root. this should tombstone the map entry and make it inaccessible to the end user, but still keep it in memory in the underlying map
            await objectsHelper.operationRequest(
              channelName,
              objectsHelper.mapRemoveRestOp({ objectId: 'root', key: 'foo' }),
            );
            await keyUpdatedPromise2;

            expect(entryInstance.get('foo'), 'Check key "foo" is inaccessible via public API on root after MAP_REMOVE')
              .to.not.exist;
            helper.recordPrivateApi('read.DefaultInstance._value');
            helper.recordPrivateApi('read.LiveMap._dataRef.data');
            expect(
              entryInstance._value._dataRef.data.get('foo'),
              'Check map entry for "foo" exists on root in the underlying data immediately after MAP_REMOVE',
            ).to.exist;
            helper.recordPrivateApi('read.DefaultInstance._value');
            helper.recordPrivateApi('read.LiveMap._dataRef.data');
            expect(
              entryInstance._value._dataRef.data.get('foo').tombstone,
              'Check map entry for "foo" on root has "tombstone" flag set to "true" after MAP_REMOVE',
            ).to.exist;

            // we expect 2 cycles to guarantee that grace period has expired, which will always be true based on the test config used
            await waitForGCCycles(2);

            // the entry should be removed from the underlying map now
            helper.recordPrivateApi('read.DefaultInstance._value');
            helper.recordPrivateApi('read.LiveMap._dataRef.data');
            expect(
              entryInstance._value._dataRef.data.get('foo'),
              'Check map entry for "foo" does not exist on root in the underlying data after the GC grace period expiration',
            ).to.not.exist;
          },
        },
      ];

      /** @nospec */
      forScenarios(this, tombstonesGCScenarios, async function (helper, scenario, clientOptions, channelName) {
        try {
          helper.recordPrivateApi('write.RealtimeObject._DEFAULTS.gcInterval');
          LiveObjectsPlugin.RealtimeObject._DEFAULTS.gcInterval = 500;

          const objectsHelper = new LiveObjectsHelper(helper);
          const client = RealtimeWithLiveObjects(helper, clientOptions);

          await helper.monitorConnectionThenCloseAndFinishAsync(async () => {
            const channel = client.channels.get(channelName, channelOptionsWithObjectModes());
            const realtimeObject = channel.object;

            await channel.attach();
            const entryPathObject = await channel.object.get();
            const entryInstance = entryPathObject.instance();

            helper.recordPrivateApi('read.RealtimeObject.gcGracePeriod');
            const gcGracePeriodOriginal = realtimeObject.gcGracePeriod;
            helper.recordPrivateApi('write.RealtimeObject.gcGracePeriod');
            realtimeObject.gcGracePeriod = 250;

            // helper function to spy on the GC interval callback and wait for a specific number of GC cycles.
            // returns a promise which will resolve when required number of cycles have happened.
            const waitForGCCycles = (cycles) => {
              const onGCIntervalOriginal = realtimeObject._objectsPool._onGCInterval;
              let gcCalledTimes = 0;
              return new Promise((resolve) => {
                helper.recordPrivateApi('replace.RealtimeObject._objectsPool._onGCInterval');
                realtimeObject._objectsPool._onGCInterval = function () {
                  helper.recordPrivateApi('call.RealtimeObject._objectsPool._onGCInterval');
                  onGCIntervalOriginal.call(this);

                  gcCalledTimes++;
                  if (gcCalledTimes >= cycles) {
                    resolve();
                    realtimeObject._objectsPool._onGCInterval = onGCIntervalOriginal;
                  }
                };
              });
            };

            await scenario.action({
              client,
              entryPathObject,
              entryInstance,
              objectsHelper,
              channelName,
              channel,
              realtimeObject,
              helper,
              waitForGCCycles,
            });

            helper.recordPrivateApi('write.RealtimeObject.gcGracePeriod');
            realtimeObject.gcGracePeriod = gcGracePeriodOriginal;
          }, client);
        } finally {
          helper.recordPrivateApi('write.RealtimeObject._DEFAULTS.gcInterval');
          LiveObjectsPlugin.RealtimeObject._DEFAULTS.gcInterval = gcIntervalOriginal;
        }
      });

      const checkAccessApiErrors = async ({ entryPathObject, entryInstance, errorMsg }) => {
        // PathObject
        expect(() => entryPathObject.path()).not.to.throw(); // this should not throw
        expect(() => entryPathObject.compact()).to.throw(errorMsg);
        expect(() => entryPathObject.compactJson()).to.throw(errorMsg);
        expect(() => entryPathObject.get('key')).not.to.throw(); // this should not throw
        expect(() => entryPathObject.at('path')).not.to.throw(); // this should not throw
        expect(() => entryPathObject.value()).to.throw(errorMsg);
        expect(() => entryPathObject.instance()).to.throw(errorMsg);
        expect(() => [...entryPathObject.entries()]).to.throw(errorMsg);
        expect(() => [...entryPathObject.keys()]).to.throw(errorMsg);
        expect(() => [...entryPathObject.values()]).to.throw(errorMsg);
        expect(() => entryPathObject.size()).to.throw(errorMsg);
        expect(() => entryPathObject.subscribe()).to.throw(errorMsg);
        expect(() => [...entryPathObject.subscribeIterator()]).to.throw(errorMsg);

        // Instance
        expect(() => entryInstance.id).not.to.throw(); // this should not throw
        expect(() => entryInstance.compact()).to.throw(errorMsg);
        expect(() => entryInstance.compactJson()).to.throw(errorMsg);
        expect(() => entryInstance.get()).to.throw(errorMsg);
        expect(() => entryInstance.value()).to.throw(errorMsg);
        expect(() => [...entryInstance.entries()]).to.throw(errorMsg);
        expect(() => [...entryInstance.keys()]).to.throw(errorMsg);
        expect(() => [...entryInstance.values()]).to.throw(errorMsg);
        expect(() => entryInstance.size()).to.throw(errorMsg);
        expect(() => entryInstance.subscribe()).to.throw(errorMsg);
        expect(() => [...entryInstance.subscribeIterator()]).to.throw(errorMsg);
      };

      const checkWriteApiErrors = async ({ entryPathObject, entryInstance, errorMsg }) => {
        // PathObject
        await expectToThrowAsync(async () => entryPathObject.set(), errorMsg);
        await expectToThrowAsync(async () => entryPathObject.remove(), errorMsg);
        await expectToThrowAsync(async () => entryPathObject.increment(), errorMsg);
        await expectToThrowAsync(async () => entryPathObject.decrement(), errorMsg);
        await expectToThrowAsync(async () => entryPathObject.batch(), errorMsg);

        // Instance
        await expectToThrowAsync(async () => entryInstance.set(), errorMsg);
        await expectToThrowAsync(async () => entryInstance.remove(), errorMsg);
        await expectToThrowAsync(async () => entryInstance.increment(), errorMsg);
        await expectToThrowAsync(async () => entryInstance.decrement(), errorMsg);
        await expectToThrowAsync(async () => entryInstance.batch(), errorMsg);
      };

      /** Make sure to call this inside the batch method as batch objects can't be interacted with outside the batch callback */
      const checkBatchContextAccessApiErrors = ({ ctx, errorMsg, skipId }) => {
        if (!skipId) expect(() => ctx.id).not.to.throw(); // this should not throw
        expect(() => ctx.get()).to.throw(errorMsg);
        expect(() => ctx.value()).to.throw(errorMsg);
        expect(() => ctx.compact()).to.throw(errorMsg);
        expect(() => ctx.compactJson()).to.throw(errorMsg);
        expect(() => [...ctx.entries()]).to.throw(errorMsg);
        expect(() => [...ctx.keys()]).to.throw(errorMsg);
        expect(() => [...ctx.values()]).to.throw(errorMsg);
        expect(() => ctx.size()).to.throw(errorMsg);
      };

      /** Make sure to call this inside the batch method as batch objects can't be interacted with outside the batch callback */
      const checkBatchContextWriteApiErrors = ({ ctx, errorMsg }) => {
        expect(() => ctx.set()).to.throw(errorMsg);
        expect(() => ctx.remove()).to.throw(errorMsg);
        expect(() => ctx.increment()).to.throw(errorMsg);
        expect(() => ctx.decrement()).to.throw(errorMsg);
      };

      const clientConfigurationScenarios = [
        {
          description: 'public API throws missing object modes error when attached without correct modes',
          action: async (ctx) => {
            const { realtimeObject, entryPathObject, entryInstance, channel } = ctx;

            // obtain batch context with valid modes first
            await entryInstance.batch((ctx) => {
              // now simulate missing modes
              channel.modes = [];

              checkBatchContextAccessApiErrors({ ctx, errorMsg: '"object_subscribe" channel mode' });
              checkBatchContextWriteApiErrors({ ctx, errorMsg: '"object_publish" channel mode' });
            });

            await expectToThrowAsync(async () => realtimeObject.get(), '"object_subscribe" channel mode');
            await checkAccessApiErrors({ entryPathObject, entryInstance, errorMsg: '"object_subscribe" channel mode' });
            await checkWriteApiErrors({ entryPathObject, entryInstance, errorMsg: '"object_publish" channel mode' });
          },
        },

        {
          description:
            'public API throws missing object modes error when not yet attached but client options are missing correct modes',
          action: async (ctx) => {
            const { realtimeObject, entryPathObject, entryInstance, channel, helper } = ctx;

            // obtain batch context with valid modes first
            await entryInstance.batch((ctx) => {
              // now simulate a situation where we're not yet attached/modes are not received on ATTACHED event
              channel.modes = undefined;
              helper.recordPrivateApi('write.channel.channelOptions.modes');
              channel.channelOptions.modes = [];

              checkBatchContextAccessApiErrors({ ctx, errorMsg: '"object_subscribe" channel mode' });
              checkBatchContextWriteApiErrors({ ctx, errorMsg: '"object_publish" channel mode' });
            });

            await expectToThrowAsync(async () => realtimeObject.get(), '"object_subscribe" channel mode');
            await checkAccessApiErrors({ entryPathObject, entryInstance, errorMsg: '"object_subscribe" channel mode' });
            await checkWriteApiErrors({ entryPathObject, entryInstance, errorMsg: '"object_publish" channel mode' });
          },
        },

        {
          description: 'public API throws invalid channel state error when channel DETACHED',
          action: async (ctx) => {
            const { entryPathObject, entryInstance, channel, helper } = ctx;

            // obtain batch context with valid channel state first
            await entryInstance.batch((ctx) => {
              // now simulate channel state change
              helper.recordPrivateApi('call.channel.requestState');
              channel.requestState('detached');

              checkBatchContextAccessApiErrors({ ctx, errorMsg: 'failed as channel state is detached' });
              checkBatchContextWriteApiErrors({ ctx, errorMsg: 'failed as channel state is detached' });
            });

            await checkAccessApiErrors({
              entryPathObject,
              entryInstance,
              errorMsg: 'failed as channel state is detached',
            });
            await checkWriteApiErrors({
              entryPathObject,
              entryInstance,
              errorMsg: 'failed as channel state is detached',
            });
          },
        },

        {
          description: 'public API throws invalid channel state error when channel FAILED',
          action: async (ctx) => {
            const { realtimeObject, entryPathObject, entryInstance, channel, helper } = ctx;

            // obtain batch context with valid channel state first
            await entryInstance.batch((ctx) => {
              // now simulate channel state change
              helper.recordPrivateApi('call.channel.requestState');
              channel.requestState('failed');

              checkBatchContextAccessApiErrors({ ctx, errorMsg: 'failed as channel state is failed' });
              checkBatchContextWriteApiErrors({ ctx, errorMsg: 'failed as channel state is failed' });
            });

            await expectToThrowAsync(async () => realtimeObject.get(), 'failed as channel state is failed');
            await checkAccessApiErrors({
              entryPathObject,
              entryInstance,
              errorMsg: 'failed as channel state is failed',
            });
            await checkWriteApiErrors({
              entryPathObject,
              entryInstance,
              errorMsg: 'failed as channel state is failed',
            });
          },
        },

        {
          description: 'public write API throws invalid channel state error when channel SUSPENDED',
          action: async (ctx) => {
            const { entryPathObject, entryInstance, channel, helper } = ctx;

            // obtain batch context with valid channel state first
            await entryInstance.batch((ctx) => {
              // now simulate channel state change
              helper.recordPrivateApi('call.channel.requestState');
              channel.requestState('suspended');

              checkBatchContextWriteApiErrors({ ctx, errorMsg: 'failed as channel state is suspended' });
            });

            await checkWriteApiErrors({
              entryPathObject,
              entryInstance,
              errorMsg: 'failed as channel state is suspended',
            });
          },
        },

        {
          description: 'public write API throws invalid channel option when "echoMessages" is disabled',
          action: async (ctx) => {
            const { client, entryPathObject, entryInstance, helper } = ctx;

            // obtain batch context with valid client options first
            await entryInstance.batch((ctx) => {
              // now simulate echoMessages was disabled
              helper.recordPrivateApi('write.realtime.options.echoMessages');
              client.options.echoMessages = false;

              checkBatchContextWriteApiErrors({ ctx, errorMsg: '"echoMessages" client option' });
            });

            await checkWriteApiErrors({ entryPathObject, entryInstance, errorMsg: '"echoMessages" client option' });
          },
        },
      ];

      /** @nospec */
      forScenarios(this, clientConfigurationScenarios, async function (helper, scenario, clientOptions, channelName) {
        const objectsHelper = new LiveObjectsHelper(helper);
        const client = RealtimeWithLiveObjects(helper, clientOptions);

        await helper.monitorConnectionThenCloseAndFinishAsync(async () => {
          // attach with correct channel modes so we can create Objects on the root for testing.
          // some scenarios will modify the underlying modes array to test specific behavior
          const channel = client.channels.get(channelName, channelOptionsWithObjectModes());
          const realtimeObject = channel.object;

          await channel.attach();
          const entryPathObject = await channel.object.get();
          const entryInstance = entryPathObject.instance();

          const objectsCreatedPromise = Promise.all([
            waitForMapKeyUpdate(entryInstance, 'map'),
            waitForMapKeyUpdate(entryInstance, 'counter'),
          ]);
          await entryInstance.set('map', LiveMap.create());
          await entryInstance.set('counter', LiveCounter.create());
          await objectsCreatedPromise;

          const map = entryInstance.get('map');
          const counter = entryInstance.get('counter');

          await scenario.action({
            realtimeObject,
            objectsHelper,
            channelName,
            channel,
            entryPathObject,
            entryInstance,
            map,
            counter,
            helper,
            client,
          });
        }, client);
      });

      /**
       * @spec TO3l8
       * @spec RSL1i
       */
      it('object message publish respects connectionDetails.maxMessageSize', async function () {
        const helper = this.test.helper;
        const client = RealtimeWithLiveObjects(helper);

        await helper.monitorConnectionThenCloseAndFinishAsync(async () => {
          await client.connection.once('connected');

          const connectionManager = client.connection.connectionManager;
          const connectionDetails = connectionManager.connectionDetails;
          const connectionDetailsPromise = connectionManager.once('connectiondetails');

          helper.recordPrivateApi('write.connectionManager.connectionDetails.maxMessageSize');
          connectionDetails.maxMessageSize = 64;

          helper.recordPrivateApi('call.connectionManager.activeProtocol.getTransport');
          helper.recordPrivateApi('call.transport.onProtocolMessage');
          helper.recordPrivateApi('call.makeProtocolMessageFromDeserialized');
          // forge lower maxMessageSize
          connectionManager.activeProtocol.getTransport().onProtocolMessage(
            createPM({
              action: 4, // CONNECTED
              connectionDetails,
            }),
          );

          helper.recordPrivateApi('listen.connectionManager.connectiondetails');
          await connectionDetailsPromise;

          const channel = client.channels.get('channel', channelOptionsWithObjectModes());

          await channel.attach();
          const entryPathObject = await channel.object.get();

          const data = new Array(100).fill('a').join('');
          const error = await expectToThrowAsync(
            async () => entryPathObject.set('key', data),
            'Maximum size of object messages that can be published at once exceeded',
          );

          expect(error.code).to.equal(40009, 'Check maximum size of messages error has correct error code');
        }, client);
      });

      describe('ObjectMessage message size', () => {
        const objectMessageSizeScenarios = [
          {
            description: 'client id',
            message: objectMessageFromValues({
              clientId: 'my-client',
            }),
            expected: Utils.dataSizeBytes('my-client'),
          },
          {
            description: 'extras',
            message: objectMessageFromValues({
              extras: { foo: 'bar' },
            }),
            expected: Utils.dataSizeBytes('{"foo":"bar"}'),
          },
          {
            description: 'object id',
            message: objectMessageFromValues({
              operation: { objectId: 'object-id' },
            }),
            expected: 0,
          },
          {
            description: 'nonce',
            message: objectMessageFromValues({
              operation: { nonce: '1234567890' },
            }),
            expected: 0,
          },
          {
            description: 'initial value',
            message: objectMessageFromValues({
              operation: { initialValue: JSON.stringify({ counter: { count: 1 } }) },
            }),
            expected: 0,
          },
          {
            description: 'map create op no payload',
            message: objectMessageFromValues({
              operation: { action: 0, objectId: 'object-id' },
            }),
            expected: 0,
          },
          {
            description: 'map create op with object id payload',
            message: objectMessageFromValues({
              operation: {
                action: 0,
                objectId: 'object-id',
                mapCreate: {
                  semantics: 0,
                  entries: { 'key-1': { tombstone: false, data: { objectId: 'another-object-id' } } },
                },
              },
            }),
            expected: Utils.dataSizeBytes('key-1'),
          },
          {
            description: 'map create op with string payload',
            message: objectMessageFromValues({
              operation: {
                action: 0,
                objectId: 'object-id',
                mapCreate: { semantics: 0, entries: { 'key-1': { tombstone: false, data: { string: 'a string' } } } },
              },
            }),
            expected: Utils.dataSizeBytes('key-1') + Utils.dataSizeBytes('a string'),
          },
          {
            description: 'map create op with bytes payload',
            message: objectMessageFromValues({
              operation: {
                action: 0,
                objectId: 'object-id',
                mapCreate: {
                  semantics: 0,
                  entries: { 'key-1': { tombstone: false, data: { bytes: BufferUtils.utf8Encode('my-value') } } },
                },
              },
            }),
            expected: Utils.dataSizeBytes('key-1') + Utils.dataSizeBytes(BufferUtils.utf8Encode('my-value')),
          },
          {
            description: 'map create op with boolean payload',
            message: objectMessageFromValues({
              operation: {
                action: 0,
                objectId: 'object-id',
                mapCreate: {
                  semantics: 0,
                  entries: {
                    'key-1': { tombstone: false, data: { boolean: true } },
                    'key-2': { tombstone: false, data: { boolean: false } },
                  },
                },
              },
            }),
            expected: Utils.dataSizeBytes('key-1') + Utils.dataSizeBytes('key-2') + 2,
          },
          {
            description: 'map create op with double payload',
            message: objectMessageFromValues({
              operation: {
                action: 0,
                objectId: 'object-id',
                mapCreate: {
                  semantics: 0,
                  entries: {
                    'key-1': { tombstone: false, data: { number: 123.456 } },
                    'key-2': { tombstone: false, data: { number: 0 } },
                  },
                },
              },
            }),
            expected: Utils.dataSizeBytes('key-1') + Utils.dataSizeBytes('key-2') + 16,
          },
          {
            description: 'map create op with object payload',
            message: objectMessageFromValues({
              operation: {
                action: 0,
                objectId: 'object-id',
                mapCreate: {
                  semantics: 0,
                  entries: { 'key-1': { tombstone: false, data: { json: { foo: 'bar' } } } },
                },
              },
            }),
            expected: Utils.dataSizeBytes('key-1') + JSON.stringify({ foo: 'bar' }).length,
          },
          {
            description: 'map create op with array payload',
            message: objectMessageFromValues({
              operation: {
                action: 0,
                objectId: 'object-id',
                mapCreate: {
                  semantics: 0,
                  entries: { 'key-1': { tombstone: false, data: { json: ['foo', 'bar', 'baz'] } } },
                },
              },
            }),
            expected: Utils.dataSizeBytes('key-1') + JSON.stringify(['foo', 'bar', 'baz']).length,
          },
          {
            description: 'map create op with client-generated object id and _derivedFrom',
            message: objectMessageFromValues({
              operation: {
                action: 0,
                objectId: 'object-id',
                mapCreateWithObjectId: {
                  nonce: '1234567890',
                  initialValue: JSON.stringify({
                    semantics: 0,
                    entries: { 'key-1': { tombstone: false, data: { string: 'a string' } } },
                  }),
                  _derivedFrom: {
                    semantics: 0,
                    entries: { 'key-1': { tombstone: false, data: { string: 'a string' } } },
                  },
                },
              },
            }),
            // size is calculated from mapCreateWithObjectId._derivedFrom and is not double counted
            expected: Utils.dataSizeBytes('key-1') + Utils.dataSizeBytes('a string'),
          },
          {
            description: 'map set operation value=objectId',
            message: objectMessageFromValues({
              operation: {
                action: 1,
                objectId: 'object-id',
                mapSet: { key: 'my-key', value: { objectId: 'another-object-id' } },
              },
            }),
            expected: Utils.dataSizeBytes('my-key'),
          },
          {
            description: 'map set operation value=string',
            message: objectMessageFromValues({
              operation: { action: 1, objectId: 'object-id', mapSet: { key: 'my-key', value: { string: 'my-value' } } },
            }),
            expected: Utils.dataSizeBytes('my-key') + Utils.dataSizeBytes('my-value'),
          },
          {
            description: 'map set operation value=bytes',
            message: objectMessageFromValues({
              operation: {
                action: 1,
                objectId: 'object-id',
                mapSet: { key: 'my-key', value: { bytes: BufferUtils.utf8Encode('my-value') } },
              },
            }),
            expected: Utils.dataSizeBytes('my-key') + Utils.dataSizeBytes(BufferUtils.utf8Encode('my-value')),
          },
          {
            description: 'map set operation value=boolean true',
            message: objectMessageFromValues({
              operation: { action: 1, objectId: 'object-id', mapSet: { key: 'my-key', value: { boolean: true } } },
            }),
            expected: Utils.dataSizeBytes('my-key') + 1,
          },
          {
            description: 'map set operation value=boolean false',
            message: objectMessageFromValues({
              operation: { action: 1, objectId: 'object-id', mapSet: { key: 'my-key', value: { boolean: false } } },
            }),
            expected: Utils.dataSizeBytes('my-key') + 1,
          },
          {
            description: 'map set operation value=double',
            message: objectMessageFromValues({
              operation: { action: 1, objectId: 'object-id', mapSet: { key: 'my-key', value: { number: 123.456 } } },
            }),
            expected: Utils.dataSizeBytes('my-key') + 8,
          },
          {
            description: 'map set operation value=double 0',
            message: objectMessageFromValues({
              operation: { action: 1, objectId: 'object-id', mapSet: { key: 'my-key', value: { number: 0 } } },
            }),
            expected: Utils.dataSizeBytes('my-key') + 8,
          },
          {
            description: 'map set operation value=json-object',
            message: objectMessageFromValues({
              operation: {
                action: 1,
                objectId: 'object-id',
                mapSet: { key: 'my-key', value: { json: { foo: 'bar' } } },
              },
            }),
            expected: Utils.dataSizeBytes('my-key') + JSON.stringify({ foo: 'bar' }).length,
          },
          {
            description: 'map set operation value=json-array',
            message: objectMessageFromValues({
              operation: {
                action: 1,
                objectId: 'object-id',
                mapSet: { key: 'my-key', value: { json: ['foo', 'bar', 'baz'] } },
              },
            }),
            expected: Utils.dataSizeBytes('my-key') + JSON.stringify(['foo', 'bar', 'baz']).length,
          },
          {
            description: 'map remove op',
            message: objectMessageFromValues({
              operation: { action: 2, objectId: 'object-id', mapRemove: { key: 'my-key' } },
            }),
            expected: Utils.dataSizeBytes('my-key'),
          },
          {
            description: 'map object',
            message: objectMessageFromValues({
              object: {
                objectId: 'object-id',
                map: {
                  semantics: 0,
                  entries: {
                    'key-1': { tombstone: false, data: { string: 'a string' } },
                    'key-2': { tombstone: true, data: { string: 'another string' } },
                  },
                },
                createOp: {
                  action: 0,
                  objectId: 'object-id',
                  mapCreate: {
                    semantics: 0,
                    entries: { 'key-3': { tombstone: false, data: { string: 'third string' } } },
                  },
                },
                siteTimeserials: { aaa: lexicoTimeserial('aaa', 111, 111, 1) }, // shouldn't be counted
                tombstone: false,
              },
            }),
            expected:
              Utils.dataSizeBytes('key-1') +
              Utils.dataSizeBytes('a string') +
              Utils.dataSizeBytes('key-2') +
              Utils.dataSizeBytes('another string') +
              Utils.dataSizeBytes('key-3') +
              Utils.dataSizeBytes('third string'),
          },
          {
            description: 'counter create op no payload',
            message: objectMessageFromValues({
              operation: { action: 3, objectId: 'object-id' },
            }),
            expected: 0,
          },
          {
            description: 'counter create op with payload',
            message: objectMessageFromValues({
              operation: { action: 3, objectId: 'object-id', counterCreate: { count: 1234567 } },
            }),
            expected: 8,
          },
          {
            description: 'counter create op with client-generated object id and _derivedFrom',
            message: objectMessageFromValues({
              operation: {
                action: 3,
                objectId: 'object-id',
                counterCreateWithObjectId: {
                  nonce: '1234567890',
                  initialValue: JSON.stringify({ count: 1234567 }),
                  _derivedFrom: { count: 1234567 },
                },
              },
            }),
            // size is calculated from counterCreateWithObjectId._derivedFrom and is not double counted
            expected: 8,
          },
          {
            description: 'counter inc op',
            message: objectMessageFromValues({
              operation: { action: 4, objectId: 'object-id', counterInc: { number: 123.456 } },
            }),
            expected: 8,
          },
          {
            description: 'counter object',
            message: objectMessageFromValues({
              object: {
                objectId: 'object-id',
                counter: { count: 1234567 },
                createOp: {
                  action: 3,
                  objectId: 'object-id',
                  counterCreate: { count: 9876543 },
                },
                siteTimeserials: { aaa: lexicoTimeserial('aaa', 111, 111, 1) }, // shouldn't be counted
                tombstone: false,
              },
            }),
            expected: 8 + 8,
          },
          {
            description: 'map clear op',
            message: objectMessageFromValues({
              operation: { action: 6, objectId: 'object-id', mapClear: {} },
            }),
            expected: 0,
          },
        ];

        /** @nospec */
        forScenarios(this, objectMessageSizeScenarios, function (helper, scenario) {
          const client = RealtimeWithLiveObjects(helper, { autoConnect: false });
          helper.recordPrivateApi('call.ObjectMessage.encode');
          const encodedMessage = scenario.message.encode(client);
          helper.recordPrivateApi('call.BufferUtils.utf8Encode'); // called by a scenario to create buffers
          helper.recordPrivateApi('call.ObjectMessage.fromValues'); // called by a scenario to create an ObjectMessage instance
          helper.recordPrivateApi('call.Utils.dataSizeBytes'); // called by a scenario to calculated the expected byte size
          helper.recordPrivateApi('write.ObjectOperation.counterCreateWithObjectId._derivedFrom'); // prop set by a scenario
          helper.recordPrivateApi('write.ObjectOperation.mapCreateWithObjectId._derivedFrom'); // prop set by a scenario
          helper.recordPrivateApi('call.ObjectMessage.getMessageSize');
          expect(encodedMessage.getMessageSize()).to.equal(scenario.expected);
        });
      });

      /** @nospec */
      it('toUserFacingMessage returns correct public ObjectOperation for all operation types', function () {
        const helper = this.test.helper;
        const client = RealtimeWithLiveObjects(helper, { autoConnect: false });
        const channel = client.channels.get('channel');

        helper.recordPrivateApi('write.ObjectOperation.counterCreateWithObjectId._derivedFrom');
        helper.recordPrivateApi('write.ObjectOperation.mapCreateWithObjectId._derivedFrom');
        const scenarios = [
          {
            description: 'MAP_CREATE',
            operation: {
              action: 0,
              objectId: 'obj-1',
              mapCreate: { semantics: 0, entries: { foo: { tombstone: false, data: { string: 'bar' } } } },
            },
            expectedCurrentFields: {
              mapCreate: { semantics: 'lww', entries: { foo: { tombstone: false, data: { string: 'bar' } } } },
            },
            expectedDeprecatedFields: {
              map: { semantics: 'lww', entries: { foo: { tombstone: false, data: { value: 'bar' } } } },
            },
          },
          {
            description: 'MAP_CREATE with mapCreateWithObjectId._derivedFrom',
            operation: {
              action: 0,
              objectId: 'obj-1',
              mapCreateWithObjectId: {
                nonce: '1234567890',
                initialValue: JSON.stringify({
                  semantics: 0,
                  entries: { foo: { tombstone: false, data: { string: 'bar' } } },
                }),
                _derivedFrom: {
                  semantics: 0,
                  entries: { foo: { tombstone: false, data: { string: 'bar' } } },
                },
              },
            },
            expectedCurrentFields: {
              mapCreate: { semantics: 'lww', entries: { foo: { tombstone: false, data: { string: 'bar' } } } },
            },
            expectedDeprecatedFields: {
              map: { semantics: 'lww', entries: { foo: { tombstone: false, data: { value: 'bar' } } } },
            },
            expectedAbsentFields: ['mapCreateWithObjectId'],
          },
          {
            description: 'MAP_SET',
            operation: { action: 1, objectId: 'obj-1', mapSet: { key: 'foo', value: { string: 'bar' } } },
            expectedCurrentFields: { mapSet: { key: 'foo', value: { string: 'bar' } } },
            expectedDeprecatedFields: { mapOp: { key: 'foo', data: { value: 'bar' } } },
          },
          {
            description: 'MAP_REMOVE',
            operation: { action: 2, objectId: 'obj-1', mapRemove: { key: 'foo' } },
            expectedCurrentFields: { mapRemove: { key: 'foo' } },
            expectedDeprecatedFields: { mapOp: { key: 'foo' } },
          },
          {
            description: 'COUNTER_CREATE',
            operation: { action: 3, objectId: 'obj-2', counterCreate: { count: 42 } },
            expectedCurrentFields: { counterCreate: { count: 42 } },
            expectedDeprecatedFields: { counter: { count: 42 } },
          },
          {
            description: 'COUNTER_CREATE with counterCreateWithObjectId._derivedFrom',
            operation: {
              action: 3,
              objectId: 'obj-2',
              counterCreateWithObjectId: {
                nonce: '1234567890',
                initialValue: JSON.stringify({ count: 42 }),
                _derivedFrom: { count: 42 },
              },
            },
            expectedCurrentFields: { counterCreate: { count: 42 } },
            expectedDeprecatedFields: { counter: { count: 42 } },
            expectedAbsentFields: ['counterCreateWithObjectId'],
          },
          {
            description: 'COUNTER_INC',
            operation: { action: 4, objectId: 'obj-2', counterInc: { number: 5 } },
            expectedCurrentFields: { counterInc: { number: 5 } },
            expectedDeprecatedFields: { counterOp: { amount: 5 } },
          },
          {
            description: 'OBJECT_DELETE',
            operation: { action: 5, objectId: 'obj-3', objectDelete: {} },
            expectedCurrentFields: { objectDelete: {} },
          },
          {
            description: 'MAP_CLEAR',
            operation: { action: 6, objectId: 'obj-4', mapClear: {} },
            expectedCurrentFields: { mapClear: {} },
          },
        ];

        for (const {
          description,
          operation,
          expectedCurrentFields,
          expectedDeprecatedFields,
          expectedAbsentFields,
        } of scenarios) {
          helper.recordPrivateApi('call.ObjectMessage.fromValues');
          const msg = objectMessageFromValues({ operation });
          helper.recordPrivateApi('call.ObjectMessage.toUserFacingMessage');
          const result = msg.toUserFacingMessage(channel);

          expectDeepSubset(result.operation, expectedCurrentFields, `${description}: Check current fields`);
          if (expectedDeprecatedFields) {
            expectDeepSubset(result.operation, expectedDeprecatedFields, `${description}: Check deprecated fields`);
          }
          for (const field of expectedAbsentFields ?? []) {
            expect(result.operation[field], `${description}: check '${field}' is not set`).to.not.exist;
          }
        }
      });
    });

    /** @nospec */
    it('can attach to channel with object modes', async function () {
      const helper = this.test.helper;
      const client = helper.AblyRealtime();

      await helper.monitorConnectionThenCloseAndFinishAsync(async () => {
        const objectsModes = ['object_subscribe', 'object_publish'];
        const channelOptions = { modes: objectsModes };
        const channel = client.channels.get('channel', channelOptions);

        await channel.attach();

        helper.recordPrivateApi('read.channel.channelOptions');
        expect(channel.channelOptions).to.deep.equal(channelOptions, 'Check expected channel options');
        expect(channel.modes).to.deep.equal(objectsModes, 'Check expected modes');
      }, client);
    });

    describe('Apply on ACK', () => {
      /**
       * Operations applied locally on ACK
       *
       * Verify that after a write operation promise resolves, the value is immediately
       * visible. Echoes are held to prove the value comes from apply-on-ACK, not the echo.
       */
      describe('Operations applied locally on ACK', function () {
        const applyOnAckScenarios = [
          {
            description: 'creating a LiveCounter applies immediately on ACK',
            action: async (root) => {
              await root.set('newCounter', LiveCounter.create(42));
              expect(root.get('newCounter').value()).to.equal(42, 'Check counter has initial value');
            },
          },
          {
            description: 'LiveCounter.increment applies operation immediately on ACK',
            action: async (root) => {
              await root.set('counter', LiveCounter.create(10));
              const counter = root.get('counter');
              expect(counter.value()).to.equal(10, 'Check counter has initial value of 10');
              await counter.increment(5);
              expect(counter.value()).to.equal(15, 'Check counter value is 15 after increment');
            },
          },
          {
            description: 'creating a LiveMap applies immediately on ACK',
            action: async (root) => {
              await root.set('newMap', LiveMap.create({ key: 'value' }));
              expect(root.get('newMap').get('key').value()).to.equal('value', 'Check map has initial entry');
            },
          },
          {
            description: 'LiveMap.set applies operation immediately on ACK',
            action: async (root) => {
              await root.set('key', 'value');
              expect(root.get('key').value()).to.equal('value', 'Check map value is available after set');
            },
          },
          {
            description: 'LiveMap.remove applies operation immediately on ACK',
            action: async (root) => {
              await root.set('keyToRemove', 'valueToRemove');
              expect(root.get('keyToRemove').value()).to.equal('valueToRemove', 'Check key exists');
              await root.remove('keyToRemove');
              expect(root.get('keyToRemove').value(), 'Check key is removed').to.be.undefined;
            },
          },
          {
            description: 'batch operations apply immediately on ACK',
            action: async (root) => {
              await root.set('counter', LiveCounter.create(10));
              const counter = root.get('counter');
              await root.batch((ctx) => {
                ctx.get('counter').increment(5);
                ctx.get('counter').increment(3);
              });
              expect(counter.value()).to.equal(18, 'Check batch increments applied on ACK');
            },
          },
        ];

        forScenarios(this, applyOnAckScenarios, async function (helper, scenario, clientOptions, channelName) {
          const client = RealtimeWithLiveObjects(helper, clientOptions);

          await helper.monitorConnectionThenCloseAndFinishAsync(async () => {
            const channel = client.channels.get(channelName, channelOptionsWithObjectModes());

            await channel.attach();
            const root = await channel.object.get();

            // hold echoes so we can verify value comes from ACK, not echo
            createEchoInterceptor(helper, client);

            await scenario.action(root);
          }, client);
        });
      });

      /**
       * Does not double-apply
       *
       * Verify that operations are not applied twice regardless of message ordering.
       * Uses counter.increment as a representative example of an operation.
       */
      describe('Does not double-apply', () => {
        it('echo after ACK does not double-apply', async function () {
          const helper = this.test.helper;
          const client = RealtimeWithLiveObjects(helper);

          await helper.monitorConnectionThenCloseAndFinishAsync(async () => {
            const channelName = 'apply-on-ack-no-double-apply-echo-after-ack';
            const channel = client.channels.get(channelName, channelOptionsWithObjectModes());

            await channel.attach();
            const root = await channel.object.get();

            // create a counter
            await root.set('counter', LiveCounter.create(10));
            const counter = root.get('counter');

            // set up echo interceptor
            const interceptor = createEchoInterceptor(helper, client);

            // perform increment
            await counter.increment(5);
            expect(counter.value()).to.equal(15, 'Check counter is 15 after increment');

            // wait for the echo to be intercepted
            await interceptor.waitForEcho();

            // release the held echo and wait for processing to complete
            await interceptor.releaseAll();

            // counter should still be 15, not 20 (no double-apply)
            expect(counter.value()).to.equal(15, 'Check counter is still 15 after echo, not 20');
          }, client);
        });

        it('ACK after echo does not double-apply', async function () {
          const helper = this.test.helper;
          const client = RealtimeWithLiveObjects(helper);

          await helper.monitorConnectionThenCloseAndFinishAsync(async () => {
            const channelName = 'apply-on-ack-no-double-apply-ack-after-echo';
            const channel = client.channels.get(channelName, channelOptionsWithObjectModes());

            await channel.attach();
            const root = await channel.object.get();

            // create a counter
            await root.set('counter', LiveCounter.create(10));
            const counter = root.get('counter');

            // set up ACK interceptor (hold ACKs, let OBJECT messages through)
            const interceptor = createAckInterceptor(helper, client);

            // set up subscription to wait for the echo
            const echoAppliedPromise = waitForCounterUpdate(counter);

            // start the increment but don't await - it won't resolve until we release the held ACK
            const incrementPromise = counter.increment(5);

            // wait for the echo to be applied
            await echoAppliedPromise;
            expect(counter.value()).to.equal(15, 'Check counter is 15 from echo');

            // release the ACK
            await interceptor.waitForAck();
            interceptor.releaseAll();

            // wait for the operation to complete
            await incrementPromise;

            // counter should still be 15 (not 20)
            expect(counter.value()).to.equal(15, 'Check counter is still 15 after ACK, not 20');
          }, client);
        });
      });

      /**
       * Does not incorrectly skip operations
       *
       * Verify that applying operations on ACK doesn't cause earlier operations
       * for the same site, received over the Realtime connection, to be skipped.
       */
      describe('Does not incorrectly skip operations', () => {
        /**
         * Tests that apply-on-ACK does not update siteTimeserials.
         *
         * When an operation is applied via the echo, it updates
         * siteTimeserials[siteCode] = serial. When applied via apply-on-ACK, it should NOT.
         *
         * This test verifies this by:
         * 1. Creating a counter via the write API (echo held to extract its serial,
         *    then released to set siteTimeserials)
         * 2. Performing an increment via apply-on-ACK (echo held so it doesn't update
         *    siteTimeserials - we want to test if apply-on-ACK does)
         * 3. Injecting an operation with a serial between the create and increment serials
         * 4. Asserting the injected op was applied (it would be rejected if
         *    siteTimeserials had been updated by apply-on-ACK to the increment's serial)
         */
        it('apply-on-ACK does not update siteTimeserials', async function () {
          const helper = this.test.helper;
          const objectsHelper = new LiveObjectsHelper(helper);
          const client = RealtimeWithLiveObjects(helper);

          await helper.monitorConnectionThenCloseAndFinishAsync(async () => {
            const channelName = 'apply-on-ack-does-not-update-site-timeserials';
            const channel = client.channels.get(channelName, channelOptionsWithObjectModes());

            await channel.attach();
            const root = await channel.object.get();

            // set up echo interceptor before any operations
            const interceptor = createEchoInterceptor(helper, client);

            // create a counter - echo is held so we can extract its serial
            await root.set('counter', LiveCounter.create(10));
            const counter = root.get('counter');
            const counterId = counter.instance().id;

            // wait for create echo and extract the COUNTER_CREATE serial
            await interceptor.waitForEcho();
            helper.recordPrivateApi('read.ProtocolMessage.state');
            const createEcho = interceptor.heldEchoes[0].message;
            // the create echo has two operations (COUNTER_CREATE and MAP_SET);
            // extract the COUNTER_CREATE one since that sets the counter's siteTimeserials
            const counterCreateState = createEcho.state.find(
              (x) => x.operation.action === LiveObjectsHelper.ACTIONS.COUNTER_CREATE,
            );
            const counterCreateSerial = counterCreateState.serial;
            const siteCode = counterCreateState.siteCode;

            // release the create echo and wait for processing so siteTimeserials gets set
            await interceptor.heldEchoes[0].release();
            interceptor.heldEchoes.shift();

            // perform increment - applied via apply-on-ACK
            await counter.increment(5);
            expect(counter.value()).to.equal(15, 'Check counter is 15 after apply-on-ACK');

            // wait for increment echo (held so it doesn't update siteTimeserials) and extract its serial
            await interceptor.waitForEcho();
            const incrementEcho = interceptor.heldEchoes[0].message;
            const incrementState = incrementEcho.state[0];
            const incrementSerial = incrementState.serial;

            // construct a serial between the create and increment serials by appending a
            // character to counterCreateSerial; this works as long as counterCreateSerial is
            // not a prefix of incrementSerial (which we expect since they're from different
            // protocol messages)
            const injectedSerial = counterCreateSerial + 'a';

            // verify our assumptions
            expect(injectedSerial > counterCreateSerial).to.equal(true, 'injectedSerial > counterCreateSerial');
            expect(injectedSerial < incrementSerial).to.equal(true, 'injectedSerial < incrementSerial');

            // inject an operation with this serial
            // if siteTimeserials was NOT updated by apply-on-ACK (still at counterCreateSerial level):
            //   injectedSerial > counterCreateSerial, so operation is applied
            // if siteTimeserials WAS updated by apply-on-ACK (now at incrementSerial level):
            //   injectedSerial < incrementSerial, so operation is rejected
            await objectsHelper.processObjectOperationMessageOnChannel({
              channel,
              serial: injectedSerial,
              siteCode,
              state: [objectsHelper.counterIncOp({ objectId: counterId, amount: 100 })],
            });

            // counter should be 115, proving siteTimeserials was not updated by apply-on-ACK
            expect(counter.value()).to.equal(
              115,
              'Check counter is 115, proving siteTimeserials was not updated by apply-on-ACK',
            );
          }, client);
        });
      });

      /**
       * ACKs buffered during OBJECT_SYNC
       *
       * Verify that when an ACK arrives during an OBJECT_SYNC sequence,
       * the operation is buffered and applied after sync completes.
       */
      describe('ACKs buffered during OBJECT_SYNC', () => {
        it('operation buffered during sync is applied after sync completes', async function () {
          const helper = this.test.helper;
          const objectsHelper = new LiveObjectsHelper(helper);
          const client = RealtimeWithLiveObjects(helper);

          await helper.monitorConnectionThenCloseAndFinishAsync(async () => {
            const channelName = 'apply-on-ack-buffered-during-sync';
            const channel = client.channels.get(channelName, channelOptionsWithObjectModes());

            // first, set up the channel and create a counter
            await channel.attach();
            const root = await channel.object.get();

            await root.set('counter', LiveCounter.create(10));
            const counter = root.get('counter');
            const counterId = counter.instance().id;

            // now simulate a new OBJECT_SYNC sequence starting
            // inject an ATTACHED with HAS_OBJECTS to trigger SYNCING state
            await injectAttachedMessage(helper, channel, 1 << 7); // HAS_OBJECTS flag is bit 7

            // set up ACK interceptor so we can control when the ACK is delivered
            const interceptor = createAckInterceptor(helper, client);

            // perform an increment while in SYNCING state
            const incrementPromise = counter.increment(5);

            // wait for the ACK to be intercepted, then release it.
            // this lets publishAndApply proceed past publish into the sync-wait.
            await interceptor.waitForAck();
            interceptor.releaseAll();

            // yield to the event loop so publishAndApply reaches the sync wait.
            // (we use the same mechanism as the 'publishAndApply rejects when channel
            // state changes during sync wait' test, which validates this yield is
            // sufficient — if publishAndApply had not yet entered the sync-wait, the
            // channel state change would not cause it to reject.)
            await new Promise((resolve) => setTimeout(resolve, 0));

            // complete the sync sequence
            await objectsHelper.processObjectStateMessageOnChannel({
              channel,
              syncSerial: 'serial:',
              state: [
                objectsHelper.mapObject({
                  objectId: 'root',
                  siteTimeserials: { aaa: lexicoTimeserial('aaa', 0, 0) },
                  initialEntries: {
                    counter: {
                      timeserial: lexicoTimeserial('aaa', 0, 0),
                      data: { objectId: counterId },
                    },
                  },
                }),
                objectsHelper.counterObject({
                  objectId: counterId,
                  siteTimeserials: { aaa: lexicoTimeserial('aaa', 0, 0) },
                  initialCount: 10, // original value before increment
                }),
              ],
            });

            // wait for the increment to complete
            await incrementPromise;

            // the buffered ACK should now have been applied
            expect(counter.value()).to.equal(15, 'Check counter reflects the increment after sync completes');
          }, client);
        });

        /**
         * Tests that appliedOnAckSerials is cleared when a new OBJECT_SYNC completes.
         *
         * The test works by:
         * 1. Performing an operation (serial X added to appliedOnAckSerials), holding the echo
         * 2. Injecting an OBJECT_SYNC with siteTimeserials that uses a fake siteCode (not the
         *    real siteCode from the echo). This ensures the echo will pass the siteTimeserials
         *    check (since there's no entry for the echo's siteCode).
         * 3. After sync, appliedOnAckSerials should be cleared
         * 4. Releasing the held echo
         * 5. If cleared: echo applies (no matching entry in appliedOnAckSerials) - value changes
         * 6. If NOT cleared: echo rejected (X in appliedOnAckSerials) - value unchanged
         */
        it('appliedOnAckSerials is cleared on sync', async function () {
          const helper = this.test.helper;
          const objectsHelper = new LiveObjectsHelper(helper);
          const client = RealtimeWithLiveObjects(helper);

          await helper.monitorConnectionThenCloseAndFinishAsync(async () => {
            const channelName = 'apply-on-ack-serials-cleared-on-sync';
            const channel = client.channels.get(channelName, channelOptionsWithObjectModes());

            await channel.attach();
            const root = await channel.object.get();

            // create a counter
            await root.set('counter', LiveCounter.create(10));
            const counter = root.get('counter');
            const counterId = counter.instance().id;

            // set up echo interceptor to hold OBJECT messages
            const interceptor = createEchoInterceptor(helper, client);

            // perform increment - value becomes 15 via ACK, echo is held
            await counter.increment(5);
            expect(counter.value()).to.equal(15, 'Check counter is 15 after apply-on-ACK');

            // wait for echo to be intercepted
            await interceptor.waitForEcho();

            // now inject an OBJECT_SYNC that doesn't include our operation
            // this simulates a re-sync where the server state doesn't include our operation yet
            // the sync will reset the counter to 10 and clear appliedOnAckSerials
            // inject ATTACHED with HAS_OBJECTS to start sync
            await injectAttachedMessage(helper, channel, 1 << 7); // HAS_OBJECTS flag is bit 7

            // complete sync with state that uses a fake siteCode
            // using a clearly fake siteCode ensures the echo (which has the real siteCode)
            // will pass the siteTimeserials check since there's no entry for it
            await objectsHelper.processObjectStateMessageOnChannel({
              channel,
              syncSerial: 'serial:',
              state: [
                objectsHelper.mapObject({
                  objectId: 'root',
                  siteTimeserials: { fake: lexicoTimeserial('fake', 0, 0) },
                  initialEntries: {
                    counter: {
                      timeserial: lexicoTimeserial('fake', 0, 0),
                      data: { objectId: counterId },
                    },
                  },
                }),
                objectsHelper.counterObject({
                  objectId: counterId,
                  siteTimeserials: { fake: lexicoTimeserial('fake', 0, 0) },
                  initialCount: 10, // value WITHOUT our increment
                }),
              ],
            });

            // after sync, counter should be reset to 10 (from sync state)
            expect(counter.value()).to.equal(10, 'Check counter is 10 after sync');

            // now release the held echo and wait for processing to complete
            // if appliedOnAckSerials was cleared, the echo should be applied
            // (the echo will pass siteTimeserials check since there's no entry for its siteCode)
            await interceptor.releaseAll();

            // counter should now be 15 (echo was applied because appliedOnAckSerials was cleared)
            expect(counter.value()).to.equal(
              15,
              'Check counter is 15 after echo, proving appliedOnAckSerials was cleared on sync',
            );
          }, client);
        });

        describe('publishAndApply rejects when channel state changes during sync wait', () => {
          for (const targetState of ['detached', 'suspended', 'failed']) {
            it(`rejects with error 92008 when channel enters ${targetState} state`, async function () {
              const helper = this.test.helper;
              const client = RealtimeWithLiveObjects(helper);

              await helper.monitorConnectionThenCloseAndFinishAsync(async () => {
                const channelName = `apply-on-ack-sync-reject-${targetState}`;
                const channel = client.channels.get(channelName, channelOptionsWithObjectModes());

                // attach channel and create counter
                await channel.attach();
                const root = await channel.object.get();

                await root.set('counter', LiveCounter.create(10));
                const counter = root.get('counter');

                // inject ATTACHED with HAS_OBJECTS to trigger SYNCING state
                await injectAttachedMessage(helper, channel, 1 << 7); // HAS_OBJECTS flag is bit 7

                // set up ACK interceptor so we can control when ACK is delivered
                const interceptor = createAckInterceptor(helper, client);

                // start increment - this will publish and wait for ACK
                const incrementPromise = counter.increment(5);

                // wait for ACK to be intercepted, then release it
                // this lets publishAndApply proceed past publish into the sync-wait
                await interceptor.waitForAck();
                interceptor.releaseAll();

                // (Note: this is Claude's explanation of why the tests failed in browser when using nextTick; I'm not familiar with JS's task model and so I'm very much taking this on trust; but it makes the test work and I think that's good enough)
                // yield to the event loop so publishAndApply reaches the sync wait.
                // Must use setTimeout (macrotask) rather than nextTick/queueMicrotask because
                // the publishAndApply async chain (sendAndAwaitAck → sendState → publish) needs
                // multiple microtask ticks to propagate. In Node.js, process.nextTick runs at
                // higher priority than the microtask queue so happens to work, but in the browser
                // queueMicrotask interleaves with the chain and the test can run before
                // publishAndApply reaches the sync-wait.
                await new Promise((resolve) => setTimeout(resolve, 0));

                // trigger channel state change
                helper.recordPrivateApi('call.channel.requestState');
                channel.requestState(targetState);

                // the increment promise should reject with error 92008
                const err = await expectToThrowAsync(
                  () => incrementPromise,
                  `channel entering the ${targetState} state`,
                  { withCode: 92008 },
                );
                expect(err.statusCode).to.equal(400, 'Check statusCode is 400');
              }, client);
            });
          }
        });
      });

      /**
       * Subscription events
       *
       * Verify that subscription callbacks fire correctly regardless of whether
       * the operation was applied locally (ACK) or received over Realtime.
       */
      describe('Subscription events', () => {
        it('subscription callbacks fire for both locally-applied and Realtime-received operations', async function () {
          const helper = this.test.helper;
          const objectsHelper = new LiveObjectsHelper(helper);
          const client = RealtimeWithLiveObjects(helper);

          await helper.monitorConnectionThenCloseAndFinishAsync(async () => {
            const channelName = 'apply-on-ack-subscription-both-paths';
            const channel = client.channels.get(channelName, channelOptionsWithObjectModes());

            await channel.attach();
            const root = await channel.object.get();

            // create a counter
            await root.set('counter', LiveCounter.create(0));
            const counter = root.get('counter');
            const counterId = counter.instance().id;

            const receivedEvents = [];

            counter.subscribe((event) => {
              receivedEvents.push({
                action: event.message?.operation?.action,
                number: event.message?.operation?.counterInc?.number,
              });
            });

            // 1. trigger operation via SDK (applied locally on ACK)

            // intercept echoes to ensure the subscription fires from the apply-on-ACK path,
            // not from the echo arriving before the ACK
            const interceptor = createEchoInterceptor(helper, client);

            await counter.increment(5);

            // no need to wait for event - with apply-on-ACK, the subscription callback
            // is invoked synchronously before increment() returns
            expect(receivedEvents.length).to.equal(1, 'Check event fires for locally-applied operation');
            expect(receivedEvents[0]).to.deep.equal(
              { action: 'counter.inc', number: 5 },
              'Check event from local apply has correct structure',
            );

            // restore normal echo handling before testing the Realtime path
            interceptor.restore();

            // 2. trigger operation via REST (received over Realtime)
            const realtimeEventPromise = waitForCounterUpdate(counter);
            await objectsHelper.operationRequest(
              channelName,
              objectsHelper.counterIncRestOp({ objectId: counterId, number: 10 }),
            );
            await realtimeEventPromise;

            expect(receivedEvents.length).to.equal(2, 'Check event fires for Realtime-received operation');
            expect(receivedEvents[1]).to.deep.equal(
              { action: 'counter.inc', number: 10 },
              'Check event from Realtime receive has correct structure',
            );

            // verify final state
            expect(counter.value()).to.equal(15, 'Check counter reflects both operations');
          }, client);
        });
      });
    });

    /** @nospec */
    describe('Sync events', () => {
      const syncEventsScenarios = [
        // 1. ATTACHED with HAS_OBJECTS false

        {
          description:
            'The first ATTACHED should always provoke a SYNCING even when HAS_OBJECTS is false, so that the SYNCED is preceded by SYNCING',
          channelEvents: [{ type: 'attached', hasObjects: false }],
          expectedSyncEvents: ['syncing', 'synced'],
        },

        {
          description: 'ATTACHED with HAS_OBJECTS false once SYNCED emits SYNCING and then SYNCED',
          channelEvents: [
            { type: 'attached', hasObjects: false },
            { type: 'attached', hasObjects: false },
          ],
          expectedSyncEvents: [
            'syncing',
            'synced', // The initial SYNCED
            'syncing',
            'synced', // From the subsequent ATTACHED
          ],
        },

        {
          description:
            "If we're in SYNCING awaiting an OBJECT_SYNC but then instead get an ATTACHED with HAS_OBJECTS false, we should emit a SYNCED",
          channelEvents: [
            { type: 'attached', hasObjects: true },
            { type: 'attached', hasObjects: false },
          ],
          expectedSyncEvents: ['syncing', 'synced'],
        },

        // 2. ATTACHED with HAS_OBJECTS true

        {
          description: 'An initial ATTACHED with HAS_OBJECTS true provokes a SYNCING',
          channelEvents: [{ type: 'attached', hasObjects: true }],
          expectedSyncEvents: ['syncing'],
        },

        {
          description:
            "ATTACHED with HAS_OBJECTS true when SYNCED should provoke another SYNCING, because we're waiting to receive the updated objects in an OBJECT_SYNC",
          channelEvents: [
            { type: 'attached', hasObjects: false },
            { type: 'attached', hasObjects: true },
          ],
          expectedSyncEvents: ['syncing', 'synced', 'syncing'],
        },

        {
          description:
            "If we're in SYNCING awaiting an OBJECT_SYNC but then instead get another ATTACHED with HAS_OBJECTS true, we should remain SYNCING (i.e. not emit another event)",
          channelEvents: [
            { type: 'attached', hasObjects: true },
            { type: 'attached', hasObjects: true },
          ],
          expectedSyncEvents: ['syncing'],
        },

        // 3. OBJECT_SYNC straight after ATTACHED

        {
          description: 'A complete multi-message OBJECT_SYNC sequence after ATTACHED emits SYNCING and then SYNCED',
          channelEvents: [
            { type: 'attached', hasObjects: true },
            { type: 'objectSync', channelSerial: 'foo:1' },
            { type: 'objectSync', channelSerial: 'foo:2' },
            { type: 'objectSync', channelSerial: 'foo:' },
          ],
          expectedSyncEvents: ['syncing', 'synced'],
        },

        {
          description: 'A complete single-message OBJECT_SYNC after ATTACHED emits SYNCING and then SYNCED',
          channelEvents: [
            { type: 'attached', hasObjects: true },
            { type: 'objectSync', channelSerial: 'foo:' },
          ],
          expectedSyncEvents: ['syncing', 'synced'],
        },

        {
          description: 'SYNCED is not emitted midway through a multi-message OBJECT_SYNC sequence',
          channelEvents: [
            { type: 'attached', hasObjects: true },
            { type: 'objectSync', channelSerial: 'foo:1' },
            { type: 'objectSync', channelSerial: 'foo:2' },
          ],
          expectedSyncEvents: ['syncing'],
        },

        // 4. OBJECT_SYNC when already SYNCED

        {
          description:
            'A complete multi-message OBJECT_SYNC sequence when already SYNCED emits SYNCING and then SYNCED',
          channelEvents: [
            { type: 'attached', hasObjects: false }, // to get us to SYNCED
            { type: 'objectSync', channelSerial: 'foo:1' },
            { type: 'objectSync', channelSerial: 'foo:2' },
            { type: 'objectSync', channelSerial: 'foo:' },
          ],
          expectedSyncEvents: [
            'syncing',
            'synced', // The initial SYNCED
            'syncing',
            'synced', // From the complete OBJECT_SYNC
          ],
        },

        {
          description: 'A complete single-message OBJECT_SYNC when already SYNCED emits SYNCING and then SYNCED',
          channelEvents: [
            { type: 'attached', hasObjects: false }, // to get us to SYNCED
            { type: 'objectSync', channelSerial: 'foo:' },
          ],
          expectedSyncEvents: [
            'syncing',
            'synced', // The initial SYNCED
            'syncing',
            'synced', // From the complete OBJECT_SYNC
          ],
        },

        // 5. New sync sequence in the middle of a sync sequence

        {
          description: 'A new OBJECT_SYNC sequence in the middle of a sync sequence does not provoke another SYNCING',
          channelEvents: [
            { type: 'attached', hasObjects: true },
            { type: 'objectSync', channelSerial: 'foo:1' },
            { type: 'objectSync', channelSerial: 'foo:2' },
            { type: 'objectSync', channelSerial: 'bar:1' },
          ],
          expectedSyncEvents: ['syncing'],
        },
      ];

      forScenarios(this, syncEventsScenarios, async function (helper, scenario, clientOptions, channelName) {
        const client = RealtimeWithLiveObjects(helper, clientOptions);
        const objectsHelper = new LiveObjectsHelper(helper);

        await helper.monitorConnectionThenCloseAndFinishAsync(async () => {
          await client.connection.whenState('connected');

          // Note that we don't attach the channel, so that the only ProtocolMessages the channel receives are those specified by the test scenario.

          const channel = client.channels.get(channelName, channelOptionsWithObjectModes());
          const object = channel.object;

          // Track received sync events
          const receivedSyncEvents = [];

          // Subscribe to syncing and synced events
          object.on('syncing', () => {
            receivedSyncEvents.push('syncing');
          });
          object.on('synced', () => {
            receivedSyncEvents.push('synced');
          });

          // Apply the sequence of channel events described by the scenario
          for (const channelEvent of scenario.channelEvents) {
            if (channelEvent.type === 'attached') {
              const hasObjects = channelEvent.hasObjects ? 1 << 7 : 0; // HAS_OBJECTS flag is bit 7
              await injectAttachedMessage(helper, channel, hasObjects);
            } else if (channelEvent.type === 'objectSync') {
              await objectsHelper.processObjectStateMessageOnChannel({
                channel,
                syncSerial: channelEvent.channelSerial,
              });
            }
          }

          // wait for next tick to ensure channel has processed the ATTACHED/object sync message and has emitted resulting sync events
          await new Promise((res) => nextTick(res));

          // Verify the expected sequence of sync events
          expect(receivedSyncEvents).to.deep.equal(
            scenario.expectedSyncEvents,
            'Check sync events match expected sequence',
          );
        }, client);
      });
    });
  });
});
