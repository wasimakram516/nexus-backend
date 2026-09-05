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
    },
    guardian: {
      findFirst: jest.fn(),
    },
    staffProfile: {
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
