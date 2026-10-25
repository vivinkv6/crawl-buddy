export type AuditStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type AuditMode = 'page' | 'sitemap';

export type CrawlScope = 'internal' | 'external' | 'both';

export type LinkType = 'internal' | 'external';

export type CheckCategory =
  | 'pending'
  | 'healthy'
  | 'broken'
  | 'redirect'
  | 'server_error'
  | 'restricted'
  | 'unverified';

export type IssueType =
  | 'none'
  | 'pending'
  | 'redirect'
  | 'not_found'
  | 'gone'
  | 'server_error'
  | 'client_error'
  | 'access_restricted'
  | 'rate_limited'
  | 'timeout'
  | 'dns_error'
  | 'tls_error'
  | 'connection_error'
  | 'blocked'
  | 'invalid_url'
  | 'too_many_redirects'
  | 'redirect_loop'
  | 'unsupported'
  | 'other_error';

export interface RedirectHop {
  url: string;
  status: number;
  location?: string;
}

export interface LinkCheckResult {
  destinationUrl: string;
  method: 'HEAD' | 'GET' | null;
  status: number | null;
  category: CheckCategory;
  issueType: IssueType;
  isBroken: boolean;
  finalUrl: string | null;
  redirectChain: RedirectHop[];
  error: string | null;
  attempts: number;
  durationMs: number;
  checkedAt: string;
}

export interface LinkEdge {
  id: string;
  sourcePage: string;
  sourceDepth: number;
  destinationUrl: string;
  destinationKey: string;
  anchorText: string;
  linkType: LinkType;
}

export interface AuditConfig {
  mode: AuditMode;
  url: string;
  maxPages: number;
  maxDepth: number;
  scope: CrawlScope;
  excludePatterns: string[];
  treatRedirectsAsIssues: boolean;
}

export interface AuditStats {
  pagesDiscovered: number;
  pagesCrawled: number;
  linksDiscovered: number;
  linksChecked: number;
  brokenLinks: number;
  healthyLinks: number;
  redirectLinks: number;
  serverErrors: number;
  restrictedLinks: number;
  unverifiedLinks: number;
}

export interface AuditSnapshot {
  id: string;
  status: AuditStatus;
  config: AuditConfig;
  stats: AuditStats;
  currentPage: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
  elapsedMs: number;
}

export interface AuditResultRow {
  id: string;
  sourcePage: string;
  destinationUrl: string;
  anchorText: string;
  linkType: LinkType;
  status: number | null;
  issueType: IssueType;
  category: CheckCategory;
  finalUrl: string | null;
  redirectChain: RedirectHop[];
  error: string | null;
  isBroken: boolean;
  checkedAt: string | null;
}

export interface PaginatedResults {
  items: AuditResultRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface ResultDetail {
  result: AuditResultRow;
  relatedSources: Array<{
    sourcePage: string;
    anchorText: string;
    linkType: LinkType;
  }>;
}

export const MAX_PAGES = 10000;
export const DEFAULT_MAX_DEPTH = 3;
export const MAX_DEPTH = 10;
export const MAX_EXCLUDE_PATTERNS = 25;
export const MAX_EXCLUDE_PATTERN_LENGTH = 200;
export const MAX_LINKS_PER_AUDIT = 20000;
export const MAX_AUDITS = 50;
export const AUDIT_TTL_MS = 60 * 60 * 1000;
export const MAX_AUDIT_DURATION_MS = 10 * 60 * 1000;
export const CRAWL_CONCURRENCY = 5;
export const CHECK_CONCURRENCY = 8;
export const REQUEST_TIMEOUT_MS = 10000;
export const MAX_REDIRECTS = 5;
export const MAX_HTML_BYTES = 2 * 1024 * 1024;
export const MAX_SITEMAP_BYTES = 10 * 1024 * 1024;
export const MAX_SITEMAPS = 50;
export const MAX_ANCHOR_TEXT_LENGTH = 300;
export const USER_AGENT =
  'Mozilla/5.0 (compatible; CrawlWise-BrokenLinkChecker/1.0; +https://crawlwise.app)';
