import { looksLikeHtml } from './crawl.util';

describe('looksLikeHtml', () => {
  it('accepts HTML content types', () => {
    expect(looksLikeHtml('text/html; charset=utf-8', null)).toBe(true);
    expect(looksLikeHtml('application/xhtml+xml', null)).toBe(true);
    expect(looksLikeHtml(['text/html', 'text/plain'], null)).toBe(true);
  });

  it('detects HTML when the content type is missing or generic', () => {
    const html = '<!DOCTYPE html><html><body>Hello</body></html>';

    expect(looksLikeHtml(undefined, html)).toBe(true);
    expect(looksLikeHtml('text/plain', html)).toBe(true);
    expect(looksLikeHtml('application/octet-stream', html)).toBe(true);
    expect(looksLikeHtml('text/plain; charset=utf-8', html)).toBe(true);
  });

  it('rejects non-HTML content', () => {
    expect(looksLikeHtml('application/xml', '<html></html>')).toBe(false);
    expect(looksLikeHtml('application/json', '{}')).toBe(false);
    expect(looksLikeHtml('text/plain', 'plain text')).toBe(false);
    expect(looksLikeHtml(undefined, undefined)).toBe(false);
  });
});
