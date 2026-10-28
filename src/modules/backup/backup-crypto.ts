import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { createReadStream, createWriteStream, promises as fs } from 'fs';
import { pipeline } from 'stream/promises';

/** Marks a file as a Nexus backup and records the format, so a later change can be told apart. */
const MAGIC = Buffer.from('NXB1');
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_HEX = /^[0-9a-fA-F]{64}$/;

/**
 * @param {string} hex - 64 hexadecimal characters (a 256 bit key).
 * @returns {Buffer} The key.
 * @throws {Error} When the key is not 64 hex characters.
 */
export function parseBackupKeyHex(hex: string): Buffer {
  if (!KEY_HEX.test(hex)) {
    throw new Error('The backup encryption key must be 64 hex characters.');
  }
  return Buffer.from(hex, 'hex');
}

/**
 * Encrypts a file with AES-256-GCM before it leaves the server, so the storage
 * provider only ever holds data it cannot read. The result is the format marker,
 * the random IV, the encrypted data, then the authentication tag that makes any
 * change to the file detectable on restore.
 *
 * @param {string} inputPath - The plain dump.
 * @param {string} outputPath - Where to write the encrypted file.
 * @param {Buffer} key - A 256 bit key.
 * @returns {Promise<void>} Resolves when the file is written.
 */
export async function encryptFile(
  inputPath: string,
  outputPath: string,
  key: Buffer,
): Promise<void> {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const output = createWriteStream(outputPath);
  output.write(Buffer.concat([MAGIC, iv]));
  await pipeline(createReadStream(inputPath), cipher, output, {
    end: false,
  });
  await new Promise<void>((resolve, reject) => {
    output.end(cipher.getAuthTag(), (error?: Error | null) =>
      error ? reject(error) : resolve(),
    );
  });
}

/**
 * Reverses {@link encryptFile}. Fails, and leaves no output behind, when the
 * key is wrong or the file was changed or cut short.
 *
 * @param {string} inputPath - The encrypted file.
 * @param {string} outputPath - Where to write the plain dump.
 * @param {Buffer} key - The same 256 bit key.
 * @returns {Promise<void>} Resolves when the file is written.
 * @throws {Error} When the file is not a backup, or cannot be authenticated.
 */
export async function decryptFile(
  inputPath: string,
  outputPath: string,
  key: Buffer,
): Promise<void> {
  const { size } = await fs.stat(inputPath);
  const headerBytes = MAGIC.length + IV_BYTES;
  if (size < headerBytes + TAG_BYTES) {
    throw new Error('This file is too short to be a Nexus backup.');
  }

  const handle = await fs.open(inputPath, 'r');
  let header: Buffer;
  let tag: Buffer;
  try {
    header = Buffer.alloc(headerBytes);
    await handle.read(header, 0, headerBytes, 0);
    tag = Buffer.alloc(TAG_BYTES);
    await handle.read(tag, 0, TAG_BYTES, size - TAG_BYTES);
  } finally {
    await handle.close();
  }
  if (!header.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error('This file is not a Nexus backup.');
  }

  const decipher = createDecipheriv(
    'aes-256-gcm',
    key,
    header.subarray(MAGIC.length),
  );
  decipher.setAuthTag(tag);
  try {
    // A read stream cannot be asked for zero bytes, so an empty dump is
    // checked and written directly.
    if (size === headerBytes + TAG_BYTES) {
      decipher.final();
      await fs.writeFile(outputPath, Buffer.alloc(0));
      return;
    }
    await pipeline(
      createReadStream(inputPath, {
        start: headerBytes,
        end: size - TAG_BYTES - 1,
      }),
      decipher,
      createWriteStream(outputPath),
    );
  } catch {
    await fs.rm(outputPath, { force: true });
    throw new Error(
      'The backup could not be decrypted: the key is wrong or the file was changed.',
    );
  }
}
