import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { NextFunction, Request, Response } from 'express';
import { AppLoggerService } from '../services/app-logger.service';
import { RequestContextService } from '../services/request-context.service';

export interface RequestWithContext extends Request {
  requestId?: string;
}

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  constructor(
    private readonly logger: AppLoggerService,
    private readonly requestContext: RequestContextService,
  ) {}

  use(req: RequestWithContext, res: Response, next: NextFunction) {
    req.requestId = randomUUID();
    res.setHeader('X-Request-Id', req.requestId);

    const startedAt = Date.now();
    const { method, originalUrl, ip } = req;

    this.requestContext.run({ requestId: req.requestId }, () => {
      this.logger.logRequestStart({
        requestId: req.requestId,
        method,
        url: originalUrl,
        ip,
      });

      res.on('finish', () => {
        this.logger.logRequestCompletion({
          requestId: req.requestId,
          method,
          url: originalUrl,
          ip,
          statusCode: res.statusCode,
          durationMs: Date.now() - startedAt,
        });
      });

      next();
    });
  }
}
