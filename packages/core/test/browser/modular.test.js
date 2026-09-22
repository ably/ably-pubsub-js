import {
  BaseRest,
  BaseRealtime,
  Rest,
  generateRandomKey,
  getDefaultCryptoParams,
  decodeMessage,
  decodeEncryptedMessage,
  decodeMessages,
  decodeEncryptedMessages,
  decodeEncryptedPresenceMessage,
  decodeEncryptedPresenceMessages,
  Crypto,
  MsgPack,
  RealtimePresence,
  decodePresenceMessage,
  decodePresenceMessages,
  constructPresenceMessage,
  XHRPolling,
  WebSocketTransport,
  FetchRequest,
  XHRRequest,
  MessageInteractions,
  Annotations,
  ErrorInfo,
} from '../../build/modular/index.mjs';

function registerAblyModularTests(Helper) {
  describe('browser/modular', function () {
    this.timeout(10 * 1000);
    const expect = chai.expect;
    const BufferUtils = BaseRest.Platform.BufferUtils;
    const loadTestData = async (helper, dataPath) => {
      return new Promise((resolve, reject) => {
        helper.loadTestData(dataPath, (err, testData) => (err ? reject(err) : resolve(testData)));
      });
    };

    before(function (done) {
      const helper = Helper.forHook(this);
      helper.setupApp(done);
    });

    describe('attempting to initialize with no client options', () => {
      for (const clientClass of [BaseRest, BaseRealtime]) {
        describe(clientClass.name, () => {
          /** @nospec */
          it('throws an error', () => {
            expect(() => new clientClass()).to.throw('must be initialized with a client options object');
          });
        });
      }
    });

    describe('attempting to initialize with just an API key', () => {
      for (const clientClass of [BaseRest, BaseRealtime]) {
        describe(clientClass.name, () => {
          /** @nospec */
          it('throws an error', () => {
            expect(() => new clientClass('foo:bar')).to.throw(
              'cannot be initialized with just an Ably API key; you must provide a client options object with a `plugins` property',
            );
          });
        });
      }
    });

    describe('attempting to initialize with just a token', () => {
      for (const clientClass of [BaseRest, BaseRealtime]) {
        describe(clientClass.name, () => {
          /** @nospec */
          it('throws an error', () => {
            expect(() => new clientClass('foo')).to.throw(
              'cannot be initialized with just an Ably Token; you must provide a client options object with a `plugins` property',
            );
          });
        });
      }
    });

    describe('without any plugins', () => {
      for (const clientClass of [BaseRest, BaseRealtime]) {
        describe(clientClass.name, function () {
          /** @nospec */
          it('throws an error due to the absence of an HTTP plugin', function () {
            expect(() => new clientClass(this.test.helper.ablyClientOptions())).to.throw(
              'No HTTP request plugin provided. Provide at least one of the FetchRequest or XHRRequest plugins.',
            );
          });
        });
      }
    });

    describe('Rest', () => {
      const restScenarios = [
        {
          description: 'use push admin functionality',
          action: (client) => client.push.admin.publish({ clientId: 'foo' }, { data: { bar: 'baz' } }),
        },
        { description: 'call `time()`', action: (client) => client.time() },
        {
          description: 'call `auth.createTokenRequest()` with `queryTime` option enabled',
          action: (client, helper) =>
            client.auth.createTokenRequest(undefined, {
              key: helper.getTestApp().keys[0].keyStr /* if passing authOptions you have to explicitly pass the key */,
              queryTime: true,
            }),
        },
        { description: 'call `stats()`', action: (client) => client.stats() },
        { description: 'call `request(...)`', action: (client) => client.request('get', '/channels/channel', 2) },
        {
          description: 'call `batchPublish(...)`',
          action: (client) => client.batchPublish({ channels: ['channel'], messages: { data: { foo: 'bar' } } }),
        },
        {
          description: 'call `batchPresence(...)`',
          action: (client) => client.batchPresence(['channel']),
        },
        {
          description: 'call `auth.revokeTokens(...)`',
          getAdditionalClientOptions: (helper) => {
            const testApp = helper.getTestApp();
            return { key: testApp.keys[4].keyStr /* this key has revocableTokens enabled */ };
          },
          action: (client) => client.auth.revokeTokens([{ type: 'clientId', value: 'foo' }]),
        },
        {
          description: 'call channel’s `history()`',
          action: (client) => client.channels.get('channel').history(),
        },
        {
          description: 'call channel’s `presence.history()`',
          additionalRealtimePlugins: { RealtimePresence },
          action: (client) => client.channels.get('channel').presence.history(),
        },
        {
          description: 'call channel’s `status()`',
          action: (client) => client.channels.get('channel').status(),
        },
      ];

      describe('BaseRest without explicit Rest', () => {
        for (const scenario of restScenarios) {
          /** @nospec */
          it(`allows you to ${scenario.description}`, async function () {
            const helper = this.test.helper;
            const client = new BaseRest(
              helper.ablyClientOptions({ ...scenario.getAdditionalClientOptions?.(helper), plugins: { FetchRequest } }),
            );

            let thrownError = null;
            try {
              await scenario.action(client, helper);
            } catch (error) {
              thrownError = error;
            }

            expect(thrownError).to.be.null;
          });
        }
      });

      describe('BaseRealtime with Rest', () => {
        for (const scenario of restScenarios) {
          /** @nospec */
          it(`allows you to ${scenario.description}`, async function () {
            const helper = this.test.helper;
            const client = new BaseRealtime(
              helper.ablyClientOptions({
                autoConnect: false,
                ...scenario.getAdditionalClientOptions?.(helper),
                plugins: {
                  WebSocketTransport,
                  FetchRequest,
                  Rest,
                  ...scenario.additionalRealtimePlugins,
                },
              }),
            );

            let thrownError = null;
            try {
              await scenario.action(client, helper);
            } catch (error) {
              thrownError = error;
            }

            expect(thrownError).to.be.null;
          });
        }
      });

      describe('BaseRealtime without Rest', () => {
        /** @nospec */
        it('still allows publishing and subscribing', async function () {
          const helper = this.test.helper;
          const client = new BaseRealtime(
            this.test.helper.ablyClientOptions({ plugins: { WebSocketTransport, FetchRequest } }),
          );

          await helper.monitorConnectionThenCloseAndFinishAsync(async () => {
            const channel = client.channels.get('channel');
            await channel.attach();

            const recievedMessagePromise = new Promise((resolve) => {
              channel.subscribe((message) => {
                resolve(message);
              });
            });

            await channel.publish({ data: { foo: 'bar' } });

            const receivedMessage = await recievedMessagePromise;
            expect(receivedMessage.data).to.eql({ foo: 'bar' });
          }, client);
        });

        /** @nospec */
        it('allows `auth.createTokenRequest()` without `queryTime` option enabled', async function () {
          const client = new BaseRealtime(
            this.test.helper.ablyClientOptions({ autoConnect: false, plugins: { WebSocketTransport, FetchRequest } }),
          );

          const tokenRequest = await client.auth.createTokenRequest();
          expect(tokenRequest).to.be.an('object');
        });

        for (const scenario of restScenarios) {
          /** @nospec */
          it(`throws an error when attempting to ${scenario.description}`, async function () {
            const helper = this.test.helper;
            const client = new BaseRealtime(
              this.test.helper.ablyClientOptions({
                autoConnect: false,
                ...scenario.getAdditionalClientOptions?.(helper),
                plugins: {
                  WebSocketTransport,
                  FetchRequest,
                  ...scenario.additionalRealtimePlugins,
                },
              }),
            );

            let thrownError = null;
            try {
              await scenario.action(client, helper);
            } catch (error) {
              thrownError = error;
            }

            expect(thrownError).not.to.be.null;
            expect(thrownError.message).to.equal('Rest plugin not provided');
          });
        }
      });
    });

    describe('Crypto standalone functions', () => {
      /**
       * This test does a basic sanity check for RSE2b but for a function exposed in the modular bundle,
       * so it's not really relevant to the spec item here.
       *
       * @nospec
       */
      it('generateRandomKey', async () => {
        const key = await generateRandomKey();
        expect(key).to.be.an('ArrayBuffer');
      });

      /** @nospec */
      it('getDefaultCryptoParams', async () => {
        const key = await generateRandomKey();
        const params = getDefaultCryptoParams({ key });
        expect(params).to.be.an('object');
      });
    });

    describe('Message standalone functions', () => {
      async function testDecodesMessageData(helper, functionUnderTest) {
        const testData = await loadTestData(helper, helper.testResourcesPath + 'crypto-data-128.json');

        const item = testData.items[1];
        const decoded = await functionUnderTest(item.encoded);

        expect(decoded.data).to.be.an('ArrayBuffer');
      }

      describe('decodeMessage', () => {
        /**
         * This tests TM3 (fromEncoded part) but for a function exposed in the modular bundle,
         * so it's not really relevant to the spec item.
         *
         * @nospec
         */
        it('decodes a message’s data', async function () {
          testDecodesMessageData(this.test.helper, decodeMessage);
        });

        /** @nospec */
        it('throws an error when given channel options with a cipher', async function () {
          const helper = this.test.helper;
          const testData = await loadTestData(helper, helper.testResourcesPath + 'crypto-data-128.json');
          const key = BufferUtils.base64Decode(testData.key);
          const iv = BufferUtils.base64Decode(testData.iv);

          let thrownError = null;
          try {
            await decodeMessage(testData.items[0].encrypted, { cipher: { key, iv } });
          } catch (error) {
            thrownError = error;
          }

          expect(thrownError).not.to.be.null;
          expect(thrownError.message).to.equal('Crypto plugin not provided');
        });
      });

      describe('decodeEncryptedMessage', async () => {
        /** @nospec */
        it('decodes a message’s data', async function () {
          testDecodesMessageData(this.test.helper, decodeEncryptedMessage);
        });

        /** @nospec */
        it('decrypts a message', async function () {
          const helper = this.test.helper;
          const testData = await loadTestData(helper, helper.testResourcesPath + 'crypto-data-128.json');

          const key = BufferUtils.base64Decode(testData.key);
          const iv = BufferUtils.base64Decode(testData.iv);

          for (const item of testData.items) {
            const [decodedFromEncoded, decodedFromEncrypted] = await Promise.all([
              decodeMessage(item.encoded),
              decodeEncryptedMessage(item.encrypted, { cipher: { key, iv } }),
            ]);

            this.test.helper.testMessageEquality(decodedFromEncoded, decodedFromEncrypted);
          }
        });
      });

      describe('decodeEncryptedPresenceMessage', async () => {
        /** @nospec */
        it('decrypts a presence message', async function () {
          const helper = this.test.helper;
          const testData = await loadTestData(helper, helper.testResourcesPath + 'crypto-data-128.json');

          const key = BufferUtils.base64Decode(testData.key);
          const iv = BufferUtils.base64Decode(testData.iv);

          for (const item of testData.items) {
            const [decodedFromEncoded, decodedFromEncrypted] = await Promise.all([
              decodePresenceMessage(item.encoded),
              decodeEncryptedPresenceMessage(item.encrypted, { cipher: { key, iv } }),
            ]);

            this.test.helper.testMessageEquality(decodedFromEncoded, decodedFromEncrypted);
          }
        });
      });

      async function testDecodesMessagesData(helper, functionUnderTest) {
        const testData = await loadTestData(helper, helper.testResourcesPath + 'crypto-data-128.json');

        const items = [testData.items[1], testData.items[3]];
        const decoded = await functionUnderTest(items.map((item) => item.encoded));

        expect(decoded[0].data).to.be.an('ArrayBuffer');
        expect(decoded[1].data).to.be.an('array');
      }

      describe('decodeMessages', () => {
        /**
         * This tests TM3 (fromEncodedArray part) but for a function exposed in the modular bundle,
         * so it's not really relevant to the spec item.
         *
         * @nospec
         */
        it('decodes messages’ data', async function () {
          testDecodesMessagesData(this.test.helper, decodeMessages);
        });

        /** @nospec */
        it('throws an error when given channel options with a cipher', async function () {
          const helper = this.test.helper;
          const testData = await loadTestData(helper, helper.testResourcesPath + 'crypto-data-128.json');
          const key = BufferUtils.base64Decode(testData.key);
          const iv = BufferUtils.base64Decode(testData.iv);

          let thrownError = null;
          try {
            await decodeMessages(
              testData.items.map((item) => item.encrypted),
              { cipher: { key, iv } },
            );
          } catch (error) {
            thrownError = error;
          }

          expect(thrownError).not.to.be.null;
          expect(thrownError.message).to.equal('Crypto plugin not provided');
        });
      });

      describe('decodeEncryptedMessages', () => {
        /** @nospec */
        it('decodes messages’ data', async function () {
          testDecodesMessagesData(this.test.helper, decodeEncryptedMessages);
        });

        /** @nospec */
        it('decrypts messages', async function () {
          const helper = this.test.helper;
          const testData = await loadTestData(helper, helper.testResourcesPath + 'crypto-data-128.json');

          const key = BufferUtils.base64Decode(testData.key);
          const iv = BufferUtils.base64Decode(testData.iv);

          const [decodedFromEncoded, decodedFromEncrypted] = await Promise.all([
            decodeMessages(testData.items.map((item) => item.encoded)),
            decodeEncryptedMessages(
              testData.items.map((item) => item.encrypted),
              { cipher: { key, iv } },
            ),
          ]);

          for (let i = 0; i < decodedFromEncoded.length; i++) {
            this.test.helper.testMessageEquality(decodedFromEncoded[i], decodedFromEncrypted[i]);
          }
        });
      });

      describe('decodeEncryptedPresenceMessages', () => {
        /** @nospec */
        it('decrypts messages', async function () {
          const helper = this.test.helper;
          const testData = await loadTestData(helper, helper.testResourcesPath + 'crypto-data-128.json');

          const key = BufferUtils.base64Decode(testData.key);
          const iv = BufferUtils.base64Decode(testData.iv);

          const [decodedFromEncoded, decodedFromEncrypted] = await Promise.all([
            decodePresenceMessages(testData.items.map((item) => item.encoded)),
            decodeEncryptedPresenceMessages(
              testData.items.map((item) => item.encrypted),
              { cipher: { key, iv } },
            ),
          ]);

          for (let i = 0; i < decodedFromEncoded.length; i++) {
            this.test.helper.testMessageEquality(decodedFromEncoded[i], decodedFromEncrypted[i]);
          }
        });
      });
    });

    describe('Crypto', () => {
      describe('without Crypto', () => {
        async function testThrowsAnErrorWhenGivenChannelOptionsWithACipher(helper, clientClassConfig) {
          const client = new clientClassConfig.clientClass(
            helper.ablyClientOptions({
              ...clientClassConfig.additionalClientOptions,
              plugins: {
                ...clientClassConfig.additionalPlugins,
                FetchRequest,
              },
            }),
          );
          const key = await generateRandomKey();
          expect(() => client.channels.get('channel', { cipher: { key } })).to.throw('Crypto plugin not provided');
        }

        for (const clientClassConfig of [
          { clientClass: BaseRest },
          {
            clientClass: BaseRealtime,
            additionalClientOptions: { autoConnect: false },
            additionalPlugins: { WebSocketTransport },
          },
        ]) {
          describe(clientClassConfig.clientClass.name, () => {
            /** @nospec */
            it('throws an error when given channel options with a cipher', async function () {
              await testThrowsAnErrorWhenGivenChannelOptionsWithACipher(this.test.helper, clientClassConfig);
            });
          });
        }
      });

      describe('with Crypto', () => {
        async function testIsAbleToPublishEncryptedMessages(helper, clientClassConfig) {
          const clientOptions = helper.ablyClientOptions();

          const key = await generateRandomKey();

          // Publish the message on a channel configured to use encryption, and receive it on one not configured to use encryption

          const rxClient = new BaseRealtime({ ...clientOptions, plugins: { WebSocketTransport, FetchRequest } });

          await helper.monitorConnectionThenCloseAndFinishAsync(async () => {
            const rxChannel = rxClient.channels.get('channel');
            await rxChannel.attach();

            const rxMessagePromise = new Promise((resolve, _) => rxChannel.subscribe((message) => resolve(message)));

            const encryptionChannelOptions = { cipher: { key } };

            const txMessage = { name: 'message', data: 'data' };
            const txClient = new clientClassConfig.clientClass({
              ...clientOptions,
              plugins: {
                ...clientClassConfig.additionalPlugins,
                FetchRequest,
                Crypto,
              },
            });

            const action = async () => {
              const txChannel = txClient.channels.get('channel', encryptionChannelOptions);
              await txChannel.publish(txMessage);

              const rxMessage = await rxMessagePromise;

              // Verify that the message was published with encryption
              expect(rxMessage.encoding).to.equal('utf-8/cipher+aes-256-cbc');

              // Verify that the message was correctly encrypted
              const rxMessageDecrypted = await decodeEncryptedMessage(rxMessage, encryptionChannelOptions);
              helper.testMessageEquality(rxMessageDecrypted, txMessage);
            };

            if (clientClassConfig.isRealtime) {
              await helper.monitorConnectionThenCloseAndFinishAsync(action, txClient);
            } else {
              await action();
            }
          }, rxClient);
        }

        async function testIsAbleToDecryptHistoryMessages(helper, clientClassConfig) {
          const clientOptions = helper.ablyClientOptions();

          const client = new clientClassConfig.clientClass({
            ...clientOptions,
            plugins: {
              ...clientClassConfig.additionalPlugins,
              FetchRequest,
              Crypto,
            },
          });

          await (
            clientClassConfig.isRealtime
              ? (op, realtime) => helper.monitorConnectionThenCloseAndFinishAsync(op, realtime)
              : async (op) => await op()
          )(async () => {
            // The channel name must be unique per client-class variant: both variants run
            // against the same app with different random cipher keys, and a shared channel
            // would let the history wait below be satisfied by the other variant's message,
            // which then fails to decrypt with this variant's key.
            const channelName = 'encrypted_history_' + clientClassConfig.clientClass.name,
              messageText = 'Test message';

            const key = await generateRandomKey();

            const channel = client.channels.get(channelName, { cipher: { key: key } });
            await channel.publish('event0', messageText);
            let items;
            await helper.waitFor(async () => {
              items = (await channel.history()).items;
              return items.length > 0;
            }, 10_000);
            expect(items[0].data).to.equal(messageText);
          }, client);
        }

        for (const clientClassConfig of [
          { clientClass: BaseRest, isRealtime: false },
          {
            clientClass: BaseRealtime,
            additionalPlugins: { WebSocketTransport },
            isRealtime: true,
          },
        ]) {
          describe(clientClassConfig.clientClass.name, () => {
            /** @nospec */
            it('is able to publish encrypted messages', async function () {
              await testIsAbleToPublishEncryptedMessages(this.test.helper, clientClassConfig);
            });
          });
        }

        for (const clientClassConfig of [
          { clientClass: BaseRest, isRealtime: false },
          {
            clientClass: BaseRealtime,
            additionalPlugins: { WebSocketTransport, Rest },
            isRealtime: true,
          },
        ]) {
          describe(clientClassConfig.clientClass.name, () => {
            /** @nospec */
            it('is able to decrypt history messages', async function () {
              await testIsAbleToDecryptHistoryMessages(this.test.helper, clientClassConfig);
            });
          });
        }
      });
    });

    describe('MsgPack', () => {
      async function testRestUsesContentType(rest, expectedContentType) {
        const channelName = 'channel';
        const channel = rest.channels.get(channelName);
        const contentTypeUsedForPublishPromise = new Promise((resolve, reject) => {
          const originalDo = rest.http.do;
          rest.http.do = async (method, path, headers, body, params) => {
            if (method == 'post' && path == `/channels/${channelName}/messages`) {
              resolve(headers['content-type']);
            }
            return originalDo.call(rest.http, method, path, headers, body, params);
          };
        });

        await channel.publish('message', 'body');

        const contentTypeUsedForPublish = await contentTypeUsedForPublishPromise;
        expect(contentTypeUsedForPublish).to.equal(expectedContentType);
      }

      async function testRealtimeUsesFormat(realtime, expectedFormat) {
        const formatUsedForConnectionPromise = new Promise((resolve, reject) => {
          realtime.connection.connectionManager.connectImpl = (transportParams) => {
            resolve(transportParams.format);
          };
        });
        realtime.connect();

        const formatUsedForConnection = await formatUsedForConnectionPromise;
        expect(formatUsedForConnection).to.equal(expectedFormat);
      }

      // TODO once https://github.com/ably/ably-js/issues/1424 is fixed, this should also test the case where the useBinaryProtocol option is not specified
      describe('with useBinaryProtocol client option', () => {
        describe('without MsgPack', () => {
          describe('BaseRest', () => {
            /** @nospec */
            it('uses JSON', async function () {
              const client = new BaseRest(
                this.test.helper.ablyClientOptions({ useBinaryProtocol: true, plugins: { FetchRequest } }),
              );
              await testRestUsesContentType(client, 'application/json');
            });
          });

          describe('BaseRealtime', () => {
            /** @nospec */
            it('uses JSON', async function () {
              const helper = this.test.helper;
              const client = new BaseRealtime(
                helper.ablyClientOptions({
                  useBinaryProtocol: true,
                  autoConnect: false,
                  plugins: {
                    WebSocketTransport,
                    FetchRequest,
                  },
                }),
              );

              await helper.monitorConnectionThenCloseAndFinishAsync(async () => {
                await testRealtimeUsesFormat(client, 'json');
              }, client);
            });
          });
        });

        describe('with MsgPack', () => {
          describe('BaseRest', () => {
            /** @nospec */
            it('uses MessagePack', async function () {
              const client = new BaseRest(
                this.test.helper.ablyClientOptions({
                  useBinaryProtocol: true,
                  plugins: {
                    FetchRequest,
                    MsgPack,
                  },
                }),
              );
              await testRestUsesContentType(client, 'application/x-msgpack');
            });
          });

          describe('BaseRealtime', () => {
            /** @nospec */
            it('uses MessagePack', async function () {
              const helper = this.test.helper;
              const client = new BaseRealtime(
                helper.ablyClientOptions({
                  useBinaryProtocol: true,
                  autoConnect: false,
                  plugins: {
                    WebSocketTransport,
                    FetchRequest,
                    MsgPack,
                  },
                }),
              );

              await helper.monitorConnectionThenCloseAndFinishAsync(async () => {
                await testRealtimeUsesFormat(client, 'msgpack');
              }, client);
            });
          });
        });
      });
    });

    describe('RealtimePresence', () => {
      describe('BaseRealtime without RealtimePresence', () => {
        /** @nospec */
        it('throws an error when attempting to access the `presence` property', async function () {
          const helper = this.test.helper;
          const client = new BaseRealtime(helper.ablyClientOptions({ plugins: { WebSocketTransport, FetchRequest } }));

          await helper.monitorConnectionThenCloseAndFinishAsync(async () => {
            const channel = client.channels.get('channel');

            expect(() => channel.presence).to.throw('RealtimePresence plugin not provided');
          }, client);
        });

        /** @nospec */
        it('doesn’t break when it receives a PRESENCE ProtocolMessage', async function () {
          const helper = this.test.helper;
          const rxClient = new BaseRealtime(
            helper.ablyClientOptions({ plugins: { WebSocketTransport, FetchRequest } }),
          );

          await helper.monitorConnectionThenCloseAndFinishAsync(async () => {
            const rxChannel = rxClient.channels.get('channel');

            await rxChannel.attach();

            const receivedMessagePromise = new Promise((resolve) => rxChannel.subscribe(resolve));

            const txClient = new BaseRealtime(
              this.test.helper.ablyClientOptions({
                clientId: Helper.randomString(),
                plugins: {
                  WebSocketTransport,
                  FetchRequest,
                  RealtimePresence,
                },
              }),
            );

            await helper.monitorConnectionThenCloseAndFinishAsync(async () => {
              const txChannel = txClient.channels.get('channel');

              await txChannel.publish('message', 'body');
              await txChannel.presence.enter();

              // The idea being here that in order for receivedMessagePromise to resolve, rxClient must have first processed the PRESENCE ProtocolMessage that resulted from txChannel.presence.enter()

              await receivedMessagePromise;
            }, txClient);
          }, rxClient);
        });
      });

      describe('BaseRealtime with RealtimePresence', () => {
        /**
         * Tests RTP6b and RTP8a but for a RealtimePresence plugin with modular BaseRealtime,
         * so it's not explictly related to any spec item.
         *
         * @nospec
         */
        it('offers realtime presence functionality', async function () {
          const helper = this.test.helper;
          const rxClient = new BaseRealtime(
            helper.ablyClientOptions({
              plugins: {
                WebSocketTransport,
                FetchRequest,
                RealtimePresence,
              },
            }),
          );
          const rxChannel = rxClient.channels.get('channel');

          await helper.monitorConnectionThenCloseAndFinishAsync(async () => {
            const txClientId = Helper.randomString();
            const txClient = new BaseRealtime(
              this.test.helper.ablyClientOptions({
                clientId: txClientId,
                plugins: {
                  WebSocketTransport,
                  FetchRequest,
                  RealtimePresence,
                },
              }),
            );

            await helper.monitorConnectionThenCloseAndFinishAsync(async () => {
              const txChannel = txClient.channels.get('channel');

              let resolveRxPresenceMessagePromise;
              const rxPresenceMessagePromise = new Promise((resolve, reject) => {
                resolveRxPresenceMessagePromise = resolve;
              });
              await rxChannel.presence.subscribe('enter', resolveRxPresenceMessagePromise);
              await txChannel.presence.enter();

              const rxPresenceMessage = await rxPresenceMessagePromise;
              expect(rxPresenceMessage.clientId).to.equal(txClientId);
            }, txClient);
          }, rxClient);
        });
      });
    });

    describe('PresenceMessage standalone functions', () => {
      describe('decodePresenceMessage', () => {
        /**
         * Tests TP4 (fromEncoded part) but for a function exposed in the modular bundle,
         * so it's not really relevant to the spec item.
         *
         * @nospec
         */
        it('decodes a presence message’s data', async () => {
          const buffer = BufferUtils.utf8Encode('foo');
          const encodedMessage = { data: BufferUtils.base64Encode(buffer), encoding: 'base64' };

          const decodedMessage = await decodePresenceMessage(encodedMessage);

          expect(BufferUtils.areBuffersEqual(decodedMessage.data, buffer)).to.be.true;
          expect(decodedMessage.encoding).to.be.null;
        });
      });

      describe('decodeMessages', () => {
        /**
         * Tests TP4 (fromEncodedArray part) but for a function exposed in the modular bundle,
         * so it's not really relevant to the spec item.
         *
         * @nospec
         */
        it('decodes presence messages’ data', async () => {
          const buffers = ['foo', 'bar'].map((data) => BufferUtils.utf8Encode(data));
          const encodedMessages = buffers.map((buffer) => ({
            data: BufferUtils.base64Encode(buffer),
            encoding: 'base64',
          }));

          const decodedMessages = await decodePresenceMessages(encodedMessages);

          for (let i = 0; i < decodedMessages.length; i++) {
            const decodedMessage = decodedMessages[i];

            expect(BufferUtils.areBuffersEqual(decodedMessage.data, buffers[i])).to.be.true;
            expect(decodedMessage.encoding).to.be.null;
          }
        });
      });

      describe('constructPresenceMessage', () => {
        /** @nospec */
        it('creates a PresenceMessage instance', async () => {
          const extras = { foo: 'bar' };
          const presenceMessage = constructPresenceMessage({ extras });

          expect(presenceMessage.constructor.name).to.contain('PresenceMessage');
          expect(presenceMessage.extras).to.equal(extras);
        });
      });
    });

    describe('Annotations', () => {
      describe('BaseRealtime without Annotations', () => {
        /** @nospec */
        it('throws an error when attempting to access the `annotations` property', async function () {
          const helper = this.test.helper;
          const client = new BaseRealtime(helper.ablyClientOptions({ plugins: { WebSocketTransport, FetchRequest } }));

          await helper.monitorConnectionThenCloseAndFinishAsync(async () => {
            const channel = client.channels.get('channel');

            expect(() => channel.annotations).to.throw('Annotations plugin not provided');
          }, client);
        });

        /** @nospec */
        it('doesn’t break when it receives an ANNOTATION ProtocolMessage', async function () {
          const helper = this.test.helper;
          const rxClient = new BaseRealtime(
            helper.ablyClientOptions({
              clientId: Helper.randomString(10),
              plugins: { WebSocketTransport, FetchRequest },
            }),
          );
          const channelName = 'mutable:annotation-1';

          await helper.monitorConnectionThenCloseAndFinishAsync(async () => {
            const rxChannel = rxClient.channels.get(channelName, {
              modes: ['PUBLISH', 'SUBSCRIBE', 'ANNOTATION_PUBLISH', 'ANNOTATION_SUBSCRIBE'],
            });
            await rxChannel.attach();
            let receivedMessagePromise = rxChannel.subscriptions.once();

            const txClient = new BaseRealtime(
              this.test.helper.ablyClientOptions({
                clientId: Helper.randomString(10),
                plugins: {
                  WebSocketTransport,
                  FetchRequest,
                  Annotations,
                },
              }),
            );

            await helper.monitorConnectionThenCloseAndFinishAsync(async () => {
              const txChannel = txClient.channels.get(channelName);
              const onMessage = txChannel.subscriptions.once();
              await txChannel.attach();
              await txChannel.publish('test', 'body');
              const message = await onMessage;
              await txChannel.annotations.publish(message, { type: 'reaction:distinct.v1', name: '👍' });

              // with that received, do another round-trip pub-sub of a normal message
              // to check that rxChannel is still receiving
              await receivedMessagePromise;
              receivedMessagePromise = rxChannel.subscriptions.once();
              txChannel.publish('test2', 'body');
              await receivedMessagePromise;
            }, txClient);
          }, rxClient);
        });
      });

      describe('BaseRealtime with Annotations', () => {
        it('offers annotation functionality', async function () {
          const helper = this.test.helper;
          const channelName = 'mutable:annotation-2';
          const rxClient = new BaseRealtime(
            helper.ablyClientOptions({
              clientId: Helper.randomString(10),
              plugins: {
                WebSocketTransport,
                FetchRequest,
                Annotations,
              },
            }),
          );
          const rxChannel = rxClient.channels.get(channelName, {
            modes: ['PUBLISH', 'SUBSCRIBE', 'ANNOTATION_PUBLISH', 'ANNOTATION_SUBSCRIBE'],
          });

          await helper.monitorConnectionThenCloseAndFinishAsync(async () => {
            const txRealtime = new BaseRealtime(
              this.test.helper.ablyClientOptions({
                clientId: Helper.randomString(10),
                plugins: {
                  WebSocketTransport,
                  FetchRequest,
                  Annotations,
                },
              }),
            );
            const txRest = new BaseRest(
              this.test.helper.ablyClientOptions({
                clientId: Helper.randomString(10),
                plugins: {
                  FetchRequest,
                  Annotations,
                },
              }),
            );

            await helper.monitorConnectionThenCloseAndFinishAsync(async () => {
              const txChannel = txRealtime.channels.get(channelName, {
                modes: ['PUBLISH', 'SUBSCRIBE', 'ANNOTATION_PUBLISH', 'ANNOTATION_SUBSCRIBE'],
              });
              const onMessage = txChannel.subscriptions.once();
              let rxOnAnnotation = rxChannel.annotations.subscriptions.once();
              await txChannel.attach();
              await rxChannel.attach();

              await txChannel.publish('test', 'body');
              const message = await onMessage;
              await txChannel.annotations.publish(message, { type: 'reaction:distinct.v1', name: '👍' });
              let annotation = await rxOnAnnotation;
              expect(annotation.name).to.equal('👍');

              // and try a rest annotation publish
              rxOnAnnotation = rxChannel.annotations.subscriptions.once();
              const txRestChannel = txRest.channels.get(channelName);
              await txRestChannel.annotations.publish(message, { type: 'reaction:distinct.v1', name: '😕' });
              annotation = await rxOnAnnotation;
              expect(annotation.name).to.equal('😕');
            }, txRealtime);
          }, rxClient);
        });
      });
    });

    describe('Transports', () => {
      describe('BaseRealtime', () => {
        describe('without a transport plugin', () => {
          /** @nospec */
          it('throws an error due to absence of a transport plugin', function () {
            expect(() => new BaseRealtime(this.test.helper.ablyClientOptions({ plugins: { FetchRequest } }))).to.throw(
              'no requested transports available',
            );
          });
        });

        for (const scenario of [
          { pluginsKey: 'WebSocketTransport', transportPlugin: WebSocketTransport, transportName: 'web_socket' },
          { pluginsKey: 'XHRPolling', transportPlugin: XHRPolling, transportName: 'xhr_polling' },
        ]) {
          describe(`with the ${scenario.pluginsKey} plugin`, () => {
            /**
             * Tests RTN1 support for modular bundle.
             * @nospec
             */
            it(`is able to use the ${scenario.transportName} transport`, async function () {
              const helper = this.test.helper;
              const realtime = new BaseRealtime(
                helper.ablyClientOptions({
                  autoConnect: false,
                  transports: [scenario.transportName],
                  plugins: {
                    FetchRequest,
                    [scenario.pluginsKey]: scenario.transportPlugin,
                  },
                }),
              );

              await helper.monitorConnectionThenCloseAndFinishAsync(async () => {
                let firstTransportCandidate;
                const connectionManager = realtime.connection.connectionManager;
                const originalTryATransport = connectionManager.tryATransport;
                realtime.connection.connectionManager.tryATransport = (transportParams, candidate, callback) => {
                  if (!firstTransportCandidate) {
                    firstTransportCandidate = candidate;
                  }
                  originalTryATransport.bind(connectionManager)(transportParams, candidate, callback);
                };

                realtime.connect();

                await realtime.connection.once('connected');
                expect(firstTransportCandidate).to.equal(scenario.transportName);
              }, realtime);
            });
          });
        }
      });
    });

    describe('HTTP request implementations', () => {
      describe('with multiple HTTP request implementations', () => {
        /** @nospec */
        it('prefers XHR', async function () {
          let usedXHR = false;

          const XHRRequestSpy = class XHRRequestSpy extends XHRRequest {
            static createRequest(...args) {
              usedXHR = true;
              return super.createRequest(...args);
            }
          };

          const rest = new BaseRest(
            this.test.helper.ablyClientOptions({ plugins: { FetchRequest, XHRRequest: XHRRequestSpy } }),
          );
          await rest.time();

          expect(usedXHR).to.be.true;
        });
      });
    });

    describe('MessageInteractions', () => {
      describe('BaseRealtime', () => {
        describe('without MessageInteractions', () => {
          /** @nospec */
          it('is able to subscribe to and unsubscribe from channel events, as long as a MessageFilter isn’t passed', async function () {
            const helper = this.test.helper;
            const realtime = new BaseRealtime(
              helper.ablyClientOptions({ plugins: { WebSocketTransport, FetchRequest } }),
            );

            await helper.monitorConnectionThenCloseAndFinishAsync(async () => {
              const channel = realtime.channels.get('channel');
              await channel.attach();

              const subscribeReceivedMessagePromise = new Promise((resolve) => channel.subscribe(resolve));

              await channel.publish('message', 'body');

              const subscribeReceivedMessage = await subscribeReceivedMessagePromise;
              expect(subscribeReceivedMessage.data).to.equal('body');
            }, realtime);
          });

          /** @nospec */
          it('throws an error when attempting to subscribe to channel events using a MessageFilter', async function () {
            const helper = this.test.helper;
            const realtime = new BaseRealtime(
              helper.ablyClientOptions({ plugins: { WebSocketTransport, FetchRequest } }),
            );

            await helper.monitorConnectionThenCloseAndFinishAsync(async () => {
              const channel = realtime.channels.get('channel');

              let thrownError = null;
              try {
                await channel.subscribe({ clientId: 'someClientId' }, () => {});
              } catch (error) {
                thrownError = error;
              }

              expect(thrownError).not.to.be.null;
              expect(thrownError.message).to.equal('MessageInteractions plugin not provided');
            }, realtime);
          });
        });

        describe('with MessageInteractions', () => {
          /**
           * Tests RTL22d, MFI2e but for a MessageInteractions plugin with modular BaseRealtime.
           * @nospec
           */
          it('can take a MessageFilter argument when subscribing to and unsubscribing from channel events', async function () {
            const helper = this.test.helper;
            const realtime = new BaseRealtime(
              helper.ablyClientOptions({
                plugins: {
                  WebSocketTransport,
                  FetchRequest,
                  MessageInteractions,
                },
              }),
            );

            await helper.monitorConnectionThenCloseAndFinishAsync(async () => {
              const channel = realtime.channels.get('channel');

              await channel.attach();

              // Test `subscribe` with a filter: send two messages with different clientIds, and check that unfiltered subscription receives both messages but clientId-filtered subscription only receives the matching one.
              const messageFilter = { clientId: 'someClientId' }; // note that `unsubscribe` compares filter by reference, I found that a bit surprising

              const filteredSubscriptionReceivedMessages = [];
              channel.subscribe(messageFilter, (message) => {
                filteredSubscriptionReceivedMessages.push(message);
              });

              const unfilteredSubscriptionReceivedFirstTwoMessagesPromise = new Promise((resolve) => {
                const receivedMessages = [];
                channel.subscribe(function listener(message) {
                  receivedMessages.push(message);
                  if (receivedMessages.length === 2) {
                    channel.unsubscribe(listener);
                    resolve();
                  }
                });
              });

              await channel.publish(await decodeMessage({ clientId: 'someClientId' }));
              await channel.publish(await decodeMessage({ clientId: 'someOtherClientId' }));
              await unfilteredSubscriptionReceivedFirstTwoMessagesPromise;

              expect(filteredSubscriptionReceivedMessages.length).to.equal(1);
              expect(filteredSubscriptionReceivedMessages[0].clientId).to.equal('someClientId');

              // Test `unsubscribe` with a filter: call `unsubscribe` with the clientId filter, publish a message matching the filter, check that only the unfiltered listener recieves it
              channel.unsubscribe(messageFilter);

              const unfilteredSubscriptionReceivedNextMessagePromise = new Promise((resolve) => {
                channel.subscribe(function listener() {
                  channel.unsubscribe(listener);
                  resolve();
                });
              });

              await channel.publish(await decodeMessage({ clientId: 'someClientId' }));
              await unfilteredSubscriptionReceivedNextMessagePromise;

              expect(filteredSubscriptionReceivedMessages.length).to./* (still) */ equal(1);
            }, realtime);
          });
        });
      });
    });
  });
}

// This function is called by browser_setup.js once `require` is available
window.registerAblyModularTests = async () => {
  return new Promise((resolve) => {
    require(['shared_helper'], (Helper) => {
      registerAblyModularTests(Helper);
      resolve();
    });
  });
};
