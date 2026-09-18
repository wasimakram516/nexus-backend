import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ModuleKey } from '../../prisma/client';
import { AuditLogService } from '../../common/services/audit-log.service';
import { CampusAccessService } from '../../common/services/campus-access.service';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { ModuleAccessService } from '../../common/services/module-access.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateClosureDateDto,
  ListClosureDatesQueryDto,
  UpdateClosureDateDto,
  UpsertWorkingCalendarDto,
} from './dto/attendance-calendar.dto';

/**
 * P0-6 (§ 5, § 10 step 7 of P0-6-7-9-CORRECTIVE-DESIGN.md): the
 * admin-usable settings surface for the working-days pattern and closure
 * dates that WorkingDayResolverService reads. Every write here is what
 * turns off the fail-closed default (§ 5.2 / § 11 #1) for an institution —
 * before this endpoint is ever called, markCampusAbsentees generates zero
 * auto-absences for that institution, by design.
 */
@Injectable()
export class AttendanceCalendarService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
    private readonly campusAccessService: CampusAccessService,
    private readonly moduleAccessService: ModuleAccessService,
  ) {}

  /**
   * Reads the institution's working-days calendar, or null if not
   * configured yet — same "no current context = empty result" convention
   * as attachCurrentEnrollment, not a throw.
   */
  async getWorkingCalendar(institutionId: string, currentUser: CurrentUser) {
    await this.ensureInstitutionExists(institutionId);
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.ATTENDANCE,
    );

    const calendar = await this.prisma.institutionWorkingCalendar.findFirst({
      where: { institutionId, deletedAt: null },
    });

    return {
      message: 'Working calendar retrieved successfully',
      data: calendar,
    };
  }

  /**
   * Creates or replaces the institution's working-days pattern. One row
   * per institution (§ 5.1) — undeletes a previously soft-deleted row
   * rather than creating a second one, mirroring
   * CampusesService.assignUser's "restore the soft-deleted row instead of
   * duplicating" convention.
   */
  async upsertWorkingCalendar(
    institutionId: string,
    currentUser: CurrentUser,
    dto: UpsertWorkingCalendarDto,
  ) {
    await this.ensureInstitutionExists(institutionId);
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.ATTENDANCE,
    );

    const calendar = await this.prisma.institutionWorkingCalendar.upsert({
      where: { institutionId },
      create: {
        institutionId,
        workingDays: dto.workingDays,
        createdBy: currentUser.sub,
      },
      update: {
        workingDays: dto.workingDays,
        updatedBy: currentUser.sub,
        deletedAt: null,
        deletedBy: null,
        deleteReason: null,
      },
    });

    await this.auditLogService.log(currentUser, {
      action: 'ATTENDANCE_WORKING_CALENDAR_UPDATED',
      entity: 'InstitutionWorkingCalendar',
      entityId: calendar.id,
      institutionId,
      metadata: { workingDays: dto.workingDays },
    });

    return {
      message: 'Working calendar saved successfully',
      data: calendar,
    };
  }

  async listClosureDates(
    institutionId: string,
    currentUser: CurrentUser,
    query: ListClosureDatesQueryDto,
  ) {
    await this.ensureInstitutionExists(institutionId);
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.ATTENDANCE,
    );

    if (query.campusId) {
      await this.campusAccessService.assertCampusAccess(
        currentUser,
        query.campusId,
      );
    }

    const items = await this.prisma.institutionClosureDate.findMany({
      where: {
        institutionId,
        deletedAt: null,
        ...(query.campusId
          ? { OR: [{ campusId: null }, { campusId: query.campusId }] }
          : {}),
      },
      orderBy: { date: 'asc' },
    });

    return { message: 'Closure dates retrieved successfully', data: items };
  }

  async createClosureDate(
    institutionId: string,
    currentUser: CurrentUser,
    dto: CreateClosureDateDto,
  ) {
    await this.ensureInstitutionExists(institutionId);
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.ATTENDANCE,
    );

    if (dto.campusId) {
      await this.assertCampusBelongsToInstitution(dto.campusId, institutionId);
      await this.campusAccessService.assertCampusAccess(
        currentUser,
        dto.campusId,
      );
    }

    const closure = await this.prisma.institutionClosureDate.create({
      data: {
        institutionId,
        campusId: dto.campusId ?? null,
        campusScopeKey: this.campusScopeKeyFor(dto.campusId ?? null),
        date: this.toDateOnly(dto.date),
        label: dto.label,
        createdBy: currentUser.sub,
      },
    });

    await this.auditLogService.log(currentUser, {
      action: 'ATTENDANCE_CLOSURE_DATE_CREATED',
      entity: 'InstitutionClosureDate',
      entityId: closure.id,
      institutionId,
      metadata: { date: dto.date, label: dto.label, campusId: dto.campusId },
    });

    return { message: 'Closure date created successfully', data: closure };
  }

  async updateClosureDate(
    institutionId: string,
    currentUser: CurrentUser,
    id: string,
    dto: UpdateClosureDateDto,
  ) {
    await this.ensureInstitutionExists(institutionId);
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.ATTENDANCE,
    );

    const existing = await this.findClosureDateOrThrow(id, institutionId);
    if (existing.campusId) {
      await this.campusAccessService.assertCampusAccess(
        currentUser,
        existing.campusId,
      );
    }

    const nextCampusId =
      dto.campusId !== undefined ? dto.campusId : existing.campusId;
    if (dto.campusId) {
      await this.assertCampusBelongsToInstitution(dto.campusId, institutionId);
      await this.campusAccessService.assertCampusAccess(
        currentUser,
        dto.campusId,
      );
    }

    const closure = await this.prisma.institutionClosureDate.update({
      where: { id },
      data: {
        ...(dto.campusId !== undefined
          ? {
              campusId: nextCampusId,
              campusScopeKey: this.campusScopeKeyFor(nextCampusId),
            }
          : {}),
        ...(dto.date !== undefined ? { date: this.toDateOnly(dto.date) } : {}),
        ...(dto.label !== undefined ? { label: dto.label } : {}),
        updatedBy: currentUser.sub,
      },
    });

    await this.auditLogService.log(currentUser, {
      action: 'ATTENDANCE_CLOSURE_DATE_UPDATED',
      entity: 'InstitutionClosureDate',
      entityId: id,
      institutionId,
      metadata: { updatedFields: Object.keys(dto) },
    });

    return { message: 'Closure date updated successfully', data: closure };
  }

  async deleteClosureDate(
    institutionId: string,
    currentUser: CurrentUser,
    id: string,
    reason?: string,
  ) {
    await this.ensureInstitutionExists(institutionId);
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.ATTENDANCE,
    );

    const existing = await this.findClosureDateOrThrow(id, institutionId);
    if (existing.campusId) {
      await this.campusAccessService.assertCampusAccess(
        currentUser,
        existing.campusId,
      );
    }

    await this.prisma.institutionClosureDate.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        deletedBy: currentUser.sub,
        deleteReason: reason ?? null,
        updatedBy: currentUser.sub,
      },
    });

    await this.auditLogService.log(currentUser, {
      action: 'ATTENDANCE_CLOSURE_DATE_DELETED',
      entity: 'InstitutionClosureDate',
      entityId: id,
      institutionId,
      metadata: { label: existing.label, reason: reason ?? null },
    });

    return {
      message: 'Closure date moved to recycle bin successfully',
      data: { id },
    };
  }

  private async ensureInstitutionExists(institutionId: string) {
    const institution = await this.prisma.institution.findUnique({
      where: { id: institutionId },
      select: { id: true },
    });
    if (!institution) {
      throw new NotFoundException('Institution not found.');
    }
  }

  private async assertCampusBelongsToInstitution(
    campusId: string,
    institutionId: string,
  ) {
    const campus = await this.prisma.campus.findUnique({
      where: { id: campusId },
      select: { institutionId: true },
    });
    if (!campus || campus.institutionId !== institutionId) {
      throw new BadRequestException(
        'campusId does not belong to this institution.',
      );
    }
  }

  private async findClosureDateOrThrow(id: string, institutionId: string) {
    const closure = await this.prisma.institutionClosureDate.findFirst({
      where: { id, institutionId, deletedAt: null },
    });
    if (!closure) {
      throw new NotFoundException('Closure date not found.');
    }
    return closure;
  }

  private toDateOnly(value: string) {
    return new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  }

  /**
   * Non-nullable companion to the nullable campusId, server-computed only —
   * same periodKey/retakeKey sentinel pattern already used for Attendance
   * and Exam, needed because Postgres's unique indexes treat NULL as
   * distinct from every other NULL (see the InstitutionClosureDate schema
   * comment for the exact trap this closes).
   */
  private campusScopeKeyFor(campusId: string | null): string {
    return campusId ?? 'INSTITUTION';
  }
}
