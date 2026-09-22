import Table from 'cli-table';
import dox from 'dox';
import fs from 'fs';
import { glob } from 'glob';
import { exit } from 'process';

const ABLY_FEATURES_SPEC_URL = 'https://raw.githubusercontent.com/ably/specification/main/specifications/features.md';
const PATHS_TO_LOOK_FOR_TESTS = ['./packages/core/test', './packages/core/src/platform/react-hooks'];
const PATHS_TO_IGNORE_FOR_TESTS = ['./packages/core/test/common/ably-common'];

enum SpecCoverageType {
  spec = 'spec',
  specpartial = 'specpartial',
  nospec = 'nospec',
  specskip = 'specskip',
}

interface SpecItem {
  level: number;
  key: string;
  description: string;
}

interface TestSpecCoverage {
  coverageType: SpecCoverageType.spec | SpecCoverageType.specpartial | SpecCoverageType.nospec;
  /**
   * Spec item key covered by the test, if applicable based on {@link coverageType} value.
   */
  specKey?: string;
  /**
   * An optional comment for tagged spec item. Looks like this in test docstrings:
   *
   * `@spec ID123 - [comment]`
   */
  coverageDescription?: string;
  testCode: string;
}

interface SpecItemCoverageStatus {
  hasFullCoverage: boolean;
  hasPartialCoverage: boolean;
  testsContributingToFullCoverageCount: number;
  testsContributingToPartialCoverageCount: number;
}

class SpecItemNode implements SpecItem {
  public level: number;
  public key: string;
  public description: string;
  public parentNode: SpecItemNode | null = null;
  public childNodes: SpecItemNode[] = [];
  public specCoverages: TestSpecCoverage[] = [];
  private _coverageStatus: SpecItemCoverageStatus | null = null;

  constructor(specItem: SpecItem) {
    this.level = specItem.level;
    this.key = specItem.key;
    this.description = specItem.description;
  }

  public isRoot(): boolean {
    return this.parentNode == null;
  }

  public isLeaf(): boolean {
    return this.childNodes.length === 0;
  }

  public isFullyCovered(): boolean {
    return this.getCoverageStatus().hasFullCoverage;
  }

  public isPartiallyCovered(): boolean {
    return this.getCoverageStatus().hasPartialCoverage;
  }

  public getCoverageStatus(): SpecItemCoverageStatus {
    if (this._coverageStatus != null) {
      return this._coverageStatus;
    }

    // there is currently no indication in the spec document regarding which items should be explicitly tested or not,
    // nor how we should infer test coverage for a parent spec item based on their sub-items.
    // thus, for now, to calculate coverage for a spec item, we simply check the associated tests for it.
    // The future alternative (and the better one) would be to have some metadata provided alongside the spec document,
    // indicating which spec items are testable and which are purely informational or structural,
    // as well as the rules for handling the coverage status for a parent item with its sub-items.

    // spec item can be fully covered only by tests marked with `@spec` tag
    const testsContributingToFullCoverageCount = this.specCoverages.filter(
      (x) => x.coverageType === SpecCoverageType.spec,
    ).length;
    // spec item is at least partially covered if there are tests with either `@spec` or `@specpartial` tag
    const testsContributingToPartialCoverageCount = this.specCoverages.filter(
      (x) => x.coverageType === SpecCoverageType.spec || x.coverageType === SpecCoverageType.specpartial,
    ).length;

    this._coverageStatus = {
      hasFullCoverage: testsContributingToFullCoverageCount > 0,
      hasPartialCoverage: testsContributingToPartialCoverageCount > 0,
      testsContributingToFullCoverageCount: testsContributingToFullCoverageCount,
      testsContributingToPartialCoverageCount: testsContributingToPartialCoverageCount,
    };
    return this._coverageStatus;
  }

  public getLinkToSpecItem(): string {
    return `https://sdk.ably.com/builds/ably/specification/main/features/#${this.key}`;
  }

  public toSpecItemView(): SpecItem {
    return {
      level: this.level,
      key: this.key,
      description: this.description,
    };
  }

  public toStringView(): string {
    let specItemLine = '';

    specItemLine += new Array(this.level - 1).fill('    ').join('');
    specItemLine += `(${this.key})`;
    specItemLine += ` ${this.description}`;

    return specItemLine;
  }

  public toJSON(): object {
    return {
      ...this.toSpecItemView(),
      parentNode: this.parentNode?.toSpecItemView(),
      childNodes: this.childNodes,
      specCoverages: this.specCoverages,
    };
  }
}

class SpecItemNodesCollection {
  public allNodesByKeyMap: Map<string, SpecItemNode> = new Map();

  constructor(specItems: SpecItem[]) {
    this._createNodesCollection(specItems);
  }

  public getRootNodes(): SpecItemNode[] {
    const rootNodes: SpecItemNode[] = [];
    for (const node of this.allNodesByKeyMap.values()) {
      if (node.isRoot()) {
        rootNodes.push(node);
      }
    }
    return rootNodes;
  }

  public getNodesArray(): SpecItemNode[] {
    return [...this.allNodesByKeyMap.values()];
  }

  public getSpecItemLinesView(): string[] {
    return [...this.allNodesByKeyMap.values()].map((x) => x.toStringView());
  }

  public toJSON(): Record<string, SpecItemNode> {
    return [...this.allNodesByKeyMap.entries()].reduce(
      (acc, [key, node]) => {
        acc[key] = node;
        return acc;
      },
      {} as Record<string, SpecItemNode>,
    );
  }

  private _createNodesCollection(specItems: SpecItem[]): void {
    let previousNode: SpecItemNode | null = null;

    for (const specItem of specItems) {
      // we always add new spec item node to the map with all nodes
      const node = new SpecItemNode(specItem);
      this.allNodesByKeyMap.set(specItem.key, node);

      // and then use spec item's levels to create correct connections between nodes
      if (!previousNode) {
        // first ever spec item, it's always root level without a parent, do nothing
      } else if (specItem.level > previousNode.level) {
        // new spec item has higher level value, it means we found a child node for a previous node
        node.parentNode = previousNode;
        node.parentNode.childNodes.push(node);
      } else if (specItem.level === previousNode.level) {
        // spec items with the same level are added to the same parent node if it exists
        node.parentNode = previousNode.parentNode;
        node.parentNode?.childNodes.push(node);
      } else {
        // new spec item has lower level value, it means we ended adding child nodes to the current parent
        // and need to go a number of levels up depending on the difference between current and previous node levels.
        // for example, previous node may have been at level 4 (**** spec item), and now we are back to root level (* spec item)
        const levelDifference = previousNode.level - node.level;
        let newParentNode: SpecItemNode | null = previousNode.parentNode;
        // go up in parents N times, where N = difference between node levels
        new Array(levelDifference).fill(0).forEach(() => (newParentNode = newParentNode?.parentNode ?? null));

        node.parentNode = newParentNode;
        node.parentNode?.childNodes.push(node);
      }

      previousNode = node;
    }
  }
}

async function loadSpecMarkdown(): Promise<string> {
  const response = await fetch(ABLY_FEATURES_SPEC_URL);
  if (!response.ok) {
    throw new Error(
      `Failed to load Ably features spec from url: ${ABLY_FEATURES_SPEC_URL}, response status: ${response.status} ${response.statusText}`,
    );
  }

  const spec = await response.text();
  console.log(`Successfully loaded Ably features spec markdown from url: ${ABLY_FEATURES_SPEC_URL}`);

  return spec;
}

function specMarkdownToOrderedSpecItems(specMarkdown: string): SpecItem[] {
  // regexp below matches any lines that look like this:
  // - `(TB2)` Some description
  // this is how all spec items are formatted in the spec markdown file
  const specItemRegexp = /^(\s*)- `\((\w+)\)`\s*(.*)/;
  const specLines = specMarkdown.split('\n');
  const specItems: SpecItem[] = [];

  specLines.forEach((x) => {
    const regexpResult = specItemRegexp.exec(x);
    if (!regexpResult) {
      return;
    }

    const [_, leadingSpaces, key, description] = regexpResult;
    // spec item level in the markdown is formatted as indentation with 2 spaces per level
    // we use the number of leading spaces divided by 2, plus 1, as the spec item level
    const parsedLevel = Math.floor(leadingSpaces.length / 2) + 1;

    specItems.push({
      level: parsedLevel,
      key,
      description,
    });
  });

  console.log(`Parsed ${specItems.length} spec items from the Ably features specification markdown file`);

  return specItems;
}

async function getTestFilePaths(): Promise<string[]> {
  const globPatterns = PATHS_TO_LOOK_FOR_TESTS.map((path) => `${path}/**/*.test.{js,ts,jsx,tsx}`);
  const ignorePatterns = PATHS_TO_IGNORE_FOR_TESTS.map((path) => `${path}/**`);
  const testFiles = await glob(globPatterns, {
    ignore: ignorePatterns,
  });

  console.log(`Found ${testFiles.length} test files matching glob patterns`, testFiles);

  return testFiles;
}

function parseDocstringsForFile(filePath: string): dox.Comment[] {
  const fileContent = fs.readFileSync(filePath).toString();
  const docstrings = dox.parseComments(fileContent, {});
  return docstrings;
}

function getSpecCoveragesFromDocstrings(docstrings: dox.Comment[]): TestSpecCoverage[] {
  const specCoverages: TestSpecCoverage[] = [];

  for (const docstring of docstrings) {
    if (docstring.tags.findIndex((x) => x.type === SpecCoverageType.specskip) !== -1) {
      // tests marked with `@specskip` tag should not contribute to spec coverage metrics, so skip them
      continue;
    }
    specCoverages.push(...docstringToSpecCoverages(docstring));
  }

  return specCoverages;
}

function docstringToSpecCoverages(docstring: dox.Comment): TestSpecCoverage[] {
  const parseableTags = new Set(Object.values(SpecCoverageType) as string[]);
  const specCoverages: TestSpecCoverage[] = [];

  for (const tag of docstring.tags) {
    if (!parseableTags.has(tag.type)) {
      continue;
    }

    const tagType = tag.type;
    switch (tagType) {
      case SpecCoverageType.spec:
      case SpecCoverageType.specpartial:
        const { specKey, coverageDescription } = parseSpecTagString(tag.string);
        specCoverages.push({
          coverageType: tagType,
          specKey,
          coverageDescription,
          testCode: docstring.code,
        });
        break;

      case SpecCoverageType.nospec:
        specCoverages.push({
          coverageType: tagType,
          testCode: docstring.code,
        });
        break;

      case SpecCoverageType.specskip:
        throw new Error(
          `Converting docstring to spec coverages which is marked with '@${
            SpecCoverageType.specskip
          }' is not allowed: ${JSON.stringify(docstring)}`,
        );
    }
  }

  return specCoverages;
}

function parseSpecTagString(str: string): { specKey: string; coverageDescription?: string } {
  // spec tags strings are written in format:
  // RSC19f[ - optional description]
  const specTagStringRegexp = /(\w+)(\s+-\s+(.*))?/;
  const regexpResult = specTagStringRegexp.exec(str);
  if (!regexpResult) {
    throw new Error(
      `Unexpected spec tag string format received: ${str}. Expected it to be in the format: SPEC_ITEM_ID[ - OPTIONAL_DESCRIPTION]`,
    );
  }

  const [_, specKey, __, coverageDescription] = regexpResult;
  return {
    specKey,
    coverageDescription,
  };
}

function applySpecCoveragesToSpecItemsCollection(
  collection: SpecItemNodesCollection,
  specCoverages: TestSpecCoverage[],
): void {
  for (const specCoverage of specCoverages) {
    if (specCoverage.coverageType === SpecCoverageType.nospec) {
      continue;
    }

    const node = collection.allNodesByKeyMap.get(specCoverage.specKey!);
    if (!node) {
      throw new Error(
        `Unknown spec item key found in tests' docstrings: ${specCoverage.specKey}, for test code string: ${specCoverage.testCode}`,
      );
    }

    node.specCoverages.push(specCoverage);
  }
}

function specItemsCollectionToCoverageTable(collection: SpecItemNodesCollection): Table {
  const table = new Table({
    style: { head: ['green'] },
    head: ['Spec', 'Coverage Status', 'Coverage (full)', 'Coverage (partial)', 'Spec Link'],
    rows: collection.getRootNodes().flatMap((node) => specItemNodeToTableRows(node, [])),
  });
  return table;
}

function specItemNodeToTableRows(node: SpecItemNode, tableRows: [string, string, string, string, string][]) {
  const indentation = new Array(node.level - 1).fill('  ').join('');
  const {
    hasFullCoverage,
    hasPartialCoverage,
    testsContributingToFullCoverageCount,
    testsContributingToPartialCoverageCount,
  } = node.getCoverageStatus();
  const coverageStatusText = hasFullCoverage ? 'Full' : hasPartialCoverage ? 'Partial' : 'None';
  const coverageStatusEmoji = hasFullCoverage ? '✔️' : hasPartialCoverage ? '🟡' : '🔴';

  tableRows.push([
    `${indentation}${node.key}`,
    `${coverageStatusEmoji} ${coverageStatusText}`,
    `${hasFullCoverage ? 'Yes' : 'No'} (${testsContributingToFullCoverageCount} tests)`,
    `${hasPartialCoverage ? 'Yes' : 'No'} (${testsContributingToPartialCoverageCount} tests)`,
    node.getLinkToSpecItem(),
  ]);
  node.childNodes.forEach((x) => specItemNodeToTableRows(x, tableRows));

  return tableRows;
}

function roundTo(num: number, digits: number): number {
  const multiplicator = Math.pow(10, digits);
  const multiplied = parseFloat((num * multiplicator).toFixed(11));
  const res = Math.round(multiplied) / multiplicator;
  return res;
}

function printGeneralCoverageMetrics(collection: SpecItemNodesCollection): void {
  const total = collection.allNodesByKeyMap.size;
  const fullyCovered = collection.getNodesArray().filter((x) => x.isFullyCovered()).length;
  const partiallyCovered = collection.getNodesArray().filter((x) => x.isPartiallyCovered()).length;
  const notCovered = total - partiallyCovered;

  console.log(
    `Out of all ${total} spec items` +
      ` ${fullyCovered} (${roundTo((fullyCovered / total) * 100, 2)}%) are fully covered by tests,` +
      ` and ${partiallyCovered} (${roundTo((partiallyCovered / total) * 100, 2)}%)` +
      ` are at least partially covered by tests.` +
      ` ${notCovered} (${roundTo((notCovered / total) * 100, 2)}%) spec items in total` +
      ` do not have an associated test.`,
  );

  const leafNodes = collection.getNodesArray().filter((x) => x.isLeaf());
  const totalLeaves = leafNodes.length;
  const fullyCoveredLeaves = leafNodes.filter((x) => x.isFullyCovered()).length;
  const partiallyCoveredLeaves = leafNodes.filter((x) => x.isPartiallyCovered()).length;
  const notCoveredLeaves = totalLeaves - partiallyCoveredLeaves;

  console.log(
    `Out of ${totalLeaves} leaf spec items` +
      ` ${fullyCoveredLeaves} (${roundTo((fullyCoveredLeaves / totalLeaves) * 100, 2)}%) are fully covered by tests,` +
      ` and ${partiallyCoveredLeaves} (${roundTo((partiallyCoveredLeaves / totalLeaves) * 100, 2)}%)` +
      ` are at least partially covered by tests.` +
      ` ${notCoveredLeaves} (${roundTo((notCoveredLeaves / totalLeaves) * 100, 2)}%) leaf spec items in total` +
      ` do not have an associated test.`,
  );
}

function printNoSpecMetrics(specCoverages: TestSpecCoverage[]): void {
  const nospecCount = specCoverages.filter((x) => x.coverageType === SpecCoverageType.nospec).length;

  console.log(`Total of ${nospecCount} test cases are not associated with any spec item (marked with \`@nospec\`).`);
}

function printCoverageTableForAllSpecItems(collection: SpecItemNodesCollection): void {
  const table = specItemsCollectionToCoverageTable(collection);
  console.log(`Coverage table for all spec items:`);
  console.log(table.toString());
}

(async function main() {
  const paths = await getTestFilePaths();
  const specCoverages = paths.flatMap((x) => {
    const docstrings = parseDocstringsForFile(x);
    return getSpecCoveragesFromDocstrings(docstrings);
  });

  const specMarkdown = await loadSpecMarkdown();
  const specItems = specMarkdownToOrderedSpecItems(specMarkdown);
  const collection = new SpecItemNodesCollection(specItems);
  applySpecCoveragesToSpecItemsCollection(collection, specCoverages);

  printGeneralCoverageMetrics(collection);
  printNoSpecMetrics(specCoverages);
  printCoverageTableForAllSpecItems(collection);
})().catch((error) => {
  console.error('Spec coverage report failed with error:', error);
  exit(1);
});
