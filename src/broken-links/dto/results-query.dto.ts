import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { MAX_LINKS_PER_AUDIT } from '../types';

export const RESULT_FILTERS = [
  'all',
  'broken',
  'healthy',
  'redirect',
  'server_error',
  'restricted',
  'unverified',
  'pending',
] as const;

export const RESULT_SORT_FIELDS = [
  'sourcePage',
  'destinationUrl',
  'anchorText',
  'linkType',
  'status',
  'issueType',
  'finalUrl',
] as const;

export class ResultsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_LINKS_PER_AUDIT)
  pageSize: number = 50;

  @IsOptional()
  @IsIn(RESULT_FILTERS)
  status: (typeof RESULT_FILTERS)[number] = 'all';

  @IsOptional()
  @IsIn(['all', 'internal', 'external'])
  linkType: 'all' | 'internal' | 'external' = 'all';

  @IsOptional()
  @IsString()
  @MaxLength(200)
  search: string = '';

  @IsOptional()
  @IsIn(RESULT_SORT_FIELDS)
  sortBy: (typeof RESULT_SORT_FIELDS)[number] = 'sourcePage';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortDir: 'asc' | 'desc' = 'asc';
}
