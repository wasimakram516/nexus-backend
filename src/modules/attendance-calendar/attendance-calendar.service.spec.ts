import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DayOfWeek, UserRole } from '../../prisma/client';
import { AuditLogService } from '../../common/services/audit-log.service';
import { CampusAccessService } from '../../common/services/campus-access.service';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { ModuleAccessService } from '../../common/services/module-access.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AttendanceCalendarService } from './attendance-calendar.service';

describe('AttendanceCalendarService', () => {
  let service: AttendanceCalendarService;

  const adminUser: CurrentUser = {
    sub: 'admin-1',
    email: 'admin@nexus.test',
    role: UserRole.ADMIN,
    institutionId: 'institution-1',
  };

  const prismaMock = {
    institution: { findUnique: jest.fn() },
    campus: { findUnique: jest.fn() },
    institutionWorkingCalendar: { findFirst: jest.fn(), upsert: jest.fn() },
    institutionClosureDate: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  };

  const auditLogServiceMock = { log: jest.fn().mockResolvedValue(undefined) };
  const campusAccessServiceMock = { assertCampusAccess: jest.fn() };
  const moduleAccessServiceMock = {
    assertModuleEnabledForUser: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    prismaMock.institution.findUnique.mockResolvedValue({
      id: 'institution-1',
    });

    const moduleRef = await Test.createTestingModule({
      providers: [
        AttendanceCalendarService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: AuditLogService, useValue: auditLogServiceMock },
        { provide: CampusAccessService, useValue: campusAccessServiceMock },
        { provide: ModuleAccessService, useValue: moduleAccessServiceMock },
      ],
    }).compile();

    service = moduleRef.get(AttendanceCalendarService);
  });

  describe('getWorkingCalendar', () => {
    it('returns null data when no calendar has been configured yet', async () => {
      prismaMock.institutionWorkingCalendar.findFirst.mockResolvedValue(null);

      const result = await service.getWorkingCalendar(
        'institution-1',
        adminUser,
      );

      expect(result.data).toBeNull();
    });

    it('throws NotFoundException for a non-existent institution', async () => {
      prismaMock.institution.findUnique.mockResolvedValue(null);

      await expect(
        service.getWorkingCalendar('missing-institution', adminUser),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('upsertWorkingCalendar', () => {
    it('creates the calendar and audits the write', async () => {
      prismaMock.institutionWorkingCalendar.upsert.mockResolvedValue({
        id: 'calendar-1',
        institutionId: 'institution-1',
        workingDays: [DayOfWeek.MONDAY, DayOfWeek.TUESDAY],
      });

      const result = await service.upsertWorkingCalendar(
        'institution-1',
        adminUser,
        { workingDays: [DayOfWeek.MONDAY, DayOfWeek.TUESDAY] },
      );

      expect(prismaMock.institutionWorkingCalendar.upsert).toHaveBeenCalledWith(
        {
          where: { institutionId: 'institution-1' },
          create: {
            institutionId: 'institution-1',
            workingDays: [DayOfWeek.MONDAY, DayOfWeek.TUESDAY],
            createdBy: adminUser.sub,
          },
          update: {
            workingDays: [DayOfWeek.MONDAY, DayOfWeek.TUESDAY],
            updatedBy: adminUser.sub,
            deletedAt: null,
            deletedBy: null,
            deleteReason: null,
          },
        },
      );
      expect(auditLogServiceMock.log).toHaveBeenCalledWith(
        adminUser,
        expect.objectContaining({
          action: 'ATTENDANCE_WORKING_CALENDAR_UPDATED',
        }),
      );
      expect(result.data.workingDays).toEqual([
        DayOfWeek.MONDAY,
        DayOfWeek.TUESDAY,
      ]);
    });
  });

  describe('createClosureDate', () => {
    it('creates an institution-wide closure date', async () => {
      prismaMock.institutionClosureDate.create.mockResolvedValue({
        id: 'closure-1',
        institutionId: 'institution-1',
        campusId: null,
        date: new Date('2026-12-25T00:00:00.000Z'),
        label: 'Christmas',
      });

      const result = await service.createClosureDate(
        'institution-1',
        adminUser,
        { date: '2026-12-25', label: 'Christmas' },
      );

      expect(prismaMock.institutionClosureDate.create).toHaveBeenCalledWith({
        data: {
          institutionId: 'institution-1',
          campusId: null,
          campusScopeKey: 'INSTITUTION',
          date: new Date('2026-12-25T00:00:00.000Z'),
          label: 'Christmas',
          createdBy: adminUser.sub,
        },
      });
      expect(result.data.label).toBe('Christmas');
    });

    it('rejects a campusId that does not belong to the institution', async () => {
      prismaMock.campus.findUnique.mockResolvedValue({
        institutionId: 'other-institution',
      });

      await expect(
        service.createClosureDate('institution-1', adminUser, {
          date: '2026-12-25',
          label: 'Christmas',
          campusId: 'campus-in-another-institution',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('updateClosureDate', () => {
    it('recomputes campusScopeKey to the sentinel when campusId is cleared', async () => {
      prismaMock.institutionClosureDate.findFirst.mockResolvedValue({
        id: 'closure-1',
        institutionId: 'institution-1',
        campusId: 'campus-1',
      });
      prismaMock.institutionClosureDate.update.mockResolvedValue({
        id: 'closure-1',
      });

      // campusId is typed `string | undefined` on the DTO (matching this
      // codebase's existing soft-typing convention, e.g. Notices'
      // UpdateNoticeDto) but class-validator's @IsOptional() lets `null`
      // through unvalidated at runtime regardless — the service's own
      // `!== undefined` check is what actually relies on that, so the test
      // exercises the real runtime contract, not the (looser) compile-time
      // one.
      await service.updateClosureDate('institution-1', adminUser, 'closure-1', {
        campusId: null as unknown as undefined,
      });

      expect(prismaMock.institutionClosureDate.update).toHaveBeenCalledWith({
        where: { id: 'closure-1' },
        data: expect.objectContaining({
          campusId: null,
          campusScopeKey: 'INSTITUTION',
        }) as unknown,
      });
    });

    it('recomputes campusScopeKey to the campus id when campusId is set', async () => {
      prismaMock.institutionClosureDate.findFirst.mockResolvedValue({
        id: 'closure-1',
        institutionId: 'institution-1',
        campusId: null,
      });
      prismaMock.campus.findUnique.mockResolvedValue({
        institutionId: 'institution-1',
      });
      prismaMock.institutionClosureDate.update.mockResolvedValue({
        id: 'closure-1',
      });

      await service.updateClosureDate('institution-1', adminUser, 'closure-1', {
        campusId: 'campus-1',
      });

      expect(prismaMock.institutionClosureDate.update).toHaveBeenCalledWith({
        where: { id: 'closure-1' },
        data: expect.objectContaining({
          campusId: 'campus-1',
          campusScopeKey: 'campus-1',
        }) as unknown,
      });
    });

    it('leaves campusScopeKey untouched when campusId is not part of the update', async () => {
      prismaMock.institutionClosureDate.findFirst.mockResolvedValue({
        id: 'closure-1',
        institutionId: 'institution-1',
        campusId: null,
      });
      prismaMock.institutionClosureDate.update.mockResolvedValue({
        id: 'closure-1',
      });

      await service.updateClosureDate('institution-1', adminUser, 'closure-1', {
        label: 'Renamed',
      });

      expect(prismaMock.institutionClosureDate.update).toHaveBeenCalledWith({
        where: { id: 'closure-1' },
        data: {
          label: 'Renamed',
          updatedBy: adminUser.sub,
        },
      });
    });
  });

  describe('deleteClosureDate', () => {
    it('soft-deletes an existing closure date', async () => {
      prismaMock.institutionClosureDate.findFirst.mockResolvedValue({
        id: 'closure-1',
        institutionId: 'institution-1',
        campusId: null,
        label: 'Eid',
      });
      prismaMock.institutionClosureDate.update.mockResolvedValue({
        id: 'closure-1',
      });

      const result = await service.deleteClosureDate(
        'institution-1',
        adminUser,
        'closure-1',
        'Duplicate entry',
      );

      expect(prismaMock.institutionClosureDate.update).toHaveBeenCalledWith({
        where: { id: 'closure-1' },
        data: expect.objectContaining({
          deletedBy: adminUser.sub,
          deleteReason: 'Duplicate entry',
        }) as unknown,
      });
      expect(result.data).toEqual({ id: 'closure-1' });
    });

    it('throws NotFoundException for a closure date outside the institution', async () => {
      prismaMock.institutionClosureDate.findFirst.mockResolvedValue(null);

      await expect(
        service.deleteClosureDate('institution-1', adminUser, 'closure-x'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
