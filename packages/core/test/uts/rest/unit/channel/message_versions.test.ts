/**
 * UTS: REST Channel getMessageVersions Tests
 *
 * Spec points: RSL14a, RSL14b, RSL14c
 * Source: uts/test/rest/unit/channel/message_versions.md
 */

import { expect } from 'chai';
import { MockHttpClient } from '../../../mock_http';
import { Ably, installMockHttp, restoreAll } from '../../../helpers';

describe('uts/rest/unit/channel/getMessageVersions', function () {
  afterEach(function () {
    restoreAll();
  });

  /**
   * RSL14b - GET to correct path
   *
   * getMessageVersions(serial) must send a GET request to
   * /channels/{channelName}/messages/{serial}/versions.
   */
  // UTS: rest/unit/RSL14b/get-correct-endpoint-0
  it('RSL14b - GET to correct path', async function () {
    const captured: any[] = [];
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        req.respond_with(200, [
          {
            name: 'evt',
            data: 'updated-data',
            serial: 'msg-serial-1',
            action: 1,
            version: { serial: 'vs2', timestamp: 1700000002000, clientId: 'user-1', description: 'edit' },
          },
        ]);
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    const ch = client.channels.get('test');
    await ch.getMessageVersions('msg-serial-1');

    expect(captured).to.have.length(1);
    expect(captured[0].method).to.equal('get');
    expect(captured[0].path).to.equal('/channels/test/messages/msg-serial-1/versions');
  });

  /**
   * RSL14c - returns PaginatedResult of Messages
   *
   * getMessageVersions must return a PaginatedResult containing
   * Message objects with version fields properly decoded.
   */
  // UTS: rest/unit/RSL14c/returns-paginated-result-0
  it('RSL14c - returns PaginatedResult of Messages', async function () {
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        req.respond_with(200, [
          {
            name: 'evt',
            data: 'updated-data',
            serial: 'msg-serial-1',
            action: 1,
            version: { serial: 'vs2', timestamp: 1700000002000, clientId: 'user-1', description: 'edit' },
          },
          {
            name: 'evt',
            data: 'original-data',
            serial: 'msg-serial-1',
            action: 0,
            version: { serial: 'vs1', timestamp: 1700000001000 },
          },
        ]);
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    const ch = client.channels.get('test');
    const result = await ch.getMessageVersions('msg-serial-1');

    expect(result.items).to.have.length(2);

    // First item: updated version with full version fields
    expect(result.items[0].data).to.equal('updated-data');
    expect(result.items[0].action).to.equal('message.update');
    expect(result.items[0].version).to.be.an('object');
    expect(result.items[0].version!.serial).to.equal('vs2');
    expect(result.items[0].version!.timestamp).to.equal(1700000002000);
    expect(result.items[0].version!.clientId).to.equal('user-1');
    expect(result.items[0].version!.description).to.equal('edit');

    // Second item: original version with minimal version fields
    expect(result.items[1].data).to.equal('original-data');
    expect(result.items[1].action).to.equal('message.create');
    expect(result.items[1].version).to.be.an('object');
    expect(result.items[1].version!.serial).to.equal('vs1');
    expect(result.items[1].version!.timestamp).to.equal(1700000001000);
  });

  /**
   * RSL14a - params as querystring
   *
   * Additional params passed to getMessageVersions must be included
   * as query string parameters on the request.
   */
  // UTS: rest/unit/RSL14a/params-as-querystring-0
  it('RSL14a - params as querystring', async function () {
    const captured: any[] = [];
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        req.respond_with(200, []);
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    const ch = client.channels.get('test');
    await ch.getMessageVersions('msg-serial-1', { direction: 'backwards', limit: '10' });

    expect(captured).to.have.length(1);
    expect(captured[0].url.searchParams.get('direction')).to.equal('backwards');
    expect(captured[0].url.searchParams.get('limit')).to.equal('10');
  });
});
