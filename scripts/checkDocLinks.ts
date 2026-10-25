/**
 * Verifies every ably.com documentation URL referenced from the library's public surface:
 * that the page still resolves, and that a URL carrying a fragment still matches an element
 * id on the page it resolves to.
 *
 * A fragment that no longer exists is the failure worth catching. A browser given an unknown
 * fragment silently leaves the reader at the top of the page rather than reporting anything,
 * so a stale `@see` anchor looks healthy in every check that only asserts a status code.
 *
 * Run with `npm run check-doc-links`.
 */
import fs from 'fs';
import https from 'https';
import { glob } from 'glob';

/** Declaration files scanned in full. */
const DECLARATION_FILES = ['ably.d.ts', 'modular.d.ts'];

/** Sources scanned for doc URLs in JSDoc comments and error strings. */
const SOURCE_GLOB = 'src/**/*.ts';

/** Matches an ably.com docs URL, stopping at the punctuation that terminates one in prose or markdown. */
const DOC_URL_PATTERN = /https:\/\/ably\.com\/docs\/[^\s)'"`<>\]]+/g;

const REQUEST_TIMEOUT_MS = 30000;
const MAX_ATTEMPTS = 4;
const MAX_REDIRECTS = 5;

/**
 * ably.com rate-limits bursts of requests, so pages are fetched one at a time with a pause
 * between them. The run costs well under a minute at the current URL count.
 */
const DELAY_BETWEEN_PAGES_MS = 1200;

/**
 * An escape hatch for a URL that is known to be broken and cannot be fixed immediately, so
 * that the check gates new breakage rather than blocking on a backlog. Map the URL to the
 * reason it is listed.
 *
 * Prefer fixing the link. Nothing listed here rots silently: a listed URL that starts
 * working is itself reported as a failure telling you to delete the line.
 */
const KNOWN_BROKEN: Record<string, string> = {};

interface Occurrence {
  file: string;
  line: number;
}

interface PageResult {
  status: number;
  finalUrl: string;
  /** Set only when the page could not be fetched at all, after every retry. */
  error?: string;
  body?: string;
}

type Outcome = 'ok' | 'broken' | 'known-broken' | 'fixed';

interface UrlReport {
  url: string;
  outcome: Outcome;
  detail: string;
  redirectedTo?: string;
  occurrences: Occurrence[];
}

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Splits a URL into the part to request and its fragment, keeping any query string on the page. */
function splitFragment(url: string): { page: string; fragment: string | null } {
  const hashIndex = url.indexOf('#');
  if (hashIndex === -1) {
    return { page: url, fragment: null };
  }
  return { page: url.slice(0, hashIndex), fragment: url.slice(hashIndex + 1) };
}

function collectUrls(files: string[]): Map<string, Occurrence[]> {
  const index = new Map<string, Occurrence[]>();

  for (const file of files) {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, lineIndex) => {
      for (const match of line.matchAll(DOC_URL_PATTERN)) {
        // Trailing punctuation belongs to the sentence, not the URL.
        const url = match[0].replace(/[.,;:]+$/, '');
        const occurrences = index.get(url) ?? [];
        occurrences.push({ file, line: lineIndex + 1 });
        index.set(url, occurrences);
      }
    });
  }

  return index;
}

function get(
  url: string,
): Promise<{ status: number; location: string | null; body: string; retryAfter: number | null }> {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers: { 'user-agent': 'ably-js-doc-link-check' } }, (response) => {
      const status = response.statusCode ?? 0;
      const location = (response.headers.location as string | undefined) ?? null;
      const retryAfterHeader = response.headers['retry-after'];
      const retryAfter = typeof retryAfterHeader === 'string' ? Number(retryAfterHeader) : null;

      // A body is only needed when the anchors on the final page get inspected.
      if (status >= 300) {
        response.resume();
        resolve({ status, location, body: '', retryAfter: Number.isFinite(retryAfter) ? retryAfter : null });
        return;
      }

      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () =>
        resolve({ status, location, body: Buffer.concat(chunks).toString('utf8'), retryAfter: null }),
      );
      response.on('error', reject);
    });

    request.setTimeout(REQUEST_TIMEOUT_MS, () => request.destroy(new Error(`timed out after ${REQUEST_TIMEOUT_MS}ms`)));
    request.on('error', reject);
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Fetches a page, following redirects, retrying the failures that are worth retrying. */
async function fetchPage(pageUrl: string): Promise<PageResult> {
  let lastError = '';

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      let currentUrl = pageUrl;

      for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect++) {
        if (redirect === MAX_REDIRECTS) {
          return { status: 0, finalUrl: currentUrl, error: `more than ${MAX_REDIRECTS} redirects` };
        }

        const response = await get(currentUrl);

        if (response.status >= 300 && response.status < 400 && response.location) {
          currentUrl = new URL(response.location, currentUrl).toString();
          continue;
        }

        // Rate limiting and server faults are transient; anything else is the answer.
        if (response.status === 429 || response.status >= 500) {
          const backoffMs = (response.retryAfter ?? 2 ** attempt) * 1000;
          lastError = `HTTP ${response.status}`;
          await delay(backoffMs);
          break;
        }

        return { status: response.status, finalUrl: currentUrl, body: response.body };
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      await delay(2 ** attempt * 1000);
    }
  }

  return { status: 0, finalUrl: pageUrl, error: lastError };
}

function hasAnchor(body: string, fragment: string): boolean {
  const escaped = escapeForRegExp(decodeURIComponent(fragment));
  // The reference pages carry a member-name alias anchor inside the heading element
  // (`<a id="attach"/>`), so the id being matched is not necessarily the heading's own slug.
  return new RegExp(`(?:id|name)=["']${escaped}["']`).test(body);
}

async function main(): Promise<void> {
  const files = [...DECLARATION_FILES, ...(await glob(SOURCE_GLOB))].filter((file) => fs.existsSync(file));
  const urls = collectUrls(files);

  if (urls.size === 0) {
    console.error(`No ably.com doc URLs found in ${files.length} files. The URL pattern is probably wrong.`);
    process.exit(1);
  }

  // One request per page, however many fragments point at it.
  const pages = new Map<string, string[]>();
  for (const url of urls.keys()) {
    const { page } = splitFragment(url);
    pages.set(page, [...(pages.get(page) ?? []), url]);
  }

  console.log(`Checking ${urls.size} doc URLs across ${pages.size} pages, from ${files.length} files.\n`);

  const reports: UrlReport[] = [];
  let pagesFetched = 0;

  for (const [page, pageUrls] of pages) {
    if (pagesFetched > 0) {
      await delay(DELAY_BETWEEN_PAGES_MS);
    }
    const result = await fetchPage(page);
    pagesFetched++;

    for (const url of pageUrls) {
      const { fragment } = splitFragment(url);
      const occurrences = urls.get(url) ?? [];
      const knownReason = KNOWN_BROKEN[url];
      const redirectedTo = result.finalUrl === page ? undefined : result.finalUrl;

      let detail = '';
      if (result.status === 0) {
        detail = `request failed: ${result.error}`;
      } else if (result.status !== 200) {
        detail = `HTTP ${result.status}`;
      } else if (fragment && !hasAnchor(result.body ?? '', fragment)) {
        detail = `page has no element with id "${fragment}"`;
      }

      if (detail === '') {
        reports.push({
          url,
          outcome: knownReason ? 'fixed' : 'ok',
          detail: knownReason ? `listed as known-broken (${knownReason}) but now resolves` : '',
          redirectedTo,
          occurrences,
        });
      } else {
        reports.push({
          url,
          outcome: knownReason ? 'known-broken' : 'broken',
          detail,
          redirectedTo,
          occurrences,
        });
      }
    }
  }

  const describe = (report: UrlReport) => {
    const where = report.occurrences.map((occurrence) => `${occurrence.file}:${occurrence.line}`).join(', ');
    const redirect = report.redirectedTo ? `\n    redirects to ${report.redirectedTo}` : '';
    return `  ${report.url}\n    ${report.detail}${redirect}\n    referenced at ${where}`;
  };

  const broken = reports.filter((report) => report.outcome === 'broken');
  const fixed = reports.filter((report) => report.outcome === 'fixed');
  const knownBroken = reports.filter((report) => report.outcome === 'known-broken');
  const redirected = reports.filter((report) => report.outcome === 'ok' && report.redirectedTo);

  if (redirected.length > 0) {
    console.log(`Resolving via a redirect (${redirected.length}) — worth updating, not failing the check:`);
    for (const report of redirected) {
      console.log(`  ${report.url}\n    redirects to ${report.redirectedTo}`);
    }
    console.log('');
  }

  if (knownBroken.length > 0) {
    console.log(`Known broken (${knownBroken.length}), listed in KNOWN_BROKEN:`);
    for (const report of knownBroken) {
      console.log(`  ${report.url} — ${report.detail}`);
    }
    console.log('');
  }

  if (fixed.length > 0) {
    console.log(`Fixed (${fixed.length}) — remove these from KNOWN_BROKEN in scripts/checkDocLinks.ts:`);
    for (const report of fixed) {
      console.log(describe(report));
    }
    console.log('');
  }

  if (broken.length > 0) {
    console.log(`Broken (${broken.length}):`);
    for (const report of broken) {
      console.log(describe(report));
    }
    console.log('');
  }

  const checked = reports.length;
  const healthy = reports.filter((report) => report.outcome === 'ok').length;
  console.log(`${healthy}/${checked} URLs resolve, ${knownBroken.length} known broken.`);

  if (broken.length > 0 || fixed.length > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
