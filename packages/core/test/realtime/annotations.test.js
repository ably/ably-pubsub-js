'use strict';

define(['ably', 'shared_helper', 'chai'], function (Ably, Helper, chai) {
  const { assert } = chai;
  const Crypto = Ably.Realtime.Platform.Crypto;
  describe('realtime/annotations', function () {
    this.timeout(10 * 1000);
    let rest, helper, realtime;

    before(function (done) {
      helper = Helper.forHook(this);

      helper.setupApp(function (err) {
        if (err) {
          done(err);
          return;
        }
        rest = helper.AblyRest({ clientId: Helper.randomString(10) });
        done();
      });
    });

    beforeEach(async () => {
      realtime = helper.AblyRealtime({ clientId: Helper.randomString(10) });
    });

    afterEach(async () => {
      return realtime.close();
    });

    it('publish and subscribe annotations', async () => {
      const channel = realtime.channels.get('mutable:publish_subscribe_annotation', {
        modes: ['publish', 'subscribe', 'annotation_publish', 'annotation_subscribe'],
      });
      const restChannel = rest.channels.get('mutable:publish_subscribe_annotation');
      await channel.attach();
      let onMessage = channel.subscriptions.once();
      let onAnnotation = channel.annotations.subscriptions.once();

      await channel.publish('message', 'foobar');
      const message = await onMessage;
      onMessage = channel.subscriptions.once();

      await channel.annotations.publish(message, { type: 'reaction:distinct.v1', name: '👍' });
      let annotation = await onAnnotation;
      assert.equal(annotation.action, 'annotation.create');
      assert.equal(annotation.messageSerial, message.serial);
      assert.equal(annotation.type, 'reaction:distinct.v1');
      assert.equal(annotation.name, '👍');
      assert.ok(annotation.serial > annotation.messageSerial);

      // wait for the summary
      const summary = await onMessage;
      assert.equal(summary.action, 'message.summary');
      assert.equal(summary.serial, message.serial);

      // try again but with rest publish
      onAnnotation = channel.annotations.subscriptions.once();

      await restChannel.annotations.publish(message, { type: 'reaction:distinct.v1', name: '😕' });
      annotation = await onAnnotation;
      assert.equal(annotation.action, 'annotation.create');
      assert.equal(annotation.messageSerial, message.serial);
      assert.equal(annotation.type, 'reaction:distinct.v1');
      assert.equal(annotation.name, '😕');
      assert.ok(annotation.serial > annotation.messageSerial);
    });

    it('annotation data payloads round-trip on an encrypted channel', async () => {
      const key = await Crypto.generateRandomKey();
      const channelName = 'mutable:annotation_encrypted_data';
      const channel = realtime.channels.get(channelName, {
        cipher: { key },
        modes: ['publish', 'subscribe', 'annotation_publish', 'annotation_subscribe'],
      });
      const restChannel = rest.channels.get(channelName, { cipher: { key } });
      await channel.attach();
      const onMessage = channel.subscriptions.once();
      let onAnnotation = channel.annotations.subscriptions.once();

      await channel.publish('message', 'foobar');
      const message = await onMessage;
      assert.equal(message.data, 'foobar', 'check message data decrypted');

      await channel.annotations.publish(message, {
        type: 'reaction:distinct.v1',
        name: '👍',
        data: 'realtime annotation data',
      });
      let annotation = await onAnnotation;
      assert.equal(
        annotation.data,
        'realtime annotation data',
        'check realtime-published annotation data round-tripped',
      );

      // and again via the rest publish path
      onAnnotation = channel.annotations.subscriptions.once();
      await restChannel.annotations.publish(message, {
        type: 'reaction:distinct.v1',
        name: '😕',
        data: 'rest annotation data',
      });
      annotation = await onAnnotation;
      assert.equal(annotation.data, 'rest annotation data', 'check rest-published annotation data round-tripped');
    });

    /* A round-trip test cannot catch a failure to encrypt: an unencrypted payload
     * decodes to itself, so publish and subscribe stay mutually consistent. Assert
     * on the serialized annotation as it leaves the client instead. */
    it('annotation data is encrypted on the wire on an encrypted channel', async () => {
      const key = await Crypto.generateRandomKey();
      const channelName = 'mutable:annotation_wire_encryption';
      const plaintext = 'super-secret-annotation-data';

      const channel = realtime.channels.get(channelName, {
        cipher: { key },
        modes: ['publish', 'subscribe', 'annotation_publish', 'annotation_subscribe'],
      });
      // text protocol so the intercepted rest body can be parsed as JSON
      const jsonRest = helper.AblyRest({ clientId: Helper.randomString(10), useBinaryProtocol: false });
      const restChannel = jsonRest.channels.get(channelName, { cipher: { key } });
      await channel.attach();
      const onMessage = channel.subscriptions.once();
      await channel.publish('message', 'foobar');
      const message = await onMessage;

      const assertEncrypted = function (wireAnnotation, description) {
        assert.exists(wireAnnotation, 'check outgoing annotation was intercepted for ' + description);
        assert.include(
          wireAnnotation.encoding || '',
          'cipher+aes-256-cbc',
          'check ' + description + ' annotation declares a cipher encoding',
        );
        assert.notInclude(
          JSON.stringify(wireAnnotation.data),
          plaintext,
          'check ' + description + ' annotation data is not sent in plaintext',
        );
      };

      // realtime publish path: intercept the outgoing ANNOTATION protocol message
      let sentAnnotation;
      const connectionManager = realtime.connection.connectionManager;
      helper.recordPrivateApi('replace.connectionManager.send');
      const sendOrig = connectionManager.send;
      connectionManager.send = function (msg, queueEvent, callback) {
        if (msg.action === 21 /* ANNOTATION */ && msg.annotations) {
          sentAnnotation = msg.annotations[0];
        }
        helper.recordPrivateApi('call.connectionManager.send');
        sendOrig.call(connectionManager, msg, queueEvent, callback);
      };

      try {
        await channel.annotations.publish(message, { type: 'reaction:distinct.v1', name: '👍', data: plaintext });
      } finally {
        connectionManager.send = sendOrig;
      }
      assertEncrypted(sentAnnotation, 'realtime-published');

      // rest publish path: intercept the serialized request body
      let postedAnnotation;
      helper.recordPrivateApi('replace.rest.http.do');
      const httpDoOrig = jsonRest.http.do;
      jsonRest.http.do = function (method, path, headers, body, params) {
        if (path.includes('/annotations') && body) {
          postedAnnotation = JSON.parse(body)[0];
        }
        helper.recordPrivateApi('call.rest.http.do');
        return httpDoOrig.call(jsonRest.http, method, path, headers, body, params);
      };

      try {
        await restChannel.annotations.publish(message, { type: 'reaction:distinct.v1', name: '😕', data: plaintext });
      } finally {
        jsonRest.http.do = httpDoOrig;
      }
      assertEncrypted(postedAnnotation, 'rest-published');
    });

    it('get all annotations rest request', async () => {
      const channel = realtime.channels.get('mutable:get_all_annotations_for_a_message', {
        modes: ['publish', 'subscribe', 'annotation_publish', 'annotation_subscribe'],
      });
      await channel.attach();
      const onMessage = channel.subscriptions.once();
      await channel.publish('message', 'foobar');
      const message = await onMessage;
      for (let emoji of ['👍', '😕', '👎', '👍👍', '😕😕', '👎👎']) {
        await channel.annotations.publish(message.serial, { type: 'reaction:distinct.v1', name: emoji });
      }

      let annotations = [];
      await helper.waitFor(async () => {
        const res = await channel.annotations.get(message.serial, {});
        annotations = res.items;
        return annotations.length === 6;
      }, 10_000);

      assert.equal(annotations[0].action, 'annotation.create');
      assert.equal(annotations[0].messageSerial, message.serial);
      assert.equal(annotations[0].type, 'reaction:distinct.v1');
      assert.equal(annotations[0].name, '👍');
      assert.equal(annotations[1].name, '😕');
      assert.equal(annotations[2].name, '👎');
      assert.ok(annotations[1].serial > annotations[0].serial);
      assert.ok(annotations[2].serial > annotations[1].serial);

      // test pagination
      let res = await channel.annotations.get(message.serial, { limit: 2 });
      assert.equal(res.items.length, 2);
      assert.deepEqual(
        res.items.map((a) => a.name),
        ['👍', '😕'],
      );
      assert.ok(res.hasNext());
      res = await res.next();
      assert.ok(res);
      assert.equal(res.items.length, 2);
      assert.deepEqual(
        res.items.map((a) => a.name),
        ['👎', '👍👍'],
      );
      assert.ok(res.hasNext());
      res = await res.next();
      assert.ok(res);
      assert.equal(res.items.length, 2);
      assert.deepEqual(
        res.items.map((a) => a.name),
        ['😕😕', '👎👎'],
      );
      assert.ok(!res.hasNext());
    });
  });
});
