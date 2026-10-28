import { Injectable, Logger } from '@nestjs/common';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { decryptFile } from './backup-crypto';
import { latestInTier } from './backup-policy';
import { BackupStorage } from './backup-storage';
import { BackupConfig, BackupService } from './backup.service';
import { CommandRunner, pgEnvFromUrl, runCommand } from './pg-dump.runner';
import {
  compareSnapshots,
  DatabaseInspector,
  VerificationResult,
} from './restore-verification';

/** Scratch databases always start with this, and nothing else is ever dropped. */
export const SCRATCH_PREFIX = 'nexus_verify_';

/**
 * Proves a backup can really be restored: downloads the newest daily backup,
 * decrypts it, restores it into a scratch database, compares it with the live
 * database, then removes the scratch database. The result goes into the daily
 * report, and a failure raises an alert at once.
 */
@Injectable()
export class RestoreVerifier {
  private readonly logger = new Logger(RestoreVerifier.name);

  constructor(
    private readonly config: BackupConfig,
    private readonly storage: BackupStorage | null,
    private readonly backups: BackupService,
    private readonly inspector: DatabaseInspector,
    /** A connection to a scratch server with permission to create databases. */
    private readonly scratchAdminUrl: string | null,
    private readonly run: CommandRunner = runCommand,
  ) {}

  /**
   * @param {Date} [now] - The present moment.
   * @returns {Promise<VerificationResult | null>} The outcome, or null when backups are off.
   */
  async verifyLatestDaily(
    now: Date = new Date(),
  ): Promise<VerificationResult | null> {
    if (!this.backups.enabled || !this.storage) return null;
    let result: VerificationResult;
    try {
      result = await this.verify(this.storage, now);
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Restore check failed: ${reason}`);
      result = { passed: false, summary: reason };
    }
    await this.backups.recordVerification(result.passed, result.summary);
    return result;
  }

  private async verify(
    storage: BackupStorage,
    now: Date,
  ): Promise<VerificationResult> {
    if (!this.scratchAdminUrl) {
      throw new Error(
        'No scratch database server is configured for restore checks (BACKUP_VERIFY_ADMIN_URL).',
      );
    }
    const latest = latestInTier(await storage.list(), 'daily');
    if (!latest) throw new Error('There is no daily backup to check yet.');

    const scratchName = `${SCRATCH_PREFIX}${now.getTime()}`;
    const workDir = await fs.mkdtemp(join(tmpdir(), 'nexus-verify-'));
    let created = false;
    try {
      const encrypted = join(workDir, 'backup.dump.enc');
      const plain = join(workDir, 'backup.dump');
      await storage.download(latest.key, encrypted);
      await decryptFile(encrypted, plain, this.config.encryptionKey);

      const scratchUrl = await this.inspector.createDatabase(
        this.scratchAdminUrl,
        scratchName,
      );
      created = true;
      await this.run(
        'pg_restore',
        ['--no-owner', '--exit-on-error', '--dbname', scratchName, plain],
        pgEnvFromUrl(scratchUrl),
      );

      const [source, restored] = await Promise.all([
        this.inspector.snapshot(this.config.databaseUrl),
        this.inspector.snapshot(scratchUrl),
      ]);
      return compareSnapshots(source, restored);
    } finally {
      if (created) {
        await this.inspector
          .dropDatabase(this.scratchAdminUrl, scratchName)
          .catch((error: unknown) =>
            this.logger.error(
              `Could not remove scratch database ${scratchName}: ${error instanceof Error ? error.message : 'unknown'}`,
            ),
          );
      }
      await fs.rm(workDir, { recursive: true, force: true });
    }
  }
}
