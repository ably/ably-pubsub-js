import { expect } from 'chai';
import type { WorkerOptions } from '@temporalio/worker';
import { restoreAll } from '../../uts/helpers';
import * as WorkerEntryPoint from '../../../src/platform/temporal/src/index';
import { AblyHttpPlugin } from '../../../src/platform/temporal/src/worker/plugin';
import { ActivityNames } from '../../../src/platform/temporal/src/common/activities';
import { activityEnvironment, jsonBody, mockAbly, runActivity, toWire } from './worker-helpers';

// createHttpClient and createRealtimeClient from the built `@ably/pubsub-server` package, as an application would
// import them.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const BuiltServer = require('@ably/pubsub-server');

function configuredActivities(plugin: AblyHttpPlugin, activities: object = {}): Record<string, any> {
  const options = plugin.configureWorker({ taskQueue: 'test', activities } as WorkerOptions);
  return options.activities as Record<string, any>;
}

describe('temporal/worker/plugin', function () {
  afterEach(function () {
    restoreAll();
  });

  it('is named AblyHttpPlugin', function () {
    const { client } = mockAbly((req) => req.respond_with(200, {}));
    expect(new AblyHttpPlugin({ client }).name).to.equal('AblyHttpPlugin');
  });

  it('registers every Ably activity alongside the application activities', function () {
    const { client } = mockAbly((req) => req.respond_with(200, {}));
    const myActivity = async () => 'mine';

    const activities = configuredActivities(new AblyHttpPlugin({ client }), { myActivity });

    expect(Object.keys(activities).sort()).to.deep.equal([...Object.values(ActivityNames), 'myActivity'].sort());
    expect(activities.myActivity).to.equal(myActivity);
    for (const name of Object.values(ActivityNames)) {
      expect(name.startsWith('ably.'), name).to.equal(true);
      expect(activities[name], name).to.be.a('function');
    }
  });

  it('uses the client it is given', async function () {
    const { client, requests } = mockAbly((req) => req.respond_with(201, { serials: ['s0'] }));
    const plugin = new AblyHttpPlugin({ client });

    await runActivity(
      activityEnvironment(),
      configuredActivities(plugin)[ActivityNames.publish],
      toWire({ channel: 'chat', messages: [{ name: 'e' }] }),
    );

    expect(plugin.client).to.equal(client);
    const [message] = jsonBody(requests[0]);
    expect(message).to.include({ name: 'e' });
    expect(message).to.not.have.property('extras');
  });

  it('accepts a client from the built @ably/pubsub-server package', function () {
    const client = BuiltServer.createHttpClient({ key: 'appId.keyId:keySecret' });

    expect(new AblyHttpPlugin({ client }).client).to.equal(client);
  });

  it('rejects options without a client', function () {
    const message = /do not include a PubSubHttpClient in `client`/;
    expect(() => new (AblyHttpPlugin as any)()).to.throw(TypeError, message);
    expect(() => new AblyHttpPlugin({} as any)).to.throw(TypeError, message);
    expect(() => new AblyHttpPlugin({ ably: { key: 'appId.keyId:keySecret' } } as any)).to.throw(TypeError, message);
    expect(() => new AblyHttpPlugin({ client: { key: 'appId.keyId:keySecret' } } as any)).to.throw(TypeError, message);
  });

  it('rejects a realtime client', function () {
    const client = BuiltServer.createRealtimeClient({ key: 'appId.keyId:keySecret', autoConnect: false });
    try {
      expect(() => new AblyHttpPlugin({ client })).to.throw(TypeError, /do not include a PubSubHttpClient in `client`/);
    } finally {
      client.close();
    }
  });

  it('exports the worker API from the entry point', function () {
    expect(Object.keys(WorkerEntryPoint).sort()).to.deep.equal(
      ['ABLY_ERROR_TYPE', 'AblyHttpPlugin', 'ActivityNames', 'createActivities', 'getAblyErrorDetails'].sort(),
    );
  });
});
