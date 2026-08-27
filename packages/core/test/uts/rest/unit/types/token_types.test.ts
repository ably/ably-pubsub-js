/**
 * UTS: TokenDetails, TokenParams, and TokenRequest Type Tests
 *
 * Spec points: TD1, TD2, TD3, TD4, TD5, TK1, TK2, TK3, TK4, TK5, TK6, TE1, TE2, TE3, TE4, TE5, TE6
 * Source: uts/test/rest/unit/types/token_types.md
 */

import { expect } from 'chai';
import { Ably, installMockHttp, restoreAll } from '../../../helpers';
import { MockHttpClient } from '../../../mock_http';

function simpleMock() {
  return new MockHttpClient({
    onConnectionAttempt: (conn) => conn.respond_with_success(),
    onRequest: (req) => req.respond_with(200, []),
  });
}

describe('uts/rest/unit/types/token_types', function () {
  afterEach(function () {
    restoreAll();
  });

  // --- TD1-TD5: TokenDetails attributes ---

  /**
   * TD1-TD5 - TokenDetails attributes are accessible via authCallback
   *
   * TokenDetails is a plain object in ably-js. We verify all fields
   * (token, expires, issued, capability, clientId) are accessible
   * on client.auth.tokenDetails after authorize().
   */
  // UTS: rest/unit/TD1/token-details-attributes-0
  it('TD1-TD5 - TokenDetails attributes from authCallback', async function () {
    installMockHttp(simpleMock());

    const client = new Ably.Rest({
      authCallback: function (params, callback) {
        callback(null, {
          token: 'test-token',
          expires: 1234567890000,
          issued: 1234567800000,
          capability: '{"*":["*"]}',
          clientId: 'my-client',
        });
      },
    });

    await client.auth.authorize();

    // TD1 - token attribute
    expect(client.auth.tokenDetails!.token).to.equal('test-token');
    // TD2 - expires attribute (milliseconds since epoch)
    expect(client.auth.tokenDetails!.expires).to.equal(1234567890000);
    // TD3 - issued attribute (milliseconds since epoch)
    expect(client.auth.tokenDetails!.issued).to.equal(1234567800000);
    // TD4 - capability attribute (JSON string)
    expect(client.auth.tokenDetails!.capability).to.equal('{"*":["*"]}');
    // TD5 - clientId attribute
    expect(client.auth.tokenDetails!.clientId).to.equal('my-client');
  });

  // --- TK1-TK6: TokenParams attributes via createTokenRequest ---

  /**
   * TK1-TK6 - TokenParams attributes reflected in createTokenRequest result
   *
   * createTokenRequest() accepts TokenParams and returns a signed
   * TokenRequest containing the supplied values.
   */
  // UTS: rest/unit/TK1/token-params-attributes-0
  it('TK1-TK6 - TokenParams attributes via createTokenRequest', async function () {
    installMockHttp(simpleMock());
    const client = new Ably.Rest({ key: 'appId.keyId:keySecret' });

    const tokenRequest = await client.auth.createTokenRequest(
      {
        ttl: 3600000,
        capability: '{"*":["subscribe"]}',
        clientId: 'param-client',
        timestamp: 1234567890000,
        nonce: 'custom-nonce',
      },
      null,
    );

    // TK1 - ttl
    expect(tokenRequest.ttl).to.equal(3600000);
    // TK2 - capability
    expect(tokenRequest.capability).to.equal('{"*":["subscribe"]}');
    // TK3 - clientId
    expect(tokenRequest.clientId).to.equal('param-client');
    // TK4 - timestamp
    expect(tokenRequest.timestamp).to.equal(1234567890000);
    // TK5 - nonce
    expect(tokenRequest.nonce).to.equal('custom-nonce');
  });

  /**
   * TK1 - TTL defaults to null when not specified
   */
  // UTS: rest/unit/TK1/token-params-attributes-0.1
  it('TK1 - TTL defaults to null when not specified', async function () {
    installMockHttp(simpleMock());
    const client = new Ably.Rest({ key: 'appId.keyId:keySecret' });

    const tokenRequest = await client.auth.createTokenRequest({}, null);

    expect(tokenRequest.ttl).to.satisfy((v: any) => v === null || v === undefined || v === '');
  });

  /**
   * TK2 - Capability defaults to null when not specified
   */
  // UTS: rest/unit/TK1/token-params-attributes-0.2
  it('TK2 - Capability defaults to null when not specified', async function () {
    installMockHttp(simpleMock());
    const client = new Ably.Rest({ key: 'appId.keyId:keySecret' });

    const tokenRequest = await client.auth.createTokenRequest({}, null);

    expect(tokenRequest.capability).to.satisfy((v: any) => v === null || v === undefined || v === '');
  });

  // --- TE1-TE6: TokenRequest attributes ---

  /**
   * TE1-TE6 - TokenRequest has all required attributes
   *
   * createTokenRequest() returns a signed TokenRequest with keyName,
   * ttl, capability, clientId, timestamp, nonce, and mac.
   */
  // UTS: rest/unit/TE1/token-request-attributes-0
  it('TE1-TE6 - TokenRequest attributes from createTokenRequest', async function () {
    installMockHttp(simpleMock());
    const client = new Ably.Rest({ key: 'appId.keyId:keySecret' });

    const tokenRequest = await client.auth.createTokenRequest(
      {
        ttl: 3600000,
        capability: '{"*":["*"]}',
        clientId: 'request-client',
        timestamp: 1234567890000,
        nonce: 'unique-nonce',
      },
      null,
    );

    // TE1 - keyName (derived from the API key)
    expect(tokenRequest.keyName).to.equal('appId.keyId');
    // TE2 - ttl
    expect(tokenRequest.ttl).to.equal(3600000);
    // TE3 - capability
    expect(tokenRequest.capability).to.equal('{"*":["*"]}');
    // TE4 - clientId
    expect(tokenRequest.clientId).to.equal('request-client');
    // TE5 - timestamp
    expect(tokenRequest.timestamp).to.equal(1234567890000);
    // TE6 - nonce
    expect(tokenRequest.nonce).to.equal('unique-nonce');
  });

  /**
   * TE - TokenRequest has mac (signature)
   *
   * The mac field is a non-empty string generated by signing
   * the token request parameters with the key secret.
   */
  // UTS: rest/unit/TE/token-request-mac-signature-0
  it('TE - TokenRequest has mac (signature)', async function () {
    installMockHttp(simpleMock());
    const client = new Ably.Rest({ key: 'appId.keyId:keySecret' });

    const tokenRequest = await client.auth.createTokenRequest(
      {
        ttl: 3600000,
        capability: '{"*":["*"]}',
        timestamp: 1234567890000,
        nonce: 'nonce-for-mac',
      },
      null,
    );

    expect(tokenRequest.mac).to.be.a('string');
    expect(tokenRequest.mac.length).to.be.greaterThan(0);
  });

  /**
   * TE - TokenRequest to JSON round-trip
   *
   * JSON.stringify the TokenRequest and parse it back;
   * verify all fields survive the round-trip.
   */
  // UTS: rest/unit/TE/token-request-to-json-1
  it('TE - TokenRequest JSON round-trip', async function () {
    installMockHttp(simpleMock());
    const client = new Ably.Rest({ key: 'appId.keyId:keySecret' });

    const tokenRequest = await client.auth.createTokenRequest(
      {
        ttl: 3600000,
        capability: '{"*":["*"]}',
        clientId: 'json-client',
        timestamp: 1234567890000,
        nonce: 'json-nonce',
      },
      null,
    );

    const json = JSON.stringify(tokenRequest);
    const parsed = JSON.parse(json);

    expect(parsed.keyName).to.equal('appId.keyId');
    expect(parsed.ttl).to.equal(3600000);
    expect(parsed.capability).to.equal('{"*":["*"]}');
    expect(parsed.clientId).to.equal('json-client');
    expect(parsed.timestamp).to.equal(1234567890000);
    expect(parsed.nonce).to.equal('json-nonce');
    expect(parsed.mac).to.be.a('string');
    expect(parsed.mac.length).to.be.greaterThan(0);
  });

  /**
   * TD - TokenDetails from authorize()
   *
   * authorize() returns TokenDetails; verify it has token, expires,
   * and issued fields.
   */
  // UTS: rest/unit/TD/token-details-from-json-0
  it('TD - TokenDetails from authorize()', async function () {
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        if (req.path.match(/\/keys\/.*\/requestToken/)) {
          req.respond_with(200, {
            token: 'authorized-token',
            expires: Date.now() + 3600000,
            issued: Date.now(),
            keyName: 'appId.keyId',
          });
        } else {
          req.respond_with(200, []);
        }
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret' });
    const tokenDetails = await client.auth.authorize();

    expect(tokenDetails.token).to.equal('authorized-token');
    expect(tokenDetails.expires).to.be.a('number');
    expect(tokenDetails.issued).to.be.a('number');
  });

  /**
   * TE1 - keyName derived from API key
   *
   * Verify keyName is the portion of the key before the colon
   * (appId.keyId), not the full key string.
   */
  // UTS: rest/unit/TE1/token-request-attributes-0.1
  it('TE1 - keyName derived from API key', async function () {
    installMockHttp(simpleMock());
    const client = new Ably.Rest({ key: 'myApp.myKey:mySecret' });

    const tokenRequest = await client.auth.createTokenRequest(null, null);

    expect(tokenRequest.keyName).to.equal('myApp.myKey');
  });

  /**
   * TE5 - timestamp auto-generated when not specified
   *
   * When no timestamp is provided, createTokenRequest generates one
   * automatically. It should be a recent timestamp (within last minute).
   */
  // UTS: rest/unit/TE1/token-request-attributes-0.2
  it('TE5 - timestamp auto-generated when not specified', async function () {
    installMockHttp(simpleMock());
    const client = new Ably.Rest({ key: 'appId.keyId:keySecret' });

    const before = Date.now();
    const tokenRequest = await client.auth.createTokenRequest(null, null);
    const after = Date.now();

    expect(tokenRequest.timestamp).to.be.a('number');
    expect(tokenRequest.timestamp).to.be.at.least(before - 1000);
    expect(tokenRequest.timestamp).to.be.at.most(after + 1000);
  });

  /**
   * TE6 - nonce auto-generated when not specified
   *
   * When no nonce is provided, createTokenRequest generates one
   * automatically. It should be a non-empty string.
   */
  // UTS: rest/unit/TE1/token-request-attributes-0.3
  it('TE6 - nonce auto-generated when not specified', async function () {
    installMockHttp(simpleMock());
    const client = new Ably.Rest({ key: 'appId.keyId:keySecret' });

    const tokenRequest = await client.auth.createTokenRequest(null, null);

    expect(tokenRequest.nonce).to.be.a('string');
    expect(tokenRequest.nonce.length).to.be.greaterThan(0);
  });

  /**
   * TD - TokenDetails from token string
   *
   * When a Rest client is instantiated with a plain token string,
   * the token should be accessible via client.auth.tokenDetails.
   */
  // UTS: rest/unit/TK/token-params-to-query-string-0
  it('TD - TokenDetails from token string', async function () {
    installMockHttp(simpleMock());

    const client = new Ably.Rest({ token: 'test-token' });

    // Accessing tokenDetails should reflect the token provided
    expect(client.auth.tokenDetails!.token).to.equal('test-token');
  });

  /**
   * TE - createTokenRequest preserves custom ttl
   *
   * When a custom TTL (e.g. 7200000 = 2 hours) is specified in
   * TokenParams, createTokenRequest must preserve it in the result.
   */
  // UTS: rest/unit/TE/token-request-from-json-2
  it('TE - createTokenRequest preserves custom ttl', async function () {
    installMockHttp(simpleMock());
    const client = new Ably.Rest({ key: 'appId.keyId:keySecret' });

    const tokenRequest = await client.auth.createTokenRequest(
      {
        ttl: 7200000,
      },
      null,
    );

    expect(tokenRequest.ttl).to.equal(7200000);
  });
});
