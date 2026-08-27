/**
 * UTS Integration: Push Admin Tests
 *
 * Spec points: RSH1, RSH1a, RSH1b1, RSH1b2, RSH1b3, RSH1b4, RSH1b5, RSH1c1, RSH1c2, RSH1c3, RSH1c4, RSH1c5
 * Source: uts/rest/integration/push_admin.md
 */

import { expect } from 'chai';
import { Ably, SANDBOX_ENDPOINT, setupSandbox, teardownSandbox, getApiKey, uniqueChannelName } from './sandbox';

function randomId(): string {
  return Math.random().toString(36).substring(2, 10);
}

describe('uts/rest/integration/push_admin', function () {
  this.timeout(120000);

  before(async function () {
    await setupSandbox();
  });

  after(async function () {
    await teardownSandbox();
  });

  // ---------------------------------------------------------------------------
  // RSH1a — Push publish
  // ---------------------------------------------------------------------------

  /**
   * RSH1a - publish sends push notification to clientId
   *
   * Publishes a push notification to a clientId recipient. The sandbox
   * accepts the request even though no real device receives it.
   */
  // UTS: rest/integration/RSH1a/push-publish-clientid-0
  it('RSH1a - publish to clientId recipient should not throw', async function () {
    const client = new Ably.Rest({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
    });

    await client.push.admin.publish(
      { clientId: 'test-client-push' },
      {
        notification: {
          title: 'Integration Test',
          body: 'Hello from push admin',
        },
      },
    );
  });

  /**
   * RSH1a - publish rejects invalid recipient
   *
   * An empty recipient object should cause the server to return an error.
   */
  // UTS: rest/integration/RSH1a/push-publish-invalid-recipient-1
  it('RSH1a - publish with empty recipient throws error', async function () {
    const client = new Ably.Rest({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
    });

    try {
      await client.push.admin.publish({}, { notification: { title: 'Test' } });
      expect.fail('Publish with empty recipient should have failed');
    } catch (error: any) {
      expect(error.code).to.not.be.null;
    }
  });

  // ---------------------------------------------------------------------------
  // RSH1b — Device registrations
  // ---------------------------------------------------------------------------

  /**
   * RSH1b3, RSH1b1 - save and get device registration
   *
   * Saves a device registration, then retrieves it by ID and verifies
   * the returned fields.
   */
  // UTS: rest/integration/RSH1b3/save-and-get-device-0
  it('RSH1b3, RSH1b1 - save and get device registration', async function () {
    const client = new Ably.Rest({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
    });

    const deviceId = 'test-device-' + randomId();

    try {
      const saved = await client.push.admin.deviceRegistrations.save({
        id: deviceId,
        platform: 'ios',
        formFactor: 'phone',
        push: {
          recipient: { transportType: 'apns', deviceToken: 'test-token-' + randomId() },
        },
      });

      expect(saved).to.be.an('object');
      expect(saved.id).to.equal(deviceId);
      expect(saved.platform).to.equal('ios');
      expect(saved.formFactor).to.equal('phone');
      expect(saved.push!.recipient!.transportType).to.equal('apns');

      // Retrieve the same device
      const retrieved = await client.push.admin.deviceRegistrations.get(deviceId);
      expect(retrieved).to.be.an('object');
      expect(retrieved.id).to.equal(deviceId);
      expect(retrieved.platform).to.equal('ios');
    } finally {
      await client.push.admin.deviceRegistrations.remove(deviceId);
    }
  });

  /**
   * RSH1b3 - save updates existing device registration
   *
   * Saving a device with the same ID but a different token should update
   * the existing registration.
   */
  // UTS: rest/integration/RSH1b3/update-device-registration-1
  it('RSH1b3 - save updates existing device registration', async function () {
    const client = new Ably.Rest({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
    });

    const deviceId = 'test-device-update-' + randomId();

    try {
      // Initial save
      await client.push.admin.deviceRegistrations.save({
        id: deviceId,
        platform: 'ios',
        formFactor: 'phone',
        push: {
          recipient: { transportType: 'apns', deviceToken: 'token-v1' },
        },
      });

      // Update with new token
      const updated = await client.push.admin.deviceRegistrations.save({
        id: deviceId,
        platform: 'ios',
        formFactor: 'phone',
        push: {
          recipient: { transportType: 'apns', deviceToken: 'token-v2' },
        },
      });

      expect(updated.id).to.equal(deviceId);
      expect((updated.push!.recipient as any).deviceToken).to.equal('token-v2');

      // Verify via get
      const retrieved = await client.push.admin.deviceRegistrations.get(deviceId);
      expect((retrieved.push!.recipient as any).deviceToken).to.equal('token-v2');
    } finally {
      await client.push.admin.deviceRegistrations.remove(deviceId);
    }
  });

  /**
   * RSH1b1 - get returns error for unknown device
   *
   * Retrieving a nonexistent device must return a 404 error.
   */
  // UTS: rest/integration/RSH1b1/get-unknown-device-error-0
  it('RSH1b1 - get unknown device throws 404', async function () {
    const client = new Ably.Rest({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
    });

    try {
      await client.push.admin.deviceRegistrations.get('nonexistent-device-' + randomId());
      expect.fail('Get should have failed for nonexistent device');
    } catch (error: any) {
      expect(error.statusCode).to.equal(404);
    }
  });

  /**
   * RSH1b2 - list device registrations with filters
   *
   * Lists device registrations filtered by deviceId. The result should be
   * a PaginatedResult containing exactly the registered device.
   */
  // UTS: rest/integration/RSH1b2/list-devices-filtered-0
  it('RSH1b2 - list device registrations filtered by deviceId', async function () {
    const client = new Ably.Rest({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
    });

    const deviceId = 'test-device-list-' + randomId();

    try {
      await client.push.admin.deviceRegistrations.save({
        id: deviceId,
        platform: 'android',
        formFactor: 'tablet',
        push: {
          recipient: { transportType: 'gcm', registrationToken: 'test-token' },
        },
      });

      const result = await client.push.admin.deviceRegistrations.list({ deviceId });

      expect(result.items).to.have.length(1);
      expect((result.items[0] as any).id).to.equal(deviceId);
      expect((result.items[0] as any).platform).to.equal('android');
    } finally {
      await client.push.admin.deviceRegistrations.remove(deviceId);
    }
  });

  /**
   * RSH1b2 - list supports pagination with limit
   *
   * Registering 3 devices with the same clientId, then listing with limit=2
   * should return at most 2 items and indicate more pages are available.
   */
  // UTS: rest/integration/RSH1b2/list-devices-pagination-1
  it('RSH1b2 - list supports pagination with limit', async function () {
    if (!process.env.RUN_DEVIATIONS) this.skip(); // push admin API does not return Link headers for pagination; see ably/realtime#8380
    const client = new Ably.Rest({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
    });

    const clientId = 'test-client-list-' + randomId();
    const deviceIds: string[] = [];

    try {
      // Register 3 devices with the same clientId
      for (let i = 1; i <= 3; i++) {
        const deviceId = 'test-device-limit-' + i + '-' + randomId();
        deviceIds.push(deviceId);
        await client.push.admin.deviceRegistrations.save({
          id: deviceId,
          clientId,
          platform: 'ios',
          formFactor: 'phone',
          push: {
            recipient: { transportType: 'apns', deviceToken: 'token-' + i },
          },
        });
      }

      const result = await client.push.admin.deviceRegistrations.list({
        clientId,
        limit: '2',
      });

      expect(result.items.length).to.be.at.most(2);
      expect(result.hasNext()).to.equal(true);
    } finally {
      for (const deviceId of deviceIds) {
        await client.push.admin.deviceRegistrations.remove(deviceId);
      }
    }
  });

  /**
   * RSH1b4 - remove deletes device registration
   *
   * Saves a device, removes it, then verifies it is no longer retrievable.
   */
  // UTS: rest/integration/RSH1b4/remove-device-0
  it('RSH1b4 - remove deletes device registration', async function () {
    const client = new Ably.Rest({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
    });

    const deviceId = 'test-device-remove-' + randomId();

    // Register a device
    await client.push.admin.deviceRegistrations.save({
      id: deviceId,
      platform: 'ios',
      formFactor: 'phone',
      push: {
        recipient: { transportType: 'apns', deviceToken: 'test-token' },
      },
    });

    // Remove the device
    await client.push.admin.deviceRegistrations.remove(deviceId);

    // Verify it's gone
    try {
      await client.push.admin.deviceRegistrations.get(deviceId);
      expect.fail('Get should have failed for removed device');
    } catch (error: any) {
      expect(error.statusCode).to.equal(404);
    }
  });

  /**
   * RSH1b4 - remove succeeds for nonexistent device
   *
   * Removing a device that does not exist should not throw.
   */
  // UTS: rest/integration/RSH1b4/remove-nonexistent-device-1
  it('RSH1b4 - remove nonexistent device does not throw', async function () {
    const client = new Ably.Rest({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
    });

    await client.push.admin.deviceRegistrations.remove('nonexistent-device-' + randomId());
  });

  /**
   * RSH1b5 - removeWhere deletes devices by clientId
   *
   * Registers two devices with the same clientId, removes them all via
   * removeWhere, then verifies none remain.
   */
  // UTS: rest/integration/RSH1b5/remove-where-clientid-0
  it('RSH1b5 - removeWhere deletes devices by clientId', async function () {
    const client = new Ably.Rest({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
    });

    const clientId = 'test-client-removeWhere-' + randomId();
    const deviceIds: string[] = [];

    // Register two devices with the same clientId
    for (let i = 1; i <= 2; i++) {
      const deviceId = 'test-device-rw-' + i + '-' + randomId();
      deviceIds.push(deviceId);
      await client.push.admin.deviceRegistrations.save({
        id: deviceId,
        clientId,
        platform: 'ios',
        formFactor: 'phone',
        push: {
          recipient: { transportType: 'apns', deviceToken: 'token-' + i },
        },
      });
    }

    // Remove all devices for this clientId
    await client.push.admin.deviceRegistrations.removeWhere({ clientId });

    // Verify both are gone
    const result = await client.push.admin.deviceRegistrations.list({ clientId });
    expect(result.items).to.have.length(0);
  });

  // ---------------------------------------------------------------------------
  // RSH1c — Channel subscriptions
  // ---------------------------------------------------------------------------

  /**
   * RSH1c3, RSH1c1 - save and list channel subscriptions
   *
   * Registers a device, saves a channel subscription for it, then lists
   * subscriptions on that channel and verifies the subscription appears.
   */
  // UTS: rest/integration/RSH1c3/save-and-list-subscriptions-0
  it('RSH1c3, RSH1c1 - save and list channel subscription by deviceId', async function () {
    const client = new Ably.Rest({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
    });

    const deviceId = 'test-device-sub-' + randomId();
    const channelName = 'pushenabled:test-sub-' + randomId();

    try {
      // Register a device first (required for deviceId subscriptions)
      await client.push.admin.deviceRegistrations.save({
        id: deviceId,
        platform: 'ios',
        formFactor: 'phone',
        push: {
          recipient: { transportType: 'apns', deviceToken: 'test-token' },
        },
      });

      // Save a channel subscription
      const saved = await client.push.admin.channelSubscriptions.save({
        channel: channelName,
        deviceId,
      });

      expect(saved).to.be.an('object');
      expect(saved.channel).to.equal(channelName);
      expect(saved.deviceId).to.equal(deviceId);

      // List subscriptions for this channel
      const result = await client.push.admin.channelSubscriptions.list({ channel: channelName });
      expect(result.items.length).to.be.at.least(1);

      let found = false;
      for (const sub of result.items) {
        if ((sub as any).deviceId === deviceId) {
          found = true;
          expect((sub as any).channel).to.equal(channelName);
        }
      }
      expect(found).to.equal(true);
    } finally {
      await client.push.admin.channelSubscriptions.remove({
        channel: channelName,
        deviceId,
      });
      await client.push.admin.deviceRegistrations.remove(deviceId);
    }
  });

  /**
   * RSH1c3 - save channel subscription with clientId
   *
   * Saves a clientId-based channel subscription and verifies the response.
   */
  // UTS: rest/integration/RSH1c3/save-subscription-clientid-1
  it('RSH1c3 - save channel subscription with clientId', async function () {
    const client = new Ably.Rest({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
    });

    const clientId = 'test-client-sub-' + randomId();
    const channelName = 'pushenabled:test-clientsub-' + randomId();

    try {
      const saved = await client.push.admin.channelSubscriptions.save({
        channel: channelName,
        clientId,
      });

      expect(saved.channel).to.equal(channelName);
      expect(saved.clientId).to.equal(clientId);
    } finally {
      await client.push.admin.channelSubscriptions.remove({
        channel: channelName,
        clientId,
      });
    }
  });

  /**
   * RSH1c2 - listChannels returns channel names with subscriptions
   *
   * Creates a clientId subscription, then verifies the channel appears
   * in the listChannels result.
   */
  // UTS: rest/integration/RSH1c2/list-channels-with-subscriptions-0
  it('RSH1c2 - listChannels includes channel with active subscription', async function () {
    const client = new Ably.Rest({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
    });

    const clientId = 'test-client-lc-' + randomId();
    const channelName = 'pushenabled:test-listchannels-' + randomId();

    try {
      // Create a subscription to ensure the channel appears
      await client.push.admin.channelSubscriptions.save({
        channel: channelName,
        clientId,
      });

      const result = await client.push.admin.channelSubscriptions.listChannels({});

      expect(result.items).to.be.an('array');
      expect(result.items).to.include(channelName);
    } finally {
      await client.push.admin.channelSubscriptions.remove({
        channel: channelName,
        clientId,
      });
    }
  });

  /**
   * RSH1c4 - remove deletes channel subscription
   *
   * Creates a subscription, removes it, then verifies it no longer appears
   * in list results.
   */
  // UTS: rest/integration/RSH1c4/remove-channel-subscription-0
  it('RSH1c4 - remove deletes channel subscription', async function () {
    const client = new Ably.Rest({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
    });

    const clientId = 'test-client-rm-' + randomId();
    const channelName = 'pushenabled:test-remove-' + randomId();

    // Create a subscription
    await client.push.admin.channelSubscriptions.save({
      channel: channelName,
      clientId,
    });

    // Remove the subscription
    await client.push.admin.channelSubscriptions.remove({
      channel: channelName,
      clientId,
    });

    // Verify it's gone
    const result = await client.push.admin.channelSubscriptions.list({
      channel: channelName,
      clientId,
    });
    expect(result.items).to.have.length(0);
  });

  /**
   * RSH1c4 - remove succeeds for nonexistent subscription
   *
   * Removing a subscription that does not exist should not throw.
   */
  // UTS: rest/integration/RSH1c4/remove-nonexistent-subscription-1
  it('RSH1c4 - remove nonexistent subscription does not throw', async function () {
    const client = new Ably.Rest({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
    });

    await client.push.admin.channelSubscriptions.remove({
      channel: 'pushenabled:nonexistent-' + randomId(),
      clientId: 'nonexistent-client',
    });
  });

  /**
   * RSH1c5 - removeWhere deletes subscriptions by clientId
   *
   * Creates subscriptions on two channels for the same clientId, removes
   * them all via removeWhere, then verifies none remain.
   */
  // UTS: rest/integration/RSH1c5/remove-where-subscriptions-0
  it('RSH1c5 - removeWhere deletes subscriptions by clientId', async function () {
    const client = new Ably.Rest({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
    });

    const clientId = 'test-client-rwsub-' + randomId();
    const channelNames: string[] = [];

    // Create subscriptions on two channels for the same clientId
    for (let i = 1; i <= 2; i++) {
      const ch = 'pushenabled:test-rwsub-' + i + '-' + randomId();
      channelNames.push(ch);
      await client.push.admin.channelSubscriptions.save({
        channel: ch,
        clientId,
      });
    }

    // Remove all subscriptions for this clientId
    await client.push.admin.channelSubscriptions.removeWhere({ clientId });

    // Verify they're all gone
    const result = await client.push.admin.channelSubscriptions.list({ clientId });
    expect(result.items).to.have.length(0);
  });
});
