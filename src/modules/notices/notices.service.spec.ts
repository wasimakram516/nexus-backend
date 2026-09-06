import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { UserRole } from '../../prisma/client';
import { AuditLogService } from '../../common/services/audit-log.service';
import { CampusAccessService } from '../../common/services/campus-access.service';
import { ModuleAccessService } from '../../common/services/module-access.service';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { PrismaService } from '../../prisma/prisma.service';
import { NoticesService } from './notices.service';

/**
 * Minimal structural evaluator for the Prisma `WHERE` shapes this service
 * builds (`eq`, `{ in }`, `{ lte }`, `{ gte }`, `null`, and `AND`/`OR`
 * nesting only — the exact vocabulary `listNoticesForMe` and `listNotices`
 * use). Lets the audience-resolution matrix assert real boolean visibility
 * outcomes against candidate Notice rows without needing a live database,
 * the same way the rest of this codebase's specs assert against captured
 * mock-call arguments rather than a real Postgres instance.
 */
function matchesWhere(
  where: Record<string, unknown>,
  candidate: Record<string, unknown>,
): boolean {
  return Object.entries(where).every(([key, condition]) => {
    if (key === 'AND') {
      return (condition as Record<string, unknown>[]).every((sub) =>
        matchesWhere(sub, candidate),
      );
    }
    if (key === 'OR') {
      return (condition as Record<string, unknown>[]).some((sub) =>
        matchesWhere(sub, candidate),
      );
    }
    if (key === 'deletedAt') {
      return true;
    }

    const value = candidate[key];
    if (condition === null) {
      return value === null || value === undefined;
    }
    if (typeof condition === 'object') {
      const cond = condition as {
        in?: unknown[];
        lte?: Date;
        gte?: Date;
      };
      if (cond.in) return cond.in.includes(value);
      if (cond.lte) return (value as Date).getTime() <= cond.lte.getTime();
      if (cond.gte) return (value as Date).getTime() >= cond.gte.getTime();
    }
    return value === condition;
  });
}

describe('NoticesService', () => {
  let service: NoticesService;

  const prismaMock = {
    notice: {
      create: jest.fn<Promise<unknown>, [{ data: Record<string, unknown> }]>(),
      findMany: jest.fn<
        Promise<unknown>,
        [{ where: Record<string, unknown> }]
      >(),
      count: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    academicClass: { findUnique: jest.fn() },
    section: { findUnique: jest.fn() },
    student: { findFirst: jest.fn() },
    guardian: { findFirst: jest.fn() },
    studentGuardian: { findMany: jest.fn() },
    institution: { findUnique: jest.fn() },
    studentEnrollment: {
      findMany: jest.fn<
        Promise<unknown>,
        [{ where: Record<string, unknown> }]
      >(),
    },
    $transaction: jest.fn(),
  };

  const campusAccessServiceMock = {
    assertCampusAccess: jest.fn(),
    getCampusIdsForUser: jest.fn(),
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

  const staffUser: CurrentUser = {
    sub: 'staff-1',
    email: 'staff@nexus.test',
    role: UserRole.STAFF,
    institutionId: 'institution-1',
  };

  const studentUser: CurrentUser = {
    sub: 'student-user-1',
    email: 'student@nexus.test',
    role: UserRole.STUDENT,
    institutionId: 'institution-1',
  };

  const guardianUser: CurrentUser = {
    sub: 'guardian-user-1',
    email: 'guardian@nexus.test',
    role: UserRole.GUARDIAN,
    institutionId: 'institution-1',
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    campusAccessServiceMock.getCampusIdsForUser.mockResolvedValue(['campus-1']);
    campusAccessServiceMock.assertCampusAccess.mockResolvedValue(undefined);
    prismaMock.institution.findUnique.mockResolvedValue({
      id: 'institution-1',
    });

    const moduleRef = await Test.createTestingModule({
      providers: [
        NoticesService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: AuditLogService, useValue: auditLogServiceMock },
        { provide: CampusAccessService, useValue: campusAccessServiceMock },
        { provide: ModuleAccessService, useValue: moduleAccessServiceMock },
      ],
    }).compile();

    service = moduleRef.get(NoticesService);
  });

  describe('hierarchy validation (create)', () => {
    it('creates a notice when campus/class/section form a consistent hierarchy', async () => {
      prismaMock.academicClass.findUnique.mockResolvedValue({
        level: { campusId: 'campus-1' },
      });
      prismaMock.section.findUnique.mockResolvedValue({
        classId: 'class-1',
        class: { level: { campusId: 'campus-1' } },
      });
      prismaMock.notice.create.mockResolvedValue({
        id: 'notice-1',
        title: 'Sports Day',
      });

      await expect(
        service.createNotice('institution-1', adminUser, {
          campusId: 'campus-1',
          classId: 'class-1',
          sectionId: 'section-1',
          title: 'Sports Day',
          body: 'Details',
        }),
      ).resolves.toMatchObject({
        message: 'Notice created successfully',
        data: { id: 'notice-1' },
      });
      expect(prismaMock.notice.create).toHaveBeenCalledWith(
        expect.objectContaining({
          /* eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- expect.objectContaining() is intentionally typed `any` by @types/jest */
          data: expect.objectContaining({
            institutionId: 'institution-1',
            campusId: 'campus-1',
            classId: 'class-1',
            sectionId: 'section-1',
          }),
        }),
      );
    });

    it('passes attachments through to Prisma as JSON', async () => {
      prismaMock.notice.create.mockResolvedValue({ id: 'notice-1' });

      await service.createNotice('institution-1', adminUser, {
        title: 'Fee circular',
        body: 'Details',
        attachments: [
          {
            url: 'https://cdn.example.com/f.pdf',
            publicId: 'nexus/f',
            resourceType: 'raw',
            format: 'pdf',
            folder: 'Nexus/documents',
            bytes: 1024,
          },
        ],
      });

      expect(prismaMock.notice.create).toHaveBeenCalledWith(
        expect.objectContaining({
          /* eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- expect.objectContaining() is intentionally typed `any` by @types/jest */
          data: expect.objectContaining({
            attachments: [
              expect.objectContaining({ publicId: 'nexus/f', bytes: 1024 }),
            ],
          }),
        }),
      );
    });

    it('rejects when classId does not belong to the given campusId', async () => {
      prismaMock.academicClass.findUnique.mockResolvedValue({
        level: { campusId: 'campus-2' },
      });

      await expect(
        service.createNotice('institution-1', adminUser, {
          campusId: 'campus-1',
          classId: 'class-1',
          title: 'Notice',
          body: 'Body',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaMock.notice.create).not.toHaveBeenCalled();
    });

    it('rejects when sectionId does not belong to the given classId', async () => {
      prismaMock.academicClass.findUnique.mockResolvedValue({
        level: { campusId: 'campus-1' },
      });
      prismaMock.section.findUnique.mockResolvedValue({
        classId: 'class-2',
        class: { level: { campusId: 'campus-1' } },
      });

      await expect(
        service.createNotice('institution-1', adminUser, {
          campusId: 'campus-1',
          classId: 'class-1',
          sectionId: 'section-1',
          title: 'Notice',
          body: 'Body',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects when sectionId belongs to a different campus than campusId', async () => {
      prismaMock.section.findUnique.mockResolvedValue({
        classId: 'class-1',
        class: { level: { campusId: 'campus-2' } },
      });

      await expect(
        service.createNotice('institution-1', adminUser, {
          campusId: 'campus-1',
          sectionId: 'section-1',
          title: 'Notice',
          body: 'Body',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws NotFoundException when classId does not exist', async () => {
      prismaMock.academicClass.findUnique.mockResolvedValue(null);

      await expect(
        service.createNotice('institution-1', adminUser, {
          classId: 'missing-class',
          title: 'Notice',
          body: 'Body',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws NotFoundException when institutionId does not resolve to a real institution (superadmin platform-mirror path)', async () => {
      prismaMock.institution.findUnique.mockResolvedValueOnce(null);

      await expect(
        service.createNotice('institution-missing', adminUser, {
          title: 'Notice',
          body: 'Body',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prismaMock.notice.create).not.toHaveBeenCalled();
    });
  });

  describe('hierarchy validation (update)', () => {
    it('re-validates against the merged existing + patch scope', async () => {
      prismaMock.notice.findFirst.mockResolvedValue({
        id: 'notice-1',
        campusId: 'campus-1',
        classId: 'class-1',
        sectionId: null,
        title: 'Old title',
      });
      prismaMock.academicClass.findUnique.mockResolvedValue({
        level: { campusId: 'campus-1' },
      });
      // Patch tries to attach a section that belongs to a different class
      // than the notice's existing classId.
      prismaMock.section.findUnique.mockResolvedValue({
        classId: 'class-2',
        class: { level: { campusId: 'campus-1' } },
      });

      await expect(
        service.updateNotice('institution-1', adminUser, 'notice-1', {
          sectionId: 'section-1',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaMock.notice.update).not.toHaveBeenCalled();
    });

    it('allows a hierarchy-consistent patch', async () => {
      prismaMock.notice.findFirst.mockResolvedValue({
        id: 'notice-1',
        campusId: 'campus-1',
        classId: 'class-1',
        sectionId: null,
        title: 'Old title',
      });
      prismaMock.academicClass.findUnique.mockResolvedValue({
        level: { campusId: 'campus-1' },
      });
      prismaMock.section.findUnique.mockResolvedValue({
        classId: 'class-1',
        class: { level: { campusId: 'campus-1' } },
      });
      prismaMock.notice.update.mockResolvedValue({
        id: 'notice-1',
        title: 'Old title',
        sectionId: 'section-1',
      });

      await expect(
        service.updateNotice('institution-1', adminUser, 'notice-1', {
          sectionId: 'section-1',
        }),
      ).resolves.toMatchObject({ message: 'Notice updated successfully' });
    });

    it('re-checks campus access when the patch moves the notice to a new campus', async () => {
      prismaMock.notice.findFirst.mockResolvedValue({
        id: 'notice-1',
        campusId: 'campus-1',
        classId: null,
        sectionId: null,
        title: 'Old title',
      });
      prismaMock.notice.update.mockResolvedValue({
        id: 'notice-1',
        campusId: 'campus-2',
      });

      await expect(
        service.updateNotice('institution-1', adminUser, 'notice-1', {
          campusId: 'campus-2',
        }),
      ).resolves.toMatchObject({ message: 'Notice updated successfully' });
      expect(campusAccessServiceMock.assertCampusAccess).toHaveBeenCalledWith(
        adminUser,
        'campus-2',
      );
    });

    it('throws NotFoundException when sectionId does not exist', async () => {
      prismaMock.notice.findFirst.mockResolvedValue({
        id: 'notice-1',
        campusId: 'campus-1',
        classId: null,
        sectionId: null,
        title: 'Old title',
      });
      prismaMock.section.findUnique.mockResolvedValue(null);

      await expect(
        service.updateNotice('institution-1', adminUser, 'notice-1', {
          sectionId: 'missing-section',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('getNotice / deleteNotice access scoping', () => {
    it('throws NotFoundException outside the caller institution', async () => {
      prismaMock.notice.findFirst.mockResolvedValue(null);

      await expect(
        service.getNotice('institution-1', adminUser, 'notice-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns an institution-wide notice without a campus-access check', async () => {
      prismaMock.notice.findFirst.mockResolvedValue({
        id: 'notice-1',
        campusId: null,
        title: 'All-institution notice',
      });

      await expect(
        service.getNotice('institution-1', adminUser, 'notice-1'),
      ).resolves.toEqual({
        message: 'Notice retrieved successfully',
        data: {
          id: 'notice-1',
          campusId: null,
          title: 'All-institution notice',
        },
      });
      expect(campusAccessServiceMock.assertCampusAccess).not.toHaveBeenCalled();
    });

    it('denies access to a notice scoped to a campus the caller cannot access', async () => {
      prismaMock.notice.findFirst.mockResolvedValue({
        id: 'notice-1',
        campusId: 'campus-9',
      });
      campusAccessServiceMock.assertCampusAccess.mockRejectedValueOnce(
        new ForbiddenException('You do not have access to this campus.'),
      );

      await expect(
        service.deleteNotice('institution-1', staffUser, 'notice-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prismaMock.notice.update).not.toHaveBeenCalled();
    });

    it('soft-deletes a notice and records an audit log', async () => {
      prismaMock.notice.findFirst.mockResolvedValue({
        id: 'notice-1',
        campusId: 'campus-1',
        title: 'Sports Day',
      });
      prismaMock.notice.update.mockResolvedValue({ id: 'notice-1' });

      await expect(
        service.deleteNotice(
          'institution-1',
          adminUser,
          'notice-1',
          'no longer relevant',
        ),
      ).resolves.toEqual({
        message: 'Notice moved to recycle bin successfully',
        data: { id: 'notice-1' },
      });
      expect(prismaMock.notice.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'notice-1' },
          /* eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- expect.objectContaining() is intentionally typed `any` by @types/jest */
          data: expect.objectContaining({
            deletedBy: adminUser.sub,
            deleteReason: 'no longer relevant',
          }),
        }),
      );
      expect(auditLogServiceMock.log).toHaveBeenCalledWith(
        adminUser,
        expect.objectContaining({ action: 'NOTICE_DELETED' }),
      );
    });
  });

  describe('listNoticesForMe — publish window + audience resolution matrix', () => {
    const now = new Date('2026-09-05T12:00:00Z');
    const hourMs = 60 * 60 * 1000;

    beforeEach(() => {
      jest.useFakeTimers().setSystemTime(now);
      prismaMock.$transaction.mockResolvedValue([[], 0]);
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    async function captureWhere(user: CurrentUser) {
      await service.listNoticesForMe(user, {});
      return prismaMock.notice.findMany.mock.calls.at(-1)![0].where;
    }

    it('returns an empty page without querying when the caller has no institution', async () => {
      const superadmin: CurrentUser = {
        sub: 'root-1',
        email: 'root@nexus.test',
        role: UserRole.SUPERADMIN,
        institutionId: null,
      };

      await expect(service.listNoticesForMe(superadmin, {})).resolves.toEqual({
        message: 'Notices retrieved successfully',
        data: { items: [], total: 0, page: 1, limit: 10 },
      });
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it('paginates using page/limit from the query', async () => {
      prismaMock.$transaction.mockResolvedValue([[{ id: 'notice-1' }], 1]);

      const result = await service.listNoticesForMe(adminUser, {
        page: 2,
        limit: 5,
      });

      expect(prismaMock.notice.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 5, take: 5 }),
      );
      expect(result).toEqual({
        message: 'Notices retrieved successfully',
        data: { items: [{ id: 'notice-1' }], total: 1, page: 2, limit: 5 },
      });
    });

    it.each([
      [
        'before the window opens',
        new Date(now.getTime() + hourMs),
        null,
        false,
      ],
      ['during the window', new Date(now.getTime() - hourMs), null, true],
      [
        'after the window closes',
        new Date(now.getTime() - 2 * hourMs),
        new Date(now.getTime() - hourMs),
        false,
      ],
      [
        'before expiry',
        new Date(now.getTime() - hourMs),
        new Date(now.getTime() + hourMs),
        true,
      ],
    ])(
      'publish window — %s',
      async (_label, publishAt, expiresAt, expected) => {
        campusAccessServiceMock.getCampusIdsForUser.mockResolvedValue([]);
        const where = await captureWhere(adminUser);

        const candidate = {
          institutionId: 'institution-1',
          campusId: null,
          classId: null,
          sectionId: null,
          targetRole: null,
          publishAt,
          expiresAt,
        };

        expect(matchesWhere(where, candidate)).toBe(expected);
      },
    );

    it.each([
      ['ADMIN', adminUser],
      ['STAFF', staffUser],
    ] as const)(
      '%s: institution-wide notice always matches',
      async (_label, user) => {
        const where = await captureWhere(user);
        expect(
          matchesWhere(where, {
            institutionId: 'institution-1',
            campusId: null,
            classId: null,
            sectionId: null,
            targetRole: null,
            publishAt: new Date(now.getTime() - hourMs),
            expiresAt: null,
          }),
        ).toBe(true);
      },
    );

    it.each([
      ['ADMIN', adminUser],
      ['STAFF', staffUser],
    ] as const)(
      '%s: never matches a class/section-scoped notice (no personal enrollment)',
      async (_label, user) => {
        const where = await captureWhere(user);
        expect(
          matchesWhere(where, {
            institutionId: 'institution-1',
            campusId: 'campus-1',
            classId: 'class-1',
            sectionId: 'section-1',
            targetRole: null,
            publishAt: new Date(now.getTime() - hourMs),
            expiresAt: null,
          }),
        ).toBe(false);
      },
    );

    it('ADMIN/STAFF: campus-only notice matches when the campus is in their access set, not otherwise', async () => {
      campusAccessServiceMock.getCampusIdsForUser.mockResolvedValue([
        'campus-1',
      ]);
      const where = await captureWhere(staffUser);

      const inCampus = {
        institutionId: 'institution-1',
        campusId: 'campus-1',
        classId: null,
        sectionId: null,
        targetRole: null,
        publishAt: new Date(now.getTime() - hourMs),
        expiresAt: null,
      };
      const outOfCampus = { ...inCampus, campusId: 'campus-2' };

      expect(matchesWhere(where, inCampus)).toBe(true);
      expect(matchesWhere(where, outOfCampus)).toBe(false);
    });

    it('role-only notice matches STAFF but not STUDENT when targetRole is STAFF', async () => {
      const staffWhere = await captureWhere(staffUser);
      const studentWhere = await captureWhere(studentUser);

      const roleScopedNotice = {
        institutionId: 'institution-1',
        campusId: null,
        classId: null,
        sectionId: null,
        targetRole: UserRole.STAFF,
        publishAt: new Date(now.getTime() - hourMs),
        expiresAt: null,
      };

      expect(matchesWhere(staffWhere, roleScopedNotice)).toBe(true);
      expect(matchesWhere(studentWhere, roleScopedNotice)).toBe(false);
    });

    it('STUDENT: matches a notice scoped to their own current class+section, not a different one', async () => {
      prismaMock.student.findFirst.mockResolvedValue({
        id: 'student-1',
        institutionId: 'institution-1',
      });
      prismaMock.institution.findUnique.mockResolvedValue({
        currentAcademicYearId: 'year-1',
      });
      prismaMock.studentEnrollment.findMany.mockResolvedValue([
        { classId: 'class-1', sectionId: 'section-1' },
      ]);

      const where = await captureWhere(studentUser);

      expect(prismaMock.studentEnrollment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          /* eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- expect.objectContaining() is intentionally typed `any` by @types/jest */
          where: expect.objectContaining({
            studentId: { in: ['student-1'] },
            academicYearId: 'year-1',
            status: { not: 'LEFT' },
          }),
        }),
      );

      const ownClassSection = {
        institutionId: 'institution-1',
        campusId: null,
        classId: 'class-1',
        sectionId: 'section-1',
        targetRole: null,
        publishAt: new Date(now.getTime() - hourMs),
        expiresAt: null,
      };
      const otherSection = { ...ownClassSection, sectionId: 'section-9' };
      const classWideNotice = { ...ownClassSection, sectionId: null };

      expect(matchesWhere(where, ownClassSection)).toBe(true);
      expect(matchesWhere(where, otherSection)).toBe(false);
      expect(matchesWhere(where, classWideNotice)).toBe(true);
    });

    it('STUDENT: has no class/section tuple (and therefore no class-scoped visibility) with no current academic year', async () => {
      prismaMock.student.findFirst.mockResolvedValue({
        id: 'student-1',
        institutionId: 'institution-1',
      });
      prismaMock.institution.findUnique.mockResolvedValue({
        currentAcademicYearId: null,
      });

      const where = await captureWhere(studentUser);

      expect(
        matchesWhere(where, {
          institutionId: 'institution-1',
          campusId: null,
          classId: 'class-1',
          sectionId: null,
          targetRole: null,
          publishAt: new Date(now.getTime() - hourMs),
          expiresAt: null,
        }),
      ).toBe(false);
    });

    it('GUARDIAN: matches a notice scoped to any one of multiple wards in different classes', async () => {
      prismaMock.guardian.findFirst.mockResolvedValue({ id: 'guardian-1' });
      prismaMock.studentGuardian.findMany.mockResolvedValue([
        { student: { id: 'ward-1', institutionId: 'institution-1' } },
        { student: { id: 'ward-2', institutionId: 'institution-1' } },
      ]);
      prismaMock.institution.findUnique.mockResolvedValue({
        currentAcademicYearId: 'year-1',
      });
      prismaMock.studentEnrollment.findMany.mockResolvedValue([
        { classId: 'class-1', sectionId: 'section-1' },
        { classId: 'class-2', sectionId: 'section-2' },
      ]);

      const where = await captureWhere(guardianUser);

      expect(
        matchesWhere(where, {
          institutionId: 'institution-1',
          campusId: null,
          classId: 'class-2',
          sectionId: 'section-2',
          targetRole: null,
          publishAt: new Date(now.getTime() - hourMs),
          expiresAt: null,
        }),
      ).toBe(true);
      expect(
        matchesWhere(where, {
          institutionId: 'institution-1',
          campusId: null,
          classId: 'class-3',
          sectionId: 'section-3',
          targetRole: null,
          publishAt: new Date(now.getTime() - hourMs),
          expiresAt: null,
        }),
      ).toBe(false);
    });

    it('GUARDIAN: no guardian record for this user resolves to no class-scoped visibility', async () => {
      prismaMock.guardian.findFirst.mockResolvedValue(null);

      const where = await captureWhere(guardianUser);

      expect(
        matchesWhere(where, {
          institutionId: 'institution-1',
          campusId: null,
          classId: 'class-1',
          sectionId: null,
          targetRole: null,
          publishAt: new Date(now.getTime() - hourMs),
          expiresAt: null,
        }),
      ).toBe(false);
      expect(prismaMock.studentGuardian.findMany).not.toHaveBeenCalled();
    });

    it('GUARDIAN: no wards resolves to no class-scoped visibility, without throwing', async () => {
      prismaMock.guardian.findFirst.mockResolvedValue({ id: 'guardian-1' });
      prismaMock.studentGuardian.findMany.mockResolvedValue([]);

      const where = await captureWhere(guardianUser);

      expect(
        matchesWhere(where, {
          institutionId: 'institution-1',
          campusId: null,
          classId: 'class-1',
          sectionId: null,
          targetRole: null,
          publishAt: new Date(now.getTime() - hourMs),
          expiresAt: null,
        }),
      ).toBe(false);
    });

    it('combination: campus + role scoped notice requires both to match', async () => {
      campusAccessServiceMock.getCampusIdsForUser.mockResolvedValue([
        'campus-1',
      ]);
      const where = await captureWhere(staffUser);

      const matching = {
        institutionId: 'institution-1',
        campusId: 'campus-1',
        classId: null,
        sectionId: null,
        targetRole: UserRole.STAFF,
        publishAt: new Date(now.getTime() - hourMs),
        expiresAt: null,
      };
      const wrongCampus = { ...matching, campusId: 'campus-2' };
      const wrongRole = { ...matching, targetRole: UserRole.STUDENT };

      expect(matchesWhere(where, matching)).toBe(true);
      expect(matchesWhere(where, wrongCampus)).toBe(false);
      expect(matchesWhere(where, wrongRole)).toBe(false);
    });
  });

  describe('listNotices (admin management list)', () => {
    it('scopes to accessible campuses plus institution-wide notices when no campusId filter is given', async () => {
      campusAccessServiceMock.getCampusIdsForUser.mockResolvedValue([
        'campus-1',
        'campus-2',
      ]);
      prismaMock.notice.findMany.mockResolvedValue([]);

      await service.listNotices('institution-1', staffUser, {});

      const where = prismaMock.notice.findMany.mock.calls[0][0].where;
      expect(where.OR).toEqual([
        { campusId: null },
        { campusId: { in: ['campus-1', 'campus-2'] } },
      ]);
    });

    it('asserts campus access and narrows to just that campus when campusId is given', async () => {
      prismaMock.notice.findMany.mockResolvedValue([]);

      await service.listNotices('institution-1', adminUser, {
        campusId: 'campus-1',
      });

      expect(campusAccessServiceMock.assertCampusAccess).toHaveBeenCalledWith(
        adminUser,
        'campus-1',
      );
      const where = prismaMock.notice.findMany.mock.calls[0][0].where;
      expect(where.OR).toEqual([
        { campusId: null },
        { campusId: { in: ['campus-1'] } },
      ]);
    });
  });
});
