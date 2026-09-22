'use strict';

/**
 * Helper class to create pre-determined objects tree on channels and create object messages.
 */
define(['ably', 'shared_helper', 'liveobjects'], function (Ably, Helper, LiveObjectsPlugin) {
  const createPM = Ably.makeProtocolMessageFromDeserialized({ LiveObjectsPlugin });

  const ACTIONS = {
    MAP_CREATE: 0,
    MAP_SET: 1,
    MAP_REMOVE: 2,
    COUNTER_CREATE: 3,
    COUNTER_INC: 4,
    OBJECT_DELETE: 5,
    MAP_CLEAR: 6,
  };
  const ACTION_STRINGS = {
    MAP_CREATE: 'MAP_CREATE',
    MAP_SET: 'MAP_SET',
    MAP_REMOVE: 'MAP_REMOVE',
    COUNTER_CREATE: 'COUNTER_CREATE',
    COUNTER_INC: 'COUNTER_INC',
    OBJECT_DELETE: 'OBJECT_DELETE',
    MAP_CLEAR: 'MAP_CLEAR',
  };

  /**
   * Fixture data for all primitive value types that can be stored in a map entry.
   * Each entry describes a key, its JSON-protocol ObjectData representation (`jsonData`),
   * and expected values when read back in compact JSON format.
   */
  const primitiveKeyData = [
    { key: 'stringKey', jsonData: { string: 'stringValue' }, compactValue: 'stringValue' },
    { key: 'emptyStringKey', jsonData: { string: '' }, compactValue: '' },
    {
      key: 'bytesKey',
      jsonData: { bytes: 'eyJwcm9kdWN0SWQiOiAiMDAxIiwgInByb2R1Y3ROYW1lIjogImNhciJ9' },
      compactValue: 'eyJwcm9kdWN0SWQiOiAiMDAxIiwgInByb2R1Y3ROYW1lIjogImNhciJ9',
    },
    {
      key: 'emptyBytesKey',
      jsonData: { bytes: '' },
      compactValue: '',
    },
    { key: 'maxSafeIntegerKey', jsonData: { number: Number.MAX_SAFE_INTEGER }, compactValue: Number.MAX_SAFE_INTEGER },
    {
      key: 'negativeMaxSafeIntegerKey',
      jsonData: { number: -Number.MAX_SAFE_INTEGER },
      compactValue: -Number.MAX_SAFE_INTEGER,
    },
    { key: 'numberKey', jsonData: { number: 1 }, compactValue: 1 },
    { key: 'zeroKey', jsonData: { number: 0 }, compactValue: 0 },
    { key: 'trueKey', jsonData: { boolean: true }, compactValue: true },
    { key: 'falseKey', jsonData: { boolean: false }, compactValue: false },
    {
      key: 'objectKey',
      jsonData: { json: JSON.stringify({ foo: 'bar' }) },
      compactValue: '{"foo":"bar"}',
    },
    {
      key: 'arrayKey',
      jsonData: { json: JSON.stringify(['foo', 'bar', 'baz']) },
      compactValue: '["foo","bar","baz"]',
    },
  ];

  class LiveObjectsHelper {
    constructor(helper) {
      this._helper = helper;
      this._rest = helper.AblyRest({ useBinaryProtocol: false });
    }

    static ACTIONS = ACTIONS;
    static primitiveKeyData = primitiveKeyData;

    static fixtureRootKeys() {
      return ['emptyCounter', 'initialValueCounter', 'referencedCounter', 'emptyMap', 'referencedMap', 'valuesMap'];
    }

    /**
     * It could take some time for all keys to be set on a fixture channel.
     * This function waits for a channel to have all keys set.
     */
    static async waitFixtureChannelIsReady(client, channelName) {
      const channel = client.channels.get(channelName, { modes: ['OBJECT_SUBSCRIBE', 'OBJECT_PUBLISH'] });
      const expectedKeys = LiveObjectsHelper.fixtureRootKeys();

      await channel.attach();
      const entryPathObject = await channel.object.get();
      const entryInstance = entryPathObject.instance();

      await Promise.all(
        expectedKeys.map((key) =>
          entryInstance.get(key) ? undefined : LiveObjectsHelper.waitForMapKeyUpdate(entryInstance, key),
        ),
      );
    }

    static async waitForMapKeyUpdate(mapInstance, key) {
      return new Promise((resolve) => {
        const { unsubscribe } = mapInstance.subscribe(({ message }) => {
          if ((message?.operation?.mapSet?.key ?? message?.operation?.mapRemove?.key) === key) {
            unsubscribe();
            resolve();
          }
        });
      });
    }

    static async waitForMapClear(mapInstance) {
      return new Promise((resolve) => {
        const { unsubscribe } = mapInstance.subscribe(({ message }) => {
          if (message?.operation?.action === 'map.clear') {
            unsubscribe();
            resolve();
          }
        });
      });
    }

    static async waitForCounterUpdate(counterInstance) {
      return new Promise((resolve) => {
        const { unsubscribe } = counterInstance.subscribe(() => {
          unsubscribe();
          resolve();
        });
      });
    }

    static async waitForObjectOperation(helper, client, waitForAction) {
      return new Promise((resolve, reject) => {
        helper.recordPrivateApi('call.connectionManager.activeProtocol.getTransport');
        const transport = client.connection.connectionManager.activeProtocol.getTransport();
        const onProtocolMessageOriginal = transport.onProtocolMessage;

        helper.recordPrivateApi('replace.transport.onProtocolMessage');
        transport.onProtocolMessage = function (message) {
          try {
            helper.recordPrivateApi('call.transport.onProtocolMessage');
            onProtocolMessageOriginal.call(transport, message);

            if (message.action === 19 && message.state[0]?.operation?.action === waitForAction) {
              helper.recordPrivateApi('replace.transport.onProtocolMessage');
              transport.onProtocolMessage = onProtocolMessageOriginal;
              resolve();
            }
          } catch (err) {
            reject(err);
          }
        };
      });
    }

    static async waitForObjectSync(helper, client) {
      return new Promise((resolve, reject) => {
        helper.recordPrivateApi('call.connectionManager.activeProtocol.getTransport');
        const transport = client.connection.connectionManager.activeProtocol.getTransport();
        const onProtocolMessageOriginal = transport.onProtocolMessage;

        helper.recordPrivateApi('replace.transport.onProtocolMessage');
        transport.onProtocolMessage = function (message) {
          try {
            helper.recordPrivateApi('call.transport.onProtocolMessage');
            onProtocolMessageOriginal.call(transport, message);

            if (message.action === 20) {
              helper.recordPrivateApi('replace.transport.onProtocolMessage');
              transport.onProtocolMessage = onProtocolMessageOriginal;
              resolve();
            }
          } catch (err) {
            reject(err);
          }
        };
      });
    }

    /**
     * Sends Objects REST API requests to create objects tree on a provided channel:
     *
     * root "emptyMap" -> Map#1 {} -- empty map
     * root "referencedMap" -> Map#2 { "counterKey": <object id Counter#3> }
     * root "valuesMap" -> Map#3 { "stringKey": "stringValue", "emptyStringKey": "", "bytesKey": <byte array for "{"productId": "001", "productName": "car"}", encoded in base64>, "emptyBytesKey": <empty byte array>, "maxSafeIntegerKey": Number.MAX_SAFE_INTEGER, "negativeMaxSafeIntegerKey": -Number.MAX_SAFE_INTEGER, "numberKey": 1, "zeroKey": 0, "trueKey": true, "falseKey": false, "objectKey": { "foo": "bar" }, "arrayKey": ["foo", "bar", "baz"], "mapKey": <objectId of Map#2> }
     * root "emptyCounter" -> Counter#1 -- no initial value counter, should be 0
     * root "initialValueCounter" -> Counter#2 count=10
     * root "referencedCounter" -> Counter#3 count=20
     */
    async initForChannel(channelName) {
      const emptyCounter = await this.createAndSetOnMap(channelName, {
        mapObjectId: 'root',
        key: 'emptyCounter',
        createOp: this.counterCreateRestOp(),
      });
      const initialValueCounter = await this.createAndSetOnMap(channelName, {
        mapObjectId: 'root',
        key: 'initialValueCounter',
        createOp: this.counterCreateRestOp({ number: 10 }),
      });
      const referencedCounter = await this.createAndSetOnMap(channelName, {
        mapObjectId: 'root',
        key: 'referencedCounter',
        createOp: this.counterCreateRestOp({ number: 20 }),
      });

      const emptyMap = await this.createAndSetOnMap(channelName, {
        mapObjectId: 'root',
        key: 'emptyMap',
        createOp: this.mapCreateRestOp(),
      });
      const referencedMap = await this.createAndSetOnMap(channelName, {
        mapObjectId: 'root',
        key: 'referencedMap',
        createOp: this.mapCreateRestOp({ data: { counterKey: { objectId: referencedCounter.objectId } } }),
      });

      const valuesMapData = primitiveKeyData.reduce((acc, v) => {
        acc[v.key] = v.jsonData;
        return acc;
      }, {});
      valuesMapData.mapKey = { objectId: referencedMap.objectId };

      const valuesMap = await this.createAndSetOnMap(channelName, {
        mapObjectId: 'root',
        key: 'valuesMap',
        createOp: this.mapCreateRestOp({ data: valuesMapData }),
      });
    }

    // #region Channel Operations

    mapCreateOp(opts) {
      const { objectId, entries } = opts ?? {};
      const op = {
        operation: {
          action: ACTIONS.MAP_CREATE,
          objectId,
          mapCreate: {
            semantics: 0,
            entries: entries ?? {},
          },
        },
      };

      return op;
    }

    mapSetOp(opts) {
      const { objectId, key, data } = opts ?? {};
      const op = {
        operation: {
          action: ACTIONS.MAP_SET,
          objectId,
          mapSet: {
            key,
            value: data,
          },
        },
      };

      return op;
    }

    mapRemoveOp(opts) {
      const { objectId, key } = opts ?? {};
      const op = {
        operation: {
          action: ACTIONS.MAP_REMOVE,
          objectId,
          mapRemove: {
            key,
          },
        },
      };

      return op;
    }

    counterCreateOp(opts) {
      const { objectId, count } = opts ?? {};
      const op = {
        operation: {
          action: ACTIONS.COUNTER_CREATE,
          objectId,
          counterCreate: {
            count: count ?? 0,
          },
        },
      };

      return op;
    }

    counterIncOp(opts) {
      const { objectId, amount } = opts ?? {};
      const op = {
        operation: {
          action: ACTIONS.COUNTER_INC,
          objectId,
          counterInc: {
            number: amount,
          },
        },
      };

      return op;
    }

    objectDeleteOp(opts) {
      const { objectId } = opts ?? {};
      const op = {
        operation: {
          action: ACTIONS.OBJECT_DELETE,
          objectId,
          objectDelete: {},
        },
      };

      return op;
    }

    mapClearOp(opts) {
      const { objectId } = opts ?? {};
      const op = {
        operation: {
          action: ACTIONS.MAP_CLEAR,
          objectId,
          mapClear: {},
        },
      };

      return op;
    }

    mapObject(opts) {
      const { objectId, siteTimeserials, initialEntries, materialisedEntries, tombstone, clearTimeserial } = opts;
      const obj = {
        object: {
          objectId,
          siteTimeserials,
          tombstone: tombstone === true,
          map: {
            semantics: 0,
            entries: materialisedEntries,
            ...(clearTimeserial != null ? { clearTimeserial } : {}),
          },
        },
      };

      if (initialEntries) {
        obj.object.createOp = this.mapCreateOp({ objectId, entries: initialEntries }).operation;
      }

      return obj;
    }

    counterObject(opts) {
      const { objectId, siteTimeserials, initialCount, materialisedCount, tombstone } = opts;
      const obj = {
        object: {
          objectId,
          siteTimeserials,
          tombstone: tombstone === true,
          counter: {
            count: materialisedCount,
          },
        },
      };

      if (initialCount != null) {
        obj.object.createOp = this.counterCreateOp({ objectId, count: initialCount }).operation;
      }

      return obj;
    }

    objectOperationMessage(opts) {
      const { channelName, serial, serialTimestamp, siteCode, state, clientId, connectionId } = opts;

      state?.forEach((objectMessage, i) => {
        objectMessage.serial = serial;
        objectMessage.serialTimestamp = serialTimestamp;
        objectMessage.siteCode = siteCode;
        objectMessage.clientId = clientId;
      });

      return {
        action: 19, // OBJECT
        channel: channelName,
        channelSerial: serial,
        connectionId,
        state: state ?? [],
      };
    }

    objectStateMessage(opts) {
      const { channelName, syncSerial, state, serialTimestamp } = opts;

      state?.forEach((objectMessage, i) => {
        objectMessage.serialTimestamp = serialTimestamp;
      });

      return {
        action: 20, // OBJECT_SYNC
        channel: channelName,
        channelSerial: syncSerial,
        state: state ?? [],
      };
    }

    async processObjectOperationMessageOnChannel(opts) {
      const { channel, ...rest } = opts;

      this._helper.recordPrivateApi('call.channel.processMessage');
      this._helper.recordPrivateApi('call.makeProtocolMessageFromDeserialized');
      await channel.processMessage(
        createPM(
          this.objectOperationMessage({
            ...rest,
            channelName: channel.name,
          }),
        ),
      );
    }

    async processObjectStateMessageOnChannel(opts) {
      const { channel, ...rest } = opts;

      this._helper.recordPrivateApi('call.channel.processMessage');
      this._helper.recordPrivateApi('call.makeProtocolMessageFromDeserialized');
      await channel.processMessage(
        createPM(
          this.objectStateMessage({
            ...rest,
            channelName: channel.name,
          }),
        ),
      );
    }

    /**
     * Sends a MAP_CLEAR operation to the server via `channel.sendState`.
     *
     * MAP_CLEAR is server-initiated and has no production client-side API,
     * but it is enabled over realtime connections on non-prod clusters for testing.
     */
    async sendMapClearOnChannel(channel, objectId) {
      this._helper.recordPrivateApi('call.channel.sendState');
      await channel.sendState([
        {
          operation: {
            action: ACTIONS.MAP_CLEAR,
            objectId,
            mapClear: {},
          },
        },
      ]);
    }

    // #endregion

    // #region REST API Operations

    async createAndSetOnMap(channelName, opts) {
      const { mapObjectId, key, createOp } = opts;

      const createResult = await this.operationRequest(channelName, createOp);
      const objectId = createResult.objectId;
      await this.operationRequest(channelName, this.mapSetRestOp({ objectId: mapObjectId, key, value: { objectId } }));

      return createResult;
    }

    mapCreateRestOp(opts) {
      const { objectId, nonce, data } = opts ?? {};
      const opBody = {
        mapCreate: {
          semantics: 0,
        },
      };

      if (data) {
        // Convert data format: { key: { string: 'value' } } -> { key: { data: { string: 'value' } } }
        const entries = {};
        for (const [key, value] of Object.entries(data)) {
          entries[key] = { data: value };
        }
        opBody.mapCreate.entries = entries;
      }

      if (objectId != null) {
        opBody.objectId = objectId;
        opBody.nonce = nonce;
      }

      return opBody;
    }

    mapSetRestOp(opts) {
      const { objectId, key, value } = opts ?? {};
      const opBody = {
        objectId,
        mapSet: {
          key,
          value,
        },
      };

      return opBody;
    }

    mapRemoveRestOp(opts) {
      const { objectId, key } = opts ?? {};
      const opBody = {
        objectId,
        mapRemove: {
          key,
        },
      };

      return opBody;
    }

    counterCreateRestOp(opts) {
      const { objectId, nonce, number } = opts ?? {};
      const opBody = {
        counterCreate: {},
      };

      if (number != null) {
        opBody.counterCreate.count = number;
      }

      if (objectId != null) {
        opBody.objectId = objectId;
        opBody.nonce = nonce;
      }

      return opBody;
    }

    counterIncRestOp(opts) {
      const { objectId, number } = opts ?? {};
      const opBody = {
        objectId,
        counterInc: {
          number,
        },
      };

      return opBody;
    }

    async operationRequest(channelName, opBody) {
      if (Array.isArray(opBody)) {
        throw new Error(`Only single object operation requests are supported`);
      }

      const method = 'post';
      const path = `/channels/${channelName}/objects`;

      const response = await this._rest.request(method, path, 3, null, opBody, null);

      if (response.success) {
        // only one operation in the request, so need only the first item.
        const result = response.items[0];
        // extract objectId if present
        result.objectId = result.objectIds?.[0];
        return result;
      }

      throw new Error(
        `${method}: ${path} FAILED; http code = ${response.statusCode}, error code = ${response.errorCode}, message = ${response.errorMessage}; operation = ${JSON.stringify(opBody)}`,
      );
    }

    // #endregion

    fakeMapObjectId() {
      return `map:${Helper.randomString()}@${Date.now()}`;
    }

    fakeCounterObjectId() {
      return `counter:${Helper.randomString()}@${Date.now()}`;
    }
  }

  return (module.exports = LiveObjectsHelper);
});
