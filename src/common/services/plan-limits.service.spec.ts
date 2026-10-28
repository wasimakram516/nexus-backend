import { ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PlanLimitsService } from './plan-limits.service';

describe('PlanLimitsService', () => {
  const prismaMock = {
    institutionSubscription: { findFirst: jest.fn() },
    institutionSetting: { findUnique: jest.fn() },
  };
  const service = new PlanLimitsService(prismaMock as unknown as PrismaService);

  const given = (
    subscription: unknown = null,
    setting: unknown = null,
  ): void => {
    prismaMock.institutionSubscription.findFirst.mockResolvedValue(
      subscription,
    );
    prismaMock.institutionSetting.findUnique.mockResolvedValue(
      setting === null ? null : { value: setting },
    );
  };

  beforeEach(() => {
    jest.resetAllMocks();
    given();
  });

  describe('limitFor', () => {
    it('reads each limit from the plan', async () => {
      given({
        plan: {
          key: 'growth',
          limits: { maxCampuses: 3, maxStudents: 500, maxStaff: 40 },
        },
      });

      expect(await service.limitFor('inst-1', 'maxCampuses')).toBe(3);
      expect(await service.limitFor('inst-1', 'maxStudents')).toBe(500);
      expect(await service.limitFor('inst-1', 'maxStaff')).toBe(40);
    });

    it('lets the institution’s own setting beat its subscription notes, which beat its plan', async () => {
      given(
        {
          metadata: { maxStudents: 800 },
          plan: { key: 'growth', limits: { maxStudents: 500 } },
        },
        { maxStudents: 1000 },
      );
      expect(await service.limitFor('inst-1', 'maxStudents')).toBe(1000);

      given({
        metadata: { maxStudents: 800 },
        plan: { key: 'growth', limits: { maxStudents: 500 } },
      });
      expect(await service.limitFor('inst-1', 'maxStudents')).toBe(800);

      given({ plan: { key: 'growth', limits: { maxStudents: 500 } } });
      expect(await service.limitFor('inst-1', 'maxStudents')).toBe(500);
    });

    it('reads a limit written under a limits object, as subscription notes do', async () => {
      given({
        metadata: { limits: { maxStaff: 12 } },
        plan: { key: 'growth', limits: {} },
      });

      expect(await service.limitFor('inst-1', 'maxStaff')).toBe(12);
    });

    it('defers to the next place when one says null, and is unlimited when none names a number', async () => {
      given(
        { plan: { key: 'growth', limits: { maxStudents: 100 } } },
        { maxStudents: null },
      );
      expect(await service.limitFor('inst-1', 'maxStudents')).toBe(100);

      given({ plan: { key: 'enterprise', limits: { maxStudents: null } } });
      expect(await service.limitFor('inst-1', 'maxStudents')).toBeNull();
    });

    it('falls back to the plan’s built-in default, and to unlimited where that has none', async () => {
      given({ plan: { key: 'starter', limits: null } });

      expect(await service.limitFor('inst-1', 'maxCampuses')).toBe(1);
      expect(await service.limitFor('inst-1', 'maxStudents')).toBeNull();
    });

    it('uses the starter defaults when the institution has no subscription', async () => {
      expect(await service.limitFor('inst-1', 'maxCampuses')).toBe(1);
    });

    it('ignores values that are not numbers, in any shape', async () => {
      given(
        {
          metadata: { limits: 'nope', maxStaff: 'many' },
          plan: { key: 'growth', limits: ['x'] },
        },
        'not an object',
      );

      expect(await service.limitFor('inst-1', 'maxStaff')).toBeNull();
    });

    it('only looks at a live subscription', async () => {
      await service.limitFor('inst-1', 'maxStaff');

      expect(prismaMock.institutionSubscription.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            institutionId: 'inst-1',
            status: { in: ['TRIAL', 'ACTIVE', 'PAST_DUE'] },
          },
        }),
      );
    });
  });

  describe('assertRoomForOne', () => {
    it('allows one more while under the limit', async () => {
      given({ plan: { key: 'growth', limits: { maxStudents: 3 } } });

      await expect(
        service.assertRoomForOne('inst-1', 'maxStudents', () =>
          Promise.resolve(2),
        ),
      ).resolves.toBeUndefined();
    });

    it.each([
      [
        'maxStudents',
        3,
        'Student limit reached for this institution. Current limit: 3.',
      ],
      [
        'maxStaff',
        3,
        'Staff limit reached for this institution. Current limit: 3.',
      ],
      [
        'maxCampuses',
        3,
        'Campus limit reached for this institution. Current limit: 3.',
      ],
    ] as const)(
      'refuses when %s is already reached, naming the limit and who can raise it',
      async (key, limit, message) => {
        given({ plan: { key: 'growth', limits: { [key]: limit } } });

        const attempt = service.assertRoomForOne('inst-1', key, () =>
          Promise.resolve(limit),
        );

        await expect(attempt).rejects.toBeInstanceOf(ForbiddenException);
        await expect(attempt).rejects.toThrow(message);
        await expect(attempt).rejects.toThrow('Ask Nexus support to raise it.');
      },
    );

    it('does not even count when there is no limit', async () => {
      given({ plan: { key: 'enterprise', limits: { maxStudents: null } } });
      const count = jest.fn();

      await service.assertRoomForOne('inst-1', 'maxStudents', count);

      expect(count).not.toHaveBeenCalled();
    });
  });
});
