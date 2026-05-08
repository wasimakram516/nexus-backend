import { ConsoleLogger, Injectable } from '@nestjs/common';

type LogContext = Record<string, unknown>;

@Injectable()
export class AppLoggerService extends ConsoleLogger {
  logRequestStart(context: LogContext) {
    this.log(this.stringify('Incoming request', context), 'HTTP');
  }

  logRequestCompletion(context: LogContext) {
    this.log(this.stringify('Request completed', context), 'HTTP');
  }

  logRequestError(context: LogContext) {
    this.error(this.stringify('Request failed', context), undefined, 'HTTP');
  }

  logUnhandledError(context: LogContext, trace?: string) {
    this.error(
      this.stringify('Unhandled application error', context),
      trace,
      'APP',
    );
  }

  private stringify(message: string, context: LogContext) {
    return `${message} ${JSON.stringify(context)}`;
  }
}
