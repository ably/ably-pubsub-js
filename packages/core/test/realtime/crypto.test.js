'use strict';

define(['ably', 'shared_helper', 'async', 'chai'], function (Ably, Helper, async, chai) {
  var expect = chai.expect;
  var BufferUtils = Ably.Realtime.Platform.BufferUtils;
  var Crypto = Ably.Realtime.Platform.Crypto;
  var Message = Ably.Realtime.Message;
  var msgpack = typeof window == 'object' ? Ably.msgpack : require('@ably/msgpack-js');

  function attachChannels(channels, callback) {
    async.map(
      channels,
      function (channel, cb) {
        Helper.whenPromiseSettles(channel.attach(), cb);
      },
      callback,
    );
  }

  function testMessageEquality(done, helper, one, two) {
    try {
      helper.testMessageEquality(one, two);
    } catch (err) {
      done(err);
    }
  }

  function testEachFixture(done, helper, filename, channelName, testsPerFixture, testPlaintextVariants, fixtureTest) {
    if (!Crypto) {
      done(new Error('Encryption not supported'));
      return;
    }

    helper.loadTestData(helper.testResourcesPath + filename, async function (err, testData) {
      if (err) {
        done(new Error('Unable to get test assets; err = ' + helper.displayError(err)));
        return;
      }
      var realtime = helper.AblyRealtime();
      helper.recordPrivateApi('call.BufferUtils.base64Decode');
      var key = BufferUtils.base64Decode(testData.key);
      var iv = BufferUtils.base64Decode(testData.iv);
      var channel = realtime.channels.get(channelName, { cipher: { key: key, iv: iv } });

      try {
        for (var i = 0; i < testData.items.length; i++) {
          var item = testData.items[i];

          /* read messages from test data and decode (ie remove any base64 encoding). */
          var createTestMessage = async function () {
            return await Message.fromEncoded(item.encoded);
          };

          var encryptedMessage = await Message.fromEncoded(item.encrypted);

          var runTest = function (testMessage) {
            /* reset channel cipher, to ensure it uses the given iv */
            channel.setOptions({ cipher: { key: key, iv: iv } });
            fixtureTest(channel.channelOptions, testMessage, encryptedMessage, item.msgpack);
          };

          // Run the test with the message’s data as-is.
          runTest(await createTestMessage());

          if (testPlaintextVariants) {
            var testMessage = await createTestMessage();
            helper.recordPrivateApi('call.BufferUtils.isBuffer');
            if (BufferUtils.isBuffer(testMessage.data) && !(testMessage.data instanceof ArrayBuffer)) {
              // Now, check that we can also handle an ArrayBuffer plaintext.
              var testMessageWithArrayBufferData = await createTestMessage();
              helper.recordPrivateApi('call.BufferUtils.toArrayBuffer');
              testMessageWithArrayBufferData.data = BufferUtils.toArrayBuffer(testMessageWithArrayBufferData.data);
              runTest(testMessageWithArrayBufferData);
            }
          }
        }
      } catch (err) {
        helper.closeAndFinish(done, realtime, err);
        return;
      }
      helper.closeAndFinish(done, realtime);
    });
  }

  describe('realtime/crypto', function () {
    this.timeout(60 * 1000);

    before(function (done) {
      const helper = Helper.forHook(this);
      helper.setupApp(function (err) {
        if (err) {
          done(err);
        }
        done();
      });
    });

    /**
     * generateRandomKey with an explicit keyLength
     *
     * @spec RSE2
     * @spec RSE2b
     * @specpartial RSE2a - tests length in bits with explicit keyLength
     */
    it('generateRandomKey0', function (done) {
      Helper.whenPromiseSettles(Crypto.generateRandomKey(64), function (err, key) {
        if (err) {
          done(err);
          return;
        }
        try {
          /* .length for a nodejs buffer, .byteLength for a browser ArrayBuffer */
          expect(key.length || key.byteLength).to.equal(8, 'generated key is the correct length');
          done();
        } catch (err) {
          done(err);
        }
      });
    });

    /**
     * generateRandomKey with no keyLength should generate 256-bit keys
     *
     * @spec RSE2
     * @spec RSE2b
     * @specpartial RSE2a - tests length in bits without keyLength
     */
    it('generateRandomKey1', function (done) {
      Helper.whenPromiseSettles(Crypto.generateRandomKey(), function (err, key) {
        if (err) {
          done(err);
          return;
        }
        try {
          expect(key.length || key.byteLength).to.equal(32, 'generated key is the default length');
          done();
        } catch (err) {
          done(err);
        }
      });
    });

    /**
     * @spec RSE1
     * @spec RSE1a
     * @specpartial RSE1b - tests only passing key
     */
    it('getDefaultParams_withResultOfGenerateRandomKey', function (done) {
      Helper.whenPromiseSettles(Crypto.generateRandomKey(), function (err, key) {
        if (err) {
          done(err);
        }
        var params = Crypto.getDefaultParams({ key: key });
        try {
          expect(params.key).to.equal(key);
          expect(params.algorithm).to.equal('aes', 'check default algorithm');
          expect(params.mode).to.equal('cbc', 'check default mode');
          done();
        } catch (err) {
          done(err);
        }
      });
    });

    /** @specpartial RSE1c - can accept binary key */
    it('getDefaultParams_ArrayBuffer_key', function (done) {
      const helper = this.test.helper;
      Helper.whenPromiseSettles(Crypto.generateRandomKey(), function (err, key) {
        if (err) {
          done(err);
        }
        helper.recordPrivateApi('call.BufferUtils.toArrayBuffer');
        var arrayBufferKey = Ably.Realtime.Platform.BufferUtils.toArrayBuffer(key);
        var params = Crypto.getDefaultParams({ key: arrayBufferKey });
        try {
          helper.recordPrivateApi('call.BufferUtils.areBuffersEqual');
          expect(BufferUtils.areBuffersEqual(params.key, key)).to.equal(true);
          done();
        } catch (err) {
          done(err);
        }
      });
    });

    /** @specpartial RSE1c - can accept base64 string key */
    it('getDefaultParams_base64_key', function (done) {
      const helper = this.test.helper;
      Helper.whenPromiseSettles(Crypto.generateRandomKey(), function (err, key) {
        if (err) {
          done(err);
          return;
        }
        helper.recordPrivateApi('call.BufferUtils.base64Encode');
        var b64key = Ably.Realtime.Platform.BufferUtils.base64Encode(key);
        var params = Crypto.getDefaultParams({ key: b64key });
        try {
          helper.recordPrivateApi('call.BufferUtils.areBuffersEqual');
          expect(BufferUtils.areBuffersEqual(params.key, key)).to.equal(true);
          done();
        } catch (err) {
          done(err);
        }
      });
    });

    /**
     * Checks the minimum spec item requirement - checking the calculated keyLength is a valid key length
     * for the encryption algorithm (for example, 128 or 256 for AES).
     *
     * @spec RSE1e
     */
    it('getDefaultParams_check_keylength', function (done) {
      Helper.whenPromiseSettles(Crypto.generateRandomKey(64), function (err, key) {
        if (err) {
          done(err);
          return;
        }
        try {
          Crypto.getDefaultParams({ key: key });
          done(new Error('expected getDefaultParams with a 64-bit key to throw an exception'));
        } catch (err) {
          done();
        }
      });
    });

    /**
     * @spec RSE1d
     * @spec RSE1e
     * @specpartial RSE1b - tests key, algorithm, mode
     */
    it('getDefaultParams_preserves_custom_algorithms', function (done) {
      Helper.whenPromiseSettles(Crypto.generateRandomKey(64), function (err, key) {
        if (err) {
          done(err);
          return;
        }
        try {
          var params = Crypto.getDefaultParams({ key: key, algorithm: 'foo', mode: 'bar' });
          expect(params.key).to.equal(key);
          expect(params.algorithm).to.equal('foo');
          expect(params.mode).to.equal('bar');
          expect(params.keyLength).to.equal(64);
          done();
        } catch (err) {
          done(err);
        }
      });
    });

    /**
     * @specpartial RSL5c - encrypt aes 128
     * @specpartial RSL5b - aes 128
     */
    it('encrypt_message_128', function (done) {
      const helper = this.test.helper;
      testEachFixture(
        done,
        helper,
        'crypto-data-128.json',
        'encrypt_message_128',
        2,
        true,
        function (channelOpts, testMessage, encryptedMessage) {
          /* encrypt plaintext message; encode() also to handle data that is not already string or buffer */
          helper.recordPrivateApi('call.Message.encode');
          Helper.whenPromiseSettles(testMessage.encode(channelOpts), function (_, encrypted) {
            testMessageEquality(done, helper, encrypted, encryptedMessage);
          });
        },
      );
    });

    /**
     * @specpartial RSL5c - encrypt aes 256
     * @specpartial RSL5b - aes 256
     */
    it('encrypt_message_256', function (done) {
      const helper = this.test.helper;
      testEachFixture(
        done,
        helper,
        'crypto-data-256.json',
        'encrypt_message_256',
        2,
        true,
        function (channelOpts, testMessage, encryptedMessage) {
          /* encrypt plaintext message; encode() also to handle data that is not already string or buffer */
          helper.recordPrivateApi('call.Message.encode');
          Helper.whenPromiseSettles(testMessage.encode(channelOpts), function (_, encrypted) {
            testMessageEquality(done, helper, encrypted, encryptedMessage);
          });
        },
      );
    });

    /**
     * @specpartial RSL5c - decrypt aes 128
     * @specpartial RSL5b - aes 128
     */
    it('decrypt_message_128', function (done) {
      const helper = this.test.helper;
      testEachFixture(
        done,
        helper,
        'crypto-data-128.json',
        'decrypt_message_128',
        2,
        false,
        async function (channelOpts, testMessage, encryptedMessage) {
          /* decrypt encrypted message; decode() also to handle data that is not string or buffer */
          helper.recordPrivateApi('call.Message.decode');
          await Message.decode(encryptedMessage, channelOpts);
          /* compare */
          testMessageEquality(done, helper, testMessage, encryptedMessage);
        },
      );
    });

    /**
     * @specpartial RSL5c - decrypt aes 256
     * @specpartial RSL5b - aes 256
     */
    it('decrypt_message_256', function (done) {
      const helper = this.test.helper;
      testEachFixture(
        done,
        helper,
        'crypto-data-256.json',
        'decrypt_message_256',
        2,
        false,
        async function (channelOpts, testMessage, encryptedMessage) {
          /* decrypt encrypted message; decode() also to handle data that is not string or buffer */
          helper.recordPrivateApi('call.Message.decode');
          await Message.decode(encryptedMessage, channelOpts);
          /* compare */
          testMessageEquality(done, helper, testMessage, encryptedMessage);
        },
      );
    });

    /** @specpartial TM3 - can decode and decrypt using cipher from provided channelOptions */
    it('fromEncoded_cipher_options', function (done) {
      if (!Crypto) {
        done(new Error('Encryption not supported'));
        return;
      }

      const helper = this.test.helper;

      helper.loadTestData(helper.testResourcesPath + 'crypto-data-256.json', async function (err, testData) {
        if (err) {
          done(err);
          return;
        }
        helper.recordPrivateApi('call.BufferUtils.base64Decode');
        var key = BufferUtils.base64Decode(testData.key);
        var iv = BufferUtils.base64Decode(testData.iv);

        for (var i = 0; i < testData.items.length; i++) {
          var item = testData.items[i];
          var testMessage = await Message.fromEncoded(item.encoded);
          var decryptedMessage = await Message.fromEncoded(item.encrypted, { cipher: { key: key, iv: iv } });
          testMessageEquality(done, helper, testMessage, decryptedMessage);
        }
        done();
      });
    });

    /* Tests require encryption and binary transport */
    if (typeof ArrayBuffer !== 'undefined') {
      /**
       * Related to G1, RSC8a, RSL4c, RSL6a1
       * @nospec
       */
      it('msgpack_128', function (done) {
        const helper = this.test.helper;
        testEachFixture(
          done,
          helper,
          'crypto-data-128.json',
          'msgpack_128',
          2,
          false,
          function (channelOpts, testMessage, encryptedMessage, msgpackEncodedMessage) {
            helper.recordPrivateApi('call.Message.encode');
            Helper.whenPromiseSettles(testMessage.encode(channelOpts), function (_, encrypted) {
              helper.recordPrivateApi('call.msgpack.encode');
              var msgpackFromEncoded = msgpack.encode(encrypted);
              var msgpackFromEncrypted = msgpack.encode(encryptedMessage);
              helper.recordPrivateApi('call.BufferUtils.base64Decode');
              helper.recordPrivateApi('call.msgpack.decode');
              var messageFromMsgpack = Message.fromWireProtocol(
                msgpack.decode(BufferUtils.base64Decode(msgpackEncodedMessage)),
              );

              try {
                /* Mainly testing that we're correctly encoding the direct output from
                 * the platform's ICipher implementation into the msgpack binary type */
                helper.recordPrivateApi('call.BufferUtils.areBuffersEqual');
                expect(BufferUtils.areBuffersEqual(msgpackFromEncoded, msgpackFromEncrypted)).to.equal(
                  true,
                  'verify msgpack encodings of newly-encrypted and preencrypted messages identical using areBuffersEqual',
                );

                /* Can't compare msgpackFromEncoded with fixture data because can't
                 * assume key order in the msgpack serialisation. So test decoded instead */
                expect(messageFromMsgpack).to.deep.equal(encryptedMessage, 'verify msgpack fixture decodes correctly');
              } catch (err) {
                done(err);
              }
            });
          },
        );
      });

      /**
       * Related to G1, RSC8a, RSL4c, RSL6a1
       * @nospec
       */
      it('msgpack_256', function (done) {
        const helper = this.test.helper;
        testEachFixture(
          done,
          helper,
          'crypto-data-256.json',
          'msgpack_256',
          2,
          false,
          function (channelOpts, testMessage, encryptedMessage, msgpackEncodedMessage) {
            Helper.whenPromiseSettles(testMessage.encode(channelOpts), function (_, encrypted) {
              helper.recordPrivateApi('call.msgpack.encode');
              var msgpackFromEncoded = msgpack.encode(encrypted);
              var msgpackFromEncrypted = msgpack.encode(encryptedMessage);
              helper.recordPrivateApi('call.BufferUtils.base64Decode');
              helper.recordPrivateApi('call.msgpack.decode');
              var messageFromMsgpack = Message.fromWireProtocol(
                msgpack.decode(BufferUtils.base64Decode(msgpackEncodedMessage)),
              );

              try {
                /* Mainly testing that we're correctly encoding the direct output from
                 * the platform's ICipher implementation into the msgpack binary type */
                helper.recordPrivateApi('call.BufferUtils.areBuffersEqual');
                expect(BufferUtils.areBuffersEqual(msgpackFromEncoded, msgpackFromEncrypted)).to.equal(
                  true,
                  'verify msgpack encodings of newly-encrypted and preencrypted messages identical using areBuffersEqual',
                );

                /* Can't compare msgpackFromEncoded with fixture data because can't
                 * assume key order in the msgpack serialisation. So test decoded instead */
                expect(messageFromMsgpack).to.deep.equal(encryptedMessage, 'verify msgpack fixture decodes correctly');
              } catch (err) {
                done(err);
              }
            });
          },
        );
      });
    }

    function single_send(done, helper, realtimeOpts, keyLength) {
      // the _128 and _256 variants both call this so it makes more sense for this to be the parameterisedTestTitle instead of that set by testOnAllTransportsAndProtocols
      helper = helper.withParameterisedTestTitle('single_send');

      if (!Crypto) {
        done(new Error('Encryption not supported'));
        return;
      }

      Helper.whenPromiseSettles(Crypto.generateRandomKey(keyLength), function (err, key) {
        if (err) {
          helper.closeAndFinish(done, realtime, err);
          return;
        }
        /* For single_send tests we test the 'shortcut' way of setting the cipher
         * in channels.get. No callback, but that's ok even for node which has
         * async iv generation since the publish is on an attach cb */
        var realtime = helper.AblyRealtime(realtimeOpts),
          channel = realtime.channels.get('single_send', { cipher: { key: key } }),
          messageText = 'Test message for single_send -	' + JSON.stringify(realtimeOpts);

        Helper.whenPromiseSettles(channel.attach(), function (err) {
          if (err) {
            helper.closeAndFinish(done, realtime, err);
            return;
          }
          try {
            helper.recordPrivateApi('read.channel.channelOptions.cipher');
            expect(channel.channelOptions.cipher.algorithm).to.equal('aes');
            expect(channel.channelOptions.cipher.keyLength).to.equal(keyLength);
          } catch (err) {
            helper.closeAndFinish(done, realtime, err);
          }
          channel.subscribe('event0', function (msg) {
            try {
              expect(msg.data == messageText).to.be.ok;
            } catch (err) {
              helper.closeAndFinish(done, realtime, err);
              return;
            }
            helper.closeAndFinish(done, realtime);
          });
          channel.publish('event0', messageText);
        });
      });
    }

    // Publish and subscribe, various transport, 128 and 256-bit
    /** @specpartial RSL5b - test aes 128 */
    Helper.testOnAllTransportsAndProtocols(this, 'single_send_128', function (realtimeOpts) {
      return function (done) {
        single_send(done, this.test.helper, realtimeOpts, 128);
      };
    });

    /** @specpartial RSL5b - test aes 256 */
    Helper.testOnAllTransportsAndProtocols(this, 'single_send_256', function (realtimeOpts) {
      return function (done) {
        single_send(done, this.test.helper, realtimeOpts, 256);
      };
    });

    function _multiple_send(done, helper, text, iterations, delay) {
      helper = helper.withParameterisedTestTitle('multiple_send');

      if (!Crypto) {
        done(new Error('Encryption not supported'));
        return;
      }

      var realtime = helper.AblyRealtime({ useBinaryProtocol: !text });
      var channelName = 'multiple_send_' + (text ? 'text_' : 'binary_') + iterations + '_' + delay,
        channel = realtime.channels.get(channelName),
        messageText = 'Test message (' + channelName + ')';

      Helper.whenPromiseSettles(Crypto.generateRandomKey(128), function (err, key) {
        channel.setOptions({ cipher: { key: key } });
        try {
          helper.recordPrivateApi('read.channel.channelOptions.cipher');
          expect(channel.channelOptions.cipher.algorithm).to.equal('aes');
          expect(channel.channelOptions.cipher.keyLength).to.equal(128);
        } catch (err) {
          helper.closeAndFinish(done, realtime, err);
          return;
        }
        function sendAll(sendCb) {
          var sent = 0;
          var sendOnce = function () {
            channel.publish('event0', messageText);
            if (++sent == iterations) {
              sendCb(null);
              return;
            }
            setTimeout(sendOnce, delay);
          };
          sendOnce();
        }
        function recvAll(recvCb) {
          var received = 0;
          channel.subscribe('event0', function (msg) {
            try {
              expect(msg.data == messageText).to.be.ok;
            } catch (error) {
              recvCb(error);
            }
            if (++received == iterations) recvCb(null);
          });
        }

        Helper.whenPromiseSettles(channel.attach(), function (err) {
          if (err) {
            helper.closeAndFinish(done, realtime, err);
            return;
          }
          async.parallel([sendAll, recvAll], function (err) {
            helper.closeAndFinish(done, realtime, err);
          });
        });
      });
    }

    /**
     * Related to TB2b
     *
     * @specpartial RSL5a - cipher is set via setOptions instead on channel instantiation
     */
    it('multiple_send_binary_2_200', function (done) {
      _multiple_send(done, this.test.helper, false, 2, 200);
    });

    /**
     * Related to TB2b
     *
     * @specpartial RSL5a - cipher is set via setOptions instead on channel instantiation
     */
    it('multiple_send_text_2_200', function (done) {
      _multiple_send(done, this.test.helper, true, 2, 200);
    });

    /**
     * Related to TB2b
     *
     * @specpartial RSL5a - cipher is set via setOptions instead on channel instantiation
     */
    it('multiple_send_binary_20_100', function (done) {
      _multiple_send(done, this.test.helper, false, 20, 100);
    });

    /**
     * Related to TB2b
     *
     * @specpartial RSL5a - cipher is set via setOptions instead on channel instantiation
     */
    it('multiple_send_text_20_100', function (done) {
      _multiple_send(done, this.test.helper, true, 20, 100);
    });

    /**
     * Related to TB2b
     *
     * @specpartial RSL5a - cipher is set via setOptions instead on channel instantiation
     */
    it('multiple_send_binary_10_10', function (done) {
      _multiple_send(done, this.test.helper, false, 10, 10);
    });

    /**
     * Related to TB2b
     *
     * @specpartial RSL5a - cipher is set via setOptions instead on channel instantiation
     */
    it('multiple_send_text_10_10', function (done) {
      _multiple_send(done, this.test.helper, true, 10, 10);
    });

    function _single_send_separate_realtimes(done, helper, txOpts, rxOpts) {
      if (!Crypto) {
        done(new Error('Encryption not supported'));
        return;
      }

      var txRealtime = helper.AblyRealtime(txOpts),
        rxRealtime = helper.AblyRealtime(rxOpts),
        channelName = 'single_send_separate_realtimes';
      var messageText = 'Test message for single_send_separate_realtimes',
        txChannel = txRealtime.channels.get(channelName),
        rxChannel = rxRealtime.channels.get(channelName);

      Helper.whenPromiseSettles(Crypto.generateRandomKey(), function (err, key) {
        if (err) {
          helper.closeAndFinish(done, realtime, err);
          return;
        }
        async.parallel(
          [
            function (cb) {
              txChannel.setOptions({ cipher: { key: key } });
              cb();
            },
            function (cb) {
              rxChannel.setOptions({ cipher: { key: key } });
              cb();
            },
          ],
          function (err) {
            if (err) {
              helper.closeAndFinish(done, [txRealtime, rxRealtime], err);
              return;
            }
            try {
              helper.recordPrivateApi('read.channel.channelOptions.cipher');
              expect(txChannel.channelOptions.cipher.algorithm).to.equal('aes');
              expect(rxChannel.channelOptions.cipher.algorithm).to.equal('aes');
            } catch (err) {
              helper.closeAndFinish(done, [txRealtime, rxRealtime], err);
            }

            attachChannels([txChannel, rxChannel], function () {
              rxChannel.subscribe('event0', function (msg) {
                try {
                  expect(msg.data == messageText).to.be.ok;
                } catch (err) {
                  helper.closeAndFinish(done, [txRealtime, rxRealtime], err);
                  return;
                }
                helper.closeAndFinish(done, [txRealtime, rxRealtime]);
              });
              txChannel.publish('event0', messageText);
            });
          },
        );
      });
    }

    /**
     * Connect twice to the service, using the binary protocol
     * and the text protocol. Publish an encrypted message on that channel using
     * the default cipher params and verify correct receipt.
     * Related to RSL5, G1.
     *
     * @nospec
     */
    it('single_send_binary_text', function (done) {
      _single_send_separate_realtimes(
        done,
        this.test.helper,
        { useBinaryProtocol: true },
        { useBinaryProtocol: false },
      );
    });

    /**
     * Connect twice to the service, using the text protocol and the
     * binary protocol. Publish an encrypted message on that channel using
     * the default cipher params and verify correct receipt.
     * Related to RSL5a, G1.
     *
     * @nospec
     */
    it('single_send_text_binary', function (done) {
      _single_send_separate_realtimes(
        done,
        this.test.helper,
        { useBinaryProtocol: false },
        { useBinaryProtocol: true },
      );
    });

    /**
     * Related to RSL5a
     *
     * @nospec
     */
    it('publish_immediately', function (done) {
      if (!Crypto) {
        done(new Error('Encryption not supported'));
        return;
      }

      var helper = this.test.helper,
        txRealtime = helper.AblyRealtime(),
        rxRealtime = helper.AblyRealtime(),
        channelName = 'publish_immediately',
        messageText = 'Test message';

      Helper.whenPromiseSettles(Crypto.generateRandomKey(), function (err, key) {
        if (err) {
          helper.closeAndFinish(done, [txRealtime, rxRealtime], err);
          return;
        }
        var rxChannel = rxRealtime.channels.get(channelName, { cipher: { key: key } });
        Helper.whenPromiseSettles(
          rxChannel.subscribe('event0', function (msg) {
            try {
              expect(msg.data == messageText).to.be.ok;
            } catch (err) {
              helper.closeAndFinish(done, [txRealtime, rxRealtime], err);
              return;
            }
            helper.closeAndFinish(done, [txRealtime, rxRealtime]);
          }),
          function () {
            var txChannel = txRealtime.channels.get(channelName, { cipher: { key: key } });
            txChannel.publish('event0', messageText);
          },
        );
      });
    });

    /**
     * @spec RSL5a
     */
    it('encrypted history', async function () {
      if (!Crypto) {
        done(new Error('Encryption not supported'));
        return;
      }

      const helper = this.test.helper,
        rest = helper.AblyRest(),
        channelName = 'encrypted_history',
        messageText = 'Test message';

      const key = await Crypto.generateRandomKey();
      const channel = rest.channels.get(channelName, { cipher: { key: key } });
      await channel.publish('event0', messageText);
      let items;
      await helper.waitFor(async () => {
        items = (await channel.history()).items;
        return items.length > 0;
      }, 10_000);
      expect(items[0].data).to.equal(messageText);
    });

    /**
     * Connect twice to the service, using different cipher keys.
     * Publish an encrypted message on that channel using
     * the default cipher params and verify that the decrypt failure
     * is noticed as bad recovered plaintext.
     * Related to RTL7e.
     *
     * @specpartial RSL6b - only tests the message is still delivered
     */
    it('single_send_key_mismatch', function (done) {
      if (!Crypto) {
        done(new Error('Encryption not supported'));
        return;
      }

      const helper = this.test.helper;
      var txRealtime = helper.AblyRealtime();
      var rxRealtime = helper.AblyRealtime();
      var channelName = 'single_send_key_mismatch',
        txChannel = txRealtime.channels.get(channelName),
        messageText = 'Test message (' + channelName + ')',
        rxChannel = rxRealtime.channels.get(channelName);

      async.parallel(
        [
          function (cb) {
            Helper.whenPromiseSettles(Crypto.generateRandomKey(), cb);
          },
          function (cb) {
            Helper.whenPromiseSettles(Crypto.generateRandomKey(), cb);
          },
          function (cb) {
            attachChannels([txChannel, rxChannel], cb);
          },
        ],
        function (err, res) {
          if (err) {
            helper.closeAndFinish(done, [txRealtime, rxRealtime], err);
            return;
          }
          var txKey = res[0],
            rxKey = res[1];

          async.parallel(
            [
              function (cb) {
                txChannel.setOptions({ cipher: { key: txKey } });
                cb();
              },
              function (cb) {
                rxChannel.setOptions({ cipher: { key: rxKey } });
                cb();
              },
            ],
            function () {
              rxChannel.subscribe('event0', function (msg) {
                try {
                  expect(msg.data != messageText).to.be.ok;
                } catch (err) {
                  helper.closeAndFinish(done, [txRealtime, rxRealtime], err);
                  return;
                }
                helper.closeAndFinish(done, [txRealtime, rxRealtime]);
              });
              txChannel.publish('event0', messageText);
            },
          );
        },
      );
    });

    /**
     * Connect twice to the service, one with and one without encryption.
     * Publish an unencrypted message and verify that the receiving connection
     * does not attempt to decrypt it.
     * Related to RSL5, RSL6b, RTL7e.
     *
     * @nospec
     */
    it('single_send_unencrypted', function (done) {
      if (!Crypto) {
        done(new Error('Encryption not supported'));
        return;
      }

      const helper = this.test.helper;
      var txRealtime = helper.AblyRealtime();
      var rxRealtime = helper.AblyRealtime();
      var channelName = 'single_send_unencrypted',
        txChannel = txRealtime.channels.get(channelName),
        messageText = 'Test message (' + channelName + ')',
        rxChannel = rxRealtime.channels.get(channelName);

      attachChannels([txChannel, rxChannel], function (err) {
        if (err) {
          helper.closeAndFinish(done, [txRealtime, rxRealtime], err);
          return;
        }
        Helper.whenPromiseSettles(Crypto.generateRandomKey(), function (err, rxKey) {
          if (err) {
            helper.closeAndFinish(done, [txRealtime, rxRealtime], err);
            return;
          }
          rxChannel.setOptions({ cipher: { key: rxKey } });
          rxChannel.subscribe('event0', function (msg) {
            try {
              expect(msg.data == messageText).to.be.ok;
            } catch (err) {
              helper.closeAndFinish(done, [txRealtime, rxRealtime], err);
              return;
            }
            helper.closeAndFinish(done, [txRealtime, rxRealtime]);
          });
          txChannel.publish('event0', messageText);
        });
      });
    });

    /**
     * Connect twice to the service, one with and one without encryption.
     * Publish an encrypted message and verify that the receiving connection
     * handles the encrypted message correctly.
     *
     * @spec RTL7e
     * @specpartial RSL6b - test can't decrypt message with incorrect CipherParam
     */
    it('single_send_encrypted_unhandled', function (done) {
      if (!Crypto) {
        done(new Error('Encryption not supported'));
        return;
      }

      const helper = this.test.helper;
      var txRealtime = helper.AblyRealtime();
      var rxRealtime = helper.AblyRealtime();
      var channelName = 'single_send_encrypted_unhandled',
        txChannel = txRealtime.channels.get(channelName),
        messageText = 'Test message (' + channelName + ')',
        rxChannel = rxRealtime.channels.get(channelName);

      attachChannels([txChannel, rxChannel], function (err) {
        if (err) {
          helper.closeAndFinish(done, [txRealtime, rxRealtime], err);
          return;
        }
        Helper.whenPromiseSettles(Crypto.generateRandomKey(), function (err, txKey) {
          if (err) {
            helper.closeAndFinish(done, [txRealtime, rxRealtime], err);
            return;
          }
          txChannel.setOptions({ cipher: { key: txKey } });
          rxChannel.subscribe('event0', function (msg) {
            try {
              expect(msg.encoding.indexOf('cipher') > -1).to.be.ok;
            } catch (err) {
              helper.closeAndFinish(done, [txRealtime, rxRealtime], err);
              return;
            }
            helper.closeAndFinish(done, [txRealtime, rxRealtime]);
          });
          txChannel.publish('event0', messageText);
        });
      });
    });

    /**
     * Check Channel.setOptions updates CipherParams correctly:
     * - publish a message using a key, verifying correct receipt;
     * - publish with an updated key on the tx connection and verify that it is not decrypted by the rx connection;
     * - publish with an updated key on the rx connection and verify connect receipt
     *
     * @spec RTL7e
     * @specpartial RSL5a - cipher is set via setOptions instead on channel instantiation
     * @specpartial RSL6b - test can't decrypt message with incorrect CipherParam
     */
    it('set_cipher_params0', function (done) {
      if (!Crypto) {
        done(new Error('Encryption not supported'));
        return;
      }

      const helper = this.test.helper;
      var txRealtime = helper.AblyRealtime();
      var rxRealtime = helper.AblyRealtime();
      var channelName = 'set_cipher_params',
        txChannel = txRealtime.channels.get(channelName),
        messageText = 'Test message (' + channelName + ')',
        rxChannel = rxRealtime.channels.get(channelName),
        firstKey,
        secondKey;

      var waitAttach = function (cb) {
        attachChannels([txChannel, rxChannel], cb);
      };
      var setInitialOptions = function (cb) {
        Helper.whenPromiseSettles(Crypto.generateRandomKey(), function (err, key) {
          if (err) {
            helper.closeAndFinish(done, [txRealtime, rxRealtime], err);
            return;
          }
          firstKey = key;
          async.parallel(
            [
              function (innercb) {
                rxChannel.setOptions({ cipher: { key: key } });
                innercb();
              },
              function (innercb) {
                txChannel.setOptions({ cipher: { key: key } });
                innercb();
              },
            ],
            cb,
          );
        });
      };

      var sendFirstMessage = function (cb) {
        var handler = function (msg) {
          expect(msg.data == messageText, 'Message data not expected value').to.be.ok;
          rxChannel.unsubscribe('event0', handler);
          cb(null);
        };
        rxChannel.subscribe('event0', handler);
        txChannel.publish('event0', messageText);
      };

      var createSecondKey = function (cb) {
        Helper.whenPromiseSettles(Crypto.generateRandomKey(), function (err, key) {
          if (err) {
            helper.closeAndFinish(done, [txRealtime, rxRealtime], err);
            return;
          }
          secondKey = key;
          async.parallel(
            [
              function (innercb) {
                rxChannel.setOptions({ cipher: null });
                innercb();
              },
              function (innercb) {
                txChannel.setOptions({ cipher: { key: key } });
                innercb();
              },
            ],
            cb,
          );
        });
      };

      var sendSecondMessage = function (cb) {
        var handler = function (msg) {
          expect(msg.encoding.indexOf('cipher') > -1, 'Message does not have cipher transform').to.be.ok;
          rxChannel.unsubscribe('event1', handler);
          cb(null);
        };
        rxChannel.subscribe('event1', handler);
        txChannel.publish('event1', messageText);
      };

      var setSecondKey = function (cb) {
        rxChannel.setOptions({ cipher: { key: secondKey } });
        cb();
      };

      var sendThirdMessage = function (cb) {
        var handler = function (msg) {
          expect(msg.data == messageText, 'Message data not expected (third message)').to.be.ok;
          rxChannel.unsubscribe('event2', handler);
          cb(null);
        };
        rxChannel.subscribe('event2', handler);
        txChannel.publish('event2', messageText);
      };

      async.series(
        [
          waitAttach,
          setInitialOptions,
          sendFirstMessage,
          createSecondKey,
          sendSecondMessage,
          setSecondKey,
          sendThirdMessage,
        ],
        function (err) {
          helper.closeAndFinish(done, [txRealtime, rxRealtime], err);
        },
      );
    });
  });
});
