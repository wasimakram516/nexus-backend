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
    // M2 Phase 3: lets a handler attach structured context to an error
    // response (e.g. `new ConflictException({ message: '...', outstandingAmount })`
    // for the withdrawal dues-clearance gate, § 7.4) without inventing a
    // second error-shape convention — `message`/`statusCode`/`error` are
    // still pulled out separately above, everything else on an object body
    // rides along under `error.details`. Arrays are excluded so a validation
    // body's normalized shape (`{ message: string[] }`) never leaks numeric
    // index keys into `details`.
    const extraDetails =
      typeof body === 'object' && body !== null && !Array.isArray(body)
        ? Object.fromEntries(
            Object.entries(body as Record<string, unknown>).filter(
              ([key]) => !['message', 'statusCode', 'error'].includes(key),
            ),
          )
        : {};

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
          ...extraDetails,
        },
      },
    });
  }
}
