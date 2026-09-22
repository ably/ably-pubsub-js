'use strict';

var fs = require('fs');
var path = require('path');
var webpackConfig = require('./webpack.config');
var esbuild = require('esbuild');
var process = require('process');
var MochaServer = require('./packages/core/test/web_server');
var esbuildConfig = require('./grunt/esbuild/build');

module.exports = function (grunt) {
  grunt.loadNpmTasks('grunt-webpack');

  // Grunt runs from the monorepo root, but most of what it builds is the core package, so its
  // paths are written relative to this rather than to the root.
  var coreDir = 'packages/core';

  var dirs = {
    common: coreDir + '/src/common',
    browser: coreDir + '/src/platform/web',
    fragments: coreDir + '/src/platform/web/fragments',
    static: coreDir + '/build',
    dest: coreDir + '/build',
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
      all: Object.values(webpackConfig),
      browser: [webpackConfig.browser, webpackConfig.browserMin, webpackConfig.mochaJUnitReporterBrowser],
    },
  };

  grunt.initConfig(gruntConfig);

  grunt.registerTask('checkGitSubmodules', 'Check, if git submodules are properly installed', function () {
    var done = this.async();
    var pathToSubmodule = path.join(__dirname, coreDir, 'test', 'common', 'ably-common');
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
    'webpack:all',
    'build:browser',
    'build:node',
    'build:push',
    'build:react-native-push',
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

  grunt.registerTask('build:browser', function () {
    var done = this.async();

    Promise.all([
      esbuild.build(esbuildConfig.webConfig),
      esbuild.build(esbuildConfig.minifiedWebConfig),
      esbuild.build(esbuildConfig.modularConfig),
    ])
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

    Promise.all([
      esbuild.build(esbuildConfig.pushPluginConfig),
      esbuild.build(esbuildConfig.pushPluginCdnConfig),
      esbuild.build(esbuildConfig.minifiedPushPluginCdnConfig),
    ])
      .then(() => {
        done(true);
      })
      .catch((err) => {
        done(err);
      });
  });

  grunt.registerTask('build:react-native-push', function () {
    var done = this.async();

    esbuild
      .build(esbuildConfig.reactNativePushPluginConfig)
      .then(() => {
        done(true);
      })
      .catch((err) => {
        done(err);
      });
  });

  grunt.registerTask('build:liveobjects:bundle', function () {
    var done = this.async();

    Promise.all([
      esbuild.build(esbuildConfig.liveObjectsPluginConfig),
      esbuild.build(esbuildConfig.liveObjectsPluginEsmConfig),
      esbuild.build(esbuildConfig.liveObjectsPluginCdnConfig),
      esbuild.build(esbuildConfig.minifiedLiveObjectsPluginCdnConfig),
    ])
      .then(() => {
        done(true);
      })
      .catch((err) => {
        done(err);
      });
  });

  grunt.registerTask(
    'build:liveobjects:types',
    'Generate liveobjects.d.mts from liveobjects.d.ts by adding .js extensions to relative imports',
    function () {
      const dtsContent = fs.readFileSync(coreDir + '/liveobjects.d.ts', 'utf8');
      const mtsContent = dtsContent.replace(/from '(\.\/[^']+)'/g, "from '$1.js'");
      fs.writeFileSync(coreDir + '/liveobjects.d.mts', mtsContent);
      grunt.log.ok('Generated liveobjects.d.mts from liveobjects.d.ts');
    },
  );

  grunt.registerTask('build:liveobjects', ['build:liveobjects:bundle', 'build:liveobjects:types']);

  grunt.registerTask('build:packages:bundle', 'Bundle the per-side Pub/Sub wrapper packages', function () {
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
  // A straight copy is enough, unlike the core's equivalent step for liveobjects.d.mts, which has
  // to rewrite relative imports: every declaration file in these packages imports the core by bare
  // specifier only, and those resolve identically under both module systems. Every one of them also
  // exports under a name rather than with `export =`, which has no ESM spelling and so could not be
  // copied.
  grunt.registerTask(
    'build:packages:types',
    'Generate the .d.mts counterpart of each wrapper package declaration file',
    function () {
      const declarationFiles = grunt.file.expand(['packages/device/**/index.d.ts', 'packages/server/**/index.d.ts']);

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

        fs.writeFileSync(declarationFile.replace(/\.d\.ts$/, '.d.mts'), contents);
        generated++;
      }

      grunt.log.ok(`Generated ${generated} .d.mts declaration files`);
    },
  );

  grunt.registerTask('build:packages', ['build:packages:bundle', 'build:packages:types']);

  grunt.registerTask('test:webserver', 'Launch the Mocha test web server on http://localhost:3000/', [
    'build:browser',
    'build:push',
    'build:liveobjects',
    'checkGitSubmodules',
    'mocha:webserver',
  ]);

  (function () {
    const baseDir = path.join(__dirname, coreDir, 'test', 'package', 'browser');
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
          const packDestination = `${coreDir}/test/package/browser/build`;
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
