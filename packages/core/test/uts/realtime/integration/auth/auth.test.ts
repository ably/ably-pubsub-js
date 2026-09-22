/**
 * UTS Integration: Realtime Auth Tests
 *
 * Spec points: RTC8a, RTC8c, RSA8, RSA7
 * Source: uts/realtime/integration/auth.md
 */

import { expect } from 'chai';
import {
  Ably,
  SANDBOX_ENDPOINT,
  setupSandbox,
  teardownSandbox,
  getApiKey,
  getKeyParts,
  trackClient,
  connectAndWait,
  closeAndWait,
  generateJWT,
  uniqueChannelName,
} from '../sandbox';

describe('uts/realtime/integration/auth/auth', function () {
  this.timeout(30000);

  before(async function () {
    await setupSandbox();
  });

  after(async function () {
    await teardownSandbox();
  });

  /**
   * RSA8 - Token auth on realtime connection
   */
  // UTS: realtime/integration/RSA8/token-auth-connect-0
  it('RSA8 - JWT token auth connects successfully', async function () {
    const { keyName, keySecret } = getKeyParts(getApiKey());

    const client = new Ably.Realtime({
      authCallback: (_params: any, cb: any) => {
        cb(null, generateJWT({ keyName, keySecret, ttl: 3600000 }));
      },
      endpoint: SANDBOX_ENDPOINT,
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    await connectAndWait(client);

    expect(client.connection.state).to.equal('connected');
    expect(client.connection.id).to.not.be.null;
    expect(client.connection.errorReason).to.be.null;

    await closeAndWait(client);
  });

  /**
   * RTC8a - In-band reauthorization on CONNECTED client
   */
  // UTS: realtime/integration/RTC8a/in-band-reauth-connected-0
  it('RTC8a - authorize on connected client does not disconnect', async function () {
    const { keyName, keySecret } = getKeyParts(getApiKey());

    const client = new Ably.Realtime({
      authCallback: (_params: any, cb: any) => {
        cb(null, generateJWT({ keyName, keySecret, ttl: 3600000 }));
      },
      endpoint: SANDBOX_ENDPOINT,
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    await connectAndWait(client);
    const connectionIdBefore = client.connection.id;

    const stateChanges: any[] = [];
    client.connection.on((change: any) => stateChanges.push(change));

    const token = await client.auth.authorize();

    expect(token).to.not.be.null;
    expect(client.connection.state).to.equal('connected');
    expect(client.connection.id).to.equal(connectionIdBefore);

    const stateTransitions = stateChanges.filter((c: any) => c.current !== c.previous);
    expect(stateTransitions).to.have.length(0);

    await closeAndWait(client);
  });

  /**
   * RTC8c - authorize() from INITIALIZED initiates connection
   */
  // UTS: realtime/integration/RTC8c/authorize-initiates-connection-0
  it('RTC8c - authorize from initialized state initiates connection', async function () {
    const { keyName, keySecret } = getKeyParts(getApiKey());

    const client = new Ably.Realtime({
      authCallback: (_params: any, cb: any) => {
        cb(null, generateJWT({ keyName, keySecret, ttl: 3600000 }));
      },
      endpoint: SANDBOX_ENDPOINT,
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    expect(client.connection.state).to.equal('initialized');

    const token = await client.auth.authorize();

    expect(token).to.not.be.null;
    expect(client.connection.state).to.equal('connected');
    expect(client.connection.id).to.not.be.null;

    await closeAndWait(client);
  });

  /**
   * RSA7 - Matching clientId succeeds
   */
  // UTS: realtime/integration/RSA7/matching-clientid-succeeds-0
  it('RSA7 - matching clientId in JWT and options succeeds', async function () {
    const { keyName, keySecret } = getKeyParts(getApiKey());
    const testClientId = `test-client-${Math.random().toString(36).substring(2, 8)}`;

    const client = new Ably.Realtime({
      authCallback: (_params: any, cb: any) => {
        cb(null, generateJWT({ keyName, keySecret, clientId: testClientId, ttl: 3600000 }));
      },
      clientId: testClientId,
      endpoint: SANDBOX_ENDPOINT,
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    await connectAndWait(client);

    expect(client.connection.state).to.equal('connected');
    expect(client.auth.clientId).to.equal(testClientId);

    await closeAndWait(client);
  });

  /**
   * RSA7 - Mismatched clientId in JWT and options fails
   *
   * When the clientId in the JWT token differs from the clientId in
   * ClientOptions, the server rejects the connection.
   */
  // UTS: realtime/integration/RSA7/mismatched-clientid-fails-1
  it('RSA7 - mismatched clientId fails', async function () {
    const { keyName, keySecret } = getKeyParts(getApiKey());

    const client = new Ably.Realtime({
      authCallback: (_params: any, cb: any) => {
        cb(null, generateJWT({ keyName, keySecret, clientId: 'token-client-id', ttl: 3600000 }));
      },
      clientId: 'wrong-client-id',
      endpoint: SANDBOX_ENDPOINT,
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    try {
      await connectAndWait(client);
      expect.fail('Expected connection to fail');
    } catch (error: any) {
      expect(error.message).to.include('failed');
    }

    expect(client.connection.state).to.equal('failed');
    expect(client.connection.errorReason).to.not.be.null;
    expect(client.connection.errorReason!.code).to.equal(40102);

    try {
      await closeAndWait(client);
    } catch (e) {
      /* ok — already failed */
    }
  });
});
