'use strict';

/**
 * Asserts the side-declaring agent entry that each per-side Pub/Sub package factory stamps
 * (packages/shared/side.ts), as observed on the wire: the `Ably-Agent` request header is what
 * the realtime system classifies on for MAU billing, so these tests fail loudly if a factory
 * stops stamping its side, stamps the wrong identifier, loses the `-server` suffix that
 * grants the server exemption on API-key auth, or regresses the flag's versionless form
 * (the side entry is a bare token, not `name/version` — see ably/ably-common#361).
 *
 * Lives in the core's test tree because the whole monorepo's mocha suite runs from here (see
 * .mocharc.js), but tests the wrapper packages: it requires `@ably/pubsub-device` and
 * `@ably/pubsub-server` through the workspace symlinks, exercising the same dist bundles that
 * are published. Node-only, like the rest of test/unit (not listed in browser_file_list.js);
 * in Node the agent travels as a header, which a local HTTP server can capture without
 * touching sandbox. The modular factory is not exercised here — its entry point is ESM-only
 * and browser-targeted — but it stamps through the same shared helper as the root factories.
 */
define(['chai'], function (chai) {
  const { expect } = chai;
  const http = require('http');
  const PubSubDevice = require('@ably/pubsub-device');
  const PubSubServer = require('@ably/pubsub-server');
  const coreVersion = require('../../package.json').version;

  /**
   * Runs `fn` with client options pointing at a local HTTP server that answers `/time`, and
   * returns the `Ably-Agent` header of the first request received. `useBinaryProtocol: false`
   * so the stub can answer in JSON rather than msgpack.
   */
  async function agentHeaderSentBy(fn) {
    const agentHeaders = [];
    const server = http.createServer(function (req, res) {
      agentHeaders.push(req.headers['ably-agent']);
      res.setHeader('Content-Type', 'application/json');
      // The client's HTTP layer uses a keep-alive agent, and before Node 19 server.close()
      // never completes while an idle kept-alive socket remains open. Refuse keep-alive so
      // teardown is deterministic on every supported Node version.
      res.setHeader('Connection', 'close');
      res.end(JSON.stringify([Date.now()]));
    });
    // Belt and braces for the same reason: destroy any socket still open at teardown.
    const sockets = new Set();
    server.on('connection', function (socket) {
      sockets.add(socket);
      socket.on('close', function () {
        sockets.delete(socket);
      });
    });
    await new Promise(function (resolve) {
      server.listen(0, '127.0.0.1', resolve);
    });

    try {
      await fn({
        key: 'app.key:secret',
        endpoint: '127.0.0.1',
        port: server.address().port,
        tls: false,
        useBinaryProtocol: false,
      });
    } finally {
      for (const socket of sockets) {
        socket.destroy();
      }
      await new Promise(function (resolve) {
        server.close(resolve);
      });
    }

    expect(agentHeaders, 'expected the client to make a request').to.not.be.empty;
    expect(agentHeaders[0], 'expected the request to carry an Ably-Agent header').to.be.a('string');
    return agentHeaders[0];
  }

  /**
   * Parses an `Ably-Agent` header value into a name → version map, failing on duplicates.
   * A bare token (a versionless flag, like the side entries) maps to null.
   */
  function parseAgentHeader(header) {
    const entries = {};
    for (const token of header.split(' ')) {
      const slash = token.indexOf('/');
      const name = slash === -1 ? token : token.slice(0, slash);
      expect(entries, `duplicate agent entry '${name}' in '${header}'`).to.not.have.property(name);
      entries[name] = slash === -1 ? null : token.slice(slash + 1);
    }
    return entries;
  }

  describe('pubsub_side_agent', function () {
    it('device createClient declares the device side', async function () {
      const agents = parseAgentHeader(
        await agentHeaderSentBy(async function (options) {
          const client = PubSubDevice.createClient({ ...options, autoConnect: false });
          try {
            await client.time();
          } finally {
            client.close();
          }
        }),
      );

      expect(agents, 'expected the device side flag').to.have.property('ably-pubsub-device');
      expect(agents['ably-pubsub-device'], 'the side flag is versionless').to.equal(null);
      expect(agents, 'a device client must not carry the server entry').to.not.have.property('ably-pubsub-server');
      // The wrapper adds to the core's identity rather than replacing it.
      expect(agents['ably-js']).to.equal(coreVersion);
    });

    it('server createHttpClient declares the server side', async function () {
      const agents = parseAgentHeader(
        await agentHeaderSentBy(async function (options) {
          await PubSubServer.createHttpClient(options).time();
        }),
      );

      expect(agents, 'expected the server side flag').to.have.property('ably-pubsub-server');
      expect(agents['ably-pubsub-server'], 'the side flag is versionless').to.equal(null);
      expect(agents, 'a server client must not carry the device entry').to.not.have.property('ably-pubsub-device');
      expect(agents['ably-js']).to.equal(coreVersion);
    });

    it('server createRealtimeClient declares the server side', async function () {
      const agents = parseAgentHeader(
        await agentHeaderSentBy(async function (options) {
          const client = PubSubServer.createRealtimeClient({ ...options, autoConnect: false });
          try {
            await client.time();
          } finally {
            client.close();
          }
        }),
      );

      expect(agents, 'expected the server side flag').to.have.property('ably-pubsub-server');
      expect(agents['ably-pubsub-server'], 'the side flag is versionless').to.equal(null);
      expect(agents, 'a server client must not carry the device entry').to.not.have.property('ably-pubsub-device');
    });

    // On API-key auth the realtime system grants the server exemption by matching an agent
    // entry ending in `-server`, so the suffix is a billing contract, not a naming choice
    // (see the comments on the identifiers in packages/shared/side.ts).
    it('the server identifier carries the -server suffix that grants the MAU exemption', async function () {
      const header = await agentHeaderSentBy(async function (options) {
        await PubSubServer.createHttpClient(options).time();
      });

      const serverEntries = header.split(' ').filter(function (token) {
        return /-server(\/|$)/.test(token);
      });
      expect(serverEntries).to.deep.equal(['ably-pubsub-server']);
    });

    // `agents` is honoured at runtime but absent from the public ClientOptions type; SDKs
    // layered on the wrappers (Chat, Spaces, …) rely on their entries surviving the stamp.
    it('preserves caller-supplied agents entries alongside the side stamp', async function () {
      const agents = parseAgentHeader(
        await agentHeaderSentBy(async function (options) {
          await PubSubServer.createHttpClient({ ...options, agents: { 'chat-js': '0.1.0' } }).time();
        }),
      );

      expect(agents['chat-js']).to.equal('0.1.0');
      expect(agents).to.have.property('ably-pubsub-server');
    });

    it('the side stamp wins a collision on its own identifier', async function () {
      const agents = parseAgentHeader(
        await agentHeaderSentBy(async function (options) {
          await PubSubServer.createHttpClient({ ...options, agents: { 'ably-pubsub-server': '0.0.0' } }).time();
        }),
      );

      // parseAgentHeader has already rejected duplicates, so the flag being bare means the
      // caller's value was replaced, not joined.
      expect(agents, 'expected the server side flag').to.have.property('ably-pubsub-server');
      expect(agents['ably-pubsub-server'], 'the side stamp must replace the caller value').to.equal(null);
    });
  });
});
