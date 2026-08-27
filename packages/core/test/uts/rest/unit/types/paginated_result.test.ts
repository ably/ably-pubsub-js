/**
 * UTS: PaginatedResult Type Tests
 *
 * Spec points: TG1, TG2, TG3, TG4
 * Source: uts/test/rest/unit/types/paginated_result.md
 *
 * Tests pagination via channel.history(null) with mock HTTP responses.
 * Link header URLs MUST use the `./word?params` format to match
 * ably-js's getRelParams regex: /^\.\/(\w+)\?(.*)$/
 */

import { expect } from 'chai';
import { MockHttpClient } from '../../../mock_http';
import { Ably, installMockHttp, restoreAll } from '../../../helpers';

describe('uts/rest/unit/types/paginated_result', function () {
  afterEach(function () {
    restoreAll();
  });

  /**
   * TG1 - items attribute
   *
   * PaginatedResult must contain an items array with the result data.
   * channel.history(null) returns PaginatedResult<Message> with correctly
   * deserialized Message objects.
   */
  // UTS: rest/unit/TG1/paginated-result-items-0
  it('TG1 - items attribute contains correct messages', async function () {
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        req.respond_with(200, [
          { id: 'item1', name: 'e1', data: 'd1' },
          { id: 'item2', name: 'e2', data: 'd2' },
        ]);
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false } as any);
    const channel = client.channels.get('test');
    const result = await channel.history(null);

    expect(result.items).to.be.an('array');
    expect(result.items).to.have.length(2);
    expect(result.items[0].name).to.equal('e1');
    expect(result.items[0].data).to.equal('d1');
    expect(result.items[1].name).to.equal('e2');
    expect(result.items[1].data).to.equal('d2');
  });

  /**
   * TG2 - hasNext() returns true when Link header contains rel="next"
   *
   * When the response includes a Link header with rel="next",
   * hasNext() must return true and isLast() must return false.
   */
  // UTS: rest/unit/TG2/has-next-is-last-0
  it('TG2 - hasNext true when Link header has rel="next"', async function () {
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        req.respond_with(200, [{ id: 'item1' }], {
          Link: '<./messages?cursor=abc123>; rel="next"',
        });
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false } as any);
    const channel = client.channels.get('test');
    const result = await channel.history(null);

    expect(result.hasNext()).to.be.true;
    expect(result.isLast()).to.be.false;
  });

  /**
   * TG2 - hasNext() returns false when no Link header
   *
   * When the response has no Link header (or no rel="next"),
   * hasNext() must return false and isLast() must return true.
   */
  // UTS: rest/unit/TG/link-header-parsing-1
  it('TG2 - hasNext false when no Link header', async function () {
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        req.respond_with(200, [{ id: 'item1' }]);
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false } as any);
    const channel = client.channels.get('test');
    const result = await channel.history(null);

    expect(result.hasNext()).to.be.false;
    expect(result.isLast()).to.be.true;
  });

  /**
   * TG3 - next() fetches the next page
   *
   * When the first page has a Link with rel="next", calling next()
   * must fetch the second page and return its items. The second request
   * must include the cursor parameter from the Link header.
   */
  // UTS: rest/unit/TG3/next-fetches-next-page-0
  it('TG3 - next() fetches next page using Link header cursor', async function () {
    const captured: any[] = [];
    let requestCount = 0;

    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        requestCount++;

        if (requestCount === 1) {
          // First page — includes next link
          req.respond_with(
            200,
            [
              { id: 'page1-item1', name: 'a', data: 'x' },
              { id: 'page1-item2', name: 'b', data: 'y' },
            ],
            {
              Link: '<./messages?cursor=abc123>; rel="next"',
            },
          );
        } else {
          // Second page — last page, no next link
          req.respond_with(200, [{ id: 'page2-item1', name: 'c', data: 'z' }]);
        }
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false } as any);
    const channel = client.channels.get('test');

    const page1 = await channel.history(null);
    expect(page1.items).to.have.length(2);
    expect(page1.items[0].name).to.equal('a');
    expect(page1.hasNext()).to.be.true;

    const page2 = await page1.next();
    expect(page2).to.not.be.null;
    expect(page2!.items).to.have.length(1);
    expect(page2!.items[0].name).to.equal('c');
    expect(page2!.hasNext()).to.be.false;

    // Verify the next request included the cursor param
    expect(captured).to.have.length(2);
    expect(captured[1].url.searchParams.get('cursor')).to.equal('abc123');
  });

  /**
   * TG4 - first() returns the first page
   *
   * After navigating to page 2, calling first() must return page 1.
   * The Link header must include rel="first" with ./messages? format.
   */
  // UTS: rest/unit/TG4/first-returns-first-page-0
  it('TG4 - first() returns first page', async function () {
    const captured: any[] = [];
    let requestCount = 0;

    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        requestCount++;

        if (requestCount === 1) {
          // First page — has next and first links
          req.respond_with(200, [{ id: 'item1', name: 'first', data: 'one' }], {
            Link: '<./messages?cursor=abc>; rel="next", <./messages?start=0>; rel="first"',
          });
        } else if (requestCount === 2) {
          // Second page — has first link only
          req.respond_with(200, [{ id: 'item2', name: 'second', data: 'two' }], {
            Link: '<./messages?start=0>; rel="first"',
          });
        } else {
          // First page again (via first())
          req.respond_with(200, [{ id: 'item1', name: 'first', data: 'one' }], {
            Link: '<./messages?cursor=abc>; rel="next", <./messages?start=0>; rel="first"',
          });
        }
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false } as any);
    const channel = client.channels.get('test');

    const page1 = await channel.history(null);
    expect(page1.items[0].name).to.equal('first');

    const page2 = await page1.next();
    expect(page2!.items[0].name).to.equal('second');
    expect(page2!.hasFirst()).to.be.true;

    const firstPage = await page2!.first();
    expect(firstPage!.items[0].name).to.equal('first');
    expect(firstPage!.items[0].id).to.equal('item1');
  });

  /**
   * TG - Empty result
   *
   * An empty response body (empty array) must yield items.length=0,
   * hasNext()=false, isLast()=true.
   */
  // UTS: rest/unit/TG/empty-result-handling-0
  it('TG - empty result has zero items and isLast true', async function () {
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        req.respond_with(200, []);
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false } as any);
    const channel = client.channels.get('test');
    const result = await channel.history(null);

    expect(result.items).to.be.an('array');
    expect(result.items).to.have.length(0);
    expect(result.hasNext()).to.be.false;
    expect(result.isLast()).to.be.true;
  });

  /**
   * TG - next() on last page returns null
   *
   * When isLast() is true, calling next() must return null
   * (not an empty PaginatedResult).
   */
  // UTS: rest/unit/TG/next-on-last-page-3
  it('TG - next() on last page returns null', async function () {
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        req.respond_with(200, [{ id: 'item1' }]);
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false } as any);
    const channel = client.channels.get('test');
    const result = await channel.history(null);

    expect(result.isLast()).to.be.true;

    const nextResult = await result.next();
    expect(nextResult).to.be.null;
  });

  /**
   * TG - Pagination preserves authentication
   *
   * Both the initial request and the next() pagination request must
   * include the same Authorization header.
   */
  // UTS: rest/unit/TG/pagination-preserves-auth-4
  it('TG - pagination preserves auth credentials', async function () {
    const captured: any[] = [];
    let requestCount = 0;

    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        requestCount++;

        if (requestCount === 1) {
          req.respond_with(200, [{ id: 'item1' }], {
            Link: '<./messages?cursor=next>; rel="next"',
          });
        } else {
          req.respond_with(200, [{ id: 'item2' }]);
        }
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false } as any);
    const channel = client.channels.get('test');

    const page1 = await channel.history(null);
    await page1.next();

    // Both requests must have authorization header
    // (ably-js sends lowercase 'authorization')
    expect(captured).to.have.length(2);
    expect(captured[0].headers).to.have.property('authorization');
    expect(captured[1].headers).to.have.property('authorization');
    expect(captured[0].headers['authorization']).to.equal(captured[1].headers['authorization']);
  });

  /**
   * TG - Pagination includes standard headers
   *
   * The next() pagination request must include standard Ably headers
   * (X-Ably-Version and Ably-Agent).
   */
  // UTS: rest/unit/TG/pagination-includes-headers-8
  it('TG - pagination includes standard Ably headers', async function () {
    const captured: any[] = [];
    let requestCount = 0;

    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        requestCount++;

        if (requestCount === 1) {
          req.respond_with(200, [{ id: 'item1' }], {
            Link: '<./messages?cursor=next>; rel="next"',
          });
        } else {
          req.respond_with(200, [{ id: 'item2' }]);
        }
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false } as any);
    const channel = client.channels.get('test');

    const page1 = await channel.history(null);
    await page1.next();

    // Verify the pagination (second) request has standard headers
    expect(captured).to.have.length(2);
    const nextRequest = captured[1];
    expect(nextRequest.headers).to.have.property('X-Ably-Version');
    expect(nextRequest.headers).to.have.property('Ably-Agent');
    expect(nextRequest.headers['Ably-Agent']).to.match(/ably-js/);
  });

  /**
   * TG - Error on next() propagates as exception
   *
   * When the server returns an error on the next page request,
   * next() must throw with the appropriate error code and status.
   */
  // UTS: rest/unit/TG/error-handling-on-next-9
  it('TG - error on next() throws with error code', async function () {
    let requestCount = 0;

    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        requestCount++;

        if (requestCount === 1) {
          req.respond_with(200, [{ id: 'item1' }], {
            Link: '<./messages?cursor=invalid>; rel="next"',
          });
        } else {
          req.respond_with(404, {
            error: {
              code: 40400,
              statusCode: 404,
              message: 'Not found',
            },
          });
        }
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false } as any);
    const channel = client.channels.get('test');

    const page1 = await channel.history(null);
    expect(page1.hasNext()).to.be.true;

    try {
      await page1.next();
      expect.fail('Expected next() to throw');
    } catch (error: any) {
      expect(error.statusCode).to.equal(404);
      expect(error.code).to.equal(40400);
    }
  });

  /**
   * TG - multiple results on a page
   *
   * When the server returns multiple items on a single page,
   * all items should be deserialized and accessible via result.items.
   */
  // UTS: rest/unit/TG/multiple-link-relations-6
  it('TG - multiple results on a page', async function () {
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        req.respond_with(200, [
          { id: 'item1', name: 'e1', data: 'd1' },
          { id: 'item2', name: 'e2', data: 'd2' },
          { id: 'item3', name: 'e3', data: 'd3' },
          { id: 'item4', name: 'e4', data: 'd4' },
          { id: 'item5', name: 'e5', data: 'd5' },
        ]);
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false } as any);
    const channel = client.channels.get('test');
    const result = await channel.history(null);

    expect(result.items).to.be.an('array');
    expect(result.items).to.have.length(5);
    expect(result.items[0].name).to.equal('e1');
    expect(result.items[0].data).to.equal('d1');
    expect(result.items[1].name).to.equal('e2');
    expect(result.items[2].name).to.equal('e3');
    expect(result.items[3].name).to.equal('e4');
    expect(result.items[4].name).to.equal('e5');
    expect(result.items[4].data).to.equal('d5');
  });

  /**
   * TG - PaginatedResult type parameter
   *
   * PaginatedResult<T> must correctly type its items. At runtime, verify
   * that items from channel.history() have Message properties (name, data).
   */
  // UTS: rest/unit/TG/type-parameter-items-2
  it('TG - PaginatedResult type parameter', async function () {
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        req.respond_with(200, [{ id: 'msg1', name: 'event', data: 'test' }]);
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false } as any);
    const channel = client.channels.get('test');
    const result = await channel.history(null);

    expect(result.items).to.be.an('array');
    expect(result.items).to.have.length(1);
    // Items should be Message objects with expected properties
    expect(result.items[0]).to.have.property('name', 'event');
    expect(result.items[0]).to.have.property('data', 'test');
    expect(result.items[0]).to.have.property('id', 'msg1');
  });

  /**
   * TG - Pagination with relative URLs
   *
   * Link headers with relative URLs must be resolved relative to the
   * base REST host. The next() request must target the correct host.
   */
  // UTS: rest/unit/TG/pagination-relative-urls-5
  it('TG - pagination with relative URLs', async function () {
    const captured: any[] = [];
    let requestCount = 0;

    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        requestCount++;

        if (requestCount === 1) {
          req.respond_with(200, [{ id: 'item1' }], {
            Link: '<./messages?cursor=abc>; rel="next"',
          });
        } else {
          req.respond_with(200, [{ id: 'item2' }]);
        }
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({
      key: 'appId.keyId:keySecret',
      restHost: 'rest.ably.io',
      useBinaryProtocol: false,
    } as any);
    const channel = client.channels.get('test');

    const page1 = await channel.history(null);
    expect(page1.hasNext()).to.be.true;

    const page2 = await page1.next();
    expect(page2).to.not.be.null;
    expect(page2!.items).to.have.length(1);
    expect(page2!.items[0].id).to.equal('item2');

    // Second request should resolve relative URL against the REST host
    expect(captured).to.have.length(2);
    expect(captured[1].url.host).to.equal('rest.ably.io');
    expect(captured[1].url.searchParams.get('cursor')).to.equal('abc');
  });

  /**
   * TG - Pagination with presence results
   *
   * Pagination must work identically for presence results as it does
   * for message results. channel.presence.get() returns PaginatedResult
   * with presence members.
   */
  // UTS: rest/unit/TG/pagination-presence-results-7
  it('TG - pagination with presence results', async function () {
    let requestCount = 0;

    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        requestCount++;

        if (requestCount === 1) {
          req.respond_with(200, [{ action: 1, clientId: 'client1' }], {
            Link: '<./presence?page=2>; rel="next"',
          });
        } else {
          req.respond_with(200, [{ action: 1, clientId: 'client2' }]);
        }
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false } as any);
    const channel = client.channels.get('test');

    const page1 = await channel.presence.get({} as any);
    expect(page1.items).to.be.an('array');
    expect(page1.items).to.have.length(1);
    expect(page1.items[0].clientId).to.equal('client1');
    expect(page1.hasNext()).to.be.true;

    const page2 = await page1.next();
    expect(page2).to.not.be.null;
    expect(page2!.items).to.have.length(1);
    expect(page2!.items[0].clientId).to.equal('client2');
    expect(page2!.hasNext()).to.be.false;
  });
});
