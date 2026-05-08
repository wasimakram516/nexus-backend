import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { AppLoggerService } from '../services/app-logger.service';

@Catch()
export class AppExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: AppLoggerService) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const context = host.switchToHttp();
    const response = context.getResponse<Response>();
    const request = context.getRequest<
      Request & { requestId?: string; user?: { sub?: string; role?: string } }
    >();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
    const body =
      exception instanceof HttpException ? exception.getResponse() : null;
    const bodyMessage =
      typeof body === 'object' && body !== null
        ? (body as { message?: string | string[] }).message
        : undefined;
    const normalizedMessage = Array.isArray(bodyMessage)
      ? bodyMessage.join(', ')
      : typeof bodyMessage === 'string'
        ? bodyMessage
        : exception instanceof HttpException && typeof body === 'string'
          ? body
          : 'Internal server error';
    const message =
      status === Number(HttpStatus.INTERNAL_SERVER_ERROR)
        ? 'Internal server error'
        : normalizedMessage;
    const validationErrors = Array.isArray(bodyMessage) ? bodyMessage : null;
    const stack = exception instanceof Error ? exception.stack : undefined;

    this.logger.logRequestError({
      requestId: request.requestId,
      method: request.method,
      url: request.originalUrl,
      ip: request.ip,
      userId: request.user?.sub ?? null,
      role: request.user?.role ?? null,
      statusCode: status,
      message,
      exception:
        exception instanceof Error ? exception.name : 'NonErrorException',
      body,
    });

    if (status === 500) {
      this.logger.logUnhandledError(
        {
          requestId: request.requestId,
          method: request.method,
          url: request.originalUrl,
          ip: request.ip,
          userId: request.user?.sub ?? null,
          role: request.user?.role ?? null,
          message,
        },
        stack,
      );
    }

    response.status(status).json({
      success: false,
      message,
      data: null,
      error: {
        code:
          exception instanceof HttpException
            ? 'HTTP_ERROR'
            : 'INTERNAL_SERVER_ERROR',
        details: {
          requestId: request.requestId,
          statusCode: status,
          method: request.method,
          path: request.originalUrl,
          ...(validationErrors ? { validationErrors } : {}),
        },
      },
    });
  }
}
