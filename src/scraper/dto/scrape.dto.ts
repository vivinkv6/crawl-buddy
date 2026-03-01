import { IsNotEmpty, IsUrl, IsIn, IsOptional } from 'class-validator';

export class ScrapeDto {
  @IsNotEmpty()
  @IsUrl({}, { message: 'Please provide a valid URL' })
  url: string;

  @IsOptional()
  @IsIn(['all', 'meta', 'images', 'videos', 'documents', 'content', 'links', 'social', 'contact'])
  contentType?: string = 'all';

  @IsOptional()
  @IsIn(['single', 'entire'])
  scrapeScope?: string = 'entire';
}
