import { of } from 'rxjs';
import { ResponseInterceptor } from './response.interceptor';

describe('ResponseInterceptor', () => {
  const interceptor = new ResponseInterceptor();

  it('wraps standard service payloads in the success envelope', (done) => {
    interceptor
      .intercept(
        {} as never,
        {
          handle: () =>
            of({
              message: 'Users retrieved successfully',
              data: [{ id: 'user-1' }],
            }),
        } as never,
      )
      .subscribe((value) => {
        expect(value).toEqual({
          success: true,
          message: 'Users retrieved successfully',
          data: [{ id: 'user-1' }],
          error: null,
        });
        done();
      });
  });

  it('preserves raw payloads as data when a handler does not return message/data keys', (done) => {
    interceptor
      .intercept(
        {} as never,
        {
          handle: () =>
            of([
              {
                id: 'log-1',
              },
            ]),
        } as never,
      )
      .subscribe((value) => {
        expect(value).toEqual({
          success: true,
          message: 'Operation completed',
          data: [{ id: 'log-1' }],
          error: null,
        });
        done();
      });
  });
});
