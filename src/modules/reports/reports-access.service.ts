import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { CampusAccessService } from '../../common/services/campus-access.service';
import { ModuleAccessService } from '../../common/services/module-access.service';
import { ModuleKey, UserRole } from '../../prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface ReportCampus {
  id: string;
  name: string;
  timezone: string;
}

export interface ReportScope {
  institutionId: string;
  /** The campuses the report may cover, ordered by name. */
  campuses: ReportCampus[];
}

/**
 * The one place that decides who may run reports and over which campuses:
 * only institution administrators (and the superadmin, for the institution
 * they are viewing), only when the institution has the reporting module, and
 * never across institutions.
 */
@Injectable()
export class ReportsAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly moduleAccess: ModuleAccessService,
    private readonly campusAccess: CampusAccessService,
  ) {}

  /**
   * @param {CurrentUser} currentUser - The caller.
   * @param {object} [options] - What the caller asked for.
   * @param {string} [options.institutionId] - Which institution a superadmin is viewing; ignored for anyone else.
   * @param {string} [options.campusId] - Narrow to one campus the caller may see.
   * @returns {Promise<ReportScope>} The institution and the campuses to cover.
   * @throws {ForbiddenException} If the caller is not an administrator, lacks the module, or cannot see the campus.
   * @throws {BadRequestException} If a superadmin did not say which institution.
   */
  async resolve(
    currentUser: CurrentUser,
    options: { institutionId?: string; campusId?: string } = {},
  ): Promise<ReportScope> {
    if (
      currentUser.role !== UserRole.ADMIN &&
      currentUser.role !== UserRole.SUPERADMIN
    ) {
      throw new ForbiddenException(
        'Reports are available to institution administrators.',
      );
    }
    const institutionId =
      currentUser.role === UserRole.SUPERADMIN
        ? options.institutionId
        : (currentUser.institutionId ?? undefined);
    if (!institutionId) {
      throw new BadRequestException('Choose an institution for this report.');
    }
    await this.moduleAccess.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.REPORTING,
    );

    const allowed = await this.campusAccess.getCampusIdsForUser(currentUser);
    if (options.campusId && !allowed.includes(options.campusId)) {
      throw new ForbiddenException('You do not have access to this campus.');
    }
    const institution = await this.prisma.institution.findUnique({
      where: { id: institutionId },
      select: { timezone: true },
    });
    const rows = await this.prisma.campus.findMany({
      where: {
        institutionId,
        deletedAt: null,
        id: options.campusId ? options.campusId : { in: allowed },
      },
      select: { id: true, name: true, timezone: true },
      orderBy: { name: 'asc' },
    });
    if (options.campusId && rows.length === 0) {
      throw new ForbiddenException('You do not have access to this campus.');
    }
    return {
      institutionId,
      campuses: rows.map((row) => ({
        id: row.id,
        name: row.name,
        timezone: row.timezone ?? institution?.timezone ?? 'Asia/Karachi',
      })),
    };
  }
}
