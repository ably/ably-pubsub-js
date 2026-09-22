/**
 * UTS: REST Channel Publish Result Tests
 *
 * Spec points: RSL1n
 * Source: uts/test/rest/unit/channel/publish_result.md
 */

import { expect } from 'chai';
import { MockHttpClient } from '../../../mock_http';
import { Ably, installMockHttp, restoreAll } from '../../../helpers';

describe('uts/rest/unit/channel/publish_result', function () {
  afterEach(function () {
    restoreAll();
  });

  /**
   * RSL1n - single message returns PublishResult with serial
   *
   * When a single message is published, the server responds with a
   * PublishResult containing a serials array with one entry.
   */
  // UTS: rest/unit/RSL1n/publish-result-single-message-0
  it('RSL1n - single message returns PublishResult with serial', async function () {
    const captured: any[] = [];
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        req.respond_with(201, { serials: ['serial-abc'] });
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    const ch = client.channels.get('test-channel');
    const result = await ch.publish('event', 'data');

    expect(captured).to.have.length(1);
    expect(result).to.have.property('serials');
    expect(result.serials).to.have.length(1);
    expect(result.serials[0]).to.equal('serial-abc');
  });

  /**
   * RSL1n - batch returns PublishResult with multiple serials
   *
   * When multiple messages are published in a single call, the server
   * responds with a serials array containing one entry per message.
   */
  // UTS: rest/unit/RSL1n/publish-result-batch-serials-1
  it('RSL1n - batch returns PublishResult with multiple serials', async function () {
    const captured: any[] = [];
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        req.respond_with(201, { serials: ['s1', 's2', 's3'] });
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    const ch = client.channels.get('test-channel');
    const result = await ch.publish([
      { name: 'event1', data: 'data1' },
      { name: 'event2', data: 'data2' },
      { name: 'event3', data: 'data3' },
    ]);

    expect(captured).to.have.length(1);
    expect(result).to.have.property('serials');
    expect(result.serials).to.have.length(3);
    expect(result.serials[0]).to.equal('s1');
    expect(result.serials[1]).to.equal('s2');
    expect(result.serials[2]).to.equal('s3');
  });

  /**
   * RSL1n - null serial preserved (conflated)
   *
   * When the server conflates messages, it may return null for some
   * serials entries. The client must preserve these null values.
   */
  // UTS: rest/unit/RSL1n/publish-result-null-serial-2
  it('RSL1n - null serial preserved (conflated)', async function () {
    const captured: any[] = [];
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        req.respond_with(201, { serials: [null, 's2'] });
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    const ch = client.channels.get('test-channel');
    const result = await ch.publish([
      { name: 'event1', data: 'data1' },
      { name: 'event2', data: 'data2' },
    ]);

    expect(captured).to.have.length(1);
    expect(result).to.have.property('serials');
    expect(result.serials).to.have.length(2);
    expect(result.serials[0]).to.equal(null);
    expect(result.serials[1]).to.equal('s2');
  });
});
