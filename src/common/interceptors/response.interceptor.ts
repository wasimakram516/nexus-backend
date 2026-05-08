import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { map, Observable } from 'rxjs';

@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  intercept(
    _context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    return next.handle().pipe(
      map((payload: unknown) => {
        if (
          payload &&
          typeof payload === 'object' &&
          !Array.isArray(payload) &&
          ('message' in payload || 'data' in payload)
        ) {
          const normalized = payload as { message?: string; data?: unknown };

          return {
            success: true,
            message: normalized.message ?? 'Operation completed',
            data: normalized.data ?? null,
            error: null,
          };
        }

        return {
          success: true,
          message: 'Operation completed',
          data: payload ?? null,
          error: null,
        };
      }),
    );
  }
}
