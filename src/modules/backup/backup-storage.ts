import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  ObjectLockMode,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { createReadStream, createWriteStream, promises as fs } from 'fs';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { StoredBackup } from './backup-policy';

/**
 * Where encrypted backups are kept. The rotation and the backup job only know
 * this interface, so tests use an in-memory copy and the real thing is S3.
 */
export interface BackupStorage {
  /** Uploads a local file. `retainUntil` locks it against deletion until then, where the storage supports it. */
  put(key: string, filePath: string, retainUntil?: Date): Promise<void>;
  /** Copies a stored backup to another key without downloading it. */
  copy(fromKey: string, toKey: string, retainUntil?: Date): Promise<void>;
  /** Downloads a stored backup to a local file. */
  download(key: string, filePath: string): Promise<void>;
  /** Lists everything under the backup prefix. */
  list(): Promise<StoredBackup[]>;
  delete(key: string): Promise<void>;
}

export interface S3BackupStorageOptions {
  bucket: string;
  region: string;
  /** Server side encryption with this KMS key; the bucket default is used when blank. */
  kmsKeyId?: string;
  /** Whether to set Object Lock (compliance mode) retention on every object written. */
  objectLock: boolean;
}

const LIST_PREFIX = 'backups/';

/** A private S3 bucket, with KMS encryption and Object Lock retention on what it writes. */
export class S3BackupStorage implements BackupStorage {
  private readonly client: S3Client;

  constructor(private readonly options: S3BackupStorageOptions) {
    this.client = new S3Client({ region: options.region });
  }

  private encryption() {
    return this.options.kmsKeyId
      ? {
          ServerSideEncryption: 'aws:kms' as const,
          SSEKMSKeyId: this.options.kmsKeyId,
        }
      : { ServerSideEncryption: 'AES256' as const };
  }

  private lock(retainUntil?: Date) {
    return this.options.objectLock && retainUntil
      ? {
          ObjectLockMode: ObjectLockMode.COMPLIANCE,
          ObjectLockRetainUntilDate: retainUntil,
        }
      : {};
  }

  async put(key: string, filePath: string, retainUntil?: Date): Promise<void> {
    const { size } = await fs.stat(filePath);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.options.bucket,
        Key: key,
        Body: createReadStream(filePath),
        ContentLength: size,
        ...this.encryption(),
        ...this.lock(retainUntil),
      }),
    );
  }

  async copy(
    fromKey: string,
    toKey: string,
    retainUntil?: Date,
  ): Promise<void> {
    await this.client.send(
      new CopyObjectCommand({
        Bucket: this.options.bucket,
        CopySource: `${this.options.bucket}/${fromKey}`,
        Key: toKey,
        ...this.encryption(),
        ...this.lock(retainUntil),
      }),
    );
  }

  async download(key: string, filePath: string): Promise<void> {
    const { Body } = await this.client.send(
      new GetObjectCommand({ Bucket: this.options.bucket, Key: key }),
    );
    if (!(Body instanceof Readable)) {
      throw new Error(`The backup ${key} could not be read from storage.`);
    }
    await pipeline(Body, createWriteStream(filePath));
  }

  async list(): Promise<StoredBackup[]> {
    const found: StoredBackup[] = [];
    let token: string | undefined;
    do {
      const page = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.options.bucket,
          Prefix: LIST_PREFIX,
          ContinuationToken: token,
        }),
      );
      for (const item of page.Contents ?? []) {
        if (item.Key) {
          found.push({ key: item.Key, sizeBytes: item.Size ?? 0 });
        }
      }
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
    return found;
  }

  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.options.bucket, Key: key }),
    );
  }
}
