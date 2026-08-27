/* These modules are paths to common modules loaded by requireJs in the browser or Node */
define(function () {
  return (module.exports = {
    // Ably modules
    ably: { browser: 'build/ably', node: 'build/ably-node' },
    'vcdiff-decoder': {
      browser: 'node_modules/@ably/vcdiff-decoder/dist/vcdiff-decoder',
      node: 'node_modules/@ably/vcdiff-decoder',
    },
    push: {
      browser: 'build/push',
      node: 'build/push',
    },
    liveobjects: {
      browser: 'build/liveobjects',
      node: 'build/liveobjects',
    },

    // test modules
    globals: { browser: 'test/common/globals/environment', node: 'test/common/globals/environment' },
    shared_helper: { browser: 'test/common/modules/shared_helper', node: 'test/common/modules/shared_helper' },
    async: { browser: 'node_modules/async/lib/async' },
    chai: { browser: 'node_modules/chai/chai', node: 'node_modules/chai/chai' },
    ulid: { browser: 'node_modules/ulid/dist/index.umd', node: 'node_modules/ulid/dist/index.umd' },
    dequal: { browser: 'node_modules/dequal/dist/index.min', node: 'node_modules/dequal/dist/index' },
    private_api_recorder: {
      browser: 'test/common/modules/private_api_recorder',
      node: 'test/common/modules/private_api_recorder',
    },
    liveobjects_helper: {
      browser: 'test/common/modules/liveobjects_helper',
      node: 'test/common/modules/liveobjects_helper',
    },
  });
});
