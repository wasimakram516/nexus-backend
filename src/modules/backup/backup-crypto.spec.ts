import { randomBytes } from 'crypto';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { decryptFile, encryptFile, parseBackupKeyHex } from './backup-crypto';

describe('backup encryption', () => {
  let dir: string;
  const key = randomBytes(32);

  beforeEach(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), 'nexus-crypto-'));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  const write = async (name: string, data: Buffer) => {
    const path = join(dir, name);
    await fs.writeFile(path, data);
    return path;
  };

  it('restores exactly what was backed up', async () => {
    const original = randomBytes(300_000);
    const plain = await write('plain.dump', original);
    const encrypted = join(dir, 'x.dump.enc');
    const restored = join(dir, 'restored.dump');

    await encryptFile(plain, encrypted, key);
    await decryptFile(encrypted, restored, key);

    expect((await fs.readFile(restored)).equals(original)).toBe(true);
  });

  it('does not leave the data readable in the encrypted file', async () => {
    const plain = await write(
      'plain.dump',
      Buffer.from('fee records and salaries'),
    );
    const encrypted = join(dir, 'x.dump.enc');

    await encryptFile(plain, encrypted, key);

    expect((await fs.readFile(encrypted)).includes('salaries')).toBe(false);
  });

  it('gives a different file each time, because the IV is random', async () => {
    const plain = await write('plain.dump', Buffer.from('same data'));
    await encryptFile(plain, join(dir, 'a.enc'), key);
    await encryptFile(plain, join(dir, 'b.enc'), key);

    expect(
      (await fs.readFile(join(dir, 'a.enc'))).equals(
        await fs.readFile(join(dir, 'b.enc')),
      ),
    ).toBe(false);
  });

  it('handles an empty dump', async () => {
    const plain = await write('empty.dump', Buffer.alloc(0));
    await encryptFile(plain, join(dir, 'e.enc'), key);
    await decryptFile(join(dir, 'e.enc'), join(dir, 'e.out'), key);

    expect((await fs.readFile(join(dir, 'e.out'))).length).toBe(0);
  });

  it('refuses the wrong key and leaves no output', async () => {
    const plain = await write('plain.dump', Buffer.from('secret'));
    await encryptFile(plain, join(dir, 'k.enc'), key);

    await expect(
      decryptFile(join(dir, 'k.enc'), join(dir, 'k.out'), randomBytes(32)),
    ).rejects.toThrow('key is wrong or the file was changed');
    await expect(fs.access(join(dir, 'k.out'))).rejects.toThrow();
  });

  it('detects a file that was changed after it was stored', async () => {
    const plain = await write('plain.dump', randomBytes(1000));
    const encrypted = join(dir, 't.enc');
    await encryptFile(plain, encrypted, key);
    const bytes = await fs.readFile(encrypted);
    bytes[40] ^= 0xff;
    await fs.writeFile(encrypted, bytes);

    await expect(
      decryptFile(encrypted, join(dir, 't.out'), key),
    ).rejects.toThrow('could not be decrypted');
  });

  it('detects a file that was cut short', async () => {
    const plain = await write('plain.dump', randomBytes(1000));
    const encrypted = join(dir, 'c.enc');
    await encryptFile(plain, encrypted, key);
    const bytes = await fs.readFile(encrypted);
    await fs.writeFile(encrypted, bytes.subarray(0, bytes.length - 200));

    await expect(
      decryptFile(encrypted, join(dir, 'c.out'), key),
    ).rejects.toThrow('could not be decrypted');
  });

  it('rejects a file that is not a backup at all', async () => {
    const other = await write('other.bin', Buffer.alloc(100, 7));
    await expect(decryptFile(other, join(dir, 'o.out'), key)).rejects.toThrow(
      'not a Nexus backup',
    );
    const tiny = await write('tiny.bin', Buffer.from('hi'));
    await expect(decryptFile(tiny, join(dir, 't2.out'), key)).rejects.toThrow(
      'too short',
    );
  });
});

describe('parseBackupKeyHex', () => {
  it('accepts 64 hex characters', () => {
    expect(parseBackupKeyHex('ab'.repeat(32))).toHaveLength(32);
  });

  it.each(['', 'ab'.repeat(31), 'zz'.repeat(32), 'ab'.repeat(33)])(
    'rejects %j',
    (value) => {
      expect(() => parseBackupKeyHex(value)).toThrow('64 hex characters');
    },
  );
});
