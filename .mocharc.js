// The core's test suite lives in packages/core, but mocha runs from this monorepo root so that
// one node_modules and one set of dev dependencies serve every package.
const core = 'packages/core';

const config = {
  require: [
    'source-map-support/register',
    `${core}/test/support/modules_helper.js`,
    `${core}/test/support/test_helper.js`,
  ],
  file: [`${core}/test/support/root_hooks.js`],
  reporter: `${core}/test/support/mocha_reporter.js`,
};

// mocha has a ridiculous issue (https://github.com/mochajs/mocha/issues/4100) that command line
// specs don't override config specs; they are merged instead, so you can't run a single test file
// if you've defined specs in your config. therefore we work around it by only adding specs to the
// config if none are passed as arguments
if (!process.argv.slice(2).some(isTestFile)) {
  config.spec = [`${core}/test/realtime/*.test.js`, `${core}/test/rest/*.test.js`, `${core}/test/unit/*.test.js`];
}

function isTestFile(arg) {
  return arg.match(/\.test.js$/);
}

module.exports = config;
