import { Test } from '@nestjs/testing';
import { DayOfWeek } from '../../prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { WorkingDayResolverService } from './working-day-resolver.service';

/**
 * P0-6 Verification 2 (FOCUS-AREAS.md): working days and closures — a
 * normal working day, a weekly-closed day, an explicit closure, and the
 * fail-closed default when no calendar is configured (§ 5.2 / § 11 #1,
 * Wasim-confirmed).
 */
describe('WorkingDayResolverService', () => {
  let service: WorkingDayResolverService;

  const prismaMock = {
    institutionWorkingCalendar: { findUnique: jest.fn() },
    institutionClosureDate: { findFirst: jest.fn() },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        WorkingDayResolverService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();
    service = moduleRef.get(WorkingDayResolverService);
  });

  it('fails closed (returns false) when no InstitutionWorkingCalendar is configured', async () => {
    prismaMock.institutionWorkingCalendar.findUnique.mockResolvedValue(null);

    const result = await service.isWorkingDay(
      'institution-1',
      'campus-1',
      '2026-06-15',
      DayOfWeek.MONDAY,
    );

    expect(result).toBe(false);
    expect(prismaMock.institutionClosureDate.findFirst).not.toHaveBeenCalled();
  });

  it('returns false for a weekday not included in the configured working days', async () => {
    prismaMock.institutionWorkingCalendar.findUnique.mockResolvedValue({
      workingDays: [
        DayOfWeek.MONDAY,
        DayOfWeek.TUESDAY,
        DayOfWeek.WEDNESDAY,
        DayOfWeek.THURSDAY,
        DayOfWeek.FRIDAY,
      ],
    });

    const result = await service.isWorkingDay(
      'institution-1',
      'campus-1',
      '2026-06-14',
      DayOfWeek.SUNDAY,
    );

    expect(result).toBe(false);
    expect(prismaMock.institutionClosureDate.findFirst).not.toHaveBeenCalled();
  });

  it('returns true for a normal configured working day with no closure', async () => {
    prismaMock.institutionWorkingCalendar.findUnique.mockResolvedValue({
      workingDays: [DayOfWeek.MONDAY],
    });
    prismaMock.institutionClosureDate.findFirst.mockResolvedValue(null);

    const result = await service.isWorkingDay(
      'institution-1',
      'campus-1',
      '2026-06-15',
      DayOfWeek.MONDAY,
    );

    expect(result).toBe(true);
  });

  it('returns false when an explicit closure date exists on an otherwise-working weekday', async () => {
    prismaMock.institutionWorkingCalendar.findUnique.mockResolvedValue({
      workingDays: [DayOfWeek.MONDAY],
    });
    prismaMock.institutionClosureDate.findFirst.mockResolvedValue({
      id: 'closure-1',
    });

    const result = await service.isWorkingDay(
      'institution-1',
      'campus-1',
      '2026-06-15',
      DayOfWeek.MONDAY,
    );

    expect(result).toBe(false);
    expect(prismaMock.institutionClosureDate.findFirst).toHaveBeenCalledWith({
      where: {
        institutionId: 'institution-1',
        date: new Date('2026-06-15T00:00:00.000Z'),
        deletedAt: null,
        OR: [{ campusId: null }, { campusId: 'campus-1' }],
      },
      select: { id: true },
    });
  });

  it('matches both institution-wide (campusId null) and campus-specific closures', async () => {
    prismaMock.institutionWorkingCalendar.findUnique.mockResolvedValue({
      workingDays: [DayOfWeek.FRIDAY],
    });
    prismaMock.institutionClosureDate.findFirst.mockResolvedValue({
      id: 'closure-campus-specific',
      campusId: 'campus-1',
    });

    const result = await service.isWorkingDay(
      'institution-1',
      'campus-1',
      '2026-06-19',
      DayOfWeek.FRIDAY,
    );

    expect(result).toBe(false);
  });
});
