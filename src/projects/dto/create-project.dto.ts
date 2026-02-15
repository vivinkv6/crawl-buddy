import { IsUrl, IsNotEmpty, IsOptional } from 'class-validator';
import { Transform } from 'class-transformer';
import * as sanitizeHtml from 'sanitize-html';

export class CreateProjectDto {
  @IsNotEmpty()
  @IsUrl({ require_protocol: true, protocols: ['http', 'https'] }, { message: 'Old Site URL must be a valid HTTP/HTTPS URL' })
  @Transform(({ value }) => sanitizeHtml.default(value?.trim()))
  oldSiteUrl: string;

  @IsNotEmpty()
  @IsUrl({ require_protocol: true, protocols: ['http', 'https'] }, { message: 'New Site URL must be a valid HTTP/HTTPS URL' })
  @Transform(({ value }) => sanitizeHtml.default(value?.trim()))
  newSiteUrl: string;

  @IsOptional()
  @Transform(({ value }) => {
    // If empty string, convert to undefined so IsUrl is skipped
    if (!value || value.trim() === '') return undefined;
    return sanitizeHtml.default(value.trim());
  })
  @IsUrl({ require_protocol: true, protocols: ['http', 'https'] }, { message: 'Sitemap URL must be a valid HTTP/HTTPS URL' })
  sitemapUrl?: string;
}
