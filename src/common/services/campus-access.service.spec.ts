import { ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { UserRole } from '../../prisma/client';
import { CurrentUser } from '../interfaces/current-user.interface';
import { PrismaService } from '../../prisma/prisma.service';
import { CampusAccessService } from './campus-access.service';

describe('CampusAccessService', () => {
  let service: CampusAccessService;

  const prismaMock = {
    campus: {
      findMany: jest.fn(),
    },
    userCampus: {
      findMany: jest.fn(),
    },
    student: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
    },
    guardian: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
    },
    staffProfile: {
      findUnique: jest.fn(),
    },
    level: {
      findUnique: jest.fn(),
    },
    academicClass: {
      findUnique: jest.fn(),
    },
    section: {
      findUnique: jest.fn(),
    },
    subject: {
      findUnique: jest.fn(),
    },
    studentEnrollment: {
      findUnique: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const moduleRef = await Test.createTestingModule({
      providers: [
        CampusAccessService,
        {
          provide: PrismaService,
          useValue: prismaMock,
        },
      ],
    }).compile();

    service = moduleRef.get<CampusAccessService>(CampusAccessService);
  });

  describe('getCampusIdsForUser', () => {
    it('returns every non-deleted campus for SUPERADMIN', async () => {
      prismaMock.campus.findMany.mockResolvedValue([
        { id: 'campus-1' },
        { id: 'campus-2' },
      ]);

      const user: CurrentUser = {
        sub: 'superadmin-1',
        email: 'super@nexus.test',
        role: UserRole.SUPERADMIN,
        institutionId: null,
      };

      const result = await service.getCampusIdsForUser(user);

      expect(prismaMock.campus.findMany).toHaveBeenCalledWith({
        where: { deletedAt: null },
        select: { id: true },
      });
      expect(result).toEqual(['campus-1', 'campus-2']);
    });

    it('scopes ADMIN to campuses within their institution', async () => {
      prismaMock.campus.findMany.mockResolvedValue([{ id: 'campus-1' }]);

      const user: CurrentUser = {
        sub: 'admin-1',
        email: 'admin@nexus.test',
        role: UserRole.ADMIN,
        institutionId: 'institution-1',
      };

      const result = await service.getCampusIdsForUser(user);

      expect(prismaMock.campus.findMany).toHaveBeenCalledWith({
        where: { institutionId: 'institution-1', deletedAt: null },
        select: { id: true },
      });
      expect(result).toEqual(['campus-1']);
    });

    // This is the § 7.6 behavior change: once every employee (teaching AND
    // non-teaching, including campus admins per decision #20) has a
    // StaffProfile row, resolving STAFF by "check the profile first" would
    // silently pin a multi-campus campus-admin to just their profile's one
    // home campus. The fix drops that branch entirely and resolves STAFF
    // purely from UserCampus, matching the ADMIN branch above.
    it('returns every UserCampus-assigned campus for a multi-campus STAFF user (e.g. a campus admin), not just one', async () => {
      prismaMock.userCampus.findMany.mockResolvedValue([
        { campusId: 'campus-1' },
        { campusId: 'campus-2' },
        { campusId: 'campus-3' },
      ]);

      const campusAdmin: CurrentUser = {
        sub: 'staff-user-1',
        email: 'campus-admin@nexus.test',
        role: UserRole.STAFF,
        institutionId: 'institution-1',
      };

      const result = await service.getCampusIdsForUser(campusAdmin);

      expect(prismaMock.userCampus.findMany).toHaveBeenCalledWith({
        where: {
          userId: 'staff-user-1',
          campus: { deletedAt: null },
        },
        select: { campusId: true },
      });
      expect(result).toEqual(['campus-1', 'campus-2', 'campus-3']);
      // prismaMock deliberately has no `teacher` delegate — the old
      // "check the profile first" branch would throw here if it still ran.
    });

    it('still resolves a single-campus teaching STAFF user to exactly their one home campus via the synced UserCampus row', async () => {
      prismaMock.userCampus.findMany.mockResolvedValue([
        { campusId: 'campus-1' },
      ]);

      const teacher: CurrentUser = {
        sub: 'staff-user-2',
        email: 'teacher@nexus.test',
        role: UserRole.STAFF,
        institutionId: 'institution-1',
      };

      const result = await service.getCampusIdsForUser(teacher);

      expect(result).toEqual(['campus-1']);
    });

    it('returns an empty list for a STAFF user with no UserCampus assignments', async () => {
      prismaMock.userCampus.findMany.mockResolvedValue([]);

      const orphanStaff: CurrentUser = {
        sub: 'staff-user-3',
        email: 'orphan@nexus.test',
        role: UserRole.STAFF,
        institutionId: 'institution-1',
      };

      const result = await service.getCampusIdsForUser(orphanStaff);

      expect(result).toEqual([]);
    });

    it('resolves STUDENT to their own campus', async () => {
      prismaMock.student.findFirst.mockResolvedValue({ campusId: 'campus-1' });

      const student: CurrentUser = {
        sub: 'student-user-1',
        email: 'student@nexus.test',
        role: UserRole.STUDENT,
        institutionId: 'institution-1',
      };

      const result = await service.getCampusIdsForUser(student);

      expect(result).toEqual(['campus-1']);
    });

    it('returns an empty list when a STUDENT has no matching student record', async () => {
      prismaMock.student.findFirst.mockResolvedValue(null);

      const student: CurrentUser = {
        sub: 'student-user-2',
        email: 'orphan-student@nexus.test',
        role: UserRole.STUDENT,
        institutionId: 'institution-1',
      };

      const result = await service.getCampusIdsForUser(student);

      expect(result).toEqual([]);
    });

    it('resolves GUARDIAN to their own campus', async () => {
      prismaMock.guardian.findFirst.mockResolvedValue({
        campusId: 'campus-1',
      });

      const guardian: CurrentUser = {
        sub: 'guardian-user-1',
        email: 'guardian@nexus.test',
        role: UserRole.GUARDIAN,
        institutionId: 'institution-1',
      };

      const result = await service.getCampusIdsForUser(guardian);

      expect(result).toEqual(['campus-1']);
    });

    it('returns an empty list when a GUARDIAN has no matching guardian record', async () => {
      prismaMock.guardian.findFirst.mockResolvedValue(null);

      const guardian: CurrentUser = {
        sub: 'guardian-user-2',
        email: 'orphan-guardian@nexus.test',
        role: UserRole.GUARDIAN,
        institutionId: 'institution-1',
      };

      const result = await service.getCampusIdsForUser(guardian);

      expect(result).toEqual([]);
    });

    it('resolves ADMIN with no institutionId via UserCampus instead of the institution-scoped branch', async () => {
      prismaMock.userCampus.findMany.mockResolvedValue([
        { campusId: 'campus-5' },
      ]);

      const admin: CurrentUser = {
        sub: 'admin-2',
        email: 'admin-no-institution@nexus.test',
        role: UserRole.ADMIN,
        institutionId: null,
      };

      const result = await service.getCampusIdsForUser(admin);

      expect(prismaMock.userCampus.findMany).toHaveBeenCalledWith({
        where: { userId: 'admin-2', campus: { deletedAt: null } },
        select: { campusId: true },
      });
      expect(result).toEqual(['campus-5']);
    });

    it('returns an empty list for a role with no matching branch', async () => {
      const unknown: CurrentUser = {
        sub: 'unknown-1',
        email: 'unknown@nexus.test',
        role: 'SOMETHING_ELSE' as UserRole,
        institutionId: null,
      };

      const result = await service.getCampusIdsForUser(unknown);

      expect(result).toEqual([]);
    });
  });

  describe('assertCampusAccess', () => {
    it('rejects access to a campus outside the resolved scope', async () => {
      prismaMock.userCampus.findMany.mockResolvedValue([
        { campusId: 'campus-1' },
      ]);

      const user: CurrentUser = {
        sub: 'staff-user-1',
        email: 'staff@nexus.test',
        role: UserRole.STAFF,
        institutionId: 'institution-1',
      };

      await expect(
        service.assertCampusAccess(user, 'campus-9'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('returns the campusId when it is within the resolved scope', async () => {
      prismaMock.userCampus.findMany.mockResolvedValue([
        { campusId: 'campus-1' },
      ]);

      const user: CurrentUser = {
        sub: 'staff-user-1',
        email: 'staff@nexus.test',
        role: UserRole.STAFF,
        institutionId: 'institution-1',
      };

      await expect(service.assertCampusAccess(user, 'campus-1')).resolves.toBe(
        'campus-1',
      );
    });
  });

  describe('getScopedCampusIds', () => {
    const user: CurrentUser = {
      sub: 'staff-user-1',
      email: 'staff@nexus.test',
      role: UserRole.STAFF,
      institutionId: 'institution-1',
    };

    it('returns just the requested campus once access is confirmed', async () => {
      prismaMock.userCampus.findMany.mockResolvedValue([
        { campusId: 'campus-1' },
      ]);

      const result = await service.getScopedCampusIds(user, 'campus-1');

      expect(result).toEqual(['campus-1']);
    });

    it('rejects when the requested campus is outside scope', async () => {
      prismaMock.userCampus.findMany.mockResolvedValue([
        { campusId: 'campus-1' },
      ]);

      await expect(
        service.getScopedCampusIds(user, 'campus-9'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('falls back to the full resolved scope when no campus is requested', async () => {
      prismaMock.userCampus.findMany.mockResolvedValue([
        { campusId: 'campus-1' },
        { campusId: 'campus-2' },
      ]);

      const result = await service.getScopedCampusIds(user);

      expect(result).toEqual(['campus-1', 'campus-2']);
    });
  });

  describe('assertLevelAccess', () => {
    const user: CurrentUser = {
      sub: 'admin-1',
      email: 'admin@nexus.test',
      role: UserRole.ADMIN,
      institutionId: 'institution-1',
    };

    it('rejects when the level does not exist', async () => {
      prismaMock.level.findUnique.mockResolvedValue(null);

      await expect(
        service.assertLevelAccess(user, 'missing-level'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('resolves the level campus and checks access', async () => {
      prismaMock.level.findUnique.mockResolvedValue({ campusId: 'campus-1' });
      prismaMock.campus.findMany.mockResolvedValue([{ id: 'campus-1' }]);

      const result = await service.assertLevelAccess(user, 'level-1');

      expect(result).toBe('campus-1');
    });
  });

  describe('assertClassAccess', () => {
    const user: CurrentUser = {
      sub: 'admin-1',
      email: 'admin@nexus.test',
      role: UserRole.ADMIN,
      institutionId: 'institution-1',
    };

    it('rejects when the class (or its level) does not exist', async () => {
      prismaMock.academicClass.findUnique.mockResolvedValue(null);

      await expect(
        service.assertClassAccess(user, 'missing-class'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('resolves the class campus through level and checks access', async () => {
      prismaMock.academicClass.findUnique.mockResolvedValue({
        level: { campusId: 'campus-1' },
      });
      prismaMock.campus.findMany.mockResolvedValue([{ id: 'campus-1' }]);

      const result = await service.assertClassAccess(user, 'class-1');

      expect(result).toBe('campus-1');
    });
  });

  describe('assertSectionAccess', () => {
    const user: CurrentUser = {
      sub: 'admin-1',
      email: 'admin@nexus.test',
      role: UserRole.ADMIN,
      institutionId: 'institution-1',
    };

    it('rejects when the section (or its class/level) does not exist', async () => {
      prismaMock.section.findUnique.mockResolvedValue(null);

      await expect(
        service.assertSectionAccess(user, 'missing-section'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('resolves the section campus through class/level and checks access', async () => {
      prismaMock.section.findUnique.mockResolvedValue({
        class: { level: { campusId: 'campus-1' } },
      });
      prismaMock.campus.findMany.mockResolvedValue([{ id: 'campus-1' }]);

      const result = await service.assertSectionAccess(user, 'section-1');

      expect(result).toBe('campus-1');
    });
  });

  describe('assertSubjectAccess', () => {
    const user: CurrentUser = {
      sub: 'admin-1',
      email: 'admin@nexus.test',
      role: UserRole.ADMIN,
      institutionId: 'institution-1',
    };

    it('rejects when the subject (or its class/level) does not exist', async () => {
      prismaMock.subject.findUnique.mockResolvedValue(null);

      await expect(
        service.assertSubjectAccess(user, 'missing-subject'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('resolves the subject campus through class/level and checks access', async () => {
      prismaMock.subject.findUnique.mockResolvedValue({
        class: { level: { campusId: 'campus-1' } },
      });
      prismaMock.campus.findMany.mockResolvedValue([{ id: 'campus-1' }]);

      const result = await service.assertSubjectAccess(user, 'subject-1');

      expect(result).toBe('campus-1');
    });
  });

  describe('assertStudentAccess', () => {
    const user: CurrentUser = {
      sub: 'admin-1',
      email: 'admin@nexus.test',
      role: UserRole.ADMIN,
      institutionId: 'institution-1',
    };

    it('rejects when the student does not exist', async () => {
      prismaMock.student.findUnique.mockResolvedValue(null);

      await expect(
        service.assertStudentAccess(user, 'missing-student'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('resolves the student campus and checks access', async () => {
      prismaMock.student.findUnique.mockResolvedValue({
        campusId: 'campus-1',
      });
      prismaMock.campus.findMany.mockResolvedValue([{ id: 'campus-1' }]);

      const result = await service.assertStudentAccess(user, 'student-1');

      expect(result).toBe('campus-1');
    });
  });

  describe('assertGuardianAccess', () => {
    const user: CurrentUser = {
      sub: 'admin-1',
      email: 'admin@nexus.test',
      role: UserRole.ADMIN,
      institutionId: 'institution-1',
    };

    it('rejects when the guardian does not exist', async () => {
      prismaMock.guardian.findUnique.mockResolvedValue(null);

      await expect(
        service.assertGuardianAccess(user, 'missing-guardian'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('resolves the guardian campus and checks access', async () => {
      prismaMock.guardian.findUnique.mockResolvedValue({
        campusId: 'campus-1',
      });
      prismaMock.campus.findMany.mockResolvedValue([{ id: 'campus-1' }]);

      const result = await service.assertGuardianAccess(user, 'guardian-1');

      expect(result).toBe('campus-1');
    });
  });

  describe('assertEnrollmentAccess', () => {
    const user: CurrentUser = {
      sub: 'admin-1',
      email: 'admin@nexus.test',
      role: UserRole.ADMIN,
      institutionId: 'institution-1',
    };

    it('rejects when the enrollment does not exist', async () => {
      prismaMock.studentEnrollment.findUnique.mockResolvedValue(null);

      await expect(
        service.assertEnrollmentAccess(user, 'missing-enrollment'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('resolves the enrollment campus and checks access', async () => {
      prismaMock.studentEnrollment.findUnique.mockResolvedValue({
        campusId: 'campus-1',
      });
      prismaMock.campus.findMany.mockResolvedValue([{ id: 'campus-1' }]);

      const result = await service.assertEnrollmentAccess(user, 'enrollment-1');

      expect(result).toBe('campus-1');
    });
  });

  describe('assertStaffProfileAccess', () => {
    it('resolves the campus for an existing staff profile and checks access', async () => {
      prismaMock.staffProfile.findUnique.mockResolvedValue({
        campusId: 'campus-1',
      });
      prismaMock.userCampus.findMany.mockResolvedValue([
        { campusId: 'campus-1' },
      ]);

      const user: CurrentUser = {
        sub: 'staff-user-1',
        email: 'staff@nexus.test',
        role: UserRole.STAFF,
        institutionId: 'institution-1',
      };

      const result = await service.assertStaffProfileAccess(
        user,
        'staff-profile-1',
      );

      expect(prismaMock.staffProfile.findUnique).toHaveBeenCalledWith({
        where: { id: 'staff-profile-1' },
        select: { campusId: true },
      });
      expect(result).toBe('campus-1');
    });

    it('rejects when the staff profile does not exist', async () => {
      prismaMock.staffProfile.findUnique.mockResolvedValue(null);

      const user: CurrentUser = {
        sub: 'admin-1',
        email: 'admin@nexus.test',
        role: UserRole.ADMIN,
        institutionId: 'institution-1',
      };

      await expect(
        service.assertStaffProfileAccess(user, 'missing-staff-profile'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });
});
