'use strict';

define(['ably', 'shared_helper', 'chai', 'liveobjects', 'liveobjects_helper'], function (
  Ably,
  Helper,
  chai,
  LiveObjectsPlugin,
  LiveObjectsHelper,
) {
  const expect = chai.expect;
  const Platform = Ably.Realtime.Platform;
  const BufferUtils = Platform.BufferUtils;
  const liveobjectsFixturesChannel = 'rest_liveobjects_fixtures';
  const waitFixtureChannelIsReady = LiveObjectsHelper.waitFixtureChannelIsReady;
  const primitiveKeyData = LiveObjectsHelper.primitiveKeyData;

  function RealtimeWithLiveObjects(helper, options) {
    return helper.AblyRealtime({ ...options, plugins: { LiveObjects: LiveObjectsPlugin } });
  }

  function RestWithLiveObjects(helper, options) {
    return helper.AblyRest({ ...options, plugins: { LiveObjects: LiveObjectsPlugin } });
  }

  /**
   * Runs scenarios with optionally using {@link Helper.testOnJsonMsgpack}.
   * Each scenario receives a context object with common setup already done.
   */
  function forScenarios(scenarios, testFn) {
    for (const scenario of scenarios) {
      if (scenario.jsonMsgpack) {
        /** @nospec */
        Helper.testOnJsonMsgpack(
          scenario.description,
          async function (options, channelName, helper) {
            await testFn(helper, scenario, options, channelName);
          },
          scenario.skip,
          scenario.only,
        );
      } else {
        const itFn = scenario.skip ? it.skip : scenario.only ? it.only : it;

        /** @nospec */
        itFn(scenario.description, async function () {
          const helper = this.test.helper;
          await testFn(helper, scenario, {}, scenario.description);
        });
      }
    }
  }

  /**
   * Checks that the full (from "compact: false" responses) object data entry for a key matches the expected value.
   * `keyData` is a member of `LiveObjectsHelper.primitiveKeyData` - contains the key name and its JSON-protocol
   * ObjectData representation (`jsonData`).
   */
  function checkFullObjectKeyData({ helper, keyData, obj, msg }) {
    const { key, jsonData } = keyData;
    const entryData = obj.map.entries[key].data;
    const label = msg || `full object data for "${key}"`;

    if (jsonData.bytes != null) {
      helper.recordPrivateApi('call.BufferUtils.base64Decode');
      helper.recordPrivateApi('call.BufferUtils.areBuffersEqual');
      expect(BufferUtils.areBuffersEqual(entryData.bytes, BufferUtils.base64Decode(jsonData.bytes)), label).to.be.true;
    } else if (jsonData.json != null) {
      const expectedObject = JSON.parse(jsonData.json);
      expect(entryData.json, label).to.deep.equal(expectedObject);
    } else if (jsonData.string != null) {
      expect(entryData.string, label).to.equal(jsonData.string);
    } else if (jsonData.number != null) {
      expect(entryData.number, label).to.equal(jsonData.number);
    } else if (jsonData.boolean != null) {
      expect(entryData.boolean, label).to.equal(jsonData.boolean);
    } else {
      throw new Error(
        `checkFullObjectKeyData: unrecognized jsonData shape for key "${key}": ${JSON.stringify(jsonData)}`,
      );
    }
  }

  /**
   * Checks that the compact (from "compact: true" responses) value for a key in an object matches the expected value,
   * accounting for protocol-dependent bytes handling.
   * `keyData` is a member of `LiveObjectsHelper.primitiveKeyData` - contains the key name, its JSON-protocol
   * ObjectData representation (`jsonData`), and expected compact value.
   */
  function checkCompactKeyData({ helper, keyData, obj, msg }) {
    const { key, jsonData, compactValue } = keyData;
    const value = obj[key];
    const label = msg || `compact value for "${key}"`;

    if (jsonData.bytes != null) {
      // bytes values appear as base64 strings (JSON protocol) or buffers (binary protocol)
      if (BufferUtils.isBuffer(value)) {
        helper.recordPrivateApi('call.BufferUtils.base64Decode');
        helper.recordPrivateApi('call.BufferUtils.areBuffersEqual');
        expect(BufferUtils.areBuffersEqual(value, BufferUtils.base64Decode(compactValue)), label).to.be.true;
      } else {
        expect(value, label).to.equal(compactValue);
      }
    } else {
      expect(value, label).to.equal(compactValue);
    }
  }

  /**
   * Checks that full object data matches a publish fixture's expectedData.
   * For bytes entries, compares as buffers; otherwise deep-equals the entire data object.
   */
  function checkPublishFixtureData(helper, entryData, fixture) {
    if (entryData.bytes != null) {
      helper.recordPrivateApi('call.BufferUtils.base64Decode');
      helper.recordPrivateApi('call.BufferUtils.areBuffersEqual');
      expect(
        BufferUtils.areBuffersEqual(entryData.bytes, BufferUtils.base64Decode(fixture.expectedData.bytes)),
        `published data for "${fixture.key}"`,
      ).to.be.true;
    } else {
      expect(entryData, `published data for "${fixture.key}"`).to.deep.equal(fixture.expectedData);
    }
  }

  /**
   * Data fixtures for publish tests - all supported PublishObjectData types.
   */
  function getPublishDataFixtures(helper) {
    helper.recordPrivateApi('call.BufferUtils.base64Decode');
    const bytesBuffer = BufferUtils.base64Decode('AQID');

    return [
      { key: 'pubString', publishData: { string: 'hello' }, expectedData: { string: 'hello' } },
      { key: 'pubNumber', publishData: { number: 42 }, expectedData: { number: 42 } },
      { key: 'pubBoolean', publishData: { boolean: true }, expectedData: { boolean: true } },
      { key: 'pubBytes', publishData: { bytes: bytesBuffer }, expectedData: { bytes: 'AQID' } },
      { key: 'pubJsonObject', publishData: { json: { nested: 'value' } }, expectedData: { json: { nested: 'value' } } },
      { key: 'pubJsonArray', publishData: { json: ['a', 'b', 'c'] }, expectedData: { json: ['a', 'b', 'c'] } },
    ];
  }

  describe('rest/liveobjects', function () {
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

    describe('Rest without LiveObjects plugin', () => {
      /** @nospec */
      it("throws an error when attempting to access the channel's `object` property", async function () {
        const helper = this.test.helper;
        const client = helper.AblyRest();
        const channel = client.channels.get('channel');
        expect(() => channel.object).to.throw('LiveObjects plugin not provided');
      });
    });

    describe('Rest with LiveObjects plugin', () => {
      /** @nospec */
      it("returns RestObject class instance when accessing channel's `object` property", async function () {
        const helper = this.test.helper;
        const client = RestWithLiveObjects(helper);
        const channel = client.channels.get('channel');
        Helper.expectInstanceOf(channel.object, 'RestObject');
      });

      describe('RestObject.get()', () => {
        /** @nospec */
        const getScenarios = [
          {
            jsonMsgpack: true,
            description: 'returns root object by default (no params)',
            action: async ({ channel }) => {
              const root = await channel.object.get();
              expect(root).to.exist;
              expect(root.initialValueCounter).to.equal(10);
              expect(root.emptyCounter).to.equal(0);
              expect(root.emptyMap).to.deep.equal({});
            },
          },

          {
            jsonMsgpack: true,
            description: 'defaults to compact format',
            action: async ({ channel }) => {
              const root = await channel.object.get();
              // counters appear as numbers in compact view
              expect(root.initialValueCounter).to.equal(10);
            },
          },

          {
            jsonMsgpack: true,
            description: 'with path parameter',
            action: async ({ channel }) => {
              const valuesMap = await channel.object.get({ path: 'valuesMap' });
              expect(valuesMap).to.exist;
              expect(valuesMap.stringKey).to.equal('stringValue');
            },
          },

          {
            jsonMsgpack: true,
            description: 'with objectId parameter',
            action: async ({ channel }) => {
              // get initialValueCounter by fetching full root structure and then using its objectId
              const root = await channel.object.get({ compact: false });
              const counterObjectId = root.map.entries.initialValueCounter.data.objectId;

              const result = await channel.object.get({ objectId: counterObjectId, compact: false });
              expect(result.objectId).to.equal(counterObjectId);
              expect(result.counter.data.number).to.equal(10);
            },
          },

          {
            jsonMsgpack: true,
            description: 'with objectId and path combined',
            action: async ({ channel }) => {
              // get referencedMap's objectId from the full root structure
              const root = await channel.object.get({ compact: false });
              const referencedMapId = root.map.entries.referencedMap.data.objectId;

              // use referencedMap's objectId + path to counterKey to get the counter
              const result = await channel.object.get({
                objectId: referencedMapId,
                path: 'counterKey',
                compact: false,
              });
              expect(result.counter).to.exist;
              expect(result.counter.data.number).to.equal(20);
            },
          },

          {
            jsonMsgpack: true,
            description: '"compact: true" returns all data types correctly for entries within a map path',
            action: async ({ helper, channel }) => {
              const obj = await channel.object.get();
              const valuesMap = obj.valuesMap;

              for (const keyData of primitiveKeyData) {
                checkCompactKeyData({
                  helper,
                  keyData,
                  obj: valuesMap,
                });
              }
            },
          },

          {
            jsonMsgpack: true,
            description: '"compact: true" returns number for counter path',
            action: async ({ channel }) => {
              const result = await channel.object.get({ path: 'initialValueCounter' });
              expect(result).to.be.a('number');
              expect(result).to.equal(10);
            },
          },

          {
            jsonMsgpack: true,
            description: '"compact: true" returns string for string path',
            action: async ({ channel }) => {
              const result = await channel.object.get({ path: 'valuesMap.stringKey' });
              expect(result).to.be.a('string');
              expect(result).to.equal('stringValue');
            },
          },

          {
            jsonMsgpack: true,
            description: '"compact: true" returns boolean for boolean path',
            action: async ({ channel }) => {
              const result = await channel.object.get({ path: 'valuesMap.trueKey' });
              expect(result).to.be.a('boolean');
              expect(result).to.equal(true);
            },
          },

          {
            jsonMsgpack: true,
            description: '"compact: true" returns JSON string for json object path',
            action: async ({ channel }) => {
              const result = await channel.object.get({ path: 'valuesMap.objectKey' });
              expect(result).to.be.a('string');
              expect(result).to.equal('{"foo":"bar"}');
            },
          },

          {
            jsonMsgpack: true,
            description: '"compact: true" returns JSON string for json array path',
            action: async ({ channel }) => {
              const result = await channel.object.get({ path: 'valuesMap.arrayKey' });
              expect(result).to.be.a('string');
              expect(result).to.equal('["foo","bar","baz"]');
            },
          },

          {
            jsonMsgpack: true,
            description: '"compact: true" returns string or buffer for bytes path depending on protocol',
            action: async ({ channel, options }) => {
              const result = await channel.object.get({ path: 'valuesMap.bytesKey' });
              if (options.useBinaryProtocol) {
                expect(BufferUtils.isBuffer(result), 'bytes should be a buffer in binary protocol').to.be.true;
              } else {
                expect(result).to.be.a('string');
                expect(result).to.equal('eyJwcm9kdWN0SWQiOiAiMDAxIiwgInByb2R1Y3ROYW1lIjogImNhciJ9');
              }
            },
          },

          {
            jsonMsgpack: true,
            description: '"compact: true" returns object for map path',
            action: async ({ channel }) => {
              const result = await channel.object.get({ path: 'emptyMap' });
              expect(result).to.be.an('object');
              expect(result).to.deep.equal({});
            },
          },

          {
            jsonMsgpack: true,
            description: '"compact: false" returns full map object with metadata for map path',
            action: async ({ channel }) => {
              const result = await channel.object.get({ path: 'emptyMap', compact: false });
              expect(result.objectId).to.be.a('string');
              expect(result.map).to.exist;
              expect(result.map.semantics).to.equal('lww');
              expect(result.map.entries).to.deep.equal({});
            },
          },

          {
            jsonMsgpack: true,
            description: '"compact: false" returns full counter object with metadata for counter path',
            action: async ({ channel }) => {
              const result = await channel.object.get({ path: 'initialValueCounter', compact: false });
              expect(result.objectId).to.be.a('string');
              expect(result.counter).to.exist;
              expect(result.counter.data.number).to.equal(10);
            },
          },

          {
            jsonMsgpack: true,
            description: '"compact: false" returns all data types correctly for entries within a map path',
            action: async ({ helper, channel }) => {
              const obj = await channel.object.get({ compact: false });

              expect(obj.objectId).to.equal('root');
              expect(obj.map.semantics).to.equal('lww');

              const valuesMapObj = obj.map.entries.valuesMap.data;
              expect(valuesMapObj.map.semantics).to.equal('lww');

              for (const keyData of primitiveKeyData) {
                checkFullObjectKeyData({
                  helper,
                  keyData,
                  obj: valuesMapObj,
                });
              }
            },
          },

          {
            jsonMsgpack: true,
            description: '"compact: false" returns decoded object data for string leaf',
            action: async ({ channel }) => {
              const result = await channel.object.get({ path: 'valuesMap.stringKey', compact: false });
              expect(result.string).to.equal('stringValue');
            },
          },

          {
            jsonMsgpack: true,
            description: '"compact: false" returns decoded object data for number leaf',
            action: async ({ channel }) => {
              const result = await channel.object.get({ path: 'valuesMap.numberKey', compact: false });
              expect(result.number).to.equal(1);
            },
          },

          {
            jsonMsgpack: true,
            description: '"compact: false" returns decoded object data for boolean leaf',
            action: async ({ channel }) => {
              const result = await channel.object.get({ path: 'valuesMap.trueKey', compact: false });
              expect(result.boolean).to.equal(true);
            },
          },

          {
            jsonMsgpack: true,
            description: '"compact: false" returns decoded object data with buffer for bytes leaf',
            action: async ({ helper, channel }) => {
              const result = await channel.object.get({ path: 'valuesMap.bytesKey', compact: false });
              helper.recordPrivateApi('call.BufferUtils.base64Decode');
              helper.recordPrivateApi('call.BufferUtils.areBuffersEqual');
              const expected = BufferUtils.base64Decode('eyJwcm9kdWN0SWQiOiAiMDAxIiwgInByb2R1Y3ROYW1lIjogImNhciJ9');
              expect(BufferUtils.areBuffersEqual(result.bytes, expected), 'bytes should match expected value').to.be
                .true;
            },
          },

          {
            jsonMsgpack: true,
            description: '"compact: false" returns decoded object data with parsed object for json leaf',
            action: async ({ channel }) => {
              const result = await channel.object.get({ path: 'valuesMap.objectKey', compact: false });
              expect(result.json).to.deep.equal({ foo: 'bar' });
            },
          },

          {
            jsonMsgpack: true,
            description: '"compact: false" returns decoded object data with parsed array for json array leaf',
            action: async ({ channel }) => {
              const result = await channel.object.get({ path: 'valuesMap.arrayKey', compact: false });
              expect(result.json).to.deep.equal(['foo', 'bar', 'baz']);
            },
          },

          {
            description: 'throws an error for non-existent objectId',
            action: async ({ channel }) => {
              await Helper.expectToThrowAsync(() => channel.object.get({ objectId: 'non-existent-id' }), '');
            },
          },

          {
            description: 'throws an error for non-existent path',
            action: async ({ channel }) => {
              await Helper.expectToThrowAsync(() => channel.object.get({ path: 'non-existent-path' }), '');
            },
          },
        ];

        forScenarios(getScenarios, async (helper, scenario, options) => {
          const client = RestWithLiveObjects(helper, options);
          const channel = client.channels.get(liveobjectsFixturesChannel);
          await waitFixtureChannelIsReady(RealtimeWithLiveObjects(helper, options), liveobjectsFixturesChannel);

          await scenario.action({ helper, options, channel });
        });
      });

      describe('RestObject.publish()', () => {
        /** @nospec */
        const publishScenarios = [
          {
            jsonMsgpack: true,
            description: 'mapSet via objectId with all data types',
            action: async ({ helper, channel, channelName }) => {
              const fixtures = getPublishDataFixtures(helper);

              for (const fixture of fixtures) {
                const result = await channel.object.publish({
                  objectId: 'root',
                  mapSet: { key: fixture.key, value: fixture.publishData },
                });

                expect(result.messageId).to.exist;
                expect(result.channel).to.equal(channelName);
                expect(result.objectIds).to.be.an('array');
              }

              const obj = await channel.object.get({ compact: false });
              for (const fixture of fixtures) {
                checkPublishFixtureData(helper, obj.map.entries[fixture.key].data, fixture);
              }
            },
          },

          {
            jsonMsgpack: true,
            description: 'mapSet with objectId reference',
            action: async ({ channel }) => {
              // create a counter
              await channel.object.publish({ path: 'key1', counterCreate: { count: 5 } });

              // get its objectId
              const counter = await channel.object.get({ path: 'key1', compact: false });
              const counterObjectId = counter.objectId;

              // set the same objectId on another key
              await channel.object.publish({
                objectId: 'root',
                mapSet: { key: 'key2', value: { objectId: counterObjectId } },
              });

              // both keys should reference the same object
              const updated = await channel.object.get({ compact: false });
              expect(updated.map.entries.key1.data.objectId).to.equal(counterObjectId);
              expect(updated.map.entries.key2.data.objectId).to.equal(counterObjectId);
            },
          },

          {
            jsonMsgpack: true,
            description: 'mapSet via path',
            action: async ({ channel }) => {
              // create root.outer
              await channel.object.publish({
                path: 'outer',
                mapCreate: { semantics: 'lww', entries: {} },
              });

              // create root.outer.inner
              await channel.object.publish({
                path: 'outer.inner',
                mapCreate: { semantics: 'lww', entries: {} },
              });

              // set a key on root.outer
              await channel.object.publish({
                path: 'outer',
                mapSet: { key: 'shallow', value: { number: 1 } },
              });

              // set a key in root.outer.inner using dot path
              await channel.object.publish({
                path: 'outer.inner',
                mapSet: { key: 'deep', value: { string: 'value' } },
              });

              const obj = await channel.object.get();
              expect(obj.outer.shallow).to.equal(1);
              expect(obj.outer.inner.deep).to.equal('value');
            },
          },

          {
            jsonMsgpack: true,
            description: 'mapSet via wildcard path',
            action: async ({ channel }) => {
              // create two maps under root
              await channel.object.publish({
                path: 'map1',
                mapCreate: { semantics: 'lww', entries: {} },
              });
              await channel.object.publish({
                path: 'map2',
                mapCreate: { semantics: 'lww', entries: {} },
              });

              // set a key on both maps using wildcard
              await channel.object.publish({
                path: '*',
                mapSet: { key: 'foo', value: { string: 'bar' } },
              });

              const obj = await channel.object.get();
              expect(obj.map1.foo).to.equal('bar');
              expect(obj.map2.foo).to.equal('bar');
            },
          },

          {
            jsonMsgpack: true,
            description: 'mapRemove via objectId',
            action: async ({ channel }) => {
              await channel.object.publish({
                objectId: 'root',
                mapSet: { key: 'foo', value: { string: 'bar' } },
              });

              const result = await channel.object.publish({
                objectId: 'root',
                mapRemove: { key: 'foo' },
              });

              expect(result.messageId).to.exist;
              expect(result.objectIds).to.be.an('array');

              const obj = await channel.object.get();
              expect(obj.foo).to.be.undefined;
            },
          },

          {
            jsonMsgpack: true,
            description: 'mapRemove via path',
            action: async ({ channel }) => {
              await channel.object.publish({
                path: 'map',
                mapCreate: { semantics: 'lww', entries: { foo: { data: { string: 'bar' } } } },
              });

              await channel.object.publish({
                path: 'map',
                mapRemove: { key: 'foo' },
              });

              const obj = await channel.object.get({ path: 'map' });
              expect(obj.foo).to.be.undefined;
            },
          },

          {
            jsonMsgpack: true,
            description: 'mapRemove via wildcard path',
            action: async ({ channel }) => {
              await channel.object.publish({
                path: 'parent',
                mapCreate: { semantics: 'lww', entries: {} },
              });
              await channel.object.publish({
                path: 'parent.map1',
                mapCreate: { semantics: 'lww', entries: { foo: { data: { string: 'bar1' } } } },
              });
              await channel.object.publish({
                path: 'parent.map2',
                mapCreate: { semantics: 'lww', entries: { foo: { data: { string: 'bar2' } } } },
              });

              // remove 'foo' from both children using wildcard
              await channel.object.publish({
                path: 'parent.*',
                mapRemove: { key: 'foo' },
              });

              const obj = await channel.object.get({ path: 'parent' });
              expect(obj.map1.foo).to.be.undefined;
              expect(obj.map2.foo).to.be.undefined;
            },
          },

          {
            jsonMsgpack: true,
            description: 'counterInc via objectId',
            action: async ({ channel }) => {
              await channel.object.publish({ path: 'counter', counterCreate: { count: 10 } });

              const counter = await channel.object.get({ path: 'counter', compact: false });
              const objectId = counter.objectId;

              await channel.object.publish({ objectId, counterInc: { number: 5 } });

              const result = await channel.object.get({ objectId, compact: false });
              expect(result.counter.data.number).to.equal(15);
            },
          },

          {
            jsonMsgpack: true,
            description: 'counterInc via path',
            action: async ({ channel }) => {
              await channel.object.publish({ path: 'counter', counterCreate: { count: 1 } });
              await channel.object.publish({ path: 'counter', counterInc: { number: 10 } });

              const obj = await channel.object.get();
              expect(obj.counter).to.equal(11);
            },
          },

          {
            jsonMsgpack: true,
            description: 'counterInc via wildcard path',
            action: async ({ channel }) => {
              await channel.object.publish({
                path: 'map',
                mapCreate: { semantics: 'lww', entries: {} },
              });
              await channel.object.publish({ path: 'map.counter1', counterCreate: { count: 10 } });
              await channel.object.publish({ path: 'map.counter2', counterCreate: { count: 20 } });

              await channel.object.publish({
                path: 'map.*',
                counterInc: { number: 5 },
              });

              const obj = await channel.object.get();
              expect(obj.map.counter1).to.equal(15);
              expect(obj.map.counter2).to.equal(25);
            },
          },

          {
            jsonMsgpack: true,
            description: 'mapCreate without path creates standalone object',
            action: async ({ channel }) => {
              const result = await channel.object.publish({
                mapCreate: { semantics: 'lww', entries: { foo: { data: { string: 'bar' } } } },
              });
              expect(result.objectIds.length).to.be.greaterThan(0);

              const obj = await channel.object.get({ objectId: result.objectIds[0], compact: false });
              expect(obj.objectId).to.equal(result.objectIds[0]);
              expect(obj.map.entries.foo.data.string).to.equal('bar');
            },
          },

          {
            jsonMsgpack: true,
            description: 'mapCreate with path sets key on parent map with ref to a new map',
            action: async ({ channel }) => {
              const result = await channel.object.publish({
                path: 'map',
                mapCreate: { semantics: 'lww', entries: { foo: { data: { string: 'bar' } } } },
              });
              expect(result.objectIds.length).to.be.greaterThan(0);

              const obj = await channel.object.get();
              expect(obj.map.foo).to.equal('bar');
            },
          },

          {
            jsonMsgpack: true,
            description: 'mapCreate with all data types',
            action: async ({ helper, channel }) => {
              const fixtures = getPublishDataFixtures(helper);
              const entries = {};
              for (const fixture of fixtures) {
                entries[fixture.key] = { data: fixture.publishData };
              }

              const result = await channel.object.publish({
                path: 'map',
                mapCreate: { semantics: 'lww', entries },
              });

              const obj = await channel.object.get({ objectId: result.objectIds[0], compact: false });
              for (const fixture of fixtures) {
                checkPublishFixtureData(helper, obj.map.entries[fixture.key].data, fixture);
              }
            },
          },

          {
            jsonMsgpack: true,
            description: 'mapCreate with objectId reference entry',
            action: async ({ channel }) => {
              // create a counter to reference
              await channel.object.publish({ path: 'counter', counterCreate: { count: 5 } });

              // get its objectId
              const counter = await channel.object.get({ path: 'counter', compact: false });
              const counterObjectId = counter.objectId;

              const result = await channel.object.publish({
                path: 'map',
                mapCreate: {
                  semantics: 'lww',
                  entries: { foo: { data: { objectId: counterObjectId } } },
                },
              });

              const obj = await channel.object.get({ objectId: result.objectIds[0], compact: false });
              expect(obj.map.entries.foo.data.objectId).to.equal(counterObjectId);
              expect(obj.map.entries.foo.data.counter.data.number).to.equal(5);
            },
          },

          {
            jsonMsgpack: true,
            description: 'counterCreate without path creates standalone counter',
            action: async ({ channel }) => {
              const result = await channel.object.publish({ counterCreate: { count: 42 } });
              expect(result.objectIds.length).to.be.greaterThan(0);

              const obj = await channel.object.get({ objectId: result.objectIds[0], compact: false });
              expect(obj.counter.data.number).to.equal(42);
            },
          },

          {
            jsonMsgpack: true,
            description: 'counterCreate with path sets key on parent map with ref to a new counter',
            action: async ({ channel }) => {
              await channel.object.publish({ path: 'counter', counterCreate: { count: 7 } });

              const compact = await channel.object.get();
              expect(compact.counter).to.equal(7);
            },
          },

          {
            jsonMsgpack: true,
            description: 'mapCreateWithObjectId creates map with pre-computed ID',
            action: async ({ helper, channel }) => {
              const nonce = 'test-nonce-map-' + Math.random().toString(36).slice(2);
              const initialValue = JSON.stringify({
                semantics: 0,
                entries: { name: { data: { string: 'Alice' } } },
              });
              helper.recordPrivateApi('call.ObjectId.fromInitialValue');
              const objectId = LiveObjectsPlugin.ObjectId.fromInitialValue(
                Platform,
                'map',
                initialValue,
                nonce,
                Date.now(),
              ).toString();

              const result = await channel.object.publish({
                objectId,
                mapCreateWithObjectId: { initialValue, nonce },
              });

              expect(result.objectIds[0]).to.equal(objectId);

              // link to root and verify
              await channel.object.publish({
                objectId: 'root',
                mapSet: { key: 'precomputedMap', value: { objectId } },
              });

              const compact = await channel.object.get();
              expect(compact.precomputedMap.name).to.equal('Alice');
            },
          },

          {
            jsonMsgpack: true,
            description: 'counterCreateWithObjectId creates counter with pre-computed ID',
            action: async ({ helper, channel }) => {
              const nonce = 'test-nonce-counter-' + Math.random().toString(36).slice(2);
              const initialValue = JSON.stringify({ count: 100 });
              helper.recordPrivateApi('call.ObjectId.fromInitialValue');
              const objectId = LiveObjectsPlugin.ObjectId.fromInitialValue(
                Platform,
                'counter',
                initialValue,
                nonce,
                Date.now(),
              ).toString();

              const result = await channel.object.publish({
                objectId,
                counterCreateWithObjectId: { initialValue, nonce },
              });

              expect(result.objectIds[0]).to.equal(objectId);

              // link to root and verify
              await channel.object.publish({
                objectId: 'root',
                mapSet: { key: 'precomputedCounter', value: { objectId } },
              });

              const compact = await channel.object.get();
              expect(compact.precomputedCounter).to.equal(100);
            },
          },

          {
            jsonMsgpack: true,
            description: 'idempotent publish - duplicate counterInc with same id applied once',
            action: async ({ channel }) => {
              // create a counter
              await channel.object.publish({ path: 'idempotentCounter', counterCreate: { count: 0 } });

              // get its objectId
              const counter = await channel.object.get({ path: 'idempotentCounter', compact: false });
              const objectId = counter.objectId;

              const idempotencyKey = 'unique-op-id-' + Math.random().toString(36).slice(2);

              await channel.object.publish({ id: idempotencyKey, objectId, counterInc: { number: 10 } });
              await channel.object.publish({ id: idempotencyKey, objectId, counterInc: { number: 10 } });

              const result = await channel.object.get({ objectId, compact: false });
              expect(result.counter.data.number).to.equal(10, 'counter should only be incremented once');
            },
          },
        ];

        forScenarios(publishScenarios, async (helper, scenario, options, channelName) => {
          const objectsHelper = new LiveObjectsHelper(helper);
          const client = RestWithLiveObjects(helper, options);
          const channel = client.channels.get(channelName);

          await scenario.action({ helper, options, client, channel, channelName, objectsHelper });
        });
      });

      describe('RestObject.generateObjectId()', () => {
        /** @nospec */
        const generateObjectIdScenarios = [
          {
            description: 'returns result with valid objectId, nonce and initialValue for mapCreate',
            action: async ({ channel }) => {
              const result = await channel.object.generateObjectId({
                mapCreate: {
                  semantics: 'lww',
                  entries: {
                    name: { data: { string: 'Alice' } },
                  },
                },
              });

              expect(result.objectId).to.be.a('string');
              expect(result.objectId).to.match(/^map:/);
              expect(result.nonce).to.be.a('string');
              expect(result.initialValue).to.be.a('string');
              expect(() => JSON.parse(result.initialValue)).to.not.throw();
            },
          },

          {
            description: 'returns result with valid objectId, nonce and initialValue for counterCreate',
            action: async ({ channel }) => {
              const result = await channel.object.generateObjectId({
                counterCreate: { count: 42 },
              });

              expect(result.objectId).to.be.a('string');
              expect(result.objectId).to.match(/^counter:/);
              expect(result.nonce).to.be.a('string');
              expect(result.initialValue).to.be.a('string');
              expect(() => JSON.parse(result.initialValue)).to.not.throw();
            },
          },

          {
            description: 'generates different IDs for the same payload on each call',
            action: async ({ channel }) => {
              const payload = { counterCreate: { count: 0 } };
              const result1 = await channel.object.generateObjectId(payload);
              const result2 = await channel.object.generateObjectId(payload);

              expect(result1.objectId).to.not.equal(result2.objectId);
              expect(result1.nonce).to.not.equal(result2.nonce);
              expect(result1.initialValue).to.equal(result2.initialValue);
            },
          },

          {
            description: 'throws an error if neither mapCreate nor counterCreate is provided',
            action: async ({ channel }) => {
              await Helper.expectToThrowAsync(
                () => channel.object.generateObjectId({}),
                'generateObjectId requires a mapCreate or counterCreate property',
                { withCode: 40003, withStatusCode: 400 },
              );
            },
          },

          {
            jsonMsgpack: true,
            description: 'generated map ID can be used with mapCreateWithObjectId in publish',
            action: async ({ channel }) => {
              const { objectId, nonce, initialValue } = await channel.object.generateObjectId({
                mapCreate: {
                  semantics: 'lww',
                  entries: {
                    key1: { data: { string: 'value1' } },
                  },
                },
              });

              const publishResult = await channel.object.publish({
                objectId,
                mapCreateWithObjectId: { initialValue, nonce },
              });

              expect(publishResult.objectIds).to.include(objectId);

              const obj = await channel.object.get({ objectId, compact: false });
              expect(obj.objectId).to.equal(objectId);
              expect(obj.map.entries.key1.data.string).to.equal('value1');
            },
          },

          {
            jsonMsgpack: true,
            description: 'generated counter ID can be used with counterCreateWithObjectId in publish',
            action: async ({ channel }) => {
              const { objectId, nonce, initialValue } = await channel.object.generateObjectId({
                counterCreate: { count: 100 },
              });

              const publishResult = await channel.object.publish({
                objectId,
                counterCreateWithObjectId: { initialValue, nonce },
              });

              expect(publishResult.objectIds).to.include(objectId);

              const obj = await channel.object.get({ objectId, compact: false });
              expect(obj.objectId).to.equal(objectId);
              expect(obj.counter.data.number).to.equal(100);
            },
          },
        ];

        forScenarios(generateObjectIdScenarios, async (helper, scenario, options, channelName) => {
          const client = RestWithLiveObjects(helper, options);
          const channel = client.channels.get(channelName);

          await scenario.action({ helper, channel });
        });
      });
    });
  });
});
