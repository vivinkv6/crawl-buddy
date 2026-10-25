export interface ParsedHttpUrl {
  url: URL;
  normalized: string;
}

export function parseHttpUrl(raw: string): ParsedHttpUrl | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null;
    }
    return { url, normalized: normalizeUrl(url) };
  } catch {
    return null;
  }
}

export function resolveHttpUrl(
  href: string,
  baseUrl: string,
): ParsedHttpUrl | null {
  try {
    return parseHttpUrl(new URL(href, baseUrl).href);
  } catch {
    return null;
  }
}

export function normalizeUrl(input: string | URL): string {
  const url = typeof input === 'string' ? new URL(input) : new URL(input.href);
  url.hash = '';
  if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
    url.pathname = url.pathname.replace(/\/+$/, '') || '/';
  }
  return url.href;
}

export function hostnameEquals(a: string, b: string): boolean {
  return (
    a.toLowerCase().replace(/\.$/, '') === b.toLowerCase().replace(/\.$/, '')
  );
}

export function isInternalUrl(
  candidate: string | URL,
  rootHostname: string,
): boolean {
  try {
    const url = typeof candidate === 'string' ? new URL(candidate) : candidate;
    return hostnameEquals(url.hostname, rootHostname);
  } catch {
    return false;
  }
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function globToRegExp(pattern: string): RegExp | null {
  const trimmed = pattern.trim();
  if (!trimmed) return null;
  const source = escapeRegExp(trimmed).replace(/\\\*/g, '.*');
  try {
    return new RegExp(source, 'i');
  } catch {
    return null;
  }
}

export function compileExclusionPatterns(patterns: string[]): RegExp[] {
  return patterns
    .map((pattern) => globToRegExp(pattern))
    .filter((pattern): pattern is RegExp => pattern !== null);
}

export function isExcludedUrl(
  absoluteUrl: string,
  patterns: RegExp[],
): boolean {
  if (patterns.length === 0) return false;
  let pathAndQuery = absoluteUrl;
  try {
    const url = new URL(absoluteUrl);
    pathAndQuery = `${url.pathname}${url.search}`;
  } catch {
    // Fall back to full string for malformed values.
  }
  return patterns.some(
    (pattern) => pattern.test(absoluteUrl) || pattern.test(pathAndQuery),
  );
}

export function sanitizeAnchorText(value: string, maxLength: number): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, maxLength);
}
