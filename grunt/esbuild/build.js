const banner = require('../../src/fragments/license');
const umdWrapper = require('esbuild-plugin-umd-wrapper');
const stripLogsPlugin = require('./strip-logs').default;

// We need to create a new copy of the base config each time, because calling
// esbuild.build() with the base config causes it to mutate the passed
// config’s `banner.js` property to add some weird modules shim code,
// which we don’t want here.
function createBaseConfig() {
  return {
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

const materializerPluginConfig = {
  ...createBaseConfig(),
  entryPoints: ['src/plugins/materializer/index.ts'],
  plugins: [umdWrapper.default({ libraryName: 'AblyMessageMaterializerPlugin', amdNamedModule: false })],
  outfile: 'build/materializer.js',
};

const materializerPluginEsmConfig = {
  ...createBaseConfig(),
  format: 'esm',
  plugins: [],
  entryPoints: ['src/plugins/materializer/index.ts'],
  outfile: 'build/materializer.mjs',
};

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
  materializerPluginConfig,
  materializerPluginEsmConfig,
};
