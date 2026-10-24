import {
  ArgumentsHost,
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
} from '@nestjs/common';
import { AppExceptionFilter } from './app-exception.filter';

describe('AppExceptionFilter', () => {
  const logger = {
    logRequestError: jest.fn(),
    logUnhandledError: jest.fn(),
  };

  let filter: AppExceptionFilter;

  beforeEach(() => {
    jest.clearAllMocks();
    filter = new AppExceptionFilter(logger as never);
  });

  it('returns the standard error envelope for validation exceptions', () => {
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const host = createHost(status);

    filter.catch(
      new BadRequestException([
        'email must be an email',
        'password must be a string',
      ]),
      host,
    );

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({
      success: false,
      message: 'email must be an email, password must be a string',
      data: null,
      error: {
        code: 'HTTP_ERROR',
        details: {
          requestId: 'request-1',
          statusCode: 400,
          method: 'POST',
          path: '/api/v1/auth/login',
          validationErrors: [
            'email must be an email',
            'password must be a string',
          ],
        },
      },
    });
  });

  it('surfaces structured object-body fields (e.g. outstandingAmount) under error.details', () => {
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const host = createHost(status);

    filter.catch(
      new ConflictException({
        message: 'Outstanding dues must be cleared or acknowledged first.',
        outstandingAmount: 4500,
      }),
      host,
    );

    expect(status).toHaveBeenCalledWith(409);
    expect(json).toHaveBeenCalledWith({
      success: false,
      message: 'Outstanding dues must be cleared or acknowledged first.',
      data: null,
      error: {
        code: 'HTTP_ERROR',
        details: {
          requestId: 'request-1',
          statusCode: 409,
          method: 'POST',
          path: '/api/v1/auth/login',
          outstandingAmount: 4500,
        },
      },
    });
  });

  it('returns the standard error envelope for unexpected exceptions', () => {
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const host = createHost(status);

    filter.catch(new InternalServerErrorException(), host);

    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({
      success: false,
      message: 'Internal server error',
      data: null,
      error: {
        code: 'HTTP_ERROR',
        details: {
          requestId: 'request-1',
          statusCode: 500,
          method: 'POST',
          path: '/api/v1/auth/login',
        },
      },
    });
    expect(logger.logUnhandledError).toHaveBeenCalled();
  });

  describe('the cause of an unexpected error', () => {
    const run = (
      exception: unknown,
      user: { sub: string; role: string } | null,
    ) => {
      type Body = {
        message: string;
        error: { details: Record<string, unknown> };
      };
      const json = jest.fn<void, [Body]>();
      const status = jest.fn().mockReturnValue({ json });
      filter.catch(exception, createHost(status, user));
      return json.mock.calls[0][0];
    };

    it('is always logged with the real message, even though the response is masked', () => {
      run(new Error('column "foo" does not exist'), null);

      expect(logger.logUnhandledError).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Internal server error',
          cause: 'Error: column "foo" does not exist',
        }),
        expect.any(String),
      );
    });

    it('is returned to a superadmin', () => {
      const body = run(new Error('column "foo" does not exist'), {
        sub: 'u1',
        role: 'SUPERADMIN',
      });

      expect(body.message).toBe('Internal server error');
      expect(body.error.details.cause).toBe(
        'Error: column "foo" does not exist',
      );
    });

    it.each(['ADMIN', 'STAFF', 'STUDENT', 'GUARDIAN'])(
      'is not returned to a %s',
      (role) => {
        const body = run(new Error('secret table name'), { sub: 'u1', role });

        expect(body.error.details).not.toHaveProperty('cause');
      },
    );

    it('is not returned to an anonymous caller', () => {
      expect(run(new Error('x'), null).error.details).not.toHaveProperty(
        'cause',
      );
    });

    it('is collapsed to one line and cut to a safe length', () => {
      const body = run(new Error(`first\nsecond ${'x'.repeat(2000)}`), {
        sub: 'u1',
        role: 'SUPERADMIN',
      });
      const cause = body.error.details.cause as string;

      expect(cause.startsWith('Error: first second ')).toBe(true);
      expect(cause).not.toContain('\n');
      expect(cause.length).toBeLessThanOrEqual(604);
    });

    it('is left out for something that is not an Error, and for client errors', () => {
      const user = { sub: 'u1', role: 'SUPERADMIN' };

      expect(run('plain string', user).error.details).not.toHaveProperty(
        'cause',
      );
      expect(
        run(new BadRequestException('bad'), user).error.details,
      ).not.toHaveProperty('cause');
    });
  });

  function createHost(
    statusFn: jest.Mock,
    user: { sub: string; role: string } | null = null,
  ): ArgumentsHost {
    return {
      switchToHttp: () => ({
        getResponse: () => ({
          status: statusFn,
        }),
        getRequest: () => ({
          requestId: 'request-1',
          method: 'POST',
          originalUrl: '/api/v1/auth/login',
          ip: '127.0.0.1',
          user,
        }),
      }),
    } as ArgumentsHost;
  }
});
