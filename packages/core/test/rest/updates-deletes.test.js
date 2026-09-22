'use strict';

define(['ably', 'shared_helper', 'async', 'chai'], function (Ably, Helper, async, chai) {
  const expect = chai.expect;

  describe('rest/message-operations', function () {
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
      const rest = helper.AblyRest({});
      const channel = rest.channels.get('mutable:publish_serials');

      const result = await channel.publish('test-message', { value: 'test' });
      expect(result).to.have.property('serials');
      expect(result.serials).to.be.an('array');
      expect(result.serials.length).to.equal(1);
      expect(result.serials[0]).to.be.a('string');
    });

    /**
     * Test that publish with multiple messages returns multiple serials
     */
    it('Should return multiple serials for batch publish', async function () {
      const helper = this.test.helper;
      const rest = helper.AblyRest({});
      const channel = rest.channels.get('mutable:publish_batch_serials');

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
    });

    /**
     * Test getMessage functionality
     *
     * @spec RSL11
     */
    it('Should retrieve a message by serial', async function () {
      const helper = this.test.helper;
      const rest = helper.AblyRest({});
      const channel = rest.channels.get('mutable:updatesanddeletes_get');

      const { serials } = await channel.publish('test-message', { value: 'original' });
      const serial = serials[0];

      const retrievedMessage = await channel.getMessage(serial);
      expect(retrievedMessage.serial).to.equal(serial);
      expect(retrievedMessage.name).to.equal('test-message');
      expect(retrievedMessage.data).to.deep.equal({ value: 'original' });
    });

    /**
     * Test getMessage with Message object
     *
     * @spec RSL11a1
     */
    it('Should retrieve a message by passing a Message object', async function () {
      const helper = this.test.helper;
      const rest = helper.AblyRest({});
      const channel = rest.channels.get('mutable:updatesanddeletes_get_obj');

      const { serials } = await channel.publish('test-message-obj', { value: 'original' });
      const serial = serials[0];

      const retrievedMessage = await channel.getMessage({ serial });
      expect(retrievedMessage.serial).to.equal(serial);
      expect(retrievedMessage.name).to.equal('test-message-obj');
    });

    /**
     * Test updateMessage with operation metadata
     *
     * @spec RSL12
     */
    it('Should update a message (with operation metadata)', async function () {
      const helper = this.test.helper;
      const rest = helper.AblyRest({});
      const channel = rest.channels.get('mutable:updatesanddeletes_update_meta');

      const { serials } = await channel.publish('original-message', { value: 'original' });
      const serial = serials[0];
      const originalMessage = await channel.getMessage(serial);

      const updateMessage = {
        serial: serial,
        data: { value: 'updated with metadata' },
      };

      const operation = {
        clientId: 'updater-client',
        description: 'Test update operation',
        metadata: { reason: 'testing' },
      };

      const updateResult = await channel.updateMessage(updateMessage, operation);
      expect(updateResult).to.have.property('versionSerial');
      expect(updateResult.versionSerial).to.be.a('string');

      // Wait for the update to be the latest message
      let latestMessage;
      await helper.waitFor(async () => {
        latestMessage = await channel.getMessage(originalMessage.serial);
        return latestMessage.data.value === 'updated with metadata';
      }, 10000);
      expect(latestMessage.serial).to.equal(serial);
      expect(latestMessage.version?.serial > originalMessage.serial).to.be.ok;
      expect(latestMessage.version?.timestamp).to.be.greaterThan(originalMessage.timestamp);
      expect(latestMessage.version?.clientId).to.equal('updater-client');
      expect(latestMessage.version?.description).to.equal('Test update operation');
      expect(latestMessage.version?.metadata).to.deep.equal({ reason: 'testing' });
      expect(latestMessage.action).to.equal('message.update');
      expect(latestMessage.data).to.deep.equal({ value: 'updated with metadata' });
      expect(latestMessage.name).to.equal('original-message');
    });

    /**
     * Test deleteMessage with operation metadata
     *
     * @spec RSL15a
     */
    it('Should delete a message (with operation metadata)', async function () {
      const helper = this.test.helper;
      const rest = helper.AblyRest({});
      const channel = rest.channels.get('mutable:updatesanddeletes_delete_meta');

      const { serials } = await channel.publish('message-to-delete', { value: 'will be deleted' });
      const serial = serials[0];
      const originalMessage = await channel.getMessage(serial);

      const operation = {
        clientId: 'deleter-client',
        description: 'Test delete operation',
        metadata: { reason: 'inappropriate content' },
      };

      const deletion = { serial, data: {} };

      const deleteResult = await channel.deleteMessage(deletion, operation);
      expect(deleteResult).to.have.property('versionSerial');
      expect(deleteResult.versionSerial).to.be.a('string');

      // Wait for the delete to be the latest message
      let latestMessage;
      await helper.waitFor(async () => {
        latestMessage = await channel.getMessage(originalMessage.serial);
        return latestMessage.action === 'message.delete';
      }, 10000);
      expect(latestMessage.serial).to.equal(serial);
      expect(latestMessage.data).to.deep.equal({});
      expect(latestMessage.name).to.equal('message-to-delete');
      expect(latestMessage.version?.serial > originalMessage.serial).to.be.ok;
      expect(latestMessage.version?.timestamp).to.be.greaterThan(originalMessage.timestamp);
      expect(latestMessage.version?.clientId).to.equal('deleter-client');
      expect(latestMessage.version?.description).to.equal('Test delete operation');
      expect(latestMessage.version?.metadata).to.deep.equal({ reason: 'inappropriate content' });
      expect(latestMessage.action).to.equal('message.delete');
    });

    /**
     * Test getMessageVersions functionality
     *
     * @spec RSL14
     */
    it('Should retrieve all versions of a message', async function () {
      const helper = this.test.helper;
      const rest = helper.AblyRest({});
      const channel = rest.channels.get('mutable:updatesanddeletes_versions');

      const { serials } = await channel.publish('versioned-message', { value: 'version-1' });
      const serial = serials[0];

      const updateMessage = {
        serial: serial,
        data: { value: 'version-2' },
      };
      await channel.updateMessage(updateMessage);

      // Wait for versions to be available
      let items;
      await helper.waitFor(async () => {
        const versionsPage = await channel.getMessageVersions(serial);
        items = versionsPage.items;
        return items.length >= 2;
      }, 10000);

      expect(items.length).to.be.at.least(2);

      const actions = items.map((m) => m.action);
      expect(actions).to.include('message.create');
      expect(actions).to.include('message.update');
    });

    /**
     * Test error handling for getMessage without serial
     */
    it('Should error when getMessage called without serial', async function () {
      const helper = this.test.helper;
      const rest = helper.AblyRest({});
      const channel = rest.channels.get('mutable:updatesanddeletes_error');

      try {
        await channel.getMessage({});
        expect.fail('Should have thrown an error');
      } catch (err) {
        expect(err).to.have.property('code', 40003);
      }
    });

    /**
     * Test error handling for updateMessage without serial
     */
    it('Should error when updateMessage called without serial', async function () {
      const helper = this.test.helper;
      const rest = helper.AblyRest({});
      const channel = rest.channels.get('mutable:updatesanddeletes_error');

      try {
        await channel.updateMessage({ data: 'test' });
        expect.fail('Should have thrown an error');
      } catch (err) {
        expect(err).to.have.property('code', 40003);
      }
    });

    /**
     * Test error handling for deleteMessage without serial
     */
    it('Should error when deleteMessage called without serial', async function () {
      const helper = this.test.helper;
      const rest = helper.AblyRest({});
      const channel = rest.channels.get('mutable:updatesanddeletes_error');

      try {
        await channel.deleteMessage({});
        expect.fail('Should have thrown an error');
      } catch (err) {
        expect(err).to.have.property('code', 40003);
      }
    });

    /**
     * Test error handling for getMessageVersions without serial
     */
    it('Should error when getMessageVersions called without serial', async function () {
      const helper = this.test.helper;
      const rest = helper.AblyRest({});
      const channel = rest.channels.get('mutable:updatesanddeletes_error');

      try {
        await channel.getMessageVersions({});
        expect.fail('Should have thrown an error');
      } catch (err) {
        expect(err).to.have.property('code', 40003);
      }
    });

    /**
     * Test appendMessage with operation metadata
     *
     * @spec RSL15
     */
    it('Should append to a message (with operation metadata)', async function () {
      const helper = this.test.helper;
      const rest = helper.AblyRest({});
      const channel = rest.channels.get('mutable:updatesanddeletes_append_meta');

      const { serials } = await channel.publish('original-message', 'Hello');
      const serial = serials[0];
      const originalMessage = await channel.getMessage(serial);

      const appendMessage = {
        serial: serial,
        data: ' World',
      };

      const operation = {
        clientId: 'appender-client',
        description: 'Test append operation',
        metadata: { reason: 'testing append' },
      };

      const appendResult = await channel.appendMessage(appendMessage, operation);
      expect(appendResult).to.have.property('versionSerial');
      expect(appendResult.versionSerial).to.be.a('string');

      // Wait for the append to be the latest message
      let latestMessage;
      await helper.waitFor(async () => {
        latestMessage = await channel.getMessage(originalMessage.serial);
        return latestMessage.data === 'Hello World';
      }, 10000);
      expect(latestMessage.serial).to.equal(serial);
      expect(latestMessage.version?.serial > originalMessage.serial).to.be.ok;
      expect(latestMessage.version?.timestamp).to.be.greaterThan(originalMessage.timestamp);
      expect(latestMessage.version?.clientId).to.equal('appender-client');
      expect(latestMessage.version?.description).to.equal('Test append operation');
      expect(latestMessage.version?.metadata).to.deep.equal({ reason: 'testing append' });
      expect(latestMessage.action).to.equal('message.update');
      expect(latestMessage.data).to.equal('Hello World');
      expect(latestMessage.name).to.equal('original-message');
    });

    /**
     * Test error handling for appendMessage without serial
     */
    it('Should error when appendMessage called without serial', async function () {
      const helper = this.test.helper;
      const rest = helper.AblyRest({});
      const channel = rest.channels.get('mutable:updatesanddeletes_error');

      try {
        await channel.appendMessage({ data: 'test' });
        expect.fail('Should have thrown an error');
      } catch (err) {
        expect(err).to.have.property('code', 40003);
      }
    });
  });
});
