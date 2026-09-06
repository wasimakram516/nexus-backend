import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DayOfWeek, Prisma, UserRole } from '../../prisma/client';
import { AuditLogService } from '../../common/services/audit-log.service';
import { CampusAccessService } from '../../common/services/campus-access.service';
import { ModuleAccessService } from '../../common/services/module-access.service';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { PrismaService } from '../../prisma/prisma.service';
import { TimetableService } from './timetable.service';

describe('TimetableService', () => {
  let service: TimetableService;

  const prismaMock = {
    periodSlot: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    section: { findUnique: jest.fn() },
    teacherSubject: { findFirst: jest.fn() },
  };

  const campusAccessServiceMock = {
    assertCampusAccess: jest.fn().mockResolvedValue(undefined),
    assertClassAccess: jest.fn().mockResolvedValue(undefined),
    assertSectionAccess: jest.fn().mockResolvedValue(undefined),
    getCampusIdsForUser: jest.fn().mockResolvedValue(['campus-1']),
  };

  const moduleAccessServiceMock = {
    assertModuleEnabledForUser: jest.fn().mockResolvedValue(undefined),
  };

  const auditLogServiceMock = {
    log: jest.fn().mockResolvedValue(undefined),
  };

  const adminUser: CurrentUser = {
    sub: 'admin-1',
    email: 'admin@nexus.test',
    role: UserRole.ADMIN,
    institutionId: 'institution-1',
  };

  const baseDto = {
    classId: 'class-1',
    sectionId: 'section-1',
    name: 'Period 1',
    periodNumber: 1,
    dayOfWeek: DayOfWeek.MONDAY,
    startTime: '08:00',
    endTime: '08:40',
  };

  const sectionRow = {
    classId: 'class-1',
    class: { level: { campusId: 'campus-1' } },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    campusAccessServiceMock.assertCampusAccess.mockResolvedValue(undefined);
    campusAccessServiceMock.assertClassAccess.mockResolvedValue(undefined);
    campusAccessServiceMock.assertSectionAccess.mockResolvedValue(undefined);
    campusAccessServiceMock.getCampusIdsForUser.mockResolvedValue(['campus-1']);
    moduleAccessServiceMock.assertModuleEnabledForUser.mockResolvedValue(
      undefined,
    );

    const moduleRef = await Test.createTestingModule({
      providers: [
        TimetableService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: AuditLogService, useValue: auditLogServiceMock },
        { provide: CampusAccessService, useValue: campusAccessServiceMock },
        { provide: ModuleAccessService, useValue: moduleAccessServiceMock },
      ],
    }).compile();

    service = moduleRef.get(TimetableService);
  });

  describe('createPeriodSlot', () => {
    it('resolves campusId from sectionId and never trusts a client-supplied one', async () => {
      prismaMock.section.findUnique.mockResolvedValue(sectionRow);
      prismaMock.periodSlot.create.mockResolvedValue({
        id: 'slot-1',
        ...baseDto,
        campusId: 'campus-1',
      });

      await expect(
        service.createPeriodSlot(adminUser, { ...baseDto }),
      ).resolves.toMatchObject({
        message: 'Period slot created successfully',
        data: { id: 'slot-1' },
      });

      expect(prismaMock.periodSlot.create).toHaveBeenCalledWith(
        expect.objectContaining({
          /* eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- expect.objectContaining() is intentionally typed `any` by @types/jest */
          data: expect.objectContaining({
            campusId: 'campus-1',
            classId: 'class-1',
            sectionId: 'section-1',
          }),
        }),
      );
      expect(campusAccessServiceMock.assertCampusAccess).toHaveBeenCalledWith(
        adminUser,
        'campus-1',
      );
    });

    it('throws NotFoundException when sectionId does not exist', async () => {
      prismaMock.section.findUnique.mockResolvedValue(null);

      await expect(
        service.createPeriodSlot(adminUser, { ...baseDto }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prismaMock.periodSlot.create).not.toHaveBeenCalled();
    });

    it("rejects when classId does not match sectionId's own class", async () => {
      prismaMock.section.findUnique.mockResolvedValue({
        classId: 'class-2',
        class: { level: { campusId: 'campus-1' } },
      });

      await expect(
        service.createPeriodSlot(adminUser, { ...baseDto, classId: 'class-1' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaMock.periodSlot.create).not.toHaveBeenCalled();
    });

    it('rejects with 409 on duplicate (sectionId, dayOfWeek, periodNumber)', async () => {
      prismaMock.section.findUnique.mockResolvedValue(sectionRow);
      prismaMock.periodSlot.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('duplicate', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );

      await expect(
        service.createPeriodSlot(adminUser, { ...baseDto }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rethrows a non-P2002 database error unchanged', async () => {
      prismaMock.section.findUnique.mockResolvedValue(sectionRow);
      const dbError = new Error('connection reset');
      prismaMock.periodSlot.create.mockRejectedValue(dbError);

      await expect(
        service.createPeriodSlot(adminUser, { ...baseDto }),
      ).rejects.toBe(dbError);
    });

    describe('TeacherSubject cross-validation', () => {
      it('creates the slot when an active TeacherSubject allocation matches', async () => {
        prismaMock.section.findUnique.mockResolvedValue(sectionRow);
        prismaMock.teacherSubject.findFirst.mockResolvedValue({
          id: 'allocation-1',
        });
        prismaMock.periodSlot.create.mockResolvedValue({ id: 'slot-1' });

        await expect(
          service.createPeriodSlot(adminUser, {
            ...baseDto,
            subjectId: 'subject-1',
            staffProfileId: 'staff-1',
          }),
        ).resolves.toMatchObject({
          message: 'Period slot created successfully',
        });

        expect(prismaMock.teacherSubject.findFirst).toHaveBeenCalledWith(
          expect.objectContaining({
            /* eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- expect.objectContaining() is intentionally typed `any` by @types/jest */
            where: expect.objectContaining({
              staffProfileId: 'staff-1',
              subjectId: 'subject-1',
              classId: 'class-1',
              sectionId: 'section-1',
              deletedAt: null,
            }),
          }),
        );
      });

      it('rejects with 409 when no matching active TeacherSubject allocation exists', async () => {
        prismaMock.section.findUnique.mockResolvedValue(sectionRow);
        prismaMock.teacherSubject.findFirst.mockResolvedValue(null);

        await expect(
          service.createPeriodSlot(adminUser, {
            ...baseDto,
            subjectId: 'subject-1',
            staffProfileId: 'staff-1',
          }),
        ).rejects.toBeInstanceOf(ConflictException);
        expect(prismaMock.periodSlot.create).not.toHaveBeenCalled();
      });

      it('skips the TeacherSubject check entirely for a recess slot with a supervising teacher but no subject', async () => {
        prismaMock.section.findUnique.mockResolvedValue(sectionRow);
        prismaMock.periodSlot.create.mockResolvedValue({ id: 'slot-1' });

        await service.createPeriodSlot(adminUser, {
          ...baseDto,
          name: 'Recess',
          staffProfileId: 'staff-1',
        });

        expect(prismaMock.teacherSubject.findFirst).not.toHaveBeenCalled();
        expect(prismaMock.periodSlot.create).toHaveBeenCalled();
      });

      it('skips the TeacherSubject check for a slot with neither subject nor teacher', async () => {
        prismaMock.section.findUnique.mockResolvedValue(sectionRow);
        prismaMock.periodSlot.create.mockResolvedValue({ id: 'slot-1' });

        await service.createPeriodSlot(adminUser, {
          ...baseDto,
          name: 'Assembly',
        });

        expect(prismaMock.teacherSubject.findFirst).not.toHaveBeenCalled();
        expect(prismaMock.periodSlot.create).toHaveBeenCalled();
      });
    });
  });

  describe('updatePeriodSlot', () => {
    const existingSlot = {
      id: 'slot-1',
      campusId: 'campus-1',
      classId: 'class-1',
      sectionId: 'section-1',
      subjectId: null,
      staffProfileId: null,
      name: 'Period 1',
      periodNumber: 1,
      dayOfWeek: DayOfWeek.MONDAY,
      startTime: '08:00',
      endTime: '08:40',
    };

    it('re-validates the TeacherSubject cross-check when subjectId/staffProfileId change', async () => {
      prismaMock.periodSlot.findFirst.mockResolvedValue(existingSlot);
      prismaMock.teacherSubject.findFirst.mockResolvedValue(null);

      await expect(
        service.updatePeriodSlot(adminUser, 'slot-1', {
          subjectId: 'subject-1',
          staffProfileId: 'staff-1',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prismaMock.periodSlot.update).not.toHaveBeenCalled();
    });

    it('does not re-run the TeacherSubject check when neither subject nor teacher changes', async () => {
      prismaMock.periodSlot.findFirst.mockResolvedValue(existingSlot);
      prismaMock.periodSlot.update.mockResolvedValue({
        ...existingSlot,
        name: 'Period One',
      });

      await service.updatePeriodSlot(adminUser, 'slot-1', {
        name: 'Period One',
      });

      expect(prismaMock.teacherSubject.findFirst).not.toHaveBeenCalled();
      expect(prismaMock.periodSlot.update).toHaveBeenCalled();
    });

    it('re-resolves campusId and re-validates the class/section pair when sectionId changes', async () => {
      prismaMock.periodSlot.findFirst.mockResolvedValue(existingSlot);
      prismaMock.section.findUnique.mockResolvedValue({
        classId: 'class-1',
        class: { level: { campusId: 'campus-2' } },
      });
      prismaMock.periodSlot.update.mockResolvedValue({
        ...existingSlot,
        sectionId: 'section-2',
        campusId: 'campus-2',
      });

      await service.updatePeriodSlot(adminUser, 'slot-1', {
        sectionId: 'section-2',
      });

      expect(campusAccessServiceMock.assertCampusAccess).toHaveBeenCalledWith(
        adminUser,
        'campus-2',
      );
      expect(prismaMock.periodSlot.update).toHaveBeenCalledWith(
        expect.objectContaining({
          /* eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- expect.objectContaining() is intentionally typed `any` by @types/jest */
          data: expect.objectContaining({
            sectionId: 'section-2',
            campusId: 'campus-2',
          }),
        }),
      );
    });

    it('rejects with 409 on a duplicate (sectionId, dayOfWeek, periodNumber) collision', async () => {
      prismaMock.periodSlot.findFirst.mockResolvedValue(existingSlot);
      prismaMock.periodSlot.update.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('duplicate', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );

      await expect(
        service.updatePeriodSlot(adminUser, 'slot-1', { periodNumber: 2 }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('throws NotFoundException when the period slot does not exist', async () => {
      prismaMock.periodSlot.findFirst.mockResolvedValue(null);

      await expect(
        service.updatePeriodSlot(adminUser, 'missing', { name: 'X' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('getWeeklyGrid', () => {
    it('orders period slots by dayOfWeek then periodNumber', async () => {
      prismaMock.periodSlot.findMany.mockResolvedValue([]);

      await service.getWeeklyGrid(adminUser, 'section-1');

      expect(campusAccessServiceMock.assertSectionAccess).toHaveBeenCalledWith(
        adminUser,
        'section-1',
      );
      expect(prismaMock.periodSlot.findMany).toHaveBeenCalledWith({
        where: { sectionId: 'section-1', deletedAt: null },
        orderBy: [{ dayOfWeek: 'asc' }, { periodNumber: 'asc' }],
      });
    });
  });

  describe('listPeriodSlots', () => {
    it("scopes to the caller's accessible campuses when no campusId filter is given", async () => {
      prismaMock.periodSlot.findMany.mockResolvedValue([]);

      await service.listPeriodSlots(adminUser, {});

      expect(prismaMock.periodSlot.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          /* eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- expect.objectContaining() is intentionally typed `any` by @types/jest */
          where: expect.objectContaining({
            campusId: { in: ['campus-1'] },
          }),
          orderBy: [{ dayOfWeek: 'asc' }, { periodNumber: 'asc' }],
        }),
      );
    });

    it('narrows to just the given campusId and asserts access to it', async () => {
      prismaMock.periodSlot.findMany.mockResolvedValue([]);

      await service.listPeriodSlots(adminUser, { campusId: 'campus-9' });

      expect(campusAccessServiceMock.assertCampusAccess).toHaveBeenCalledWith(
        adminUser,
        'campus-9',
      );
      expect(prismaMock.periodSlot.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          /* eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- expect.objectContaining() is intentionally typed `any` by @types/jest */
          where: expect.objectContaining({ campusId: { in: ['campus-9'] } }),
        }),
      );
    });

    it('asserts class access and filters by classId when given', async () => {
      prismaMock.periodSlot.findMany.mockResolvedValue([]);

      await service.listPeriodSlots(adminUser, { classId: 'class-1' });

      expect(campusAccessServiceMock.assertClassAccess).toHaveBeenCalledWith(
        adminUser,
        'class-1',
      );
      expect(prismaMock.periodSlot.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          /* eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- expect.objectContaining() is intentionally typed `any` by @types/jest */
          where: expect.objectContaining({ classId: 'class-1' }),
        }),
      );
    });

    it('asserts section access and filters by sectionId and dayOfWeek when given', async () => {
      prismaMock.periodSlot.findMany.mockResolvedValue([]);

      await service.listPeriodSlots(adminUser, {
        sectionId: 'section-1',
        dayOfWeek: DayOfWeek.TUESDAY,
      });

      expect(campusAccessServiceMock.assertSectionAccess).toHaveBeenCalledWith(
        adminUser,
        'section-1',
      );
      expect(prismaMock.periodSlot.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          /* eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- expect.objectContaining() is intentionally typed `any` by @types/jest */
          where: expect.objectContaining({
            sectionId: 'section-1',
            dayOfWeek: DayOfWeek.TUESDAY,
          }),
        }),
      );
    });

    it('uses every campus in scope for a SUPERADMIN caller instead of narrowing to a filter list', async () => {
      const superadmin: CurrentUser = {
        sub: 'root-1',
        email: 'root@nexus.test',
        role: UserRole.SUPERADMIN,
        institutionId: null,
      };
      prismaMock.periodSlot.findMany.mockResolvedValue([]);

      await service.listPeriodSlots(superadmin, {});

      expect(
        campusAccessServiceMock.getCampusIdsForUser,
      ).not.toHaveBeenCalled();
      expect(prismaMock.periodSlot.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          /* eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- expect.objectContaining() is intentionally typed `any` by @types/jest */
          where: expect.not.objectContaining({ campusId: expect.anything() }),
        }),
      );
    });
  });

  describe('getPeriodSlot', () => {
    it('throws NotFoundException when the period slot does not exist', async () => {
      prismaMock.periodSlot.findFirst.mockResolvedValue(null);

      await expect(
        service.getPeriodSlot(adminUser, 'missing'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("asserts campus access using the slot's own campusId", async () => {
      prismaMock.periodSlot.findFirst.mockResolvedValue({
        id: 'slot-1',
        campusId: 'campus-1',
      });

      await service.getPeriodSlot(adminUser, 'slot-1');

      expect(campusAccessServiceMock.assertCampusAccess).toHaveBeenCalledWith(
        adminUser,
        'campus-1',
      );
    });
  });

  describe('deletePeriodSlot', () => {
    it('soft-deletes a period slot and records an audit log', async () => {
      prismaMock.periodSlot.findFirst.mockResolvedValue({
        id: 'slot-1',
        campusId: 'campus-1',
        name: 'Period 1',
      });
      prismaMock.periodSlot.update.mockResolvedValue({ id: 'slot-1' });

      await expect(
        service.deletePeriodSlot(adminUser, 'slot-1', 'schedule changed'),
      ).resolves.toEqual({
        message: 'Period slot moved to recycle bin successfully',
        data: { id: 'slot-1' },
      });
      expect(prismaMock.periodSlot.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'slot-1' },
          /* eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- expect.objectContaining() is intentionally typed `any` by @types/jest */
          data: expect.objectContaining({
            deletedBy: adminUser.sub,
            deleteReason: 'schedule changed',
          }),
        }),
      );
      expect(auditLogServiceMock.log).toHaveBeenCalledWith(
        adminUser,
        expect.objectContaining({ action: 'PERIOD_SLOT_DELETED' }),
      );
    });

    it('throws NotFoundException for an already-deleted or missing period slot', async () => {
      prismaMock.periodSlot.findFirst.mockResolvedValue(null);

      await expect(
        service.deletePeriodSlot(adminUser, 'missing'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prismaMock.periodSlot.update).not.toHaveBeenCalled();
    });
  });
});
