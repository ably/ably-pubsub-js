/* eslint-disable @typescript-eslint/no-var-requires */
const path = require('path');
const { BannerPlugin, ProvidePlugin } = require('webpack');
const banner = require('./packages/core/src/fragments/license');
// This is needed for baseUrl to resolve correctly from tsconfig
const TsconfigPathsPlugin = require('tsconfig-paths-webpack-plugin');

// Everything webpack builds here belongs to the core package rather than to this monorepo root.
// That is also why the tsconfig has to be named explicitly: the plugin resolves one from the
// working directory, which would find the root's, and the root's covers scripts/ and carries none
// of the core's `baseUrl`.
const coreDir = path.resolve(__dirname, 'packages', 'core');
const tsconfigPathsPlugin = () => new TsconfigPathsPlugin({ configFile: path.resolve(coreDir, 'tsconfig.json') });

const baseConfig = {
  mode: 'production',
  entry: {
    index: path.resolve(coreDir, 'src', 'common', 'lib', 'index.js'),
  },
  resolve: {
    extensions: ['.js', '.ts'],
    plugins: [tsconfigPathsPlugin()],
  },
  output: {
    path: path.resolve(coreDir, 'build'),
    library: 'Ably',
    libraryTarget: 'umd',
    libraryExport: 'default',
  },
  module: {
    rules: [
      // all files with a `.ts` or `.tsx` extension will be handled by `ts-loader`
      { test: /\.ts$/, loader: 'ts-loader' },
    ],
  },
  target: ['web', 'es2017'],
  externals: {
    request: false,
    ws: false,
  },
  plugins: [new BannerPlugin({ banner })],
  performance: {
    hints: false,
  },
  stats: {
    modules: false,
  },
};

function platformPath(platform, ...dir) {
  return path.resolve(coreDir, 'src', 'platform', platform, ...dir);
}

const nativeScriptConfig = {
  ...baseConfig,
  output: {
    ...baseConfig.output,
    filename: 'ably-nativescript.js',
    globalObject: 'global',
  },
  entry: {
    index: platformPath('nativescript'),
  },
  resolve: {
    ...baseConfig.resolve,
    fallback: {
      crypto: false,
    },
  },
  externals: {
    request: false,
    ws: false,
    'nativescript-websockets': true,
    '@nativescript/core/application-settings': true,
  },
  optimization: {
    minimize: false,
  },
};

const reactNativeConfig = {
  ...baseConfig,
  output: {
    ...baseConfig.output,
    filename: 'ably-reactnative.js',
    globalObject: 'global',
  },
  entry: {
    index: platformPath('react-native'),
  },
  resolve: {
    extensions: ['.js', '.ts'],
    plugins: [tsconfigPathsPlugin()],
    fallback: {
      crypto: false,
    },
  },
  externals: {
    request: false,
    ws: false,
    'react-native': true,
    fastestsmallesttextencoderdecoder: 'fastestsmallesttextencoderdecoder',
  },
  optimization: {
    minimize: false,
  },
};

/**
 * We create a bundle that exposes the mocha-junit-reporter package to be able to use it in the browser. We need to do this for the following reasons:
 * - This package is designed for Node only and hence requires polyfills of Node libraries (e.g. `stream`, `path`) — webpack takes care of this for us.
 * - The package is not compatible with RequireJS and hence we don’t have any easy way to directly load it in our tests — the webpack bundle exposes it as a global named MochaJUnitReporter.
 */
function createMochaJUnitReporterConfig() {
  const dir = path.join(coreDir, 'test', 'support', 'mocha_junit_reporter');

  return {
    mode: 'development',
    entry: path.join(dir, 'index.js'),
    externals: {
      mocha: 'mocha.Mocha',
    },
    output: {
      path: path.join(dir, 'build'),
      filename: 'browser.js',
      library: 'MochaJUnitReporter',
    },
    plugins: [
      new ProvidePlugin({
        process: 'process/browser.js',
      }),
    ],
    resolve: {
      fallback: {
        // These are the modules suggested by webpack, post v5-upgrade, to replace v4’s built-in shims.
        path: require.resolve('path-browserify'),
        stream: require.resolve('stream-browserify'),
      },
      modules: [
        // Webpack doesn’t suggest any useful shim for the `fs` module, so we provide our own.
        path.resolve(dir, 'shims'),
        'node_modules',
      ],
    },
  };
}

module.exports = {
  nativeScript: nativeScriptConfig,
  reactNative: reactNativeConfig,
  mochaJUnitReporterBrowser: createMochaJUnitReporterConfig(),
};
