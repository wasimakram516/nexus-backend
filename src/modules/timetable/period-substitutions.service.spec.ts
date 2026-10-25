/* eslint-disable @typescript-eslint/no-unsafe-assignment -- jest asymmetric matchers are typed any */
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { AuditLogService } from '../../common/services/audit-log.service';
import { CampusAccessService } from '../../common/services/campus-access.service';
import { ModuleAccessService } from '../../common/services/module-access.service';
import { DayOfWeek, Prisma, UserRole } from '../../prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  dateOnly,
  PeriodSubstitutionsService,
  weekdayOf,
} from './period-substitutions.service';

describe('date helpers', () => {
  it('reads a date as a UTC midnight', () => {
    expect(dateOnly('2026-11-02').toISOString()).toBe(
      '2026-11-02T00:00:00.000Z',
    );
  });

  it.each([
    ['2026-11-01', DayOfWeek.SUNDAY],
    ['2026-11-02', DayOfWeek.MONDAY],
    ['2026-11-03', DayOfWeek.TUESDAY],
    ['2026-11-07', DayOfWeek.SATURDAY],
  ])('knows %s is a %s', (date, day) => {
    expect(weekdayOf(date)).toBe(day);
  });
});

describe('PeriodSubstitutionsService', () => {
  let service: PeriodSubstitutionsService;

  const admin: CurrentUser = {
    sub: 'admin-1',
    email: 'admin@nexus.test',
    role: UserRole.ADMIN,
    institutionId: 'inst-1',
  };

  const prismaMock = {
    periodSlot: { findFirst: jest.fn(), findMany: jest.fn() },
    periodSubstitution: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    staffProfile: { findFirst: jest.fn() },
    campus: { findUnique: jest.fn() },
  };
  const auditMock = { log: jest.fn() };
  const campusAccessMock = { assertCampusAccess: jest.fn() };
  const moduleAccessMock = { assertModuleEnabledForUser: jest.fn() };

  const slot = {
    id: 'slot-1',
    campusId: 'campus-1',
    staffProfileId: 'teacher-1',
    dayOfWeek: DayOfWeek.MONDAY,
    startTime: '08:00',
    endTime: '08:40',
  };
  const dto = {
    periodSlotId: 'slot-1',
    date: '2026-11-02',
    substituteStaffProfileId: 'teacher-2',
  };
  const named = (name: string) => ({ user: { name } });
  const created = {
    id: 'sub-1',
    date: new Date('2026-11-02T00:00:00.000Z'),
    reason: null,
    periodSlotId: 'slot-1',
    substituteStaffProfileId: 'teacher-2',
    substitute: named('Teacher Two'),
    periodSlot: {
      ...slot,
      sectionId: 'sec-1',
      name: 'Period 1',
      class: { name: 'Grade 5' },
      section: { name: 'A' },
      subject: { name: 'Maths' },
      staffProfile: named('Teacher One'),
    },
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    moduleAccessMock.assertModuleEnabledForUser.mockResolvedValue(undefined);
    campusAccessMock.assertCampusAccess.mockResolvedValue(undefined);
    auditMock.log.mockResolvedValue(undefined);
    prismaMock.periodSlot.findFirst.mockResolvedValue(slot);
    prismaMock.campus.findUnique.mockResolvedValue({ institutionId: 'inst-1' });
    prismaMock.staffProfile.findFirst.mockResolvedValue({ id: 'teacher-2' });
    prismaMock.periodSlot.findMany.mockResolvedValue([]);
    prismaMock.periodSubstitution.findMany.mockResolvedValue([]);
    prismaMock.periodSubstitution.create.mockResolvedValue(created);

    const module = await Test.createTestingModule({
      providers: [
        PeriodSubstitutionsService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: AuditLogService, useValue: auditMock },
        { provide: CampusAccessService, useValue: campusAccessMock },
        { provide: ModuleAccessService, useValue: moduleAccessMock },
      ],
    }).compile();
    service = module.get(PeriodSubstitutionsService);
  });

  describe('create', () => {
    it('arranges cover for that date, recording who did it, and shows the period with both teachers', async () => {
      const { data } = await service.create(admin, {
        ...dto,
        reason: '  Sick leave ',
      });

      expect(prismaMock.periodSubstitution.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            campusId: 'campus-1',
            periodSlotId: 'slot-1',
            date: new Date('2026-11-02T00:00:00.000Z'),
            substituteStaffProfileId: 'teacher-2',
            reason: 'Sick leave',
            createdBy: 'admin-1',
          },
        }),
      );
      expect(data).toMatchObject({
        date: '2026-11-02',
        substituteName: 'Teacher Two',
        originalName: 'Teacher One',
        className: 'Grade 5',
        sectionName: 'A',
        subjectName: 'Maths',
        startTime: '08:00',
      });
      expect(auditMock.log).toHaveBeenCalledWith(
        admin,
        expect.objectContaining({ action: 'PERIOD_SUBSTITUTION_CREATED' }),
      );
      expect(campusAccessMock.assertCampusAccess).toHaveBeenCalledWith(
        admin,
        'campus-1',
      );
    });

    it("refuses a date that is not the period's own weekday", async () => {
      await expect(
        service.create(admin, { ...dto, date: '2026-11-03' }),
      ).rejects.toThrow(
        'This period is on mondays, so the cover must be on a monday.',
      );
      expect(prismaMock.periodSubstitution.create).not.toHaveBeenCalled();
    });

    it("refuses covering with the period's own teacher", async () => {
      await expect(
        service.create(admin, {
          ...dto,
          substituteStaffProfileId: 'teacher-1',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('is not found for an unknown period, and for a teacher outside the institution', async () => {
      prismaMock.periodSlot.findFirst.mockResolvedValue(null);
      await expect(service.create(admin, dto)).rejects.toBeInstanceOf(
        NotFoundException,
      );

      prismaMock.periodSlot.findFirst.mockResolvedValue(slot);
      prismaMock.staffProfile.findFirst.mockResolvedValue(null);
      await expect(service.create(admin, dto)).rejects.toThrow(
        'Teacher not found.',
      );
      expect(prismaMock.staffProfile.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'teacher-2',
          deletedAt: null,
          campus: { institutionId: 'inst-1' },
        },
        select: { id: true },
      });
    });

    it('refuses a substitute who is teaching their own period then', async () => {
      prismaMock.periodSlot.findMany.mockResolvedValue([
        {
          startTime: '08:20',
          endTime: '09:00',
          class: { name: 'Grade 6' },
          section: { name: 'B' },
          substitutions: [],
        },
      ]);

      await expect(service.create(admin, dto)).rejects.toThrow(
        'This teacher is teaching Grade 6, section B, 8:20 AM to 9:00 AM then.',
      );
    });

    it('allows a substitute whose own period that day is covered by someone else, or only back to back', async () => {
      prismaMock.periodSlot.findMany.mockResolvedValue([
        {
          startTime: '08:20',
          endTime: '09:00',
          class: { name: 'Grade 6' },
          section: { name: 'B' },
          substitutions: [{ id: 'covered' }],
        },
        {
          startTime: '08:40',
          endTime: '09:20',
          class: { name: 'Grade 6' },
          section: { name: 'C' },
          substitutions: [],
        },
      ]);

      await expect(service.create(admin, dto)).resolves.toMatchObject({
        message: 'Substitution arranged successfully',
      });
    });

    it('refuses a substitute who is already covering something else at that time', async () => {
      prismaMock.periodSubstitution.findMany.mockResolvedValue([
        {
          periodSlot: {
            startTime: '07:50',
            endTime: '08:20',
            class: { name: 'Grade 4' },
            section: { name: 'D' },
          },
        },
      ]);

      await expect(service.create(admin, dto)).rejects.toThrow(
        'This teacher is already covering Grade 4, section D, 7:50 AM to 8:20 AM then.',
      );
    });

    it('says so when the period already has cover that date', async () => {
      prismaMock.periodSubstitution.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('dup', {
          code: 'P2002',
          clientVersion: 'x',
        }),
      );

      await expect(service.create(admin, dto)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('refuses a caller who cannot act at the campus, before anything else', async () => {
      campusAccessMock.assertCampusAccess.mockRejectedValue(
        new Error('forbidden'),
      );

      await expect(service.create(admin, dto)).rejects.toThrow('forbidden');
      expect(prismaMock.staffProfile.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('list', () => {
    it('asks for the campus, the dates and the section or teacher, among active cover only', async () => {
      prismaMock.periodSubstitution.findMany.mockResolvedValue([created]);

      const { data } = await service.list(admin, {
        campusId: 'campus-1',
        from: '2026-11-01',
        to: '2026-11-07',
        sectionId: 'sec-1',
        staffProfileId: 'teacher-2',
      });

      expect(prismaMock.periodSubstitution.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            campusId: 'campus-1',
            deletedAt: null,
            periodSlot: { deletedAt: null, sectionId: 'sec-1' },
            date: {
              gte: new Date('2026-11-01T00:00:00.000Z'),
              lte: new Date('2026-11-07T00:00:00.000Z'),
            },
            OR: [
              { substituteStaffProfileId: 'teacher-2' },
              { periodSlot: { staffProfileId: 'teacher-2' } },
            ],
          },
          orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
        }),
      );
      expect(data).toHaveLength(1);
      expect(campusAccessMock.assertCampusAccess).toHaveBeenCalledWith(
        admin,
        'campus-1',
      );
    });

    it('applies no filters that were not asked for', async () => {
      await service.list(admin, { campusId: 'campus-1' });

      expect(prismaMock.periodSubstitution.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            campusId: 'campus-1',
            deletedAt: null,
            periodSlot: { deletedAt: null },
            date: {},
          },
        }),
      );
    });
  });

  describe('cancel', () => {
    it('soft-deletes the substitution with who and why, and audits it', async () => {
      prismaMock.periodSubstitution.findFirst.mockResolvedValue({
        id: 'sub-1',
        campusId: 'campus-1',
      });

      const { data } = await service.cancel(admin, 'sub-1', {
        reason: ' Teacher is back ',
      });

      expect(data).toEqual({ id: 'sub-1' });
      expect(prismaMock.periodSubstitution.update).toHaveBeenCalledWith({
        where: { id: 'sub-1' },
        data: {
          deletedAt: expect.any(Date),
          deletedBy: 'admin-1',
          deleteReason: 'Teacher is back',
        },
      });
      expect(auditMock.log).toHaveBeenCalledWith(
        admin,
        expect.objectContaining({ action: 'PERIOD_SUBSTITUTION_CANCELLED' }),
      );
    });

    it('is not found for an unknown or already cancelled substitution, and respects campus access', async () => {
      prismaMock.periodSubstitution.findFirst.mockResolvedValue(null);
      await expect(service.cancel(admin, 'nope', {})).rejects.toBeInstanceOf(
        NotFoundException,
      );

      prismaMock.periodSubstitution.findFirst.mockResolvedValue({
        id: 'sub-1',
        campusId: 'campus-9',
      });
      campusAccessMock.assertCampusAccess.mockRejectedValue(
        new Error('forbidden'),
      );
      await expect(service.cancel(admin, 'sub-1', {})).rejects.toThrow(
        'forbidden',
      );
      expect(prismaMock.periodSubstitution.update).not.toHaveBeenCalled();
    });
  });
});
