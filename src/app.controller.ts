import { Controller, Get, Render } from '@nestjs/common';

@Controller()
export class AppController {
  @Get()
  @Render('index')
  root() {
    return {};
  }

  @Get('migration')
  @Render('migration')
  migration() {
    return {};
  }

  @Get('api/health')
  healthCheck() {
    return {
      status: 'ok',
      message: 'Server Health OK',
      timestamp: new Date().toISOString(),
    };
  }
}
