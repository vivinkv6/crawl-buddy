import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateAuditDto } from './create-audit.dto';

describe('CreateAuditDto validation', () => {
  it('accepts a valid configuration and applies sensible defaults', async () => {
    const dto = plainToInstance(CreateAuditDto, {
      url: 'https://example.com',
    });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
    expect(dto.mode).toBe('page');
    expect(dto.maxPages).toBe(10000);
    expect(dto.maxDepth).toBe(3);
    expect(dto.scope).toBe('both');
    expect(dto.excludePatterns).toEqual([]);
    expect(dto.treatRedirectsAsIssues).toBe(false);
  });

  it('accepts each supported link scope', async () => {
    for (const scope of ['internal', 'external', 'both']) {
      const dto = plainToInstance(CreateAuditDto, {
        url: 'https://example.com',
        scope,
      });

      expect(await validate(dto)).toHaveLength(0);
    }
  });

  it('accepts sitemap mode with a sitemap URL', async () => {
    const dto = plainToInstance(CreateAuditDto, {
      mode: 'sitemap',
      sitemapUrl: 'https://example.com/sitemap.xml',
    });

    expect(await validate(dto)).toHaveLength(0);
  });

  it('requires the URL that matches the selected mode', async () => {
    const missingSitemap = plainToInstance(CreateAuditDto, {
      mode: 'sitemap',
    });
    expect(
      (await validate(missingSitemap)).some(
        (error) => error.property === 'sitemapUrl',
      ),
    ).toBe(true);

    const missingPage = plainToInstance(CreateAuditDto, {
      mode: 'page',
    });
    expect(
      (await validate(missingPage)).some((error) => error.property === 'url'),
    ).toBe(true);

    const invalidMode = plainToInstance(CreateAuditDto, {
      mode: 'website',
      url: 'https://example.com',
    });
    expect(
      (await validate(invalidMode)).some((error) => error.property === 'mode'),
    ).toBe(true);
  });

  it('rejects unsupported protocols and malformed URLs', async () => {
    for (const url of [
      'ftp://example.com',
      'example.com',
      'javascript:alert(1)',
    ]) {
      const dto = plainToInstance(CreateAuditDto, { url });
      const errors = await validate(dto);
      expect(errors.some((error) => error.property === 'url')).toBe(true);
    }
  });

  it('rejects out-of-range crawl limits and invalid scope values', async () => {
    const dto = plainToInstance(CreateAuditDto, {
      url: 'https://example.com',
      maxPages: 10001,
      maxDepth: 11,
      scope: 'everything',
    });

    const errors = await validate(dto);
    const properties = errors.map((error) => error.property);

    expect(properties).toContain('maxPages');
    expect(properties).toContain('maxDepth');
    expect(properties).toContain('scope');
  });

  it('limits exclusion patterns and their length', async () => {
    const dto = plainToInstance(CreateAuditDto, {
      url: 'https://example.com',
      excludePatterns: Array.from(
        { length: 26 },
        (_, index) => `/path-${index}`,
      ),
    });
    const errors = await validate(dto);
    expect(errors.some((error) => error.property === 'excludePatterns')).toBe(
      true,
    );

    const longPattern = plainToInstance(CreateAuditDto, {
      url: 'https://example.com',
      excludePatterns: ['x'.repeat(201)],
    });
    const longErrors = await validate(longPattern);
    expect(
      longErrors.some((error) => error.property === 'excludePatterns'),
    ).toBe(true);
  });

  it('transforms string boolean values', async () => {
    const dto = plainToInstance(CreateAuditDto, {
      url: 'https://example.com',
      treatRedirectsAsIssues: 'true',
    });

    expect(dto.treatRedirectsAsIssues).toBe(true);
    expect(await validate(dto)).toHaveLength(0);
  });
});
