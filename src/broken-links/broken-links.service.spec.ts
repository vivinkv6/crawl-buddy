import { BadRequestException, NotFoundException } from '@nestjs/common';
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { lookup as dnsLookup } from 'node:dns';
import { BrokenLinksService } from './broken-links.service';
import { CreateAuditDto } from './dto/create-audit.dto';
import { ResultsQueryDto } from './dto/results-query.dto';
import { GuardedHttpService } from './guarded-http.service';
import { LinkCheckerService } from './link-checker.service';
import { SsrfGuardService, UnsafeUrlError } from './ssrf-guard.service';
import { AuditSnapshot } from './types';

class LocalSsrfGuard {
  assertSafeUrl(rawUrl: string): Promise<URL> {
    const url = new URL(rawUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('Unsupported protocol');
    }
    return Promise.resolve(url);
  }

  createGuardedLookup() {
    return dnsLookup;
  }

  isPublicIp(): boolean {
    return true;
  }
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

describe('BrokenLinksService integration', () => {
  let server: Server;
  let baseUrl: string;
  let externalBaseUrl: string;
  let hits: Map<string, number>;
  let service: BrokenLinksService;

  const sendHtml = (
    response: import('node:http').ServerResponse,
    status: number,
    body: string,
  ) => {
    response.statusCode = status;
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(body);
  };

  const sendXml = (
    response: import('node:http').ServerResponse,
    status: number,
    body: string,
  ) => {
    response.statusCode = status;
    response.setHeader('Content-Type', 'application/xml; charset=utf-8');
    response.end(body);
  };

  beforeAll(async () => {
    server = createServer((request, response) => {
      const path = (request.url || '/').split('?')[0];
      hits.set(path, (hits.get(path) || 0) + 1);
      const port = (server.address() as AddressInfo).port;

      switch (path) {
        case '/':
          sendHtml(
            response,
            200,
            `<html><body>
              <a href="/a">A</a>
              <a href="/b">B</a>
              <a href="/broken">Broken</a>
              <a href="/redirect">Redirect</a>
              <a href="/loop">Loop</a>
              <a href="/server-error">Server error</a>
              <a href="http://127.0.0.2:${port}/missing">External missing</a>
              <a href="mailto:test@example.com">Email</a>
              <a href="/a#fragment">Fragment</a>
            </body></html>`,
          );
          break;
        case '/a':
          sendHtml(
            response,
            200,
            '<html><body><a href="/a2">A2</a><a href="/shared">Shared</a></body></html>',
          );
          break;
        case '/a2':
          sendHtml(
            response,
            200,
            '<html><body><a href="/a3">A3</a></body></html>',
          );
          break;
        case '/a3':
          sendHtml(response, 200, '<html><body>End</body></html>');
          break;
        case '/b':
          sendHtml(
            response,
            200,
            '<html><body><a href="/shared">Shared</a><a href="/gone">Gone</a></body></html>',
          );
          break;
        case '/shared':
          sendHtml(response, 200, '<html><body>Shared</body></html>');
          break;
        case '/broken':
          sendHtml(response, 404, '<html><body>Not found</body></html>');
          break;
        case '/gone':
          sendHtml(response, 410, '<html><body>Gone</body></html>');
          break;
        case '/server-error':
          sendHtml(response, 500, '<html><body>Error</body></html>');
          break;
        case '/redirect':
          response.statusCode = 302;
          response.setHeader('Location', '/shared');
          response.end();
          break;
        case '/loop':
          response.statusCode = 302;
          response.setHeader('Location', '/loop');
          response.end();
          break;
        case '/dedupe':
          sendHtml(
            response,
            200,
            `<html><body>
              <a href="/shared">First anchor</a>
              <a href="/shared#section">Second anchor</a>
            </body></html>`,
          );
          break;
        case '/exclude-root':
          sendHtml(
            response,
            200,
            '<html><body><a href="/private/page">Private</a><a href="/ok">OK</a></body></html>',
          );
          break;
        case '/private/page':
          sendHtml(response, 200, '<html><body>Private</body></html>');
          break;
        case '/ok':
          sendHtml(response, 200, '<html><body>OK</body></html>');
          break;
        case '/slow-root': {
          const timer = setTimeout(() => {
            sendHtml(response, 200, '<html><body>Slow</body></html>');
          }, 1500);
          request.on('close', () => clearTimeout(timer));
          break;
        }
        case '/missing':
          sendHtml(response, 404, '<html><body>Missing</body></html>');
          break;
        case '/sitemap.xml':
          sendXml(
            response,
            200,
            `<?xml version="1.0" encoding="UTF-8"?>
            <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
              <url><loc>${baseUrl}/</loc></url>
              <url><loc>${baseUrl}/a</loc></url>
              <url><loc>${baseUrl}/a2</loc></url>
              <url><loc>${baseUrl}/b</loc></url>
            </urlset>`,
          );
          break;
        case '/sitemap-index.xml':
          sendXml(
            response,
            200,
            `<?xml version="1.0" encoding="UTF-8"?>
            <sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
              <sitemap><loc>${baseUrl}/sitemap-a.xml</loc></sitemap>
              <sitemap><loc>${baseUrl}/sitemap-b.xml</loc></sitemap>
            </sitemapindex>`,
          );
          break;
        case '/sitemap-a.xml':
          sendXml(
            response,
            200,
            `<?xml version="1.0" encoding="UTF-8"?>
            <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
              <url><loc>${baseUrl}/</loc></url>
              <url><loc>${baseUrl}/a</loc></url>
            </urlset>`,
          );
          break;
        case '/sitemap-b.xml':
          sendXml(
            response,
            200,
            `<?xml version="1.0" encoding="UTF-8"?>
            <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
              <url><loc>${baseUrl}/b</loc></url>
            </urlset>`,
          );
          break;
        case '/empty-sitemap.xml':
          sendXml(
            response,
            200,
            `<?xml version="1.0" encoding="UTF-8"?>
            <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>`,
          );
          break;
        default:
          sendHtml(response, 404, '<html><body>Not found</body></html>');
          break;
      }
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '0.0.0.0', () => resolve());
    });
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
    externalBaseUrl = `http://127.0.0.2:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  beforeEach(() => {
    hits = new Map();
    const guard = new LocalSsrfGuard();
    const http = new GuardedHttpService(guard as unknown as SsrfGuardService);
    const checker = new LinkCheckerService(
      http,
      guard as unknown as SsrfGuardService,
    );
    service = new BrokenLinksService(
      guard as unknown as SsrfGuardService,
      http,
      checker,
    );
  });

  afterEach(() => {
    service.onModuleDestroy();
  });

  const waitForTerminal = async (
    id: string,
    timeoutMs = 10000,
  ): Promise<AuditSnapshot> => {
    const startedAt = Date.now();
    for (;;) {
      const snapshot = service.getSnapshot(id);
      if (
        snapshot.status === 'completed' ||
        snapshot.status === 'failed' ||
        snapshot.status === 'cancelled'
      ) {
        return snapshot;
      }
      if (Date.now() - startedAt > timeoutMs) {
        throw new Error(`Audit ${id} did not finish in time.`);
      }
      await sleep(25);
    }
  };

  const createAudit = async (
    overrides: Partial<CreateAuditDto> = {},
  ): Promise<AuditSnapshot> => {
    const created = await service.createAudit({
      mode: 'page',
      url: `${baseUrl}/`,
      maxPages: 2000,
      maxDepth: 0,
      scope: 'internal',
      excludePatterns: [],
      treatRedirectsAsIssues: false,
      ...overrides,
    } as CreateAuditDto);
    return waitForTerminal(created.id);
  };

  const createSitemapAudit = (
    overrides: Partial<CreateAuditDto> = {},
  ): Promise<AuditSnapshot> =>
    createAudit({
      mode: 'sitemap',
      sitemapUrl: `${baseUrl}/sitemap.xml`,
      ...overrides,
    });

  const getResults = (id: string, overrides: Partial<ResultsQueryDto> = {}) =>
    service.getResults(id, {
      page: 1,
      pageSize: 200,
      status: 'all',
      linkType: 'all',
      search: '',
      sortBy: 'destinationUrl',
      sortDir: 'asc',
      ...overrides,
    } as ResultsQueryDto);

  it('crawls every sitemap page, finds broken links, and links them to source pages', async () => {
    const snapshot = await createSitemapAudit();

    expect(snapshot.status).toBe('completed');
    expect(snapshot.config.mode).toBe('sitemap');
    expect(snapshot.stats.pagesCrawled).toBeGreaterThanOrEqual(4);
    expect(snapshot.stats.linksDiscovered).toBeGreaterThan(0);

    const results = getResults(snapshot.id);
    const broken = results.items.find((item) =>
      item.destinationUrl.endsWith('/broken'),
    );
    expect(broken).toBeDefined();
    expect(broken?.status).toBe(404);
    expect(broken?.category).toBe('broken');
    expect(broken?.issueType).toBe('not_found');
    expect(broken?.sourcePage).toBe(`${baseUrl}/`);

    const gone = results.items.find((item) =>
      item.destinationUrl.endsWith('/gone'),
    );
    expect(gone?.issueType).toBe('gone');

    const redirect = results.items.find((item) =>
      item.destinationUrl.endsWith('/redirect'),
    );
    expect(redirect?.category).toBe('redirect');
    expect(redirect?.finalUrl).toBe(`${baseUrl}/shared`);

    const loop = results.items.find((item) =>
      item.destinationUrl.endsWith('/loop'),
    );
    expect(loop?.issueType).toBe('redirect_loop');
    expect(loop?.isBroken).toBe(true);

    const serverError = results.items.find((item) =>
      item.destinationUrl.endsWith('/server-error'),
    );
    expect(serverError?.issueType).toBe('server_error');
    expect(serverError?.isBroken).toBe(true);

    expect(results.items.every((item) => item.linkType === 'internal')).toBe(
      true,
    );
    expect(hits.get('/broken')).toBe(1);
  });

  it('checks only the supplied page in single-page mode', async () => {
    const snapshot = await createAudit({ mode: 'page', url: `${baseUrl}/` });

    expect(snapshot.status).toBe('completed');
    expect(snapshot.config.mode).toBe('page');
    expect(snapshot.stats.pagesDiscovered).toBe(1);
    expect(snapshot.stats.pagesCrawled).toBe(1);

    const results = getResults(snapshot.id);
    expect(
      results.items.some((item) => item.destinationUrl.endsWith('/broken')),
    ).toBe(true);
    expect(
      results.items.some((item) => item.destinationUrl.endsWith('/a2')),
    ).toBe(false);
    expect(hits.get('/a2')).toBeUndefined();
  });

  it('crawls pages from nested sitemap indexes', async () => {
    const snapshot = await createSitemapAudit({
      sitemapUrl: `${baseUrl}/sitemap-index.xml`,
    });

    expect(snapshot.status).toBe('completed');
    expect(snapshot.stats.pagesDiscovered).toBe(3);
    expect(snapshot.stats.pagesCrawled).toBe(3);
    expect(hits.get('/a')).toBe(1);
    expect(hits.get('/b')).toBe(1);
  });

  it('fails when a sitemap contains no page URLs', async () => {
    const snapshot = await createSitemapAudit({
      sitemapUrl: `${baseUrl}/empty-sitemap.xml`,
    });

    expect(snapshot.status).toBe('failed');
    expect(snapshot.error).toContain('did not contain any valid page URLs');
  });

  it('supports internal, external, and combined link scopes', async () => {
    const internal = await createAudit({ scope: 'internal' });
    const internalResults = getResults(internal.id);
    expect(internalResults.items.length).toBeGreaterThan(0);
    expect(
      internalResults.items.every((item) => item.linkType === 'internal'),
    ).toBe(true);

    const external = await createAudit({ scope: 'external' });
    const externalResults = getResults(external.id);
    expect(externalResults.items.length).toBeGreaterThan(0);
    expect(
      externalResults.items.every((item) => item.linkType === 'external'),
    ).toBe(true);
    const missing = externalResults.items.find((item) =>
      item.destinationUrl.startsWith(externalBaseUrl),
    );
    expect(missing).toBeDefined();
    expect(missing?.status).toBe(404);
    expect(missing?.isBroken).toBe(true);

    const both = await createAudit({ scope: 'both' });
    const bothResults = getResults(both.id);
    expect(bothResults.items.some((item) => item.linkType === 'internal')).toBe(
      true,
    );
    expect(bothResults.items.some((item) => item.linkType === 'external')).toBe(
      true,
    );
  });

  it('checks each unique destination once while retaining every source relationship', async () => {
    const snapshot = await createAudit({ url: `${baseUrl}/dedupe` });
    const results = getResults(snapshot.id, { search: '/shared' });

    expect(results.items).toHaveLength(2);
    expect(snapshot.stats.linksChecked).toBe(1);
    expect(hits.get('/shared')).toBe(1);
  });

  it('applies the page limit to sitemap entries', async () => {
    const snapshot = await createSitemapAudit({ maxPages: 2 });

    expect(snapshot.status).toBe('completed');
    expect(snapshot.stats.pagesDiscovered).toBe(2);
    expect(snapshot.stats.pagesCrawled).toBe(2);

    const results = getResults(snapshot.id);
    const sourcePages = new Set(results.items.map((item) => item.sourcePage));
    expect(sourcePages).toEqual(new Set([`${baseUrl}/`, `${baseUrl}/a`]));
  });

  it('honors URL exclusion patterns', async () => {
    const snapshot = await createAudit({
      url: `${baseUrl}/exclude-root`,
      excludePatterns: ['/private/*'],
    });

    const results = getResults(snapshot.id);
    expect(
      results.items.some((item) =>
        item.destinationUrl.includes('/private/page'),
      ),
    ).toBe(false);
    expect(hits.get('/private/page')).toBeUndefined();
    expect(
      results.items.some((item) => item.destinationUrl.endsWith('/ok')),
    ).toBe(true);
  });

  it('returns filtered, sorted, and paginated results', async () => {
    const snapshot = await createSitemapAudit();
    const broken = getResults(snapshot.id, { status: 'broken' });
    expect(broken.items.length).toBeGreaterThan(0);
    expect(broken.items.every((item) => item.isBroken)).toBe(true);

    const all = getResults(snapshot.id);
    const brokenUrls = new Set(
      all.items
        .filter((item) => item.isBroken)
        .map((item) => item.destinationUrl),
    );
    expect(new Set(broken.items.map((item) => item.destinationUrl))).toEqual(
      brokenUrls,
    );
    expect(brokenUrls.size).toBe(snapshot.stats.brokenLinks);
    expect(broken.items.some((item) => item.issueType === 'server_error')).toBe(
      true,
    );

    const page = getResults(snapshot.id, { pageSize: 2, page: 1 });
    expect(page.items).toHaveLength(2);
    expect(page.pageSize).toBe(2);
    expect(page.total).toBeGreaterThan(2);

    const search = getResults(snapshot.id, { search: 'broken' });
    expect(search.items.length).toBeGreaterThan(0);
    expect(
      search.items.every((item) =>
        `${item.sourcePage} ${item.destinationUrl} ${item.anchorText}`
          .toLowerCase()
          .includes('broken'),
      ),
    ).toBe(true);
  });

  it('exports only the rows matching the selected filter', async () => {
    const snapshot = await createSitemapAudit();
    const rows = service.getExportRows(snapshot.id, {
      page: 1,
      pageSize: 50,
      status: 'broken',
      linkType: 'all',
      search: '',
      sortBy: 'sourcePage',
      sortDir: 'asc',
    } as ResultsQueryDto);

    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.isBroken)).toBe(true);
    expect(rows.some((row) => row.category === 'redirect')).toBe(false);
  });

  it('returns diagnostic details with related source pages', async () => {
    const snapshot = await createAudit({ url: `${baseUrl}/dedupe` });
    const results = getResults(snapshot.id, { search: '/shared' });
    const detail = service.getResultDetail(snapshot.id, results.items[0].id);

    expect(detail.result.destinationUrl).toBe(`${baseUrl}/shared`);
    expect(detail.relatedSources).toHaveLength(2);
  });

  it('cancels a running audit and stops processing', async () => {
    const created = await service.createAudit({
      mode: 'page',
      url: `${baseUrl}/slow-root`,
      maxPages: 1,
      maxDepth: 0,
      scope: 'internal',
      excludePatterns: [],
      treatRedirectsAsIssues: false,
    } as CreateAuditDto);

    await sleep(75);
    const cancelled = service.cancelAudit(created.id);
    expect(cancelled.status).toBe('cancelled');

    const snapshot = await waitForTerminal(created.id, 2000);
    expect(snapshot.status).toBe('cancelled');
    expect(snapshot.completedAt).not.toBeNull();
  });

  it('rejects unsafe start URLs before creating an audit', async () => {
    const blockedGuard = {
      assertSafeUrl: jest
        .fn()
        .mockRejectedValue(new UnsafeUrlError('Blocked host.', 'blocked_host')),
    };

    const blockedService = new BrokenLinksService(
      blockedGuard as unknown as SsrfGuardService,
      {} as GuardedHttpService,
      {} as LinkCheckerService,
    );

    await expect(
      blockedService.createAudit({
        mode: 'page',
        url: 'http://127.0.0.1/',
      } as CreateAuditDto),
    ).rejects.toBeInstanceOf(BadRequestException);

    blockedService.onModuleDestroy();
  });

  it('throws NotFoundException for unknown audits', () => {
    expect(() => service.getSnapshot('missing')).toThrow(NotFoundException);
  });
});
