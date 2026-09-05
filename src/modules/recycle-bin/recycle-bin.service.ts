import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditLogService } from '../../common/services/audit-log.service';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { RequestContextService } from '../../common/services/request-context.service';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma, UserRole } from '../../prisma/client';
import {
  ListRecycleBinQueryDto,
  RecycleBinEntity,
} from './dto/recycle-bin.dto';

type RecycleBinItem = {
  entity: RecycleBinEntity;
  id: string;
  label: string;
  subtitle: string | null;
  institutionId: string | null;
  deletedAt: Date;
  deletedBy: string | null;
  deleteReason: string | null;
  createdAt: Date;
  updatedAt: Date;
  metadata: Record<string, unknown>;
};

const DEFAULT_RECYCLE_BIN_RETENTION_DAYS = 30;
const MIN_RECYCLE_BIN_RETENTION_DAYS = 7;
const MAX_RECYCLE_BIN_RETENTION_DAYS = 365;

/** Prisma model delegates that appear as cascade-delete children below. */
type ChildModelKey =
  | 'level'
  | 'academicClass'
  | 'section'
  | 'subject'
  | 'student'
  | 'guardian'
  | 'teacher'
  | 'staffSalary'
  | 'salaryDeductionRule'
  | 'salaryPayment'
  | 'salaryAdjustment'
  | 'bankAccount'
  | 'feeStructure'
  | 'studentDiscount'
  | 'studentFineRule'
  | 'studentFine'
  | 'feeVoucher'
  | 'feePayment';

interface CountableDelegate {
  count(args: { where: Record<string, unknown> }): Promise<number>;
  findMany(args: {
    where: Record<string, unknown>;
    select: { id: true };
  }): Promise<Array<{ id: string }>>;
}

type CascadeChildLink = {
  entity: RecycleBinEntity;
  model: ChildModelKey;
  fkField: string;
};

/**
 * Direct onDelete: Cascade edges between the 20 recycle-bin-tracked entity
 * types, derived from schema.prisma. Deliberately excludes cascades whose
 * target isn't independently recycle-bin-visible (join tables like
 * UserCampus/TeacherSubject, log-like rows like Attendance/AuditLog,
 * SalaryDeductionSummary) — those aren't "active records a user would
 * notice disappearing," they're incidental cascade debris that's fine to
 * lose along with an already-30-days-dead parent. Also excludes SetNull
 * relations (e.g. Student.classId, User.roleId) since those don't delete
 * anything. Used by assertNoActiveDescendants() to walk the full transitive
 * blast radius of a hard delete and refuse it if any ACTIVE row is in it.
 */
const ENTITY_CASCADE_CHILDREN: Partial<
  Record<RecycleBinEntity, CascadeChildLink[]>
> = {
  [RecycleBinEntity.CAMPUS]: [
    { entity: RecycleBinEntity.LEVEL, model: 'level', fkField: 'campusId' },
    {
      entity: RecycleBinEntity.STUDENT,
      model: 'student',
      fkField: 'campusId',
    },
    {
      entity: RecycleBinEntity.GUARDIAN,
      model: 'guardian',
      fkField: 'campusId',
    },
    {
      entity: RecycleBinEntity.TEACHER,
      model: 'teacher',
      fkField: 'campusId',
    },
    {
      entity: RecycleBinEntity.SALARY,
      model: 'staffSalary',
      fkField: 'campusId',
    },
    {
      entity: RecycleBinEntity.SALARY_DEDUCTION_RULE,
      model: 'salaryDeductionRule',
      fkField: 'campusId',
    },
    {
      entity: RecycleBinEntity.SALARY_PAYMENT,
      model: 'salaryPayment',
      fkField: 'campusId',
    },
    {
      entity: RecycleBinEntity.SALARY_ADJUSTMENT,
      model: 'salaryAdjustment',
      fkField: 'campusId',
    },
    {
      entity: RecycleBinEntity.BANK_ACCOUNT,
      model: 'bankAccount',
      fkField: 'campusId',
    },
    {
      entity: RecycleBinEntity.FEE_STRUCTURE,
      model: 'feeStructure',
      fkField: 'campusId',
    },
    {
      entity: RecycleBinEntity.STUDENT_FINE_RULE,
      model: 'studentFineRule',
      fkField: 'campusId',
    },
    {
      entity: RecycleBinEntity.STUDENT_FINE,
      model: 'studentFine',
      fkField: 'campusId',
    },
  ],
  [RecycleBinEntity.LEVEL]: [
    {
      entity: RecycleBinEntity.CLASS,
      model: 'academicClass',
      fkField: 'levelId',
    },
  ],
  [RecycleBinEntity.CLASS]: [
    { entity: RecycleBinEntity.SECTION, model: 'section', fkField: 'classId' },
    { entity: RecycleBinEntity.SUBJECT, model: 'subject', fkField: 'classId' },
    {
      entity: RecycleBinEntity.FEE_STRUCTURE,
      model: 'feeStructure',
      fkField: 'classId',
    },
    {
      entity: RecycleBinEntity.STUDENT_FINE_RULE,
      model: 'studentFineRule',
      fkField: 'classId',
    },
  ],
  [RecycleBinEntity.USER]: [
    { entity: RecycleBinEntity.STUDENT, model: 'student', fkField: 'userId' },
    {
      entity: RecycleBinEntity.GUARDIAN,
      model: 'guardian',
      fkField: 'userId',
    },
    { entity: RecycleBinEntity.TEACHER, model: 'teacher', fkField: 'userId' },
    {
      entity: RecycleBinEntity.SALARY_PAYMENT,
      model: 'salaryPayment',
      fkField: 'paidBy',
    },
    {
      entity: RecycleBinEntity.SALARY_ADJUSTMENT,
      model: 'salaryAdjustment',
      fkField: 'adjustedBy',
    },
  ],
  [RecycleBinEntity.STUDENT]: [
    {
      entity: RecycleBinEntity.STUDENT_DISCOUNT,
      model: 'studentDiscount',
      fkField: 'studentId',
    },
    {
      entity: RecycleBinEntity.STUDENT_FINE,
      model: 'studentFine',
      fkField: 'studentId',
    },
    {
      entity: RecycleBinEntity.FEE_VOUCHER,
      model: 'feeVoucher',
      fkField: 'studentId',
    },
  ],
  [RecycleBinEntity.SALARY]: [
    {
      entity: RecycleBinEntity.SALARY_PAYMENT,
      model: 'salaryPayment',
      fkField: 'salaryId',
    },
    {
      entity: RecycleBinEntity.SALARY_ADJUSTMENT,
      model: 'salaryAdjustment',
      fkField: 'salaryId',
    },
  ],
  [RecycleBinEntity.FEE_STRUCTURE]: [
    {
      entity: RecycleBinEntity.FEE_VOUCHER,
      model: 'feeVoucher',
      fkField: 'feeStructureId',
    },
  ],
  [RecycleBinEntity.FEE_VOUCHER]: [
    {
      entity: RecycleBinEntity.FEE_PAYMENT,
      model: 'feePayment',
      fkField: 'voucherId',
    },
  ],
};

@Injectable()
export class RecycleBinService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
    private readonly requestContext: RequestContextService,
  ) {}

  async listDeletedItems(
    currentUser: CurrentUser,
    query: ListRecycleBinQueryDto,
  ) {
    const institutionId = this.resolveScopedInstitutionId(currentUser, query);
    const [
      userItems,
      campusItems,
      roleItems,
      studentItems,
      guardianItems,
      teacherItems,
      levelItems,
      classItems,
      sectionItems,
      subjectItems,
      salaryItems,
      salaryDeductionRuleItems,
      salaryAdjustmentItems,
      salaryPaymentItems,
      bankAccountItems,
      feeStructureItems,
      studentDiscountItems,
      studentFineRuleItems,
      studentFineItems,
      feeVoucherItems,
      feePaymentItems,
      academicYearItems,
    ] = await Promise.all([
      query.entity && query.entity !== RecycleBinEntity.USER
        ? Promise.resolve<RecycleBinItem[]>([])
        : this.listDeletedUsers(institutionId, query.search),
      query.entity && query.entity !== RecycleBinEntity.CAMPUS
        ? Promise.resolve<RecycleBinItem[]>([])
        : this.listDeletedCampuses(institutionId, query.search),
      query.entity && query.entity !== RecycleBinEntity.ROLE
        ? Promise.resolve<RecycleBinItem[]>([])
        : this.listDeletedRoles(institutionId, query.search),
      query.entity && query.entity !== RecycleBinEntity.STUDENT
        ? Promise.resolve<RecycleBinItem[]>([])
        : this.listDeletedStudents(institutionId, query.search),
      query.entity && query.entity !== RecycleBinEntity.GUARDIAN
        ? Promise.resolve<RecycleBinItem[]>([])
        : this.listDeletedGuardians(institutionId, query.search),
      query.entity && query.entity !== RecycleBinEntity.TEACHER
        ? Promise.resolve<RecycleBinItem[]>([])
        : this.listDeletedTeachers(institutionId, query.search),
      query.entity && query.entity !== RecycleBinEntity.LEVEL
        ? Promise.resolve<RecycleBinItem[]>([])
        : this.listDeletedLevels(institutionId, query.search),
      query.entity && query.entity !== RecycleBinEntity.CLASS
        ? Promise.resolve<RecycleBinItem[]>([])
        : this.listDeletedClasses(institutionId, query.search),
      query.entity && query.entity !== RecycleBinEntity.SECTION
        ? Promise.resolve<RecycleBinItem[]>([])
        : this.listDeletedSections(institutionId, query.search),
      query.entity && query.entity !== RecycleBinEntity.SUBJECT
        ? Promise.resolve<RecycleBinItem[]>([])
        : this.listDeletedSubjects(institutionId, query.search),
      query.entity && query.entity !== RecycleBinEntity.SALARY
        ? Promise.resolve<RecycleBinItem[]>([])
        : this.listDeletedSalaries(institutionId, query.search),
      query.entity && query.entity !== RecycleBinEntity.SALARY_DEDUCTION_RULE
        ? Promise.resolve<RecycleBinItem[]>([])
        : this.listDeletedSalaryDeductionRules(institutionId, query.search),
      query.entity && query.entity !== RecycleBinEntity.SALARY_ADJUSTMENT
        ? Promise.resolve<RecycleBinItem[]>([])
        : this.listDeletedSalaryAdjustments(institutionId, query.search),
      query.entity && query.entity !== RecycleBinEntity.SALARY_PAYMENT
        ? Promise.resolve<RecycleBinItem[]>([])
        : this.listDeletedSalaryPayments(institutionId, query.search),
      query.entity && query.entity !== RecycleBinEntity.BANK_ACCOUNT
        ? Promise.resolve<RecycleBinItem[]>([])
        : this.listDeletedBankAccounts(institutionId, query.search),
      query.entity && query.entity !== RecycleBinEntity.FEE_STRUCTURE
        ? Promise.resolve<RecycleBinItem[]>([])
        : this.listDeletedFeeStructures(institutionId, query.search),
      query.entity && query.entity !== RecycleBinEntity.STUDENT_DISCOUNT
        ? Promise.resolve<RecycleBinItem[]>([])
        : this.listDeletedStudentDiscounts(institutionId, query.search),
      query.entity && query.entity !== RecycleBinEntity.STUDENT_FINE_RULE
        ? Promise.resolve<RecycleBinItem[]>([])
        : this.listDeletedStudentFineRules(institutionId, query.search),
      query.entity && query.entity !== RecycleBinEntity.STUDENT_FINE
        ? Promise.resolve<RecycleBinItem[]>([])
        : this.listDeletedStudentFines(institutionId, query.search),
      query.entity && query.entity !== RecycleBinEntity.FEE_VOUCHER
        ? Promise.resolve<RecycleBinItem[]>([])
        : this.listDeletedFeeVouchers(institutionId, query.search),
      query.entity && query.entity !== RecycleBinEntity.FEE_PAYMENT
        ? Promise.resolve<RecycleBinItem[]>([])
        : this.listDeletedFeePayments(institutionId, query.search),
      query.entity && query.entity !== RecycleBinEntity.ACADEMIC_YEAR
        ? Promise.resolve<RecycleBinItem[]>([])
        : this.listDeletedAcademicYears(institutionId, query.search),
    ]);

    const combinedItems = [
      ...userItems,
      ...campusItems,
      ...roleItems,
      ...studentItems,
      ...guardianItems,
      ...teacherItems,
      ...levelItems,
      ...classItems,
      ...sectionItems,
      ...subjectItems,
      ...salaryItems,
      ...salaryDeductionRuleItems,
      ...salaryAdjustmentItems,
      ...salaryPaymentItems,
      ...bankAccountItems,
      ...feeStructureItems,
      ...studentDiscountItems,
      ...studentFineRuleItems,
      ...studentFineItems,
      ...feeVoucherItems,
      ...feePaymentItems,
      ...academicYearItems,
    ].sort(
      (left, right) => right.deletedAt.getTime() - left.deletedAt.getTime(),
    );
    const skip = (query.page! - 1) * query.limit!;
    const pageItems = combinedItems.slice(skip, skip + query.limit!);
    const deletedByUsers = await this.loadDeletedByUsers(pageItems);
    const retentionDaysByInstitution =
      await this.resolveRetentionDaysForItems(pageItems);

    return {
      message: 'Recycle bin items retrieved successfully',
      data: {
        items: pageItems.map((item) => {
          const retentionDays =
            retentionDaysByInstitution.get(item.institutionId ?? '') ??
            DEFAULT_RECYCLE_BIN_RETENTION_DAYS;
          const purgeEligibleAt = this.resolvePurgeEligibleAt(
            item.deletedAt,
            retentionDays,
          );
          const daysLeft = Math.max(
            0,
            Math.ceil(
              (purgeEligibleAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000),
            ),
          );

          return {
            ...item,
            deletedByUser: item.deletedBy
              ? deletedByUsers[item.deletedBy]
              : null,
            retentionDays,
            purgeEligibleAt,
            daysLeft,
            isPurgeEligible: daysLeft === 0,
          };
        }),
        total: combinedItems.length,
        page: query.page,
        limit: query.limit,
      },
    };
  }

  /** Batches one setting lookup per distinct institution instead of one per item. */
  private async resolveRetentionDaysForItems(
    items: RecycleBinItem[],
  ): Promise<Map<string, number>> {
    const institutionIds = Array.from(
      new Set(
        items
          .map((item) => item.institutionId)
          .filter((value): value is string => Boolean(value)),
      ),
    );

    const entries = await Promise.all(
      institutionIds.map(
        async (institutionId) =>
          [
            institutionId,
            await this.resolveRetentionDays(institutionId),
          ] as const,
      ),
    );

    return new Map(entries);
  }

  async restoreRecord(
    currentUser: CurrentUser,
    entity: RecycleBinEntity,
    recordId: string,
  ) {
    try {
      if (entity === RecycleBinEntity.USER) {
        return this.restoreUser(currentUser, recordId);
      }

      if (entity === RecycleBinEntity.STUDENT) {
        return this.restoreStudent(currentUser, recordId);
      }

      if (entity === RecycleBinEntity.GUARDIAN) {
        return this.restoreGuardian(currentUser, recordId);
      }

      if (entity === RecycleBinEntity.TEACHER) {
        return this.restoreTeacher(currentUser, recordId);
      }

      if (entity === RecycleBinEntity.LEVEL) {
        return this.restoreLevel(currentUser, recordId);
      }

      if (entity === RecycleBinEntity.CLASS) {
        return this.restoreClass(currentUser, recordId);
      }

      if (entity === RecycleBinEntity.SECTION) {
        return this.restoreSection(currentUser, recordId);
      }

      if (entity === RecycleBinEntity.SUBJECT) {
        return this.restoreSubject(currentUser, recordId);
      }

      if (entity === RecycleBinEntity.SALARY) {
        return this.restoreSalary(currentUser, recordId);
      }

      if (entity === RecycleBinEntity.SALARY_DEDUCTION_RULE) {
        return this.restoreSalaryDeductionRule(currentUser, recordId);
      }

      if (entity === RecycleBinEntity.SALARY_ADJUSTMENT) {
        return this.restoreSalaryAdjustment(currentUser, recordId);
      }

      if (entity === RecycleBinEntity.SALARY_PAYMENT) {
        return this.restoreSalaryPayment(currentUser, recordId);
      }

      if (entity === RecycleBinEntity.BANK_ACCOUNT) {
        return this.restoreBankAccount(currentUser, recordId);
      }

      if (entity === RecycleBinEntity.FEE_STRUCTURE) {
        return this.restoreFeeStructure(currentUser, recordId);
      }

      if (entity === RecycleBinEntity.STUDENT_DISCOUNT) {
        return this.restoreStudentDiscount(currentUser, recordId);
      }

      if (entity === RecycleBinEntity.STUDENT_FINE_RULE) {
        return this.restoreStudentFineRule(currentUser, recordId);
      }

      if (entity === RecycleBinEntity.STUDENT_FINE) {
        return this.restoreStudentFine(currentUser, recordId);
      }

      if (entity === RecycleBinEntity.FEE_VOUCHER) {
        return this.restoreFeeVoucher(currentUser, recordId);
      }

      if (entity === RecycleBinEntity.FEE_PAYMENT) {
        return this.restoreFeePayment(currentUser, recordId);
      }

      if (entity === RecycleBinEntity.ROLE) {
        return this.restoreRole(currentUser, recordId);
      }

      if (entity === RecycleBinEntity.ACADEMIC_YEAR) {
        // Deliberately awaited (unlike the sibling `return this.restoreX(...)`
        // branches above) so a rejection is actually thrown from within this
        // try block for `rethrowRestoreConflict` below to catch. A bare
        // `return <promise>` inside a try does NOT get its rejection caught
        // by the enclosing catch — that's a real, verified gap already
        // present for every other entity here, tracked as a follow-up fix.
        return await this.restoreAcademicYear(currentUser, recordId);
      }

      return this.restoreCampus(currentUser, recordId);
    } catch (error) {
      this.rethrowRestoreConflict(error, entity);
      throw error;
    }
  }

  async permanentlyDeleteRecord(
    currentUser: CurrentUser,
    entity: RecycleBinEntity,
    recordId: string,
  ) {
    if (entity === RecycleBinEntity.USER) {
      return this.permanentlyDeleteUser(currentUser, recordId);
    }

    if (entity === RecycleBinEntity.STUDENT) {
      return this.permanentlyDeleteStudent(currentUser, recordId);
    }

    if (entity === RecycleBinEntity.GUARDIAN) {
      return this.permanentlyDeleteGuardian(currentUser, recordId);
    }

    if (entity === RecycleBinEntity.TEACHER) {
      return this.permanentlyDeleteTeacher(currentUser, recordId);
    }

    if (entity === RecycleBinEntity.LEVEL) {
      return this.permanentlyDeleteLevel(currentUser, recordId);
    }

    if (entity === RecycleBinEntity.CLASS) {
      return this.permanentlyDeleteClass(currentUser, recordId);
    }

    if (entity === RecycleBinEntity.SECTION) {
      return this.permanentlyDeleteSection(currentUser, recordId);
    }

    if (entity === RecycleBinEntity.SUBJECT) {
      return this.permanentlyDeleteSubject(currentUser, recordId);
    }

    if (entity === RecycleBinEntity.SALARY) {
      return this.permanentlyDeleteSalary(currentUser, recordId);
    }

    if (entity === RecycleBinEntity.SALARY_DEDUCTION_RULE) {
      return this.permanentlyDeleteSalaryDeductionRule(currentUser, recordId);
    }

    if (entity === RecycleBinEntity.SALARY_ADJUSTMENT) {
      return this.permanentlyDeleteSalaryAdjustment(currentUser, recordId);
    }

    if (entity === RecycleBinEntity.SALARY_PAYMENT) {
      return this.permanentlyDeleteSalaryPayment(currentUser, recordId);
    }

    if (entity === RecycleBinEntity.BANK_ACCOUNT) {
      return this.permanentlyDeleteBankAccount(currentUser, recordId);
    }

    if (entity === RecycleBinEntity.FEE_STRUCTURE) {
      return this.permanentlyDeleteFeeStructure(currentUser, recordId);
    }

    if (entity === RecycleBinEntity.STUDENT_DISCOUNT) {
      return this.permanentlyDeleteStudentDiscount(currentUser, recordId);
    }

    if (entity === RecycleBinEntity.STUDENT_FINE_RULE) {
      return this.permanentlyDeleteStudentFineRule(currentUser, recordId);
    }

    if (entity === RecycleBinEntity.STUDENT_FINE) {
      return this.permanentlyDeleteStudentFine(currentUser, recordId);
    }

    if (entity === RecycleBinEntity.FEE_VOUCHER) {
      return this.permanentlyDeleteFeeVoucher(currentUser, recordId);
    }

    if (entity === RecycleBinEntity.FEE_PAYMENT) {
      return this.permanentlyDeleteFeePayment(currentUser, recordId);
    }

    if (entity === RecycleBinEntity.ROLE) {
      return this.permanentlyDeleteRole(currentUser, recordId);
    }

    if (entity === RecycleBinEntity.ACADEMIC_YEAR) {
      return this.permanentlyDeleteAcademicYear(currentUser, recordId);
    }

    return this.permanentlyDeleteCampus(currentUser, recordId);
  }

  private async listDeletedUsers(
    institutionId: string | null,
    search?: string,
  ): Promise<RecycleBinItem[]> {
    const users = await this.prisma.user.findMany({
      where: {
        deletedAt: { not: null },
        ...(institutionId ? { institutionId } : {}),
        ...(search
          ? {
              OR: [
                {
                  name: {
                    contains: search,
                    mode: 'insensitive',
                  },
                },
                {
                  email: {
                    contains: search,
                    mode: 'insensitive',
                  },
                },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        status: true,
        institutionId: true,
        deletedAt: true,
        deletedBy: true,
        deleteReason: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { deletedAt: 'desc' },
    });

    return users.map((user) => ({
      entity: RecycleBinEntity.USER,
      id: user.id,
      label: user.name,
      subtitle: user.email,
      institutionId: user.institutionId,
      deletedAt: user.deletedAt!,
      deletedBy: user.deletedBy,
      deleteReason: user.deleteReason,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      metadata: {
        email: user.email,
        role: user.role,
        status: user.status,
      },
    }));
  }

  private async listDeletedCampuses(
    institutionId: string | null,
    search?: string,
  ): Promise<RecycleBinItem[]> {
    const campuses = await this.prisma.campus.findMany({
      where: {
        deletedAt: { not: null },
        ...(institutionId ? { institutionId } : {}),
        ...(search
          ? {
              OR: [
                {
                  name: {
                    contains: search,
                    mode: 'insensitive',
                  },
                },
                {
                  location: {
                    contains: search,
                    mode: 'insensitive',
                  },
                },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        name: true,
        location: true,
        institutionId: true,
        deletedAt: true,
        deletedBy: true,
        deleteReason: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { deletedAt: 'desc' },
    });

    return campuses.map((campus) => ({
      entity: RecycleBinEntity.CAMPUS,
      id: campus.id,
      label: campus.name,
      subtitle: campus.location,
      institutionId: campus.institutionId,
      deletedAt: campus.deletedAt!,
      deletedBy: campus.deletedBy,
      deleteReason: campus.deleteReason,
      createdAt: campus.createdAt,
      updatedAt: campus.updatedAt,
      metadata: {
        location: campus.location,
      },
    }));
  }

  private async listDeletedRoles(
    institutionId: string | null,
    search?: string,
  ): Promise<RecycleBinItem[]> {
    const templates = await this.prisma.role.findMany({
      where: {
        deletedAt: { not: null },
        ...(institutionId ? { institutionId } : {}),
        ...(search
          ? {
              OR: [
                {
                  name: {
                    contains: search,
                    mode: 'insensitive',
                  },
                },
                {
                  description: {
                    contains: search,
                    mode: 'insensitive',
                  },
                },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        institutionId: true,
        name: true,
        description: true,
        deletedAt: true,
        deletedBy: true,
        deleteReason: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { deletedAt: 'desc' },
    });

    return templates.map((template) => ({
      entity: RecycleBinEntity.ROLE,
      id: template.id,
      label: template.name,
      subtitle: template.description,
      institutionId: template.institutionId,
      deletedAt: template.deletedAt!,
      deletedBy: template.deletedBy,
      deleteReason: template.deleteReason,
      createdAt: template.createdAt,
      updatedAt: template.updatedAt,
      metadata: {},
    }));
  }

  private async listDeletedStudents(
    institutionId: string | null,
    search?: string,
  ): Promise<RecycleBinItem[]> {
    const items = await this.prisma.student.findMany({
      where: {
        deletedAt: { not: null },
        ...(institutionId ? { campus: { institutionId } } : {}),
        ...(search
          ? {
              OR: [
                { regNo: { contains: search, mode: 'insensitive' } },
                { user: { name: { contains: search, mode: 'insensitive' } } },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        regNo: true,
        campus: { select: { institutionId: true } },
        deletedAt: true,
        deletedBy: true,
        deleteReason: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { deletedAt: 'desc' },
    });

    return items.map((item) => ({
      entity: RecycleBinEntity.STUDENT,
      id: item.id,
      label: item.regNo,
      subtitle: 'Student',
      institutionId: item.campus.institutionId,
      deletedAt: item.deletedAt!,
      deletedBy: item.deletedBy,
      deleteReason: item.deleteReason,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      metadata: {
        regNo: item.regNo,
      },
    }));
  }

  private async listDeletedGuardians(
    institutionId: string | null,
    search?: string,
  ): Promise<RecycleBinItem[]> {
    const items = await this.prisma.guardian.findMany({
      where: {
        deletedAt: { not: null },
        ...(institutionId ? { campus: { institutionId } } : {}),
        ...(search
          ? {
              OR: [
                { user: { name: { contains: search, mode: 'insensitive' } } },
                { user: { email: { contains: search, mode: 'insensitive' } } },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        relation: true,
        campus: { select: { institutionId: true } },
        deletedAt: true,
        deletedBy: true,
        deleteReason: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { deletedAt: 'desc' },
    });

    return items.map((item) => ({
      entity: RecycleBinEntity.GUARDIAN,
      id: item.id,
      label: item.relation,
      subtitle: 'Guardian',
      institutionId: item.campus.institutionId,
      deletedAt: item.deletedAt!,
      deletedBy: item.deletedBy,
      deleteReason: item.deleteReason,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      metadata: {
        relation: item.relation,
      },
    }));
  }

  private async listDeletedTeachers(
    institutionId: string | null,
    search?: string,
  ): Promise<RecycleBinItem[]> {
    const items = await this.prisma.teacher.findMany({
      where: {
        deletedAt: { not: null },
        ...(institutionId ? { campus: { institutionId } } : {}),
        ...(search
          ? {
              OR: [
                { cnic: { contains: search, mode: 'insensitive' } },
                { user: { name: { contains: search, mode: 'insensitive' } } },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        cnic: true,
        campus: { select: { institutionId: true } },
        deletedAt: true,
        deletedBy: true,
        deleteReason: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { deletedAt: 'desc' },
    });

    return items.map((item) => ({
      entity: RecycleBinEntity.TEACHER,
      id: item.id,
      label: item.cnic ?? item.id,
      subtitle: 'Teacher',
      institutionId: item.campus.institutionId,
      deletedAt: item.deletedAt!,
      deletedBy: item.deletedBy,
      deleteReason: item.deleteReason,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      metadata: {
        cnic: item.cnic,
      },
    }));
  }

  private async listDeletedLevels(
    institutionId: string | null,
    search?: string,
  ): Promise<RecycleBinItem[]> {
    const items = await this.prisma.level.findMany({
      where: {
        deletedAt: { not: null },
        ...(institutionId ? { campus: { institutionId } } : {}),
        ...(search ? { name: { contains: search, mode: 'insensitive' } } : {}),
      },
      select: {
        id: true,
        name: true,
        campus: { select: { institutionId: true } },
        deletedAt: true,
        deletedBy: true,
        deleteReason: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { deletedAt: 'desc' },
    });
    return items.map((item) => ({
      entity: RecycleBinEntity.LEVEL,
      id: item.id,
      label: item.name,
      subtitle: 'Level',
      institutionId: item.campus.institutionId,
      deletedAt: item.deletedAt!,
      deletedBy: item.deletedBy,
      deleteReason: item.deleteReason,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      metadata: { name: item.name },
    }));
  }

  private async listDeletedClasses(
    institutionId: string | null,
    search?: string,
  ): Promise<RecycleBinItem[]> {
    const items = await this.prisma.academicClass.findMany({
      where: {
        deletedAt: { not: null },
        ...(institutionId ? { level: { campus: { institutionId } } } : {}),
        ...(search ? { name: { contains: search, mode: 'insensitive' } } : {}),
      },
      select: {
        id: true,
        name: true,
        level: { select: { campus: { select: { institutionId: true } } } },
        deletedAt: true,
        deletedBy: true,
        deleteReason: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { deletedAt: 'desc' },
    });
    return items.map((item) => ({
      entity: RecycleBinEntity.CLASS,
      id: item.id,
      label: item.name,
      subtitle: 'Class',
      institutionId: item.level.campus.institutionId,
      deletedAt: item.deletedAt!,
      deletedBy: item.deletedBy,
      deleteReason: item.deleteReason,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      metadata: { name: item.name },
    }));
  }

  private async listDeletedSections(
    institutionId: string | null,
    search?: string,
  ): Promise<RecycleBinItem[]> {
    const items = await this.prisma.section.findMany({
      where: {
        deletedAt: { not: null },
        ...(institutionId
          ? { class: { level: { campus: { institutionId } } } }
          : {}),
        ...(search ? { name: { contains: search, mode: 'insensitive' } } : {}),
      },
      select: {
        id: true,
        name: true,
        class: {
          select: {
            level: { select: { campus: { select: { institutionId: true } } } },
          },
        },
        deletedAt: true,
        deletedBy: true,
        deleteReason: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { deletedAt: 'desc' },
    });
    return items.map((item) => ({
      entity: RecycleBinEntity.SECTION,
      id: item.id,
      label: item.name,
      subtitle: 'Section',
      institutionId: item.class.level.campus.institutionId,
      deletedAt: item.deletedAt!,
      deletedBy: item.deletedBy,
      deleteReason: item.deleteReason,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      metadata: { name: item.name },
    }));
  }

  private async listDeletedSubjects(
    institutionId: string | null,
    search?: string,
  ): Promise<RecycleBinItem[]> {
    const items = await this.prisma.subject.findMany({
      where: {
        deletedAt: { not: null },
        ...(institutionId
          ? { class: { level: { campus: { institutionId } } } }
          : {}),
        ...(search ? { name: { contains: search, mode: 'insensitive' } } : {}),
      },
      select: {
        id: true,
        name: true,
        class: {
          select: {
            level: { select: { campus: { select: { institutionId: true } } } },
          },
        },
        deletedAt: true,
        deletedBy: true,
        deleteReason: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { deletedAt: 'desc' },
    });
    return items.map((item) => ({
      entity: RecycleBinEntity.SUBJECT,
      id: item.id,
      label: item.name,
      subtitle: 'Subject',
      institutionId: item.class.level.campus.institutionId,
      deletedAt: item.deletedAt!,
      deletedBy: item.deletedBy,
      deleteReason: item.deleteReason,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      metadata: { name: item.name },
    }));
  }

  private async listDeletedSalaries(
    institutionId: string | null,
    search?: string,
  ): Promise<RecycleBinItem[]> {
    const items = await this.prisma.staffSalary.findMany({
      where: {
        deletedAt: { not: null },
        ...(institutionId ? { campus: { institutionId } } : {}),
        ...(search
          ? { user: { name: { contains: search, mode: 'insensitive' } } }
          : {}),
      },
      select: {
        id: true,
        userId: true,
        campus: { select: { institutionId: true } },
        deletedAt: true,
        deletedBy: true,
        deleteReason: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { deletedAt: 'desc' },
    });
    return items.map((item) => ({
      entity: RecycleBinEntity.SALARY,
      id: item.id,
      label: item.userId,
      subtitle: 'Salary',
      institutionId: item.campus.institutionId,
      deletedAt: item.deletedAt!,
      deletedBy: item.deletedBy,
      deleteReason: item.deleteReason,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      metadata: { userId: item.userId },
    }));
  }

  private async listDeletedSalaryDeductionRules(
    institutionId: string | null,
    search?: string,
  ): Promise<RecycleBinItem[]> {
    const items = await this.prisma.salaryDeductionRule.findMany({
      where: {
        deletedAt: { not: null },
        ...(institutionId ? { campus: { institutionId } } : {}),
        ...(search
          ? { campus: { name: { contains: search, mode: 'insensitive' } } }
          : {}),
      },
      select: {
        id: true,
        campusId: true,
        campus: { select: { institutionId: true } },
        deletedAt: true,
        deletedBy: true,
        deleteReason: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { deletedAt: 'desc' },
    });
    return items.map((item) => ({
      entity: RecycleBinEntity.SALARY_DEDUCTION_RULE,
      id: item.id,
      label: item.campusId,
      subtitle: 'Salary deduction rule',
      institutionId: item.campus.institutionId,
      deletedAt: item.deletedAt!,
      deletedBy: item.deletedBy,
      deleteReason: item.deleteReason,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      metadata: { campusId: item.campusId },
    }));
  }

  private async listDeletedSalaryAdjustments(
    institutionId: string | null,
    search?: string,
  ): Promise<RecycleBinItem[]> {
    const items = await this.prisma.salaryAdjustment.findMany({
      where: {
        deletedAt: { not: null },
        ...(institutionId ? { campus: { institutionId } } : {}),
        ...(search
          ? { campus: { name: { contains: search, mode: 'insensitive' } } }
          : {}),
      },
      select: {
        id: true,
        userId: true,
        salaryId: true,
        campus: { select: { institutionId: true } },
        deletedAt: true,
        deletedBy: true,
        deleteReason: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { deletedAt: 'desc' },
    });
    return items.map((item) => ({
      entity: RecycleBinEntity.SALARY_ADJUSTMENT,
      id: item.id,
      label: item.userId,
      subtitle: 'Salary adjustment',
      institutionId: item.campus.institutionId,
      deletedAt: item.deletedAt!,
      deletedBy: item.deletedBy,
      deleteReason: item.deleteReason,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      metadata: {
        userId: item.userId,
        salaryId: item.salaryId,
      },
    }));
  }

  private async listDeletedSalaryPayments(
    institutionId: string | null,
    search?: string,
  ): Promise<RecycleBinItem[]> {
    const items = await this.prisma.salaryPayment.findMany({
      where: {
        deletedAt: { not: null },
        ...(institutionId ? { campus: { institutionId } } : {}),
        ...(search
          ? { campus: { name: { contains: search, mode: 'insensitive' } } }
          : {}),
      },
      select: {
        id: true,
        userId: true,
        salaryId: true,
        campus: { select: { institutionId: true } },
        deletedAt: true,
        deletedBy: true,
        deleteReason: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { deletedAt: 'desc' },
    });
    return items.map((item) => ({
      entity: RecycleBinEntity.SALARY_PAYMENT,
      id: item.id,
      label: item.userId,
      subtitle: 'Salary payment',
      institutionId: item.campus.institutionId,
      deletedAt: item.deletedAt!,
      deletedBy: item.deletedBy,
      deleteReason: item.deleteReason,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      metadata: {
        userId: item.userId,
        salaryId: item.salaryId,
      },
    }));
  }

  private async listDeletedBankAccounts(
    institutionId: string | null,
    search?: string,
  ): Promise<RecycleBinItem[]> {
    const items = await this.prisma.bankAccount.findMany({
      where: {
        deletedAt: { not: null },
        ...(institutionId ? { campus: { institutionId } } : {}),
        ...(search
          ? {
              OR: [
                {
                  accountTitle: {
                    contains: search,
                    mode: 'insensitive',
                  },
                },
                {
                  bankName: {
                    contains: search,
                    mode: 'insensitive',
                  },
                },
                {
                  accountNumber: {
                    contains: search,
                    mode: 'insensitive',
                  },
                },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        campusId: true,
        bankName: true,
        accountTitle: true,
        accountNumber: true,
        campus: { select: { institutionId: true } },
        deletedAt: true,
        deletedBy: true,
        deleteReason: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { deletedAt: 'desc' },
    });
    return items.map((item) => ({
      entity: RecycleBinEntity.BANK_ACCOUNT,
      id: item.id,
      label: item.accountTitle,
      subtitle: item.bankName,
      institutionId: item.campus.institutionId,
      deletedAt: item.deletedAt!,
      deletedBy: item.deletedBy,
      deleteReason: item.deleteReason,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      metadata: {
        campusId: item.campusId,
        bankName: item.bankName,
        accountNumber: item.accountNumber,
      },
    }));
  }

  private async listDeletedFeeStructures(
    institutionId: string | null,
    search?: string,
  ): Promise<RecycleBinItem[]> {
    const items = await this.prisma.feeStructure.findMany({
      where: {
        deletedAt: { not: null },
        ...(institutionId ? { campus: { institutionId } } : {}),
        ...(search
          ? { class: { name: { contains: search, mode: 'insensitive' } } }
          : {}),
      },
      select: {
        id: true,
        campusId: true,
        classId: true,
        campus: { select: { institutionId: true } },
        deletedAt: true,
        deletedBy: true,
        deleteReason: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { deletedAt: 'desc' },
    });
    return items.map((item) => ({
      entity: RecycleBinEntity.FEE_STRUCTURE,
      id: item.id,
      label: item.classId,
      subtitle: 'Fee structure',
      institutionId: item.campus.institutionId,
      deletedAt: item.deletedAt!,
      deletedBy: item.deletedBy,
      deleteReason: item.deleteReason,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      metadata: {
        campusId: item.campusId,
        classId: item.classId,
      },
    }));
  }

  private async listDeletedStudentDiscounts(
    institutionId: string | null,
    search?: string,
  ): Promise<RecycleBinItem[]> {
    const items = await this.prisma.studentDiscount.findMany({
      where: {
        deletedAt: { not: null },
        ...(institutionId ? { student: { campus: { institutionId } } } : {}),
        ...(search
          ? { student: { regNo: { contains: search, mode: 'insensitive' } } }
          : {}),
      },
      select: {
        id: true,
        studentId: true,
        student: {
          select: {
            regNo: true,
            campus: {
              select: {
                institutionId: true,
              },
            },
          },
        },
        deletedAt: true,
        deletedBy: true,
        deleteReason: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { deletedAt: 'desc' },
    });
    return items.map((item) => ({
      entity: RecycleBinEntity.STUDENT_DISCOUNT,
      id: item.id,
      label: item.student.regNo,
      subtitle: 'Student discount',
      institutionId: item.student.campus.institutionId,
      deletedAt: item.deletedAt!,
      deletedBy: item.deletedBy,
      deleteReason: item.deleteReason,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      metadata: { studentId: item.studentId },
    }));
  }

  private async listDeletedStudentFineRules(
    institutionId: string | null,
    search?: string,
  ): Promise<RecycleBinItem[]> {
    const items = await this.prisma.studentFineRule.findMany({
      where: {
        deletedAt: { not: null },
        ...(institutionId ? { campus: { institutionId } } : {}),
        ...(search
          ? {
              OR: [
                { campus: { name: { contains: search, mode: 'insensitive' } } },
                { class: { name: { contains: search, mode: 'insensitive' } } },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        campusId: true,
        classId: true,
        campus: { select: { institutionId: true } },
        deletedAt: true,
        deletedBy: true,
        deleteReason: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { deletedAt: 'desc' },
    });
    return items.map((item) => ({
      entity: RecycleBinEntity.STUDENT_FINE_RULE,
      id: item.id,
      label: item.classId ?? item.campusId,
      subtitle: 'Student fine rule',
      institutionId: item.campus.institutionId,
      deletedAt: item.deletedAt!,
      deletedBy: item.deletedBy,
      deleteReason: item.deleteReason,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      metadata: {
        campusId: item.campusId,
        classId: item.classId,
      },
    }));
  }

  private async listDeletedStudentFines(
    institutionId: string | null,
    search?: string,
  ): Promise<RecycleBinItem[]> {
    const items = await this.prisma.studentFine.findMany({
      where: {
        deletedAt: { not: null },
        ...(institutionId ? { campus: { institutionId } } : {}),
        ...(search
          ? { student: { regNo: { contains: search, mode: 'insensitive' } } }
          : {}),
      },
      select: {
        id: true,
        studentId: true,
        month: true,
        year: true,
        student: {
          select: {
            regNo: true,
            campus: {
              select: {
                institutionId: true,
              },
            },
          },
        },
        deletedAt: true,
        deletedBy: true,
        deleteReason: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { deletedAt: 'desc' },
    });
    return items.map((item) => ({
      entity: RecycleBinEntity.STUDENT_FINE,
      id: item.id,
      label: item.student.regNo,
      subtitle: `${item.month}/${item.year}`,
      institutionId: item.student.campus.institutionId,
      deletedAt: item.deletedAt!,
      deletedBy: item.deletedBy,
      deleteReason: item.deleteReason,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      metadata: {
        studentId: item.studentId,
        month: item.month,
        year: item.year,
      },
    }));
  }

  private async listDeletedFeeVouchers(
    institutionId: string | null,
    search?: string,
  ): Promise<RecycleBinItem[]> {
    const items = await this.prisma.feeVoucher.findMany({
      where: {
        deletedAt: { not: null },
        ...(institutionId ? { student: { campus: { institutionId } } } : {}),
        ...(search
          ? { student: { regNo: { contains: search, mode: 'insensitive' } } }
          : {}),
      },
      select: {
        id: true,
        studentId: true,
        feeStructureId: true,
        month: true,
        year: true,
        student: {
          select: {
            regNo: true,
            campus: {
              select: {
                institutionId: true,
              },
            },
          },
        },
        deletedAt: true,
        deletedBy: true,
        deleteReason: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { deletedAt: 'desc' },
    });
    return items.map((item) => ({
      entity: RecycleBinEntity.FEE_VOUCHER,
      id: item.id,
      label: item.student.regNo,
      subtitle: `${item.month}/${item.year}`,
      institutionId: item.student.campus.institutionId,
      deletedAt: item.deletedAt!,
      deletedBy: item.deletedBy,
      deleteReason: item.deleteReason,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      metadata: {
        studentId: item.studentId,
        feeStructureId: item.feeStructureId,
        month: item.month,
        year: item.year,
      },
    }));
  }

  private async listDeletedFeePayments(
    institutionId: string | null,
    search?: string,
  ): Promise<RecycleBinItem[]> {
    const items = await this.prisma.feePayment.findMany({
      where: {
        deletedAt: { not: null },
        ...(institutionId
          ? { voucher: { student: { campus: { institutionId } } } }
          : {}),
        ...(search
          ? {
              voucher: {
                student: { regNo: { contains: search, mode: 'insensitive' } },
              },
            }
          : {}),
      },
      select: {
        id: true,
        voucherId: true,
        month: true,
        year: true,
        voucher: {
          select: {
            student: {
              select: {
                regNo: true,
                campus: {
                  select: {
                    institutionId: true,
                  },
                },
              },
            },
          },
        },
        deletedAt: true,
        deletedBy: true,
        deleteReason: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { deletedAt: 'desc' },
    });
    return items.map((item) => ({
      entity: RecycleBinEntity.FEE_PAYMENT,
      id: item.id,
      label: item.voucher.student.regNo,
      subtitle: `${item.month}/${item.year}`,
      institutionId: item.voucher.student.campus.institutionId,
      deletedAt: item.deletedAt!,
      deletedBy: item.deletedBy,
      deleteReason: item.deleteReason,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      metadata: {
        voucherId: item.voucherId,
        month: item.month,
        year: item.year,
      },
    }));
  }

  private async listDeletedAcademicYears(
    institutionId: string | null,
    search?: string,
  ): Promise<RecycleBinItem[]> {
    const items = await this.prisma.academicYear.findMany({
      where: {
        deletedAt: { not: null },
        ...(institutionId ? { institutionId } : {}),
        ...(search ? { name: { contains: search, mode: 'insensitive' } } : {}),
      },
      select: {
        id: true,
        name: true,
        institutionId: true,
        deletedAt: true,
        deletedBy: true,
        deleteReason: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { deletedAt: 'desc' },
    });
    return items.map((item) => ({
      entity: RecycleBinEntity.ACADEMIC_YEAR,
      id: item.id,
      label: item.name,
      subtitle: 'Academic Year',
      institutionId: item.institutionId,
      deletedAt: item.deletedAt!,
      deletedBy: item.deletedBy,
      deleteReason: item.deleteReason,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      metadata: { name: item.name },
    }));
  }

  private async restoreUser(currentUser: CurrentUser, userId: string) {
    const target = await this.prisma.user.findFirst({
      where: {
        id: userId,
        deletedAt: {
          not: null,
        },
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        status: true,
        institutionId: true,
        deletedAt: true,
      },
    });

    if (!target) {
      throw new NotFoundException('Deleted user not found.');
    }

    this.assertUserScope(currentUser, target);

    const restoredUser = await this.prisma.user.update({
      where: {
        id: userId,
        deletedAt: {
          not: null,
        },
      },
      data: {
        deletedAt: null,
        deletedBy: null,
        deleteReason: null,
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        status: true,
        institutionId: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    await this.auditLogService.log(currentUser, {
      action: 'USER_RESTORED',
      entity: 'User',
      entityId: userId,
      institutionId: restoredUser.institutionId,
      metadata: {
        email: restoredUser.email,
        role: restoredUser.role,
        status: restoredUser.status,
      },
    });

    return {
      message: 'User restored successfully',
      data: restoredUser,
    };
  }

  private async permanentlyDeleteUser(
    currentUser: CurrentUser,
    userId: string,
  ) {
    if (currentUser.sub === userId) {
      throw new ForbiddenException(
        'You cannot permanently delete your own account.',
      );
    }

    const target = await this.prisma.user.findFirst({
      where: {
        id: userId,
        deletedAt: {
          not: null,
        },
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        status: true,
        institutionId: true,
        deletedAt: true,
      },
    });

    if (!target) {
      throw new NotFoundException('Deleted user not found.');
    }

    this.assertUserScope(currentUser, target);
    await this.assertPurgeSafe(
      RecycleBinEntity.USER,
      userId,
      target.deletedAt!,
      target.institutionId,
    );

    await this.requestContext.runWith({ allowHardDelete: true }, async () => {
      await this.prisma.user.delete({
        where: {
          id: userId,
          deletedAt: {
            not: null,
          },
        },
      });
    });

    await this.auditLogService.log(currentUser, {
      action: 'USER_PERMANENTLY_DELETED',
      entity: 'User',
      entityId: userId,
      institutionId: target.institutionId,
      metadata: {
        email: target.email,
        role: target.role,
        status: target.status,
      },
    });

    return {
      message: 'User permanently deleted successfully',
      data: { id: userId },
    };
  }

  private async restoreCampus(currentUser: CurrentUser, campusId: string) {
    const campus = await this.prisma.campus.findFirst({
      where: {
        id: campusId,
        deletedAt: {
          not: null,
        },
      },
      select: {
        id: true,
        name: true,
        location: true,
        institutionId: true,
        deletedAt: true,
      },
    });

    if (!campus) {
      throw new NotFoundException('Deleted campus not found.');
    }

    this.assertCampusScope(currentUser, campus.institutionId);

    const restoredCampus = await this.prisma.campus.update({
      where: {
        id: campusId,
        deletedAt: {
          not: null,
        },
      },
      data: {
        deletedAt: null,
        deletedBy: null,
        deleteReason: null,
      },
      select: {
        id: true,
        name: true,
        location: true,
        institutionId: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    await this.auditLogService.log(currentUser, {
      action: 'CAMPUS_RESTORED',
      entity: 'Campus',
      entityId: campusId,
      institutionId: restoredCampus.institutionId,
      metadata: {
        name: restoredCampus.name,
        location: restoredCampus.location,
      },
    });

    return {
      message: 'Campus restored successfully',
      data: restoredCampus,
    };
  }

  private async restoreRole(currentUser: CurrentUser, roleId: string) {
    const template = await this.prisma.role.findFirst({
      where: {
        id: roleId,
        deletedAt: {
          not: null,
        },
      },
      select: {
        id: true,
        institutionId: true,
        name: true,
        description: true,
      },
    });

    if (!template) {
      throw new NotFoundException('Deleted role not found.');
    }

    this.assertInstitutionScope(currentUser, template.institutionId);

    const restoredTemplate = await this.prisma.role.update({
      where: {
        id: roleId,
        deletedAt: {
          not: null,
        },
      },
      data: {
        deletedAt: null,
        deletedBy: null,
        deleteReason: null,
      },
    });

    await this.auditLogService.log(currentUser, {
      action: 'ROLE_RESTORED',
      entity: 'Role',
      entityId: roleId,
      institutionId: template.institutionId,
      metadata: {
        name: restoredTemplate.name,
      },
    });

    return {
      message: 'Role restored successfully',
      data: restoredTemplate,
    };
  }

  private async restoreAcademicYear(
    currentUser: CurrentUser,
    academicYearId: string,
  ) {
    const item = await this.prisma.academicYear.findFirst({
      where: { id: academicYearId, deletedAt: { not: null } },
      select: { id: true, name: true, institutionId: true },
    });
    if (!item) throw new NotFoundException('Deleted academic year not found.');
    this.assertInstitutionScope(currentUser, item.institutionId);
    const restored = await this.prisma.academicYear.update({
      where: { id: academicYearId, deletedAt: { not: null } },
      data: { deletedAt: null, deletedBy: null, deleteReason: null },
    });
    await this.auditLogService.log(currentUser, {
      action: 'ACADEMIC_YEAR_RESTORED',
      entity: 'AcademicYear',
      entityId: academicYearId,
      institutionId: item.institutionId,
      metadata: { name: item.name },
    });
    return {
      message: 'Academic year restored successfully',
      data: restored,
    };
  }

  private async restoreStudent(currentUser: CurrentUser, studentId: string) {
    const item = await this.prisma.student.findFirst({
      where: { id: studentId, deletedAt: { not: null } },
      select: {
        id: true,
        regNo: true,
        campus: { select: { institutionId: true } },
      },
    });
    if (!item) throw new NotFoundException('Deleted student not found.');
    this.assertInstitutionScope(currentUser, item.campus.institutionId!);
    const restored = await this.prisma.student.update({
      where: { id: studentId, deletedAt: { not: null } },
      data: { deletedAt: null, deletedBy: null, deleteReason: null },
    });
    await this.auditLogService.log(currentUser, {
      action: 'STUDENT_RESTORED',
      entity: 'Student',
      entityId: studentId,
      institutionId: item.campus.institutionId,
      metadata: { regNo: item.regNo },
    });
    return { message: 'Student restored successfully', data: restored };
  }

  private async restoreGuardian(currentUser: CurrentUser, guardianId: string) {
    const item = await this.prisma.guardian.findFirst({
      where: { id: guardianId, deletedAt: { not: null } },
      select: {
        id: true,
        relation: true,
        campus: { select: { institutionId: true } },
      },
    });
    if (!item) throw new NotFoundException('Deleted guardian not found.');
    this.assertInstitutionScope(currentUser, item.campus.institutionId!);
    const restored = await this.prisma.guardian.update({
      where: { id: guardianId, deletedAt: { not: null } },
      data: { deletedAt: null, deletedBy: null, deleteReason: null },
    });
    await this.auditLogService.log(currentUser, {
      action: 'GUARDIAN_RESTORED',
      entity: 'Guardian',
      entityId: guardianId,
      institutionId: item.campus.institutionId,
      metadata: { relation: item.relation },
    });
    return { message: 'Guardian restored successfully', data: restored };
  }

  private async restoreTeacher(currentUser: CurrentUser, teacherId: string) {
    const item = await this.prisma.teacher.findFirst({
      where: { id: teacherId, deletedAt: { not: null } },
      select: {
        id: true,
        cnic: true,
        campus: { select: { institutionId: true } },
      },
    });
    if (!item) throw new NotFoundException('Deleted teacher not found.');
    this.assertInstitutionScope(currentUser, item.campus.institutionId!);
    const restored = await this.prisma.teacher.update({
      where: { id: teacherId, deletedAt: { not: null } },
      data: { deletedAt: null, deletedBy: null, deleteReason: null },
    });
    await this.auditLogService.log(currentUser, {
      action: 'TEACHER_RESTORED',
      entity: 'Teacher',
      entityId: teacherId,
      institutionId: item.campus.institutionId,
      metadata: { cnic: item.cnic },
    });
    return { message: 'Teacher restored successfully', data: restored };
  }

  private async restoreLevel(currentUser: CurrentUser, levelId: string) {
    const item = await this.prisma.level.findFirst({
      where: { id: levelId, deletedAt: { not: null } },
      select: {
        name: true,
        campus: { select: { institutionId: true } },
      },
    });
    if (!item) throw new NotFoundException('Deleted level not found.');
    this.assertInstitutionScope(currentUser, item.campus.institutionId!);
    const restored = await this.prisma.level.update({
      where: { id: levelId, deletedAt: { not: null } },
      data: { deletedAt: null, deletedBy: null, deleteReason: null },
    });
    await this.auditLogService.log(currentUser, {
      action: 'LEVEL_RESTORED',
      entity: 'Level',
      entityId: levelId,
      institutionId: item.campus.institutionId,
      metadata: { name: item.name },
    });
    return { message: 'Level restored successfully', data: restored };
  }

  private async restoreClass(currentUser: CurrentUser, classId: string) {
    const item = await this.prisma.academicClass.findFirst({
      where: { id: classId, deletedAt: { not: null } },
      select: {
        name: true,
        level: { select: { campus: { select: { institutionId: true } } } },
      },
    });
    if (!item) throw new NotFoundException('Deleted class not found.');
    this.assertInstitutionScope(currentUser, item.level.campus.institutionId!);
    const restored = await this.prisma.academicClass.update({
      where: { id: classId, deletedAt: { not: null } },
      data: { deletedAt: null, deletedBy: null, deleteReason: null },
    });
    await this.auditLogService.log(currentUser, {
      action: 'CLASS_RESTORED',
      entity: 'AcademicClass',
      entityId: classId,
      institutionId: item.level.campus.institutionId,
      metadata: { name: item.name },
    });
    return { message: 'Class restored successfully', data: restored };
  }

  private async restoreSection(currentUser: CurrentUser, sectionId: string) {
    const item = await this.prisma.section.findFirst({
      where: { id: sectionId, deletedAt: { not: null } },
      select: {
        name: true,
        class: {
          select: {
            level: { select: { campus: { select: { institutionId: true } } } },
          },
        },
      },
    });
    if (!item) throw new NotFoundException('Deleted section not found.');
    this.assertInstitutionScope(
      currentUser,
      item.class.level.campus.institutionId!,
    );
    const restored = await this.prisma.section.update({
      where: { id: sectionId, deletedAt: { not: null } },
      data: { deletedAt: null, deletedBy: null, deleteReason: null },
    });
    await this.auditLogService.log(currentUser, {
      action: 'SECTION_RESTORED',
      entity: 'Section',
      entityId: sectionId,
      institutionId: item.class.level.campus.institutionId,
      metadata: { name: item.name },
    });
    return { message: 'Section restored successfully', data: restored };
  }

  private async restoreSubject(currentUser: CurrentUser, subjectId: string) {
    const item = await this.prisma.subject.findFirst({
      where: { id: subjectId, deletedAt: { not: null } },
      select: {
        name: true,
        class: {
          select: {
            level: { select: { campus: { select: { institutionId: true } } } },
          },
        },
      },
    });
    if (!item) throw new NotFoundException('Deleted subject not found.');
    this.assertInstitutionScope(
      currentUser,
      item.class.level.campus.institutionId!,
    );
    const restored = await this.prisma.subject.update({
      where: { id: subjectId, deletedAt: { not: null } },
      data: { deletedAt: null, deletedBy: null, deleteReason: null },
    });
    await this.auditLogService.log(currentUser, {
      action: 'SUBJECT_RESTORED',
      entity: 'Subject',
      entityId: subjectId,
      institutionId: item.class.level.campus.institutionId,
      metadata: { name: item.name },
    });
    return { message: 'Subject restored successfully', data: restored };
  }

  private async restoreSalary(currentUser: CurrentUser, salaryId: string) {
    const item = await this.prisma.staffSalary.findFirst({
      where: { id: salaryId, deletedAt: { not: null } },
      select: {
        userId: true,
        campus: { select: { institutionId: true } },
      },
    });
    if (!item) throw new NotFoundException('Deleted salary record not found.');
    const institutionId = this.requireInstitutionId(
      item.campus.institutionId,
      'Deleted salary record',
    );
    this.assertInstitutionScope(currentUser, institutionId);
    const restored = await this.prisma.staffSalary.update({
      where: { id: salaryId, deletedAt: { not: null } },
      data: { deletedAt: null, deletedBy: null, deleteReason: null },
    });
    await this.auditLogService.log(currentUser, {
      action: 'SALARY_RESTORED',
      entity: 'StaffSalary',
      entityId: salaryId,
      institutionId,
      metadata: { userId: item.userId },
    });
    return { message: 'Salary restored successfully', data: restored };
  }

  private async restoreSalaryDeductionRule(
    currentUser: CurrentUser,
    ruleId: string,
  ) {
    const item = await this.prisma.salaryDeductionRule.findFirst({
      where: { id: ruleId, deletedAt: { not: null } },
      select: {
        campus: { select: { institutionId: true } },
      },
    });
    if (!item) {
      throw new NotFoundException('Deleted salary deduction rule not found.');
    }
    const institutionId = this.requireInstitutionId(
      item.campus.institutionId,
      'Deleted salary deduction rule',
    );
    this.assertInstitutionScope(currentUser, institutionId);
    const restored = await this.prisma.salaryDeductionRule.update({
      where: { id: ruleId, deletedAt: { not: null } },
      data: { deletedAt: null, deletedBy: null, deleteReason: null },
    });
    await this.auditLogService.log(currentUser, {
      action: 'SALARY_DEDUCTION_RULE_RESTORED',
      entity: 'SalaryDeductionRule',
      entityId: ruleId,
      institutionId,
      metadata: {},
    });
    return {
      message: 'Salary deduction rule restored successfully',
      data: restored,
    };
  }

  private async restoreSalaryAdjustment(
    currentUser: CurrentUser,
    adjustmentId: string,
  ) {
    const item = await this.prisma.salaryAdjustment.findFirst({
      where: { id: adjustmentId, deletedAt: { not: null } },
      select: {
        userId: true,
        salaryId: true,
        campus: { select: { institutionId: true } },
      },
    });
    if (!item)
      throw new NotFoundException('Deleted salary adjustment not found.');
    const institutionId = this.requireInstitutionId(
      item.campus.institutionId,
      'Deleted salary adjustment',
    );
    this.assertInstitutionScope(currentUser, institutionId);
    const restored = await this.prisma.salaryAdjustment.update({
      where: { id: adjustmentId, deletedAt: { not: null } },
      data: { deletedAt: null, deletedBy: null, deleteReason: null },
    });
    await this.auditLogService.log(currentUser, {
      action: 'SALARY_ADJUSTMENT_RESTORED',
      entity: 'SalaryAdjustment',
      entityId: adjustmentId,
      institutionId,
      metadata: {
        userId: item.userId,
        salaryId: item.salaryId,
      },
    });
    return {
      message: 'Salary adjustment restored successfully',
      data: restored,
    };
  }

  private async restoreSalaryPayment(
    currentUser: CurrentUser,
    paymentId: string,
  ) {
    const item = await this.prisma.salaryPayment.findFirst({
      where: { id: paymentId, deletedAt: { not: null } },
      select: {
        userId: true,
        salaryId: true,
        campus: { select: { institutionId: true } },
      },
    });
    if (!item) throw new NotFoundException('Deleted salary payment not found.');
    const institutionId = this.requireInstitutionId(
      item.campus.institutionId,
      'Deleted salary payment',
    );
    this.assertInstitutionScope(currentUser, institutionId);
    const restored = await this.prisma.salaryPayment.update({
      where: { id: paymentId, deletedAt: { not: null } },
      data: { deletedAt: null, deletedBy: null, deleteReason: null },
    });
    await this.prisma.salaryDeductionSummary.updateMany({
      where: { salaryPaymentId: paymentId, deletedAt: { not: null } },
      data: { deletedAt: null, deletedBy: null, deleteReason: null },
    });
    await this.auditLogService.log(currentUser, {
      action: 'SALARY_PAYMENT_RESTORED',
      entity: 'SalaryPayment',
      entityId: paymentId,
      institutionId,
      metadata: {
        userId: item.userId,
        salaryId: item.salaryId,
      },
    });
    return { message: 'Salary payment restored successfully', data: restored };
  }

  private async restoreBankAccount(
    currentUser: CurrentUser,
    bankAccountId: string,
  ) {
    const item = await this.prisma.bankAccount.findFirst({
      where: { id: bankAccountId, deletedAt: { not: null } },
      select: {
        bankName: true,
        accountTitle: true,
        accountNumber: true,
        campus: { select: { institutionId: true } },
      },
    });
    if (!item) throw new NotFoundException('Deleted bank account not found.');
    const institutionId = this.requireInstitutionId(
      item.campus.institutionId,
      'Deleted bank account',
    );
    this.assertInstitutionScope(currentUser, institutionId);
    const restored = await this.prisma.bankAccount.update({
      where: { id: bankAccountId, deletedAt: { not: null } },
      data: { deletedAt: null, deletedBy: null, deleteReason: null },
    });
    await this.auditLogService.log(currentUser, {
      action: 'BANK_ACCOUNT_RESTORED',
      entity: 'BankAccount',
      entityId: bankAccountId,
      institutionId,
      metadata: {
        bankName: item.bankName,
        accountTitle: item.accountTitle,
        accountNumber: item.accountNumber,
      },
    });
    return { message: 'Bank account restored successfully', data: restored };
  }

  private async restoreFeeStructure(
    currentUser: CurrentUser,
    feeStructureId: string,
  ) {
    const item = await this.prisma.feeStructure.findFirst({
      where: { id: feeStructureId, deletedAt: { not: null } },
      select: {
        classId: true,
        campus: { select: { institutionId: true } },
      },
    });
    if (!item) throw new NotFoundException('Deleted fee structure not found.');
    const institutionId = this.requireInstitutionId(
      item.campus.institutionId,
      'Deleted fee structure',
    );
    this.assertInstitutionScope(currentUser, institutionId);
    const restored = await this.prisma.feeStructure.update({
      where: { id: feeStructureId, deletedAt: { not: null } },
      data: { deletedAt: null, deletedBy: null, deleteReason: null },
    });
    await this.auditLogService.log(currentUser, {
      action: 'FEE_STRUCTURE_RESTORED',
      entity: 'FeeStructure',
      entityId: feeStructureId,
      institutionId,
      metadata: { classId: item.classId },
    });
    return { message: 'Fee structure restored successfully', data: restored };
  }

  private async restoreStudentDiscount(
    currentUser: CurrentUser,
    discountId: string,
  ) {
    const item = await this.prisma.studentDiscount.findFirst({
      where: { id: discountId, deletedAt: { not: null } },
      select: {
        studentId: true,
        student: {
          select: {
            campus: {
              select: {
                institutionId: true,
              },
            },
          },
        },
      },
    });
    if (!item)
      throw new NotFoundException('Deleted student discount not found.');
    const institutionId = this.requireInstitutionId(
      item.student.campus.institutionId,
      'Deleted student discount',
    );
    this.assertInstitutionScope(currentUser, institutionId);
    const restored = await this.prisma.studentDiscount.update({
      where: { id: discountId, deletedAt: { not: null } },
      data: { deletedAt: null, deletedBy: null, deleteReason: null },
    });
    await this.auditLogService.log(currentUser, {
      action: 'STUDENT_DISCOUNT_RESTORED',
      entity: 'StudentDiscount',
      entityId: discountId,
      institutionId,
      metadata: { studentId: item.studentId },
    });
    return {
      message: 'Student discount restored successfully',
      data: restored,
    };
  }

  private async restoreStudentFineRule(
    currentUser: CurrentUser,
    fineRuleId: string,
  ) {
    const item = await this.prisma.studentFineRule.findFirst({
      where: { id: fineRuleId, deletedAt: { not: null } },
      select: {
        campusId: true,
        classId: true,
        campus: { select: { institutionId: true } },
      },
    });
    if (!item)
      throw new NotFoundException('Deleted student fine rule not found.');
    const institutionId = this.requireInstitutionId(
      item.campus.institutionId,
      'Deleted student fine rule',
    );
    this.assertInstitutionScope(currentUser, institutionId);
    const restored = await this.prisma.studentFineRule.update({
      where: { id: fineRuleId, deletedAt: { not: null } },
      data: { deletedAt: null, deletedBy: null, deleteReason: null },
    });
    await this.auditLogService.log(currentUser, {
      action: 'STUDENT_FINE_RULE_RESTORED',
      entity: 'StudentFineRule',
      entityId: fineRuleId,
      institutionId,
      metadata: {
        campusId: item.campusId,
        classId: item.classId,
      },
    });
    return {
      message: 'Student fine rule restored successfully',
      data: restored,
    };
  }

  private async restoreStudentFine(currentUser: CurrentUser, fineId: string) {
    const item = await this.prisma.studentFine.findFirst({
      where: { id: fineId, deletedAt: { not: null } },
      select: {
        studentId: true,
        month: true,
        year: true,
        student: {
          select: {
            campus: {
              select: {
                institutionId: true,
              },
            },
          },
        },
      },
    });
    if (!item) throw new NotFoundException('Deleted student fine not found.');
    const institutionId = this.requireInstitutionId(
      item.student.campus.institutionId,
      'Deleted student fine',
    );
    this.assertInstitutionScope(currentUser, institutionId);
    const restored = await this.prisma.studentFine.update({
      where: { id: fineId, deletedAt: { not: null } },
      data: { deletedAt: null, deletedBy: null, deleteReason: null },
    });
    await this.auditLogService.log(currentUser, {
      action: 'STUDENT_FINE_RESTORED',
      entity: 'StudentFine',
      entityId: fineId,
      institutionId,
      metadata: {
        studentId: item.studentId,
        month: item.month,
        year: item.year,
      },
    });
    return { message: 'Student fine restored successfully', data: restored };
  }

  private async restoreFeeVoucher(currentUser: CurrentUser, voucherId: string) {
    const item = await this.prisma.feeVoucher.findFirst({
      where: { id: voucherId, deletedAt: { not: null } },
      select: {
        studentId: true,
        month: true,
        year: true,
        student: {
          select: {
            campus: {
              select: {
                institutionId: true,
              },
            },
          },
        },
      },
    });
    if (!item) throw new NotFoundException('Deleted fee voucher not found.');
    const institutionId = this.requireInstitutionId(
      item.student.campus.institutionId,
      'Deleted fee voucher',
    );
    this.assertInstitutionScope(currentUser, institutionId);
    const restored = await this.prisma.feeVoucher.update({
      where: { id: voucherId, deletedAt: { not: null } },
      data: { deletedAt: null, deletedBy: null, deleteReason: null },
    });
    await this.auditLogService.log(currentUser, {
      action: 'FEE_VOUCHER_RESTORED',
      entity: 'FeeVoucher',
      entityId: voucherId,
      institutionId,
      metadata: {
        studentId: item.studentId,
        month: item.month,
        year: item.year,
      },
    });
    return { message: 'Fee voucher restored successfully', data: restored };
  }

  private async restoreFeePayment(currentUser: CurrentUser, paymentId: string) {
    const item = await this.prisma.feePayment.findFirst({
      where: { id: paymentId, deletedAt: { not: null } },
      select: {
        voucherId: true,
        month: true,
        year: true,
        voucher: {
          select: {
            student: {
              select: {
                campus: {
                  select: {
                    institutionId: true,
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!item) throw new NotFoundException('Deleted fee payment not found.');
    const institutionId = this.requireInstitutionId(
      item.voucher.student.campus.institutionId,
      'Deleted fee payment',
    );
    this.assertInstitutionScope(currentUser, institutionId);
    const restored = await this.prisma.feePayment.update({
      where: { id: paymentId, deletedAt: { not: null } },
      data: { deletedAt: null, deletedBy: null, deleteReason: null },
    });
    await this.prisma.feeVoucher.update({
      where: { id: item.voucherId },
      data: { status: 'PAID' },
    });
    await this.auditLogService.log(currentUser, {
      action: 'FEE_PAYMENT_RESTORED',
      entity: 'FeePayment',
      entityId: paymentId,
      institutionId,
      metadata: {
        voucherId: item.voucherId,
        month: item.month,
        year: item.year,
      },
    });
    return { message: 'Fee payment restored successfully', data: restored };
  }

  private async permanentlyDeleteCampus(
    currentUser: CurrentUser,
    campusId: string,
  ) {
    const campus = await this.prisma.campus.findFirst({
      where: {
        id: campusId,
        deletedAt: {
          not: null,
        },
      },
      select: {
        id: true,
        name: true,
        location: true,
        institutionId: true,
        deletedAt: true,
      },
    });

    if (!campus) {
      throw new NotFoundException('Deleted campus not found.');
    }

    this.assertCampusScope(currentUser, campus.institutionId);
    await this.assertPurgeSafe(
      RecycleBinEntity.CAMPUS,
      campusId,
      campus.deletedAt!,
      campus.institutionId,
    );

    await this.requestContext.runWith({ allowHardDelete: true }, async () => {
      await this.prisma.campus.delete({
        where: {
          id: campusId,
          deletedAt: {
            not: null,
          },
        },
      });
    });

    await this.auditLogService.log(currentUser, {
      action: 'CAMPUS_PERMANENTLY_DELETED',
      entity: 'Campus',
      entityId: campusId,
      institutionId: campus.institutionId,
      metadata: {
        name: campus.name,
        location: campus.location,
      },
    });

    return {
      message: 'Campus permanently deleted successfully',
      data: { id: campusId },
    };
  }

  private async permanentlyDeleteRole(
    currentUser: CurrentUser,
    roleId: string,
  ) {
    const template = await this.prisma.role.findFirst({
      where: {
        id: roleId,
        deletedAt: {
          not: null,
        },
      },
      select: {
        id: true,
        institutionId: true,
        name: true,
        deletedAt: true,
      },
    });

    if (!template) {
      throw new NotFoundException('Deleted role not found.');
    }

    this.assertInstitutionScope(currentUser, template.institutionId);
    await this.assertPurgeSafe(
      RecycleBinEntity.ROLE,
      roleId,
      template.deletedAt!,
      template.institutionId,
    );

    await this.requestContext.runWith({ allowHardDelete: true }, async () => {
      await this.prisma.role.delete({
        where: {
          id: roleId,
          deletedAt: {
            not: null,
          },
        },
      });
    });

    await this.auditLogService.log(currentUser, {
      action: 'ROLE_PERMANENTLY_DELETED',
      entity: 'Role',
      entityId: roleId,
      institutionId: template.institutionId,
      metadata: {
        name: template.name,
      },
    });

    return {
      message: 'Role permanently deleted successfully',
      data: { id: roleId },
    };
  }

  private async permanentlyDeleteAcademicYear(
    currentUser: CurrentUser,
    academicYearId: string,
  ) {
    const item = await this.prisma.academicYear.findFirst({
      where: { id: academicYearId, deletedAt: { not: null } },
      select: { name: true, deletedAt: true, institutionId: true },
    });
    if (!item) throw new NotFoundException('Deleted academic year not found.');
    this.assertInstitutionScope(currentUser, item.institutionId);
    await this.assertPurgeSafe(
      RecycleBinEntity.ACADEMIC_YEAR,
      academicYearId,
      item.deletedAt!,
      item.institutionId,
    );
    // AcademicYearCampusOverride rows cascade-delete automatically via the
    // schema's onDelete: Cascade FK — no manual cleanup needed here, same as
    // how permanentlyDeleteLevel doesn't manually clean up Sections/Subjects.
    await this.requestContext.runWith({ allowHardDelete: true }, async () => {
      await this.prisma.academicYear.delete({
        where: { id: academicYearId, deletedAt: { not: null } },
      });
    });
    await this.auditLogService.log(currentUser, {
      action: 'ACADEMIC_YEAR_PERMANENTLY_DELETED',
      entity: 'AcademicYear',
      entityId: academicYearId,
      institutionId: item.institutionId,
      metadata: { name: item.name },
    });
    return {
      message: 'Academic year permanently deleted successfully',
      data: { id: academicYearId },
    };
  }

  private async permanentlyDeleteStudent(
    currentUser: CurrentUser,
    studentId: string,
  ) {
    const item = await this.prisma.student.findFirst({
      where: { id: studentId, deletedAt: { not: null } },
      select: {
        regNo: true,
        deletedAt: true,
        campus: { select: { institutionId: true } },
      },
    });
    if (!item) throw new NotFoundException('Deleted student not found.');
    this.assertInstitutionScope(currentUser, item.campus.institutionId!);
    await this.assertPurgeSafe(
      RecycleBinEntity.STUDENT,
      studentId,
      item.deletedAt!,
      item.campus.institutionId,
    );
    await this.requestContext.runWith({ allowHardDelete: true }, async () => {
      await this.prisma.student.delete({
        where: { id: studentId, deletedAt: { not: null } },
      });
    });
    await this.auditLogService.log(currentUser, {
      action: 'STUDENT_PERMANENTLY_DELETED',
      entity: 'Student',
      entityId: studentId,
      institutionId: item.campus.institutionId,
      metadata: { regNo: item.regNo },
    });
    return {
      message: 'Student permanently deleted successfully',
      data: { id: studentId },
    };
  }

  private async permanentlyDeleteGuardian(
    currentUser: CurrentUser,
    guardianId: string,
  ) {
    const item = await this.prisma.guardian.findFirst({
      where: { id: guardianId, deletedAt: { not: null } },
      select: {
        relation: true,
        deletedAt: true,
        campus: { select: { institutionId: true } },
      },
    });
    if (!item) throw new NotFoundException('Deleted guardian not found.');
    this.assertInstitutionScope(currentUser, item.campus.institutionId!);
    await this.assertPurgeSafe(
      RecycleBinEntity.GUARDIAN,
      guardianId,
      item.deletedAt!,
      item.campus.institutionId,
    );
    await this.requestContext.runWith({ allowHardDelete: true }, async () => {
      await this.prisma.guardian.delete({
        where: { id: guardianId, deletedAt: { not: null } },
      });
    });
    await this.auditLogService.log(currentUser, {
      action: 'GUARDIAN_PERMANENTLY_DELETED',
      entity: 'Guardian',
      entityId: guardianId,
      institutionId: item.campus.institutionId,
      metadata: { relation: item.relation },
    });
    return {
      message: 'Guardian permanently deleted successfully',
      data: { id: guardianId },
    };
  }

  private async permanentlyDeleteTeacher(
    currentUser: CurrentUser,
    teacherId: string,
  ) {
    const item = await this.prisma.teacher.findFirst({
      where: { id: teacherId, deletedAt: { not: null } },
      select: {
        cnic: true,
        deletedAt: true,
        campus: { select: { institutionId: true } },
      },
    });
    if (!item) throw new NotFoundException('Deleted teacher not found.');
    this.assertInstitutionScope(currentUser, item.campus.institutionId!);
    await this.assertPurgeSafe(
      RecycleBinEntity.TEACHER,
      teacherId,
      item.deletedAt!,
      item.campus.institutionId,
    );
    await this.requestContext.runWith({ allowHardDelete: true }, async () => {
      await this.prisma.teacher.delete({
        where: { id: teacherId, deletedAt: { not: null } },
      });
    });
    await this.auditLogService.log(currentUser, {
      action: 'TEACHER_PERMANENTLY_DELETED',
      entity: 'Teacher',
      entityId: teacherId,
      institutionId: item.campus.institutionId,
      metadata: { cnic: item.cnic },
    });
    return {
      message: 'Teacher permanently deleted successfully',
      data: { id: teacherId },
    };
  }

  private async permanentlyDeleteLevel(
    currentUser: CurrentUser,
    levelId: string,
  ) {
    const item = await this.prisma.level.findFirst({
      where: { id: levelId, deletedAt: { not: null } },
      select: {
        name: true,
        deletedAt: true,
        campus: { select: { institutionId: true } },
      },
    });
    if (!item) throw new NotFoundException('Deleted level not found.');
    this.assertInstitutionScope(currentUser, item.campus.institutionId!);
    await this.assertPurgeSafe(
      RecycleBinEntity.LEVEL,
      levelId,
      item.deletedAt!,
      item.campus.institutionId,
    );
    await this.requestContext.runWith({ allowHardDelete: true }, async () => {
      await this.prisma.level.delete({
        where: { id: levelId, deletedAt: { not: null } },
      });
    });
    await this.auditLogService.log(currentUser, {
      action: 'LEVEL_PERMANENTLY_DELETED',
      entity: 'Level',
      entityId: levelId,
      institutionId: item.campus.institutionId,
      metadata: { name: item.name },
    });
    return {
      message: 'Level permanently deleted successfully',
      data: { id: levelId },
    };
  }

  private async permanentlyDeleteClass(
    currentUser: CurrentUser,
    classId: string,
  ) {
    const item = await this.prisma.academicClass.findFirst({
      where: { id: classId, deletedAt: { not: null } },
      select: {
        name: true,
        deletedAt: true,
        level: { select: { campus: { select: { institutionId: true } } } },
      },
    });
    if (!item) throw new NotFoundException('Deleted class not found.');
    this.assertInstitutionScope(currentUser, item.level.campus.institutionId!);
    await this.assertPurgeSafe(
      RecycleBinEntity.CLASS,
      classId,
      item.deletedAt!,
      item.level.campus.institutionId,
    );
    await this.requestContext.runWith({ allowHardDelete: true }, async () => {
      await this.prisma.academicClass.delete({
        where: { id: classId, deletedAt: { not: null } },
      });
    });
    await this.auditLogService.log(currentUser, {
      action: 'CLASS_PERMANENTLY_DELETED',
      entity: 'AcademicClass',
      entityId: classId,
      institutionId: item.level.campus.institutionId,
      metadata: { name: item.name },
    });
    return {
      message: 'Class permanently deleted successfully',
      data: { id: classId },
    };
  }

  private async permanentlyDeleteSection(
    currentUser: CurrentUser,
    sectionId: string,
  ) {
    const item = await this.prisma.section.findFirst({
      where: { id: sectionId, deletedAt: { not: null } },
      select: {
        name: true,
        deletedAt: true,
        class: {
          select: {
            level: { select: { campus: { select: { institutionId: true } } } },
          },
        },
      },
    });
    if (!item) throw new NotFoundException('Deleted section not found.');
    this.assertInstitutionScope(
      currentUser,
      item.class.level.campus.institutionId!,
    );
    await this.assertPurgeSafe(
      RecycleBinEntity.SECTION,
      sectionId,
      item.deletedAt!,
      item.class.level.campus.institutionId,
    );
    await this.requestContext.runWith({ allowHardDelete: true }, async () => {
      await this.prisma.section.delete({
        where: { id: sectionId, deletedAt: { not: null } },
      });
    });
    await this.auditLogService.log(currentUser, {
      action: 'SECTION_PERMANENTLY_DELETED',
      entity: 'Section',
      entityId: sectionId,
      institutionId: item.class.level.campus.institutionId,
      metadata: { name: item.name },
    });
    return {
      message: 'Section permanently deleted successfully',
      data: { id: sectionId },
    };
  }

  private async permanentlyDeleteSubject(
    currentUser: CurrentUser,
    subjectId: string,
  ) {
    const item = await this.prisma.subject.findFirst({
      where: { id: subjectId, deletedAt: { not: null } },
      select: {
        name: true,
        deletedAt: true,
        class: {
          select: {
            level: { select: { campus: { select: { institutionId: true } } } },
          },
        },
      },
    });
    if (!item) throw new NotFoundException('Deleted subject not found.');
    this.assertInstitutionScope(
      currentUser,
      item.class.level.campus.institutionId!,
    );
    await this.assertPurgeSafe(
      RecycleBinEntity.SUBJECT,
      subjectId,
      item.deletedAt!,
      item.class.level.campus.institutionId,
    );
    await this.requestContext.runWith({ allowHardDelete: true }, async () => {
      await this.prisma.subject.delete({
        where: { id: subjectId, deletedAt: { not: null } },
      });
    });
    await this.auditLogService.log(currentUser, {
      action: 'SUBJECT_PERMANENTLY_DELETED',
      entity: 'Subject',
      entityId: subjectId,
      institutionId: item.class.level.campus.institutionId,
      metadata: { name: item.name },
    });
    return {
      message: 'Subject permanently deleted successfully',
      data: { id: subjectId },
    };
  }

  private async permanentlyDeleteSalary(
    currentUser: CurrentUser,
    salaryId: string,
  ) {
    const item = await this.prisma.staffSalary.findFirst({
      where: { id: salaryId, deletedAt: { not: null } },
      select: {
        userId: true,
        deletedAt: true,
        campus: { select: { institutionId: true } },
      },
    });
    if (!item) throw new NotFoundException('Deleted salary record not found.');
    const institutionId = this.requireInstitutionId(
      item.campus.institutionId,
      'Deleted salary record',
    );
    this.assertInstitutionScope(currentUser, institutionId);
    await this.assertPurgeSafe(
      RecycleBinEntity.SALARY,
      salaryId,
      item.deletedAt!,
      institutionId,
    );
    await this.requestContext.runWith({ allowHardDelete: true }, async () => {
      await this.prisma.staffSalary.delete({
        where: { id: salaryId, deletedAt: { not: null } },
      });
    });
    await this.auditLogService.log(currentUser, {
      action: 'SALARY_PERMANENTLY_DELETED',
      entity: 'StaffSalary',
      entityId: salaryId,
      institutionId,
      metadata: { userId: item.userId },
    });
    return {
      message: 'Salary permanently deleted successfully',
      data: { id: salaryId },
    };
  }

  private async permanentlyDeleteSalaryDeductionRule(
    currentUser: CurrentUser,
    ruleId: string,
  ) {
    const item = await this.prisma.salaryDeductionRule.findFirst({
      where: { id: ruleId, deletedAt: { not: null } },
      select: {
        deletedAt: true,
        campus: { select: { institutionId: true } },
      },
    });
    if (!item) {
      throw new NotFoundException('Deleted salary deduction rule not found.');
    }
    const institutionId = this.requireInstitutionId(
      item.campus.institutionId,
      'Deleted salary deduction rule',
    );
    this.assertInstitutionScope(currentUser, institutionId);
    await this.assertPurgeSafe(
      RecycleBinEntity.SALARY_DEDUCTION_RULE,
      ruleId,
      item.deletedAt!,
      institutionId,
    );
    await this.requestContext.runWith({ allowHardDelete: true }, async () => {
      await this.prisma.salaryDeductionRule.delete({
        where: { id: ruleId, deletedAt: { not: null } },
      });
    });
    await this.auditLogService.log(currentUser, {
      action: 'SALARY_DEDUCTION_RULE_PERMANENTLY_DELETED',
      entity: 'SalaryDeductionRule',
      entityId: ruleId,
      institutionId,
      metadata: {},
    });
    return {
      message: 'Salary deduction rule permanently deleted successfully',
      data: { id: ruleId },
    };
  }

  private async permanentlyDeleteSalaryAdjustment(
    currentUser: CurrentUser,
    adjustmentId: string,
  ) {
    const item = await this.prisma.salaryAdjustment.findFirst({
      where: { id: adjustmentId, deletedAt: { not: null } },
      select: {
        userId: true,
        salaryId: true,
        deletedAt: true,
        campus: { select: { institutionId: true } },
      },
    });
    if (!item)
      throw new NotFoundException('Deleted salary adjustment not found.');
    const institutionId = this.requireInstitutionId(
      item.campus.institutionId,
      'Deleted salary adjustment',
    );
    this.assertInstitutionScope(currentUser, institutionId);
    await this.assertPurgeSafe(
      RecycleBinEntity.SALARY_ADJUSTMENT,
      adjustmentId,
      item.deletedAt!,
      institutionId,
    );
    await this.requestContext.runWith({ allowHardDelete: true }, async () => {
      await this.prisma.salaryAdjustment.delete({
        where: { id: adjustmentId, deletedAt: { not: null } },
      });
    });
    await this.auditLogService.log(currentUser, {
      action: 'SALARY_ADJUSTMENT_PERMANENTLY_DELETED',
      entity: 'SalaryAdjustment',
      entityId: adjustmentId,
      institutionId,
      metadata: {
        userId: item.userId,
        salaryId: item.salaryId,
      },
    });
    return {
      message: 'Salary adjustment permanently deleted successfully',
      data: { id: adjustmentId },
    };
  }

  private async permanentlyDeleteSalaryPayment(
    currentUser: CurrentUser,
    paymentId: string,
  ) {
    const item = await this.prisma.salaryPayment.findFirst({
      where: { id: paymentId, deletedAt: { not: null } },
      select: {
        userId: true,
        salaryId: true,
        deletedAt: true,
        campus: { select: { institutionId: true } },
      },
    });
    if (!item) throw new NotFoundException('Deleted salary payment not found.');
    const institutionId = this.requireInstitutionId(
      item.campus.institutionId,
      'Deleted salary payment',
    );
    this.assertInstitutionScope(currentUser, institutionId);
    await this.assertPurgeSafe(
      RecycleBinEntity.SALARY_PAYMENT,
      paymentId,
      item.deletedAt!,
      institutionId,
    );
    await this.requestContext.runWith({ allowHardDelete: true }, async () => {
      await this.prisma.salaryDeductionSummary.deleteMany({
        where: { salaryPaymentId: paymentId },
      });
      await this.prisma.salaryPayment.delete({
        where: { id: paymentId, deletedAt: { not: null } },
      });
    });
    await this.auditLogService.log(currentUser, {
      action: 'SALARY_PAYMENT_PERMANENTLY_DELETED',
      entity: 'SalaryPayment',
      entityId: paymentId,
      institutionId,
      metadata: {
        userId: item.userId,
        salaryId: item.salaryId,
      },
    });
    return {
      message: 'Salary payment permanently deleted successfully',
      data: { id: paymentId },
    };
  }

  private async permanentlyDeleteBankAccount(
    currentUser: CurrentUser,
    bankAccountId: string,
  ) {
    const item = await this.prisma.bankAccount.findFirst({
      where: { id: bankAccountId, deletedAt: { not: null } },
      select: {
        bankName: true,
        accountTitle: true,
        accountNumber: true,
        deletedAt: true,
        campus: { select: { institutionId: true } },
      },
    });
    if (!item) throw new NotFoundException('Deleted bank account not found.');
    const institutionId = this.requireInstitutionId(
      item.campus.institutionId,
      'Deleted bank account',
    );
    this.assertInstitutionScope(currentUser, institutionId);
    await this.assertPurgeSafe(
      RecycleBinEntity.BANK_ACCOUNT,
      bankAccountId,
      item.deletedAt!,
      institutionId,
    );
    await this.requestContext.runWith({ allowHardDelete: true }, async () => {
      await this.prisma.bankAccount.delete({
        where: { id: bankAccountId, deletedAt: { not: null } },
      });
    });
    await this.auditLogService.log(currentUser, {
      action: 'BANK_ACCOUNT_PERMANENTLY_DELETED',
      entity: 'BankAccount',
      entityId: bankAccountId,
      institutionId,
      metadata: {
        bankName: item.bankName,
        accountTitle: item.accountTitle,
        accountNumber: item.accountNumber,
      },
    });
    return {
      message: 'Bank account permanently deleted successfully',
      data: { id: bankAccountId },
    };
  }

  private async permanentlyDeleteFeeStructure(
    currentUser: CurrentUser,
    feeStructureId: string,
  ) {
    const item = await this.prisma.feeStructure.findFirst({
      where: { id: feeStructureId, deletedAt: { not: null } },
      select: {
        classId: true,
        deletedAt: true,
        campus: { select: { institutionId: true } },
      },
    });
    if (!item) throw new NotFoundException('Deleted fee structure not found.');
    const institutionId = this.requireInstitutionId(
      item.campus.institutionId,
      'Deleted fee structure',
    );
    this.assertInstitutionScope(currentUser, institutionId);
    await this.assertPurgeSafe(
      RecycleBinEntity.FEE_STRUCTURE,
      feeStructureId,
      item.deletedAt!,
      institutionId,
    );
    await this.requestContext.runWith({ allowHardDelete: true }, async () => {
      await this.prisma.feeStructure.delete({
        where: { id: feeStructureId, deletedAt: { not: null } },
      });
    });
    await this.auditLogService.log(currentUser, {
      action: 'FEE_STRUCTURE_PERMANENTLY_DELETED',
      entity: 'FeeStructure',
      entityId: feeStructureId,
      institutionId,
      metadata: { classId: item.classId },
    });
    return {
      message: 'Fee structure permanently deleted successfully',
      data: { id: feeStructureId },
    };
  }

  private async permanentlyDeleteStudentDiscount(
    currentUser: CurrentUser,
    discountId: string,
  ) {
    const item = await this.prisma.studentDiscount.findFirst({
      where: { id: discountId, deletedAt: { not: null } },
      select: {
        studentId: true,
        deletedAt: true,
        student: {
          select: {
            campus: {
              select: {
                institutionId: true,
              },
            },
          },
        },
      },
    });
    if (!item)
      throw new NotFoundException('Deleted student discount not found.');
    const institutionId = this.requireInstitutionId(
      item.student.campus.institutionId,
      'Deleted student discount',
    );
    this.assertInstitutionScope(currentUser, institutionId);
    await this.assertPurgeSafe(
      RecycleBinEntity.STUDENT_DISCOUNT,
      discountId,
      item.deletedAt!,
      institutionId,
    );
    await this.requestContext.runWith({ allowHardDelete: true }, async () => {
      await this.prisma.studentDiscount.delete({
        where: { id: discountId, deletedAt: { not: null } },
      });
    });
    await this.auditLogService.log(currentUser, {
      action: 'STUDENT_DISCOUNT_PERMANENTLY_DELETED',
      entity: 'StudentDiscount',
      entityId: discountId,
      institutionId,
      metadata: { studentId: item.studentId },
    });
    return {
      message: 'Student discount permanently deleted successfully',
      data: { id: discountId },
    };
  }

  private async permanentlyDeleteStudentFineRule(
    currentUser: CurrentUser,
    fineRuleId: string,
  ) {
    const item = await this.prisma.studentFineRule.findFirst({
      where: { id: fineRuleId, deletedAt: { not: null } },
      select: {
        campusId: true,
        classId: true,
        deletedAt: true,
        campus: { select: { institutionId: true } },
      },
    });
    if (!item)
      throw new NotFoundException('Deleted student fine rule not found.');
    const institutionId = this.requireInstitutionId(
      item.campus.institutionId,
      'Deleted student fine rule',
    );
    this.assertInstitutionScope(currentUser, institutionId);
    await this.assertPurgeSafe(
      RecycleBinEntity.STUDENT_FINE_RULE,
      fineRuleId,
      item.deletedAt!,
      institutionId,
    );
    await this.requestContext.runWith({ allowHardDelete: true }, async () => {
      await this.prisma.studentFineRule.delete({
        where: { id: fineRuleId, deletedAt: { not: null } },
      });
    });
    await this.auditLogService.log(currentUser, {
      action: 'STUDENT_FINE_RULE_PERMANENTLY_DELETED',
      entity: 'StudentFineRule',
      entityId: fineRuleId,
      institutionId,
      metadata: {
        campusId: item.campusId,
        classId: item.classId,
      },
    });
    return {
      message: 'Student fine rule permanently deleted successfully',
      data: { id: fineRuleId },
    };
  }

  private async permanentlyDeleteStudentFine(
    currentUser: CurrentUser,
    fineId: string,
  ) {
    const item = await this.prisma.studentFine.findFirst({
      where: { id: fineId, deletedAt: { not: null } },
      select: {
        studentId: true,
        month: true,
        year: true,
        deletedAt: true,
        student: {
          select: {
            campus: {
              select: {
                institutionId: true,
              },
            },
          },
        },
      },
    });
    if (!item) throw new NotFoundException('Deleted student fine not found.');
    const institutionId = this.requireInstitutionId(
      item.student.campus.institutionId,
      'Deleted student fine',
    );
    this.assertInstitutionScope(currentUser, institutionId);
    await this.assertPurgeSafe(
      RecycleBinEntity.STUDENT_FINE,
      fineId,
      item.deletedAt!,
      institutionId,
    );
    await this.requestContext.runWith({ allowHardDelete: true }, async () => {
      await this.prisma.studentFine.delete({
        where: { id: fineId, deletedAt: { not: null } },
      });
    });
    await this.auditLogService.log(currentUser, {
      action: 'STUDENT_FINE_PERMANENTLY_DELETED',
      entity: 'StudentFine',
      entityId: fineId,
      institutionId,
      metadata: {
        studentId: item.studentId,
        month: item.month,
        year: item.year,
      },
    });
    return {
      message: 'Student fine permanently deleted successfully',
      data: { id: fineId },
    };
  }

  private async permanentlyDeleteFeeVoucher(
    currentUser: CurrentUser,
    voucherId: string,
  ) {
    const item = await this.prisma.feeVoucher.findFirst({
      where: { id: voucherId, deletedAt: { not: null } },
      select: {
        studentId: true,
        month: true,
        year: true,
        deletedAt: true,
        student: {
          select: {
            campus: {
              select: {
                institutionId: true,
              },
            },
          },
        },
      },
    });
    if (!item) throw new NotFoundException('Deleted fee voucher not found.');
    const institutionId = this.requireInstitutionId(
      item.student.campus.institutionId,
      'Deleted fee voucher',
    );
    this.assertInstitutionScope(currentUser, institutionId);
    await this.assertPurgeSafe(
      RecycleBinEntity.FEE_VOUCHER,
      voucherId,
      item.deletedAt!,
      institutionId,
    );
    await this.requestContext.runWith({ allowHardDelete: true }, async () => {
      await this.prisma.feeVoucher.delete({
        where: { id: voucherId, deletedAt: { not: null } },
      });
    });
    await this.auditLogService.log(currentUser, {
      action: 'FEE_VOUCHER_PERMANENTLY_DELETED',
      entity: 'FeeVoucher',
      entityId: voucherId,
      institutionId,
      metadata: {
        studentId: item.studentId,
        month: item.month,
        year: item.year,
      },
    });
    return {
      message: 'Fee voucher permanently deleted successfully',
      data: { id: voucherId },
    };
  }

  private async permanentlyDeleteFeePayment(
    currentUser: CurrentUser,
    paymentId: string,
  ) {
    const item = await this.prisma.feePayment.findFirst({
      where: { id: paymentId, deletedAt: { not: null } },
      select: {
        voucherId: true,
        month: true,
        year: true,
        deletedAt: true,
        voucher: {
          select: {
            student: {
              select: {
                campus: {
                  select: {
                    institutionId: true,
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!item) throw new NotFoundException('Deleted fee payment not found.');
    const institutionId = this.requireInstitutionId(
      item.voucher.student.campus.institutionId,
      'Deleted fee payment',
    );
    this.assertInstitutionScope(currentUser, institutionId);
    await this.assertPurgeSafe(
      RecycleBinEntity.FEE_PAYMENT,
      paymentId,
      item.deletedAt!,
      institutionId,
    );
    await this.requestContext.runWith({ allowHardDelete: true }, async () => {
      await this.prisma.feePayment.delete({
        where: { id: paymentId, deletedAt: { not: null } },
      });
      const remainingPayment = await this.prisma.feePayment.findFirst({
        where: { voucherId: item.voucherId },
      });
      if (!remainingPayment) {
        await this.prisma.feeVoucher.update({
          where: { id: item.voucherId },
          data: { status: 'PENDING' },
        });
      }
    });
    await this.auditLogService.log(currentUser, {
      action: 'FEE_PAYMENT_PERMANENTLY_DELETED',
      entity: 'FeePayment',
      entityId: paymentId,
      institutionId,
      metadata: {
        voucherId: item.voucherId,
        month: item.month,
        year: item.year,
      },
    });
    return {
      message: 'Fee payment permanently deleted successfully',
      data: { id: paymentId },
    };
  }

  private resolveScopedInstitutionId(
    currentUser: CurrentUser,
    query: ListRecycleBinQueryDto,
  ) {
    if (currentUser.role === UserRole.SUPERADMIN) {
      return query.institutionId ?? null;
    }

    if (!currentUser.institutionId) {
      throw new ForbiddenException(
        'Your account is not linked to an institution.',
      );
    }

    if (
      query.institutionId &&
      query.institutionId !== currentUser.institutionId
    ) {
      throw new ForbiddenException(
        'You can only access recycle bin items for your own institution.',
      );
    }

    return currentUser.institutionId;
  }

  private requireInstitutionId(
    institutionId: string | null,
    entityLabel: string,
  ) {
    if (!institutionId) {
      throw new NotFoundException(
        `Institution not found for ${entityLabel.toLowerCase()}.`,
      );
    }

    return institutionId;
  }

  private assertUserScope(
    currentUser: CurrentUser,
    user: {
      id: string;
      role: UserRole;
      institutionId: string | null;
    },
  ) {
    if (
      currentUser.role === UserRole.ADMIN &&
      user.role === UserRole.SUPERADMIN
    ) {
      throw new ForbiddenException('Admins cannot manage superadmin accounts.');
    }

    if (
      currentUser.role === UserRole.ADMIN &&
      currentUser.institutionId !== user.institutionId
    ) {
      throw new ForbiddenException(
        'Admins can only manage users within their institution.',
      );
    }
  }

  /**
   * Gate before every permanentlyDeleteX handler's actual .delete() call:
   * (1) the retention window must have elapsed, and (2) hard-deleting this
   * record must not cascade into anything still ACTIVE. Both checks apply
   * uniformly regardless of who triggers the delete (there's no separate
   * "system" path — purging is always this manual, human-triggered action).
   */
  private async assertPurgeSafe(
    entity: RecycleBinEntity,
    id: string,
    deletedAt: Date,
    institutionId: string | null,
  ) {
    const retentionDays = await this.resolveRetentionDays(institutionId);
    this.assertPurgeEligible(deletedAt, retentionDays);
    await this.assertNoActiveDescendants(entity, id);
  }

  private async resolveRetentionDays(
    institutionId: string | null,
  ): Promise<number> {
    if (!institutionId) return DEFAULT_RECYCLE_BIN_RETENTION_DAYS;

    const setting = await this.prisma.institutionSetting.findUnique({
      where: {
        institutionId_key_activeScopeKey: {
          institutionId,
          key: 'recycle_bin',
          activeScopeKey: 'ACTIVE',
        },
      },
      select: { value: true },
    });

    const value = setting?.value;
    const retentionDays =
      value &&
      typeof value === 'object' &&
      'retentionDays' in value &&
      typeof (value as { retentionDays: unknown }).retentionDays === 'number'
        ? (value as { retentionDays: number }).retentionDays
        : undefined;

    if (retentionDays === undefined) {
      return DEFAULT_RECYCLE_BIN_RETENTION_DAYS;
    }

    return Math.min(
      MAX_RECYCLE_BIN_RETENTION_DAYS,
      Math.max(MIN_RECYCLE_BIN_RETENTION_DAYS, retentionDays),
    );
  }

  private resolvePurgeEligibleAt(deletedAt: Date, retentionDays: number) {
    const eligibleAt = new Date(deletedAt);
    eligibleAt.setUTCDate(eligibleAt.getUTCDate() + retentionDays);
    return eligibleAt;
  }

  private assertPurgeEligible(deletedAt: Date, retentionDays: number) {
    const eligibleAt = this.resolvePurgeEligibleAt(deletedAt, retentionDays);
    if (new Date() < eligibleAt) {
      throw new ForbiddenException(
        `This record cannot be permanently deleted until ${eligibleAt.toISOString().slice(0, 10)} (${retentionDays}-day retention period since deletion).`,
      );
    }
  }

  /**
   * Recursively walks the ENTITY_CASCADE_CHILDREN tree and throws the
   * moment it finds any still-ACTIVE row in the hard-delete's blast radius.
   * Only recurses into a child's own children when that child itself has no
   * ACTIVE rows here — an already-soft-deleted intermediate node can still
   * have an active grandchild (nothing cascades soft-deletes downward when
   * a record is moved to the recycle bin), so its children must still be
   * checked even though the intermediate node itself is dead.
   */
  private async assertNoActiveDescendants(
    entity: RecycleBinEntity,
    id: string,
  ): Promise<void> {
    const links = ENTITY_CASCADE_CHILDREN[entity] ?? [];

    for (const link of links) {
      const delegate = this.prisma[link.model] as unknown as CountableDelegate;
      const activeCount = await delegate.count({
        where: { [link.fkField]: id, deletedAt: null },
      });

      if (activeCount > 0) {
        throw new ConflictException(
          `Cannot permanently delete this record: it still has ${activeCount} active ${link.entity} record(s) that would be lost. Delete or reassign those first.`,
        );
      }

      const children = await delegate.findMany({
        where: { [link.fkField]: id },
        select: { id: true },
      });

      for (const child of children) {
        await this.assertNoActiveDescendants(link.entity, child.id);
      }
    }
  }

  private assertCampusScope(
    currentUser: CurrentUser,
    institutionId: string | null,
  ) {
    if (
      currentUser.role === UserRole.ADMIN &&
      currentUser.institutionId !== institutionId
    ) {
      throw new ForbiddenException(
        'Admins can only manage campuses within their institution.',
      );
    }
  }

  private assertInstitutionScope(
    currentUser: CurrentUser,
    institutionId: string,
  ) {
    if (
      currentUser.role === UserRole.ADMIN &&
      currentUser.institutionId !== institutionId
    ) {
      throw new ForbiddenException(
        'Admins can only manage recycle bin items within their institution.',
      );
    }
  }

  private async loadDeletedByUsers(items: RecycleBinItem[]) {
    const deletedByIds = Array.from(
      new Set(
        items
          .map((item) => item.deletedBy)
          .filter((value): value is string => Boolean(value)),
      ),
    );

    if (!deletedByIds.length) {
      return {} as Record<
        string,
        { id: string; name: string; email: string; role: UserRole }
      >;
    }

    const users = await this.prisma.user.findMany({
      where: {
        id: { in: deletedByIds },
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
      },
    });

    return users.reduce<
      Record<
        string,
        { id: string; name: string; email: string; role: UserRole }
      >
    >((accumulator, user) => {
      accumulator[user.id] = user;
      return accumulator;
    }, {});
  }

  private rethrowRestoreConflict(error: unknown, entity: RecycleBinEntity) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new ConflictException(
        `Cannot restore this ${entity} because an active record with the same unique values already exists.`,
      );
    }
  }
}
