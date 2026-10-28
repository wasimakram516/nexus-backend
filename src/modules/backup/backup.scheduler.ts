import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { BackupService } from './backup.service';
import { RestoreVerifier } from './restore-verifier.service';

/**
 * When each backup step runs, all in UTC so a day means the same day to the
 * rotation rules everywhere. Each step does nothing while backups are off.
 */
@Injectable()
export class BackupScheduler {
  constructor(
    private readonly backups: BackupService,
    private readonly verifier: RestoreVerifier,
  ) {}

  /** Every 3 hours. */
  @Cron('0 */3 * * *', { timeZone: 'UTC' })
  async takeBackup(): Promise<void> {
    await this.backups.runIntraday();
  }

  /** Close the day at 23:30, then remove what has expired. */
  @Cron('30 23 * * *', { timeZone: 'UTC' })
  async closeDayAndPrune(): Promise<void> {
    await this.backups.closeDay();
    await this.backups.prune();
  }

  /** Every Sunday at 03:00, prove the newest daily backup restores. */
  @Cron('0 3 * * 0', { timeZone: 'UTC' })
  async verifyRestore(): Promise<void> {
    await this.verifier.verifyLatestDaily();
  }

  /** The summary email, after the day has been closed. */
  @Cron('50 23 * * *', { timeZone: 'UTC' })
  async sendReport(): Promise<void> {
    await this.backups.sendDailyReport();
  }
}
