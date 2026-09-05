import { ForbiddenException, Injectable } from '@nestjs/common';
import { UserRole } from '../../prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CurrentUser } from '../interfaces/current-user.interface';

@Injectable()
export class CampusAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async getCampusIdsForUser(user: CurrentUser): Promise<string[]> {
    if (user.role === UserRole.SUPERADMIN) {
      const campuses = await this.prisma.campus.findMany({
        where: { deletedAt: null },
        select: { id: true },
      });
      return campuses.map((campus: { id: string }) => campus.id);
    }

    if (user.role === UserRole.ADMIN && user.institutionId) {
      const campuses = await this.prisma.campus.findMany({
        where: { institutionId: user.institutionId, deletedAt: null },
        select: { id: true },
      });
      return campuses.map((campus: { id: string }) => campus.id);
    }

    if (user.role === UserRole.STAFF) {
      // Every employee now has a StaffProfile row (teaching AND
      // non-teaching), so "check the profile first" would silently pin a
      // multi-campus campus-admin (decision #20: a full-permission role +
      // UserCampus scoping) to just their profile's one home campus,
      // breaking that scoping. Resolve purely from UserCampus instead — the
      // same shape as the ADMIN branch above — and rely on StaffProfile
      // create/update syncing a matching UserCampus row (see
      // PeopleService.syncUserCampusAssignment) so teaching staff still
      // resolve to exactly their one home campus. See
      // M2-PEOPLE-ACADEMIC-DESIGN.md § 7.6.
      const records = await this.prisma.userCampus.findMany({
        where: {
          userId: user.sub,
          campus: {
            deletedAt: null,
          },
        },
        select: { campusId: true },
      });
      return records.map((record: { campusId: string }) => record.campusId);
    }

    if (user.role === UserRole.ADMIN) {
      const records = await this.prisma.userCampus.findMany({
        where: {
          userId: user.sub,
          campus: {
            deletedAt: null,
          },
        },
        select: { campusId: true },
      });
      return records.map((record: { campusId: string }) => record.campusId);
    }

    if (user.role === UserRole.STUDENT) {
      const student = await this.prisma.student.findFirst({
        where: {
          userId: user.sub,
          campus: {
            deletedAt: null,
          },
        },
        select: { campusId: true },
      });
      return student ? [student.campusId] : [];
    }

    if (user.role === UserRole.GUARDIAN) {
      const guardian = await this.prisma.guardian.findFirst({
        where: {
          userId: user.sub,
          campus: {
            deletedAt: null,
          },
        },
        select: { campusId: true },
      });
      return guardian ? [guardian.campusId] : [];
    }

    return [];
  }

  async assertCampusAccess(user: CurrentUser, campusId: string) {
    const campusIds = await this.getCampusIdsForUser(user);
    if (!campusIds.includes(campusId)) {
      throw new ForbiddenException('You do not have access to this campus.');
    }

    return campusId;
  }

  async getScopedCampusIds(
    user: CurrentUser,
    requestedCampusId?: string,
  ): Promise<string[]> {
    if (requestedCampusId) {
      await this.assertCampusAccess(user, requestedCampusId);
      return [requestedCampusId];
    }

    return this.getCampusIdsForUser(user);
  }

  async assertLevelAccess(user: CurrentUser, levelId: string) {
    const level = await this.prisma.level.findUnique({
      where: { id: levelId },
      select: { campusId: true },
    });

    if (!level) {
      throw new ForbiddenException('You do not have access to this level.');
    }

    return this.assertCampusAccess(user, level.campusId);
  }

  async assertClassAccess(user: CurrentUser, classId: string) {
    const academicClass = await this.prisma.academicClass.findUnique({
      where: { id: classId },
      select: {
        level: {
          select: {
            campusId: true,
          },
        },
      },
    });

    const campusId = academicClass?.level.campusId;
    if (!campusId) {
      throw new ForbiddenException('You do not have access to this class.');
    }

    return this.assertCampusAccess(user, campusId);
  }

  async assertSectionAccess(user: CurrentUser, sectionId: string) {
    const section = await this.prisma.section.findUnique({
      where: { id: sectionId },
      select: {
        class: {
          select: {
            level: {
              select: {
                campusId: true,
              },
            },
          },
        },
      },
    });

    const campusId = section?.class.level.campusId;
    if (!campusId) {
      throw new ForbiddenException('You do not have access to this section.');
    }

    return this.assertCampusAccess(user, campusId);
  }

  async assertSubjectAccess(user: CurrentUser, subjectId: string) {
    const subject = await this.prisma.subject.findUnique({
      where: { id: subjectId },
      select: {
        class: {
          select: {
            level: {
              select: {
                campusId: true,
              },
            },
          },
        },
      },
    });

    const campusId = subject?.class.level.campusId;
    if (!campusId) {
      throw new ForbiddenException('You do not have access to this subject.');
    }

    return this.assertCampusAccess(user, campusId);
  }

  async assertStudentAccess(user: CurrentUser, studentId: string) {
    const student = await this.prisma.student.findUnique({
      where: { id: studentId },
      select: { campusId: true },
    });

    if (!student) {
      throw new ForbiddenException('You do not have access to this student.');
    }

    return this.assertCampusAccess(user, student.campusId);
  }

  async assertGuardianAccess(user: CurrentUser, guardianId: string) {
    const guardian = await this.prisma.guardian.findUnique({
      where: { id: guardianId },
      select: { campusId: true },
    });

    if (!guardian) {
      throw new ForbiddenException('You do not have access to this guardian.');
    }

    return this.assertCampusAccess(user, guardian.campusId);
  }

  async assertStaffProfileAccess(user: CurrentUser, staffProfileId: string) {
    const staffProfile = await this.prisma.staffProfile.findUnique({
      where: { id: staffProfileId },
      select: { campusId: true },
    });

    if (!staffProfile) {
      throw new ForbiddenException(
        'You do not have access to this staff profile.',
      );
    }

    return this.assertCampusAccess(user, staffProfile.campusId);
  }
}
