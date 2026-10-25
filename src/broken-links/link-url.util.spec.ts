import {
  compileExclusionPatterns,
  isExcludedUrl,
  isInternalUrl,
  normalizeUrl,
  resolveHttpUrl,
  sanitizeAnchorText,
} from './link-url.util';

describe('link-url.util', () => {
  describe('resolveHttpUrl', () => {
    it('resolves relative URLs against the page URL', () => {
      expect(
        resolveHttpUrl('/docs/start', 'https://example.com/blog/post')
          ?.normalized,
      ).toBe('https://example.com/docs/start');
    });

    it('resolves protocol-relative URLs', () => {
      expect(
        resolveHttpUrl('//cdn.example.org/file.pdf', 'https://example.com')
          ?.normalized,
      ).toBe('https://cdn.example.org/file.pdf');
    });

    it('keeps absolute URLs and removes fragments', () => {
      expect(
        resolveHttpUrl(
          'https://other.example/path#section',
          'https://example.com',
        )?.normalized,
      ).toBe('https://other.example/path');
    });

    it('rejects non-HTTP schemes', () => {
      expect(
        resolveHttpUrl('mailto:test@example.com', 'https://example.com'),
      ).toBeNull();
      expect(
        resolveHttpUrl('tel:+123456789', 'https://example.com'),
      ).toBeNull();
      expect(
        resolveHttpUrl('javascript:alert(1)', 'https://example.com'),
      ).toBeNull();
    });
  });

  describe('normalizeUrl', () => {
    it('removes fragments and duplicate trailing slashes', () => {
      expect(normalizeUrl('https://Example.com/path/#team')).toBe(
        'https://example.com/path',
      );
    });

    it('keeps meaningful query parameters', () => {
      expect(normalizeUrl('https://example.com/search?q=shoes&page=2')).toBe(
        'https://example.com/search?q=shoes&page=2',
      );
    });

    it('keeps the root path intact', () => {
      expect(normalizeUrl('https://example.com/')).toBe('https://example.com/');
    });
  });

  describe('isInternalUrl', () => {
    it('treats the same hostname as internal', () => {
      expect(isInternalUrl('https://example.com/about', 'example.com')).toBe(
        true,
      );
    });

    it('treats different hosts and subdomains as external', () => {
      expect(
        isInternalUrl('https://blog.example.com/post', 'example.com'),
      ).toBe(false);
      expect(isInternalUrl('https://other.example/', 'example.com')).toBe(
        false,
      );
    });
  });

  describe('exclusions', () => {
    it('matches wildcard patterns against paths and query strings', () => {
      const patterns = compileExclusionPatterns(['/admin/*', '*/cart*']);
      expect(isExcludedUrl('https://example.com/admin/users', patterns)).toBe(
        true,
      );
      expect(
        isExcludedUrl('https://example.com/shop/cart?id=1', patterns),
      ).toBe(true);
      expect(isExcludedUrl('https://example.com/products', patterns)).toBe(
        false,
      );
    });
  });

  it('collapses whitespace in anchor text and enforces a limit', () => {
    expect(sanitizeAnchorText('  Read\n   more  ', 100)).toBe('Read more');
    expect(sanitizeAnchorText('abcdef', 3)).toBe('abc');
  });
});
