import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import type { AuditMode, CrawlScope } from '../types';
import {
  DEFAULT_MAX_DEPTH,
  MAX_DEPTH,
  MAX_EXCLUDE_PATTERNS,
  MAX_EXCLUDE_PATTERN_LENGTH,
  MAX_PAGES,
} from '../types';

export class CreateAuditDto {
  @IsOptional()
  @IsIn(['page', 'sitemap'])
  mode: AuditMode = 'page';

  @ValidateIf((dto: CreateAuditDto) => dto.mode !== 'sitemap')
  @IsString()
  @MaxLength(2048)
  @IsUrl(
    {
      protocols: ['http', 'https'],
      require_protocol: true,
      require_tld: false,
    },
    { message: 'Please provide a valid HTTP or HTTPS page URL.' },
  )
  url?: string;

  @ValidateIf((dto: CreateAuditDto) => dto.mode === 'sitemap')
  @IsString()
  @MaxLength(2048)
  @IsUrl(
    {
      protocols: ['http', 'https'],
      require_protocol: true,
      require_tld: false,
    },
    { message: 'Please provide a valid HTTP or HTTPS sitemap URL.' },
  )
  sitemapUrl?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGES)
  maxPages: number = MAX_PAGES;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_DEPTH)
  maxDepth: number = DEFAULT_MAX_DEPTH;

  @IsOptional()
  @IsIn(['internal', 'external', 'both'])
  scope: CrawlScope = 'both';

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_EXCLUDE_PATTERNS)
  @IsString({ each: true })
  @MaxLength(MAX_EXCLUDE_PATTERN_LENGTH, { each: true })
  excludePatterns: string[] = [];

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  treatRedirectsAsIssues: boolean = false;
}
