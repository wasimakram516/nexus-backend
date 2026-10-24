import { deriveItemKey } from './derived-key.util';

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('deriveItemKey', () => {
  it('is a valid UUID', () => {
    expect(deriveItemKey('batch-1', 'voucher-1')).toMatch(UUID);
  });

  it('is the same for the same batch and item, so a retry asks for the same key', () => {
    expect(deriveItemKey('batch-1', 'voucher-1')).toBe(
      deriveItemKey('batch-1', 'voucher-1'),
    );
  });

  it('differs between items of one batch and between batches', () => {
    const a = deriveItemKey('batch-1', 'voucher-1');

    expect(deriveItemKey('batch-1', 'voucher-2')).not.toBe(a);
    expect(deriveItemKey('batch-2', 'voucher-1')).not.toBe(a);
  });

  it('cannot be confused by moving text between the two parts', () => {
    expect(deriveItemKey('ab', 'c')).not.toBe(deriveItemKey('a', 'bc'));
  });

  it('stays a valid UUID for many inputs', () => {
    for (let index = 0; index < 200; index += 1) {
      expect(deriveItemKey(`batch-${index}`, `voucher-${index * 7}`)).toMatch(
        UUID,
      );
    }
  });
});
