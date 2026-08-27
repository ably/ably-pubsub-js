'use strict';

define(['ably', 'shared_helper', 'async', 'chai'], function (Ably, Helper, async, chai) {
  const expect = chai.expect;

  describe('realtime/message-operations', function () {
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

    /**
     * Test that publish returns serials
     */
    it('Should return serials from publish', async function () {
      const helper = this.test.helper;
      const realtime = helper.AblyRealtime();

      try {
        const channel = realtime.channels.get('mutable:rt_publish_serials');
        await channel.attach();

        const result = await channel.publish('test-message', { value: 'test' });
        expect(result).to.have.property('serials');
        expect(result.serials).to.be.an('array');
        expect(result.serials.length).to.equal(1);
        expect(result.serials[0]).to.be.a('string');
      } finally {
        realtime.close();
      }
    });

    /**
     * Test that publish with multiple messages returns multiple serials
     */
    it('Should return multiple serials for batch publish', async function () {
      const helper = this.test.helper;
      const realtime = helper.AblyRealtime();

      try {
        const channel = realtime.channels.get('mutable:rt_publish_batch_serials');
        await channel.attach();

        const messages = [
          { name: 'msg1', data: 'data1' },
          { name: 'msg2', data: 'data2' },
          { name: 'msg3', data: 'data3' },
        ];

        const result = await channel.publish(messages);
        expect(result.serials).to.be.an('array');
        expect(result.serials.length).to.equal(3);
        result.serials.forEach((serial) => {
          expect(serial).to.be.a('string');
        });
      } finally {
        realtime.close();
      }
    });

    /**
     * Test updateMessage over realtime connection
     */
    it('Should update a message over realtime', async function () {
      const helper = this.test.helper;
      const realtime = helper.AblyRealtime();

      try {
        const channel = realtime.channels.get('mutable:rt_updatesanddeletes_update');
        await channel.attach();

        // Set up subscription to capture the update
        const updatePromise = new Promise((resolve) => {
          channel.subscribe((msg) => {
            if (msg.action === 'message.update') {
              resolve(msg);
            }
          });
        });

        const { serials } = await channel.publish('original-message', { value: 'original' });
        const serial = serials[0];

        const updateMessage = {
          serial: serial,
          data: { value: 'updated via realtime' },
        };

        const operation = {
          clientId: 'rt-updater-client',
          description: 'Realtime update operation',
          metadata: { reason: 'testing realtime' },
        };

        const updateResult = await channel.updateMessage(updateMessage, operation);
        expect(updateResult).to.have.property('versionSerial');
        expect(updateResult.versionSerial).to.be.a('string');

        const updateMsg = await updatePromise;

        expect(updateMsg.serial).to.equal(serial);
        expect(updateMsg.version?.serial).to.equal(updateResult.versionSerial);
        expect(updateMsg.version?.clientId).to.equal('rt-updater-client');
        expect(updateMsg.version?.description).to.equal('Realtime update operation');
        expect(updateMsg.version?.metadata).to.deep.equal({ reason: 'testing realtime' });
        expect(updateMsg.action).to.equal('message.update');
        expect(updateMsg.data).to.deep.equal({ value: 'updated via realtime' });
        expect(updateMsg.name).to.equal('original-message');
      } finally {
        realtime.close();
      }
    });

    /**
     * Test deleteMessage over realtime connection
     */
    it('Should delete a message over realtime', async function () {
      const helper = this.test.helper;
      const realtime = helper.AblyRealtime();

      try {
        const channel = realtime.channels.get('mutable:rt_updatesanddeletes_delete');
        await channel.attach();

        // Set up subscription to capture the delete
        const deletePromise = new Promise((resolve) => {
          channel.subscribe((msg) => {
            if (msg.action === 'message.delete') {
              resolve(msg);
            }
          });
        });

        const { serials } = await channel.publish('message-to-delete', { value: 'will be deleted' });
        const serial = serials[0];

        const operation = {
          clientId: 'rt-deleter-client',
          description: 'Realtime delete operation',
          metadata: { reason: 'testing realtime delete' },
        };

        const deletion = { serial, data: {} };

        const deleteResult = await channel.deleteMessage(deletion, operation);
        expect(deleteResult).to.have.property('versionSerial');
        expect(deleteResult.versionSerial).to.be.a('string');

        const deleteMsg = await deletePromise;

        expect(deleteMsg.serial).to.equal(serial);
        expect(deleteMsg.version?.serial).to.equal(deleteResult.versionSerial);
        expect(deleteMsg.data).to.deep.equal({});
        expect(deleteMsg.name).to.equal('message-to-delete');
        expect(deleteMsg.version?.clientId).to.equal('rt-deleter-client');
        expect(deleteMsg.version?.description).to.equal('Realtime delete operation');
        expect(deleteMsg.version?.metadata).to.deep.equal({ reason: 'testing realtime delete' });
        expect(deleteMsg.action).to.equal('message.delete');
      } finally {
        realtime.close();
      }
    });

    /**
     * Test error handling for updateMessage without serial
     */
    it('Should error when called without serial', async function () {
      const helper = this.test.helper;
      const realtime = helper.AblyRealtime();

      try {
        const channel = realtime.channels.get('mutable:rt_updatesanddeletes_error');
        await channel.attach();

        try {
          await channel.updateMessage({ data: 'test' });
          expect.fail('Should have thrown an error');
        } catch (err) {
          expect(err).to.have.property('code', 40003);
        }

        try {
          await channel.deleteMessage({});
          expect.fail('Should have thrown an error');
        } catch (err) {
          expect(err).to.have.property('code', 40003);
        }

        try {
          await channel.appendMessage({ data: 'test' });
          expect.fail('Should have thrown an error');
        } catch (err) {
          expect(err).to.have.property('code', 40003);
        }
      } finally {
        realtime.close();
      }
    });

    /**
     * Test appendMessage over realtime connection
     */
    it('Should append to a message over realtime', async function () {
      const helper = this.test.helper;
      const realtime = helper.AblyRealtime();

      try {
        const channel = realtime.channels.get('mutable:rt_updatesanddeletes_append');
        await channel.attach();

        const appendPromise = new Promise((resolve) => {
          channel.subscribe((msg) => {
            if (msg.action === 'message.append') {
              resolve(msg);
            }
          });
        });

        const { serials } = await channel.publish('original-message', 'Hello');
        const serial = serials[0];

        const appendMessage = {
          serial: serial,
          data: ' World',
        };

        const operation = {
          clientId: 'rt-appender-client',
          description: 'Realtime append operation',
          metadata: { reason: 'testing realtime append' },
        };

        const appendResult = await channel.appendMessage(appendMessage, operation);
        expect(appendResult).to.have.property('versionSerial');
        expect(appendResult.versionSerial).to.be.a('string');

        const appendMsg = await appendPromise;

        expect(appendMsg.serial).to.equal(serial);
        expect(appendMsg.version?.serial).to.equal(appendResult.versionSerial);
        expect(appendMsg.version?.clientId).to.equal('rt-appender-client');
        expect(appendMsg.version?.description).to.equal('Realtime append operation');
        expect(appendMsg.version?.metadata).to.deep.equal({ reason: 'testing realtime append' });
        expect(appendMsg.action).to.equal('message.append');
        expect(appendMsg.name).to.equal('original-message');
        expect(appendMsg.data).to.equal(' World');

        // now reattach with rewind to get the full concatenated message. Set rewind before any attach is
        // initiated (subscribe() auto-attaches), so the sole ATTACH carries it — rewind is an initial-attach
        // directive, so a second ATTACH racing an already-established attachment does not reliably replay.
        await channel.detach();
        await channel.setOptions({ params: { rewind: '1' } });
        const updatePromise = new Promise((resolve) => {
          channel.subscribe((msg) => {
            resolve(msg);
          });
        });

        await channel.attach();
        const updatedMsg = await updatePromise;
        expect(updatedMsg.serial).to.equal(serial);
        expect(updatedMsg.version?.serial).to.equal(appendResult.versionSerial);
        expect(updatedMsg.version?.clientId).to.equal('rt-appender-client');
        expect(updatedMsg.version?.description).to.equal('Realtime append operation');
        expect(updatedMsg.version?.metadata).to.deep.equal({ reason: 'testing realtime append' });
        expect(updatedMsg.action).to.equal('message.update');
        expect(updatedMsg.name).to.equal('original-message');
        expect(updatedMsg.data).to.equal('Hello World');
      } finally {
        realtime.close();
      }
    });
  });
});
