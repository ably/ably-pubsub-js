/**
 * UTS: Fallback Hosts Tests
 *
 * Spec points: RTN17f, RTN17f1, RTN17g, RTN17h, RTN17i, RTN17j
 * Source: uts/test/realtime/unit/connection/fallback_hosts_test.md
 *
 * Note: Fallback host behavior is complex — involves connectivity checks,
 * host rotation, and coordination between realtime and REST.
 */

import { expect } from 'chai';
import { MockWebSocket } from '../../../mock_websocket';
import { MockHttpClient } from '../../../mock_http';
import { Ably, trackClient, installMockWebSocket, installMockHttp, restoreAll } from '../../../helpers';

describe('uts/realtime/unit/connection/fallback_hosts', function () {
  afterEach(function () {
    restoreAll();
  });

  /**
   * RTN17i - Always prefer primary domain first
   */
  // UTS: realtime/unit/RTN17i/prefer-primary-domain-0
  it('RTN17i - primary domain tried first', function (done) {
    const connectionHosts: string[] = [];

    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        connectionHosts.push(conn.url.hostname);
        mock.active_connection = conn;

        if (connectionHosts.length === 1) {
          // Primary fails
          conn.respond_with_refused();
        } else {
          // Fallback succeeds
          conn.respond_with_connected({
            connectionId: 'connection-id',
            connectionDetails: {
              connectionKey: 'connection-key',
              maxIdleInterval: 15000,
              connectionStateTtl: 120000,
            } as any,
          });
        }
      },
    });
    installMockWebSocket(mock.constructorFn);

    // Mock HTTP for connectivity check
    const httpMock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => req.respond_with(200, 'yes'),
    });
    installMockHttp(httpMock);

    const client = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    client.connection.once('connected', () => {
      // First attempt was primary domain
      expect(connectionHosts[0]).to.equal('main.realtime.ably.net');
      // Second was a fallback
      expect(connectionHosts[1]).to.match(/main\.[a-e]\.fallback\.ably-realtime\.com/);
      expect(connectionHosts.length).to.be.at.least(2);
      client.close();
      done();
    });

    client.connect();
  });

  /**
   * RTN17f - Network errors trigger fallback host usage
   */
  // UTS: realtime/unit/RTN17f/fallback-on-error-0
  it('RTN17f - connection refused triggers fallback', function (done) {
    const connectionHosts: string[] = [];

    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        connectionHosts.push(conn.url.hostname);
        mock.active_connection = conn;

        if (connectionHosts.length === 1) {
          // Primary: connection refused
          conn.respond_with_refused();
        } else {
          conn.respond_with_connected({
            connectionId: 'connection-id',
            connectionDetails: {
              connectionKey: 'connection-key',
              maxIdleInterval: 15000,
              connectionStateTtl: 120000,
            } as any,
          });
        }
      },
    });
    installMockWebSocket(mock.constructorFn);

    const httpMock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => req.respond_with(200, 'yes'),
    });
    installMockHttp(httpMock);

    const client = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    client.connection.once('connected', () => {
      expect(connectionHosts.length).to.be.at.least(2);
      expect(connectionHosts[0]).to.equal('main.realtime.ably.net');
      expect(connectionHosts[1]).to.match(/main\.[a-e]\.fallback\.ably-realtime\.com/);
      client.close();
      done();
    });

    client.connect();
  });

  /**
   * RTN17f1 - DISCONNECTED with 5xx triggers fallback
   */
  // UTS: realtime/unit/RTN17f1/disconnected-5xx-fallback-0
  it('RTN17f1 - DISCONNECTED with 503 triggers fallback', function (done) {
    const connectionHosts: string[] = [];

    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        connectionHosts.push(conn.url.hostname);
        mock.active_connection = conn;

        if (connectionHosts.length === 1) {
          // Primary: send DISCONNECTED with 503
          conn.respond_with_success();
          process.nextTick(() => {
            conn.send_to_client_and_close({
              action: 6, // DISCONNECTED
              error: {
                code: 50003,
                statusCode: 503,
                message: 'Service temporarily unavailable',
              },
            });
          });
        } else {
          conn.respond_with_connected({
            connectionId: 'connection-id',
            connectionDetails: {
              connectionKey: 'connection-key',
              maxIdleInterval: 15000,
              connectionStateTtl: 120000,
            } as any,
          });
        }
      },
    });
    installMockWebSocket(mock.constructorFn);

    const httpMock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => req.respond_with(200, 'yes'),
    });
    installMockHttp(httpMock);

    const client = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    client.connection.once('connected', () => {
      expect(connectionHosts.length).to.be.at.least(2);
      expect(connectionHosts[0]).to.equal('main.realtime.ably.net');
      // Second attempt should be a fallback host
      expect(connectionHosts[1]).to.match(/main\.[a-e]\.fallback\.ably-realtime\.com/);
      client.close();
      done();
    });

    client.connect();
  });

  /**
   * RTN17g - Empty fallback set: custom host with no fallbacks
   *
   * DEVIATION: ably-js with custom realtimeHost and fallbackHosts:[] goes to
   * DISCONNECTED (not immediate error), then retries. We verify only the primary
   * host was tried and no fallback hosts were used.
   */
  // UTS: realtime/unit/RTN17g/empty-fallback-set-error-0
  it('RTN17g - custom host with no fallbacks does not try fallbacks', function (done) {
    const connectionHosts: string[] = [];

    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        connectionHosts.push(conn.url.hostname);
        conn.respond_with_refused();
      },
    });
    installMockWebSocket(mock.constructorFn);

    const httpMock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => req.respond_with(200, 'yes'),
    });
    installMockHttp(httpMock);

    const client = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      realtimeHost: 'custom.example.com',
      fallbackHosts: [],
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    client.connection.once('disconnected', () => {
      // Only the custom host was tried, no fallbacks
      expect(connectionHosts.length).to.equal(1);
      expect(connectionHosts[0]).to.equal('custom.example.com');
      done();
    });

    client.connect();
  });

  /**
   * RTN17h - Default fallback hosts match spec (REC2)
   */
  // UTS: realtime/unit/RTN17h/fallback-domains-from-rec2-0
  it('RTN17h - uses default fallback hosts from REC2', function (done) {
    const connectionHosts: string[] = [];

    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        connectionHosts.push(conn.url.hostname);
        mock.active_connection = conn;

        if (connectionHosts.length === 1) {
          conn.respond_with_refused();
        } else {
          conn.respond_with_connected({
            connectionId: 'connection-id',
            connectionDetails: {
              connectionKey: 'connection-key',
              maxIdleInterval: 15000,
              connectionStateTtl: 120000,
            } as any,
          });
        }
      },
    });
    installMockWebSocket(mock.constructorFn);

    const httpMock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => req.respond_with(200, 'yes'),
    });
    installMockHttp(httpMock);

    const client = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    client.connection.once('connected', () => {
      expect(connectionHosts.length).to.be.at.least(2);
      // Fallback host matches pattern: main.[a-e].fallback.ably-realtime.com
      const fallbackHost = connectionHosts[1];
      expect(fallbackHost).to.match(/main\.[a-e]\.fallback\.ably-realtime\.com/);
      client.close();
      done();
    });

    client.connect();
  });

  /**
   * RTN17j - Connectivity check before fallback
   */
  // UTS: realtime/unit/RTN17j/connectivity-check-before-fallback-0
  it('RTN17j - connectivity check performed before fallback', function (done) {
    const connectionHosts: string[] = [];
    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        connectionHosts.push(conn.url.hostname);
        mock.active_connection = conn;

        if (connectionHosts.length === 1) {
          conn.respond_with_refused();
        } else {
          conn.respond_with_connected({
            connectionId: 'connection-id',
            connectionDetails: {
              connectionKey: 'connection-key',
              maxIdleInterval: 15000,
              connectionStateTtl: 120000,
            } as any,
          });
        }
      },
    });
    installMockWebSocket(mock.constructorFn);

    const httpMock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => req.respond_with(200, 'yes'),
    });
    installMockHttp(httpMock);

    const client = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    client.connection.once('connected', () => {
      // Connectivity check was performed via HTTP mock
      const connectivityChecks = httpMock.captured_requests.filter((req) => req.url.href.includes('internet-up'));
      expect(connectivityChecks.length).to.be.at.least(1);

      // Connection proceeded to fallback after check
      expect(connectionHosts.length).to.be.at.least(2);
      client.close();
      done();
    });

    client.connect();
  });

  /**
   * RTN17j - Fallback hosts tried in random order
   *
   * This test is inherently probabilistic. We run multiple iterations and check
   * that not all fallback host orders are identical.
   */
  // UTS: realtime/unit/RTN17j/fallback-random-order-1
  it('RTN17j - fallback hosts tried in random order', function (done) {
    const fallbackOrders: string[][] = [];
    let iterationsCompleted = 0;
    const totalIterations = 5;

    function runIteration() {
      restoreAll();

      const connectionHosts: string[] = [];
      const mock = new MockWebSocket({
        onConnectionAttempt: (conn) => {
          connectionHosts.push(conn.url.hostname);
          if (connectionHosts.length <= 3) {
            // Primary and first 2 fallbacks fail
            conn.respond_with_refused();
          } else {
            conn.respond_with_connected({
              connectionId: 'connection-id',
              connectionDetails: {
                connectionKey: 'connection-key',
                maxIdleInterval: 15000,
                connectionStateTtl: 120000,
              } as any,
            });
          }
        },
      });
      installMockWebSocket(mock.constructorFn);

      const httpMock = new MockHttpClient({
        onConnectionAttempt: (conn) => conn.respond_with_success(),
        onRequest: (req) => req.respond_with(200, 'yes'),
      });
      installMockHttp(httpMock);

      const client = new Ably.Realtime({
        key: 'appId.keyId:keySecret',
        autoConnect: false,
        useBinaryProtocol: false,
      });
      trackClient(client);

      client.connection.once('connected', () => {
        // Record fallback order (skip primary at index 0)
        fallbackOrders.push(connectionHosts.slice(1));
        client.close();
        iterationsCompleted++;

        if (iterationsCompleted < totalIterations) {
          runIteration();
        } else {
          // At least 2 different orderings should appear
          const uniqueOrders = new Set(fallbackOrders.map((o) => o.join(',')));
          expect(uniqueOrders.size).to.be.at.least(2);
          done();
        }
      });

      client.connect();
    }

    runIteration();
  });

  /**
   * RTN17e - HTTP requests use same fallback host as realtime connection
   *
   * Spec: If the realtime client is connected to a fallback host endpoint,
   * HTTP requests should first be attempted to the same datacenter.
   */
  // UTS: realtime/unit/RTN17e/http-uses-same-fallback-0
  it('RTN17e - HTTP requests use same fallback host as realtime connection', async function () {
    const connectionHosts: string[] = [];

    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        connectionHosts.push(conn.url.hostname);
        mock.active_connection = conn;

        if (connectionHosts.length === 1) {
          // Primary fails
          conn.respond_with_refused();
        } else {
          // Fallback succeeds
          conn.respond_with_connected({
            connectionId: 'connection-id',
            connectionDetails: {
              connectionKey: 'connection-key',
              maxIdleInterval: 15000,
              connectionStateTtl: 120000,
            } as any,
          });
        }
      },
    });
    installMockWebSocket(mock.constructorFn);

    const httpRequests: { url: string; host: string }[] = [];
    const httpMock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        httpRequests.push({ url: req.url.href, host: req.url.hostname });
        if (req.url.pathname.includes('/channels/') && req.url.pathname.includes('/messages')) {
          req.respond_with(200, '[]');
        } else if (req.url.href.includes('internet-up')) {
          req.respond_with(200, 'yes');
        } else {
          req.respond_with(200, '{}');
        }
      },
    });
    installMockHttp(httpMock);

    const client = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    client.connect();
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));

    // Determine which fallback host the realtime connection is using
    const connectedFallbackHost = connectionHosts[1];
    expect(connectedFallbackHost).to.match(/main\.[a-e]\.fallback\.ably-realtime\.com/);

    // Make an HTTP request (channel history)
    const channel = client.channels.get('test-RTN17e');
    await channel.history();

    // Find HTTP requests that are history-related (not connectivity checks)
    const historyRequests = httpRequests.filter((r) => r.url.includes('/channels/') && r.url.includes('/messages'));
    expect(historyRequests.length).to.be.at.least(1);

    // The HTTP request host should use the same fallback datacenter letter
    // Realtime fallback: main.<letter>.fallback.ably-realtime.com
    // REST fallback: rest.<letter>.fallback.ably-realtime.com
    const fallbackLetter = connectedFallbackHost.match(/main\.([a-e])\.fallback/)?.[1];
    expect(fallbackLetter).to.exist;

    const historyHost = historyRequests[0].host;
    const historyLetter = historyHost.match(/\.([a-e])\.fallback/)?.[1];
    expect(historyLetter).to.equal(fallbackLetter);

    client.close();
  });
});
