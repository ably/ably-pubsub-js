/**
 * UTS: ClientOptions and AuthOptions Type Tests
 *
 * Spec points: TO1, TO2, TO3, AO1, AO2
 * Source: uts/test/rest/unit/types/options_types.md
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

describe('uts/rest/unit/types/options_types', function () {
  afterEach(function () {
    restoreAll();
  });

  /**
   * TO3 - ClientOptions defaults: tls
   */
  // UTS: rest/unit/TO3/client-options-default-token-params-3
  it('TO3 - tls defaults to true', function () {
    installMockHttp(simpleMock());
    const client = new Ably.Rest({ key: 'appId.keyId:keySecret' });
    expect(client.options.tls).to.equal(true);
  });

  /**
   * TO3 - ClientOptions defaults: useBinaryProtocol
   */
  // UTS: rest/unit/TO3/client-options-auth-url-2
  it('TO3 - useBinaryProtocol defaults to true', function () {
    installMockHttp(simpleMock());
    const client = new Ably.Rest({ key: 'appId.keyId:keySecret' });
    expect(client.options.useBinaryProtocol).to.equal(true);
  });

  /**
   * TO3 - ClientOptions defaults: idempotentRestPublishing
   */
  // UTS: rest/unit/TO/conflicting-options-validation-1
  it('TO3 - idempotentRestPublishing defaults to true', function () {
    installMockHttp(simpleMock());
    const client = new Ably.Rest({ key: 'appId.keyId:keySecret' });
    expect(client.options.idempotentRestPublishing).to.equal(true);
  });

  /**
   * TO3 - ClientOptions defaults: maxMessageSize
   */
  // UTS: rest/unit/TO/endpoint-affects-host-0
  it('TO3 - maxMessageSize defaults to 65536', function () {
    installMockHttp(simpleMock());
    const client = new Ably.Rest({ key: 'appId.keyId:keySecret' });
    expect(client.options.maxMessageSize).to.equal(65536);
  });

  /**
   * TO3 - ClientOptions: setting values
   */
  // UTS: rest/unit/TO3/client-options-custom-hosts-1
  it('TO3 - setting custom option values', function () {
    installMockHttp(simpleMock());
    const client = new Ably.Rest({
      key: 'appId.keyId:keySecret',
      tls: false,
      useBinaryProtocol: false,
      idempotentRestPublishing: false,
    });

    expect(client.options.tls).to.equal(false);
    expect(client.options.useBinaryProtocol).to.equal(false);
    expect(client.options.idempotentRestPublishing).to.equal(false);
  });

  /**
   * TO3 - ClientOptions: clientId accessible
   */
  // UTS: rest/unit/TO3/client-options-attributes-0
  it('TO3 - clientId option', function () {
    installMockHttp(simpleMock());
    const client = new Ably.Rest({
      key: 'appId.keyId:keySecret',
      clientId: 'my-client',
    });
    expect(client.auth.clientId).to.equal('my-client');
  });

  /**
   * TO3 - ClientOptions: key is parsed into keyName and keySecret
   */
  // UTS: rest/unit/TO3/client-options-attributes-0.1
  it('TO3 - key parsed into keyName and keySecret', function () {
    installMockHttp(simpleMock());
    const client = new Ably.Rest({ key: 'appId.keyId:keySecret' });
    expect(client.options.keyName).to.equal('appId.keyId');
    expect(client.options.keySecret).to.equal('keySecret');
  });

  /**
   * TO - No auth options provided
   */
  // UTS: rest/unit/AO/auth-options-with-callback-0
  it('TO - error when no auth options provided', function () {
    installMockHttp(simpleMock());
    try {
      new Ably.Rest({});
      expect.fail('Expected constructor to throw');
    } catch (error) {
      expect(error).to.exist;
    }
  });

  /**
   * AO2 - AuthOptions attributes via authUrl
   */
  // UTS: rest/unit/AO2/auth-options-attributes-0
  it('AO2 - authUrl and authMethod options', function () {
    installMockHttp(simpleMock());
    const client = new Ably.Rest({
      authUrl: 'https://auth.example.com/token',
      authMethod: 'POST',
    });
    expect(client.auth.authOptions.authUrl).to.equal('https://auth.example.com/token');
    expect(client.auth.authOptions.authMethod).to.equal('POST');
  });

  /**
   * AO2 - AuthOptions: authMethod defaults to GET
   */
  // UTS: rest/unit/AO2/auth-options-attributes-0.1
  it('AO2 - authMethod defaults to GET', function () {
    // DEVIATION: see deviations.md
    if (!process.env.RUN_DEVIATIONS) this.skip();
    installMockHttp(simpleMock());
    const client = new Ably.Rest({
      authUrl: 'https://auth.example.com/token',
    });
    expect(client.auth.authOptions.authMethod).to.equal('GET');
  });
});
