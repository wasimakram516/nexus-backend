import { requestFingerprint } from './request-fingerprint.util';

describe('request fingerprints', () => {
  it('ignores object key order but preserves values and array order', () => {
    expect(
      requestFingerprint({ amount: 25, customFields: { b: false, a: 0 } }),
    ).toBe(
      requestFingerprint({ customFields: { a: 0, b: false }, amount: 25 }),
    );
    expect(requestFingerprint({ amount: 25 })).not.toBe(
      requestFingerprint({ amount: 26 }),
    );
    expect(requestFingerprint(['one', 'two'])).not.toBe(
      requestFingerprint(['two', 'one']),
    );
  });
});
