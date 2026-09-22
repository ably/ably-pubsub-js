const path = require('path');

// CI collects these from the repo root — they are outputs of a test run rather than content of
// the core package, and the root-level scripts that post-process them write their reports there
// too. Hence the reach up out of packages/core.
const repoRoot = path.join(__dirname, '..', '..', '..', '..');

module.exports = {
  jUnit: path.join(repoRoot, 'junit'),
  privateApiUsage: path.join(repoRoot, 'private-api-usage'),
};
