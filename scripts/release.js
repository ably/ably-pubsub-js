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
 * publish takes --stage to run `npm stage publish` instead (used by the release workflow, whose
 * npm trusted publisher may only stage): each version then waits on npmjs.com for a maintainer
 * to approve it with 2FA. Approve core before device and server, since they pin its version.
 * Pass --tag <dist-tag> for a pre-release, which npm refuses to tag `latest` implicitly.
 *
 * The publish subcommand makes a partial release as hard as practical, and recoverable when it
 * happens anyway:
 *
 *   - Preflight refuses to publish anything unless every version site agrees, the build
 *     artifacts each package's `files` globs reference exist (npm pack silently omits missing
 *     files, so a stale checkout would otherwise publish a broken tarball), and a --dry-run
 *     pack of every not-yet-published package succeeds.
 *   - Packages publish in dependency order (core, then the per-side packages that depend on it),
 *     so no wrapper is ever visible on the registry before the core version it pins.
 *   - The registry is consulted first, and already-published packages are skipped: if a run
 *     fails partway, re-running the same command completes the remainder rather than erroring
 *     on the packages that made it out.
 */

const fs = require('fs');
const path = require('path');
const { execSync, execFileSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');

// Publish order is dependency order: the per-side packages depend on the exact core version,
// so the core must be visible on the registry before either of them.
const packageDirs = ['packages/core', 'packages/device', 'packages/server'];

// The private implementation workspace is never published, but bundled into both per-side
// packages, so its version moves with theirs.
const privatePackageDirs = ['packages/core-impl'];

// The workspaces that pin the exact core version as a dependency.
const coreDependentDirs = ['packages/core-impl', 'packages/device', 'packages/server'];

// Files whose absence means `npm run build` has not been run for the working tree: each is
// matched by its package's `files` globs, so npm pack would silently publish without it.
const requiredArtifacts = {
  'packages/core': ['build/index.js', 'build/index.mjs', 'build/index.d.ts'],
  'packages/device': [
    'dist/index.js',
    'dist/index.mjs',
    'dist/node.js',
    'dist/react-native.js',
    'dist/nativescript.js',
    'dist/react/cjs/index.js',
    'dist/cdn/ably.min.js',
    'dist/cdn/ably.debug.min.js',
    'index.d.mts',
  ],
  'packages/server': ['dist/index.js', 'dist/index.mjs', 'dist/node.js', 'index.d.mts'],
};

const reactHooksFile = 'packages/core-impl/src/platform/react-hooks/src/PubSubReactHooks.ts';
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
  for (const dir of [...packageDirs, ...privatePackageDirs]) {
    sites.push({ name: `${dir}/package.json`, version: readJson(`${dir}/package.json`).version });
  }
  for (const dir of coreDependentDirs) {
    sites.push({
      name: `${dir}/package.json dependencies['@ably/pubsub-core']`,
      version: readJson(`${dir}/package.json`).dependencies['@ably/pubsub-core'],
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
  for (const relPath of [
    'package.json',
    ...[...packageDirs, ...privatePackageDirs].map((dir) => `${dir}/package.json`),
  ]) {
    const pkg = readJson(relPath);
    pkg.version = version;
    // The core is pinned as an exact dependency, so the pin moves with the release.
    if (pkg.dependencies && pkg.dependencies['@ably/pubsub-core']) {
      pkg.dependencies['@ably/pubsub-core'] = version;
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

/** Returns the value following `flag` in args, or null if the flag is absent. */
function flagValue(args, flag, pattern) {
  const index = args.indexOf(flag);
  if (index === -1) {
    return null;
  }
  const value = args[index + 1];
  // The value reaches npm's argv, so accept only what a real one looks like. This also stops a
  // following flag (`--tag --stage`) from being swallowed as the value.
  if (value === undefined || value.startsWith('-') || !pattern.test(value)) {
    fail(`${flag} requires a value matching ${pattern}, got '${value ?? ''}'`);
  }
  return value;
}

function publish(args) {
  const dryRun = args.includes('--dry-run');
  const stage = args.includes('--stage');
  const otp = flagValue(args, '--otp', /^\d+$/);
  // A dist-tag that parses as a semver range (`1`, `1.2`) is rejected by npm, so require a
  // leading letter.
  const tag = flagValue(args, '--tag', /^[A-Za-z][A-Za-z0-9._-]*$/);
  const tagArgs = tag ? ['--tag', tag] : [];

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

  // Every remaining package must pack cleanly before anything real is attempted. The dry run
  // packs from the package directory, as the real publish and stage below do, so it validates
  // the same tarball.
  for (const entry of toPublish) {
    console.log(`release: dry-run pack of ${entry.name}@${version}`);
    execFileSync('npm', ['publish', '--dry-run', ...tagArgs], {
      cwd: path.join(repoRoot, entry.dir),
      stdio: 'inherit',
    });
  }
  if (dryRun) {
    console.log(
      `release: --dry-run: would ${stage ? 'stage' : 'publish'}, in order: ${toPublish.map((e) => e.name).join(', ')}`,
    );
    return;
  }

  // npm stage publish takes no folder argument and packs the current working directory, so both
  // commands run from the package directory. Arguments go to npm as argv, never through a shell.
  const command = stage ? ['stage', 'publish'] : ['publish'];
  const commandArgs = [...command, ...tagArgs, ...(otp ? ['--otp', otp] : [])];
  for (const entry of toPublish) {
    console.log(`release: ${stage ? 'staging' : 'publishing'} ${entry.name}@${version}`);
    try {
      // stdio must stay inherited so npm's interactive OTP prompt works.
      execFileSync('npm', commandArgs, { cwd: path.join(repoRoot, entry.dir), stdio: 'inherit' });
    } catch (err) {
      if (stage) {
        console.error(`release: staging ${entry.name}@${version} FAILED.`);
        console.error('release: the packages staged before it are awaiting approval on npmjs.com.');
        console.error('release: npm refuses to stage a version that is already staged, so to recover,');
        console.error('release: reject the staged ones (npm stage reject <stage-id>) and re-run the release.');
        process.exit(1);
      }
      console.error(`release: publishing ${entry.name}@${version} FAILED.`);
      console.error('release: the packages published before it are live. To recover, either:');
      console.error(`  - fix the cause and re-run 'npm run release:publish' — already-published`);
      console.error('    packages are skipped, so the run completes the remainder; or');
      console.error(`  - roll back by unpublishing what made it out (npm unpublish <name>@${version},`);
      console.error('    allowed within 72 hours of publish), if the release is being abandoned.');
      process.exit(1);
    }
  }

  if (stage) {
    console.log(`release: staged ${toPublish.map((e) => e.name).join(', ')} at ${version}`);
    console.log('release: next: approve them on npmjs.com (Staged Packages tab) or with npm stage approve,');
    console.log("release: core first, then run the 'Publish to CDN' workflow (see CONTRIBUTING.md)");
    return;
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
    fail(
      `unknown command '${command ?? ''}': use check, bump <version>, or publish [--dry-run] [--stage] [--tag <tag>] [--otp <code>]`,
    );
}
