/**
 * UTS Integration: heartbeats=bounce PING/PONG
 *
 * Spec points: RTN23c, RTN23c1, RTN23c2
 *
 * Connects with heartbeats=bounce and a short heartbeatInterval, and checks
 * that our PONGs keep the connection alive across several heartbeat intervals.
 * In bounce mode the server disregards WebSocket PONG frames and closes the
 * transport at the next heartbeat unless it saw a PONG protocol message
 * echoing the id of the PING it sent, so staying connected is itself the
 * assertion that RTN23c1/RTN23c2 were satisfied.
 *
 * Skips itself against a server that does not implement bounce mode: such a
 * server falls back to HEARTBEATs, which this test would have nothing to say
 * about.
 *
 * This test is ably-js-specific: the UTS spec has no integration test for
 * RTN23c.
 */

import { expect } from 'chai';
import {
  Ably,
  SANDBOX_ENDPOINT,
  setupSandbox,
  teardownSandbox,
  getApiKey,
  trackClient,
  closeAndWait,
} from '../sandbox';
import { actions } from '../../../../../src/common/lib/types/protocolmessagecommon';

/* Server-side minimum for the heartbeatInterval param; a lower value is
 * clamped up to it. */
const HEARTBEAT_INTERVAL = 5000;
const INTERVALS = 3;

describe('uts/realtime/integration/connection/heartbeats_bounce', function () {
  this.timeout(HEARTBEAT_INTERVAL * (INTERVALS + 2) + 20000);

  before(async function () {
    await setupSandbox();
  });

  after(async function () {
    await teardownSandbox();
  });

  // ably-js-specific: not in the UTS spec
  it('RTN23c/RTN23c1/RTN23c2 - our PONGs keep a bounce-mode connection alive', async function () {
    const pingIds: (string | undefined)[] = [];
    const pongIds: (string | undefined)[] = [];
    const stateChanges: string[] = [];

    const client = new Ably.Realtime({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
      transportParams: { heartbeats: 'bounce', heartbeatInterval: String(HEARTBEAT_INTERVAL) },
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    const connectionManager = (client.connection as any).connectionManager;
    connectionManager.on('transport.active', (transport: any) => {
      const onProtocolMessage = transport.onProtocolMessage.bind(transport);
      transport.onProtocolMessage = (message: any) => {
        if (message.action === actions.PING) pingIds.push(message.id);
        return onProtocolMessage(message);
      };
      const send = transport.send.bind(transport);
      transport.send = (message: any) => {
        if (message.action === actions.PONG) pongIds.push(message.id);
        return send(message);
      };
    });

    client.connection.on((change: any) => stateChanges.push(change.current));

    client.connect();
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out waiting for connected')), 15000);
      client.connection.once('connected', () => {
        clearTimeout(timer);
        resolve();
      });
    });

    await new Promise((resolve) => setTimeout(resolve, HEARTBEAT_INTERVAL * INTERVALS + 2000));

    if (pingIds.length === 0) {
      await closeAndWait(client);
      this.skip(); // server does not implement bounce mode
    }

    // Every PING was answered with a PONG carrying the same id, in order
    expect(pongIds).to.deep.equal(pingIds);
    // …and the server accepted them, rather than closing the transport
    expect(client.connection.state).to.equal('connected');
    expect(stateChanges).to.deep.equal(['connecting', 'connected']);

    await closeAndWait(client);
  });
});
