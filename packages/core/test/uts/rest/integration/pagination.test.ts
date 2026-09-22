/**
 * UTS Integration: REST Pagination Tests
 *
 * Spec points: TG1, TG2, TG3, TG4, TG5
 * Source: uts/rest/integration/pagination.md
 */

import { expect } from 'chai';
import {
  Ably,
  SANDBOX_ENDPOINT,
  setupSandbox,
  teardownSandbox,
  getApiKey,
  uniqueChannelName,
  pollUntil,
} from './sandbox';

describe('uts/rest/integration/pagination', function () {
  this.timeout(120000);

  before(async function () {
    await setupSandbox();
  });

  after(async function () {
    await teardownSandbox();
  });

  /**
   * TG1, TG2 - PaginatedResult items and navigation
   *
   * Publish 15 messages, request with limit 5.
   * TG1: items contains array of results for current page.
   * TG2: hasNext() and isLast() indicate availability of more pages.
   */
  // UTS: rest/integration/TG1/items-and-navigation-0
  it('TG1, TG2 - PaginatedResult items and navigation', async function () {
    const channelName = uniqueChannelName('pagination-basic');

    const client = new Ably.Rest({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
    });

    const channel = client.channels.get(channelName);

    // Publish 15 messages
    for (let i = 1; i <= 15; i++) {
      await channel.publish('event-' + i, String(i));
    }

    // Poll until all messages are persisted
    await pollUntil(
      async () => {
        const result = await channel.history();
        return result.items.length === 15 ? result : null;
      },
      { interval: 500, timeout: 15000 },
    );

    // Request with small limit to force pagination
    const page1 = await channel.history({ limit: 5 });

    // TG1 - items contains array of results
    expect(page1.items).to.be.an('array');
    expect(page1.items.length).to.equal(5);

    // TG2 - hasNext/isLast indicate more pages
    expect(page1.hasNext()).to.equal(true);
    expect(page1.isLast()).to.equal(false);
  });

  /**
   * TG3 - next() retrieves subsequent page
   *
   * Publish 12 messages, paginate through 3 pages with limit 5.
   * Page 1: 5 items, page 2: 5 items, page 3: 2 items.
   * Verify no duplicate IDs across pages, total 12.
   */
  // UTS: rest/integration/TG3/next-retrieves-page-0
  it('TG3 - next() retrieves subsequent pages', async function () {
    const channelName = uniqueChannelName('pagination-next');

    const client = new Ably.Rest({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
    });

    const channel = client.channels.get(channelName);

    // Publish 12 messages
    for (let i = 1; i <= 12; i++) {
      await channel.publish('event-' + i, String(i));
    }

    // Poll until all messages are persisted
    await pollUntil(
      async () => {
        const result = await channel.history();
        return result.items.length === 12 ? result : null;
      },
      { interval: 500, timeout: 15000 },
    );

    const page1 = await channel.history({ limit: 5 });
    const page2 = (await page1.next())!;
    const page3 = (await page2.next())!;

    expect(page1.items.length).to.equal(5);
    expect(page2.items.length).to.equal(5);
    expect(page3.items.length).to.equal(2);

    // Verify no duplicate messages across pages
    const allIds: string[] = [];
    for (const page of [page1, page2, page3]) {
      for (const item of page.items) {
        expect(allIds).to.not.include(item.id);
        allIds.push(item.id!);
      }
    }

    expect(allIds.length).to.equal(12);
  });

  /**
   * TG4 - first() retrieves first page
   *
   * Publish 10 messages, get page1 (limit 3), get page2 via next(),
   * get firstPage via page2.first(). firstPage items should match page1 items by id.
   */
  // UTS: rest/integration/TG4/first-retrieves-page-0
  it('TG4 - first() retrieves first page', async function () {
    const channelName = uniqueChannelName('pagination-first');

    const client = new Ably.Rest({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
    });

    const channel = client.channels.get(channelName);

    // Publish 10 messages
    for (let i = 1; i <= 10; i++) {
      await channel.publish('event-' + i, String(i));
    }

    // Poll until all messages are persisted
    await pollUntil(
      async () => {
        const result = await channel.history();
        return result.items.length === 10 ? result : null;
      },
      { interval: 500, timeout: 15000 },
    );

    const page1 = await channel.history({ limit: 3 });
    const page2 = (await page1.next())!;
    const firstPage = await page2.first();

    // firstPage should have same items as page1
    expect(firstPage.items.length).to.equal(page1.items.length);

    for (let i = 0; i < firstPage.items.length; i++) {
      expect(firstPage.items[i].id).to.equal(page1.items[i].id);
    }
  });

  /**
   * TG5 - Iterate through all pages
   *
   * Publish 25 messages, iterate through all pages with limit 7.
   * Collect all messages, verify total is 25, all event names present.
   */
  // UTS: rest/integration/TG5/iterate-all-pages-0
  it('TG5 - iterate through all pages', async function () {
    const channelName = uniqueChannelName('pagination-iterate');

    const client = new Ably.Rest({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
    });

    const channel = client.channels.get(channelName);

    const messageCount = 25;

    // Publish 25 messages
    for (let i = 1; i <= messageCount; i++) {
      await channel.publish('event-' + i, String(i));
    }

    // Poll until all messages are persisted (longer timeout for 25 messages)
    await pollUntil(
      async () => {
        const result = await channel.history();
        return result.items.length === messageCount ? result : null;
      },
      { interval: 500, timeout: 30000 },
    );

    // Iterate through all pages
    const allMessages: any[] = [];
    let page = await channel.history({ limit: 7 });

    while (true) {
      allMessages.push(...page.items);

      if (!page.hasNext()) {
        break;
      }

      page = (await page.next())!;
    }

    expect(allMessages.length).to.equal(messageCount);

    // Verify all messages retrieved
    const eventNames = allMessages.map((msg: any) => msg.name);
    for (let i = 1; i <= messageCount; i++) {
      expect(eventNames).to.include('event-' + i);
    }
  });

  /**
   * TG - next() on last page returns null
   *
   * Publish 3 messages, request with limit 10 (larger than message count).
   * All items fit on one page. hasNext() false, isLast() true.
   * next() returns null or empty result.
   */
  // UTS: rest/integration/TG3/next-last-page-null-1
  it('TG - next() on last page returns null', async function () {
    const channelName = uniqueChannelName('pagination-lastnext');

    const client = new Ably.Rest({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
    });

    const channel = client.channels.get(channelName);

    // Publish 3 messages
    for (let i = 1; i <= 3; i++) {
      await channel.publish('event-' + i, String(i));
    }

    // Poll until messages are persisted
    await pollUntil(
      async () => {
        const result = await channel.history();
        return result.items.length === 3 ? result : null;
      },
      { interval: 500, timeout: 10000 },
    );

    const page = await channel.history({ limit: 10 });

    expect(page.items.length).to.equal(3);
    expect(page.hasNext()).to.equal(false);
    expect(page.isLast()).to.equal(true);

    // Calling next() should return null (or empty result)
    const nextPage = await page.next();
    if (nextPage !== null) {
      expect(nextPage.items.length).to.equal(0);
    }
  });
});
