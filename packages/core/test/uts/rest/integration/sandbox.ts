/**
 * Sandbox app provisioning for REST UTS integration tests.
 *
 * Re-exports the shared sandbox infrastructure from realtime/integration/sandbox.ts,
 * plus REST-specific helpers.
 */

export {
  Ably,
  SANDBOX_ENDPOINT,
  setupSandbox,
  teardownSandbox,
  getSandboxApp,
  getApiKey,
  getKeyParts,
  trackClient,
  closeAndWait,
  connectAndWait,
  uniqueChannelName,
  generateJWT,
  pollUntil,
  pollUntilSuccess,
} from '../../realtime/integration/sandbox';

import { getSandboxApp } from '../../realtime/integration/sandbox';

function getAppId(): string {
  return getSandboxApp().appId;
}

export { getAppId };
