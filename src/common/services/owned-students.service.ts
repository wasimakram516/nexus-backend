import { Injectable } from '@nestjs/common';
import { CurrentUser } from '../interfaces/current-user.interface';
import { UserRole } from '../../prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Which students a self-service caller may see: themselves for a student,
 * their linked wards for a guardian. Shared by every portal feature (exam
 * results, fees) so ownership is decided in exactly one place.
 */
@Injectable()
export class OwnedStudentsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The students this caller owns.
   *
   * @param {CurrentUser} currentUser - A student or guardian; anyone else owns none.
   * @returns {Promise<string[]>} Student ids.
   */
  async resolveOwnedStudentIds(currentUser: CurrentUser): Promise<string[]> {
    if (currentUser.role === UserRole.STUDENT) {
      const student = await this.prisma.student.findFirst({
        where: { userId: currentUser.sub, deletedAt: null },
        select: { id: true },
      });
      return student ? [student.id] : [];
    }
    if (currentUser.role === UserRole.GUARDIAN) {
      const guardian = await this.prisma.guardian.findFirst({
        where: { userId: currentUser.sub, deletedAt: null },
        select: { id: true },
      });
      if (!guardian) return [];
      return this.studentIdsOfGuardian(guardian.id);
    }
    return [];
  }

  /**
   * The students linked to one guardian, for staff screens that show a family.
   *
   * @param {string} guardianId - The guardian record.
   * @returns {Promise<string[]>} Student ids.
   */
  async studentIdsOfGuardian(guardianId: string): Promise<string[]> {
    const links = await this.prisma.studentGuardian.findMany({
      where: {
        guardianId,
        deletedAt: null,
        student: { deletedAt: null },
      },
      select: { studentId: true },
    });
    return links.map((link) => link.studentId);
  }
}
