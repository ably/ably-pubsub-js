const path = require('path');
const banner = require('../../packages/core-impl/src/fragments/license');
const umdWrapper = require('esbuild-plugin-umd-wrapper');
const stripLogsPlugin = require('./strip-logs').default;

// The private implementation's own bundles are built with `packages/core-impl` as esbuild's working
// directory, so the entry points, outfiles and sourcemap paths below all stay written relative to
// that package rather than to this monorepo root. They are what the test suite loads, and are
// never published. The core's runtime and the published per-side packages are built from the root,
// further down this file.
const implDir = path.resolve(__dirname, '..', '..', 'packages', 'core-impl');
const coreDir = path.resolve(__dirname, '..', '..', 'packages', 'core');

// We need to create a new copy of the base config each time, because calling
// esbuild.build() with the base config causes it to mutate the passed
// config’s `banner.js` property to add some weird modules shim code,
// which we don’t want here.
function createBaseConfig() {
  return {
    absWorkingDir: implDir,
    bundle: true,
    sourcemap: true,
    format: 'umd',
    banner: { js: '/*' + banner + '*/' },
    plugins: [umdWrapper.default({ libraryName: 'Ably', amdNamedModule: false })],
    target: 'es2020',
  };
}

const webConfig = {
  ...createBaseConfig(),
  entryPoints: ['src/platform/web/index.ts'],
  outfile: 'build/ably.js',
};

const modularConfig = {
  ...createBaseConfig(),
  entryPoints: ['src/platform/web/modular.ts'],
  outfile: 'build/modular/index.mjs',
  format: 'esm',
  plugins: [stripLogsPlugin],
};

const nodeConfig = {
  ...createBaseConfig(),
  platform: 'node',
  entryPoints: ['src/platform/nodejs/index.ts'],
  outfile: 'build/ably-node.js',
  /**
   * externals are not bundled into the esbuild output, instead they are left
   * as commonjs imports. This means that the version installed via package.json
   * dependencies is used rather than being pinned to whatever version we built
   * the package release with. This is especially important in the case of 'ws'
   * where the bun runtime has its own 'ws' module, and the npm 'ws' module
   * doesn't work at all.
   */
  external: ['ws', 'got'],
};

const pushPluginConfig = {
  ...createBaseConfig(),
  entryPoints: ['src/plugins/push/index.ts'],
  plugins: [umdWrapper.default({ libraryName: 'AblyPushPlugin', amdNamedModule: false })],
  outfile: 'build/push.js',
  external: ['ulid'],
};

const liveObjectsPluginConfig = {
  ...createBaseConfig(),
  entryPoints: ['src/plugins/liveobjects/index.ts'],
  plugins: [umdWrapper.default({ libraryName: 'AblyLiveObjectsPlugin', amdNamedModule: false })],
  outfile: 'build/liveobjects.js',
  external: ['dequal'],
};

// The core's own runtime: ErrorInfo, PartialErrorInfo and EventEmitter, shared with the SDKs layered on
// Pub/Sub. It has no platform dependencies, so one CJS/ESM pair serves every runtime.
const coreRuntimeConfigs = ['cjs', 'esm'].map((format) => ({
  absWorkingDir: coreDir,
  bundle: true,
  sourcemap: true,
  banner: { js: '/*' + banner + '*/' },
  // Keeps `ErrorInfo.name` and the other class names intact in the build consumers load. esbuild
  // renames a class that refers to itself, so `ErrorInfo.name` would otherwise read `_ErrorInfo`.
  keepNames: true,
  target: 'es2020',
  format,
  entryPoints: ['src/index.ts'],
  outfile: `build/index.${format === 'esm' ? 'mjs' : 'js'}`,
}));

// The per-side Pub/Sub packages (PDR-091). Each bundles the private implementation in
// packages/core-impl, leaving `@ably/pubsub-core` external so that there is one runtime copy of
// `ErrorInfo` and `EventEmitter`, shared with the SDKs layered on Pub/Sub. Every other dependency the
// implementation reaches through npm is left external too, as the platform bundles above leave it,
// and listed in the package's own `dependencies`.
//
// packages/README.md lists every bundle built here and by `cdnConfigs` below, so update it when you
// add, remove or change one.
//
// Each entry is one of the package's bundles. `platform` picks which implementation the package's
// sources reach through the `@ably/pubsub-core-impl/platform` specifier, by the export condition
// esbuild resolves it with: `node` for Node.js, and `default` (the web implementation) for every
// other runtime. `formats` names the module systems the entry is served in, and defaults to both.
//
// The Node.js implementation, and the CommonJS packages it bundles (such as @ably/msgpack-js), call
// `require()`, which an ES module does not have. esbuild's own shim defers to a `require` in scope,
// so the Node.js ESM bundles create one.
const nodeEsmRequireShim =
  "\nimport { createRequire as __ablyCreateRequire } from 'module';\nconst require = __ablyCreateRequire(import.meta.url);";

function createPackageConfigs(packageName, entries, { conditions = [] } = {}) {
  const packageDir = `packages/${packageName}`;

  return entries.flatMap(
    ({ name, source = name, platform = 'browser', formats = ['cjs', 'esm'], external = [], plugins = [] }) =>
      formats.map((format) => ({
        bundle: true,
        sourcemap: true,
        banner: { js: '/*' + banner + '*/' + (platform === 'node' && format === 'esm' ? nodeEsmRequireShim : '') },
        target: 'es2020',
        platform,
        format,
        conditions,
        // `react` and `react-dom` join the externals for the same reason `@ably/pubsub-core` does:
        // anything that must be one shared instance in the app has to come from the app's own copy.
        external: ['@ably/pubsub-core', 'react', 'react-dom', ...external],
        plugins,
        entryPoints: [`${packageDir}/src/${source}.ts`],
        outfile: `${packageDir}/dist/${name}.${format === 'esm' ? 'mjs' : 'js'}`,
      })),
  );
}

// The npm dependencies of the Node.js implementation, left external for the reason given on
// `nodeConfig` above.
const nodeExternals = ['ws', 'got'];

// The Temporal SDK packages, optional peer dependencies of `@ably/pubsub-server`, which the application installs
// when it uses the Temporal plugin. They are left external so that the plugin shares the application's copy, whose
// classes, such as `ApplicationFailure`, Temporal checks with `instanceof`.
const temporalExternals = ['@temporalio/*'];

// The web and React Native bundles of `@ably/pubsub-device`, the CDN bundle included, leave
// MessagePack out: under this export condition, `@ably/pubsub-core-impl/bundled-msgpack`, which their
// entry points import their codec through, resolves to no codec, so a client uses JSON unless the app
// passes the `MsgPack` plugin, from `@ably/pubsub-device/msgpack` or the CDN's `msgpack.umd.js`. A
// device defaults to JSON there anyway. The Node.js entry point
// imports its codec directly, so the package's Node.js bundles keep MessagePack, the platform's
// default protocol, whatever this condition says. esbuild still applies `default`,
// `import`/`require` and `browser`/`node` alongside it.
const excludeMsgpackCondition = 'ably-exclude-msgpack';

const pubsubPackageConfigs = [
  ...createPackageConfigs(
    'device',
    [
      // The package root strips most logs below error level, which is what ships to end users'
      // devices: smaller, and without the detail of the client's internals. `@ably/pubsub-device/debug`
      // serves the same entry point with full logging, for diagnosing an app.
      // The React Native pair is built by webpack (webpack.config.js).
      //
      // The Node.js bundle is not stripped, so `@ably/pubsub-device/debug` resolves to it on Node.js.
      { name: 'index', plugins: [stripLogsPlugin] },
      { name: 'node', source: 'index', platform: 'node', external: nodeExternals },
      { name: 'debug', source: 'index' },
      // ESM only: the modular variant is published behind an `import` condition alone. Its logs are
      // stripped, as the internal modular bundle's are, to keep it minimal.
      { name: 'modular', formats: ['esm'], plugins: [stripLogsPlugin] },
      { name: 'liveobjects', external: ['dequal'] },
      { name: 'push', external: ['ulid'] },
      { name: 'react-native-push', external: ['ulid', 'react-native'] },
      // The `MsgPack` plugin: the platform's codec, which `@ably/pubsub-core-impl/msgpack` picks by
      // the `node` or `default` condition, whatever `excludeMsgpackCondition` says.
      { name: 'msgpack' },
      { name: 'msgpack-node', source: 'msgpack', platform: 'node' },
    ],
    { conditions: [excludeMsgpackCondition] },
  ),
  ...createPackageConfigs('server', [
    { name: 'index' },
    { name: 'node', source: 'index', platform: 'node', external: nodeExternals },
    { name: 'liveobjects', external: ['dequal'] },
    // The Temporal plugin. Its worker side runs on Node.js only. Its workflow side is bundled again by Temporal
    // into its workflow sandbox, which rejects Node.js built-in modules, so it is built for the default platform,
    // without the `require` shim that the Node.js ESM bundles add.
    { name: 'temporal', platform: 'node', external: temporalExternals },
    { name: 'temporal-workflow', external: temporalExternals },
  ]),
];

// The CDN bundles of `@ably/pubsub-device`, for script-tag consumption. Unlike the npm bundles, these
// inline everything, `@ably/pubsub-core` included, because a script tag has no module resolution
// to share it through. Their file names are the ones the CDN has always served.
//
// Like the npm bundles, they are built with `excludeMsgpackCondition`, so `ably.js` leaves MessagePack
// to the `MsgPack` plugin, which `msgpack.umd.js` serves as `AblyMsgPackPlugin.MsgPack`.
function createCdnConfigs(entry, libraryName, outName, { external = [], plugins = [] } = {}) {
  return [false, true].map((minify) => ({
    bundle: true,
    sourcemap: true,
    format: 'umd',
    banner: { js: '/*' + banner + '*/' },
    plugins: [...plugins, umdWrapper.default({ libraryName, amdNamedModule: false })],
    target: 'es2020',
    minify,
    external,
    conditions: [excludeMsgpackCondition],
    entryPoints: [`packages/device/src/${entry}.ts`],
    outfile: `packages/device/dist/cdn/${outName}${minify ? '.min' : ''}.js`,
  }));
}

const cdnConfigs = [
  // As with the package's npm bundles, `ably` strips most logs below error level, and `ably.debug`
  // is the same bundle with full logging, for diagnosing an app.
  ...createCdnConfigs('index', 'AblyPubSub', 'ably', { plugins: [stripLogsPlugin] }),
  ...createCdnConfigs('index', 'AblyPubSub', 'ably.debug'),
  ...createCdnConfigs('push', 'AblyPushPlugin', 'push.umd'),
  ...createCdnConfigs('liveobjects', 'AblyLiveObjectsPlugin', 'liveobjects.umd'),
  ...createCdnConfigs('msgpack', 'AblyMsgPackPlugin', 'msgpack.umd'),
];

module.exports = {
  coreRuntimeConfigs,
  webConfig,
  modularConfig,
  nodeConfig,
  pushPluginConfig,
  liveObjectsPluginConfig,
  excludeMsgpackCondition,
  pubsubPackageConfigs,
  cdnConfigs,
};
