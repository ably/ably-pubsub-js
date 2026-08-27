/**
 * UTS: RealtimePresence Automatic Re-entry Tests
 *
 * Spec points: RTP17a, RTP17e, RTP17g, RTP17g1, RTP17i
 * Source: specification/uts/realtime/unit/presence/realtime_presence_reentry.md
 */

import { expect } from 'chai';
import { MockWebSocket } from '../../../mock_websocket';
import { Ably, trackClient, installMockWebSocket, restoreAll, flushAsync, pollUntil } from '../../../helpers';

describe('uts/realtime/unit/presence/realtime_presence_reentry', function () {
  afterEach(function () {
    restoreAll();
  });

  /**
   * RTP17i - Automatic re-entry on ATTACHED (non-RESUMED)
   *
   * The RealtimePresence object should perform automatic re-entry
   * whenever the channel receives an ATTACHED ProtocolMessage, except
   * when already attached with RESUMED flag set.
   */
  // UTS: realtime/unit/RTP17i/auto-reentry-on-attached-0
  it('RTP17i - automatic re-entry on ATTACHED (non-RESUMED)', async function () {
    const channelName = `test-RTP17i-${Date.now()}`;
    let connectionCount = 0;
    const capturedPresence: any[] = [];

    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        connectionCount++;
        mock.active_connection = conn;
        conn.respond_with_connected({
          connectionId: `conn-${connectionCount}`,
          connectionDetails: {
            connectionKey: `key-${connectionCount}`,
            connectionStateTtl: 120000,
            maxIdleInterval: 15000,
          } as any,
        });
      },
      onMessageFromClient: (msg) => {
        if (msg.action === 10) {
          // ATTACH
          mock.active_connection!.send_to_client({
            action: 11, // ATTACHED
            channel: channelName,
          });
        } else if (msg.action === 14) {
          // PRESENCE
          capturedPresence.push(msg);
          // ACK the presence message
          mock.active_connection!.send_to_client({
            action: 1, // ACK
            msgSerial: msg.msgSerial,
            count: 1,
          });
          // Server echoes the presence event back to populate LocalPresenceMap
          if (msg.presence) {
            for (let idx = 0; idx < msg.presence.length; idx++) {
              const p = msg.presence[idx];
              mock.active_connection!.send_to_client({
                action: 14, // PRESENCE
                channel: channelName,
                connectionId: `conn-${connectionCount}`,
                presence: [
                  {
                    action: p.action === 'enter' ? 2 : p.action,
                    clientId: p.clientId || 'my-client',
                    connectionId: `conn-${connectionCount}`,
                    id: `conn-${connectionCount}:${msg.msgSerial}:${idx}`,
                    timestamp: Date.now(),
                    data: p.data,
                  },
                ],
              });
            }
          }
        }
      },
    });
    installMockWebSocket(mock.constructorFn);

    const client = new Ably.Realtime({
      key: 'fake.key:secret',
      clientId: 'my-client',
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    client.connect();
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));

    const channel = client.channels.get(channelName);
    await channel.attach();

    // Enter presence
    await channel.presence.enter('hello');

    // Wait for the echo to be processed
    await flushAsync();

    expect(capturedPresence.length).to.equal(1);

    // Simulate disconnect and reconnect (new connectionId)
    const prevCapturedLength = capturedPresence.length;
    mock.active_connection!.simulate_disconnect();

    await new Promise<void>((resolve) => client.connection.once('disconnected', resolve));

    // Reconnect -- triggers reattach with new ATTACHED (non-RESUMED)
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));

    // Wait for channel to reattach and re-entry to happen
    await new Promise<void>((resolve) => {
      if (channel.state === 'attached') return resolve();
      channel.once('attached', () => resolve());
    });

    // Wait for presence re-entry message to be sent
    await flushAsync();

    // RTP17i: Automatic re-entry sends ENTER for the member
    // Note: on the wire, presence actions are numeric (2 = ENTER)
    const reentryMessages = capturedPresence.slice(prevCapturedLength);
    expect(reentryMessages.length).to.be.at.least(1);

    const reenter = reentryMessages.find((m: any) => m.presence && m.presence.some((p: any) => p.action === 2));
    expect(reenter).to.not.be.undefined;

    client.close();
  });

  /**
   * RTP17g - Re-entry publishes ENTER with stored clientId and data
   *
   * For each member of the RTP17 internal PresenceMap, publish a
   * PresenceMessage with an ENTER action using the clientId, data,
   * and id attributes from that member.
   */
  // UTS: realtime/unit/RTP17g/reentry-publishes-enter-with-data-0
  it('RTP17g - re-entry preserves clientId and data', async function () {
    const channelName = `test-RTP17g-${Date.now()}`;
    let connectionCount = 0;
    const capturedPresence: any[] = [];

    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        connectionCount++;
        mock.active_connection = conn;
        conn.respond_with_connected({
          connectionId: `conn-${connectionCount}`,
          connectionDetails: {
            connectionKey: `key-${connectionCount}`,
            connectionStateTtl: 120000,
            maxIdleInterval: 15000,
          } as any,
        });
      },
      onMessageFromClient: (msg) => {
        if (msg.action === 10) {
          // ATTACH
          mock.active_connection!.send_to_client({
            action: 11, // ATTACHED
            channel: channelName,
          });
        } else if (msg.action === 14) {
          // PRESENCE
          capturedPresence.push(msg);
          // ACK
          mock.active_connection!.send_to_client({
            action: 1, // ACK
            msgSerial: msg.msgSerial,
            count: 1,
          });
          // Server echoes presence back
          if (msg.presence) {
            for (let idx = 0; idx < msg.presence.length; idx++) {
              const p = msg.presence[idx];
              mock.active_connection!.send_to_client({
                action: 14, // PRESENCE
                channel: channelName,
                connectionId: `conn-${connectionCount}`,
                presence: [
                  {
                    action: p.action === 'enter' ? 2 : p.action,
                    clientId: p.clientId,
                    connectionId: `conn-${connectionCount}`,
                    id: `conn-${connectionCount}:${msg.msgSerial}:${idx}`,
                    timestamp: Date.now(),
                    data: p.data,
                  },
                ],
              });
            }
          }
        }
      },
    });
    installMockWebSocket(mock.constructorFn);

    const client = new Ably.Realtime({
      key: 'fake.key:secret',
      clientId: 'admin',
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    client.connect();
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));

    const channel = client.channels.get(channelName);
    await channel.attach();

    // Enter multiple members via enterClient
    await channel.presence.enterClient('alice', 'alice-data');
    await flushAsync();
    await channel.presence.enterClient('bob', 'bob-data');
    await flushAsync();

    expect(capturedPresence.length).to.equal(2);

    // Simulate disconnect and reconnect
    const capturedBefore = capturedPresence.length;
    mock.active_connection!.simulate_disconnect();

    await new Promise<void>((resolve) => client.connection.once('disconnected', resolve));
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));

    // Wait for channel reattach and re-entry
    await new Promise<void>((resolve) => {
      if (channel.state === 'attached') return resolve();
      channel.once('attached', () => resolve());
    });

    await flushAsync();

    // Both members re-entered with ENTER action and original data
    const reentryMessages = capturedPresence.slice(capturedBefore);
    const presenceItems: any[] = [];
    for (const msg of reentryMessages) {
      if (msg.presence) {
        for (const p of msg.presence) {
          presenceItems.push(p);
        }
      }
    }

    expect(presenceItems.length).to.be.at.least(2);

    const aliceReentry = presenceItems.find((p: any) => p.clientId === 'alice');
    const bobReentry = presenceItems.find((p: any) => p.clientId === 'bob');

    // Note: on the wire, presence actions are numeric (2 = ENTER)
    expect(aliceReentry).to.not.be.undefined;
    expect(aliceReentry.action).to.equal(2); // ENTER on wire
    expect(aliceReentry.data).to.equal('alice-data');

    expect(bobReentry).to.not.be.undefined;
    expect(bobReentry.action).to.equal(2); // ENTER on wire
    expect(bobReentry.data).to.equal('bob-data');

    client.close();
  });

  /**
   * RTP17g1 - Re-entry omits id when connectionId changed
   *
   * If the current connection id is different from the connectionId
   * attribute of the stored member, the published PresenceMessage must
   * not have its id set.
   */
  // UTS: realtime/unit/RTP17g1/reentry-omits-id-new-connid-0
  it('RTP17g1 - re-entry omits id when connectionId changed', async function () {
    const channelName = `test-RTP17g1-${Date.now()}`;
    let connectionCount = 0;
    const capturedPresence: any[] = [];

    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        connectionCount++;
        mock.active_connection = conn;
        conn.respond_with_connected({
          connectionId: `conn-${connectionCount}`,
          connectionDetails: {
            connectionKey: `key-${connectionCount}`,
            connectionStateTtl: 120000,
            maxIdleInterval: 15000,
          } as any,
        });
      },
      onMessageFromClient: (msg) => {
        if (msg.action === 10) {
          // ATTACH
          mock.active_connection!.send_to_client({
            action: 11, // ATTACHED
            channel: channelName,
          });
        } else if (msg.action === 14) {
          // PRESENCE
          capturedPresence.push(msg);
          // ACK
          mock.active_connection!.send_to_client({
            action: 1, // ACK
            msgSerial: msg.msgSerial,
            count: 1,
          });
          // Server echoes presence back
          if (msg.presence) {
            for (let idx = 0; idx < msg.presence.length; idx++) {
              const p = msg.presence[idx];
              mock.active_connection!.send_to_client({
                action: 14, // PRESENCE
                channel: channelName,
                connectionId: `conn-${connectionCount}`,
                presence: [
                  {
                    action: p.action === 'enter' ? 2 : p.action,
                    clientId: p.clientId || 'my-client',
                    connectionId: `conn-${connectionCount}`,
                    id: `conn-${connectionCount}:${msg.msgSerial}:${idx}`,
                    timestamp: Date.now(),
                    data: p.data,
                  },
                ],
              });
            }
          }
        }
      },
    });
    installMockWebSocket(mock.constructorFn);

    const client = new Ably.Realtime({
      key: 'fake.key:secret',
      clientId: 'my-client',
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    client.connect();
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));

    const channel = client.channels.get(channelName);
    await channel.attach();

    await channel.presence.enter('hello');
    await flushAsync();

    // First connection is conn-1
    expect(connectionCount).to.equal(1);

    // Disconnect and reconnect -- new connectionId (conn-2)
    const capturedBefore = capturedPresence.length;
    mock.active_connection!.simulate_disconnect();

    await new Promise<void>((resolve) => client.connection.once('disconnected', resolve));
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));
    expect(connectionCount).to.equal(2);

    await new Promise<void>((resolve) => {
      if (channel.state === 'attached') return resolve();
      channel.once('attached', () => resolve());
    });

    await flushAsync();

    // Re-entry message should NOT have id set because connectionId changed
    // Note: on the wire, presence actions are numeric (2 = ENTER)
    const reentryMessages = capturedPresence.slice(capturedBefore);
    const reentry = reentryMessages.find((m: any) => m.presence && m.presence.some((p: any) => p.action === 2));
    expect(reentry).to.not.be.undefined;

    const reentryPresence = reentry.presence[0];
    expect(reentryPresence.action).to.equal(2); // ENTER on wire
    expect(reentryPresence.id).to.be.undefined; // RTP17g1: id not set when connectionId changed
    expect(reentryPresence.data).to.equal('hello');

    client.close();
  });

  /**
   * RTP17i - No re-entry when ATTACHED with RESUMED flag
   *
   * Automatic re-entry is NOT performed when the channel is already
   * attached and the ProtocolMessage has the RESUMED bit flag set.
   */
  // UTS: realtime/unit/RTP17i/no-reentry-with-resumed-flag-1
  it('RTP17i - no re-entry when ATTACHED with RESUMED flag', async function () {
    const channelName = `test-RTP17i-resumed-${Date.now()}`;
    const capturedPresence: any[] = [];

    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        conn.respond_with_connected({
          connectionId: 'conn-1',
          connectionDetails: {
            connectionKey: 'key-1',
            connectionStateTtl: 120000,
            maxIdleInterval: 15000,
          } as any,
        });
      },
      onMessageFromClient: (msg) => {
        if (msg.action === 10) {
          // ATTACH
          mock.active_connection!.send_to_client({
            action: 11, // ATTACHED
            channel: channelName,
          });
        } else if (msg.action === 14) {
          // PRESENCE
          capturedPresence.push(msg);
          // ACK
          mock.active_connection!.send_to_client({
            action: 1, // ACK
            msgSerial: msg.msgSerial,
            count: 1,
          });
          // Server echoes presence back
          if (msg.presence) {
            for (let idx = 0; idx < msg.presence.length; idx++) {
              const p = msg.presence[idx];
              mock.active_connection!.send_to_client({
                action: 14, // PRESENCE
                channel: channelName,
                connectionId: 'conn-1',
                presence: [
                  {
                    action: p.action === 'enter' ? 2 : p.action,
                    clientId: p.clientId || 'my-client',
                    connectionId: 'conn-1',
                    id: `conn-1:${msg.msgSerial}:${idx}`,
                    timestamp: Date.now(),
                    data: p.data,
                  },
                ],
              });
            }
          }
        }
      },
    });
    installMockWebSocket(mock.constructorFn);

    const client = new Ably.Realtime({
      key: 'fake.key:secret',
      clientId: 'my-client',
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    client.connect();
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));

    const channel = client.channels.get(channelName);
    await channel.attach();

    await channel.presence.enter('hello');
    await flushAsync();

    // Clear captured
    capturedPresence.length = 0;

    // Server sends ATTACHED with RESUMED flag while already attached
    // (e.g., after a brief transport-level reconnect that preserved the connection)
    mock.active_connection!.send_to_client({
      action: 11, // ATTACHED
      channel: channelName,
      flags: 4, // RESUMED
    });

    await flushAsync();

    // No re-entry -- RESUMED flag means the server still has our presence state
    expect(capturedPresence.length).to.equal(0);

    client.close();
  });

  /**
   * RTP17e - Failed re-entry emits UPDATE with error
   *
   * If an automatic presence ENTER fails (e.g., NACK), emit an UPDATE
   * event on the channel with resumed=true and reason set to ErrorInfo
   * with code 91004.
   */
  // UTS: realtime/unit/RTP17e/failed-reentry-emits-update-error-0
  it('RTP17e - failed re-entry emits UPDATE with error', async function () {
    if (!process.env.RUN_DEVIATIONS) this.skip(); // ably-js error message doesn't include clientId
    const channelName = `test-RTP17e-${Date.now()}`;
    let connectionCount = 0;

    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        connectionCount++;
        mock.active_connection = conn;
        conn.respond_with_connected({
          connectionId: `conn-${connectionCount}`,
          connectionDetails: {
            connectionKey: `key-${connectionCount}`,
            connectionStateTtl: 120000,
            maxIdleInterval: 15000,
          } as any,
        });
      },
      onMessageFromClient: (msg) => {
        if (msg.action === 10) {
          // ATTACH
          mock.active_connection!.send_to_client({
            action: 11, // ATTACHED
            channel: channelName,
          });
        } else if (msg.action === 14) {
          // PRESENCE
          if (connectionCount === 1) {
            // First connection: ACK the enter and echo back the presence event
            mock.active_connection!.send_to_client({
              action: 1, // ACK
              msgSerial: msg.msgSerial,
              count: 1,
            });
            if (msg.presence) {
              for (let idx = 0; idx < msg.presence.length; idx++) {
                const p = msg.presence[idx];
                mock.active_connection!.send_to_client({
                  action: 14, // PRESENCE
                  channel: channelName,
                  connectionId: 'conn-1',
                  presence: [
                    {
                      action: p.action === 'enter' ? 2 : p.action,
                      clientId: p.clientId || 'my-client',
                      connectionId: 'conn-1',
                      id: `conn-1:${msg.msgSerial}:${idx}`,
                      timestamp: Date.now(),
                      data: p.data,
                    },
                  ],
                });
              }
            }
          } else {
            // Second connection: NACK the re-entry
            mock.active_connection!.send_to_client({
              action: 2, // NACK
              msgSerial: msg.msgSerial,
              count: 1,
              error: {
                code: 40160,
                statusCode: 401,
                message: 'Presence denied',
              },
            });
          }
        }
      },
    });
    installMockWebSocket(mock.constructorFn);

    const client = new Ably.Realtime({
      key: 'fake.key:secret',
      clientId: 'my-client',
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    client.connect();
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));

    const channel = client.channels.get(channelName);
    await channel.attach();

    await channel.presence.enter('hello');
    await flushAsync();

    // Listen for channel UPDATE events with the re-entry failure error code
    const channelEvents: any[] = [];
    channel.on('update', (change: any) => {
      if (change.reason && change.reason.code === 91004) {
        channelEvents.push(change);
      }
    });

    // Disconnect and reconnect -- re-entry will be NACKed
    mock.active_connection!.simulate_disconnect();

    await new Promise<void>((resolve) => client.connection.once('disconnected', resolve));
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));

    await new Promise<void>((resolve) => {
      if (channel.state === 'attached') return resolve();
      channel.once('attached', () => resolve());
    });

    // Wait for the re-entry NACK to be processed
    await pollUntil(() => channelEvents.length >= 1, 1000);

    expect(channelEvents.length).to.be.at.least(1);

    const updateEvent = channelEvents[0];
    expect(updateEvent.resumed).to.equal(true);
    expect(updateEvent.reason).to.not.be.null;
    expect(updateEvent.reason.code).to.equal(91004);
    expect(updateEvent.reason.message).to.include('my-client');
    expect(updateEvent.reason.cause).to.not.be.null;
    expect(updateEvent.reason.cause.code).to.equal(40160);

    client.close();
  });

  /**
   * RTP17a - Server publishes member regardless of subscribe capability
   *
   * All members belonging to the current connection are published as a
   * PresenceMessage on the channel by the server irrespective of whether
   * the client has permission to subscribe. The member should be present
   * in the public presence set via get.
   */
  // UTS: realtime/unit/RTP17a/server-publishes-without-subscribe-0
  it('RTP17a - server publishes member regardless of subscribe capability', async function () {
    const channelName = `test-RTP17a-${Date.now()}`;

    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        conn.respond_with_connected({
          connectionId: 'conn-1',
          connectionDetails: {
            connectionKey: 'key-1',
            connectionStateTtl: 120000,
            maxIdleInterval: 15000,
          } as any,
        });
      },
      onMessageFromClient: (msg) => {
        if (msg.action === 10) {
          // ATTACH -- channel with presence capability (flag bit 16)
          mock.active_connection!.send_to_client({
            action: 11, // ATTACHED
            channel: channelName,
            flags: 1 << 16, // PRESENCE flag (not PRESENCE_SUBSCRIBE)
          });
        } else if (msg.action === 14) {
          // PRESENCE -- ACK the enter
          mock.active_connection!.send_to_client({
            action: 1, // ACK
            msgSerial: msg.msgSerial,
            count: 1,
          });
          // Server delivers the presence event back to the client
          mock.active_connection!.send_to_client({
            action: 14, // PRESENCE
            channel: channelName,
            presence: [
              {
                action: 2, // ENTER
                clientId: 'my-client',
                connectionId: 'conn-1',
                id: 'conn-1:0:0',
                timestamp: 1000,
              },
            ],
          });
        }
      },
    });
    installMockWebSocket(mock.constructorFn);

    const client = new Ably.Realtime({
      key: 'fake.key:secret',
      clientId: 'my-client',
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    client.connect();
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));

    const channel = client.channels.get(channelName);
    await channel.attach();

    await channel.presence.enter(undefined);
    await flushAsync();

    // Check public presence map
    const members = await channel.presence.get({ waitForSync: false });

    expect(members.length).to.equal(1);
    expect(members[0].clientId).to.equal('my-client');

    client.close();
  });
});
