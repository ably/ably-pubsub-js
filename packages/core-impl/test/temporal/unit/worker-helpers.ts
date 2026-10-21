/**
 * Helpers for the worker-side unit tests: an HTTP client built from source with mocked HTTP, an activity environment
 * with a controlled `Info`, and the payload round trip that values take across the activity boundary.
 */

import type * as AblyTypes from '@ably/pubsub-server';
import type { Info } from '@temporalio/activity';
import { MockActivityEnvironment } from '@temporalio/testing';
import { DefaultLogger } from '@temporalio/worker';
import { MockHttpClient, PendingRequest } from '../../uts/mock_http';
import { Ably, installMockHttp } from '../../uts/helpers';
import * as LiveObjectsPlugin from '../../../src/plugins/liveobjects';
import { decodeFromWire, encodeForWire } from '../../../src/platform/temporal/src/common/wire';

/** The `Info` of an activity scheduled by a workflow, as the worker would populate it. */
export const workflowActivityInfo: Partial<Info> = {
  namespace: 'agents',
  activityId: '7',
  activityType: 'ably.channel.publish',
  attempt: 3,
  isLocal: false,
  inWorkflow: true,
  workflowType: 'agentWorkflow',
  workflowExecution: { workflowId: 'chat-123', runId: 'run-456' },
};

/** The headers that the activities add for {@link workflowActivityInfo}. */
export const expectedHeaders = {
  temporalNamespace: 'agents',
  temporalWorkflowId: 'chat-123',
  temporalRunId: 'run-456',
};

/** The operation metadata that the activities add for {@link workflowActivityInfo}. */
export const expectedOperationMetadata = {
  temporalNamespace: 'agents',
  temporalWorkflowId: 'chat-123',
  temporalRunId: 'run-456',
};

/** An activity environment whose context has the given `Info`, and which does not log activity failures. */
export function activityEnvironment(info: Partial<Info> = workflowActivityInfo): MockActivityEnvironment {
  return new MockActivityEnvironment(info, { logger: new DefaultLogger('ERROR') });
}

/** Runs an activity in `env`, as the worker would. */
export function runActivity<A extends unknown[], R>(
  env: MockActivityEnvironment,
  activity: (...args: A) => Promise<R>,
  ...args: A
): Promise<R> {
  return env.run(activity as (...args: unknown[]) => Promise<R>, ...args) as Promise<R>;
}

/** Encodes a value as the workflow does, and serialises it as Temporal's default JSON payload converter does. */
export function toWire<T>(value: T): T {
  return JSON.parse(JSON.stringify(encodeForWire(value)));
}

/** Serialises an activity result as Temporal's default JSON payload converter does, and decodes it as the workflow does. */
export function fromWire<T>(value: T): T {
  return decodeFromWire(JSON.parse(JSON.stringify(value))) as T;
}

export interface MockAbly {
  client: AblyTypes.PubSubHttpClient;
  requests: PendingRequest[];
}

/**
 * Installs a mock HTTP client that passes every request to `handler`, and returns an HTTP client built from source
 * that uses it. Call `restoreAll()` from the UTS helpers in `afterEach`.
 */
export function mockAbly(
  handler: (req: PendingRequest) => void,
  options: { liveObjects?: boolean; useBinaryProtocol?: boolean; refuseConnections?: boolean } = {},
): MockAbly {
  const requests: PendingRequest[] = [];
  installMockHttp(
    new MockHttpClient({
      onConnectionAttempt: (conn) =>
        options.refuseConnections ? conn.respond_with_refused() : conn.respond_with_success(),
      onRequest: (req) => {
        requests.push(req);
        handler(req);
      },
    }),
  );
  const client = new Ably.Http({
    key: 'appId.keyId:keySecret',
    logLevel: 0,
    useBinaryProtocol: options.useBinaryProtocol ?? false,
    ...(options.liveObjects ? { plugins: { LiveObjects: LiveObjectsPlugin } } : {}),
  });
  return { client: client as unknown as AblyTypes.PubSubHttpClient, requests };
}

/** The JSON request body of a captured request. */
export function jsonBody(req: PendingRequest): any {
  return JSON.parse(req.body);
}

/** The query parameters of a captured request. */
export function queryParams(req: PendingRequest): Record<string, string> {
  return Object.fromEntries(req.url.searchParams.entries());
}
