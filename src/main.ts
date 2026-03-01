import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { AppModule } from './app.module';
import helmet from 'helmet';
import { ValidationPipe } from '@nestjs/common';
import { ThrottlerExceptionFilter } from './filters/throttler-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(
    AppModule,
  );

  // Security Headers
  app.use(helmet({
      contentSecurityPolicy: {
          directives: {
              defaultSrc: ["'self'"],
              scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"], // Allow Bootstrap & Axios
              styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://fonts.googleapis.com"],
              fontSrc: ["'self'", "https://cdn.jsdelivr.net", "https://fonts.gstatic.com"],
              imgSrc: ["'self'", "data:", "https:"],
          },
      },
  }));

  // Global Validation Pipe
  app.useGlobalPipes(new ValidationPipe({
      whitelist: true, // Strip properties not in DTO
      forbidNonWhitelisted: true, // Throw error if extra properties present
      transform: true, // Auto transform payloads to DTO instances
  }));

  // Apply throttler exception filter globally
  app.useGlobalFilters(new ThrottlerExceptionFilter());

  // Increase body-parser limits for large download payloads
  app.useBodyParser('json', { limit: '500mb' });
  app.useBodyParser('urlencoded', { limit: '500mb', extended: true });

  app.useStaticAssets(join(__dirname, '..', 'public'));
  app.setBaseViewsDir(join(__dirname, '..', 'views'));
  app.setViewEngine('ejs');

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
