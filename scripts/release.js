#!/usr/bin/env node

/*
 * Lockstep release tooling for the three published packages (@ably/pubsub-core,
 * @ably/pubsub-device, @ably/pubsub-server), which must always release together on the same
 * version. One command per release step:
 *
 *   node scripts/release.js check            verify every version site agrees (also run in CI)
 *   node scripts/release.js bump <version>   move every version site to <version> atomically
 *   node scripts/release.js publish          publish all three packages, or resume a partial one
 *
 * The publish subcommand makes a partial release as hard as practical, and recoverable when it
 * happens anyway:
 *
 *   - Preflight refuses to publish anything unless every version site agrees, the build
 *     artifacts each package's `files` globs reference exist (npm pack silently omits missing
 *     files, so a stale checkout would otherwise publish a broken tarball), and a --dry-run
 *     pack of every not-yet-published package succeeds.
 *   - Packages publish in dependency order (core, then the wrappers that peer-depend on it),
 *     so no wrapper is ever visible on the registry before the core version it pins.
 *   - The registry is consulted first, and already-published packages are skipped: if a run
 *     fails partway, re-running the same command completes the remainder rather than erroring
 *     on the packages that made it out.
 */

const fs = require('fs');
const path = require('path');
const { execSync, execFileSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');

// Publish order is dependency order: the wrappers peer-depend on the exact core version, so
// the core must be visible on the registry before either wrapper.
const packageDirs = ['packages/core', 'packages/device', 'packages/server'];

// Files whose absence means `npm run build` has not been run for the working tree: each is
// matched by its package's `files` globs, so npm pack would silently publish without it.
const requiredArtifacts = {
  'packages/core': ['build/ably.js', 'build/ably-node.js', 'build/liveobjects.js', 'react/cjs/index.js'],
  'packages/device': ['dist/index.js', 'dist/index.mjs', 'index.d.mts'],
  'packages/server': ['dist/index.js', 'dist/index.mjs', 'index.d.mts'],
};

const reactHooksFile = 'packages/core/src/platform/react-hooks/src/AblyReactHooks.ts';
const reactHooksVersionRe = /^export const version = '([^']+)';$/m;

function readJson(relPath) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, relPath), 'utf8'));
}

function writeJson(relPath, value) {
  fs.writeFileSync(path.join(repoRoot, relPath), JSON.stringify(value, null, 2) + '\n');
}

function fail(message) {
  console.error(`release: ${message}`);
  process.exit(1);
}

/**
 * Every place a release version is recorded. `check` requires them all to agree and `bump`
 * rewrites them all, so a new site must be added here for both to keep their guarantees.
 */
function versionSites() {
  const sites = [{ name: 'package.json (workspace root)', version: readJson('package.json').version }];
  for (const dir of packageDirs) {
    sites.push({ name: `${dir}/package.json`, version: readJson(`${dir}/package.json`).version });
  }
  for (const dir of ['packages/device', 'packages/server']) {
    sites.push({
      name: `${dir}/package.json peerDependencies['@ably/pubsub-core']`,
      version: readJson(`${dir}/package.json`).peerDependencies['@ably/pubsub-core'],
    });
  }
  const reactHooksSource = fs.readFileSync(path.join(repoRoot, reactHooksFile), 'utf8');
  const match = reactHooksSource.match(reactHooksVersionRe);
  sites.push({ name: `${reactHooksFile} (version constant)`, version: match ? match[1] : '<not found>' });
  return sites;
}

function check() {
  const sites = versionSites();
  const versions = new Set(sites.map((site) => site.version));
  if (versions.size !== 1) {
    console.error('release: version sites disagree; the three packages must release in lockstep:');
    for (const site of sites) {
      console.error(`  ${site.version.padEnd(12)} ${site.name}`);
    }
    console.error("Run 'npm run release:bump <version>' to move every site at once.");
    process.exit(1);
  }
  const version = sites[0].version;
  console.log(`release: all ${sites.length} version sites agree on ${version}`);
  return version;
}

function bump(version) {
  if (!version || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
    fail(`bump requires a semver version, got '${version ?? ''}'`);
  }

  // The package.json files are rewritten directly rather than via
  // `npm version --workspaces --include-workspace-root`: that command is not atomic (observed
  // with npm 11: it rewrote every package.json and still exited non-zero, and re-running it
  // then fails with "Version not changed" because the files already moved). Direct writes are
  // deterministic and safely re-runnable at any version.
  for (const relPath of ['package.json', ...packageDirs.map((dir) => `${dir}/package.json`)]) {
    const pkg = readJson(relPath);
    pkg.version = version;
    // The wrappers pin the core as an exact peer dependency, so it moves with the release.
    if (pkg.peerDependencies && pkg.peerDependencies['@ably/pubsub-core']) {
      pkg.peerDependencies['@ably/pubsub-core'] = version;
    }
    writeJson(relPath, pkg);
  }

  // The react-hooks agent constant is source, not package metadata, so npm version misses it.
  const reactHooksPath = path.join(repoRoot, reactHooksFile);
  const source = fs.readFileSync(reactHooksPath, 'utf8');
  if (!reactHooksVersionRe.test(source)) {
    fail(`could not find the version constant in ${reactHooksFile}; update versionSites() if it moved`);
  }
  fs.writeFileSync(reactHooksPath, source.replace(reactHooksVersionRe, `export const version = '${version}';`));

  // Refresh the lockfile's records of the workspace versions.
  execSync('npm install --package-lock-only', { cwd: repoRoot, stdio: 'inherit' });

  check();
  console.log(`release: bumped every version site to ${version}; review with 'git diff' and commit`);
}

/** Returns true if name@version is already on the registry. */
function isPublished(name, version) {
  try {
    const out = execFileSync('npm', ['view', `${name}@${version}`, 'version'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    return out === version;
  } catch (err) {
    const text = `${err.stdout ?? ''}${err.stderr ?? ''}`;
    // E404 covers both an unpublished version and a package that has never been published
    // (true for all three before the first lockstep release).
    if (text.includes('E404') || text.includes('404 Not Found')) {
      return false;
    }
    throw new Error(`could not query the registry for ${name}@${version}: ${text.trim()}`);
  }
}

function publish(args) {
  const dryRun = args.includes('--dry-run');
  const otpIndex = args.indexOf('--otp');
  const otp = otpIndex !== -1 ? args[otpIndex + 1] : null;

  const version = check();

  const gitStatus = execSync('git status --porcelain', { cwd: repoRoot, encoding: 'utf8' }).trim();
  if (gitStatus !== '') {
    console.warn('release: warning: the working tree has uncommitted changes; they will NOT be published');
    console.warn('release: (npm pack reads the files on disk, but only committed code should be released)');
  }

  // A missing artifact would not fail the publish — npm pack silently omits files its globs
  // do not match — so an incomplete build must be caught here, before anything ships.
  const missing = [];
  for (const [dir, artifacts] of Object.entries(requiredArtifacts)) {
    for (const artifact of artifacts) {
      if (!fs.existsSync(path.join(repoRoot, dir, artifact))) {
        missing.push(`${dir}/${artifact}`);
      }
    }
  }
  if (missing.length > 0) {
    fail(`build artifacts are missing; run 'npm run build' first:\n  ${missing.join('\n  ')}`);
  }

  // Work out how much of this version is already on the registry, so a failed run can be
  // re-run to publish the remainder.
  const state = packageDirs.map((dir) => {
    const name = readJson(`${dir}/package.json`).name;
    return { dir, name, published: isPublished(name, version) };
  });
  const toPublish = state.filter((entry) => !entry.published);

  if (toPublish.length === 0) {
    console.log(`release: all three packages are already published at ${version}; nothing to do`);
    return;
  }
  if (toPublish.length < state.length) {
    console.warn(`release: resuming a partial ${version} release; already published:`);
    for (const entry of state.filter((e) => e.published)) {
      console.warn(`  ${entry.name}`);
    }
  }

  // Every remaining package must pack cleanly before anything real is attempted.
  for (const entry of toPublish) {
    console.log(`release: dry-run pack of ${entry.name}@${version}`);
    execSync(`npm publish --dry-run ./${entry.dir}`, { cwd: repoRoot, stdio: 'inherit' });
  }
  if (dryRun) {
    console.log(`release: --dry-run: would publish, in order: ${toPublish.map((e) => e.name).join(', ')}`);
    return;
  }

  for (const entry of toPublish) {
    console.log(`release: publishing ${entry.name}@${version}`);
    try {
      // stdio must stay inherited so npm's interactive OTP prompt works.
      execSync(`npm publish ./${entry.dir}${otp ? ` --otp ${otp}` : ''}`, { cwd: repoRoot, stdio: 'inherit' });
    } catch (err) {
      console.error(`release: publishing ${entry.name}@${version} FAILED.`);
      console.error('release: the packages published before it are live. To recover, either:');
      console.error(`  - fix the cause and re-run 'npm run release:publish' — already-published`);
      console.error('    packages are skipped, so the run completes the remainder; or');
      console.error(`  - roll back by unpublishing what made it out (npm unpublish <name>@${version},`);
      console.error('    allowed within 72 hours of publish), if the release is being abandoned.');
      process.exit(1);
    }
  }

  console.log(`release: published core, device and server at ${version}`);
  console.log("release: next: run the 'Publish to CDN' workflow and create the GitHub release (see CONTRIBUTING.md)");
}

const [, , command, ...rest] = process.argv;
switch (command) {
  case 'check':
    check();
    break;
  case 'bump':
    bump(rest[0]);
    break;
  case 'publish':
    publish(rest);
    break;
  default:
    fail(`unknown command '${command ?? ''}': use check, bump <version>, or publish [--dry-run] [--otp <code>]`);
}
