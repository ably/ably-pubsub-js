const path = require('path');
const banner = require('../../packages/core/src/fragments/license');
const umdWrapper = require('esbuild-plugin-umd-wrapper');
const stripLogsPlugin = require('./strip-logs').default;

// The core's own bundles are built with `packages/core` as esbuild's working directory, so the
// entry points, outfiles and sourcemap paths below all stay written relative to that package
// rather than to this monorepo root. The wrapper package configs at the bottom of this file
// deliberately do not use this base config, and so are built from the root: their sources reach
// across package boundaries into packages/shared.
const coreDir = path.resolve(__dirname, '..', '..', 'packages', 'core');

// We need to create a new copy of the base config each time, because calling
// esbuild.build() with the base config causes it to mutate the passed
// config’s `banner.js` property to add some weird modules shim code,
// which we don’t want here.
function createBaseConfig() {
  return {
    absWorkingDir: coreDir,
    bundle: true,
    sourcemap: true,
    format: 'umd',
    banner: { js: '/*' + banner + '*/' },
    plugins: [umdWrapper.default({ libraryName: 'Ably', amdNamedModule: false })],
    target: 'es2017',
  };
}

const webConfig = {
  ...createBaseConfig(),
  entryPoints: ['src/platform/web/index.ts'],
  outfile: 'build/ably.js',
};

const minifiedWebConfig = {
  ...createBaseConfig(),
  entryPoints: ['src/platform/web/index.ts'],
  outfile: 'build/ably.min.js',
  minify: true,
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

const pushPluginCdnConfig = {
  ...createBaseConfig(),
  entryPoints: ['src/plugins/push/index.ts'],
  plugins: [umdWrapper.default({ libraryName: 'AblyPushPlugin', amdNamedModule: false })],
  outfile: 'build/push.umd.js',
};

const minifiedPushPluginCdnConfig = {
  ...createBaseConfig(),
  entryPoints: ['src/plugins/push/index.ts'],
  plugins: [umdWrapper.default({ libraryName: 'AblyPushPlugin', amdNamedModule: false })],
  outfile: 'build/push.umd.min.js',
  minify: true,
};

// no CDN (.umd/.umd.min) variants: there is no script-tag consumption path in React Native.
// 'react-native' stays external so the bundle carries no native module dependency; the UMD
// wrapper requires externals at module load, which Metro resolves statically in an RN app.
const reactNativePushPluginConfig = {
  ...createBaseConfig(),
  entryPoints: ['src/plugins/react-native-push/index.ts'],
  plugins: [umdWrapper.default({ libraryName: 'AblyReactNativePushPlugin', amdNamedModule: false })],
  outfile: 'build/react-native-push.js',
  external: ['ulid', 'react-native'],
};

const liveObjectsPluginConfig = {
  ...createBaseConfig(),
  entryPoints: ['src/plugins/liveobjects/index.ts'],
  plugins: [umdWrapper.default({ libraryName: 'AblyLiveObjectsPlugin', amdNamedModule: false })],
  outfile: 'build/liveobjects.js',
  external: ['dequal'],
};

const liveObjectsPluginEsmConfig = {
  ...createBaseConfig(),
  format: 'esm',
  plugins: [],
  entryPoints: ['src/plugins/liveobjects/index.ts'],
  outfile: 'build/liveobjects.mjs',
  external: ['dequal'],
};

const liveObjectsPluginCdnConfig = {
  ...createBaseConfig(),
  entryPoints: ['src/plugins/liveobjects/index.ts'],
  plugins: [umdWrapper.default({ libraryName: 'AblyLiveObjectsPlugin', amdNamedModule: false })],
  outfile: 'build/liveobjects.umd.js',
};

const minifiedLiveObjectsPluginCdnConfig = {
  ...createBaseConfig(),
  entryPoints: ['src/plugins/liveobjects/index.ts'],
  plugins: [umdWrapper.default({ libraryName: 'AblyLiveObjectsPlugin', amdNamedModule: false })],
  outfile: 'build/liveobjects.umd.min.js',
  minify: true,
};

// The per-side Pub/Sub wrapper packages (PDR-091). Each is a thin wrapper over the core, so it is
// built as a plain CJS/ESM pair rather than UMD.
//
// Each entry is one of the package's public entry points: `.` plus one per re-exported core
// subpath. Every entry point is served in both formats, so every entry is built twice.
//
// `sources` names the source file to build for each format, and defaults to one file serving both.
// Only the modular subpath overrides it, naming `esm` alone so that it is built in that format
// only, because the core publishes its modular variant behind an `import` condition with no
// CommonJS build to re-export. Every other entry point exposes its surface under a name, which is
// spelled the same way in both module systems, so one source serves both.
function createPackageConfigs(packageName, entries) {
  const packageDir = `packages/${packageName}`;

  return entries.flatMap(({ name, sources = { cjs: name, esm: name } }) => {
    const baseConfig = {
      bundle: true,
      sourcemap: true,
      banner: { js: '/*' + banner + '*/' },
      target: 'es2017',
      // `react` and `react-dom` join the externals for the same reason `@ably/pubsub-core` does:
      // the hooks must use the app's copy of React, and bundling one here would break the hooks'
      // rules entirely.
      external: ['@ably/pubsub-core', '@ably/pubsub-core/*', 'react', 'react-dom'],
    };

    return Object.entries(sources).map(([format, source]) => ({
      ...baseConfig,
      format,
      entryPoints: [`${packageDir}/src/${source}.ts`],
      outfile: `${packageDir}/dist/${name}.${format === 'esm' ? 'mjs' : 'js'}`,
    }));
  });
}

const pubsubPackageConfigs = [
  ...createPackageConfigs('device', [
    { name: 'index' },
    { name: 'modular', sources: { esm: 'modular' } },
    { name: 'liveobjects' },
    { name: 'liveobjects-react' },
    { name: 'react' },
    { name: 'push' },
    { name: 'react-native-push' },
  ]),
  ...createPackageConfigs('server', [{ name: 'index' }, { name: 'liveobjects' }]),
];

module.exports = {
  webConfig,
  minifiedWebConfig,
  modularConfig,
  nodeConfig,
  pushPluginConfig,
  pushPluginCdnConfig,
  minifiedPushPluginCdnConfig,
  reactNativePushPluginConfig,
  liveObjectsPluginConfig,
  liveObjectsPluginEsmConfig,
  liveObjectsPluginCdnConfig,
  minifiedLiveObjectsPluginCdnConfig,
  pubsubPackageConfigs,
};
