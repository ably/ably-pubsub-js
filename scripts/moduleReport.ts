import * as esbuild from 'esbuild';
import * as path from 'path';
import { explore } from 'source-map-explorer';
import { promisify } from 'util';
import { gzip } from 'zlib';
import Table from 'cli-table';

// Every bundle path and module name in this file is written relative to the core package, so every
// esbuild call below is given that as its working directory. Changing this process's own cwd is not
// enough: esbuild-runner has already started the esbuild service by the time this module is
// evaluated, and the service keeps the working directory it was started with.
const coreDir = path.join(__dirname, '..', 'packages', 'core');

// The maximum size we allow for a minimal useful Realtime bundle (i.e. one that can subscribe to a channel)
const minimalUsefulRealtimeBundleSizeThresholdsKiB = { raw: 122, gzip: 37 };

const baseClientNames = ['BaseRest', 'BaseRealtime'];

// List of all plugins accepted in ModularPlugins
const pluginNames = [
  'Rest',
  'Crypto',
  'MsgPack',
  'RealtimePresence',
  'XHRPolling',
  'WebSocketTransport',
  'XHRRequest',
  'FetchRequest',
  'MessageInteractions',
];

// List of all free-standing functions exported by the library along with the
// ModularPlugins entries that we expect them to transitively import
const functions = [
  { name: 'generateRandomKey', transitiveImports: ['Crypto'] },
  { name: 'getDefaultCryptoParams', transitiveImports: ['Crypto'] },
  { name: 'decodeMessage', transitiveImports: [] },
  { name: 'decodeEncryptedMessage', transitiveImports: ['Crypto'] },
  { name: 'decodeMessages', transitiveImports: [] },
  { name: 'decodeEncryptedMessages', transitiveImports: ['Crypto'] },
  { name: 'decodePresenceMessage', transitiveImports: [] },
  { name: 'decodePresenceMessages', transitiveImports: [] },
  { name: 'decodeEncryptedPresenceMessage', transitiveImports: ['Crypto'] },
  { name: 'decodeEncryptedPresenceMessages', transitiveImports: ['Crypto'] },
  { name: 'constructPresenceMessage', transitiveImports: [] },
];

// List of all buildable plugins available as a separate export
interface PluginInfo {
  description: string;
  path: string;
  external?: string[];
}

const buildablePlugins: Record<'push' | 'reactNativePush' | 'liveobjects', PluginInfo> = {
  push: { description: 'Push', path: './build/push.js', external: ['ulid'] },
  reactNativePush: {
    description: 'ReactNativePush',
    path: './build/react-native-push.js',
    external: ['ulid', 'react-native'],
  },
  liveobjects: { description: 'LiveObjects', path: './build/liveobjects.js', external: ['dequal'] },
};

function formatBytes(bytes: number) {
  const kibibytes = bytes / 1024;
  const formatted = kibibytes.toFixed(2);
  return `${formatted} KiB`;
}

interface BundleInfo {
  byteSize: number;
  code: Uint8Array;
  sourceMap: Uint8Array;
}

interface ByteSizes {
  rawByteSize: number;
  gzipEncodedByteSize: number;
}

interface TableRow {
  description: string;
  sizes: ByteSizes;
}

interface Output {
  tableRows: TableRow[];
  errors: Error[];
}

// Uses esbuild to create a bundle containing the named exports from '@ably/pubsub-core/modular'
function getModularBundleInfo(exports: string[]): BundleInfo {
  return getBundleInfo('./build/modular/index.mjs', exports);
}

// Uses esbuild to create a bundle containing the named exports from a given module
function getBundleInfo(modulePath: string, exports?: string[], external?: string[]): BundleInfo {
  const outfile = exports ? exports.join('') : 'all';
  const exportTarget = exports ? `{ ${exports.join(', ')} }` : '*';
  const result = esbuild.buildSync({
    absWorkingDir: coreDir,
    stdin: {
      contents: `export ${exportTarget} from '${modulePath}'`,
      resolveDir: coreDir,
    },
    metafile: true,
    minify: true,
    bundle: true,
    outfile,
    write: false,
    sourcemap: 'external',
    external,
  });

  const pathHasBase = (component: string) => {
    return (outputFile: esbuild.OutputFile) => {
      return path.parse(outputFile.path).base === component;
    };
  };

  const codeOutputFile = result.outputFiles.find(pathHasBase(outfile))!;
  const sourceMapOutputFile = result.outputFiles.find(pathHasBase(`${outfile}.map`))!;

  return {
    byteSize: result.metafile.outputs[outfile].bytes,
    code: codeOutputFile.contents,
    sourceMap: sourceMapOutputFile.contents,
  };
}

// Gets the bundled size in bytes of an array of named exports from '@ably/pubsub-core/modular'
async function getModularImportSizes(exports: string[]): Promise<ByteSizes> {
  const bundleInfo = getModularBundleInfo(exports);

  return {
    rawByteSize: bundleInfo.byteSize,
    // I’m trusting that the default settings of the `gzip` function (e.g. compression level) are somewhat representative of how gzip compression is normally used when serving files in the real world
    gzipEncodedByteSize: (await promisify(gzip)(bundleInfo.code)).byteLength,
  };
}

async function runSourceMapExplorer(bundleInfo: BundleInfo) {
  return explore({
    code: Buffer.from(bundleInfo.code),
    map: Buffer.from(bundleInfo.sourceMap),
  });
}

async function calculateAndCheckExportSizes(): Promise<Output> {
  const output: Output = { tableRows: [], errors: [] };

  for (const baseClient of baseClientNames) {
    const baseClientSizes = await getModularImportSizes([baseClient]);

    // First output the size of the base client
    output.tableRows.push({ description: baseClient, sizes: baseClientSizes });

    // Then output the size of each export together with the base client
    for (const exportName of [...pluginNames, ...functions.map((functionData) => functionData.name)]) {
      const sizes = await getModularImportSizes([baseClient, exportName]);
      output.tableRows.push({ description: `${baseClient} + ${exportName}`, sizes });

      if (!(baseClientSizes.rawByteSize < sizes.rawByteSize) && !(baseClient === 'BaseRest' && exportName === 'Rest')) {
        // Emit an error if adding the export does not increase the bundle size
        // (this means that the export is not being tree-shaken correctly).
        output.errors.push(new Error(`Adding ${exportName} to ${baseClient} does not increase the bundle size.`));
      }
    }
  }

  return output;
}

async function calculateAndCheckFunctionSizes(): Promise<Output> {
  const output: Output = { tableRows: [], errors: [] };

  for (const functionData of functions) {
    const { name: functionName, transitiveImports } = functionData;

    // First output the size of the function
    const standaloneSizes = await getModularImportSizes([functionName]);
    output.tableRows.push({ description: functionName, sizes: standaloneSizes });

    // Then output the size of the function together with the plugin we expect
    // it to transitively import
    if (transitiveImports.length > 0) {
      const withTransitiveImportsSizes = await getModularImportSizes([functionName, ...transitiveImports]);
      output.tableRows.push({
        description: `${functionName} + ${transitiveImports.join(' + ')}`,
        sizes: withTransitiveImportsSizes,
      });

      if (withTransitiveImportsSizes.rawByteSize > standaloneSizes.rawByteSize) {
        // Emit an error if the bundle size is increased by adding the plugins
        // that we expect this function to have transitively imported anyway.
        // This seemed like a useful sense check, but it might need tweaking in
        // the future if we make future optimisations that mean that the
        // standalone functions don’t necessarily import the whole plugin.
        output.errors.push(
          new Error(
            `Adding ${transitiveImports.join(' + ')} to ${functionName} unexpectedly increases the bundle size.`,
          ),
        );
      }
    }
  }

  return output;
}

async function calculatePluginSize(options: PluginInfo): Promise<Output> {
  const output: Output = { tableRows: [], errors: [] };
  const pluginBundleInfo = getBundleInfo(options.path, undefined, options.external);
  const sizes = {
    rawByteSize: pluginBundleInfo.byteSize,
    gzipEncodedByteSize: (await promisify(gzip)(pluginBundleInfo.code)).byteLength,
  };

  output.tableRows.push({
    description: options.description,
    sizes: sizes,
  });

  return output;
}

async function calculatePushPluginSize(): Promise<Output> {
  return calculatePluginSize(buildablePlugins.push);
}

async function calculateReactNativePushPluginSize(): Promise<Output> {
  return calculatePluginSize(buildablePlugins.reactNativePush);
}

async function calculateLiveObjectsPluginSize(): Promise<Output> {
  return calculatePluginSize(buildablePlugins.liveobjects);
}

async function calculateAndCheckMinimalUsefulRealtimeBundleSize(): Promise<Output> {
  const output: Output = { tableRows: [], errors: [] };

  const exports = ['BaseRealtime', 'FetchRequest', 'WebSocketTransport'];
  const sizes = await getModularImportSizes(exports);

  output.tableRows.push({ description: `Minimal useful Realtime (${exports.join(' + ')})`, sizes });

  if (sizes.rawByteSize > minimalUsefulRealtimeBundleSizeThresholdsKiB.raw * 1024) {
    output.errors.push(
      new Error(
        `Minimal raw useful Realtime bundle is ${formatBytes(
          sizes.rawByteSize,
        )}, which is greater than allowed maximum of ${minimalUsefulRealtimeBundleSizeThresholdsKiB.raw} KiB.`,
      ),
    );
  }

  if (sizes.gzipEncodedByteSize > minimalUsefulRealtimeBundleSizeThresholdsKiB.gzip * 1024) {
    output.errors.push(
      new Error(
        `Minimal gzipped useful Realtime bundle is ${formatBytes(
          sizes.gzipEncodedByteSize,
        )}, which is greater than allowed maximum of ${minimalUsefulRealtimeBundleSizeThresholdsKiB.gzip} KiB.`,
      ),
    );
  }

  return output;
}

async function calculateAllExportsBundleSize(): Promise<Output> {
  const exports = [...baseClientNames, ...pluginNames, ...functions.map((val) => val.name)];
  const sizes = await getModularImportSizes(exports);

  return { tableRows: [{ description: 'All exports', sizes }], errors: [] };
}

// Performs a sense check that there are no unexpected files making a large contribution to the BaseRealtime bundle size.
async function checkBaseRealtimeFiles() {
  const baseRealtimeBundleInfo = getModularBundleInfo(['BaseRealtime']);

  // The threshold is chosen pretty arbitrarily. There are some files (e.g. presencemessage.ts) whose bulk should not be included in the BaseRealtime bundle, but which make a small contribution to the bundle (probably because we make use of one exported constant or something; I haven’t looked into it).
  const thresholdBytes = 100;

  // These are the files that are allowed to contribute >= `threshold` bytes to the BaseRealtime bundle.
  const allowedFiles = new Set([
    'src/common/constants/HttpStatusCodes.ts',
    'src/common/constants/XHRStates.ts',
    'src/common/lib/client/auth.ts',
    'src/common/lib/client/baseclient.ts',
    'src/common/lib/client/baserealtime.ts',
    'src/common/lib/client/channelstatechange.ts',
    'src/common/lib/client/connection.ts',
    'src/common/lib/client/connectionstatechange.ts',
    'src/common/lib/client/realtimechannel.ts',
    'src/common/lib/transport/connectionerrors.ts',
    'src/common/lib/transport/connectionmanager.ts',
    'src/common/lib/transport/messagequeue.ts',
    'src/common/lib/transport/protocol.ts',
    'src/common/lib/transport/transport.ts',
    'src/common/lib/types/errorinfo.ts',
    'src/common/lib/types/message.ts',
    'src/common/lib/types/basemessage.ts',
    'src/common/lib/types/protocolmessage.ts',
    'src/common/lib/types/protocolmessagecommon.ts',
    'src/common/lib/types/pushchannelsubscription.ts', // TODO why? https://github.com/ably/ably-js/issues/1506
    'src/common/lib/util/defaults.ts',
    'src/common/lib/util/eventemitter.ts',
    'src/common/lib/util/logger.ts',
    'src/common/lib/util/multicaster.ts',
    'src/common/lib/util/utils.ts',
    'src/common/types/http.ts',
    'src/platform/web/config.ts',
    'src/platform/web/lib/http/http.ts',
    'src/platform/web/lib/util/bufferutils.ts',
    'src/platform/web/lib/util/defaults.ts',
    'src/platform/web/lib/util/hmac-sha256.ts',
    'src/platform/web/lib/util/webstorage.ts',
    'src/platform/web/modular.ts',
  ]);

  return checkBundleFiles(baseRealtimeBundleInfo, allowedFiles, thresholdBytes);
}

async function checkPushPluginFiles() {
  const { path, external } = buildablePlugins.push;
  const pushPluginBundleInfo = getBundleInfo(path, undefined, external);

  // These are the files that are allowed to contribute >= `threshold` bytes to the Push bundle.
  const allowedFiles = new Set([
    'src/plugins/push/index.ts',
    'src/plugins/push/pushchannel.ts',
    'src/plugins/push/getW3CDeviceDetails.ts',
    'src/plugins/push/pushactivation.ts',
  ]);

  return checkBundleFiles(pushPluginBundleInfo, allowedFiles, 100);
}

async function checkReactNativePushPluginFiles() {
  const { path, external } = buildablePlugins.reactNativePush;
  const pluginBundleInfo = getBundleInfo(path, undefined, external);

  // These are the files that are allowed to contribute >= `threshold` bytes to the ReactNativePush
  // bundle. The plugin re-exports the push plugin's state machine, so the push files appear too.
  const allowedFiles = new Set([
    'src/plugins/react-native-push/index.ts',
    'src/plugins/react-native-push/getReactNativePushDeviceDetails.ts',
    'src/plugins/push/pushchannel.ts',
    'src/plugins/push/getW3CDeviceDetails.ts',
    'src/plugins/push/pushactivation.ts',
  ]);

  return checkBundleFiles(pluginBundleInfo, allowedFiles, 100);
}

async function checkLiveObjectsPluginFiles() {
  const { path, external } = buildablePlugins.liveobjects;
  const pluginBundleInfo = getBundleInfo(path, undefined, external);

  // These are the files that are allowed to contribute >= `threshold` bytes to the LiveObjects bundle.
  const allowedFiles = new Set([
    'src/plugins/liveobjects/batchcontext.ts',
    'src/plugins/liveobjects/index.ts',
    'src/plugins/liveobjects/instance.ts',
    'src/plugins/liveobjects/livecounter.ts',
    'src/plugins/liveobjects/livecountervaluetype.ts',
    'src/plugins/liveobjects/livemap.ts',
    'src/plugins/liveobjects/livemapvaluetype.ts',
    'src/plugins/liveobjects/liveobject.ts',
    'src/plugins/liveobjects/objectid.ts',
    'src/plugins/liveobjects/objectmessage.ts',
    'src/plugins/liveobjects/objectspool.ts',
    'src/plugins/liveobjects/pathobject.ts',
    'src/plugins/liveobjects/pathobjectsubscriptionregister.ts',
    'src/plugins/liveobjects/realtimeobject.ts',
    'src/plugins/liveobjects/restobject.ts',
    'src/plugins/liveobjects/rootbatchcontext.ts',
    'src/plugins/liveobjects/syncobjectspool.ts',
  ]);

  return checkBundleFiles(pluginBundleInfo, allowedFiles, 100);
}

async function checkBundleFiles(bundleInfo: BundleInfo, allowedFiles: Set<string>, thresholdBytes: number) {
  const exploreResult = await runSourceMapExplorer(bundleInfo);

  const files = exploreResult.bundles[0].files;
  delete files['[sourceMappingURL]'];
  delete files['[unmapped]'];
  delete files['[EOLs]'];

  const filesAboveThreshold = Object.entries(files).filter((file) => file[1].size >= thresholdBytes);

  const errors: Error[] = [];

  // Check that no files other than those allowed above make a large contribution to the bundle size
  for (const file of filesAboveThreshold) {
    if (!allowedFiles.has(file[0])) {
      errors.push(
        new Error(
          `Unexpected file ${file[0]}, contributes ${file[1].size}B to bundle, more than allowed ${thresholdBytes}B`,
        ),
      );
    }
  }

  // Check that there are no stale entries in the allowed list
  for (const allowedFile of Array.from(allowedFiles)) {
    const file = files[allowedFile];

    if (file) {
      if (file.size < thresholdBytes) {
        errors.push(
          new Error(
            `File ${allowedFile} contributes ${file.size}B, which is less than the expected minimum of ${thresholdBytes}B. Remove it from the \`allowedFiles\` list.`,
          ),
        );
      }
    } else {
      errors.push(new Error(`File ${allowedFile} is referenced in \`allowedFiles\` but does not contribute to bundle`));
    }
  }

  return errors;
}

(async function run() {
  const output = (
    await Promise.all([
      calculateAndCheckMinimalUsefulRealtimeBundleSize(),
      calculateAllExportsBundleSize(),
      calculateAndCheckExportSizes(),
      calculateAndCheckFunctionSizes(),
      calculatePushPluginSize(),
      calculateReactNativePushPluginSize(),
      calculateLiveObjectsPluginSize(),
    ])
  ).reduce((accum, current) => ({
    tableRows: [...accum.tableRows, ...current.tableRows],
    errors: [...accum.errors, ...current.errors],
  }));

  output.errors.push(...(await checkBaseRealtimeFiles()));
  output.errors.push(...(await checkPushPluginFiles()));
  output.errors.push(...(await checkReactNativePushPluginFiles()));
  output.errors.push(...(await checkLiveObjectsPluginFiles()));

  const table = new Table({
    style: { head: ['green'] },
    head: ['Exports', 'Size (raw, KiB)', 'Size (gzipped, KiB)'],
    rows: output.tableRows.map((row) => [
      row.description,
      formatBytes(row.sizes.rawByteSize),
      formatBytes(row.sizes.gzipEncodedByteSize),
    ]),
  });
  console.log(table.toString());

  if (output.errors.length > 0) {
    for (const error of output.errors) {
      console.log(error.message);
    }
    process.exit(1);
  }
})();
