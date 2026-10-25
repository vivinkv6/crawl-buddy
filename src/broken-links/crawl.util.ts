import * as cheerio from 'cheerio';

export interface DiscoveredAnchor {
  href: string;
  text: string;
}

export interface SitemapEntries {
  pages: string[];
  sitemaps: string[];
}

export function extractAnchors(html: string): DiscoveredAnchor[] {
  if (!html) return [];

  const $ = cheerio.load(html);

  const anchors: DiscoveredAnchor[] = [];
  $('a[href]').each((_, element) => {
    const href = $(element).attr('href');
    if (!href) return;
    anchors.push({
      href,
      text: $(element).text(),
    });
  });

  return anchors;
}

export function isHtmlContentType(
  contentType: string | string[] | undefined,
): boolean {
  const value = Array.isArray(contentType) ? contentType[0] : contentType;
  if (!value) return false;
  return /text\/html|application\/xhtml\+xml/i.test(value);
}

export function looksLikeHtml(
  contentType: string | string[] | undefined,
  body: string | null | undefined,
): boolean {
  if (isHtmlContentType(contentType)) return true;

  const value = Array.isArray(contentType) ? contentType[0] : contentType;
  const mimeType = value?.split(';')[0]?.trim().toLowerCase();
  if (
    mimeType &&
    mimeType !== 'text/plain' &&
    mimeType !== 'application/octet-stream'
  ) {
    return false;
  }

  const head = (body ?? '').slice(0, 2048);
  return /^\s*(?:<!doctype\s+html[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<html[\s>]/i.test(
    head,
  );
}

export function parseSitemap(xml: string): SitemapEntries {
  const $ = cheerio.load(xml, { xmlMode: true });
  const pages: string[] = [];
  const sitemaps: string[] = [];

  $('loc').each((_, element) => {
    const loc = $(element).text().trim();
    if (!loc) return;
    const parent = $(element).parent();
    const parentTag = parent.get(0)?.tagName?.toLowerCase() ?? '';
    if (parentTag.endsWith('sitemap')) {
      sitemaps.push(loc);
    } else {
      pages.push(loc);
    }
  });

  return { pages, sitemaps };
}
