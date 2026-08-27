var path = require('path');
var fs = require('fs');
var babel = {
  types: require('@babel/types'),
  parser: require('@babel/parser'),
  traverse: require('@babel/traverse'),
  generator: require('@babel/generator'),
};

// This function is copied from
// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Regular_Expressions#escaping
function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
}

// This esbuild plugin strips all log messages from the modular variant of
// the library, except for error-level logs and other logging statements
// explicitly marked as not to be stripped.
const stripLogsPlugin = {
  name: 'stripLogs',
  setup(build) {
    let foundLogToStrip = false;
    let foundErrorLog = false;
    let foundNoStripLog = false;

    const filter = new RegExp(
      `^${escapeRegExp(path.join(__dirname, '..', '..', 'packages', 'core', 'src') + path.sep)}.*\\.[tj]s$`,
    );
    build.onLoad({ filter }, async (args) => {
      const contents = (await fs.promises.readFile(args.path)).toString();
      const lines = contents.split('\n');
      const ast = babel.parser.parse(contents, { sourceType: 'module', plugins: ['typescript'] });
      const errors = [];

      babel.traverse.default(ast, {
        enter(path) {
          if (
            path.isCallExpression() &&
            babel.types.isMemberExpression(path.node.callee) &&
            babel.types.isIdentifier(path.node.callee.object, { name: 'Logger' })
          ) {
            if (babel.types.isIdentifier(path.node.callee.property, { name: 'logAction' })) {
              const secondArgument = path.node.arguments[1];

              if (
                babel.types.isMemberExpression(secondArgument) &&
                babel.types.isIdentifier(secondArgument.object, { name: 'Logger' }) &&
                secondArgument.property.name.startsWith('LOG_')
              ) {
                if (secondArgument.property.name === 'LOG_ERROR') {
                  // `path` is a call to `Logger.logAction(arg0, Logger.LOG_ERROR, ...)`; preserve it.
                  foundErrorLog = true;
                } else {
                  // `path` is a call to `Logger.logAction(arg0, Logger.LOG_*, ...) for some other log level; strip it.
                  foundLogToStrip = true;
                  path.remove();
                }
              } else {
                // `path` is a call to `Logger.logAction(arg0, ...)` with some argument other than a `Logger.LOG_*` expression; raise an error because we can’t determine whether to strip it.
                errors.push({
                  location: {
                    file: args.path,
                    column: secondArgument.loc.start.column,
                    line: secondArgument.loc.start.line,
                    lineText: lines[secondArgument.loc.start.line - 1],
                  },
                  text: `Second argument passed to Logger.logAction() must be Logger.LOG_*, got \`${
                    babel.generator.default(secondArgument).code
                  }\``,
                });
              }
            } else if (babel.types.isIdentifier(path.node.callee.property, { name: 'logActionNoStrip' })) {
              // `path` is a call to `Logger.logActionNoStrip(...)`; preserve it.
              foundNoStripLog = true;
            }
          }
        },
      });

      return { contents: babel.generator.default(ast).code, loader: 'ts', errors };
    });

    build.onEnd(() => {
      const errorMessages = [];

      // Perform a sense check to make sure that we found some logging
      // calls to strip (to protect us against accidentally changing the
      // internal logging API in such a way that would cause us to no
      // longer strip any calls).

      if (!foundLogToStrip) {
        errorMessages.push('Did not find any Logger.logAction(...) calls to strip');
      }

      // Perform a sense check to make sure that we found some logging
      // calls to preserve (to protect us against accidentally changing the
      // internal logging API in such a way that would cause us to
      // accidentally strip all logging calls).

      if (!foundErrorLog) {
        errorMessages.push('Did not find any Logger.logAction(arg0, Logger.LOG_ERROR, ...) calls to preserve');
      }

      if (!foundNoStripLog) {
        errorMessages.push('Did not find any Logger.logActionNoStrip(...) calls to preserve');
      }

      return { errors: errorMessages.map((text) => ({ text })) };
    });
  },
};

exports.default = stripLogsPlugin;
