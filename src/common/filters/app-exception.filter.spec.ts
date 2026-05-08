import {
  ArgumentsHost,
  BadRequestException,
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

  function createHost(statusFn: jest.Mock): ArgumentsHost {
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
          user: null,
        }),
      }),
    } as ArgumentsHost;
  }
});
