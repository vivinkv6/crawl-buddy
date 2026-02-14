import { Module } from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { ProjectsController } from './projects.controller';
import { PrismaService } from '../prisma.service';
import { CrawlerService } from '../crawler.service';

@Module({
  providers: [
    ProjectsService, 
    PrismaService, 
    CrawlerService
  ],
  controllers: [ProjectsController]
})
export class ProjectsModule {}
