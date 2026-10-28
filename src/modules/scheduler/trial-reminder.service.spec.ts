import { SubscriptionStatus, UserRole, UserStatus } from '../../prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  daysLeftUntil,
  TRIAL_REMINDER_DAYS,
  TrialReminderService,
} from './trial-reminder.service';

const NOW = new Date('2026-10-28T09:00:00.000Z');
const inDays = (days: number) =>
  new Date(NOW.getTime() + days * 24 * 60 * 60 * 1000 - 60 * 60 * 1000);

describe('daysLeftUntil', () => {
  it('counts a part day as a full day, so tomorrow evening is 1 day away today', () => {
    expect(daysLeftUntil(new Date('2026-10-29T20:00:00.000Z'), NOW)).toBe(2);
    expect(daysLeftUntil(new Date('2026-10-29T08:00:00.000Z'), NOW)).toBe(1);
  });

  it('is zero or negative once the trial has ended', () => {
    expect(daysLeftUntil(NOW, NOW)).toBe(0);
    expect(daysLeftUntil(new Date('2026-10-26T09:00:00.000Z'), NOW)).toBe(-2);
  });
});

describe('TrialReminderService', () => {
  const prisma = {
    institutionSubscription: { findMany: jest.fn() },
    user: { findMany: jest.fn() },
  };
  const notifications = { sendEmail: jest.fn() };
  let service: TrialReminderService;

  const trial = (days: number, name = 'Greenfield') => ({
    endsAt: inDays(days),
    institution: { id: `inst-${name}`, name, timezone: 'Asia/Karachi' },
  });

  beforeEach(() => {
    jest.clearAllMocks();
    notifications.sendEmail.mockResolvedValue({ delivered: true });
    prisma.user.findMany.mockResolvedValue([
      { name: 'Amna', email: 'amna@school.test' },
      { name: 'Bilal', email: 'bilal@school.test' },
    ]);
    service = new TrialReminderService(
      prisma as unknown as PrismaService,
      notifications as unknown as NotificationsService,
    );
  });

  it('only looks at trials that are running and end within the longest reminder window', async () => {
    prisma.institutionSubscription.findMany.mockResolvedValue([]);

    await service.sendReminders(NOW);

    const where = (
      prisma.institutionSubscription.findMany.mock.calls[0] as [
        { where: Record<string, unknown> },
      ]
    )[0].where;
    expect(where).toMatchObject({
      status: SubscriptionStatus.TRIAL,
      deletedAt: null,
    });
    expect(where.endsAt).toEqual({
      gt: NOW,
      lte: new Date(NOW.getTime() + 7 * 24 * 60 * 60 * 1000),
    });
  });

  it.each(TRIAL_REMINDER_DAYS)(
    'emails every active administrator when %i days are left',
    async (days) => {
      prisma.institutionSubscription.findMany.mockResolvedValue([trial(days)]);

      const sent = await service.sendReminders(NOW);

      expect(sent).toBe(2);
      expect(prisma.user.findMany).toHaveBeenCalledWith({
        where: {
          institutionId: 'inst-Greenfield',
          role: UserRole.ADMIN,
          status: UserStatus.ACTIVE,
          deletedAt: null,
        },
        select: { name: true, email: true },
      });
      expect(notifications.sendEmail).toHaveBeenCalledWith(
        'TRIAL_EXPIRING',
        'amna@school.test',
        expect.objectContaining({
          adminName: 'Amna',
          institutionName: 'Greenfield',
          daysLeft: days,
        }),
      );
    },
  );

  it('stays quiet on the days in between', async () => {
    prisma.institutionSubscription.findMany.mockResolvedValue([
      trial(6),
      trial(5),
      trial(4),
      trial(2),
    ]);

    expect(await service.sendReminders(NOW)).toBe(0);
    expect(notifications.sendEmail).not.toHaveBeenCalled();
  });

  it('writes the end date in the school timezone', async () => {
    prisma.institutionSubscription.findMany.mockResolvedValue([
      {
        endsAt: new Date('2026-11-03T20:00:00.000Z'),
        institution: { id: 'i', name: 'Late', timezone: 'Asia/Karachi' },
      },
    ]);

    await service.sendReminders(NOW);

    expect(notifications.sendEmail).toHaveBeenCalledWith(
      'TRIAL_EXPIRING',
      expect.any(String),
      expect.objectContaining({ endsOn: '4 Nov 2026', daysLeft: 7 }),
    );
  });

  it('does not count an email that was not delivered, and keeps going', async () => {
    prisma.institutionSubscription.findMany.mockResolvedValue([trial(3)]);
    notifications.sendEmail
      .mockResolvedValueOnce({ delivered: false, error: 'no address' })
      .mockResolvedValueOnce({ delivered: true });

    expect(await service.sendReminders(NOW)).toBe(1);
  });

  it('never throws from the scheduled run', async () => {
    prisma.institutionSubscription.findMany.mockRejectedValue(
      new Error('database down'),
    );

    await expect(service.runDailyReminders()).resolves.toBe(0);
  });
});
