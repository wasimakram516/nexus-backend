import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { AuditLogService } from '../../common/services/audit-log.service';
import { CampusAccessService } from '../../common/services/campus-access.service';
import { ModuleAccessService } from '../../common/services/module-access.service';
import {
  AUTOMATIC_FINE_REASON_PREFIX,
  AttendanceCounts,
  calculateAttendanceFine,
  describeAttendanceFine,
} from '../../common/utils/attendance-fine.util';
import {
  AttendanceStatus,
  EnrollmentStatus,
  ModuleKey,
  Prisma,
  UserRole,
} from '../../prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { GenerateStudentFinesDto } from './dto/finance.dto';

/** A run covers at most this many students; larger campuses narrow by class or section. */
export const MAX_FINE_RUN_STUDENTS = 2000;

interface StudentRef {
  studentId: string;
  name: string;
  regNo: string;
}

export interface CalculatedFine extends StudentRef {
  fineId: string | null;
  counts: AttendanceCounts;
  amount: string;
  action: 'created' | 'updated';
}
export interface UnchangedFine extends StudentRef {
  reason: string;
}

const emptyCounts = (): AttendanceCounts => ({
  absent: 0,
  late: 0,
  halfDay: 0,
  leave: 0,
});

/**
 * Turns a month of student attendance into fines using the campus (or class)
 * fine rule. Re-running refreshes the fines this system calculated, but never
 * touches a fine someone entered by hand, a fine that is already paid, or a
 * month whose voucher was already issued (the voucher has the fine baked in).
 */
@Injectable()
export class StudentFineGenerationService {
  private readonly logger = new Logger(StudentFineGenerationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly moduleAccessService: ModuleAccessService,
    private readonly campusAccessService: CampusAccessService,
    private readonly auditLogService: AuditLogService,
  ) {}

  /**
   * Calculate (or, with `preview`, only report) the month's attendance fines.
   *
   * @param {CurrentUser} currentUser - Authenticated caller.
   * @param {GenerateStudentFinesDto} dto - Campus, optional class or section, and period.
   * @returns {Promise<{message: string, data: object}>} Fined and unchanged students with totals.
   * @throws {ForbiddenException} If the caller cannot act at the campus.
   * @throws {ConflictException} If there is no current academic year.
   * @throws {BadRequestException} If the run would cover too many students.
   */
  async generate(currentUser: CurrentUser, dto: GenerateStudentFinesDto) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.FINANCE,
    );
    await this.campusAccessService.assertCampusAccess(
      currentUser,
      dto.campusId,
    );
    return this.run(
      currentUser,
      await this.institutionOfCampus(dto.campusId),
      dto,
    );
  }

  /**
   * The scheduled monthly run: the same calculation with no signed-in person,
   * so nothing records a user. The caller (the scheduler) has already checked
   * that the institution has finance and has switched automatic fines on.
   *
   * @param {GenerateStudentFinesDto} dto - Campus and period; it is never a preview.
   * @returns {Promise<{message: string, data: object}>} Fined and unchanged students with totals.
   * @throws {ForbiddenException} If the campus has no institution.
   * @throws {ConflictException} If there is no current academic year.
   */
  async generateAutomatically(dto: GenerateStudentFinesDto) {
    return this.run(null, await this.institutionOfCampus(dto.campusId), {
      ...dto,
      preview: false,
    });
  }

  private async institutionOfCampus(campusId: string): Promise<string> {
    const campus = await this.prisma.campus.findUnique({
      where: { id: campusId },
      select: { institutionId: true },
    });
    if (!campus?.institutionId) {
      throw new ForbiddenException('You do not have access to this campus.');
    }
    return campus.institutionId;
  }

  private async run(
    currentUser: CurrentUser | null,
    institutionId: string,
    dto: GenerateStudentFinesDto,
  ) {
    const students = await this.selectStudents(
      dto,
      await this.currentAcademicYearId(institutionId),
    );
    if (students.length > MAX_FINE_RUN_STUDENTS) {
      throw new BadRequestException(
        `This would cover ${students.length} students. Choose a class or section so a run covers at most ${MAX_FINE_RUN_STUDENTS}.`,
      );
    }

    const rules = await this.prisma.studentFineRule.findMany({
      where: { campusId: dto.campusId },
    });
    const campusRule = rules.find((rule) => !rule.classId);
    const classRules = new Map(
      rules.filter((rule) => rule.classId).map((rule) => [rule.classId, rule]),
    );
    const studentIds = students.map((row) => row.studentId);
    const counts = await this.attendanceCounts(students, dto);
    const existingFines = await this.prisma.studentFine.findMany({
      where: {
        studentId: { in: studentIds },
        campusId: dto.campusId,
        month: dto.month,
        year: dto.year,
      },
    });
    const fineByStudent = new Map(
      existingFines.map((fine) => [fine.studentId, fine]),
    );
    const issued = new Set(
      (
        await this.prisma.feeVoucher.findMany({
          where: {
            studentId: { in: studentIds },
            month: dto.month,
            year: dto.year,
          },
          select: { studentId: true },
        })
      ).map((row) => row.studentId),
    );

    const fined: CalculatedFine[] = [];
    const unchanged: UnchangedFine[] = [];

    for (const student of students) {
      const rule = classRules.get(student.classId) ?? campusRule;
      const existing = fineByStudent.get(student.studentId);
      const skipReason = !rule
        ? 'No fine rule applies to this student.'
        : issued.has(student.studentId)
          ? 'The voucher for this month was already issued.'
          : existing && !this.isAutomatic(existing.fineReason)
            ? 'A fine entered by hand already exists for this month.'
            : existing?.fineStatus === 'PAID'
              ? 'This fine is already paid.'
              : null;
      if (skipReason || !rule) {
        unchanged.push({
          studentId: student.studentId,
          name: student.name,
          regNo: student.regNo,
          reason: skipReason ?? 'No fine rule applies to this student.',
        });
        continue;
      }

      const studentCounts = counts.get(student.studentId) ?? emptyCounts();
      const amount = calculateAttendanceFine(studentCounts, rule);
      if (amount.lte(0) && !existing) {
        unchanged.push({
          studentId: student.studentId,
          name: student.name,
          regNo: student.regNo,
          reason: 'No fine is due.',
        });
        continue;
      }

      try {
        const fineId = await this.save({
          currentUser,
          dto,
          studentId: student.studentId,
          counts: studentCounts,
          amount,
          existingId: existing?.id,
        });
        fined.push({
          studentId: student.studentId,
          name: student.name,
          regNo: student.regNo,
          fineId,
          counts: studentCounts,
          amount: amount.toFixed(2),
          action: existing ? 'updated' : 'created',
        });
      } catch (error) {
        const duplicate =
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002';
        unchanged.push({
          studentId: student.studentId,
          name: student.name,
          regNo: student.regNo,
          reason: duplicate
            ? 'A fine was created for this month at the same moment.'
            : 'This fine could not be saved.',
        });
      }
    }

    const totalAmount = fined
      .reduce((sum, row) => sum.plus(row.amount), new Prisma.Decimal(0))
      .toFixed(2);

    if (!dto.preview) {
      // The fines are already saved and audited one by one, so a failure to
      // write this summary must not hide the report of what was done.
      try {
        await this.auditLogService.log(currentUser, {
          action: 'STUDENT_FINES_GENERATED',
          entity: 'StudentFine',
          institutionId,
          metadata: {
            automatic: currentUser === null,
            campusId: dto.campusId,
            classId: dto.classId ?? null,
            sectionId: dto.sectionId ?? null,
            month: dto.month,
            year: dto.year,
            fined: fined.length,
            unchanged: unchanged.length,
            totalAmount,
          },
        });
      } catch (error) {
        this.logger.error(
          'Could not record the fine generation summary',
          error instanceof Error ? error.stack : String(error),
        );
      }
    }

    return {
      message: dto.preview
        ? 'Student fines previewed'
        : 'Student fines calculated successfully',
      data: {
        preview: dto.preview === true,
        month: dto.month,
        year: dto.year,
        fined,
        unchanged,
        totals: {
          fined: fined.length,
          unchanged: unchanged.length,
          totalAmount,
        },
      },
    };
  }

  /** Create or refresh one student's automatic fine; a preview writes nothing. */
  private async save(params: {
    currentUser: CurrentUser | null;
    dto: GenerateStudentFinesDto;
    studentId: string;
    counts: AttendanceCounts;
    amount: Prisma.Decimal;
    existingId?: string;
  }): Promise<string | null> {
    const { currentUser, dto, studentId, counts, amount, existingId } = params;
    if (dto.preview) return null;
    const values = {
      absentCount: counts.absent,
      lateCount: counts.late,
      halfDayCount: counts.halfDay,
      leaveCount: counts.leave,
      totalFineAmount: amount,
      fineReason: describeAttendanceFine(counts),
    };
    if (existingId) {
      await this.prisma.studentFine.update({
        where: { id: existingId },
        data: { ...values, updatedBy: currentUser?.sub ?? null },
      });
      return existingId;
    }
    const created = await this.prisma.studentFine.create({
      data: {
        studentId,
        campusId: dto.campusId,
        month: dto.month,
        year: dto.year,
        fineStatus: 'PENDING',
        ...values,
        createdBy: currentUser?.sub ?? null,
      },
    });
    return created.id;
  }

  /**
   * The month's daily attendance marks per student. A half day is counted
   * separately from the status, and period-by-period rows are ignored: a fine
   * is about days, and a student can be absent for a single period.
   */
  private async attendanceCounts(
    students: Array<StudentRef & { userId: string }>,
    dto: GenerateStudentFinesDto,
  ) {
    const rows = await this.prisma.attendance.findMany({
      where: {
        userId: { in: students.map((row) => row.userId) },
        campusId: dto.campusId,
        role: UserRole.STUDENT,
        periodKey: 'DAILY',
        date: {
          gte: new Date(Date.UTC(dto.year, dto.month - 1, 1)),
          lt: new Date(Date.UTC(dto.year, dto.month, 1)),
        },
      },
      select: { userId: true, status: true, halfDay: true },
    });
    const studentByUser = new Map(
      students.map((row) => [row.userId, row.studentId]),
    );
    const counts = new Map<string, AttendanceCounts>();
    for (const row of rows) {
      const studentId = studentByUser.get(row.userId);
      if (!studentId) continue;
      const entry = counts.get(studentId) ?? emptyCounts();
      if (row.status === AttendanceStatus.ABSENT) entry.absent += 1;
      else if (row.status === AttendanceStatus.LATE) entry.late += 1;
      else if (row.status === AttendanceStatus.LEAVE) entry.leave += 1;
      if (row.halfDay) entry.halfDay += 1;
      counts.set(studentId, entry);
    }
    return counts;
  }

  private async selectStudents(
    dto: GenerateStudentFinesDto,
    academicYearId: string,
  ) {
    const enrollments = await this.prisma.studentEnrollment.findMany({
      where: {
        academicYearId,
        campusId: dto.campusId,
        status: { not: EnrollmentStatus.LEFT },
        deletedAt: null,
        student: { deletedAt: null },
        ...(dto.classId ? { classId: dto.classId } : {}),
        ...(dto.sectionId ? { sectionId: dto.sectionId } : {}),
      },
      select: {
        classId: true,
        student: {
          select: {
            id: true,
            userId: true,
            regNo: true,
            user: { select: { name: true } },
          },
        },
      },
    });
    return enrollments
      .map((row) => ({
        studentId: row.student.id,
        userId: row.student.userId,
        name: row.student.user.name,
        regNo: row.student.regNo,
        classId: row.classId,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  private async currentAcademicYearId(institutionId: string): Promise<string> {
    const institution = await this.prisma.institution.findUnique({
      where: { id: institutionId },
      select: { currentAcademicYearId: true },
    });
    if (!institution?.currentAcademicYearId) {
      throw new ConflictException(
        'Set the current academic year before calculating fines.',
      );
    }
    return institution.currentAcademicYearId;
  }

  private isAutomatic(reason: string | null): boolean {
    return reason?.startsWith(AUTOMATIC_FINE_REASON_PREFIX) === true;
  }
}
