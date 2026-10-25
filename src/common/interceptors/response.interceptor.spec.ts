import { StreamableFile } from '@nestjs/common';
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

  it('sends a file download as it is, without the JSON envelope', (done) => {
    const file = new StreamableFile(Buffer.from('%PDF-1.4'));

    interceptor
      .intercept({} as never, { handle: () => of(file) } as never)
      .subscribe((value) => {
        expect(value).toBe(file);
        done();
      });
  });

  it('sends raw bytes as they are too', (done) => {
    const bytes = Buffer.from([1, 2, 3]);

    interceptor
      .intercept({} as never, { handle: () => of(bytes) } as never)
      .subscribe((value) => {
        expect(value).toBe(bytes);
        done();
      });
  });
});
