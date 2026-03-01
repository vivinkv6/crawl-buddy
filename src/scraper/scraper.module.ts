import { Module } from '@nestjs/common';
import { ScraperController } from './scraper.controller';
import { ScraperService } from './scraper.service';
import { DownloadService } from './download.service';

@Module({
  controllers: [ScraperController],
  providers: [ScraperService, DownloadService],
})
export class ScraperModule {}
