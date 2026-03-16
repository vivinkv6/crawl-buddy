import { Controller, Get, Render, Logger } from '@nestjs/common';

@Controller()
export class AppController {
  private readonly logger = new Logger(AppController.name);

  @Get()
  @Render('index')
  root() {
    this.logger.log('Home page accessed');
    return {};
  }

  @Get('migration')
  @Render('migration')
  migration() {
    this.logger.log('Migration page accessed');
    return {};
  }

  @Get('api/health')
  healthCheck() {
    this.logger.log('Health check accessed');
    return {
      status: 'ok',
      message: 'Server Health OK',
      timestamp: new Date().toISOString(),
    };
  }
}
