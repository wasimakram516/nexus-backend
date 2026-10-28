import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SubscriptionStatus, UserRole, UserStatus } from '../../prisma/client';
import { formatDate } from '../../common/utils/date-format.util';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

/** How many days before a trial ends an administrator is reminded. */
export const TRIAL_REMINDER_DAYS = [7, 3, 1];

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Whole days from `now` until `endsAt`, counting a part day as a full one, so
 * a trial ending tomorrow evening is 1 day away all through today.
 *
 * @param {Date} endsAt - When the trial ends.
 * @param {Date} now - The present moment.
 * @returns {number} The days left; zero or negative once it has ended.
 */
export function daysLeftUntil(endsAt: Date, now: Date): number {
  return Math.ceil((endsAt.getTime() - now.getTime()) / DAY_MS);
}

/**
 * Reminds a school's administrators, by email, shortly before its free trial
 * ends. Runs once a day; a trial is only mentioned on the days listed in
 * {@link TRIAL_REMINDER_DAYS}, so nobody is reminded every day.
 */
@Injectable()
export class TrialReminderService {
  private readonly logger = new Logger(TrialReminderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Runs every morning at 9:00 server time. */
  @Cron('0 9 * * *')
  async runDailyReminders(): Promise<number> {
    try {
      return await this.sendReminders(new Date());
    } catch (error) {
      this.logger.error(
        `Trial reminders failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
      return 0;
    }
  }

  /**
   * @param {Date} now - The present moment (a parameter so it can be tested).
   * @returns {Promise<number>} How many emails were handed to the provider.
   */
  async sendReminders(now: Date): Promise<number> {
    const horizon = new Date(
      now.getTime() + Math.max(...TRIAL_REMINDER_DAYS) * DAY_MS,
    );
    const trials = await this.prisma.institutionSubscription.findMany({
      where: {
        status: SubscriptionStatus.TRIAL,
        deletedAt: null,
        endsAt: { gt: now, lte: horizon },
      },
      select: {
        endsAt: true,
        institution: { select: { id: true, name: true, timezone: true } },
      },
    });

    let sent = 0;
    for (const trial of trials) {
      if (!trial.endsAt) continue;
      const daysLeft = daysLeftUntil(trial.endsAt, now);
      if (!TRIAL_REMINDER_DAYS.includes(daysLeft)) continue;

      const admins = await this.prisma.user.findMany({
        where: {
          institutionId: trial.institution.id,
          role: UserRole.ADMIN,
          status: UserStatus.ACTIVE,
          deletedAt: null,
        },
        select: { name: true, email: true },
      });
      for (const admin of admins) {
        const result = await this.notifications.sendEmail(
          'TRIAL_EXPIRING',
          admin.email,
          {
            adminName: admin.name,
            institutionName: trial.institution.name,
            daysLeft,
            endsOn: formatDate(trial.endsAt, trial.institution.timezone),
          },
        );
        if (result.delivered) sent += 1;
      }
    }
    return sent;
  }
}
