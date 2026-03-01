import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import * as cheerio from 'cheerio';

export interface MessageEvent {
  data: any;
}

@Injectable()
export class ScraperService {
  private readonly logger = new Logger(ScraperService.name);

  // --- Extraction Helpers ---

  extractContactInfo($: cheerio.CheerioAPI) {
    const contacts = { emails: [] as string[], phones: [] as string[], whatsapp: [] as string[] };
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

    $('body').text().match(emailRegex)?.forEach(email => {
      if (!contacts.emails.includes(email)) contacts.emails.push(email);
    });
    $('a[href^="mailto:"]').each((_, element) => {
      const href = $(element).attr('href');
      if (!href) return;
      const email = href.replace('mailto:', '').split('?')[0].trim();
      if (email && email.match(emailRegex) && !contacts.emails.includes(email)) contacts.emails.push(email);
    });
    $('meta[name*="email"], meta[property*="email"]').each((_, element) => {
      const content = $(element).attr('content');
      if (content && content.match(emailRegex) && !contacts.emails.includes(content)) contacts.emails.push(content);
    });

    const phoneRegex = /(?:\+?\d{1,3}[-. ]?)?(?:\(?\d{3}\)?[-. ]?\d{3}[-. ]?\d{4}|\d{10,12})(?:\s*(?:x|ext)\.?\s*\d{1,5})?/gi;
    const phoneMatches: string[] = $('body').text().match(phoneRegex) || [];
    phoneMatches.forEach(phone => {
      const digits = phone.replace(/\D/g, '');
      if (digits.length >= 10 && digits.length <= 15) {
        const isLikelyPhoneNumber = (
          /^\+?\d{1,3}?[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}$/.test(phone.trim()) ||
          /^\+\d{10,14}$/.test(phone.trim()) ||
          /^\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}$/.test(phone.trim())
        );
        if (isLikelyPhoneNumber) {
          const formattedPhone = phone.trim();
          if (!contacts.phones.includes(formattedPhone)) contacts.phones.push(formattedPhone);
        }
      }
    });

    $('a[href*="wa.me"], a[href*="whatsapp.com"]').each((_, element) => {
      const whatsappLink = $(element).attr('href');
      if (whatsappLink && !contacts.whatsapp.includes(whatsappLink)) contacts.whatsapp.push(whatsappLink);
    });

    return contacts;
  }

  extractContent($: cheerio.CheerioAPI) {
    $('script, style').remove();
    const content: any[] = [];
    const mainSelectors = ['main', 'article', '.content', '.main-content'];
    let contentContainer: cheerio.Cheerio<any> | null = null;

    for (const selector of mainSelectors) {
      if ($(selector).length > 0) { contentContainer = $(selector); break; }
    }
    if (!contentContainer) {
      contentContainer = $('body').clone();
      contentContainer.find('header, footer, nav, aside').remove();
    }

    contentContainer.children().each((_, element) => {
      const el = $(element);
      const tagName = (el.prop('tagName') || '').toLowerCase();

      if (/^h[1-6]$/.test(tagName)) {
        content.push({ type: 'heading', level: parseInt(tagName.slice(1)), text: el.text().trim() });
      } else if (tagName === 'p') {
        const text = el.text().trim();
        if (text) content.push({ type: 'paragraph', text });
      } else if (tagName === 'ul' || tagName === 'ol') {
        const items: any[] = [];
        el.find('li').each((_, li) => {
          const $li = $(li);
          const item: any = { text: $li.clone().children('ul, ol').remove().end().text().trim() };
          const nestedList = $li.children('ul, ol');
          if (nestedList.length > 0) {
            item.items = [];
            nestedList.find('> li').each((_, nestedLi) => { item.items.push($(nestedLi).text().trim()); });
          }
          items.push(item);
        });
        if (items.length > 0) content.push({ type: 'list', listType: tagName === 'ol' ? 'ordered' : 'unordered', items });
      } else {
        const text = el.text().trim();
        if (text && !['script', 'style', 'noscript'].includes(tagName)) {
          content.push({ type: 'paragraph', text });
        }
      }
    });
    return content;
  }

  extractMetaTags($: cheerio.CheerioAPI) {
    const metaTags: any[] = [];
    $('meta').each((_, element) => {
      const meta: any = {};
      const el = $(element);
      if (el.attr('name')) meta.name = el.attr('name');
      if (el.attr('property')) meta.property = el.attr('property');
      if (el.attr('content')) meta.content = el.attr('content');
      if (Object.keys(meta).length > 0) metaTags.push(meta);
    });
    return metaTags;
  }

  extractImages($: cheerio.CheerioAPI) {
    const images: string[] = [];
    $('img').each((_, element) => {
      const src = $(element).attr('src');
      if (src && !images.includes(src)) images.push(src);
    });
    return images;
  }

  extractVideos($: cheerio.CheerioAPI, baseUrl: string) {
    const videos: string[] = [];
    const processedUrls = new Set<string>();

    const addVideo = (src: string | undefined) => {
      if (!src) return;
      let url = src;
      if (url.startsWith('//')) url = 'https:' + url;
      else if (url.startsWith('/')) url = new URL(url, baseUrl).href;
      else if (!url.startsWith('http') && !url.startsWith('//')) url = new URL(url, baseUrl).href;
      if (!processedUrls.has(url)) {
        processedUrls.add(url);
        videos.push(url);
      }
    };

    $('video').each((_, el) => {
      const src = $(el).attr('src') || $(el).attr('data-src');
      addVideo(src);
      $(el).find('source').each((_, source) => {
        const sourceSrc = $(source).attr('src');
        addVideo(sourceSrc);
      });
    });

    $('iframe[src]').each((_, el) => {
      const src = $(el).attr('src');
      addVideo(src);
    });

    $('a[href]').each((_, el) => {
      const href = $(el).attr('href');
      if (href && /\.(mp4|webm|ogg|avi|mov|mkv|wmv|flv|swf)(?:[?#]|$)/i.test(href)) {
        addVideo(href);
      }
    });

    $('[style*="background"]').each((_, el) => {
      const style = $(el).attr('style') || '';
      const match = style.match(/url\(['"]?([^'")\s]+(?:mp4|webm|ogg|avi|mov|mkv)[^'")\s]*)/i);
      if (match) addVideo(match[1]);
    });

    return videos;
  }

  extractDocuments($: cheerio.CheerioAPI) {
    const documents: string[] = [];
    $('a[href$=".pdf"], a[href$=".doc"], a[href$=".docx"], a[href$=".xls"], a[href$=".xlsx"], a[href$=".ppt"], a[href$=".pptx"]').each((_, element) => {
      const href = $(element).attr('href');
      if (href && !documents.includes(href)) documents.push(href);
    });
    return documents;
  }

  extractSocialMedia($: cheerio.CheerioAPI) {
    const socialMedia: string[] = [];
    const socialPlatforms: Record<string, string[]> = {
      'facebook': ['facebook.com', 'fb.com', 'fb.me'],
      'twitter': ['twitter.com', 'x.com'],
      'instagram': ['instagram.com', 'instagr.am'],
      'linkedin': ['linkedin.com', 'lnkd.in'],
      'youtube': ['youtube.com', 'youtu.be'],
      'pinterest': ['pinterest.com', 'pin.it'],
      'tiktok': ['tiktok.com', 'vm.tiktok.com'],
      'snapchat': ['snapchat.com'],
      'reddit': ['reddit.com'],
      'medium': ['medium.com'],
      'github': ['github.com'],
      'telegram': ['t.me', 'telegram.me'],
      'whatsapp': ['wa.me', 'whatsapp.com'],
    };

    $('a').each((_, element) => {
      const href = $(element).attr('href');
      if (href) {
        try {
          let normalizedUrl = href.toLowerCase();
          if (normalizedUrl.startsWith('//')) normalizedUrl = 'https:' + normalizedUrl;

          for (const [, domains] of Object.entries(socialPlatforms)) {
            if (domains.some(domain => normalizedUrl.includes(domain))) {
              try {
                const url = new URL(normalizedUrl);
                if (!socialMedia.includes(url.href)) socialMedia.push(url.href);
              } catch {
                try {
                  const baseUrl = 'https://' + domains[0];
                  const absoluteUrl = new URL(normalizedUrl, baseUrl).href;
                  if (!socialMedia.includes(absoluteUrl)) socialMedia.push(absoluteUrl);
                } catch { /* ignore */ }
              }
              break;
            }
          }
        } catch { /* ignore */ }
      }
    });
    return socialMedia;
  }

  extractLinks($: cheerio.CheerioAPI, baseUrl: string) {
    const links: string[] = [];
    const excludeExtensions = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.zip', '.rar', '.7z'];

    $('a').each((_, element) => {
      const href = $(element).attr('href');
      if (href) {
        try {
          const url = new URL(href, baseUrl);
          url.hash = '';
          const absoluteUrl = url.href;
          const hasExcludedExtension = excludeExtensions.some(ext => absoluteUrl.toLowerCase().endsWith(ext));
          if (absoluteUrl.startsWith(baseUrl) && !hasExcludedExtension && !links.includes(absoluteUrl)) {
            links.push(absoluteUrl);
          }
        } catch { /* skip invalid URLs */ }
      }
    });
    return links;
  }

  // --- Main Scraping Methods ---

  async scrapePage(url: string, contentType: string) {
    try {
      const response = await axios.get(url, {
        timeout: 30000,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CrawlWise/1.0)' },
      });
      const $ = cheerio.load(response.data);
      const result: any = { url };

      if (contentType === 'all' || contentType === 'meta') result.meta = this.extractMetaTags($);
      if (contentType === 'all' || contentType === 'images') result.images = this.extractImages($);
      if (contentType === 'all' || contentType === 'videos') result.videos = this.extractVideos($, url);
      if (contentType === 'all' || contentType === 'documents') result.documents = this.extractDocuments($);
      if (contentType === 'all' || contentType === 'social') result.socialMedia = this.extractSocialMedia($);
      if (contentType === 'all' || contentType === 'links') result.links = this.extractLinks($, url);
      if (contentType === 'all' || contentType === 'content') result.content = this.extractContent($);
      if (contentType === 'all' || contentType === 'contact') result.contacts = this.extractContactInfo($);

      return result;
    } catch (error) {
      if (error.response) {
        switch (error.response.status) {
          case 400: throw new Error(`Bad Request: The provided URL '${url}' is invalid or malformed.`);
          case 403: throw new Error(`Access Forbidden: The website '${url}' has restricted access to web scraping.`);
          case 413: throw new Error(`Content Too Large: The website '${url}' contains too much data to process.`);
          case 500: throw new Error(`Internal Server Error: The website '${url}' is experiencing technical difficulties.`);
          default: throw new Error(`Failed to scrape ${url}: ${error.response.status} - ${error.response.statusText}`);
        }
      } else if (error.request) {
        throw new Error(`Network Error: Unable to reach ${url}. Please check your internet connection.`);
      } else {
        throw new Error(`Error occurred while scraping ${url}: ${error.message}`);
      }
    }
  }

  async scrapeWebsite(baseUrl: string, contentType: string, maxPages = 100) {
    const visited = new Set<string>();
    const queue = [new URL(baseUrl).href];
    const results: any[] = [];
    const failedUrls = new Set<string>();

    while (queue.length > 0 && results.length < maxPages) {
      const url = queue.shift();
      if (!url || visited.has(url) || failedUrls.has(url)) continue;

      try {
        const pageData = await this.scrapePage(url, contentType);
        results.push(pageData);
        visited.add(url);

        const response = await axios.get(url, {
          timeout: 30000,
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CrawlWise/1.0)' },
        });
        const $ = cheerio.load(response.data);
        const newLinks = this.extractLinks($, url);

        const normalizedLinks = newLinks
          .map(link => { try { return new URL(link, url).href; } catch { return null; } })
          .filter((link): link is string => !!link && link.startsWith(baseUrl) && !visited.has(link) && !failedUrls.has(link));
        queue.push(...normalizedLinks);
      } catch (error) {
        let errorMessage: string;
        if (error.response) {
          switch (error.response.status) {
            case 400: errorMessage = `Bad Request: '${url}' is invalid.`; break;
            case 403: errorMessage = `Access Forbidden: '${url}' restricted.`; break;
            case 413: errorMessage = `Content Too Large: '${url}'.`; break;
            case 500: errorMessage = `Server Error: '${url}'.`; break;
            default: errorMessage = `Failed to scrape ${url}: ${error.response.status}`;
          }
        } else if (error.request) {
          errorMessage = `Network Error: Unable to reach ${url}.`;
        } else {
          errorMessage = `Error scraping ${url}: ${error.message?.split(':')[0]}`;
        }
        this.logger.error(errorMessage);
        failedUrls.add(url);
        results.push({ url, error: errorMessage });
      }
    }

    if (results.length === 0) {
      throw new Error(`Unable to scrape any pages from ${baseUrl}.`);
    }
    return results;
  }

  async getSitemapUrlCount(sitemapUrl: string, maxDepth = 3, currentDepth = 0): Promise<number> {
    if (currentDepth >= maxDepth) return 0;
    
    try {
      const response = await axios.get(sitemapUrl, {
        timeout: 30000,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CrawlBuddy/1.0)' },
      });

      const $ = cheerio.load(response.data, { xmlMode: true });
      
      if ($('sitemapindex').length > 0) {
        let count = 0;
        const nested: string[] = [];
        $('sitemap loc').each((_, el) => {
          const u = $(el).text().trim();
          if (u) nested.push(u);
        });
        for (const n of nested) {
          count += await this.getSitemapUrlCount(n, maxDepth, currentDepth + 1);
        }
        return count;
      } else if ($('urlset').length > 0) {
        return $('url loc').length;
      }
    } catch (error) {
      this.logger.error(`Failed to count sitemap ${sitemapUrl}: ${error.message}`);
    }
    return 0;
  }

  async streamSitemapUrls(
    sitemapUrl: string,
    onUrlFound: (url: string, index: number) => void,
    maxDepth = 3,
    currentDepth = 0,
    maxPages = 10000
  ): Promise<number> {
    const seenUrls = new Set<string>();
    let urlIndex = 0;

    const processUrl = (url: string): boolean => {
      if (!url || seenUrls.has(url) || urlIndex >= maxPages) return false;
      seenUrls.add(url);
      urlIndex++;
      onUrlFound(url, urlIndex);
      return true;
    };

    const parseRecursive = async (url: string, depth: number): Promise<void> => {
      if (depth >= maxDepth || urlIndex >= maxPages) return;
      
      try {
        const response = await axios.get(url, {
          timeout: 30000,
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CrawlBuddy/1.0)' },
        });

        const $ = cheerio.load(response.data, { xmlMode: true });
        
        if ($('sitemapindex').length > 0) {
          const nested: string[] = [];
          $('sitemap loc').each((_, el) => {
            const u = $(el).text().trim();
            if (u) nested.push(u);
          });
          for (const n of nested) {
            if (urlIndex >= maxPages) break;
            await parseRecursive(n, depth + 1);
          }
        } else if ($('urlset').length > 0) {
          $('url loc').each((_, el) => {
            if (urlIndex >= maxPages) return;
            const u = $(el).text().trim();
            processUrl(u);
          });
        } else {
          const text = $('body').text();
          const matches = text.match(/https?:\/\/[^\s<>"{}|\\^`\[\]]+/g);
          if (matches) {
            for (const m of matches) {
              if (urlIndex >= maxPages) break;
              if (m.startsWith('http')) processUrl(m);
            }
          }
        }
      } catch (error) {
        this.logger.error(`Failed to parse sitemap ${url}: ${error.message}`);
      }
    };

    await parseRecursive(sitemapUrl, currentDepth);
    return urlIndex;
  }

  async parseSitemap(sitemapUrl: string, maxDepth = 3, currentDepth = 0): Promise<string[]> {
    const urls: string[] = [];
    
    if (currentDepth >= maxDepth) {
      return urls;
    }
    
    try {
      const response = await axios.get(sitemapUrl, {
        timeout: 30000,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CrawlWise/1.0)' },
      });

      const $ = cheerio.load(response.data, { xmlMode: true });
      const sitemapIndex = $('sitemapindex').length > 0;
      const urlset = $('urlset').length > 0;

      if (sitemapIndex) {
        const nestedSitemaps: string[] = [];
        $('sitemap loc').each((_, element) => {
          const subSitemapUrl = $(element).text().trim();
          if (subSitemapUrl) nestedSitemaps.push(subSitemapUrl);
        });

        for (const nestedSitemap of nestedSitemaps) {
          const nestedUrls = await this.parseSitemap(nestedSitemap, maxDepth, currentDepth + 1);
          urls.push(...nestedUrls);
        }
      } else if (urlset) {
        $('url loc').each((_, element) => {
          const pageUrl = $(element).text().trim();
          if (pageUrl) urls.push(pageUrl);
        });
      } else {
        const textContent = $('body').text();
        const urlMatches = textContent.match(/https?:\/\/[^\s<>"{}|\\^`\[\]]+/g);
        if (urlMatches) {
          urls.push(...urlMatches.filter(url => url.startsWith('http')));
        }
      }
    } catch (error) {
      this.logger.error(`Failed to parse sitemap: ${error.message}`);
    }

    return [...new Set(urls)];
  }

  async scrapeFromSitemap(sitemapUrl: string, contentType: string, maxPages = 100) {
    const urls = await this.parseSitemap(sitemapUrl);
    
    if (urls.length === 0) {
      throw new Error('No URLs found in sitemap');
    }

    const results: any[] = [];
    const failedUrls = new Set<string>();
    const uniqueUrls = [...new Set(urls)].slice(0, maxPages);

    for (const url of uniqueUrls) {
      if (failedUrls.has(url)) continue;

      try {
        const pageData = await this.scrapePage(url, contentType);
        results.push(pageData);
      } catch (error) {
        let errorMessage: string;
        if (error.response) {
          switch (error.response.status) {
            case 400: errorMessage = `Bad Request: '${url}' is invalid.`; break;
            case 403: errorMessage = `Access Forbidden: '${url}' restricted.`; break;
            case 413: errorMessage = `Content Too Large: '${url}'.`; break;
            case 500: errorMessage = `Server Error: '${url}'.`; break;
            default: errorMessage = `Failed to scrape ${url}: ${error.response.status}`;
          }
        } else if (error.request) {
          errorMessage = `Network Error: Unable to reach ${url}.`;
        } else {
          errorMessage = `Error scraping ${url}: ${error.message?.split(':')[0]}`;
        }
        this.logger.error(errorMessage);
        failedUrls.add(url);
        results.push({ url, error: errorMessage });
      }
    }

    if (results.length === 0) {
      throw new Error(`Unable to scrape any pages from the sitemap.`);
    }

    return results;
  }
}
