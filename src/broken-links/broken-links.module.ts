import { Module } from '@nestjs/common';
import { BrokenLinksController } from './broken-links.controller';
import { BrokenLinksService } from './broken-links.service';
import { GuardedHttpService } from './guarded-http.service';
import { LinkCheckerService } from './link-checker.service';
import { SsrfGuardService } from './ssrf-guard.service';

@Module({
  controllers: [BrokenLinksController],
  providers: [
    BrokenLinksService,
    GuardedHttpService,
    LinkCheckerService,
    SsrfGuardService,
  ],
})
export class BrokenLinksModule {}
