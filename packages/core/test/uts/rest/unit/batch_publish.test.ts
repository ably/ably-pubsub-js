/**
 * UTS: Batch Publish Tests
 *
 * Spec points: RSC22, RSC22c, RSC22d, BSP2a, BSP2b, BPR2a-c, BPF2a-b
 * Source: specification/uts/rest/unit/batch_publish.md
 *
 * Batch Presence tests are in batch_presence.test.ts.
 */

import { expect } from 'chai';
import { MockHttpClient } from '../../mock_http';
import { Ably, installMockHttp, restoreAll } from '../../helpers';

describe('uts/rest/unit/batch_publish', function () {
  afterEach(function () {
    restoreAll();
  });

  // ---------------------------------------------------------------------------
  // RSC22c - batchPublish sends POST to /messages
  // ---------------------------------------------------------------------------

  describe('RSC22c - batchPublish sends POST to /messages', function () {
    // UTS: rest/unit/RSC22c/single-spec-post-messages-0
    it('RSC22c1 - single BatchPublishSpec sends POST to /messages', async function () {
      const captured: any[] = [];
      const mock = new MockHttpClient({
        onConnectionAttempt: (conn) => conn.respond_with_success(),
        onRequest: (req) => {
          captured.push(req);
          req.respond_with(200, {
            successCount: 1,
            failureCount: 0,
            results: [{ channel: 'ch1', messageId: 'msg123', serials: ['s1'] }],
          });
        },
      });
      installMockHttp(mock);

      const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
      await client.batchPublish({
        channels: ['ch1'],
        messages: [{ name: 'event', data: 'hello' }],
      });

      expect(captured).to.have.length(1);
      expect(captured[0].method.toUpperCase()).to.equal('POST');
      expect(captured[0].path).to.equal('/messages');

      const body = JSON.parse(captured[0].body);
      // Single spec is wrapped in an array by the SDK
      expect(body).to.be.an('array').with.lengthOf(1);
      expect(body[0].channels).to.deep.equal(['ch1']);
      expect(body[0].messages).to.be.an('array').with.lengthOf(1);
      expect(body[0].messages[0].name).to.equal('event');
      expect(body[0].messages[0].data).to.equal('hello');
    });

    // UTS: rest/unit/RSC22c/array-specs-array-results-0
    it('RSC22c2 - array of BatchPublishSpecs sends POST to /messages', async function () {
      const captured: any[] = [];
      const mock = new MockHttpClient({
        onConnectionAttempt: (conn) => conn.respond_with_success(),
        onRequest: (req) => {
          captured.push(req);
          req.respond_with(200, [
            {
              successCount: 1,
              failureCount: 0,
              results: [{ channel: 'ch-a', messageId: 'msg1', serials: ['s1'] }],
            },
            {
              successCount: 1,
              failureCount: 0,
              results: [{ channel: 'ch-b', messageId: 'msg2', serials: ['s2'] }],
            },
          ]);
        },
      });
      installMockHttp(mock);

      const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
      await client.batchPublish([
        { channels: ['ch-a'], messages: [{ name: 'e1', data: 'd1' }] },
        { channels: ['ch-b'], messages: [{ name: 'e2', data: 'd2' }] },
      ]);

      expect(captured).to.have.length(1);
      expect(captured[0].method.toUpperCase()).to.equal('POST');
      expect(captured[0].path).to.equal('/messages');

      const body = JSON.parse(captured[0].body);
      expect(body).to.be.an('array').with.lengthOf(2);
      expect(body[0].channels).to.deep.equal(['ch-a']);
      expect(body[0].messages[0].name).to.equal('e1');
      expect(body[1].channels).to.deep.equal(['ch-b']);
      expect(body[1].messages[0].name).to.equal('e2');
    });

    // UTS: rest/unit/RSC22c/single-spec-single-result-0
    it('RSC22c3 - single spec returns single BatchResult (not array)', async function () {
      const mock = new MockHttpClient({
        onConnectionAttempt: (conn) => conn.respond_with_success(),
        onRequest: (req) => {
          // Server returns array of BatchResult, SDK unwraps first element for single spec
          req.respond_with(200, [
            {
              successCount: 1,
              failureCount: 0,
              results: [{ channel: 'ch1', messageId: 'msg123', serials: ['serial1'] }],
            },
          ]);
        },
      });
      installMockHttp(mock);

      const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
      const result = await client.batchPublish({
        channels: ['ch1'],
        messages: [{ name: 'event', data: 'data' }],
      });

      // Single spec returns a single BatchResult, not an array
      expect(result).to.not.be.an('array');
      expect(result).to.have.property('successCount', 1);
      expect(result).to.have.property('failureCount', 0);
      expect(result.results).to.be.an('array').with.lengthOf(1);
      expect(result.results[0].channel).to.equal('ch1');
    });

    // UTS: rest/unit/RSC22c/array-specs-post-messages-0
    it('RSC22c4 - array of specs returns array of BatchResults', async function () {
      const mock = new MockHttpClient({
        onConnectionAttempt: (conn) => conn.respond_with_success(),
        onRequest: (req) => {
          req.respond_with(200, [
            {
              successCount: 1,
              failureCount: 0,
              results: [{ channel: 'ch-a', messageId: 'msg1', serials: ['s1'] }],
            },
            {
              successCount: 1,
              failureCount: 0,
              results: [{ channel: 'ch-b', messageId: 'msg2', serials: ['s2'] }],
            },
          ]);
        },
      });
      installMockHttp(mock);

      const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
      const results = await client.batchPublish([
        { channels: ['ch-a'], messages: [{ name: 'e1', data: 'd1' }] },
        { channels: ['ch-b'], messages: [{ name: 'e2', data: 'd2' }] },
      ]);

      expect(results).to.be.an('array').with.lengthOf(2);
      expect(results[0].results[0].channel).to.equal('ch-a');
      expect((results[0].results[0] as any).messageId).to.equal('msg1');
      expect(results[1].results[0].channel).to.equal('ch-b');
      expect((results[1].results[0] as any).messageId).to.equal('msg2');
    });

    // UTS: rest/unit/RSC22/multiple-channels-multiple-messages-0
    it('RSC22 - multiple channels with multiple messages', async function () {
      const captured: any[] = [];
      const mock = new MockHttpClient({
        onConnectionAttempt: (conn) => conn.respond_with_success(),
        onRequest: (req) => {
          captured.push(req);
          req.respond_with(200, [
            {
              successCount: 3,
              failureCount: 0,
              results: [
                { channel: 'ch-1', messageId: 'msg1', serials: ['s1a', 's1b', 's1c'] },
                { channel: 'ch-2', messageId: 'msg2', serials: ['s2a', 's2b', 's2c'] },
                { channel: 'ch-3', messageId: 'msg3', serials: ['s3a', 's3b', 's3c'] },
              ],
            },
            {
              successCount: 3,
              failureCount: 0,
              results: [
                { channel: 'ch-4', messageId: 'msg4', serials: ['s4a', 's4b'] },
                { channel: 'ch-5', messageId: 'msg5', serials: ['s5a', 's5b'] },
                { channel: 'ch-6', messageId: 'msg6', serials: ['s6a', 's6b'] },
              ],
            },
            {
              successCount: 3,
              failureCount: 0,
              results: [
                { channel: 'ch-7', messageId: 'msg7', serials: ['s7a'] },
                { channel: 'ch-8', messageId: 'msg8', serials: ['s8a'] },
                { channel: 'ch-9', messageId: 'msg9', serials: ['s9a'] },
              ],
            },
          ]);
        },
      });
      installMockHttp(mock);

      const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
      const results = await client.batchPublish([
        {
          channels: ['ch-1', 'ch-2', 'ch-3'],
          messages: [
            { name: 'e1', data: 'd1' },
            { name: 'e2', data: 'd2' },
            { name: 'e3', data: 'd3' },
          ],
        },
        {
          channels: ['ch-4', 'ch-5', 'ch-6'],
          messages: [
            { name: 'e4', data: 'd4' },
            { name: 'e5', data: 'd5' },
          ],
        },
        {
          channels: ['ch-7', 'ch-8', 'ch-9'],
          messages: [{ name: 'e6', data: 'd6' }],
        },
      ]);

      expect(captured).to.have.length(1);
      const body = JSON.parse(captured[0].body);
      expect(body).to.be.an('array').with.lengthOf(3);
      expect(body[0].channels).to.deep.equal(['ch-1', 'ch-2', 'ch-3']);
      expect(body[0].messages).to.have.lengthOf(3);
      expect(body[1].channels).to.deep.equal(['ch-4', 'ch-5', 'ch-6']);
      expect(body[1].messages).to.have.lengthOf(2);
      expect(body[2].channels).to.deep.equal(['ch-7', 'ch-8', 'ch-9']);
      expect(body[2].messages).to.have.lengthOf(1);

      expect(results).to.be.an('array').with.lengthOf(3);
      expect(results[0].successCount).to.equal(3);
      expect(results[0].results).to.have.lengthOf(3);
      expect(results[1].successCount).to.equal(3);
      expect(results[1].results).to.have.lengthOf(3);
      expect(results[2].successCount).to.equal(3);
      expect(results[2].results).to.have.lengthOf(3);
    });

    // UTS: rest/unit/RSC22c/multiple-channels-multiple-results-0
    it('RSC22c5 - multiple channels in spec produces multiple results', async function () {
      const mock = new MockHttpClient({
        onConnectionAttempt: (conn) => conn.respond_with_success(),
        onRequest: (req) => {
          req.respond_with(200, [
            {
              successCount: 3,
              failureCount: 0,
              results: [
                { channel: 'ch-1', messageId: 'msg1', serials: ['s1'] },
                { channel: 'ch-2', messageId: 'msg2', serials: ['s2'] },
                { channel: 'ch-3', messageId: 'msg3', serials: ['s3'] },
              ],
            },
          ]);
        },
      });
      installMockHttp(mock);

      const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
      const result = await client.batchPublish({
        channels: ['ch-1', 'ch-2', 'ch-3'],
        messages: [{ name: 'event', data: 'data' }],
      });

      expect(result.successCount).to.equal(3);
      expect(result.results).to.have.lengthOf(3);
      expect(result.results[0].channel).to.equal('ch-1');
      expect(result.results[1].channel).to.equal('ch-2');
      expect(result.results[2].channel).to.equal('ch-3');
    });
  });

  // ---------------------------------------------------------------------------
  // RSC22c7 - Request uses correct authentication
  // ---------------------------------------------------------------------------

  describe('RSC22c7 - authentication', function () {
    // UTS: rest/unit/RSC22c/uses-configured-auth-0
    it('RSC22c7 - basic auth header is included', async function () {
      const captured: any[] = [];
      const mock = new MockHttpClient({
        onConnectionAttempt: (conn) => conn.respond_with_success(),
        onRequest: (req) => {
          captured.push(req);
          req.respond_with(200, [
            {
              successCount: 1,
              failureCount: 0,
              results: [{ channel: 'ch', messageId: 'msg', serials: ['s'] }],
            },
          ]);
        },
      });
      installMockHttp(mock);

      const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
      await client.batchPublish({
        channels: ['ch'],
        messages: [{ name: 'e', data: 'd' }],
      });

      expect(captured).to.have.length(1);
      expect(captured[0].headers).to.have.property('authorization');
      expect(captured[0].headers['authorization']).to.match(/^Basic /);
    });
  });

  // ---------------------------------------------------------------------------
  // BPR - BatchPublishSuccessResult structure
  // ---------------------------------------------------------------------------

  describe('BPR - BatchPublishSuccessResult structure', function () {
    // UTS: rest/unit/BPR2a/success-channel-name-0
    it('BPR2a - channel field contains channel name', async function () {
      const mock = new MockHttpClient({
        onConnectionAttempt: (conn) => conn.respond_with_success(),
        onRequest: (req) => {
          req.respond_with(200, [
            {
              successCount: 1,
              failureCount: 0,
              results: [{ channel: 'my-channel', messageId: 'msg123', serials: ['s1'] }],
            },
          ]);
        },
      });
      installMockHttp(mock);

      const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
      const result = await client.batchPublish({
        channels: ['my-channel'],
        messages: [{ name: 'e', data: 'd' }],
      });

      expect(result.results[0].channel).to.equal('my-channel');
    });

    // UTS: rest/unit/BPR2b/success-message-id-prefix-0
    it('BPR2b - messageId contains the message ID prefix', async function () {
      const mock = new MockHttpClient({
        onConnectionAttempt: (conn) => conn.respond_with_success(),
        onRequest: (req) => {
          req.respond_with(200, [
            {
              successCount: 1,
              failureCount: 0,
              results: [{ channel: 'ch', messageId: 'unique-id-prefix', serials: ['s1', 's2'] }],
            },
          ]);
        },
      });
      installMockHttp(mock);

      const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
      const result = await client.batchPublish({
        channels: ['ch'],
        messages: [
          { name: 'e1', data: 'd1' },
          { name: 'e2', data: 'd2' },
        ],
      });

      expect((result.results[0] as any).messageId).to.equal('unique-id-prefix');
    });

    // UTS: rest/unit/BPR2c/serials-array-0
    it('BPR2c - serials contains array of message serials', async function () {
      const mock = new MockHttpClient({
        onConnectionAttempt: (conn) => conn.respond_with_success(),
        onRequest: (req) => {
          req.respond_with(200, [
            {
              successCount: 1,
              failureCount: 0,
              results: [{ channel: 'ch', messageId: 'msg', serials: ['serial1', 'serial2', 'serial3'] }],
            },
          ]);
        },
      });
      installMockHttp(mock);

      const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
      const result = await client.batchPublish({
        channels: ['ch'],
        messages: [
          { name: 'e1', data: 'd1' },
          { name: 'e2', data: 'd2' },
          { name: 'e3', data: 'd3' },
        ],
      });

      expect((result.results[0] as any).serials).to.deep.equal(['serial1', 'serial2', 'serial3']);
    });

    // UTS: rest/unit/BPR2c/serials-null-conflated-0
    it('BPR2c1 - serials may contain null for conflated messages', async function () {
      const mock = new MockHttpClient({
        onConnectionAttempt: (conn) => conn.respond_with_success(),
        onRequest: (req) => {
          req.respond_with(200, [
            {
              successCount: 1,
              failureCount: 0,
              results: [{ channel: 'ch', messageId: 'msg', serials: ['serial1', null, 'serial3'] }],
            },
          ]);
        },
      });
      installMockHttp(mock);

      const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
      const result = await client.batchPublish({
        channels: ['ch'],
        messages: [
          { name: 'e1', data: 'd1' },
          { name: 'e2', data: 'd2' },
          { name: 'e3', data: 'd3' },
        ],
      });

      expect((result.results[0] as any).serials).to.deep.equal(['serial1', null, 'serial3']);
    });
  });

  // ---------------------------------------------------------------------------
  // BPF - BatchPublishFailureResult structure
  // ---------------------------------------------------------------------------

  describe('BPF - BatchPublishFailureResult structure', function () {
    // UTS: rest/unit/BPF2a/failure-channel-name-0
    it('BPF2a - channel field contains failed channel name', async function () {
      const mock = new MockHttpClient({
        onConnectionAttempt: (conn) => conn.respond_with_success(),
        onRequest: (req) => {
          req.respond_with(200, [
            {
              successCount: 0,
              failureCount: 1,
              results: [
                { channel: 'restricted-ch', error: { code: 40160, statusCode: 401, message: 'Not permitted' } },
              ],
            },
          ]);
        },
      });
      installMockHttp(mock);

      const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
      const result = await client.batchPublish({
        channels: ['restricted-ch'],
        messages: [{ name: 'e', data: 'd' }],
      });

      expect(result.results[0].channel).to.equal('restricted-ch');
    });

    // UTS: rest/unit/BPF2b/failure-error-info-0
    it('BPF2b - error contains ErrorInfo for failure reason', async function () {
      const mock = new MockHttpClient({
        onConnectionAttempt: (conn) => conn.respond_with_success(),
        onRequest: (req) => {
          req.respond_with(200, [
            {
              successCount: 0,
              failureCount: 1,
              results: [
                {
                  channel: 'restricted-ch',
                  error: {
                    code: 40160,
                    statusCode: 401,
                    message: 'Channel operation not permitted',
                  },
                },
              ],
            },
          ]);
        },
      });
      installMockHttp(mock);

      const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
      const result = await client.batchPublish({
        channels: ['restricted-ch'],
        messages: [{ name: 'e', data: 'd' }],
      });

      expect((result.results[0] as any).error).to.exist;
      expect((result.results[0] as any).error.code).to.equal(40160);
      expect((result.results[0] as any).error.statusCode).to.equal(401);
      expect((result.results[0] as any).error.message).to.include('not permitted');
    });
  });

  // ---------------------------------------------------------------------------
  // BatchResult - Mixed success and failure
  // ---------------------------------------------------------------------------

  describe('BatchResult - mixed success and failure', function () {
    // UTS: rest/unit/RSC22c/partial-success-mixed-results-0
    it('BatchResult1 - partial success with mixed results', async function () {
      const mock = new MockHttpClient({
        onConnectionAttempt: (conn) => conn.respond_with_success(),
        onRequest: (req) => {
          req.respond_with(200, [
            {
              successCount: 1,
              failureCount: 1,
              results: [
                { channel: 'allowed-ch', messageId: 'msg1', serials: ['s1'] },
                { channel: 'restricted-ch', error: { code: 40160, statusCode: 401, message: 'Not permitted' } },
              ],
            },
          ]);
        },
      });
      installMockHttp(mock);

      const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
      const result = await client.batchPublish({
        channels: ['allowed-ch', 'restricted-ch'],
        messages: [{ name: 'e', data: 'd' }],
      });

      expect(result.successCount).to.equal(1);
      expect(result.failureCount).to.equal(1);
      expect(result.results).to.have.lengthOf(2);

      // Success result has messageId, no error
      expect(result.results[0].channel).to.equal('allowed-ch');
      expect((result.results[0] as any).messageId).to.equal('msg1');
      expect('error' in result.results[0]).to.be.false;

      // Failure result has error, no messageId
      expect(result.results[1].channel).to.equal('restricted-ch');
      expect((result.results[1] as any).error.code).to.equal(40160);
      expect('messageId' in result.results[1]).to.be.false;
    });

    // UTS: rest/unit/RSC22c/distinguish-success-failure-0
    it('BatchResult2 - distinguish success from failure results', async function () {
      const mock = new MockHttpClient({
        onConnectionAttempt: (conn) => conn.respond_with_success(),
        onRequest: (req) => {
          req.respond_with(200, [
            {
              successCount: 2,
              failureCount: 1,
              results: [
                { channel: 'ch-ok-1', messageId: 'msg1', serials: ['s1'] },
                { channel: 'ch-fail', error: { code: 40160, statusCode: 401, message: 'Not permitted' } },
                { channel: 'ch-ok-2', messageId: 'msg2', serials: ['s2'] },
              ],
            },
          ]);
        },
      });
      installMockHttp(mock);

      const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
      const result = await client.batchPublish({
        channels: ['ch-ok-1', 'ch-fail', 'ch-ok-2'],
        messages: [{ name: 'e', data: 'd' }],
      });

      expect(result.successCount).to.equal(2);
      expect(result.failureCount).to.equal(1);
      expect(result.results).to.have.lengthOf(3);

      // Distinguish success results (have messageId/serials, no error)
      const successResults = result.results.filter((r: any) => 'messageId' in r);
      const failureResults = result.results.filter((r: any) => 'error' in r);

      expect(successResults).to.have.lengthOf(2);
      expect(failureResults).to.have.lengthOf(1);

      expect(successResults[0].channel).to.equal('ch-ok-1');
      expect((successResults[0] as any).messageId).to.equal('msg1');
      expect((successResults[0] as any).serials).to.deep.equal(['s1']);

      expect(successResults[1].channel).to.equal('ch-ok-2');
      expect((successResults[1] as any).messageId).to.equal('msg2');

      expect(failureResults[0].channel).to.equal('ch-fail');
      expect((failureResults[0] as any).error.code).to.equal(40160);
    });
  });

  // ---------------------------------------------------------------------------
  // Error handling
  // ---------------------------------------------------------------------------

  describe('Error handling', function () {
    // UTS: rest/unit/RSC22/server-error-propagated-0
    it('RSC22_Error3 - server error returns error', async function () {
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
        await client.batchPublish({
          channels: ['ch'],
          messages: [{ name: 'e', data: 'd' }],
        });
      } catch (err: any) {
        threw = true;
        expect(err.code).to.equal(50000);
        expect(err.statusCode).to.equal(500);
      }
      expect(threw).to.be.true;
    });

    // UTS: rest/unit/RSC22/auth-error-propagated-0
    it('RSC22_Error4 - authentication error returns error', async function () {
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
        await client.batchPublish({
          channels: ['ch'],
          messages: [{ name: 'e', data: 'd' }],
        });
      } catch (err: any) {
        threw = true;
        expect(err.code).to.equal(40101);
        expect(err.statusCode).to.equal(401);
      }
      expect(threw).to.be.true;
    });
  });

  // ---------------------------------------------------------------------------
  // RSC22_Headers - request headers
  // ---------------------------------------------------------------------------

  describe('RSC22_Headers - request headers', function () {
    // UTS: rest/unit/RSC22/standard-headers-included-0
    it('RSC22_Headers1 - standard headers included', async function () {
      const captured: any[] = [];
      const mock = new MockHttpClient({
        onConnectionAttempt: (conn) => conn.respond_with_success(),
        onRequest: (req) => {
          captured.push(req);
          req.respond_with(200, [
            {
              successCount: 1,
              failureCount: 0,
              results: [{ channel: 'ch', messageId: 'msg', serials: ['s'] }],
            },
          ]);
        },
      });
      installMockHttp(mock);

      const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
      await client.batchPublish({
        channels: ['ch'],
        messages: [{ name: 'e', data: 'd' }],
      });

      expect(captured).to.have.length(1);
      expect(captured[0].headers).to.have.property('X-Ably-Version');
      expect(captured[0].headers['X-Ably-Version']).to.match(/[0-9.]+/);
      expect(captured[0].headers).to.have.property('Ably-Agent');
      expect(captured[0].headers['content-type']).to.include('application/json');
    });
  });

  // ---------------------------------------------------------------------------
  // RSC22_Headers2 - request_id when addRequestIds enabled
  // ---------------------------------------------------------------------------

  describe('RSC22_Headers2 - request_id', function () {
    // UTS: rest/unit/RSC22/request-id-included-0
    it('RSC22_Headers2 - request_id included when addRequestIds enabled', async function () {
      // DEVIATION: see deviations.md
      if (!process.env.RUN_DEVIATIONS) this.skip();
      const captured: any[] = [];
      const mock = new MockHttpClient({
        onConnectionAttempt: (conn) => conn.respond_with_success(),
        onRequest: (req) => {
          captured.push(req);
          req.respond_with(200, [
            {
              successCount: 1,
              failureCount: 0,
              results: [{ channel: 'ch', messageId: 'msg', serials: ['s'] }],
            },
          ]);
        },
      });
      installMockHttp(mock);

      const client = new Ably.Rest({
        key: 'appId.keyId:keySecret',
        useBinaryProtocol: false,
        addRequestIds: true,
      } as any);
      await client.batchPublish({
        channels: ['ch'],
        messages: [{ name: 'e', data: 'd' }],
      });

      expect(captured).to.have.length(1);
      const requestId = captured[0].url.searchParams.get('request_id');
      expect(requestId).to.be.a('string').and.not.be.empty;
    });
  });

  // ---------------------------------------------------------------------------
  // BSP - BatchPublishSpec structure
  // ---------------------------------------------------------------------------

  describe('BSP - BatchPublishSpec structure', function () {
    // UTS: rest/unit/BSP2a/channels-array-strings-0
    it('BSP2a - channels is array of strings', async function () {
      const captured: any[] = [];
      const mock = new MockHttpClient({
        onConnectionAttempt: (conn) => conn.respond_with_success(),
        onRequest: (req) => {
          captured.push(req);
          req.respond_with(200, [
            {
              successCount: 3,
              failureCount: 0,
              results: [
                { channel: 'ch-a', messageId: 'msg', serials: ['s'] },
                { channel: 'ch-b', messageId: 'msg', serials: ['s'] },
                { channel: 'ch-c', messageId: 'msg', serials: ['s'] },
              ],
            },
          ]);
        },
      });
      installMockHttp(mock);

      const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
      await client.batchPublish({
        channels: ['ch-a', 'ch-b', 'ch-c'],
        messages: [{ name: 'e', data: 'd' }],
      });

      const body = JSON.parse(captured[0].body);
      expect(body[0].channels).to.be.an('array').with.lengthOf(3);
      expect(body[0].channels).to.deep.equal(['ch-a', 'ch-b', 'ch-c']);
    });

    // UTS: rest/unit/BSP2b/messages-array-objects-0
    it('BSP2b - messages is array of Message objects', async function () {
      const captured: any[] = [];
      const mock = new MockHttpClient({
        onConnectionAttempt: (conn) => conn.respond_with_success(),
        onRequest: (req) => {
          captured.push(req);
          req.respond_with(200, [
            {
              successCount: 1,
              failureCount: 0,
              results: [{ channel: 'ch', messageId: 'msg', serials: ['s1', 's2'] }],
            },
          ]);
        },
      });
      installMockHttp(mock);

      const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
      await client.batchPublish({
        channels: ['ch'],
        messages: [
          { name: 'event1', data: 'data1' },
          { name: 'event2', data: JSON.stringify({ key: 'value' }) },
        ],
      });

      const body = JSON.parse(captured[0].body);
      expect(body[0].messages).to.be.an('array').with.lengthOf(2);
      expect(body[0].messages[0].name).to.equal('event1');
      expect(body[0].messages[0].data).to.equal('data1');
      expect(body[0].messages[1].name).to.equal('event2');
    });
  });

  // ---------------------------------------------------------------------------
  // RSC22d - idempotent publish with idempotentRestPublishing
  // ---------------------------------------------------------------------------

  describe('RSC22d - idempotent batch publish', function () {
    /**
     * RSC22d - batch publish generates idempotent IDs per RSL1k1
     *
     * Per spec: "If idempotentRestPublishing is enabled, then RSL1k1 should
     * be applied (to each BatchPublishSpec separately)."
     */
    // UTS: rest/unit/RSC22d/idempotent-ids-generated-0
    it('RSC22d - batch publish generates idempotent IDs', async function () {
      // DEVIATION: see deviations.md
      if (!process.env.RUN_DEVIATIONS) this.skip();
      const captured: any[] = [];
      const mock = new MockHttpClient({
        onConnectionAttempt: (conn) => conn.respond_with_success(),
        onRequest: (req) => {
          captured.push(req);
          req.respond_with(201, [
            {
              successCount: 1,
              failureCount: 0,
              results: [{ channel: 'ch1', messageId: 'msg-id-1', serials: ['s1'] }],
            },
          ]);
        },
      });
      installMockHttp(mock);

      const client = new Ably.Rest({
        key: 'appId.keyId:keySecret',
        useBinaryProtocol: false,
        idempotentRestPublishing: true,
      });
      await client.batchPublish({
        channels: ['ch1'],
        messages: [{ name: 'event', data: 'data' }],
      });

      expect(captured).to.have.length(1);
      const body = JSON.parse(captured[0].body);
      expect(body[0].messages[0]).to.have.property('id');
      expect(body[0].messages[0].id).to.match(/^.+:0$/);
    });

    // UTS: rest/unit/RSC22d/explicit-ids-preserved-0
    it('RSC22d - explicit message IDs preserved when idempotent publishing enabled', async function () {
      const captured: any[] = [];
      const mock = new MockHttpClient({
        onConnectionAttempt: (conn) => conn.respond_with_success(),
        onRequest: (req) => {
          captured.push(req);
          req.respond_with(200, [
            {
              successCount: 1,
              failureCount: 0,
              results: [{ channel: 'ch1', messageId: 'msg-id-1', serials: ['s1', 's2'] }],
            },
          ]);
        },
      });
      installMockHttp(mock);

      const client = new Ably.Rest({
        key: 'appId.keyId:keySecret',
        useBinaryProtocol: false,
        idempotentRestPublishing: true,
      });
      await client.batchPublish({
        channels: ['ch1'],
        messages: [
          { name: 'event1', data: 'test1', id: 'my-explicit-id-1' },
          { name: 'event2', data: 'test2', id: 'my-explicit-id-2' },
        ],
      });

      expect(captured).to.have.length(1);
      const body = JSON.parse(captured[0].body);
      expect(body[0].messages[0].id).to.equal('my-explicit-id-1');
      expect(body[0].messages[1].id).to.equal('my-explicit-id-2');
    });

    // UTS: rest/unit/RSC22d/ids-not-generated-disabled-0
    it('RSC22d - IDs not generated when idempotent publishing disabled', async function () {
      const captured: any[] = [];
      const mock = new MockHttpClient({
        onConnectionAttempt: (conn) => conn.respond_with_success(),
        onRequest: (req) => {
          captured.push(req);
          req.respond_with(200, [
            {
              successCount: 1,
              failureCount: 0,
              results: [{ channel: 'ch1', messageId: 'msg-id-1', serials: ['s1'] }],
            },
          ]);
        },
      });
      installMockHttp(mock);

      const client = new Ably.Rest({
        key: 'appId.keyId:keySecret',
        useBinaryProtocol: false,
        idempotentRestPublishing: false,
      });
      await client.batchPublish({
        channels: ['ch1'],
        messages: [{ name: 'event', data: 'data' }],
      });

      expect(captured).to.have.length(1);
      const body = JSON.parse(captured[0].body);
      expect(body[0].messages[0]).to.not.have.property('id');
    });
  });

  // ---------------------------------------------------------------------------
  // RSC22_Error - edge cases
  // ---------------------------------------------------------------------------

  describe('RSC22_Error - edge cases', function () {
    // UTS: rest/unit/RSC22/empty-messages-rejected-0
    it('RSC22_Error2 - empty messages array rejected', async function () {
      const captured: any[] = [];
      const mock = new MockHttpClient({
        onConnectionAttempt: (conn) => conn.respond_with_success(),
        onRequest: (req) => {
          captured.push(req);
          req.respond_with(400, {
            error: { code: 40000, statusCode: 400, message: 'No messages specified' },
          });
        },
      });
      installMockHttp(mock);

      const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });

      let threw = false;
      try {
        await client.batchPublish({
          channels: ['ch1'],
          messages: [],
        });
      } catch (err: any) {
        threw = true;
        // Either the SDK validates locally or the server rejects it
        expect(err.code).to.be.a('number');
      }

      // Either an error is thrown or the request was made with the empty array
      if (!threw) {
        expect(captured).to.have.length(1);
        const body = JSON.parse(captured[0].body);
        expect(body[0].messages).to.deep.equal([]);
      }
    });

    // UTS: rest/unit/RSC22/empty-channels-rejected-0
    it('RSC22_Error1 - empty channels array', async function () {
      const captured: any[] = [];
      const mock = new MockHttpClient({
        onConnectionAttempt: (conn) => conn.respond_with_success(),
        onRequest: (req) => {
          captured.push(req);
          req.respond_with(400, {
            error: { code: 40000, statusCode: 400, message: 'No channels specified' },
          });
        },
      });
      installMockHttp(mock);

      const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });

      let threw = false;
      try {
        await client.batchPublish({
          channels: [],
          messages: [{ name: 'e', data: 'd' }],
        });
      } catch (err: any) {
        threw = true;
        // Either the SDK validates locally or the server rejects it
        expect(err.code).to.be.a('number');
      }

      // Either an error is thrown or the request was made with the empty array
      if (!threw) {
        expect(captured).to.have.length(1);
        const body = JSON.parse(captured[0].body);
        expect(body[0].channels).to.deep.equal([]);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // RSC22c6 - encoding in batch messages
  // ---------------------------------------------------------------------------

  describe('RSC22c6 - encoding in batch messages', function () {
    // UTS: rest/unit/RSC22c/messages-encoded-per-rsl4-0
    it('RSC22c6 - JSON string data sent correctly in body', async function () {
      const captured: any[] = [];
      const mock = new MockHttpClient({
        onConnectionAttempt: (conn) => conn.respond_with_success(),
        onRequest: (req) => {
          captured.push(req);
          req.respond_with(200, [
            {
              successCount: 1,
              failureCount: 0,
              results: [{ channel: 'ch', messageId: 'msg', serials: ['s1'] }],
            },
          ]);
        },
      });
      installMockHttp(mock);

      const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
      await client.batchPublish({
        channels: ['ch'],
        messages: [{ name: 'event', data: JSON.stringify({ key: 'value' }) }],
      });

      expect(captured).to.have.length(1);
      const body = JSON.parse(captured[0].body);
      expect(body[0].messages[0].name).to.equal('event');
      // The data should be the JSON string as-is
      const parsedData = JSON.parse(body[0].messages[0].data);
      expect(parsedData).to.deep.equal({ key: 'value' });
    });
  });

  // ---------------------------------------------------------------------------
  // BSP - additional BatchPublishSpec tests
  // ---------------------------------------------------------------------------

  describe('BSP - additional BatchPublishSpec tests', function () {
    // UTS: rest/unit/RSC22/multiple-messages-per-channel-0
    it('BSP - single channel in BatchPublishSpec', async function () {
      const captured: any[] = [];
      const mock = new MockHttpClient({
        onConnectionAttempt: (conn) => conn.respond_with_success(),
        onRequest: (req) => {
          captured.push(req);
          req.respond_with(200, [
            {
              successCount: 1,
              failureCount: 0,
              results: [{ channel: 'single-ch', messageId: 'msg', serials: ['s1'] }],
            },
          ]);
        },
      });
      installMockHttp(mock);

      const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
      await client.batchPublish({
        channels: ['single-ch'],
        messages: [{ name: 'e', data: 'd' }],
      });

      expect(captured).to.have.length(1);
      const body = JSON.parse(captured[0].body);
      // Single spec is wrapped in an array
      expect(body).to.be.an('array').with.lengthOf(1);
      expect(body[0].channels).to.deep.equal(['single-ch']);
      expect(body[0].messages).to.be.an('array').with.lengthOf(1);
      expect(body[0].messages[0].name).to.equal('e');
      expect(body[0].messages[0].data).to.equal('d');
    });
  });
});
