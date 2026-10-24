import { createHash } from 'node:crypto';

/**
 * A stable UUID derived from a batch key and one item of the batch, so that
 * retrying the same batch asks for exactly the same per-item keys and an
 * idempotent operation (a payment) is recognised as already done.
 *
 * @param {string} batchKey - The key the caller sent for the whole batch.
 * @param {string} itemId - Identifies the item within the batch, such as a voucher id.
 * @returns {string} A UUID (version 5 layout) that is the same for the same inputs.
 */
export function deriveItemKey(batchKey: string, itemId: string): string {
  const hex = createHash('sha256')
    .update(`${batchKey}:${itemId}`)
    .digest('hex')
    .slice(0, 32)
    .split('');
  hex[12] = '5';
  hex[16] = ['8', '9', 'a', 'b'][parseInt(hex[16], 16) % 4];
  const value = hex.join('');
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20, 32)}`;
}
