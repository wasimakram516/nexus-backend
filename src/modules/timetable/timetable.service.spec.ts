/* eslint-disable @typescript-eslint/no-unsafe-assignment -- jest asymmetric matchers are typed any */
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DayOfWeek, Prisma, UserRole } from '../../prisma/client';
import { AuditLogService } from '../../common/services/audit-log.service';
import { CampusAccessService } from '../../common/services/campus-access.service';
import { EntityCustomFieldsService } from '../../common/services/entity-custom-fields.service';
import { ModuleAccessService } from '../../common/services/module-access.service';
import { RequestContextService } from '../../common/services/request-context.service';
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
    $transaction: jest.fn(),
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

  const entityCustomFieldsServiceMock = {
    resolveInstitutionIdByCampus: jest.fn().mockResolvedValue('institution-1'),
    saveRecord: jest
      .fn()
      .mockImplementation(
        (
          _params: unknown,
          mutation: (transaction: Prisma.TransactionClient) => Promise<unknown>,
        ) => mutation(prismaMock as unknown as Prisma.TransactionClient),
      ),
    attachToItem: jest
      .fn()
      .mockImplementation((item: unknown) => Promise.resolve(item)),
    attachToItems: jest
      .fn()
      .mockImplementation((items: unknown) => Promise.resolve(items)),
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
    // No other periods unless a test says otherwise, so no clash is found.
    prismaMock.periodSlot.findMany.mockResolvedValue([]);
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
        {
          provide: EntityCustomFieldsService,
          useValue: entityCustomFieldsServiceMock,
        },
        { provide: ModuleAccessService, useValue: moduleAccessServiceMock },
        {
          provide: RequestContextService,
          useValue: {
            runWith: (_state: unknown, callback: () => unknown) => callback(),
          },
        },
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

  describe('custom fields wiring (M4.5 / P1-2a)', () => {
    it('createPeriodSlot commits the slot and its custom field values through the same saveRecord transaction', async () => {
      prismaMock.section.findUnique.mockResolvedValue(sectionRow);
      prismaMock.periodSlot.create.mockResolvedValue({
        id: 'slot-1',
        ...baseDto,
        campusId: 'campus-1',
      });

      await service.createPeriodSlot(adminUser, {
        ...baseDto,
        customFields: { room: 'B-12' },
      });

      expect(
        entityCustomFieldsServiceMock.resolveInstitutionIdByCampus,
      ).toHaveBeenCalledWith('campus-1');
      expect(entityCustomFieldsServiceMock.saveRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          institutionId: 'institution-1',
          entityType: 'period_slot',
          values: { room: 'B-12' },
          create: true,
        }),
        expect.any(Function),
      );
      expect(entityCustomFieldsServiceMock.attachToItem).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'slot-1' }),
        'period_slot',
      );
    });

    it('updatePeriodSlot saves custom field values against the existing record', async () => {
      prismaMock.periodSlot.findFirst.mockResolvedValue({
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
      });
      prismaMock.periodSlot.update.mockResolvedValue({ id: 'slot-1' });

      await service.updatePeriodSlot(adminUser, 'slot-1', {
        customFields: { room: 'B-14' },
      });

      expect(entityCustomFieldsServiceMock.saveRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          institutionId: 'institution-1',
          entityType: 'period_slot',
          values: { room: 'B-14' },
          create: false,
        }),
        expect.any(Function),
      );
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

  describe('clash rules', () => {
    const other = (overrides: Record<string, unknown> = {}) => ({
      id: 'other-1',
      sectionId: 'section-2',
      dayOfWeek: DayOfWeek.MONDAY,
      startTime: '08:20',
      endTime: '09:00',
      staffProfileId: 'teacher-1',
      room: null,
      section: { name: 'B' },
      class: { name: 'Grade 6' },
      ...overrides,
    });

    beforeEach(() => {
      prismaMock.section.findUnique.mockResolvedValue(sectionRow);
      prismaMock.periodSlot.create.mockResolvedValue({
        id: 'slot-1',
        ...baseDto,
        campusId: 'campus-1',
      });
    });

    it('refuses a period that puts a teacher in two places at once, naming where', async () => {
      prismaMock.periodSlot.findMany.mockResolvedValue([other()]);

      await expect(
        service.createPeriodSlot(adminUser, {
          ...baseDto,
          staffProfileId: 'teacher-1',
        }),
      ).rejects.toThrow(
        'This teacher is already teaching Grade 6, section B, 8:20 AM to 9:00 AM at that time.',
      );
      expect(prismaMock.periodSlot.create).not.toHaveBeenCalled();
    });

    it('refuses a room that is already in use at that time, ignoring case', async () => {
      prismaMock.periodSlot.findMany.mockResolvedValue([
        other({ staffProfileId: null, room: 'LAB 1' }),
      ]);

      await expect(
        service.createPeriodSlot(adminUser, { ...baseDto, room: ' Lab 1 ' }),
      ).rejects.toThrow(
        'LAB 1 is already used by Grade 6, section B, 8:20 AM to 9:00 AM at that time.',
      );
    });

    it('looks only on that campus, that day, among active periods, for that teacher or room', async () => {
      await service.createPeriodSlot(adminUser, {
        ...baseDto,
        staffProfileId: 'teacher-1',
        room: 'Lab 1',
      });

      expect(prismaMock.periodSlot.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            campusId: 'campus-1',
            dayOfWeek: DayOfWeek.MONDAY,
            deletedAt: null,
            id: { notIn: [] },
            OR: [
              { staffProfileId: 'teacher-1' },
              { room: { equals: 'lab 1', mode: 'insensitive' } },
            ],
          }),
        }),
      );
    });

    it('allows back-to-back periods for the same teacher', async () => {
      prismaMock.periodSlot.findMany.mockResolvedValue([
        other({ startTime: '08:40', endTime: '09:20' }),
      ]);

      await expect(
        service.createPeriodSlot(adminUser, {
          ...baseDto,
          staffProfileId: 'teacher-1',
        }),
      ).resolves.toMatchObject({ message: 'Period slot created successfully' });
    });

    it('does not look for clashes at all for a period with no teacher and no room', async () => {
      prismaMock.periodSlot.findMany.mockClear();

      await service.createPeriodSlot(adminUser, { ...baseDto });

      expect(prismaMock.periodSlot.findMany).not.toHaveBeenCalled();
    });

    it('stores the room trimmed, or none when it is blank', async () => {
      await service.createPeriodSlot(adminUser, {
        ...baseDto,
        room: '  Lab 1 ',
      });
      expect(prismaMock.periodSlot.create).toHaveBeenLastCalledWith({
        data: expect.objectContaining({ room: 'Lab 1' }),
      });

      await service.createPeriodSlot(adminUser, { ...baseDto, room: '   ' });
      expect(prismaMock.periodSlot.create).toHaveBeenLastCalledWith({
        data: expect.objectContaining({ room: null }),
      });
    });

    describe('updating', () => {
      const existing = {
        id: 'slot-1',
        campusId: 'campus-1',
        classId: 'class-1',
        sectionId: 'section-1',
        subjectId: null,
        staffProfileId: 'teacher-1',
        dayOfWeek: DayOfWeek.MONDAY,
        startTime: '08:00',
        endTime: '08:40',
        room: null,
      };

      beforeEach(() => {
        prismaMock.periodSlot.findFirst.mockResolvedValue(existing);
        prismaMock.periodSlot.update.mockResolvedValue(existing);
      });

      it('checks the final day and time, leaving the period itself out of the check', async () => {
        await service.updatePeriodSlot(adminUser, 'slot-1', {
          dayOfWeek: DayOfWeek.TUESDAY,
        });

        expect(prismaMock.periodSlot.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              dayOfWeek: DayOfWeek.TUESDAY,
              id: { notIn: ['slot-1'] },
              OR: [{ staffProfileId: 'teacher-1' }],
            }),
          }),
        );
      });

      it('refuses a move into a time the teacher is already teaching', async () => {
        prismaMock.periodSlot.findMany.mockResolvedValue([other()]);

        await expect(
          service.updatePeriodSlot(adminUser, 'slot-1', {
            startTime: '08:30',
            endTime: '09:10',
          }),
        ).rejects.toBeInstanceOf(ConflictException);
        expect(prismaMock.periodSlot.update).not.toHaveBeenCalled();
      });

      it('does not check when only the name changes', async () => {
        prismaMock.periodSlot.findMany.mockClear();

        await service.updatePeriodSlot(adminUser, 'slot-1', { name: 'Maths' });

        expect(prismaMock.periodSlot.findMany).not.toHaveBeenCalled();
      });

      it('clears the room when it is set to nothing', async () => {
        await service.updatePeriodSlot(adminUser, 'slot-1', { room: '' });

        expect(prismaMock.periodSlot.update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ room: null }),
          }),
        );
      });
    });
  });

  describe('swapPeriodSlots', () => {
    const slot = (
      id: string,
      day: DayOfWeek,
      number: number,
      start: string,
      end: string,
      staff: string | null = null,
    ) => ({
      id,
      campusId: 'campus-1',
      sectionId: 'section-1',
      dayOfWeek: day,
      periodNumber: number,
      startTime: start,
      endTime: end,
      staffProfileId: staff,
      room: null,
    });

    beforeEach(() => {
      prismaMock.$transaction.mockImplementation(
        (callback: (client: unknown) => unknown) => callback(prismaMock),
      );
      prismaMock.periodSlot.update.mockImplementation(
        ({ where, data }: { where: { id: string }; data: object }) =>
          Promise.resolve({ id: where.id, ...data }),
      );
    });

    it('exchanges the two places, parking one off the grid for a moment', async () => {
      prismaMock.periodSlot.findFirst
        .mockResolvedValueOnce(slot('a', DayOfWeek.MONDAY, 1, '08:00', '08:40'))
        .mockResolvedValueOnce(
          slot('b', DayOfWeek.TUESDAY, 3, '09:40', '10:20'),
        );

      const { data } = await service.swapPeriodSlots(adminUser, {
        firstId: 'a',
        secondId: 'b',
      });

      const updates = prismaMock.periodSlot.update.mock.calls.map(
        (
          call: [{ where: { id: string }; data: { periodNumber?: number } }],
        ) => [call[0].where.id, call[0].data.periodNumber],
      );
      expect(updates).toEqual([
        ['a', 0],
        ['b', 1],
        ['a', 3],
      ]);
      expect(data).toHaveLength(2);
      expect(auditLogServiceMock.log).toHaveBeenCalledWith(
        adminUser,
        expect.objectContaining({ action: 'PERIOD_SLOTS_SWAPPED' }),
        prismaMock,
      );
    });

    it('refuses the swap when a teacher would then be in two places', async () => {
      prismaMock.periodSlot.findFirst
        .mockResolvedValueOnce(
          slot('a', DayOfWeek.MONDAY, 1, '08:00', '08:40', 'teacher-1'),
        )
        .mockResolvedValueOnce(
          slot('b', DayOfWeek.TUESDAY, 3, '09:40', '10:20'),
        );
      prismaMock.periodSlot.findMany.mockResolvedValue([
        {
          id: 'x',
          sectionId: 'section-9',
          dayOfWeek: DayOfWeek.TUESDAY,
          startTime: '09:30',
          endTime: '10:10',
          staffProfileId: 'teacher-1',
          room: null,
          section: { name: 'C' },
          class: { name: 'Grade 7' },
        },
      ]);

      await expect(
        service.swapPeriodSlots(adminUser, { firstId: 'a', secondId: 'b' }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prismaMock.periodSlot.update).not.toHaveBeenCalled();
    });

    it('refuses the same period twice, periods of different sections, and a missing period', async () => {
      await expect(
        service.swapPeriodSlots(adminUser, { firstId: 'a', secondId: 'a' }),
      ).rejects.toBeInstanceOf(BadRequestException);

      prismaMock.periodSlot.findFirst
        .mockResolvedValueOnce(slot('a', DayOfWeek.MONDAY, 1, '08:00', '08:40'))
        .mockResolvedValueOnce({
          ...slot('b', DayOfWeek.MONDAY, 2, '08:40', '09:20'),
          sectionId: 'section-2',
        });
      await expect(
        service.swapPeriodSlots(adminUser, { firstId: 'a', secondId: 'b' }),
      ).rejects.toThrow('Only periods of the same section can be swapped.');

      prismaMock.periodSlot.findFirst.mockResolvedValueOnce(null);
      await expect(
        service.swapPeriodSlots(adminUser, { firstId: 'a', secondId: 'b' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('refuses a caller who cannot act at the campus before changing anything', async () => {
      prismaMock.periodSlot.findFirst
        .mockResolvedValueOnce(slot('a', DayOfWeek.MONDAY, 1, '08:00', '08:40'))
        .mockResolvedValueOnce(
          slot('b', DayOfWeek.MONDAY, 2, '08:40', '09:20'),
        );
      campusAccessServiceMock.assertCampusAccess.mockRejectedValue(
        new Error('forbidden'),
      );

      await expect(
        service.swapPeriodSlots(adminUser, { firstId: 'a', secondId: 'b' }),
      ).rejects.toThrow('forbidden');
      expect(prismaMock.periodSlot.update).not.toHaveBeenCalled();
    });
  });

  describe('listClashes and listRooms', () => {
    const full = (
      id: string,
      staff: string | null,
      room: string | null,
      start: string,
      end: string,
    ) => ({
      id,
      sectionId: id,
      dayOfWeek: DayOfWeek.MONDAY,
      startTime: start,
      endTime: end,
      staffProfileId: staff,
      room,
      section: { name: `S-${id}` },
      class: { name: 'Grade 5' },
      staffProfile: { user: { name: `Teacher ${staff}` } },
    });

    it('reports clashes that already exist, with who and where', async () => {
      prismaMock.periodSlot.findMany.mockResolvedValue([
        full('a', 't1', 'Lab', '08:00', '08:40'),
        full('b', 't1', 'lab', '08:20', '09:00'),
        full('c', 't2', null, '08:20', '09:00'),
      ]);

      const { data } = await service.listClashes(adminUser, 'campus-1');

      expect(data.map((clash) => clash.kind)).toEqual(['TEACHER', 'ROOM']);
      expect(data[0].first).toMatchObject({
        className: 'Grade 5',
        sectionName: 'S-a',
        teacherName: 'Teacher t1',
      });
      expect(campusAccessServiceMock.assertCampusAccess).toHaveBeenCalledWith(
        adminUser,
        'campus-1',
      );
    });

    it('lists the rooms already used on the campus, alphabetically', async () => {
      prismaMock.periodSlot.findMany.mockResolvedValue([
        { room: 'Lab 2' },
        { room: 'Hall' },
        { room: null },
      ]);

      const { data } = await service.listRooms(adminUser, 'campus-1');

      expect(data).toEqual(['Hall', 'Lab 2']);
      expect(prismaMock.periodSlot.findMany).toHaveBeenCalledWith({
        where: { campusId: 'campus-1', deletedAt: null, room: { not: null } },
        select: { room: true },
        distinct: ['room'],
      });
    });
  });

  describe('duplicatePeriodSlots', () => {
    const source = (id: string, overrides: Record<string, unknown> = {}) => ({
      id,
      campusId: 'campus-1',
      classId: 'class-1',
      sectionId: 'section-1',
      subjectId: 'subject-1',
      staffProfileId: 'teacher-1',
      name: 'Period 1',
      periodNumber: 1,
      dayOfWeek: DayOfWeek.MONDAY,
      startTime: '08:00',
      endTime: '08:40',
      room: 'Lab 1',
      customFields: { note: 'x' },
      ...overrides,
    });

    it('copies each period onto every other target day with its teacher, room and extra values', async () => {
      prismaMock.periodSlot.findMany.mockResolvedValueOnce([source('s1')]);
      const create = jest
        .spyOn(service, 'createPeriodSlot')
        .mockResolvedValue({} as never);

      const result = await service.duplicatePeriodSlots(adminUser, {
        sourceIds: ['s1'],
        targetDays: [DayOfWeek.MONDAY, DayOfWeek.TUESDAY, DayOfWeek.WEDNESDAY],
      });

      expect(create).toHaveBeenCalledTimes(2);
      expect(create).toHaveBeenCalledWith(adminUser, {
        classId: 'class-1',
        sectionId: 'section-1',
        subjectId: 'subject-1',
        staffProfileId: 'teacher-1',
        name: 'Period 1',
        periodNumber: 1,
        dayOfWeek: DayOfWeek.TUESDAY,
        startTime: '08:00',
        endTime: '08:40',
        room: 'Lab 1',
        customFields: { note: 'x' },
      });
      expect(result.data).toEqual({ created: 2, skipped: [] });
      expect(result.message).toBe('2 period slots copied.');
    });

    it('skips a copy that is refused and reports why, still making the rest', async () => {
      prismaMock.periodSlot.findMany.mockResolvedValueOnce([source('s1')]);
      jest
        .spyOn(service, 'createPeriodSlot')
        .mockRejectedValueOnce(
          new ConflictException('Tuesday already has a period 1.'),
        )
        .mockResolvedValueOnce({} as never);

      const result = await service.duplicatePeriodSlots(adminUser, {
        sourceIds: ['s1'],
        targetDays: [DayOfWeek.TUESDAY, DayOfWeek.WEDNESDAY],
      });

      expect(result.data.created).toBe(1);
      expect(result.data.skipped).toEqual([
        {
          sourceId: 's1',
          name: 'Period 1',
          dayOfWeek: DayOfWeek.TUESDAY,
          reason: 'Tuesday already has a period 1.',
        },
      ]);
      expect(result.message).toBe('1 copied, 1 skipped.');
    });

    it('does not hide a server error as a skipped copy', async () => {
      prismaMock.periodSlot.findMany.mockResolvedValueOnce([source('s1')]);
      jest
        .spyOn(service, 'createPeriodSlot')
        .mockRejectedValue(new Error('database down'));

      await expect(
        service.duplicatePeriodSlots(adminUser, {
          sourceIds: ['s1'],
          targetDays: [DayOfWeek.TUESDAY],
        }),
      ).rejects.toThrow('database down');
    });

    it('checks the campus of every period and says when none exist', async () => {
      prismaMock.periodSlot.findMany.mockResolvedValueOnce([]);
      await expect(
        service.duplicatePeriodSlots(adminUser, {
          sourceIds: ['missing'],
          targetDays: [DayOfWeek.TUESDAY],
        }),
      ).rejects.toBeInstanceOf(NotFoundException);

      prismaMock.periodSlot.findMany.mockResolvedValueOnce([
        source('s1'),
        source('s2', { campusId: 'campus-2' }),
      ]);
      jest.spyOn(service, 'createPeriodSlot').mockResolvedValue({} as never);
      await service.duplicatePeriodSlots(adminUser, {
        sourceIds: ['s1', 's2'],
        targetDays: [DayOfWeek.TUESDAY],
      });
      expect(campusAccessServiceMock.assertCampusAccess).toHaveBeenCalledWith(
        adminUser,
        'campus-1',
      );
      expect(campusAccessServiceMock.assertCampusAccess).toHaveBeenCalledWith(
        adminUser,
        'campus-2',
      );
    });
  });
});
