/**
 * UTS: Batch Presence Tests
 *
 * Spec points: RSC24, BAR2, BGR2, BGF2
 * Source: specification/uts/rest/unit/batch_presence.md
 *
 * Tests for RestClient#batchPresence: sends GET to /presence with channel
 * names as a comma-separated query parameter, returns per-channel results.
 */

import { expect } from 'chai';
import { MockHttpClient } from '../../mock_http';
import { Ably, installMockHttp, restoreAll } from '../../helpers';

describe('uts/rest/unit/batch_presence', function () {
  afterEach(function () {
    restoreAll();
  });

  // ---------------------------------------------------------------------------
  // RSC24 - batchPresence sends GET to /presence
  // ---------------------------------------------------------------------------

  describe('RSC24 - batchPresence sends GET to /presence', function () {
    // UTS: rest/unit/RSC24/get-presence-channels-param-0
    it('RSC24_1 - sends GET request to /presence with channels query param', async function () {
      const captured: any[] = [];
      const mock = new MockHttpClient({
        onConnectionAttempt: (conn) => conn.respond_with_success(),
        onRequest: (req) => {
          captured.push(req);
          req.respond_with(200, {
            successCount: 2,
            failureCount: 0,
            results: [
              { channel: 'channel-a', presence: [] },
              { channel: 'channel-b', presence: [] },
            ],
          });
        },
      });
      installMockHttp(mock);

      const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
      await client.batchPresence(['channel-a', 'channel-b']);

      expect(captured).to.have.length(1);
      expect(captured[0].method.toUpperCase()).to.equal('GET');
      expect(captured[0].path).to.equal('/presence');
      expect(captured[0].url.searchParams.get('channels')).to.equal('channel-a,channel-b');
    });

    // UTS: rest/unit/RSC24/single-channel-param-0
    it('RSC24_2 - single channel sends GET with single channel name', async function () {
      const captured: any[] = [];
      const mock = new MockHttpClient({
        onConnectionAttempt: (conn) => conn.respond_with_success(),
        onRequest: (req) => {
          captured.push(req);
          req.respond_with(200, {
            successCount: 1,
            failureCount: 0,
            results: [{ channel: 'my-channel', presence: [] }],
          });
        },
      });
      installMockHttp(mock);

      const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
      await client.batchPresence(['my-channel']);

      expect(captured).to.have.length(1);
      expect(captured[0].url.searchParams.get('channels')).to.equal('my-channel');
    });

    // UTS: rest/unit/RSC24/special-chars-comma-joined-0
    it('RSC24_3 - channel names with special characters are comma-joined', async function () {
      const captured: any[] = [];
      const mock = new MockHttpClient({
        onConnectionAttempt: (conn) => conn.respond_with_success(),
        onRequest: (req) => {
          captured.push(req);
          req.respond_with(200, {
            successCount: 2,
            failureCount: 0,
            results: [
              { channel: 'foo:bar', presence: [] },
              { channel: 'baz/qux', presence: [] },
            ],
          });
        },
      });
      installMockHttp(mock);

      const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
      await client.batchPresence(['foo:bar', 'baz/qux']);

      expect(captured).to.have.length(1);
      // The SDK joins channels with comma; URL encoding may apply
      const channelsParam = captured[0].url.searchParams.get('channels');
      expect(channelsParam).to.equal('foo:bar,baz/qux');
    });
  });

  // ---------------------------------------------------------------------------
  // BAR2 - BatchPresenceResponse structure
  // ---------------------------------------------------------------------------

  describe('BAR2 - BatchPresenceResponse structure', function () {
    // UTS: rest/unit/BAR2/all-success-counts-0
    it('BAR2_2 - all success', async function () {
      const mock = new MockHttpClient({
        onConnectionAttempt: (conn) => conn.respond_with_success(),
        onRequest: (req) => {
          req.respond_with(200, {
            successCount: 2,
            failureCount: 0,
            results: [
              { channel: 'ch-a', presence: [] },
              { channel: 'ch-b', presence: [] },
            ],
          });
        },
      });
      installMockHttp(mock);

      const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
      const result = await client.batchPresence(['ch-a', 'ch-b']);

      expect(result.successCount).to.equal(2);
      expect(result.failureCount).to.equal(0);
      expect(result.results).to.have.lengthOf(2);
    });

    /**
     * BAR2_1 - Mixed results with computed counts
     *
     * With X-Ably-Version >= 3, the server returns {successCount, failureCount,
     * results} directly with HTTP 200 — the SDK passes through the response.
     */
    // UTS: rest/unit/BAR2/mixed-success-failure-counts-0
    it('BAR2_1 - mixed results', async function () {
      const mock = new MockHttpClient({
        onConnectionAttempt: (conn) => conn.respond_with_success(),
        onRequest: (req) => {
          req.respond_with(200, {
            successCount: 3,
            failureCount: 1,
            results: [
              { channel: 'ch-1', presence: [] },
              { channel: 'ch-2', presence: [] },
              { channel: 'ch-3', presence: [] },
              { channel: 'ch-4', error: { code: 40160, statusCode: 401, message: 'Not permitted' } },
            ],
          });
        },
      });
      installMockHttp(mock);

      const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
      const result = await client.batchPresence(['ch-1', 'ch-2', 'ch-3', 'ch-4']);

      expect(result.successCount).to.equal(3);
      expect(result.failureCount).to.equal(1);
      expect(result.results).to.have.length(4);
    });

    /**
     * BAR2_3 - All failure
     *
     * With X-Ably-Version >= 3, the server returns the BatchResult envelope
     * with HTTP 200 even when all results are failures.
     */
    // UTS: rest/unit/BAR2/all-failure-counts-0
    it('BAR2_3 - all failure', async function () {
      const mock = new MockHttpClient({
        onConnectionAttempt: (conn) => conn.respond_with_success(),
        onRequest: (req) => {
          req.respond_with(200, {
            successCount: 0,
            failureCount: 2,
            results: [
              { channel: 'ch-a', error: { code: 40160, statusCode: 401, message: 'Not permitted' } },
              { channel: 'ch-b', error: { code: 40160, statusCode: 401, message: 'Not permitted' } },
            ],
          });
        },
      });
      installMockHttp(mock);

      const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
      const result = await client.batchPresence(['ch-a', 'ch-b']);

      expect(result.successCount).to.equal(0);
      expect(result.failureCount).to.equal(2);
      expect(result.results).to.have.length(2);
    });
  });

  // ---------------------------------------------------------------------------
  // BGR2 - BatchPresenceSuccessResult structure
  // ---------------------------------------------------------------------------

  describe('BGR2 - BatchPresenceSuccessResult structure', function () {
    // UTS: rest/unit/BGR2/success-with-members-0
    it('BGR2_1 - success result with members present', async function () {
      const mock = new MockHttpClient({
        onConnectionAttempt: (conn) => conn.respond_with_success(),
        onRequest: (req) => {
          req.respond_with(200, {
            successCount: 1,
            failureCount: 0,
            results: [
              {
                channel: 'my-channel',
                presence: [
                  {
                    clientId: 'client-1',
                    action: 1,
                    connectionId: 'conn-abc',
                    id: 'conn-abc:0:0',
                    timestamp: 1700000000000,
                    data: 'hello',
                  },
                  {
                    clientId: 'client-2',
                    action: 1,
                    connectionId: 'conn-def',
                    id: 'conn-def:0:0',
                    timestamp: 1700000000000,
                    data: '{"key":"value"}',
                  },
                ],
              },
            ],
          });
        },
      });
      installMockHttp(mock);

      const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
      const result = await client.batchPresence(['my-channel']);

      expect(result.results).to.have.lengthOf(1);

      const success = result.results[0] as any;
      expect(success.channel).to.equal('my-channel');
      expect(success.presence).to.be.an('array').with.lengthOf(2);
      expect(success.presence[0].clientId).to.equal('client-1');
      expect(success.presence[0].connectionId).to.equal('conn-abc');
      expect(success.presence[1].clientId).to.equal('client-2');
    });

    // UTS: rest/unit/BGR2/success-empty-presence-0
    it('BGR2_2 - success result with empty presence (no members)', async function () {
      const mock = new MockHttpClient({
        onConnectionAttempt: (conn) => conn.respond_with_success(),
        onRequest: (req) => {
          req.respond_with(200, {
            successCount: 1,
            failureCount: 0,
            results: [{ channel: 'empty-channel', presence: [] }],
          });
        },
      });
      installMockHttp(mock);

      const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
      const result = await client.batchPresence(['empty-channel']);

      const success = result.results[0] as any;
      expect(success.channel).to.equal('empty-channel');
      expect(success.presence).to.be.an('array').with.lengthOf(0);
    });
  });

  // ---------------------------------------------------------------------------
  // BGF2 - BatchPresenceFailureResult structure
  // ---------------------------------------------------------------------------

  describe('BGF2 - BatchPresenceFailureResult structure', function () {
    /**
     * BGF2_1 - Failure result with error details
     */
    // UTS: rest/unit/BGF2/failure-error-details-0
    it('BGF2_1 - failure result with error details', async function () {
      const mock = new MockHttpClient({
        onConnectionAttempt: (conn) => conn.respond_with_success(),
        onRequest: (req) => {
          req.respond_with(200, {
            successCount: 0,
            failureCount: 1,
            results: [
              {
                channel: 'restricted-channel',
                error: {
                  code: 40160,
                  statusCode: 401,
                  message: 'Channel operation not permitted',
                },
              },
            ],
          });
        },
      });
      installMockHttp(mock);

      const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
      const result = await client.batchPresence(['restricted-channel']);

      expect(result.successCount).to.equal(0);
      expect(result.failureCount).to.equal(1);
      expect(result.results).to.have.length(1);
      expect(result.results[0].channel).to.equal('restricted-channel');
      expect((result.results[0] as any).error.code).to.equal(40160);
    });
  });

  // ---------------------------------------------------------------------------
  // Mixed results
  // ---------------------------------------------------------------------------

  describe('Mixed results', function () {
    /**
     * RSC24_Mixed_1 - Mixed success and failure results
     */
    // UTS: rest/unit/RSC24/mixed-success-failure-results-0
    it('RSC24_Mixed_1 - mixed success and failure results', async function () {
      const mock = new MockHttpClient({
        onConnectionAttempt: (conn) => conn.respond_with_success(),
        onRequest: (req) => {
          req.respond_with(200, {
            successCount: 1,
            failureCount: 1,
            results: [
              {
                channel: 'allowed-channel',
                presence: [
                  {
                    clientId: 'user-1',
                    action: 1,
                    connectionId: 'conn-1',
                    id: 'conn-1:0:0',
                    timestamp: 1700000000000,
                  },
                ],
              },
              {
                channel: 'restricted-channel',
                error: {
                  code: 40160,
                  statusCode: 401,
                  message: 'Not permitted',
                },
              },
            ],
          });
        },
      });
      installMockHttp(mock);

      const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
      const result = await client.batchPresence(['allowed-channel', 'restricted-channel']);

      expect(result.successCount).to.equal(1);
      expect(result.failureCount).to.equal(1);
      expect(result.results).to.have.length(2);
    });
  });

  // ---------------------------------------------------------------------------
  // Error handling
  // ---------------------------------------------------------------------------

  describe('Error handling', function () {
    // UTS: rest/unit/RSC24/server-error-propagated-0
    it('RSC24_Error_1 - server error is propagated', async function () {
      const mock = new MockHttpClient({
        onConnectionAttempt: (conn) => conn.respond_with_success(),
        onRequest: (req) => {
          req.respond_with(500, {
            error: { code: 50000, statusCode: 500, message: 'Internal error' },
          });
        },
      });
      installMockHttp(mock);

      const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });

      let threw = false;
      try {
        await client.batchPresence(['any-channel']);
      } catch (err: any) {
        threw = true;
        expect(err.code).to.equal(50000);
        expect(err.statusCode).to.equal(500);
      }
      expect(threw).to.be.true;
    });

    // UTS: rest/unit/RSC24/auth-error-propagated-0
    it('RSC24_Error_2 - authentication error is propagated', async function () {
      const mock = new MockHttpClient({
        onConnectionAttempt: (conn) => conn.respond_with_success(),
        onRequest: (req) => {
          req.respond_with(401, {
            error: { code: 40101, statusCode: 401, message: 'Invalid credentials' },
          });
        },
      });
      installMockHttp(mock);

      const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });

      let threw = false;
      try {
        await client.batchPresence(['any-channel']);
      } catch (err: any) {
        threw = true;
        expect(err.code).to.equal(40101);
        expect(err.statusCode).to.equal(401);
      }
      expect(threw).to.be.true;
    });
  });

  // ---------------------------------------------------------------------------
  // RSC24_Auth - request authentication
  // ---------------------------------------------------------------------------

  describe('RSC24_Auth - request authentication', function () {
    // UTS: rest/unit/RSC24/uses-configured-auth-0
    it('RSC24_Auth_1 - basic auth header is included', async function () {
      const captured: any[] = [];
      const mock = new MockHttpClient({
        onConnectionAttempt: (conn) => conn.respond_with_success(),
        onRequest: (req) => {
          captured.push(req);
          req.respond_with(200, {
            successCount: 1,
            failureCount: 0,
            results: [{ channel: 'ch', presence: [] }],
          });
        },
      });
      installMockHttp(mock);

      const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
      await client.batchPresence(['ch']);

      expect(captured).to.have.length(1);
      expect(captured[0].headers).to.have.property('authorization');
      expect(captured[0].headers['authorization']).to.match(/^Basic /);
    });
  });
});
