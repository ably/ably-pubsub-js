import * as http from 'http';
import type { AddressInfo } from 'net';
import { expect } from 'chai';
import type { WorkerOptions } from '@temporalio/worker';
import * as WorkerEntryPoint from '../../../src/platform/temporal/src/index';
import { AblyHttpPlugin } from '../../../src/platform/temporal/src/worker/plugin';
import { ActivityNames } from '../../../src/platform/temporal/src/common/activities';
import { activityEnvironment, runActivity, toWire } from './worker-helpers';

const KEY = 'appId.keyId:keySecret';

function configuredActivities(plugin: AblyHttpPlugin, activities: object = {}): Record<string, any> {
  const options = plugin.configureWorker({ taskQueue: 'test', activities } as WorkerOptions);
  return options.activities as Record<string, any>;
}

interface ReceivedRequest {
  method?: string;
  url?: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}

describe('temporal/worker/plugin', function () {
  // The plugin creates its client with the built `@ably/pubsub-server`, which the UTS mock HTTP client does not
  // reach, so these tests serve the Ably REST API from a local HTTP server.
  let server: http.Server;
  let port: number;
  const received: ReceivedRequest[] = [];

  before(async function () {
    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        received.push({ method: req.method, url: req.url, headers: req.headers, body });
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ serials: ['s0'] }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  });

  after(async function () {
    await new Promise((resolve) => server.close(resolve));
  });

  beforeEach(function () {
    received.length = 0;
  });

  function plugin(): AblyHttpPlugin {
    return new AblyHttpPlugin({
      clientOptions: { key: KEY, endpoint: 'localhost', port, tls: false, useBinaryProtocol: false },
    });
  }

  it('is named AblyHttpPlugin', function () {
    expect(plugin().name).to.equal('AblyHttpPlugin');
  });

  it('registers every Ably activity alongside the application activities', function () {
    const myActivity = async () => 'mine';

    const activities = configuredActivities(plugin(), { myActivity });

    expect(Object.keys(activities).sort()).to.deep.equal([...Object.values(ActivityNames), 'myActivity'].sort());
    expect(activities.myActivity).to.equal(myActivity);
    for (const name of Object.values(ActivityNames)) {
      expect(name.startsWith('ably.'), name).to.equal(true);
      expect(activities[name], name).to.be.a('function');
    }
  });

  it('creates its own client from clientOptions', async function () {
    const result = await runActivity(
      activityEnvironment(),
      configuredActivities(plugin())[ActivityNames.publish],
      toWire({ channel: 'chat', messages: [{ name: 'e', data: 'AQID', encoding: 'base64' }] }),
    );

    expect(result).to.deep.equal({ serials: ['s0'] });
    expect(received).to.have.length(1);
    expect(received[0].method).to.equal('POST');
    expect(received[0].url).to.match(/^\/channels\/chat\/messages(\?|$)/);
    expect(received[0].headers.authorization).to.equal(`Basic ${Buffer.from(KEY).toString('base64')}`);
    const [message] = JSON.parse(received[0].body);
    expect(message).to.include({ name: 'e', data: 'AQID', encoding: 'base64' });
    expect(message).to.not.have.property('extras');
  });

  it('does not expose its client', function () {
    expect(plugin()).to.not.have.property('client');
  });

  it('rejects options without a ClientOptions object', function () {
    const message = /do not include the Ably ClientOptions object in `clientOptions`/;
    expect(() => new (AblyHttpPlugin as any)()).to.throw(TypeError, message);
    expect(() => new AblyHttpPlugin({} as any)).to.throw(TypeError, message);
    expect(() => new AblyHttpPlugin({ client: { key: KEY } } as any)).to.throw(TypeError, message);
    expect(() => new AblyHttpPlugin({ clientOptions: KEY } as any)).to.throw(TypeError, message);
    expect(() => new AblyHttpPlugin({ clientOptions: null } as any)).to.throw(TypeError, message);
    expect(() => new AblyHttpPlugin({ clientOptions: [KEY] } as any)).to.throw(TypeError, message);
  });

  it('exports the worker API from the entry point', function () {
    expect(Object.keys(WorkerEntryPoint).sort()).to.deep.equal(
      ['ABLY_ERROR_TYPE', 'AblyHttpPlugin', 'ActivityNames', 'createActivities', 'getAblyErrorDetails'].sort(),
    );
  });
});
