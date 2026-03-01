import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { Response } from 'express';
import { ThrottlerException } from '@nestjs/throttler';

@Catch(ThrottlerException)
export class ThrottlerExceptionFilter implements ExceptionFilter {
  catch(exception: ThrottlerException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest();

    const retryAfter = 60;
    const referer = request.headers?.referer || '/';

    response.status(HttpStatus.TOO_MANY_REQUESTS).render('rate-limit', {
      page: 'rate-limit',
      retryAfter: retryAfter,
      refererUrl: referer,
    });
  }
}
