'use strict';

var fs = require('fs');
var path = require('path');
var webpackConfig = require('./webpack.config');
var esbuild = require('esbuild');
var process = require('process');
var MochaServer = require('./packages/core-impl/test/web_server');
var esbuildConfig = require('./grunt/esbuild/build');

module.exports = function (grunt) {
  grunt.loadNpmTasks('grunt-webpack');

  // Grunt runs from the monorepo root, but most of what it builds is compiled from the private
  // implementation, or is the core package's own runtime and declarations, so their paths are
  // written relative to these rather than to the root.
  var coreDir = 'packages/core';
  var implDir = 'packages/core-impl';

  var dirs = {
    common: implDir + '/src/common',
    browser: implDir + '/src/platform/web',
    fragments: implDir + '/src/platform/web/fragments',
    static: implDir + '/build',
    dest: implDir + '/build',
  };

  async function execExternalPromises(cmd) {
    grunt.log.ok('Executing ' + cmd);
    return new Promise(function (resolve, reject) {
      require('child_process').exec(cmd, function (err, stdout, stderr) {
        if (err) {
          grunt.fatal('Error executing "' + cmd + '":\nstderr:\n' + stderr + '\nstdout:\n' + stdout);
          reject(err);
        }
        console.log(stdout);
        stderr && console.error(stderr);
        resolve();
      });
    });
  }

  function execExternal(cmd) {
    return function () {
      var done = this.async();
      execExternalPromises(cmd)
        .then(() => done())
        .catch((error) => done(error));
    };
  }

  var gruntConfig = {
    dirs: dirs,
    webpack: {
      reactNative: [webpackConfig.reactNative, webpackConfig.reactNativeDebug],
      support: [webpackConfig.nativeScript, webpackConfig.mochaJUnitReporterBrowser],
    },
  };

  grunt.initConfig(gruntConfig);

  grunt.registerTask('checkGitSubmodules', 'Check, if git submodules are properly installed', function () {
    var done = this.async();
    var pathToSubmodule = path.join(__dirname, implDir, 'test', 'common', 'ably-common');
    fs.stat(pathToSubmodule, function (error, stats) {
      if (error) {
        grunt.log.writeln('%s : while checking submodule path!', error.message);
        grunt.log.writeln('Probably, git submodule at %s are not initialized?', pathToSubmodule);
        grunt.log.writeln('Please, initialize it with `git submodule init & git submodule update`!');
        return done(false);
      }
      if (stats.isDirectory()) {
        grunt.log.writeln('Git submodule at %s is found!', pathToSubmodule);
        return done();
      }
      grunt.log.writeln('Git submodule at %s is not initialized!', pathToSubmodule);
      grunt.log.writeln('Please, initialize it with `git submodule init & git submodule update`!');
      return done(false);
    });
  });

  grunt.registerTask('build', [
    'webpack:support',
    'build:browser',
    'build:node',
    'build:push',
    'build:liveobjects',
    'build:packages',
  ]);

  grunt.registerTask('all', ['build', 'requirejs']);

  grunt.registerTask('mocha:webserver', 'Run the Mocha web server', function () {
    const done = this.async();
    const server = new MochaServer();
    server.listen();

    process.on('SIGTERM', () => {
      server.close();
      done();
    });
    process.on('SIGINT', () => {
      server.close();
      done();
    });
  });

  grunt.registerTask('build:node', function () {
    const done = this.async();

    esbuild
      .build(esbuildConfig.nodeConfig)
      .then(() => {
        done(true);
      })
      .catch((err) => {
        done(err);
      });
  });

  grunt.registerTask('build:core:bundle', 'Bundle the core runtime (ErrorInfo, EventEmitter)', function () {
    var done = this.async();

    Promise.all(esbuildConfig.coreRuntimeConfigs.map((config) => esbuild.build(config)))
      .then(() => {
        done(true);
      })
      .catch((err) => {
        done(err);
      });
  });

  grunt.registerTask(
    'build:core:types',
    'Emit the declarations of the core runtime',
    execExternal('tsc --project ' + coreDir + '/tsconfig.runtime.json'),
  );

  // The runtime is served as real ESM behind the `import` condition, so that condition needs
  // ESM-flavoured types too, for the reason given on `build:packages:types` below. The copy has to
  // name its relative imports with an extension, as ESM requires.
  grunt.registerTask(
    'build:core:types:esm',
    'Generate the .d.mts counterpart of the core root declaration file',
    function () {
      const contents = fs.readFileSync(`${coreDir}/index.d.ts`, 'utf8');
      fs.writeFileSync(`${coreDir}/index.d.mts`, contents.replace(/from '(\.\/[^']+)'/g, "from '$1.js'"));
      grunt.log.ok('Generated index.d.mts from index.d.ts');
    },
  );

  grunt.registerTask('build:core', ['build:core:bundle', 'build:core:types', 'build:core:types:esm']);

  grunt.registerTask('build:browser', function () {
    var done = this.async();

    Promise.all([esbuild.build(esbuildConfig.webConfig), esbuild.build(esbuildConfig.modularConfig)])
      .then(() => {
        console.log('esbuild succeeded');
        done(true);
      })
      .catch((err) => {
        done(err);
      });
  });

  grunt.registerTask('build:push', function () {
    var done = this.async();

    esbuild
      .build(esbuildConfig.pushPluginConfig)
      .then(() => {
        done(true);
      })
      .catch((err) => {
        done(err);
      });
  });

  grunt.registerTask('build:liveobjects:bundle', function () {
    var done = this.async();

    esbuild
      .build(esbuildConfig.liveObjectsPluginConfig)
      .then(() => {
        done(true);
      })
      .catch((err) => {
        done(err);
      });
  });

  grunt.registerTask(
    'build:liveobjects:types',
    'Generate the liveobjects .d.mts files from their .d.ts counterparts by adding .js extensions to relative imports',
    function () {
      // The liveobjects declarations are split across these files, each with a .d.mts counterpart.
      // An import between two of them must name the counterpart (`.mjs` resolves to the .d.mts), or
      // the ESM types would pull in the CJS-flavoured copy of the other file alongside the ESM one,
      // and their two module augmentations of RealtimeChannel would conflict. The rest of the core's
      // declarations have no .d.mts, so their imports name `.js`, which resolves to the .d.ts.
      const names = ['liveobjects', 'liveobjects-types', 'liveobjects-http'];
      for (const name of names) {
        const dtsContent = fs.readFileSync(`${coreDir}/${name}.d.ts`, 'utf8');
        const mtsContent = dtsContent.replace(
          /from '\.\/([^']+)'/g,
          (_, target) => `from './${target}${names.includes(target) ? '.mjs' : '.js'}'`,
        );
        fs.writeFileSync(`${coreDir}/${name}.d.mts`, mtsContent);
        grunt.log.ok(`Generated ${name}.d.mts from ${name}.d.ts`);
      }
    },
  );

  grunt.registerTask('build:liveobjects', ['build:liveobjects:bundle', 'build:liveobjects:types']);

  grunt.registerTask('build:packages:bundle', 'Bundle the per-side Pub/Sub packages', function () {
    var done = this.async();

    Promise.all(esbuildConfig.pubsubPackageConfigs.map((config) => esbuild.build(config)))
      .then(() => {
        done(true);
      })
      .catch((err) => {
        done(err);
      });
  });

  // Each entry point serves real ESM behind its `import` condition, so that condition needs
  // ESM-flavoured types too. Without a `.d.mts`, TypeScript reads the `.d.ts` as CommonJS types
  // describing an ESM file, and `attw` rightly reports the entry point as masquerading as CJS.
  //
  // Nearly a straight copy: the core is imported by bare specifier, which resolves identically
  // under both module systems, so only the relative imports between these declaration files need
  // rewriting. Every one of them also exports under a name rather than with `export =`, which has
  // no ESM spelling and so could not be copied.
  grunt.registerTask(
    'build:packages:types',
    'Generate the .d.mts counterpart of each wrapper package declaration file',
    function () {
      // The React hooks' declarations under dist/ are emitted by tsc in both flavours already.
      const declarationFiles = grunt.file.expand([
        'packages/device/**/index.d.ts',
        'packages/server/**/index.d.ts',
        '!packages/*/dist/**',
        '!packages/*/node_modules/**',
      ]);

      let generated = 0;

      for (const declarationFile of declarationFiles) {
        const contents = fs.readFileSync(declarationFile, 'utf8');

        // `export =` has no ESM spelling, so a declaration file using it could not be copied into
        // one. Nothing here uses it — every subpath exports under a name — so fail loudly rather
        // than silently emit a `.d.mts` that does not parse.
        if (/^export = /m.test(contents)) {
          grunt.fatal(
            `${declarationFile} uses \`export =\`, which has no ESM spelling and so cannot be ` +
              'copied into a .d.mts. Export under a name instead, as the other subpaths do.',
          );
        }

        // A relative import of another of these declaration files names its `.d.mts` counterpart
        // (`.mjs` resolves to it), so that the ESM types do not pull in the CJS-flavoured copy.
        const esmContents = contents.replace(/from '(\.\.?\/[^']+)\.js'/g, (specifier, target) =>
          declarationFiles.includes(path.join(path.dirname(declarationFile), `${target}.d.ts`))
            ? `from '${target}.mjs'`
            : specifier,
        );

        fs.writeFileSync(declarationFile.replace(/\.d\.ts$/, '.d.mts'), esmContents);
        generated++;
      }

      grunt.log.ok(`Generated ${generated} .d.mts declaration files`);
    },
  );

  grunt.registerTask('build:packages:cdn', 'Bundle the CDN builds of @ably/pubsub-device', function () {
    var done = this.async();

    Promise.all(esbuildConfig.cdnConfigs.map((config) => esbuild.build(config)))
      .then(() => {
        done(true);
      })
      .catch((err) => {
        done(err);
      });
  });

  // The React hooks are compiled with tsc rather than bundled, into one module per source file, so
  // that `@ably/pubsub-device/react` and `@ably/pubsub-device/liveobjects/react` share the module
  // that holds the React context, and with it the client an `PubSubClientProvider` supplies.
  grunt.registerTask(
    'build:packages:react',
    'Compile the React hooks of @ably/pubsub-device',
    execExternal('npm run build:react'),
  );

  // esbuild bundles the Temporal plugin's two entry points with the rest of `@ably/pubsub-server`, but emits no
  // declarations, so tsc emits them from the plugin's source into dist/temporal-types, which the hand-written
  // temporal/index.d.ts and temporal/workflow/index.d.ts re-export.
  grunt.registerTask(
    'build:packages:temporal-types',
    'Emit the declarations of the Temporal plugin of @ably/pubsub-server',
    execExternal('npm run build:temporal:types'),
  );

  // The packages' bundles leave `@ably/pubsub-core` external, so they load its runtime from its build.
  //
  // packages/README.md lists every artifact these tasks publish, so update it when you change them.
  grunt.registerTask('build:packages', [
    'build:core',
    'build:packages:bundle',
    'webpack:reactNative',
    'build:packages:cdn',
    'build:packages:react',
    'build:packages:temporal-types',
    'build:packages:types',
  ]);

  grunt.registerTask('test:webserver', 'Launch the Mocha test web server on http://localhost:3000/', [
    'build:browser',
    'build:push',
    'build:liveobjects',
    'checkGitSubmodules',
    'mocha:webserver',
  ]);

  (function () {
    const baseDir = path.join(__dirname, implDir, 'test', 'package', 'browser');
    const buildDir = path.join(baseDir, 'build');

    grunt.registerTask(
      'test:package:browser:prepare-project',
      'Prepare an app to be used for testing the NPM package in a browser environment',
      function () {
        const done = this.async();

        (async function () {
          if (grunt.file.exists(buildDir)) {
            grunt.file.delete(buildDir);
          }

          // Create an app based on the template
          grunt.file.copy(path.join(baseDir, 'template'), buildDir);

          // Use `npm pack` to generate a .tgz NPM package for the core and for each of the
          // per-side wrapper packages. The wrappers are installed alongside the core, so the app
          // resolves them the way a consumer would, with the core satisfying their exact peer
          // dependency. Their versions move in lockstep with the core's.
          const packDestination = `${implDir}/test/package/browser/build`;
          await execExternalPromises('npm run build');
          await execExternalPromises(
            `npm pack --pack-destination ${packDestination} ./packages/core ./packages/device ./packages/server`,
          );
          const version = grunt.file.readJSON('packages/core/package.json').version;
          const packFileNames = [
            `ably-pubsub-core-${version}.tgz`,
            `ably-pubsub-device-${version}.tgz`,
            `ably-pubsub-server-${version}.tgz`,
          ];

          // Configure app to consume the generated .tgz files
          const pwd = process.cwd();
          process.chdir(buildDir);
          await execExternalPromises(`npm install ${packFileNames.join(' ')}`);

          // Install further dependencies required for testing the app
          await execExternalPromises('npm run test:install-deps');
          process.chdir(pwd);
        })()
          .then(() => done(true))
          .catch((error) => done(error));
      },
    );

    grunt.registerTask('test:package:browser:test', 'Test the NPM package in a browser environment', function () {
      const done = this.async();

      (async function () {
        grunt.task.requires('test:package:browser:prepare-project');

        const pwd = process.cwd();
        process.chdir(buildDir);

        // Perform type checking on TypeScript code that imports ably-js
        await execExternalPromises('npm run typecheck');

        // Build bundle including ably-js
        await execExternalPromises('npm run build');

        // Test that the code which exercises ably-js behaves as expected
        await execExternalPromises('npm run test');

        process.chdir(pwd);
      })()
        .then(() => done(true))
        .catch((error) => done(error));
    });
  })();

  grunt.registerTask('test:package:browser', ['test:package:browser:prepare-project', 'test:package:browser:test']);
  grunt.registerTask('test:package', ['test:package:browser']);

  grunt.registerTask('default', 'all');
};
