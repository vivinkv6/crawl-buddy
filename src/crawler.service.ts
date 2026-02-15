import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { URL } from 'url';

export interface PageData {
  url: string;
  status: number;
  title: string;
  description: string;
  h1: string;
  keywords: string;
  schemas: string[];
  canonical: string;
  robots: string;
  links: string[]; // Outgoing links
}

@Injectable()
export class CrawlerService {
  private readonly logger = new Logger(CrawlerService.name);

  private getBaseDomain(hostname: string): string {
    return hostname.replace(/^www\./, '');
  }

  async crawlSite(startUrl: string, maxPages: number = 10000, onPageFound?: (page: PageData) => void | Promise<void>, cancellationToken?: () => boolean, concurrency: number = 5): Promise<void> {
    const visited = new Set<string>();
    const queue: string[] = [this.normalizeUrl(startUrl)];
    
    const startUrlObj = new URL(startUrl);
    const domain = this.getBaseDomain(startUrlObj.hostname);
    
    const queued = new Set<string>([this.normalizeUrl(startUrl)]);

    // Parallel Processing Queue
    const activePromises = new Set<Promise<void>>();

    while ((queue.length > 0 || activePromises.size > 0) && visited.size < maxPages) {
      if (cancellationToken && cancellationToken()) {
          this.logger.warn(`Crawl cancelled for ${domain}. Stopping...`);
          break;
      }

      // Fill up the active slots
      while (queue.length > 0 && activePromises.size < concurrency && visited.size < maxPages) {
          const currentUrl = queue.shift();
          if (!currentUrl) continue;

          visited.add(currentUrl);
          
          // Simple log throttling
          if (visited.size % 50 === 0) {
              this.logger.log(`Crawling ${domain}: ${visited.size}/${maxPages} pages found. Queue size: ${queue.length}. Active: ${activePromises.size}`);
          }

          // Create promise for this task
          const taskPromise = (async () => {
              try {
                  const pageData = await this.fetchPage(currentUrl);
                  
                  if (cancellationToken && cancellationToken()) return;

                  // Notify callback
                  if (onPageFound) {
                      await onPageFound(pageData);
                  }

                  // Queue links
                  for (const link of pageData.links) {
                      try {
                          const linkUrlObj = new URL(link);
                          if (this.getBaseDomain(linkUrlObj.hostname) === domain && ['http:', 'https:'].includes(linkUrlObj.protocol)) {
                              if (!visited.has(link) && !queued.has(link)) {
                                  queue.push(link);
                                  queued.add(link);
                              }
                          }
                      } catch (e) {
                          // Ignore invalid URLs
                      }
                  }
              } catch (error) {
                  this.logger.error(`Error processing ${currentUrl}: ${error.message}`);
              }
          })();

          // Add to active set
          activePromises.add(taskPromise);
          
          // Remove from active set when done
          taskPromise.finally(() => {
              activePromises.delete(taskPromise);
          });
      }

      // Wait for at least one promise to resolve if queue is empty or slots full
      if (activePromises.size > 0) {
          await Promise.race(activePromises);
      } else if (queue.length === 0 && activePromises.size === 0) {
          break; // Done
      }
    }
    
    this.logger.log(`Crawl finished for ${domain}. Total pages processed: ${visited.size}`);
  }

  // Helper to fetch a single page without crawling (for direct checks)
  async fetchPage(url: string): Promise<PageData> {
      try {
        const response = await axios.get(url, {
          validateStatus: () => true,
          timeout: 10000,
          headers: { 
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
              'Accept-Language': 'en-US,en;q=0.5'
          }
        });

        // Use the final URL from axios (handles redirects)
        const finalUrl = response.request?.res?.responseUrl || url;
        const status = response.status;
        let title = '';
        let description = '';
        let h1 = '';
        let keywords = '';
        const schemas: string[] = [];
        let canonical = '';
        let robots = '';
        const links: string[] = [];

        if (response.headers['content-type']?.includes('text/html')) {
          const $ = cheerio.load(response.data);
          title = $('title').text().trim();
          description = $('meta[name="description"]').attr('content')?.trim() || '';
          h1 = $('h1').first().text().trim();
          keywords = $('meta[name="keywords"]').attr('content')?.trim() || '';
          canonical = $('link[rel="canonical"]').attr('href')?.trim() || '';
          robots = $('meta[name="robots"]').attr('content')?.trim() || '';
          
          // Schema Extraction
          $('script[type="application/ld+json"]').each((_, element) => {
             try {
                 const json = JSON.parse($(element).html() || '{}');
                 const extractTypes = (obj: any): string[] => {
                     if (!obj) return [];
                     if (Array.isArray(obj)) return obj.flatMap(extractTypes);
                     
                     const types: string[] = [];
                     if (obj['@type']) {
                         if (Array.isArray(obj['@type'])) {
                             types.push(...obj['@type']);
                         } else {
                             types.push(obj['@type']);
                         }
                     }
                     if (obj['@graph'] && Array.isArray(obj['@graph'])) {
                         types.push(...extractTypes(obj['@graph']));
                     }
                     return types;
                 };
                 const found = extractTypes(json);
                 schemas.push(...found);
             } catch (e) {
                 // Ignore parse errors
             }
          });
          
          // Check for <base> tag
          const baseHref = $('base').attr('href');
          const baseUrl = baseHref ? new URL(baseHref, finalUrl).href : finalUrl;

          $('a').each((_, element) => {
            const href = $(element).attr('href');
            if (href) {
              try {
                // Resolve relative links against the FINAL URL (or base URL)
                const absoluteUrl = new URL(href, baseUrl).href;
                const normalizedUrl = this.normalizeUrl(absoluteUrl);
                links.push(normalizedUrl);
              } catch (e) {
                // Invalid URL
              }
            }
          });
          
          this.logger.debug(`Fetched ${url} -> ${links.length} links found.`);
        } else {
            this.logger.debug(`Fetched ${url} -> Not HTML (${response.headers['content-type']})`);
        }

        return {
          url: this.normalizeUrl(url), // Return original requested URL as ID
          status,
          title,
          description,
          h1,
          keywords,
          schemas: [...new Set(schemas)], // Unique schemas
          canonical,
          robots,
          links
        };

      } catch (error) {
        this.logger.error(`Failed to fetch ${url}: ${error.message}`);
        // Network error or timeout
        return {
          url: this.normalizeUrl(url),
          status: 0,
          title: '',
          description: '',
          h1: '',
          keywords: '',
          schemas: [],
          canonical: '',
          robots: '',
          links: []
        };
      }
  }

  public normalizeUrl(url: string): string {
    try {
      const urlObj = new URL(url);
      urlObj.hash = '';
      let normalized = urlObj.href;
      if (normalized.endsWith('/') && normalized.length > 1) {
        normalized = normalized.slice(0, -1);
      }
      return normalized;
    } catch {
      return url;
    }
  }
}
