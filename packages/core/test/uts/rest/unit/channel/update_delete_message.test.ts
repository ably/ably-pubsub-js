/**
 * UTS: REST Channel Update/Delete/Append Message Tests
 *
 * Spec points: RSL15a, RSL15b, RSL15b7, RSL15c, RSL15d, RSL15e, RSL15f
 * Source: uts/test/rest/unit/channel/update_delete_message.md
 */

import { expect } from 'chai';
import { MockHttpClient } from '../../../mock_http';
import { Ably, installMockHttp, restoreAll } from '../../../helpers';

function msg(fields: any) {
  return Ably.Rest.Message.fromValues(fields);
}

describe('uts/rest/unit/channel/update_delete_message', function () {
  afterEach(function () {
    restoreAll();
  });

  /**
   * RSL15b - updateMessage sends PATCH
   *
   * updateMessage must send a PATCH request to /channels/<name>/messages/<serial>
   * with the message body containing action=1 (MESSAGE_UPDATE).
   */
  // UTS: rest/unit/RSL15b/update-sends-patch-update-0
  it('RSL15b - updateMessage sends PATCH', async function () {
    const captured: any[] = [];
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        req.respond_with(200, { versionSerial: 'vs1' });
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    const ch = client.channels.get('test-channel');
    await ch.updateMessage(msg({ serial: 'msg-serial-1', name: 'updated', data: 'new-data' }));

    expect(captured).to.have.length(1);
    expect(captured[0].method).to.equal('patch');
    expect(captured[0].path).to.equal('/channels/test-channel/messages/' + encodeURIComponent('msg-serial-1'));
    const body = JSON.parse(captured[0].body);
    expect(body.action).to.equal(1);
    expect(body.name).to.equal('updated');
    expect(body.data).to.equal('new-data');
  });

  /**
   * RSL15b - deleteMessage sends PATCH with action 2
   *
   * deleteMessage must send a PATCH request with action=2 (MESSAGE_DELETE).
   */
  // UTS: rest/unit/RSL15b/delete-sends-patch-delete-1
  it('RSL15b - deleteMessage sends PATCH with action 2', async function () {
    const captured: any[] = [];
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        req.respond_with(200, { versionSerial: 'vs1' });
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    const ch = client.channels.get('test-channel');
    await ch.deleteMessage(msg({ serial: 'msg-serial-1' }));

    expect(captured).to.have.length(1);
    expect(captured[0].method).to.equal('patch');
    expect(captured[0].path).to.equal('/channels/test-channel/messages/' + encodeURIComponent('msg-serial-1'));
    const body = JSON.parse(captured[0].body);
    expect(body.action).to.equal(2);
  });

  /**
   * RSL15b - appendMessage sends PATCH with action 5
   *
   * appendMessage must send a PATCH request with action=5 (MESSAGE_APPEND).
   */
  // UTS: rest/unit/RSL15b/append-sends-patch-append-2
  it('RSL15b - appendMessage sends PATCH with action 5', async function () {
    const captured: any[] = [];
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        req.respond_with(200, { versionSerial: 'vs1' });
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    const ch = client.channels.get('test-channel');
    await ch.appendMessage(msg({ serial: 'msg-serial-1', data: 'appended' }));

    expect(captured).to.have.length(1);
    expect(captured[0].method).to.equal('patch');
    expect(captured[0].path).to.equal('/channels/test-channel/messages/' + encodeURIComponent('msg-serial-1'));
    const body = JSON.parse(captured[0].body);
    expect(body.action).to.equal(5);
  });

  /**
   * RSL15b7 - version set with MessageOperation
   *
   * When an operation object is provided, the serialized body must include
   * a version field with clientId, description, and metadata from the operation.
   */
  // UTS: rest/unit/RSL15b7/version-set-with-operation-0
  it('RSL15b7 - version set with MessageOperation', async function () {
    const captured: any[] = [];
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        req.respond_with(200, { versionSerial: 'vs1' });
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    const ch = client.channels.get('test-channel');
    await ch.updateMessage(msg({ serial: 's1', data: 'updated' }), {
      clientId: 'user1',
      description: 'fixed typo',
      metadata: { reason: 'typo' },
    });

    expect(captured).to.have.length(1);
    const body = JSON.parse(captured[0].body);
    expect(body.version).to.be.an('object');
    expect(body.version.clientId).to.equal('user1');
    expect(body.version.description).to.equal('fixed typo');
    expect(body.version.metadata).to.deep.equal({ reason: 'typo' });
  });

  /**
   * RSL15b7 - version absent without operation
   *
   * When no operation object is provided, the serialized body must not
   * include a version field.
   */
  // UTS: rest/unit/RSL15b7/version-absent-no-operation-1
  it('RSL15b7 - version absent without operation', async function () {
    const captured: any[] = [];
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        req.respond_with(200, { versionSerial: 'vs1' });
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    const ch = client.channels.get('test-channel');
    await ch.updateMessage(msg({ serial: 's1', data: 'updated' }));

    expect(captured).to.have.length(1);
    const body = JSON.parse(captured[0].body);
    expect(body.version).to.be.undefined;
  });

  /**
   * RSL15c - does not mutate user-supplied message
   *
   * The update/delete methods must not modify the original message object
   * passed in by the user.
   */
  // UTS: rest/unit/RSL15c/no-mutate-user-message-0
  it('RSL15c - does not mutate user-supplied message', async function () {
    const captured: any[] = [];
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        req.respond_with(200, { versionSerial: 'vs1' });
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    const ch = client.channels.get('test-channel');

    const original = msg({ serial: 's1', name: 'original', data: 'original-data' });
    await ch.updateMessage(original);

    // The original message must not have been mutated with an action field
    expect(original.action).to.be.undefined;
    expect(original.name).to.equal('original');
    expect(original.data).to.equal('original-data');
  });

  /**
   * RSL15e - returns UpdateDeleteResult with versionSerial
   *
   * The resolved value must contain the versionSerial from the server response.
   */
  // UTS: rest/unit/RSL15e/returns-update-delete-result-0
  it('RSL15e - returns UpdateDeleteResult with versionSerial', async function () {
    const captured: any[] = [];
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        req.respond_with(200, { versionSerial: 'version-serial-abc' });
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    const ch = client.channels.get('test-channel');
    const result = await ch.updateMessage(msg({ serial: 's1', data: 'd' }));

    expect(result.versionSerial).to.equal('version-serial-abc');
  });

  /**
   * RSL15e - null versionSerial preserved
   *
   * When the server returns null for versionSerial, the client must
   * preserve it as null rather than converting to undefined.
   */
  // UTS: rest/unit/RSL15e/null-version-serial-1
  it('RSL15e - null versionSerial preserved', async function () {
    const captured: any[] = [];
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        req.respond_with(200, { versionSerial: null });
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    const ch = client.channels.get('test-channel');
    const result = await ch.updateMessage(msg({ serial: 's1', data: 'd' }));

    expect(result.versionSerial).to.equal(null);
  });

  /**
   * RSL15f - params sent as querystring
   *
   * When params are provided, they must be sent as URL query parameters.
   */
  // UTS: rest/unit/RSL15f/params-sent-as-querystring-0
  it('RSL15f - params sent as querystring', async function () {
    const captured: any[] = [];
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        req.respond_with(200, { versionSerial: 'vs1' });
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    const ch = client.channels.get('test-channel');
    await ch.updateMessage(msg({ serial: 's1', data: 'd' }), undefined, { key: 'value', num: '42' });

    expect(captured).to.have.length(1);
    expect(captured[0].url.searchParams.get('key')).to.equal('value');
    expect(captured[0].url.searchParams.get('num')).to.equal('42');
  });

  /**
   * RSL15a - serial required
   *
   * If the message lacks a serial, updateMessage, deleteMessage, and
   * appendMessage must all throw an error with code 40003.
   */
  // UTS: rest/unit/RSL15a/serial-required-throws-error-0
  it('RSL15a - serial required', async function () {
    const captured: any[] = [];
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        req.respond_with(200, { versionSerial: 'vs1' });
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    const ch = client.channels.get('test-channel');

    // updateMessage should throw
    try {
      await ch.updateMessage(msg({ name: 'x', data: 'y' }));
      expect.fail('Expected updateMessage to throw');
    } catch (error: any) {
      expect(error.code).to.equal(40003);
    }

    // deleteMessage should throw
    try {
      await ch.deleteMessage(msg({ name: 'x', data: 'y' }));
      expect.fail('Expected deleteMessage to throw');
    } catch (error: any) {
      expect(error.code).to.equal(40003);
    }

    // appendMessage should throw
    try {
      await ch.appendMessage(msg({ name: 'x', data: 'y' }));
      expect.fail('Expected appendMessage to throw');
    } catch (error: any) {
      expect(error.code).to.equal(40003);
    }

    // No requests should have been made
    expect(captured).to.have.length(0);
  });

  /**
   * RSL15d - data encoded per RSL4
   *
   * Object data must be JSON-encoded with an encoding field set to 'json'.
   */
  // UTS: rest/unit/RSL15d/body-encoded-per-rsl4-0
  it('RSL15d - data encoded per RSL4', async function () {
    const captured: any[] = [];
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        req.respond_with(200, { versionSerial: 'vs1' });
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    const ch = client.channels.get('test-channel');
    await ch.updateMessage(msg({ serial: 's1', data: { key: 'value' } }));

    expect(captured).to.have.length(1);
    const body = JSON.parse(captured[0].body);
    expect(typeof body.data).to.equal('string');
    expect(body.encoding).to.equal('json');
  });

  /**
   * RSL15b - serial URL-encoded
   *
   * The serial must be URL-encoded in the request path to handle
   * special characters correctly.
   */
  // UTS: rest/unit/RSL15b/serial-url-encoded-path-3
  it('RSL15b - serial URL-encoded', async function () {
    const captured: any[] = [];
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        req.respond_with(200, { versionSerial: 'vs1' });
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    const ch = client.channels.get('test-channel');
    await ch.updateMessage(msg({ serial: 'serial/special:chars', data: 'd' }));

    expect(captured).to.have.length(1);
    // The path should contain the URL-encoded serial
    expect(captured[0].path).to.include(encodeURIComponent('serial/special:chars'));
  });
});
