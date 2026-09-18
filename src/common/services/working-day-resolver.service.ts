import { Injectable } from '@nestjs/common';
import { DayOfWeek } from '../../prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * P0-6 (§ 5.2 of P0-6-7-9-CORRECTIVE-DESIGN.md): resolves whether a given
 * local calendar date is a working day for a campus — NOT an explicit
 * closure (institution-wide or campus-specific) AND its weekday IS in the
 * institution's configured working-days pattern.
 *
 * Fail-closed by design (Wasim-confirmed, task brief § "product decisions
 * ... now resolved"): an institution with no InstitutionWorkingCalendar row
 * configured yet resolves to "not a working day" for every date, so
 * `markCampusAbsentees` generates zero auto-absences until an admin
 * explicitly configures a working-days calendar — this is intentional, not
 * a bug, because the alternative (fail-open) would silently reproduce the
 * exact "Sundays generate absences" bug P0-6 exists to fix for every
 * institution that hasn't yet visited the new settings screen.
 */
@Injectable()
export class WorkingDayResolverService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * @param {string} institutionId
   * @param {string} campusId
   * @param {string} localDate - "YYYY-MM-DD", already resolved in the
   *   campus's local zone by TimezoneResolverService.
   * @param {DayOfWeek} localDayOfWeek - The weekday of `localDate`, already
   *   resolved in the campus's local zone.
   * @returns {Promise<boolean>} True if `localDate` is a working day for
   *   this campus.
   */
  async isWorkingDay(
    institutionId: string,
    campusId: string,
    localDate: string,
    localDayOfWeek: DayOfWeek,
  ): Promise<boolean> {
    const calendar = await this.prisma.institutionWorkingCalendar.findUnique({
      where: { institutionId, deletedAt: null },
      select: { workingDays: true },
    });

    // No calendar configured yet => fail closed (§ 5.2 / § 11 #1, locked).
    if (!calendar || !calendar.workingDays.includes(localDayOfWeek)) {
      return false;
    }

    const dateOnly = new Date(`${localDate}T00:00:00.000Z`);
    const closure = await this.prisma.institutionClosureDate.findFirst({
      where: {
        institutionId,
        date: dateOnly,
        deletedAt: null,
        OR: [{ campusId: null }, { campusId }],
      },
      select: { id: true },
    });

    return !closure;
  }
}
