import { AppLoggerService } from './app-logger.service';

describe('AppLoggerService', () => {
  let service: AppLoggerService;
  let logSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    service = new AppLoggerService();
    logSpy = jest.spyOn(service, 'log').mockImplementation(() => undefined);
    errorSpy = jest.spyOn(service, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('logs request start with the HTTP context', () => {
    service.logRequestStart({ method: 'GET', path: '/api/v1/health' });

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('Incoming request'),
      'HTTP',
    );
    const calls = logSpy.mock.calls as string[][];
    expect(calls[0][0]).toContain('"method":"GET"');
  });

  it('logs request completion with the HTTP context', () => {
    service.logRequestCompletion({ statusCode: 200 });

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('Request completed'),
      'HTTP',
    );
  });

  it('logs request errors via error(), not log()', () => {
    service.logRequestError({ statusCode: 500 });

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Request failed'),
      undefined,
      'HTTP',
    );
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('logs unhandled application errors under the APP context with a trace', () => {
    service.logUnhandledError({ where: 'bootstrap' }, 'stack trace here');

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Unhandled application error'),
      'stack trace here',
      'APP',
    );
  });
});
