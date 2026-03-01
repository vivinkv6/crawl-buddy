import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ProjectsModule } from './projects/projects.module';
import { ScraperModule } from './scraper/scraper.module';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { RedisModule } from './redis/redis.module';

@Module({
  imports: [
    RedisModule,
    ProjectsModule,
    ScraperModule,
    // Rate Limiting: 10 requests per 60 seconds
    ThrottlerModule.forRoot([{
        ttl: 60000,
        limit: 10,
    }]),
  ],
  controllers: [AppController],
  providers: [
      AppService,
      {
          provide: APP_GUARD,
          useClass: ThrottlerGuard,
      }
  ],
})
export class AppModule {}
