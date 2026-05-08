import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { CurrentUser } from '../interfaces/current-user.interface';
import { RequestContextService } from '../services/request-context.service';

@Injectable()
export class CurrentUserContextInterceptor implements NestInterceptor {
  constructor(private readonly requestContext: RequestContextService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<{ user?: CurrentUser }>();
    this.requestContext.set('currentUser', request.user ?? null);
    return next.handle();
  }
}
