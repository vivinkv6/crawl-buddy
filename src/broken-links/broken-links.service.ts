import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { CreateAuditDto } from './dto/create-audit.dto';
import { ResultsQueryDto } from './dto/results-query.dto';
import {
  DiscoveredAnchor,
  extractAnchors,
  looksLikeHtml,
  parseSitemap,
} from './crawl.util';
import {
  GuardedHttpResponse,
  GuardedHttpService,
} from './guarded-http.service';
import {
  isCancellationError,
  LinkCheckerService,
} from './link-checker.service';
import {
  compileExclusionPatterns,
  isExcludedUrl,
  normalizeUrl,
  resolveHttpUrl,
  sanitizeAnchorText,
} from './link-url.util';
import { SsrfGuardService, UnsafeUrlError } from './ssrf-guard.service';
import {
  AUDIT_TTL_MS,
  AuditConfig,
  AuditResultRow,
  AuditSnapshot,
  AuditStats,
  AuditStatus,
  CHECK_CONCURRENCY,
  CRAWL_CONCURRENCY,
  LinkCheckResult,
  LinkEdge,
  LinkType,
  MAX_ANCHOR_TEXT_LENGTH,
  MAX_AUDIT_DURATION_MS,
  MAX_AUDITS,
  MAX_HTML_BYTES,
  MAX_LINKS_PER_AUDIT,
  MAX_PAGES,
  MAX_REDIRECTS,
  MAX_SITEMAP_BYTES,
  MAX_SITEMAPS,
  PaginatedResults,
  REQUEST_TIMEOUT_MS,
  ResultDetail,
} from './types';

interface PageResponseEntry {
  response: GuardedHttpResponse;
  durationMs: number;
}

interface AuditRecord {
  id: string;
  config: AuditConfig;
  status: AuditStatus;
  stats: AuditStats;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  currentPage: string | null;
  error: string | null;
  edges: LinkEdge[];
  edgeKeys: Set<string>;
  destinations: Map<string, { url: string; linkType: LinkType }>;
  checks: Map<string, LinkCheckResult>;
  pageResponses: Map<string, PageResponseEntry>;
  cancelRequested: boolean;
  timedOut: boolean;
  deadline: number;
  abortController: AbortController;
}

interface CrawlQueueItem {
  url: string;
  depth: number;
}

interface CrawlContext {
  audit: AuditRecord;
  siteHostnames: Set<string>;
  excludedPatterns: RegExp[];
  queue: CrawlQueueItem[];
  discovered: Set<string>;
}

interface FetchedPage {
  response?: GuardedHttpResponse;
  error?: unknown;
  durationMs: number;
}

@Injectable()
export class BrokenLinksService implements OnModuleDestroy {
  private readonly logger = new Logger(BrokenLinksService.name);
  private readonly audits = new Map<string, AuditRecord>();
  private readonly cleanupTimer: NodeJS.Timeout;

  constructor(
    private readonly ssrfGuard: SsrfGuardService,
    private readonly http: GuardedHttpService,
    private readonly checker: LinkCheckerService,
  ) {
    this.cleanupTimer = setInterval(
      () => this.cleanupExpiredAudits(),
      5 * 60 * 1000,
    );
    this.cleanupTimer.unref?.();
  }

  onModuleDestroy(): void {
    clearInterval(this.cleanupTimer);
    for (const audit of this.audits.values()) {
      audit.abortController.abort();
    }
    this.audits.clear();
  }

  async createAudit(dto: CreateAuditDto): Promise<AuditSnapshot> {
    const mode = dto.mode === 'sitemap' ? 'sitemap' : 'page';
    const targetUrl = (mode === 'sitemap' ? dto.sitemapUrl : dto.url)?.trim();

    if (!targetUrl) {
      throw new BadRequestException(
        mode === 'sitemap'
          ? 'Please provide a sitemap URL.'
          : 'Please provide a page URL.',
      );
    }

    let safeUrl: URL;
    try {
      safeUrl = await this.ssrfGuard.assertSafeUrl(targetUrl);
    } catch (error) {
      if (error instanceof UnsafeUrlError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }

    this.evictIfNeeded();

    const excludePatterns = Array.from(
      new Set(
        (dto.excludePatterns ?? [])
          .map((pattern) => pattern.trim())
          .filter(Boolean),
      ),
    );

    const config: AuditConfig = {
      mode,
      url: safeUrl.href,
      maxPages:
        mode === 'sitemap'
          ? this.clampInt(dto.maxPages, 1, MAX_PAGES, MAX_PAGES)
          : 1,
      maxDepth: 0,
      scope:
        dto.scope === 'internal' || dto.scope === 'external'
          ? dto.scope
          : 'both',
      excludePatterns,
      treatRedirectsAsIssues: dto.treatRedirectsAsIssues === true,
    };

    const id = randomUUID();
    const audit: AuditRecord = {
      id,
      config,
      status: 'queued',
      stats: this.emptyStats(),
      createdAt: new Date(),
      startedAt: null,
      completedAt: null,
      currentPage: null,
      error: null,
      edges: [],
      edgeKeys: new Set(),
      destinations: new Map(),
      checks: new Map(),
      pageResponses: new Map(),
      cancelRequested: false,
      timedOut: false,
      deadline: 0,
      abortController: new AbortController(),
    };

    this.audits.set(id, audit);
    this.logger.log(
      `Broken link audit queued: ${id} (${config.mode}) for ${config.url} (maxPages=${config.maxPages}, scope=${config.scope})`,
    );

    setImmediate(() => {
      void this.runAudit(id).catch((error) => {
        this.logger.error(
          `Unhandled audit error for ${id}: ${this.errorMessage(error)}`,
        );
      });
    });

    return this.toSnapshot(audit);
  }

  getSnapshot(id: string): AuditSnapshot {
    return this.toSnapshot(this.getAuditOrThrow(id));
  }

  getResults(id: string, query: ResultsQueryDto): PaginatedResults {
    const audit = this.getAuditOrThrow(id);
    const rows = this.filterAndSortRows(audit, query);
    const pageSize = this.clampInt(query.pageSize, 1, MAX_LINKS_PER_AUDIT, 50);
    const totalPages = Math.ceil(rows.length / pageSize);
    const requestedPage = this.clampInt(
      query.page,
      1,
      Number.MAX_SAFE_INTEGER,
      1,
    );
    const page = totalPages === 0 ? 1 : Math.min(requestedPage, totalPages);
    const start = (page - 1) * pageSize;

    return {
      items: rows.slice(start, start + pageSize),
      total: rows.length,
      page,
      pageSize,
      totalPages,
    };
  }

  getResultDetail(id: string, resultId: string): ResultDetail {
    const audit = this.getAuditOrThrow(id);
    const edge = audit.edges.find((item) => item.id === resultId);
    if (!edge) {
      throw new NotFoundException('Link result not found.');
    }

    const relatedSources = audit.edges
      .filter((item) => item.destinationKey === edge.destinationKey)
      .slice(0, 25)
      .map((item) => ({
        sourcePage: item.sourcePage,
        anchorText: item.anchorText,
        linkType: item.linkType,
      }));

    return {
      result: this.toResultRow(audit, edge),
      relatedSources,
    };
  }

  cancelAudit(id: string): AuditSnapshot {
    const audit = this.getAuditOrThrow(id);
    if (this.isTerminal(audit.status)) {
      return this.toSnapshot(audit);
    }

    this.logger.log(`Cancelling broken link audit: ${id}`);
    audit.cancelRequested = true;
    audit.abortController.abort();
    audit.status = 'cancelled';
    audit.completedAt = new Date();
    audit.currentPage = null;
    audit.error = null;
    return this.toSnapshot(audit);
  }

  getExportRows(id: string, query: ResultsQueryDto): AuditResultRow[] {
    return this.filterAndSortRows(this.getAuditOrThrow(id), query);
  }

  private async runAudit(id: string): Promise<void> {
    const audit = this.audits.get(id);
    if (!audit || audit.status !== 'queued' || audit.cancelRequested) {
      return;
    }

    audit.status = 'running';
    audit.startedAt = new Date();
    audit.deadline = Date.now() + MAX_AUDIT_DURATION_MS;
    audit.currentPage = audit.config.url;
    this.logger.log(`Broken link audit started: ${id}`);

    try {
      await this.crawl(audit);

      if (audit.cancelRequested) {
        this.finishAudit(audit, 'cancelled');
        return;
      }
      if (audit.timedOut) {
        this.finishAudit(
          audit,
          'failed',
          'Audit exceeded the maximum allowed duration.',
        );
        return;
      }

      audit.currentPage = 'Preparing link checks';
      await this.checkDestinations(audit);

      if (audit.cancelRequested) {
        this.finishAudit(audit, 'cancelled');
      } else if (audit.timedOut) {
        this.finishAudit(
          audit,
          'failed',
          'Audit exceeded the maximum allowed duration.',
        );
      } else {
        this.finishAudit(audit, 'completed');
      }
    } catch (error) {
      if (audit.cancelRequested) {
        this.finishAudit(audit, 'cancelled');
      } else if (audit.timedOut) {
        this.finishAudit(
          audit,
          'failed',
          'Audit exceeded the maximum allowed duration.',
        );
      } else if (isCancellationError(error)) {
        this.finishAudit(audit, 'cancelled');
      } else {
        const message = this.errorMessage(error);
        this.logger.error(`Broken link audit failed: ${id}: ${message}`);
        this.finishAudit(audit, 'failed', message);
      }
    } finally {
      if (audit.currentPage) {
        audit.currentPage = null;
      }
    }
  }

  private async crawl(audit: AuditRecord): Promise<void> {
    if (audit.config.mode === 'sitemap') {
      await this.crawlSitemap(audit);
      return;
    }

    await this.crawlPage(audit);
  }

  private async crawlPage(audit: AuditRecord): Promise<void> {
    const rootKey = normalizeUrl(audit.config.url);
    const context: CrawlContext = {
      audit,
      siteHostnames: new Set([
        new URL(audit.config.url).hostname.toLowerCase(),
      ]),
      excludedPatterns: compileExclusionPatterns(audit.config.excludePatterns),
      queue: [],
      discovered: new Set([rootKey]),
    };
    audit.stats.pagesDiscovered = 1;

    const rootPage = await this.fetchPage(audit.config.url, audit);
    if (audit.cancelRequested) return;
    if (!rootPage.response) {
      throw new Error(
        `Unable to fetch the start URL: ${this.errorMessage(rootPage.error)}`,
      );
    }

    const rootResponse = rootPage.response;
    if (rootResponse.status < 200 || rootResponse.status >= 300) {
      throw new Error(`The start URL returned HTTP ${rootResponse.status}.`);
    }
    if (
      !looksLikeHtml(
        rootResponse.headers['content-type'],
        rootResponse.body ?? '',
      )
    ) {
      const contentType = rootResponse.headers['content-type'];
      const type = Array.isArray(contentType) ? contentType[0] : contentType;
      throw new Error(
        `The start URL did not return HTML content (received ${type || 'no content type'}). If this is a sitemap, use Entire Website mode.`,
      );
    }

    const finalRootUrl = new URL(rootResponse.finalUrl);
    context.siteHostnames.add(finalRootUrl.hostname.toLowerCase());

    audit.stats.pagesCrawled = 1;
    audit.pageResponses.set(rootKey, {
      response: rootResponse,
      durationMs: rootPage.durationMs,
    });
    this.processPageLinks(
      context,
      rootKey,
      0,
      rootResponse.body ?? '',
      rootResponse.finalUrl,
    );

    if (context.queue.length === 0 || audit.config.maxPages <= 1) {
      this.logger.log(
        `Page crawl finished for audit ${audit.id}: ${audit.stats.pagesCrawled} page visited, ${audit.edges.length} link relationships found.`,
      );
      return;
    }

    let activeWorkers = 0;
    const workerCount = Math.min(
      CRAWL_CONCURRENCY,
      Math.max(1, audit.config.maxPages - 1),
    );
    const visited = new Set<string>([rootKey]);

    const worker = async (): Promise<void> => {
      for (;;) {
        if (this.isStopRequested(audit)) return;

        if (visited.size >= audit.config.maxPages) {
          if (activeWorkers === 0) return;
          await this.sleep(25);
          continue;
        }

        const item = context.queue.shift();
        if (!item) {
          if (activeWorkers === 0) return;
          await this.sleep(25);
          continue;
        }
        if (visited.has(item.url)) continue;

        visited.add(item.url);
        activeWorkers += 1;
        audit.currentPage = item.url;

        try {
          const page = await this.fetchPage(item.url, audit);
          if (this.isStopRequested(audit)) return;

          audit.stats.pagesCrawled += 1;

          if (page.error || !page.response) {
            this.logger.warn(
              `Could not crawl ${item.url}: ${this.errorMessage(page.error)}`,
            );
            continue;
          }

          const response = page.response;
          audit.pageResponses.set(item.url, {
            response,
            durationMs: page.durationMs,
          });

          if (
            response.status >= 200 &&
            response.status < 300 &&
            looksLikeHtml(response.headers['content-type'], response.body ?? '')
          ) {
            this.processPageLinks(
              context,
              item.url,
              item.depth,
              response.body ?? '',
              response.finalUrl,
            );
          }
        } catch (error) {
          if (this.isStopRequested(audit) || isCancellationError(error)) {
            return;
          }
          this.logger.warn(
            `Could not crawl ${item.url}: ${this.errorMessage(error)}`,
          );
        } finally {
          activeWorkers -= 1;
        }
      }
    };

    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    audit.stats.pagesDiscovered = Math.max(
      audit.stats.pagesDiscovered,
      visited.size,
    );
    this.logger.log(
      `Crawl finished for audit ${audit.id}: ${visited.size} pages visited, ${audit.edges.length} link relationships found.`,
    );
  }

  private async crawlSitemap(audit: AuditRecord): Promise<void> {
    const context: CrawlContext = {
      audit,
      siteHostnames: new Set([
        new URL(audit.config.url).hostname.toLowerCase(),
      ]),
      excludedPatterns: compileExclusionPatterns(audit.config.excludePatterns),
      queue: [],
      discovered: new Set(),
    };

    const pageUrls = await this.collectSitemapPageUrls(audit, context);
    if (this.isStopRequested(audit)) return;
    if (pageUrls.length === 0) {
      throw new Error('The sitemap did not contain any valid page URLs.');
    }

    audit.stats.pagesDiscovered = pageUrls.length;
    let nextIndex = 0;

    const worker = async (): Promise<void> => {
      for (;;) {
        if (this.isStopRequested(audit)) return;

        const index = nextIndex;
        nextIndex += 1;
        if (index >= pageUrls.length) return;

        const pageUrl = pageUrls[index];
        audit.currentPage = pageUrl;

        try {
          const page = await this.fetchPage(pageUrl, audit);
          if (this.isStopRequested(audit)) return;

          if (page.error || !page.response) {
            this.logger.warn(
              `Could not crawl ${pageUrl}: ${this.errorMessage(page.error)}`,
            );
            continue;
          }

          audit.stats.pagesCrawled += 1;
          const response = page.response;
          audit.pageResponses.set(pageUrl, {
            response,
            durationMs: page.durationMs,
          });

          if (
            response.status >= 200 &&
            response.status < 300 &&
            looksLikeHtml(response.headers['content-type'], response.body ?? '')
          ) {
            const finalUrl = new URL(response.finalUrl);
            context.siteHostnames.add(finalUrl.hostname.toLowerCase());
            this.processPageLinks(
              context,
              pageUrl,
              0,
              response.body ?? '',
              response.finalUrl,
            );
          }
        } catch (error) {
          if (this.isStopRequested(audit) || isCancellationError(error)) {
            return;
          }
          this.logger.warn(
            `Could not crawl ${pageUrl}: ${this.errorMessage(error)}`,
          );
        }
      }
    };

    const workerCount = Math.min(CRAWL_CONCURRENCY, pageUrls.length);
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    this.logger.log(
      `Sitemap crawl finished for audit ${audit.id}: ${audit.stats.pagesCrawled}/${pageUrls.length} pages visited, ${audit.edges.length} link relationships found.`,
    );
  }

  private async collectSitemapPageUrls(
    audit: AuditRecord,
    context: CrawlContext,
  ): Promise<string[]> {
    const pending = [audit.config.url];
    const visitedSitemaps = new Set<string>();
    const pageUrls = new Set<string>();

    while (
      pending.length > 0 &&
      visitedSitemaps.size < MAX_SITEMAPS &&
      pageUrls.size < audit.config.maxPages
    ) {
      if (this.isStopRequested(audit)) break;

      const sitemapUrl = pending.shift();
      if (!sitemapUrl) continue;

      let sitemapKey: string;
      try {
        sitemapKey = normalizeUrl(sitemapUrl);
      } catch {
        continue;
      }
      if (visitedSitemaps.has(sitemapKey)) continue;
      visitedSitemaps.add(sitemapKey);
      const isRootSitemap = visitedSitemaps.size === 1;

      audit.currentPage = `Reading sitemap ${sitemapUrl}`;
      const fetched = await this.fetchPage(
        sitemapUrl,
        audit,
        MAX_SITEMAP_BYTES,
      );
      if (this.isStopRequested(audit)) break;

      if (fetched.error || !fetched.response) {
        const message = `Unable to fetch sitemap ${sitemapUrl}: ${this.errorMessage(fetched.error)}`;
        if (isRootSitemap) throw new Error(message);
        this.logger.warn(message);
        continue;
      }

      const response = fetched.response;
      if (response.status < 200 || response.status >= 300) {
        const message = `Sitemap ${sitemapUrl} returned HTTP ${response.status}.`;
        if (isRootSitemap) throw new Error(message);
        this.logger.warn(message);
        continue;
      }

      const entries = parseSitemap(response.body ?? '');
      for (const page of entries.pages) {
        if (pageUrls.size >= audit.config.maxPages) break;
        const resolved = resolveHttpUrl(page, response.finalUrl);
        if (!resolved) continue;
        if (isExcludedUrl(resolved.normalized, context.excludedPatterns)) {
          continue;
        }
        pageUrls.add(resolved.normalized);
      }

      for (const nestedSitemap of entries.sitemaps) {
        const resolved = resolveHttpUrl(nestedSitemap, response.finalUrl);
        if (!resolved || visitedSitemaps.has(resolved.normalized)) continue;
        pending.push(resolved.normalized);
      }
    }

    return Array.from(pageUrls).slice(0, audit.config.maxPages);
  }

  private processPageLinks(
    context: CrawlContext,
    sourcePage: string,
    sourceDepth: number,
    html: string,
    finalUrl: string,
  ): void {
    const { audit, siteHostnames, excludedPatterns } = context;
    let anchors: DiscoveredAnchor[];
    try {
      anchors = extractAnchors(html);
    } catch (error) {
      this.logger.warn(
        `Unable to parse links from ${sourcePage}: ${this.errorMessage(error)}`,
      );
      return;
    }

    for (const anchor of anchors) {
      if (this.isStopRequested(audit)) return;

      const resolved = resolveHttpUrl(anchor.href, finalUrl);
      if (!resolved) continue;

      const normalized = resolved.normalized;
      if (isExcludedUrl(normalized, excludedPatterns)) continue;

      const internal = this.hostnameIsInternal(resolved.url, siteHostnames);
      const linkType: LinkType = internal ? 'internal' : 'external';
      const included =
        audit.config.scope === 'both' ||
        (audit.config.scope === 'internal' && internal) ||
        (audit.config.scope === 'external' && !internal);

      if (included) {
        const anchorText = sanitizeAnchorText(
          anchor.text,
          MAX_ANCHOR_TEXT_LENGTH,
        );
        const edgeKey = `${sourcePage}\u0000${normalized}\u0000${anchorText}`;

        if (
          !audit.edgeKeys.has(edgeKey) &&
          audit.edges.length < MAX_LINKS_PER_AUDIT
        ) {
          audit.edgeKeys.add(edgeKey);
          audit.edges.push({
            id: randomUUID(),
            sourcePage,
            sourceDepth,
            destinationUrl: normalized,
            destinationKey: normalized,
            anchorText,
            linkType,
          });
          audit.stats.linksDiscovered = audit.edges.length;

          if (!audit.destinations.has(normalized)) {
            audit.destinations.set(normalized, {
              url: normalized,
              linkType,
            });
          }
        }
      }

      if (
        internal &&
        sourceDepth < audit.config.maxDepth &&
        context.discovered.size < audit.config.maxPages &&
        !context.discovered.has(normalized)
      ) {
        context.discovered.add(normalized);
        context.queue.push({ url: normalized, depth: sourceDepth + 1 });
        audit.stats.pagesDiscovered = context.discovered.size;
      }
    }
  }

  private async checkDestinations(audit: AuditRecord): Promise<void> {
    const destinations = Array.from(audit.destinations.values());
    let nextIndex = 0;

    const worker = async (): Promise<void> => {
      for (;;) {
        if (this.isStopRequested(audit)) return;

        const index = nextIndex;
        nextIndex += 1;
        if (index >= destinations.length) return;

        const destination = destinations[index];
        if (audit.checks.has(destination.url)) continue;

        audit.currentPage = `Checking ${destination.url}`;

        const cached = audit.pageResponses.get(destination.url);
        let result: LinkCheckResult;
        if (cached) {
          result = this.checker.evaluateResponse(
            destination.url,
            cached.response,
            audit.config.treatRedirectsAsIssues,
            1,
            Date.now() - cached.durationMs,
            'GET',
          );
        } else {
          result = await this.checker.check(destination.url, {
            treatRedirectsAsIssues: audit.config.treatRedirectsAsIssues,
            signal: audit.abortController.signal,
            timeoutMs: REQUEST_TIMEOUT_MS,
          });
        }

        if (this.isStopRequested(audit)) return;

        audit.checks.set(destination.url, result);
        audit.stats.linksChecked += 1;
        this.applyCheckToStats(audit.stats, result);
      }
    };

    await Promise.all(
      Array.from(
        {
          length: Math.min(CHECK_CONCURRENCY, Math.max(1, destinations.length)),
        },
        () => worker(),
      ),
    );

    audit.stats.linksChecked = this.countCheckedDestinations(audit);
    this.logger.log(
      `Link checking finished for audit ${audit.id}: ${audit.stats.linksChecked}/${destinations.length} destinations checked.`,
    );
  }

  private async fetchPage(
    url: string,
    audit: AuditRecord,
    maxBodyBytes = MAX_HTML_BYTES,
  ): Promise<FetchedPage> {
    const startedAt = Date.now();
    try {
      const response = await this.http.request(url, {
        method: 'GET',
        readBody: true,
        timeoutMs: REQUEST_TIMEOUT_MS,
        maxRedirects: MAX_REDIRECTS,
        maxBodyBytes,
        signal: audit.abortController.signal,
      });
      return { response, durationMs: Date.now() - startedAt };
    } catch (error) {
      if (isCancellationError(error)) {
        throw error;
      }
      return { error, durationMs: Date.now() - startedAt };
    }
  }

  private filterAndSortRows(
    audit: AuditRecord,
    query: ResultsQueryDto,
  ): AuditResultRow[] {
    const search = (query.search ?? '').trim().toLowerCase();
    const statusFilter = query.status ?? 'all';
    const linkTypeFilter = query.linkType ?? 'all';

    let rows = audit.edges.map((edge) => this.toResultRow(audit, edge));

    if (statusFilter !== 'all') {
      rows = rows.filter((row) => {
        if (statusFilter === 'server_error') {
          return row.issueType === 'server_error';
        }
        if (statusFilter === 'broken') {
          return row.isBroken;
        }
        return row.category === statusFilter;
      });
    }

    if (linkTypeFilter !== 'all') {
      rows = rows.filter((row) => row.linkType === linkTypeFilter);
    }

    if (search) {
      rows = rows.filter((row) =>
        [row.sourcePage, row.destinationUrl, row.anchorText]
          .join(' ')
          .toLowerCase()
          .includes(search),
      );
    }

    const sortBy = query.sortBy ?? 'sourcePage';
    const direction = query.sortDir === 'desc' ? -1 : 1;

    rows.sort((a, b) => {
      let comparison: number;
      switch (sortBy) {
        case 'status':
          comparison = (a.status ?? 0) - (b.status ?? 0);
          if (comparison === 0) {
            comparison = a.category.localeCompare(b.category);
          }
          break;
        case 'issueType':
          comparison = a.issueType.localeCompare(b.issueType);
          break;
        case 'linkType':
          comparison = a.linkType.localeCompare(b.linkType);
          break;
        case 'destinationUrl':
          comparison = a.destinationUrl.localeCompare(b.destinationUrl);
          break;
        case 'anchorText':
          comparison = a.anchorText.localeCompare(b.anchorText);
          break;
        case 'finalUrl':
          comparison = (a.finalUrl ?? '').localeCompare(b.finalUrl ?? '');
          break;
        case 'sourcePage':
        default:
          comparison = a.sourcePage.localeCompare(b.sourcePage);
          break;
      }
      if (comparison === 0) {
        comparison = a.id.localeCompare(b.id);
      }
      return comparison * direction;
    });

    return rows;
  }

  private toResultRow(audit: AuditRecord, edge: LinkEdge): AuditResultRow {
    const check = audit.checks.get(edge.destinationKey);
    return {
      id: edge.id,
      sourcePage: edge.sourcePage,
      destinationUrl: edge.destinationUrl,
      anchorText: edge.anchorText,
      linkType: edge.linkType,
      status: check?.status ?? null,
      issueType: check?.issueType ?? 'pending',
      category: check?.category ?? 'pending',
      finalUrl: check?.finalUrl ?? null,
      redirectChain: check?.redirectChain ?? [],
      error: check?.error ?? null,
      isBroken: check?.isBroken ?? false,
      checkedAt: check?.checkedAt ?? null,
    };
  }

  private applyCheckToStats(stats: AuditStats, result: LinkCheckResult): void {
    if (result.isBroken) stats.brokenLinks += 1;
    if (result.category === 'healthy') stats.healthyLinks += 1;
    if (result.category === 'redirect') stats.redirectLinks += 1;
    if (result.category === 'restricted') stats.restrictedLinks += 1;
    if (result.category === 'unverified') stats.unverifiedLinks += 1;
    if (result.issueType === 'server_error') stats.serverErrors += 1;
  }

  private countCheckedDestinations(audit: AuditRecord): number {
    return audit.checks.size;
  }

  private toSnapshot(audit: AuditRecord): AuditSnapshot {
    const end = audit.completedAt ?? new Date();
    const start = audit.startedAt ?? audit.createdAt;
    return {
      id: audit.id,
      status: audit.status,
      config: {
        ...audit.config,
        excludePatterns: [...audit.config.excludePatterns],
      },
      stats: { ...audit.stats },
      currentPage: audit.currentPage,
      createdAt: audit.createdAt.toISOString(),
      startedAt: audit.startedAt?.toISOString() ?? null,
      completedAt: audit.completedAt?.toISOString() ?? null,
      error: audit.error,
      elapsedMs: Math.max(0, end.getTime() - start.getTime()),
    };
  }

  private finishAudit(
    audit: AuditRecord,
    status: AuditStatus,
    error: string | null = null,
  ): void {
    audit.status = status;
    audit.completedAt = audit.completedAt ?? new Date();
    audit.currentPage = null;
    audit.error = error;
    if (status !== 'completed') {
      audit.abortController.abort();
    }
    this.logger.log(
      `Broken link audit ${status}: ${audit.id} (pages=${audit.stats.pagesCrawled}, links=${audit.stats.linksChecked}, broken=${audit.stats.brokenLinks})`,
    );
  }

  private isStopRequested(audit: AuditRecord): boolean {
    if (audit.cancelRequested || audit.timedOut) return true;
    if (Date.now() > audit.deadline) {
      audit.timedOut = true;
      audit.abortController.abort();
      return true;
    }
    return false;
  }

  private getAuditOrThrow(id: string): AuditRecord {
    const audit = this.audits.get(id);
    if (!audit) {
      throw new NotFoundException('Broken link audit not found.');
    }
    return audit;
  }

  private evictIfNeeded(): void {
    this.cleanupExpiredAudits();
    if (this.audits.size < MAX_AUDITS) return;

    const terminal = Array.from(this.audits.values())
      .filter((audit) => this.isTerminal(audit.status))
      .sort(
        (a, b) =>
          (a.completedAt?.getTime() ?? 0) - (b.completedAt?.getTime() ?? 0),
      );

    for (const audit of terminal) {
      if (this.audits.size < MAX_AUDITS) break;
      this.audits.delete(audit.id);
    }

    if (this.audits.size >= MAX_AUDITS) {
      throw new ServiceUnavailableException(
        'Too many audits are currently running. Please try again shortly.',
      );
    }
  }

  private cleanupExpiredAudits(): void {
    const cutoff = Date.now() - AUDIT_TTL_MS;
    for (const [id, audit] of this.audits) {
      if (
        this.isTerminal(audit.status) &&
        audit.completedAt &&
        audit.completedAt.getTime() < cutoff
      ) {
        this.audits.delete(id);
      }
    }
  }

  private emptyStats(): AuditStats {
    return {
      pagesDiscovered: 0,
      pagesCrawled: 0,
      linksDiscovered: 0,
      linksChecked: 0,
      brokenLinks: 0,
      healthyLinks: 0,
      redirectLinks: 0,
      serverErrors: 0,
      restrictedLinks: 0,
      unverifiedLinks: 0,
    };
  }

  private isTerminal(status: AuditStatus): boolean {
    return (
      status === 'completed' || status === 'failed' || status === 'cancelled'
    );
  }

  private clampInt(
    value: number | undefined,
    min: number,
    max: number,
    fallback: number,
  ): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(Math.max(Math.trunc(parsed), min), max);
  }

  private hostnameIsInternal(url: URL, siteHostnames: Set<string>): boolean {
    return siteHostnames.has(url.hostname.toLowerCase());
  }

  private errorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (typeof error === 'string') return error;
    return 'Unknown error';
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
