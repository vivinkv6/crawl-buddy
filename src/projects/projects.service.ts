import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { CrawlerService, PageData } from '../crawler.service';
import { Project } from '@prisma/client';
import { Observable, Subject } from 'rxjs';
import * as XLSX from 'xlsx';
import { RedisService } from '../redis/redis.service';

export interface ComparisonResult {
  oldUrl: string;
  newUrl: string | null;
  status: 'Matched' | 'Missing' | 'New' | 'Error';
  oldData: PageData | null;
  newData: PageData | null;
  issues: string[];
}

export interface ProjectReport {
  project: Project;
  summary: {
    totalOld: number;
    totalNew: number;
    missing: number;
    newPages: number;
    metaIssues: number;
  };
  results: ComparisonResult[];
}

@Injectable()
export class ProjectsService {
  constructor(
    private prisma: PrismaService,
    private crawler: CrawlerService,
    private readonly redis: RedisService,
  ) {}

  async createProject(oldSiteUrl: string, newSiteUrl: string) {
    return this.prisma.project.create({
      data: {
        oldSiteUrl,
        newSiteUrl,
      },
    });
  }

  async getProject(id: string) {
    const project = await this.prisma.project.findUnique({
      where: { id },
    });
    if (!project) throw new NotFoundException('Project not found');
    return project;
  }

  // Map to store active crawl cancellation tokens or flags
  // We can keep this in memory for now as it's process-local control, or move to Redis if we want distributed cancellation
  private activeCrawls = new Map<string, boolean>();
  
  // Cache to store crawl results for export - NOW REDIS
  // private resultsCache = new Map<string, ProjectReport>();

  // Helper to generate a unique cache key based on the URLs
  private getUrlCacheKey(oldUrl: string, newUrl: string): string {
      // Simple hash-like key or just use base64 to be safe
      const normalizedOld = oldUrl.trim().replace(/\/$/, '');
      const normalizedNew = newUrl.trim().replace(/\/$/, '');
      return `report:urls:${Buffer.from(normalizedOld + '|' + normalizedNew).toString('base64')}`;
  }

  streamComparison(id: string): Observable<MessageEvent> {
    const subject = new Subject<MessageEvent>();
    
    // Mark as active
    this.activeCrawls.set(id, true);

    // Fetch project details first to get URLs
    this.getProject(id).then(project => {
        const cacheKey = this.getUrlCacheKey(project.oldSiteUrl, project.newSiteUrl);

        // Check Cache by URL Pair
        this.redis.get(cacheKey).then((cached) => {
            if (cached) {
                console.log(`[streamComparison] Cache hit for URL pair (Project ${id}). Replaying results.`);
                const report = JSON.parse(cached) as ProjectReport;
                
                // Replay results
                for (const result of report.results) {
                    subject.next({ data: { type: 'result', result } } as MessageEvent);
                }
                
                subject.next({ data: { type: 'complete' } } as MessageEvent);
                subject.complete();
                this.activeCrawls.delete(id);
            } else {
                // Start process in background if no cache
                console.log(`[streamComparison] Cache miss for URL pair (Project ${id}). Starting live crawl.`);
                this.runComparisonStreaming(id, subject);
            }
        }).catch(err => {
            console.error('Redis cache check failed', err);
            this.runComparisonStreaming(id, subject);
        });
    }).catch(err => {
        console.error('Project not found during stream init', err);
        subject.error(err);
    });

    // Handle client disconnect (unsubscription)
    const observable = subject.asObservable();
    
    return new Observable<MessageEvent>((subscriber) => {
        const subscription = subject.subscribe(subscriber);
        return () => {
            // Cleanup logic when client disconnects
            console.log(`Client disconnected for project ${id}. Stopping crawl.`);
            this.activeCrawls.set(id, false);
            subscription.unsubscribe();
        };
    });
  }

  private async runComparisonStreaming(id: string, subject: Subject<MessageEvent>) {
    try {
      const project = await this.getProject(id);
      
      // We will use Redis to store these intermediate maps if we want to avoid memory crashes.
      // However, for simplicity and performance of the streaming logic, keeping them in memory 
      // is much faster unless the site is huge. 
      // The user asked to "Move State to Redis ... store active crawl results".
      // Let's interpret this as storing the FINAL result in Redis, and maybe the "visited" set if we can.
      // But refactoring the entire CrawlerService to be stateless/Redis-backed is a huge task.
      // We will stick to in-memory for the CRAWL process (which now has concurrency control),
      // but we will definitely store the RESULT in Redis.
      
      const oldSiteData = new Map<string, PageData>();
      const newSiteData = new Map<string, PageData>();
      const processedOldUrls = new Set<string>();

      // Accumulators for cache
      const results: ComparisonResult[] = [];
      const oldUrlsFound = new Set<string>();
      const newUrlsFound = new Set<string>();

      // Check cancellation function
      const isCancelled = () => this.activeCrawls.get(id) === false;

      // Start crawling Old Site and stream results immediately
      // We also crawl New Site in parallel to find "New" pages
      
      const crawlPromises = [
        // Old Site Crawl
        this.crawler.crawlSite(project.oldSiteUrl, 10000, async (oldPage) => {
            if (isCancelled()) return; // Stop processing if cancelled

            oldSiteData.set(oldPage.url, oldPage);
            processedOldUrls.add(oldPage.url);
            
            // Immediately check New Site
            const result = await this.checkSinglePage(oldPage, project.newSiteUrl);
            
            // If valid result found (fetch successful), add to newSiteData cache
            if (result.newData && result.newUrl) {
                newSiteData.set(result.newUrl, result.newData);
            }

            if (!isCancelled()) {
                // Store result for cache
                results.push(result);
                if (result.oldUrl) oldUrlsFound.add(result.oldUrl);
                if (result.newUrl) newUrlsFound.add(result.newUrl);

                subject.next({ data: { type: 'result', result } } as MessageEvent);
            }
        }, isCancelled, 10), // Pass cancellation token and concurrency
        
        // New Site Crawl (to populate newSiteData for later orphan check)
        this.crawler.crawlSite(project.newSiteUrl, 10000, (newPage) => {
            if (isCancelled()) return; // Stop processing
            newSiteData.set(newPage.url, newPage);
        }, isCancelled, 10) // Pass cancellation token and concurrency
      ];

      await Promise.all(crawlPromises);

      if (isCancelled()) {
          console.log(`Crawl for ${id} was cancelled. Skipping finalization.`);
          subject.complete();
          return;
      }

      // After both crawls finish, check for "New" pages (Orphans)
      // Any URL in newSiteData that was NOT processed via oldSite mapping
      
      const matchedNewUrls = new Set<string>();
      for (const oldUrl of processedOldUrls) {
           const oldUrlObj = new URL(oldUrl);
           const relativePath = oldUrl.replace(oldUrlObj.origin, '');
           const expectedNewUrl = new URL(relativePath, project.newSiteUrl).href;
           matchedNewUrls.add(expectedNewUrl);
      }

      for (const [newUrl, newPage] of newSiteData.entries()) {
          if (isCancelled()) break;

          if (!matchedNewUrls.has(newUrl)) {
              // Double check reverse mapping
              const newUrlObj = new URL(newUrl);
              const relativePath = newUrl.replace(newUrlObj.origin, '');
              const expectedOldUrl = new URL(relativePath, project.oldSiteUrl).href;
              
              if (!oldSiteData.has(expectedOldUrl)) {
                   // It is indeed new
                   const result: ComparisonResult = {
                        oldUrl: expectedOldUrl, // Hypothetical
                        newUrl,
                        status: 'New',
                        oldData: null,
                        newData: newPage,
                        issues: ['Page found on new site but not on old site'],
                   };
                   
                   // Store result for cache
                   results.push(result);
                   if (result.oldUrl) oldUrlsFound.add(result.oldUrl);
                   if (result.newUrl) newUrlsFound.add(result.newUrl);

                   subject.next({ data: { type: 'result', result } } as MessageEvent);
              }
          }
      }

      // Build Report and Cache
      const metaIssuesCount = results.filter(r => r.status === 'Matched' && r.issues.length > 0).length;
      const report: ProjectReport = {
          project,
          summary: {
              totalOld: oldUrlsFound.size,
              totalNew: newUrlsFound.size,
              missing: results.filter(r => r.status === 'Missing').length,
              newPages: results.filter(r => r.status === 'New').length,
              metaIssues: metaIssuesCount
          },
          results
      };
      
      // Save to Redis (Expire in 1 hour)
      console.log(`[runComparisonStreaming] Saving report to Redis for project ${id} (TTL: 3600s)`);
      
      // Save by ID (legacy/direct lookup)
      await this.redis.set(`report:${id}`, JSON.stringify(report), 3600);
      
      // Save by URL Pair (for reuse across projects)
      const urlKey = this.getUrlCacheKey(project.oldSiteUrl, project.newSiteUrl);
      console.log(`[runComparisonStreaming] Saving report to Redis for URLs (Key: ${urlKey})`);
      await this.redis.set(urlKey, JSON.stringify(report), 3600);

      subject.next({ data: { type: 'complete' } } as MessageEvent);
      subject.complete();

    } catch (error) {
        if (this.activeCrawls.get(id) !== false) {
             subject.next({ data: { type: 'error', message: error.message } } as MessageEvent);
        }
        subject.complete();
    } finally {
        this.activeCrawls.delete(id);
    }
  }

  private async checkSinglePage(oldPage: PageData, newSiteBase: string): Promise<ComparisonResult> {
      // Logic:
      // 1. Get relative path from Old Page
      // 2. Construct New URL
      // 3. Fetch New URL (following redirects)
      
      const oldUrlObj = new URL(oldPage.url);
      const relativePath = oldPage.url.replace(oldUrlObj.origin, '');
      const expectedNewUrl = new URL(relativePath, newSiteBase).href;

      let newPage: PageData | null = null;
      
      // Try fetch
      try {
          const fetched = await this.crawler.fetchPage(expectedNewUrl);
          newPage = fetched;
      } catch (e) {}

      const issues: string[] = [];
      let status: ComparisonResult['status'] = 'Matched';

      if (!newPage || newPage.status === 404) {
        status = 'Missing'; 
        issues.push('URL missing on new site');
      } else {
         // Status Check
         // If axios returns 200, it means it successfully reached a page (possibly via redirects).
         // If it returns 3xx, it means it stopped at a redirect (shouldn't happen with default axios config unless loop).
         // If it returns 4xx/5xx, it's an error.
         
         if (newPage.status >= 300 && newPage.status < 400) {
               status = 'Error'; 
               issues.push(`Redirected (Status ${newPage.status})`);
         } else if (newPage.status !== 200) {
              status = 'Error';
              issues.push(`New site returns status ${newPage.status}`);
         }

        // Meta Checks
        // Only compare if status is OK (200)
        // Refined Logic: Only flag if Old Site HAS data but New Site is MISSING it or DIFFERENT.
        // If Old Site is empty, we don't care if New Site is also empty (or has data, which is an improvement).
        
        if (newPage.status === 200) {
            // Check for potential redirect mismatch
            const finalPath = new URL(newPage.url).pathname.replace(/\/$/, '');
            const expectedPath = new URL(expectedNewUrl).pathname.replace(/\/$/, '');
            
            if (finalPath !== expectedPath) {
                 // It redirected. This is acceptable (Success), but we should note it.
                 // We do NOT set status to 'Error'.
                 issues.push(`Redirected to ${finalPath}`);
            }

            // Helper to clean strings for comparison
            const clean = (str: string | undefined | null) => (str || '').trim();

            const oldTitle = clean(oldPage.title);
            const newTitle = clean(newPage.title);
            const oldDesc = clean(oldPage.description);
            const newDesc = clean(newPage.description);
            const oldKeywords = clean(oldPage.keywords);
            const newKeywords = clean(newPage.keywords);
            const oldOgTitle = clean(oldPage.ogTitle);
            const newOgTitle = clean(newPage.ogTitle);
            const oldOgDesc = clean(oldPage.ogDescription);
            const newOgDesc = clean(newPage.ogDescription);
            const oldOgImage = clean(oldPage.ogImage);
            const newOgImage = clean(newPage.ogImage);
            const oldSchemas = (oldPage.schemas || []).sort();
            const newSchemas = (newPage.schemas || []).sort();
            const oldH1 = clean(oldPage.h1);
            const newH1 = clean(newPage.h1);

            if (oldTitle && oldTitle !== newTitle) issues.push('Title mismatch');
            if (oldDesc && oldDesc !== newDesc) issues.push('Description mismatch');
            if (oldKeywords && oldKeywords !== newKeywords) issues.push('Keywords mismatch');

            if (oldOgTitle && oldOgTitle !== newOgTitle) issues.push('OG Title mismatch');
            if (oldOgDesc && oldOgDesc !== newOgDesc) issues.push('OG Description mismatch');
            if (oldOgImage && oldOgImage !== newOgImage) issues.push('OG Image mismatch');
            
            // Schema Checks
            if (JSON.stringify(oldSchemas) !== JSON.stringify(newSchemas)) {
                const missing = oldSchemas.filter(s => !newSchemas.includes(s));
                if (missing.length > 0) {
                    issues.push(`Missing Schema: ${missing.join(', ')}`);
                } else {
                    issues.push('Schema mismatch');
                }
            }

            if (oldH1 && oldH1 !== newH1) issues.push('H1 mismatch');
            
            if (oldPage.canonical && oldPage.canonical !== newPage.canonical) {
                 try {
                     const oldCan = new URL(oldPage.canonical);
                     const newCan = new URL(newPage.canonical);
                     if (oldCan.pathname !== newCan.pathname) {
                         issues.push('Canonical path mismatch');
                     }
                 } catch(e) {
                     // If URL parsing fails but strings differ
                     if (oldPage.canonical !== newPage.canonical) issues.push('Canonical mismatch');
                 }
            }
            
            if (newPage.robots.includes('noindex')) issues.push('New page has noindex');
            
            if (oldTitle && !newTitle) issues.push('Missing Title on New');
            if (oldDesc && !newDesc) issues.push('Missing Description on New');
            if (oldKeywords && !newKeywords) issues.push('Missing Keywords on New');
            if (oldOgTitle && !newOgTitle) issues.push('Missing OG Title on New');
            if (oldOgDesc && !newOgDesc) issues.push('Missing OG Description on New');
            if (oldOgImage && !newOgImage) issues.push('Missing OG Image on New');
            if (oldH1 && !newH1) issues.push('Missing H1 on New');
        }
      }

      return {
          oldUrl: oldPage.url,
          newUrl: expectedNewUrl,
          status,
          oldData: oldPage,
          newData: newPage || null,
          issues
      };
  }

  async runComparison(id: string): Promise<ProjectReport> {
    const project = await this.getProject(id);
    
    // Check Redis cache by URL Key (preferred) or ID
    const urlKey = this.getUrlCacheKey(project.oldSiteUrl, project.newSiteUrl);
    let cached = await this.redis.get(urlKey);
    
    if (!cached) {
        // Fallback to ID-based cache
        cached = await this.redis.get(`report:${id}`);
    }

    if (cached) {
        console.log(`[runComparison] Cache hit for project ${id}`);
        return JSON.parse(cached);
    }
    console.log(`[runComparison] Cache miss for project ${id}, starting new crawl`);

    // Use the streaming logic but accumulate results
    const results: ComparisonResult[] = [];
    
    return new Promise((resolve, reject) => {
        const subject = new Subject<MessageEvent>();
        this.runComparisonStreaming(id, subject);
        
        const oldUrls = new Set<string>();
        const newUrls = new Set<string>();

        subject.subscribe({
            next: (msg) => {
                if (msg.data.type === 'result') {
                    const r = msg.data.result as ComparisonResult;
                    results.push(r);
                    if (r.oldUrl) oldUrls.add(r.oldUrl);
                    if (r.newUrl) newUrls.add(r.newUrl);
                } else if (msg.data.type === 'error') {
                    reject(new Error(msg.data.message));
                } else if (msg.data.type === 'complete') {
                    const metaIssuesCount = results.filter(r => r.status === 'Matched' && r.issues.length > 0).length;
                    
                    resolve({
                        project,
                        summary: {
                            totalOld: oldUrls.size,
                            totalNew: newUrls.size,
                            missing: results.filter(r => r.status === 'Missing').length,
                            newPages: results.filter(r => r.status === 'New').length,
                            metaIssues: metaIssuesCount
                        },
                        results
                    });
                }
            },
            error: (err) => reject(err)
        });
    });
  }

  exportToExcel(report: ProjectReport, filter?: string): Buffer {
    const wb = XLSX.utils.book_new();

    // Filter Logic
    let filteredResults = report.results;
    if (filter && filter !== 'all') {
        filteredResults = report.results.filter(r => {
            if (filter === 'Missing') return r.status === 'Missing' || r.status === 'Error';
            if (filter === 'New') return r.status === 'New';
            if (filter === 'Meta') return r.status === 'Matched' && r.issues.length > 0;
            return true;
        });
    }

    // Single Sheet: "Crawl Report"
    // Columns: Old Url, New Url, Status, Details
    const reportData = filteredResults.map(r => ({
      'Old Url': r.oldUrl || '-',
      'New Url': r.newUrl || '-',
      'Status': r.status,
      'Details': r.issues.length > 0 ? r.issues.join(', ') : 'No Issues'
    }));

    const ws = XLSX.utils.json_to_sheet(reportData);
    
    // Auto-width for better readability (approximate)
    const wscols = [
        { wch: 50 }, // Old Url
        { wch: 50 }, // New Url
        { wch: 15 }, // Status
        { wch: 100 } // Details
    ];
    ws['!cols'] = wscols;

    XLSX.utils.book_append_sheet(wb, ws, "Crawl Report");

    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  }
}
