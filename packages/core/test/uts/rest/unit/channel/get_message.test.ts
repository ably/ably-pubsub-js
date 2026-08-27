/**
 * UTS: REST Channel getMessage Tests
 *
 * Spec points: RSL11a, RSL11b, RSL11c
 * Source: uts/test/rest/unit/channel/get_message.md
 */

import { expect } from 'chai';
import { MockHttpClient } from '../../../mock_http';
import { Ably, installMockHttp, restoreAll } from '../../../helpers';

describe('uts/rest/unit/channel/getMessage', function () {
  afterEach(function () {
    restoreAll();
  });

  /**
   * RSL11b - GET to correct path
   *
   * getMessage(serial) must send a GET request to
   * /channels/{channelName}/messages/{serial}.
   */
  // UTS: rest/unit/RSL11b/get-correct-endpoint-0
  it('RSL11b - GET to correct path', async function () {
    const captured: any[] = [];
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        req.respond_with(200, {
          id: 'msg-id-1',
          name: 'test-event',
          data: 'hello',
          serial: 'msg-serial-123',
        });
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    const ch = client.channels.get('test');
    await ch.getMessage('msg-serial-123');

    expect(captured).to.have.length(1);
    expect(captured[0].method).to.equal('get');
    expect(captured[0].path).to.equal('/channels/test/messages/msg-serial-123');
  });

  /**
   * RSL11c - returns decoded Message
   *
   * getMessage must return a single Message object with all fields
   * decoded from the response body.
   */
  // UTS: rest/unit/RSL11c/returns-decoded-message-0
  it('RSL11c - returns decoded Message', async function () {
    const responseBody = {
      id: 'msg-id-1',
      name: 'test-event',
      data: 'hello world',
      serial: 'serial-xyz',
      clientId: 'client-1',
      timestamp: 1700000000000,
      extras: { headers: { source: 'api' } },
      version: { serial: 'vs1', timestamp: 1700000000000, clientId: 'client-1' },
    };

    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        req.respond_with(200, responseBody);
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    const ch = client.channels.get('test');
    const msg = await ch.getMessage('serial-xyz');

    expect(msg.id).to.equal('msg-id-1');
    expect(msg.name).to.equal('test-event');
    expect(msg.data).to.equal('hello world');
    expect(msg.serial).to.equal('serial-xyz');
    expect(msg.clientId).to.equal('client-1');
    expect(msg.timestamp).to.equal(1700000000000);
    expect(msg.extras).to.deep.equal({ headers: { source: 'api' } });
    expect(msg.version).to.be.an('object');
    expect(msg.version!.serial).to.equal('vs1');
    expect(msg.version!.timestamp).to.equal(1700000000000);
  });

  /**
   * RSL11b - URL-encodes serial
   *
   * When the serial contains characters that are not URL-safe,
   * getMessage must URL-encode the serial in the request path.
   */
  // UTS: rest/unit/RSL11b/url-encodes-serial-1
  it('RSL11b - URL-encodes serial', async function () {
    const captured: any[] = [];
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        req.respond_with(200, {
          id: 'msg-id-1',
          name: 'test-event',
          data: 'hello',
          serial: 'serial/with:special+chars',
        });
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    const ch = client.channels.get('test');
    await ch.getMessage('serial/with:special+chars');

    expect(captured).to.have.length(1);
    expect(captured[0].method).to.equal('get');
    // The serial must be URL-encoded in the path
    expect(captured[0].path).to.include(encodeURIComponent('serial/with:special+chars'));
    expect(captured[0].path).to.not.include('serial/with:special+chars');
  });

  /**
   * RSL11a - empty serial throws 40003
   *
   * getMessage must throw an error with code 40003 when called
   * with an empty serial string.
   */
  // UTS: rest/unit/RSL11a/missing-serial-error-0
  it('RSL11a - empty serial throws 40003', async function () {
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        req.respond_with(200, {});
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    const ch = client.channels.get('test');

    try {
      await ch.getMessage('');
      expect.fail('Expected getMessage to throw due to empty serial');
    } catch (error: any) {
      expect(error.code).to.equal(40003);
    }
  });
});
