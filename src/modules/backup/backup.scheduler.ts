import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { BackupService } from './backup.service';

/**
 * When each backup step runs, all in UTC so a day means the same day to the
 * rotation rules everywhere. Each step does nothing while backups are off.
 */
@Injectable()
export class BackupScheduler {
  constructor(private readonly backups: BackupService) {}

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

  /** The summary email, after the day has been closed. */
  @Cron('50 23 * * *', { timeZone: 'UTC' })
  async sendReport(): Promise<void> {
    await this.backups.sendDailyReport();
  }
}
