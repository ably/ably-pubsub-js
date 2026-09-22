/**
 * UTS: Channel State Events Tests
 *
 * Spec points: RTL2, RTL2a, RTL2b, RTL2d, RTL2g, RTL2i, TH1, TH2, TH3, TH5, TH6
 * Source: uts/test/realtime/unit/channels/channel_state_events_test.md
 *
 * Tests ChannelStateChange structure, state change event emission,
 * filtered subscriptions, UPDATE events, hasBacklog and resumed flags.
 *
 * Deviation: TH5 (event field) — ably-js ChannelStateChange has no `event`
 *   property. The event name is available via `this.event` inside the listener
 *   callback context (set by EventEmitter.emit), not on the change object.
 * Deviation: RTL24 (errorReason clearing) — ably-js does NOT clear errorReason
 *   on successful attach/detach. See channel_attributes.test.ts for details.
 */

import { expect } from 'chai';
import { MockWebSocket } from '../../../mock_websocket';
import { Ably, installMockWebSocket, restoreAll, trackClient, flushAsync } from '../../../helpers';

describe('uts/realtime/unit/channels/channel_state_events', function () {
  afterEach(function () {
    restoreAll();
  });

  /**
   * RTL2b - Channel state attribute
   */
  // UTS: realtime/unit/RTL2b/channel-state-attribute-0
  it('RTL2b - channel has state attribute', function () {
    const client = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    const channel = client.channels.get('test-RTL2b');
    expect(channel.state).to.be.a('string');
    client.close();
  });

  /**
   * RTL2b - Channel initial state is initialized
   */
  // UTS: realtime/unit/RTL2b/initial-state-initialized-1
  it('RTL2b - initial state is initialized', function () {
    const client = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    const channel = client.channels.get('test-RTL2b-init');
    expect(channel.state).to.equal('initialized');
    client.close();
  });

  /**
   * RTL2a - State change events emitted for every state change
   */
  // UTS: realtime/unit/RTL2a/state-change-events-emitted-0
  it('RTL2a - state change events emitted', async function () {
    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        conn.respond_with_connected();
      },
      onMessageFromClient: (msg) => {
        if (msg.action === 10) {
          // ATTACH
          mock.active_connection!.send_to_client({
            action: 11, // ATTACHED
            channel: msg.channel,
            flags: 0,
          });
        }
      },
    });
    installMockWebSocket(mock.constructorFn);

    const client = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    const channel = client.channels.get('test-RTL2a');
    const stateChanges: any[] = [];
    channel.on((change: any) => {
      stateChanges.push(change);
    });

    client.connect();
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));
    await channel.attach();

    expect(stateChanges.length).to.be.at.least(2);
    expect(stateChanges[0].current).to.equal('attaching');
    expect(stateChanges[0].previous).to.equal('initialized');
    expect(stateChanges[1].current).to.equal('attached');
    expect(stateChanges[1].previous).to.equal('attaching');
    client.close();
  });

  /**
   * RTL2d, TH1, TH2 - ChannelStateChange object structure
   *
   * Deviation: TH5 — ably-js ChannelStateChange has no `event` property.
   * The event name is available via `this.event` in the listener context.
   */
  // UTS: realtime/unit/RTL2d/state-change-object-structure-0
  it('RTL2d, TH1, TH2 - ChannelStateChange structure', async function () {
    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        conn.respond_with_connected();
      },
      onMessageFromClient: (msg) => {
        if (msg.action === 10) {
          // ATTACH
          mock.active_connection!.send_to_client({
            action: 11, // ATTACHED
            channel: msg.channel,
            flags: 0,
          });
        }
      },
    });
    installMockWebSocket(mock.constructorFn);

    const client = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    const channel = client.channels.get('test-RTL2d');
    let capturedChange: any = null;
    channel.once('attaching', function (change: any) {
      capturedChange = change;
    });

    client.connect();
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));
    await channel.attach();

    expect(capturedChange).to.not.be.null;
    // TH1 - previous state
    expect(capturedChange.previous).to.equal('initialized');
    // TH2 - current state
    expect(capturedChange.current).to.equal('attaching');
    client.close();
  });

  /**
   * RTL2d, TH3 - ChannelStateChange includes error reason when applicable
   */
  // UTS: realtime/unit/RTL2d/state-change-error-reason-1
  it('RTL2d, TH3 - ChannelStateChange includes error reason', async function () {
    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        conn.respond_with_connected();
      },
      onMessageFromClient: (msg) => {
        if (msg.action === 10) {
          // ATTACH
          mock.active_connection!.send_to_client({
            action: 9, // ERROR
            channel: msg.channel,
            error: {
              message: 'Channel denied',
              code: 40160,
              statusCode: 401,
            },
          });
        }
      },
    });
    installMockWebSocket(mock.constructorFn);

    const client = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    const channel = client.channels.get('test-RTL2d-error');
    let capturedChange: any = null;
    channel.once('failed', function (change: any) {
      capturedChange = change;
    });

    client.connect();
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));

    try {
      await channel.attach();
    } catch (err) {
      // Expected
    }

    expect(capturedChange).to.not.be.null;
    expect(capturedChange.current).to.equal('failed');
    expect(capturedChange.reason).to.not.be.null;
    expect(capturedChange.reason).to.not.be.undefined;
    expect(capturedChange.reason.code).to.equal(40160);
    client.close();
  });

  /**
   * RTL2 - Filtered event subscription
   */
  // UTS: realtime/unit/RTL2/filtered-event-subscription-0
  it('RTL2 - filtered event subscription', async function () {
    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        conn.respond_with_connected();
      },
      onMessageFromClient: (msg) => {
        if (msg.action === 10) {
          // ATTACH
          mock.active_connection!.send_to_client({
            action: 11, // ATTACHED
            channel: msg.channel,
            flags: 0,
          });
        }
      },
    });
    installMockWebSocket(mock.constructorFn);

    const client = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    const channel = client.channels.get('test-RTL2-filter');
    const attachedEvents: any[] = [];
    // Subscribe only to 'attached' events
    channel.on('attached', (change: any) => {
      attachedEvents.push(change);
    });

    client.connect();
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));
    await channel.attach();

    expect(attachedEvents.length).to.equal(1);
    expect(attachedEvents[0].current).to.equal('attached');
    client.close();
  });

  /**
   * RTL2g - UPDATE event for condition changes without state change
   *
   * When an ATTACHED message is received while already attached and
   * the RESUMED flag is NOT set, an 'update' event is emitted.
   */
  // UTS: realtime/unit/RTL2g/update-event-condition-change-0
  it('RTL2g - UPDATE event emitted', async function () {
    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        conn.respond_with_connected();
      },
      onMessageFromClient: (msg) => {
        if (msg.action === 10) {
          // ATTACH
          mock.active_connection!.send_to_client({
            action: 11, // ATTACHED
            channel: msg.channel,
            flags: 0,
          });
        }
      },
    });
    installMockWebSocket(mock.constructorFn);

    const client = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    client.connect();
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));

    const channel = client.channels.get('test-RTL2g');
    await channel.attach();
    expect(channel.state).to.equal('attached');

    const updateEvents: any[] = [];
    channel.on('update', (change: any) => {
      updateEvents.push(change);
    });

    // Send another ATTACHED without RESUMED flag
    mock.active_connection!.send_to_client({
      action: 11, // ATTACHED
      channel: 'test-RTL2g',
      flags: 0, // No RESUMED flag
    });

    await flushAsync();

    expect(channel.state).to.equal('attached');
    expect(updateEvents.length).to.equal(1);
    expect(updateEvents[0].current).to.equal('attached');
    expect(updateEvents[0].previous).to.equal('attached');
    expect(updateEvents[0].resumed).to.equal(false);
    client.close();
  });

  /**
   * RTL2g - No duplicate 'attached' state events
   *
   * When an UPDATE occurs, only the 'update' event is emitted, not
   * a duplicate 'attached' event.
   */
  // UTS: realtime/unit/RTL2g/no-duplicate-state-events-1
  it('RTL2g - no duplicate attached events on UPDATE', async function () {
    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        conn.respond_with_connected();
      },
      onMessageFromClient: (msg) => {
        if (msg.action === 10) {
          // ATTACH
          mock.active_connection!.send_to_client({
            action: 11, // ATTACHED
            channel: msg.channel,
            flags: 0,
          });
        }
      },
    });
    installMockWebSocket(mock.constructorFn);

    const client = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    client.connect();
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));

    const channel = client.channels.get('test-RTL2g-nodup');
    const allEvents: any[] = [];
    channel.on((change: any) => {
      allEvents.push(change);
    });

    await channel.attach();
    const countAfterAttach = allEvents.length;

    // Send another ATTACHED without RESUMED
    mock.active_connection!.send_to_client({
      action: 11, // ATTACHED
      channel: 'test-RTL2g-nodup',
      flags: 0,
    });

    await flushAsync();

    // Only one new event should have been emitted (the 'update')
    const newEvents = allEvents.slice(countAfterAttach);
    expect(newEvents.length).to.equal(1);

    // The 'attached' event count should still be 1 (from initial attach)
    const attachedEvents = allEvents.filter((e) => e.current === 'attached' && e.previous === 'attaching');
    expect(attachedEvents.length).to.equal(1);
    client.close();
  });

  /**
   * RTL2i, TH6 - hasBacklog flag in ChannelStateChange
   */
  // UTS: realtime/unit/RTL2i/has-backlog-flag-true-0
  it('RTL2i, TH6 - hasBacklog true when flag present', async function () {
    const HAS_BACKLOG = 2; // 1 << 1

    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        conn.respond_with_connected();
      },
      onMessageFromClient: (msg) => {
        if (msg.action === 10) {
          // ATTACH
          mock.active_connection!.send_to_client({
            action: 11, // ATTACHED
            channel: msg.channel,
            flags: HAS_BACKLOG,
          });
        }
      },
    });
    installMockWebSocket(mock.constructorFn);

    const client = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    const channel = client.channels.get('test-RTL2i');
    let capturedChange: any = null;
    channel.once('attached', (change: any) => {
      capturedChange = change;
    });

    client.connect();
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));
    await channel.attach();

    expect(capturedChange).to.not.be.null;
    expect(capturedChange.hasBacklog).to.equal(true);
    client.close();
  });

  /**
   * RTL2i - hasBacklog false when flag not present
   */
  // UTS: realtime/unit/RTL2i/has-backlog-flag-false-1
  it('RTL2i - hasBacklog false when flag not present', async function () {
    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        conn.respond_with_connected();
      },
      onMessageFromClient: (msg) => {
        if (msg.action === 10) {
          // ATTACH
          mock.active_connection!.send_to_client({
            action: 11, // ATTACHED
            channel: msg.channel,
            flags: 0,
          });
        }
      },
    });
    installMockWebSocket(mock.constructorFn);

    const client = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    const channel = client.channels.get('test-RTL2i-false');
    let capturedChange: any = null;
    channel.once('attached', (change: any) => {
      capturedChange = change;
    });

    client.connect();
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));
    await channel.attach();

    expect(capturedChange).to.not.be.null;
    expect(capturedChange.hasBacklog).to.satisfy((v: any) => v === false || v === undefined || v === null);
    client.close();
  });

  /**
   * RTL2d - resumed flag in ChannelStateChange
   */
  // UTS: realtime/unit/RTL2d/resumed-flag-propagated-2
  it('RTL2d - resumed flag true when RESUMED set', async function () {
    const RESUMED = 4; // 1 << 2

    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        conn.respond_with_connected();
      },
      onMessageFromClient: (msg) => {
        if (msg.action === 10) {
          // ATTACH
          mock.active_connection!.send_to_client({
            action: 11, // ATTACHED
            channel: msg.channel,
            flags: RESUMED,
          });
        }
      },
    });
    installMockWebSocket(mock.constructorFn);

    const client = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    const channel = client.channels.get('test-RTL2d-resumed');
    let capturedChange: any = null;
    channel.once('attached', (change: any) => {
      capturedChange = change;
    });

    client.connect();
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));
    await channel.attach();

    expect(capturedChange).to.not.be.null;
    expect(capturedChange.resumed).to.equal(true);
    client.close();
  });

  /**
   * Channel errorReason attribute populated on FAILED state
   *
   * When a channel enters the FAILED state, errorReason should be
   * populated with the error from the server.
   */
  // UTS: realtime/unit/RTL24/error-reason-populated-0
  it('channel errorReason populated when failed', async function () {
    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        conn.respond_with_connected();
      },
      onMessageFromClient: (msg) => {
        if (msg.action === 10) {
          // ATTACH
          mock.active_connection!.send_to_client({
            action: 9, // ERROR
            channel: msg.channel,
            error: {
              message: 'Not authorized',
              code: 40160,
              statusCode: 401,
            },
          });
        }
      },
    });
    installMockWebSocket(mock.constructorFn);

    const client = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    client.connect();
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));

    const channel = client.channels.get('test-errorReason');

    try {
      await channel.attach();
    } catch (err) {
      // Expected
    }

    expect(channel.state).to.equal('failed');
    expect(channel.errorReason).to.not.be.null;
    expect(channel.errorReason).to.not.be.undefined;
    expect(channel.errorReason!.code).to.equal(40160);
    expect(channel.errorReason!.message).to.include('Not authorized');
    client.close();
  });

  /**
   * RTL4c - errorReason cleared on successful attach after failure
   *
   * Deviation: ably-js does NOT clear errorReason on successful re-attach.
   * This test documents the deviation.
   */
  // UTS: realtime/unit/RTL4c/error-reason-cleared-attach-0
  it('RTL4c - errorReason after successful re-attach (deviation)', async function () {
    let attachCount = 0;

    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        conn.respond_with_connected();
      },
      onMessageFromClient: (msg) => {
        if (msg.action === 10) {
          // ATTACH
          attachCount++;
          if (attachCount === 1) {
            // First attach fails
            mock.active_connection!.send_to_client({
              action: 9, // ERROR
              channel: msg.channel,
              error: {
                message: 'Denied',
                code: 40160,
                statusCode: 401,
              },
            });
          } else {
            // Second attach succeeds
            mock.active_connection!.send_to_client({
              action: 11, // ATTACHED
              channel: msg.channel,
              flags: 0,
            });
          }
        }
      },
    });
    installMockWebSocket(mock.constructorFn);

    const client = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    client.connect();
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));

    const channel = client.channels.get('test-errorReason-clear');

    // First attach fails
    try {
      await channel.attach();
    } catch (err) {
      // Expected
    }
    expect(channel.state).to.equal('failed');
    expect(channel.errorReason).to.not.be.null;

    // Second attach succeeds
    await channel.attach();
    expect(channel.state).to.equal('attached');

    // Deviation: ably-js does NOT clear errorReason on successful re-attach.
    // The UTS spec expects errorReason to be null here (RTL4c).
    expect(channel.errorReason).to.not.be.null;
    client.close();
  });
});
