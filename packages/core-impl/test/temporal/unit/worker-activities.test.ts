import { expect } from 'chai';
import msgpack from '@ably/msgpack-js';
import { ApplicationFailure } from '@temporalio/common';
import { restoreAll } from '../../uts/helpers';
import type { PendingRequest } from '../../uts/mock_http';
import { createActivities } from '../../../src/platform/temporal/src/worker/activities';
import { ActivityNames } from '../../../src/platform/temporal/src/common/activities';
import type { AblyActivities } from '../../../src/platform/temporal/src/common/activities';
import { ABLY_ERROR_TYPE } from '../../../src/platform/temporal/src/common/errors';
import type { AblyErrorDetails } from '../../../src/platform/temporal/src/common/errors';
import {
  activityEnvironment,
  expectedHeaders,
  expectedOperationMetadata,
  fromWire,
  jsonBody,
  mockAbly,
  queryParams,
  runActivity,
  toWire,
  workflowActivityInfo,
} from './worker-helpers';

async function expectAblyFailure(promise: Promise<unknown>): Promise<ApplicationFailure> {
  let caught: unknown;
  try {
    await promise;
  } catch (err) {
    caught = err;
  }
  expect(caught, 'expected the activity to fail').to.be.instanceOf(ApplicationFailure);
  const failure = caught as ApplicationFailure;
  expect(failure.type).to.equal(ABLY_ERROR_TYPE);
  return failure;
}

async function until(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100 && !condition(); attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  expect(condition(), 'timed out waiting for the condition').to.equal(true);
}

describe('temporal/worker/activities', function () {
  afterEach(function () {
    restoreAll();
  });

  describe('publish', function () {
    it('adds the Temporal metadata to the headers of every message, keeping message IDs', async function () {
      const { client, requests } = mockAbly((req) => req.respond_with(201, { serials: ['s0', 's1'] }));
      const activities = createActivities(client);

      const result = await runActivity(
        activityEnvironment(),
        activities[ActivityNames.publish],
        toWire({
          channel: 'chat:1',
          messages: [
            { id: 'base:0', name: 'status', data: { status: 'thinking' } },
            { id: 'base:1', name: 'text', data: 'hello', extras: { push: { notification: { title: 't' } } } },
          ],
        }),
      );

      expect(fromWire(result)).to.deep.equal({ serials: ['s0', 's1'] });
      expect(requests).to.have.length(1);
      expect(requests[0].method).to.equal('post');
      expect(requests[0].path).to.equal('/channels/chat%3A1/messages');
      const body = jsonBody(requests[0]);
      expect(body.map((m: any) => m.id)).to.deep.equal(['base:0', 'base:1']);
      expect(body[0].extras).to.deep.equal({ headers: expectedHeaders });
      expect(body[1].extras).to.deep.equal({ push: { notification: { title: 't' } }, headers: expectedHeaders });
    });

    it("keeps the application's own header values when keys collide", async function () {
      const { client, requests } = mockAbly((req) => req.respond_with(201, { serials: ['s0'] }));
      const activities = createActivities(client);

      await runActivity(
        activityEnvironment(),
        activities[ActivityNames.publish],
        toWire({
          channel: 'chat',
          messages: [{ name: 'e', extras: { headers: { temporalAttempt: 'mine', role: 'agent' } } }],
        }),
      );

      expect(jsonBody(requests[0])[0].extras.headers).to.deep.equal({
        ...expectedHeaders,
        temporalAttempt: 'mine',
        role: 'agent',
      });
    });

    it('leaves a message unchanged when its extras or headers are not an object', async function () {
      const { client, requests } = mockAbly((req) => req.respond_with(201, { serials: ['s0', 's1'] }));
      const activities = createActivities(client);

      await runActivity(
        activityEnvironment(),
        activities[ActivityNames.publish],
        toWire({
          channel: 'chat',
          messages: [
            { name: 'a', extras: { headers: ['not', 'an', 'object'] } },
            { name: 'b', extras: 'not an object' },
          ],
        }),
      );

      const body = jsonBody(requests[0]);
      expect(body[0].extras).to.deep.equal({ headers: ['not', 'an', 'object'] });
      expect(body[1].extras).to.equal('not an object');
    });

    it('does not add metadata when temporalMetadata is false', async function () {
      const { client, requests } = mockAbly((req) => req.respond_with(201, { serials: ['s0'] }));
      const activities = createActivities(client, { temporalMetadata: false });

      // Without metadata the activity does not read the activity context, so it can run outside one.
      await activities[ActivityNames.publish](toWire({ channel: 'chat', messages: [{ id: 'x:0', name: 'e' }] }));

      const [message] = jsonBody(requests[0]);
      expect(message).to.include({ id: 'x:0', name: 'e' });
      expect(message).to.not.have.property('extras');
    });

    it('does not mutate its input', async function () {
      const { client } = mockAbly((req) => req.respond_with(201, { serials: ['s0'] }));
      const activities = createActivities(client);
      const input = toWire({
        channel: 'chat',
        messages: [{ id: 'x:0', name: 'e', data: new Uint8Array([1, 2]), extras: { headers: { a: '1' } } }],
      });
      const snapshot = JSON.parse(JSON.stringify(input));

      await runActivity(activityEnvironment(), activities[ActivityNames.publish], input);

      expect(input).to.deep.equal(snapshot);
    });

    it('publishes binary data as binary', async function () {
      const { client, requests } = mockAbly((req) => req.respond_with(201, { serials: ['s0'] }));
      const activities = createActivities(client);

      await runActivity(
        activityEnvironment(),
        activities[ActivityNames.publish],
        toWire({ channel: 'chat', messages: [{ name: 'bytes', data: new Uint8Array([0, 1, 254, 255]) }] }),
      );

      const [message] = jsonBody(requests[0]);
      expect(message.encoding).to.equal('base64');
      expect(Buffer.from(message.data, 'base64')).to.deep.equal(Buffer.from([0, 1, 254, 255]));
    });

    it('records the metadata of a local activity in the same way', async function () {
      const { client, requests } = mockAbly((req) => req.respond_with(201, { serials: ['s0'] }));
      const activities = createActivities(client);

      await runActivity(
        activityEnvironment({ ...workflowActivityInfo, isLocal: true, attempt: 1 }),
        activities[ActivityNames.publish],
        toWire({ channel: 'chat', messages: [{ name: 'e' }] }),
      );

      expect(jsonBody(requests[0])[0].extras.headers).to.deep.equal({ ...expectedHeaders, temporalAttempt: 1 });
    });

    it('omits the workflow fields for an activity not started by a workflow', async function () {
      const { client, requests } = mockAbly((req) => req.respond_with(201, { serials: ['s0'] }));
      const activities = createActivities(client);

      await runActivity(
        activityEnvironment({
          namespace: 'agents',
          activityId: 'standalone-1',
          attempt: 2,
          inWorkflow: false,
          workflowType: undefined,
          workflowExecution: undefined,
        }),
        activities[ActivityNames.publish],
        toWire({ channel: 'chat', messages: [{ name: 'e' }] }),
      );

      expect(jsonBody(requests[0])[0].extras.headers).to.deep.equal({
        temporalNamespace: 'agents',
        temporalActivityId: 'standalone-1',
        temporalAttempt: 2,
      });
    });
  });

  describe('update, delete and append', function () {
    const cases = [
      { activity: ActivityNames.updateMessage, action: 1 },
      { activity: ActivityNames.deleteMessage, action: 2 },
      { activity: ActivityNames.appendMessage, action: 5 },
    ] as const;

    for (const { activity, action } of cases) {
      it(`${activity} adds the Temporal metadata to the operation metadata`, async function () {
        const { client, requests } = mockAbly((req) => req.respond_with(200, { versionSerial: 'v1' }));
        const activities = createActivities(client);

        const result = await runActivity(
          activityEnvironment(),
          activities[activity],
          toWire({
            channel: 'chat',
            message: { serial: 'serial-1', data: 'edited', extras: { headers: { a: '1' } } },
            operation: { description: 'edit', metadata: { temporalAttempt: 'mine', reason: 'typo' } },
          }),
        );

        expect(fromWire(result)).to.deep.equal({ versionSerial: 'v1' });
        expect(requests[0].method).to.equal('patch');
        expect(requests[0].path).to.equal('/channels/chat/messages/serial-1');
        const body = jsonBody(requests[0]);
        expect(body.action).to.equal(action);
        expect(body.extras).to.deep.equal({ headers: { a: '1' } });
        expect(body.version).to.deep.equal({
          description: 'edit',
          metadata: { ...expectedOperationMetadata, temporalAttempt: 'mine', reason: 'typo' },
        });
      });
    }

    it('creates the operation when none is given', async function () {
      const { client, requests } = mockAbly((req) => req.respond_with(200, { versionSerial: 'v1' }));
      const activities = createActivities(client);

      await runActivity(
        activityEnvironment(),
        activities[ActivityNames.updateMessage],
        toWire({ channel: 'chat', message: { serial: 'serial-1', data: 'edited' } }),
      );

      expect(jsonBody(requests[0]).version).to.deep.equal({ metadata: expectedOperationMetadata });
    });

    it('does not add operation metadata when temporalMetadata is false', async function () {
      const { client, requests } = mockAbly((req) => req.respond_with(200, { versionSerial: 'v1' }));
      const activities = createActivities(client, { temporalMetadata: false });

      await activities[ActivityNames.deleteMessage](
        toWire({ channel: 'chat', message: { serial: 'serial-1' }, operation: { description: 'gone' } }),
      );

      expect(jsonBody(requests[0]).version).to.deep.equal({ description: 'gone' });
    });
  });

  describe('batchPublish', function () {
    it('adds the Temporal metadata to every message of every spec', async function () {
      const { client, requests } = mockAbly((req) =>
        req.respond_with(201, [
          { successCount: 1, failureCount: 0, results: [] },
          { successCount: 1, failureCount: 0, results: [] },
        ]),
      );
      const activities = createActivities(client);

      const result = await runActivity(
        activityEnvironment(),
        activities[ActivityNames.batchPublish],
        toWire({
          specs: [
            {
              channels: ['a', 'b'],
              messages: [{ id: 'x:0', name: 'e', extras: { headers: { temporalAttempt: 'mine' } } }],
            },
            { channels: ['c'], messages: { id: 'y:0', name: 'f' } as any },
          ],
        }),
      );

      expect(fromWire(result)).to.have.length(2);
      expect(requests[0].path).to.equal('/messages');
      const body = jsonBody(requests[0]);
      expect(body[0].messages).to.deep.equal([
        { id: 'x:0', name: 'e', extras: { headers: { ...expectedHeaders, temporalAttempt: 'mine' } } },
      ]);
      expect(body[1].messages).to.deep.equal({ id: 'y:0', name: 'f', extras: { headers: expectedHeaders } });
    });

    it('returns a single result for a single spec', async function () {
      const batchResult = { successCount: 1, failureCount: 0, results: [{ channel: 'a', messageId: 'x:0' }] };
      const { client, requests } = mockAbly((req) => req.respond_with(201, [batchResult]));
      const activities = createActivities(client);

      const result = await runActivity(
        activityEnvironment(),
        activities[ActivityNames.batchPublish],
        toWire({ specs: { channels: ['a'], messages: [{ id: 'x:0', name: 'e' }] } }),
      );

      expect(fromWire(result)).to.deep.equal(batchResult);
      expect(jsonBody(requests[0])).to.deep.equal([
        { channels: ['a'], messages: [{ id: 'x:0', name: 'e', extras: { headers: expectedHeaders } }] },
      ]);
    });

    it('sends binary data as binary with the MessagePack protocol', async function () {
      const { client, requests } = mockAbly(
        (req) =>
          req._resolve!({
            error: null,
            body: msgpack.encode([{ successCount: 1, failureCount: 0, results: [] }]) as any,
            headers: {},
            unpacked: false,
            statusCode: 201,
          }),
        { useBinaryProtocol: true },
      );
      const activities = createActivities(client, { temporalMetadata: false });

      await activities[ActivityNames.batchPublish](
        toWire({ specs: [{ channels: ['a'], messages: [{ name: 'e', data: new Uint8Array([1, 2, 3]) }] }] }),
      );

      const [spec] = msgpack.decode(requests[0].body);
      expect(Buffer.isBuffer(spec.messages[0].data)).to.equal(true);
      expect(spec.messages[0].data).to.deep.equal(Buffer.from([1, 2, 3]));
    });
  });

  describe('paginated results', function () {
    const linkHeader = [
      '<./messages?limit=2&direction=backwards>; rel="first"',
      '<./messages?limit=2&direction=backwards>; rel="current"',
      '<./messages?limit=2&direction=backwards&cursor=abc%3A1>; rel="next"',
    ].join(', ');

    it('returns the items and the page links', async function () {
      const { client } = mockAbly((req) =>
        req.respond_with(200, [{ id: 'm1', name: 'e', data: 'one', timestamp: 1 }], { Link: linkHeader }),
      );
      const activities = createActivities(client);

      const page = fromWire(
        await runActivity(
          activityEnvironment(),
          activities[ActivityNames.history],
          toWire({ channel: 'chat', params: { limit: 2, direction: 'backwards' as const } }),
        ),
      );

      expect(page.items).to.have.length(1);
      expect(page.items[0]).to.include({ id: 'm1', name: 'e', data: 'one', timestamp: 1 });
      expect(page.links).to.deep.equal({
        first: { limit: '2', direction: 'backwards' },
        current: { limit: '2', direction: 'backwards' },
        next: { limit: '2', direction: 'backwards', cursor: 'abc:1' },
      });
    });

    it('omits links that the response does not include', async function () {
      const { client } = mockAbly((req) => req.respond_with(200, []));
      const activities = createActivities(client);

      const page = fromWire(
        await runActivity(activityEnvironment(), activities[ActivityNames.history], toWire({ channel: 'chat' })),
      );

      expect(page).to.deep.equal({ items: [], links: {} });
    });

    it('fetches the next page with links.next as PaginatedResult.next() does', async function () {
      const { client, requests } = mockAbly((req) => req.respond_with(200, [{ id: 'm1' }], { Link: linkHeader }));
      const activities = createActivities(client);
      const env = activityEnvironment();

      // The request that ably-js makes for the next page.
      const direct = await client.channels.get('chat').history({ limit: 2, direction: 'backwards' });
      await direct.next();
      const viaNext = requests[1];

      // The request that the activity makes when called with the links of the first page.
      const page = fromWire(
        await runActivity(
          env,
          activities[ActivityNames.history],
          toWire({ channel: 'chat', params: { limit: 2, direction: 'backwards' as const } }),
        ),
      );
      await runActivity(env, activities[ActivityNames.history], toWire({ channel: 'chat', params: page.links.next }));
      const viaActivity = requests[3];

      expect(viaActivity.method).to.equal(viaNext.method);
      expect(viaActivity.path).to.equal(viaNext.path);
      expect(queryParams(viaActivity)).to.deep.equal(queryParams(viaNext));
      expect(queryParams(viaActivity)).to.deep.equal({ limit: '2', direction: 'backwards', cursor: 'abc:1' });
    });

    it('returns binary data in history results as binary', async function () {
      const { client } = mockAbly((req) =>
        req.respond_with(200, [{ id: 'm1', data: Buffer.from([9, 8, 7]).toString('base64'), encoding: 'base64' }]),
      );
      const activities = createActivities(client);

      const page = fromWire(
        await runActivity(activityEnvironment(), activities[ActivityNames.history], toWire({ channel: 'chat' })),
      );

      expect(page.items[0].data).to.be.instanceOf(Uint8Array);
      expect(Array.from(page.items[0].data as Uint8Array)).to.deep.equal([9, 8, 7]);
    });

    const pagedActivities: {
      name: string;
      activity: keyof AblyActivities;
      input: Record<string, unknown>;
      path: string;
    }[] = [
      { name: 'presence.get', activity: ActivityNames.presenceGet, input: {}, path: '/channels/chat/presence' },
      {
        name: 'presence.history',
        activity: ActivityNames.presenceHistory,
        input: {},
        path: '/channels/chat/presence/history',
      },
      {
        name: 'annotations.get',
        activity: ActivityNames.annotationsGet,
        input: { messageOrSerial: 'serial-1' },
        path: '/channels/chat/messages/serial-1/annotations',
      },
      {
        name: 'getMessageVersions',
        activity: ActivityNames.getMessageVersions,
        input: { serialOrMessage: 'serial-1' },
        path: '/channels/chat/messages/serial-1/versions',
      },
    ];

    for (const { name, activity, input, path } of pagedActivities) {
      it(`${name} fetches the next page with links.next`, async function () {
        const { client, requests } = mockAbly((req) =>
          req.respond_with(200, [{ id: 'i1' }], { Link: '<./x?limit=1&cursor=c2>; rel="next"' }),
        );
        const activities = createActivities(client) as any;
        const env = activityEnvironment();

        const first = fromWire(
          await runActivity(env, activities[activity], toWire({ channel: 'chat', ...input, params: { limit: 1 } })),
        ) as any;
        expect(first.links).to.deep.equal({ next: { limit: '1', cursor: 'c2' } });

        await runActivity(env, activities[activity], toWire({ channel: 'chat', ...input, params: first.links.next }));

        expect(requests.map((req) => req.path)).to.deep.equal([path, path]);
        expect(requests[1].method).to.equal('get');
        expect(queryParams(requests[1])).to.deep.equal({ limit: '1', cursor: 'c2' });
      });
    }
  });

  describe('request', function () {
    it('returns the response fields and page links', async function () {
      const { client, requests } = mockAbly((req) =>
        req.respond_with(200, [{ a: 1 }], { Link: '<./messages?cursor=n>; rel="next"', 'x-custom': 'v' }),
      );
      const activities = createActivities(client);

      const response = fromWire(
        await runActivity(
          activityEnvironment(),
          activities[ActivityNames.request],
          toWire({ method: 'GET', path: '/channels/chat/messages', version: 3, params: { limit: '1' } }),
        ),
      );

      expect(requests[0].method).to.equal('get');
      expect(requests[0].path).to.equal('/channels/chat/messages');
      expect(queryParams(requests[0])).to.deep.equal({ limit: '1' });
      expect(response).to.deep.include({
        items: [{ a: 1 }],
        links: { next: { cursor: 'n' } },
        statusCode: 200,
        success: true,
      });
      expect(response.headers).to.include({ 'x-custom': 'v' });
    });

    it('fetches the next page with a GET and links.next as HttpPaginatedResponse.next() does', async function () {
      const { client, requests } = mockAbly((req) =>
        req.respond_with(200, [{ a: 1 }], { Link: '<./messages?limit=1&cursor=n>; rel="next"' }),
      );
      const activities = createActivities(client);
      const env = activityEnvironment();
      const headers = { 'x-app': 'agent' };

      // The request that ably-js makes for the next page.
      const direct = await client.request('POST', '/channels/chat/messages', 3, { limit: '1' }, { q: 1 }, headers);
      await direct.next();
      const viaNext = requests[1];

      // The request that the activity makes when called with the links of the first page.
      const first = fromWire(
        await runActivity(
          env,
          activities[ActivityNames.request],
          toWire({
            method: 'POST',
            path: '/channels/chat/messages',
            version: 3,
            params: { limit: '1' },
            body: { q: 1 },
            headers,
          }),
        ),
      );
      await runActivity(
        env,
        activities[ActivityNames.request],
        toWire({ method: 'GET', path: '/channels/chat/messages', version: 3, params: first.links.next, headers }),
      );
      const viaActivity = requests[3];

      expect(viaNext.method).to.equal('get');
      expect(viaActivity.method).to.equal('get');
      expect(viaActivity.path).to.equal(viaNext.path);
      expect(queryParams(viaActivity)).to.deep.equal(queryParams(viaNext));
      expect(queryParams(viaActivity)).to.deep.equal({ limit: '1', cursor: 'n' });
      expect(viaActivity.headers['x-app']).to.equal('agent');
      expect(viaActivity.headers['X-Ably-Version']).to.equal('3');
      expect(viaNext.headers['X-Ably-Version']).to.equal('3');
    });

    it('returns an Ably error response without failing', async function () {
      const { client } = mockAbly((req) =>
        req.respond_with(404, { error: { message: 'Channel not found', code: 40400, statusCode: 404 } }),
      );
      const activities = createActivities(client);

      const response = fromWire(
        await runActivity(
          activityEnvironment(),
          activities[ActivityNames.request],
          toWire({ method: 'GET', path: '/nowhere', version: 3 }),
        ),
      );

      expect(response).to.deep.include({
        statusCode: 404,
        success: false,
        errorCode: 40400,
        errorMessage: 'Channel not found',
      });
    });

    it('sends a binary body as binary with the MessagePack protocol', async function () {
      const { client, requests } = mockAbly(
        (req) =>
          req._resolve!({
            error: null,
            body: msgpack.encode([]) as any,
            headers: {},
            unpacked: false,
            statusCode: 201,
          }),
        { useBinaryProtocol: true },
      );
      const activities = createActivities(client);

      await runActivity(
        activityEnvironment(),
        activities[ActivityNames.request],
        toWire({ method: 'POST', path: '/custom', version: 3, body: { bytes: new Uint8Array([4, 5]) } }),
      );

      expect(msgpack.decode(requests[0].body)).to.deep.equal({ bytes: Buffer.from([4, 5]) });
    });
  });

  describe('pass-through operations', function () {
    it('time', async function () {
      const { client } = mockAbly((req) => req.respond_with(200, [1700000000000]));
      const activities = createActivities(client);

      expect(fromWire(await runActivity(activityEnvironment(), activities[ActivityNames.time]))).to.equal(
        1700000000000,
      );
    });

    it('status', async function () {
      const details = { channelId: 'chat', status: { isActive: true, occupancy: { metrics: { connections: 1 } } } };
      const { client, requests } = mockAbly((req) => req.respond_with(200, details));
      const activities = createActivities(client);

      const result = await runActivity(
        activityEnvironment(),
        activities[ActivityNames.status],
        toWire({ channel: 'chat' }),
      );

      expect(requests[0].path).to.equal('/channels/chat');
      expect(fromWire(result)).to.deep.equal(details);
    });

    it('getMessage', async function () {
      const { client, requests } = mockAbly((req) =>
        req.respond_with(200, { serial: 'serial-1', name: 'e', data: 'd' }),
      );
      const activities = createActivities(client);

      const result = await runActivity(
        activityEnvironment(),
        activities[ActivityNames.getMessage],
        toWire({ channel: 'chat', serialOrMessage: 'serial-1' }),
      );

      expect(requests[0].path).to.equal('/channels/chat/messages/serial-1');
      expect(fromWire(result)).to.include({ serial: 'serial-1', name: 'e', data: 'd' });
    });

    it('annotations.publish and annotations.delete', async function () {
      const { client, requests } = mockAbly((req) => req.respond_with(201, {}));
      const activities = createActivities(client);
      const env = activityEnvironment();
      const input = toWire({
        channel: 'chat',
        messageOrSerial: 'serial-1',
        annotation: { type: 'reaction:unique.v1' },
      });

      expect(await runActivity(env, activities[ActivityNames.annotationsPublish], input)).to.equal(undefined);
      await runActivity(env, activities[ActivityNames.annotationsDelete], input);

      expect(requests.map((req) => req.path)).to.deep.equal([
        '/channels/chat/messages/serial-1/annotations',
        '/channels/chat/messages/serial-1/annotations',
      ]);
      expect(jsonBody(requests[0])[0]).to.include({ action: 0, type: 'reaction:unique.v1' });
      expect(jsonBody(requests[1])[0]).to.include({ action: 1, type: 'reaction:unique.v1' });
    });

    it('batchPresence', async function () {
      const batchResult = [{ successCount: 1, failureCount: 0, results: [{ channel: 'a', presence: [] }] }];
      const { client, requests } = mockAbly((req) => req.respond_with(200, batchResult));
      const activities = createActivities(client);

      const result = await runActivity(
        activityEnvironment(),
        activities[ActivityNames.batchPresence],
        toWire({ channels: ['a', 'b'] }),
      );

      expect(requests[0].path).to.equal('/presence');
      expect(queryParams(requests[0])).to.deep.equal({ channels: 'a,b' });
      expect(fromWire(result)).to.deep.equal(batchResult);
    });

    it('object.get and object.publish', async function () {
      const { client, requests } = mockAbly(
        (req) =>
          req.method === 'get'
            ? req.respond_with(200, { votes: { up: 1 } })
            : req.respond_with(200, { messageId: 'm', channel: 'chat', objectIds: ['counter:1'] }),
        { liveObjects: true },
      );
      const activities = createActivities(client);
      const env = activityEnvironment();

      const value = await runActivity(env, activities[ActivityNames.objectGet], toWire({ channel: 'chat' }));
      const published = await runActivity(
        env,
        activities[ActivityNames.objectPublish],
        toWire({ channel: 'chat', operations: { path: 'votes.up', counterInc: { number: 1 } } }),
      );

      expect(fromWire(value)).to.deep.equal({ votes: { up: 1 } });
      expect(fromWire(published)).to.deep.equal({ messageId: 'm', channel: 'chat', objectIds: ['counter:1'] });
      expect(requests.map((req) => `${req.method} ${req.path}`)).to.deep.equal([
        'get /channels/chat/object',
        'post /channels/chat/object',
      ]);
    });
  });

  describe('channels', function () {
    const publishInput = (channel: string) => toWire({ channel, messages: [{ name: 'e', data: 'd' }] });

    it('releases a channel that the activities added once the activity settles', async function () {
      const { client } = mockAbly((req) => req.respond_with(201, { serials: ['s'] }));
      const activities = createActivities(client);

      await runActivity(activityEnvironment(), activities[ActivityNames.publish], publishInput('chat:1'));

      expect(Object.keys(client.channels.all)).to.deep.equal([]);
    });

    it('releases the channel after an activity fails', async function () {
      const { client } = mockAbly((req) => req.respond_with(400, { error: { message: 'Bad', code: 40000 } }));
      const activities = createActivities(client);

      await expectAblyFailure(
        runActivity(activityEnvironment(), activities[ActivityNames.publish], publishInput('chat:1')),
      );

      expect(Object.keys(client.channels.all)).to.deep.equal([]);
    });

    it('keeps a channel until every activity using it has settled', async function () {
      const pending: PendingRequest[] = [];
      const { client } = mockAbly((req) => pending.push(req));
      const activities = createActivities(client);
      const env = activityEnvironment();

      const first = runActivity(env, activities[ActivityNames.publish], publishInput('chat:1'));
      const second = runActivity(env, activities[ActivityNames.publish], publishInput('chat:1'));
      await until(() => pending.length === 2);
      const channel = client.channels.all['chat:1'];
      expect(channel).to.not.equal(undefined);

      pending[0].respond_with(201, { serials: ['s0'] });
      await first;
      expect(client.channels.all['chat:1']).to.equal(channel);

      pending[1].respond_with(201, { serials: ['s1'] });
      await second;
      expect(Object.keys(client.channels.all)).to.deep.equal([]);
    });

    it('never releases a channel that the application got from the client', async function () {
      const { client } = mockAbly((req) => req.respond_with(201, { serials: ['s'] }));
      const own = client.channels.get('chat:1');
      const activities = createActivities(client);

      await runActivity(activityEnvironment(), activities[ActivityNames.publish], publishInput('chat:1'));

      expect(client.channels.all['chat:1']).to.equal(own);
    });
  });

  describe('push admin', function () {
    const device = {
      id: 'device-1',
      platform: 'ios',
      formFactor: 'phone',
      push: { recipient: { transportType: 'apns' } },
    };
    const subscription = { channel: 'news', clientId: 'user-1' };

    function respond(req: PendingRequest): void {
      if (req.path === '/push/apnsBroadcastChannels') {
        req.respond_with(201, { id: 'b1', apnsChannelId: 'apns-1' });
      } else if (req.method === 'delete') {
        req.respond_with(204, null);
      } else if (req.path === '/push/deviceRegistrations') {
        req.respond_with(200, [device]);
      } else if (req.path.startsWith('/push/deviceRegistrations/')) {
        req.respond_with(200, device);
      } else if (req.path === '/push/channelSubscriptions') {
        req.respond_with(req.method === 'post' ? 201 : 200, req.method === 'post' ? subscription : [subscription]);
      } else if (req.path === '/push/channels') {
        req.respond_with(200, ['news']);
      } else {
        req.respond_with(201, {});
      }
    }

    it('runs each push admin operation with the client', async function () {
      const { client, requests } = mockAbly(respond);
      const activities = createActivities(client);
      const env = activityEnvironment();
      const run = (name: keyof AblyActivities, input: unknown): Promise<any> =>
        runActivity(env, activities[name] as (input: unknown) => Promise<unknown>, toWire(input)).then((result) =>
          result === undefined ? result : fromWire(result),
        );

      expect(
        await run(ActivityNames.pushPublish, {
          recipient: { clientId: 'user-1' },
          payload: { notification: { title: 'Hi' } },
        }),
      ).to.equal(undefined);
      expect(await run(ActivityNames.pushCreateApnsBroadcast, { argument: { messageStoragePolicy: 1 } })).to.deep.equal(
        { id: 'b1', apnsChannelId: 'apns-1' },
      );
      await run(ActivityNames.pushLiveActivityStart, {
        argument: { recipient: { deviceId: 'device-1' }, apnsBroadcast: 'b1', apns: { aps: {} } },
      });
      await run(ActivityNames.pushLiveActivityUpdate, { argument: { apnsBroadcast: 'b1', apns: { aps: {} } } });
      await run(ActivityNames.pushLiveActivityEnd, { argument: { apnsBroadcast: 'b1', apns: { aps: {} } } });
      expect(await run(ActivityNames.pushDeviceRegistrationsSave, { argument: device })).to.include({ id: 'device-1' });
      expect(await run(ActivityNames.pushDeviceRegistrationsGet, { argument: 'device-1' })).to.include({
        id: 'device-1',
      });
      const devices = await run(ActivityNames.pushDeviceRegistrationsList, { params: { clientId: 'user-1' } });
      expect(devices.items[0]).to.include({ id: 'device-1' });
      expect(devices.links).to.deep.equal({});
      await run(ActivityNames.pushDeviceRegistrationsRemove, { argument: 'device-1' });
      await run(ActivityNames.pushDeviceRegistrationsRemoveWhere, { argument: { clientId: 'user-1' } });
      expect(await run(ActivityNames.pushChannelSubscriptionsSave, { argument: subscription })).to.deep.equal(
        subscription,
      );
      const subscriptions = await run(ActivityNames.pushChannelSubscriptionsList, { params: { channel: 'news' } });
      expect(subscriptions.items).to.deep.equal([subscription]);
      const channels = await run(ActivityNames.pushChannelSubscriptionsListChannels, {});
      expect(channels.items).to.deep.equal(['news']);
      await run(ActivityNames.pushChannelSubscriptionsRemove, { argument: subscription });
      await run(ActivityNames.pushChannelSubscriptionsRemoveWhere, { argument: { clientId: 'user-1' } });

      expect(requests.map((req) => `${req.method} ${req.path}`)).to.deep.equal([
        'post /push/publish',
        'post /push/apnsBroadcastChannels',
        'post /push/apnsBroadcastChannels/b1/start',
        'post /push/apnsBroadcastChannels/b1/broadcast',
        'post /push/apnsBroadcastChannels/b1/end',
        'put /push/deviceRegistrations/device-1',
        'get /push/deviceRegistrations/device-1',
        'get /push/deviceRegistrations',
        'delete /push/deviceRegistrations/device-1',
        'delete /push/deviceRegistrations',
        'post /push/channelSubscriptions',
        'get /push/channelSubscriptions',
        'get /push/channels',
        'delete /push/channelSubscriptions',
        'delete /push/channelSubscriptions',
      ]);
      expect(jsonBody(requests[0])).to.deep.equal({ recipient: { clientId: 'user-1' }, notification: { title: 'Hi' } });
      expect(jsonBody(requests[2])).to.deep.equal({ apns: { aps: {} }, deviceId: 'device-1' });
      expect(queryParams(requests[7])).to.include({ clientId: 'user-1' });
      expect(queryParams(requests[13])).to.include(subscription);
    });

    it('fails non-retryably when ably-js rejects the arguments', async function () {
      const { client, requests } = mockAbly(respond);
      const activities = createActivities(client);

      const failure = await expectAblyFailure(
        runActivity(
          activityEnvironment(),
          activities[ActivityNames.pushLiveActivityStart],
          toWire({ argument: { recipient: {}, apnsBroadcast: 'b1', apns: {} } as any }),
        ),
      );

      expect(failure.nonRetryable).to.equal(true);
      expect((failure.details?.[0] as AblyErrorDetails).code).to.equal(40000);
      expect(requests).to.have.length(0);
    });
  });

  describe('errors', function () {
    it('fails non-retryably with the Ably error details for a 4xx response', async function () {
      const error = { message: 'Unable to publish', code: 40160, statusCode: 401 };
      const { client } = mockAbly((req) => req.respond_with(401, { error }));
      const activities = createActivities(client);

      const failure = await expectAblyFailure(
        runActivity(
          activityEnvironment(),
          activities[ActivityNames.publish],
          toWire({ channel: 'chat', messages: [{ name: 'e' }] }),
        ),
      );

      expect(failure.nonRetryable).to.equal(true);
      expect(failure.message).to.equal('Unable to publish');
      expect(failure.details).to.deep.equal([error satisfies AblyErrorDetails]);
    });

    for (const statusCode of [500, 503, 408, 429]) {
      it(`fails retryably for a ${statusCode} response`, async function () {
        const { client } = mockAbly((req) =>
          req.respond_with(statusCode, { error: { message: 'Try again', code: statusCode * 100, statusCode } }),
        );
        const activities = createActivities(client);

        const failure = await expectAblyFailure(
          runActivity(activityEnvironment(), activities[ActivityNames.history], toWire({ channel: 'chat' })),
        );

        expect(failure.nonRetryable).to.equal(false);
        expect(failure.details?.[0]).to.include({ code: statusCode * 100, statusCode });
      });
    }

    it('rethrows an error that is not an Ably error unchanged', async function () {
      const { client } = mockAbly(() => undefined, { refuseConnections: true });
      const activities = createActivities(client);

      let caught: any;
      try {
        await runActivity(activityEnvironment(), activities[ActivityNames.time]);
      } catch (err) {
        caught = err;
      }

      expect(caught).to.not.be.instanceOf(ApplicationFailure);
      expect(caught.code).to.equal('ECONNREFUSED');
    });

    it('fails non-retryably when the LiveObjects plugin is missing', async function () {
      const { client, requests } = mockAbly((req) => req.respond_with(200, {}));
      const activities = createActivities(client);

      for (const [activity, input] of [
        [activities[ActivityNames.objectGet], toWire({ channel: 'chat' })],
        [activities[ActivityNames.objectPublish], toWire({ channel: 'chat', operations: [] })],
      ] as const) {
        const failure = await expectAblyFailure(runActivity(activityEnvironment(), activity as any, input));
        expect(failure.nonRetryable).to.equal(true);
        expect(failure.details?.[0]).to.include({ code: 40019, statusCode: 400 });
        expect((failure.details?.[0] as AblyErrorDetails).remediation).to.match(/"\/liveobjects" entry point/);
      }
      expect(requests).to.have.length(0);
    });
  });
});
