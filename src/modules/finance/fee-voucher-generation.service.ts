import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { CurrentUser } from '../../common/interfaces/current-user.interface';
import { AuditLogService } from '../../common/services/audit-log.service';
import { CampusAccessService } from '../../common/services/campus-access.service';
import { ModuleAccessService } from '../../common/services/module-access.service';
import { RequestContextService } from '../../common/services/request-context.service';
import { reconcileFeeVoucher } from '../../common/utils/fee-settlement.util';
import { runAuditedTransaction } from '../../common/utils/transaction.util';
import { readVoucherAmounts } from '../../common/utils/voucher-calculation.util';
import { EnrollmentStatus, ModuleKey, Prisma } from '../../prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BulkGenerateVouchersDto } from './dto/finance.dto';

/** A run covers at most this many students; larger campuses narrow by class or section. */
export const MAX_BULK_VOUCHER_STUDENTS = 2000;
const DEFAULT_DUE_DAY = 10;

interface StudentRef {
  studentId: string;
  name: string;
  regNo: string;
}

export interface GeneratedVoucher extends StudentRef {
  voucherId: string | null;
  amount: string;
}
export interface SkippedVoucher extends StudentRef {
  reason: string;
}

/**
 * Generates a month's fee vouchers for a whole campus, class or section in
 * one action. It is safe to run twice: a student who already has a voucher
 * for the month is skipped. Each student is created in their own transaction,
 * so one problem student never stops the rest, and everything that was not
 * created is reported with a reason.
 */
@Injectable()
export class FeeVoucherGenerationService {
  private readonly logger = new Logger(FeeVoucherGenerationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly moduleAccessService: ModuleAccessService,
    private readonly campusAccessService: CampusAccessService,
    private readonly requestContext: RequestContextService,
    private readonly auditLogService: AuditLogService,
  ) {}

  /**
   * Create (or, with `preview`, only report) the vouchers for a period.
   *
   * @param {CurrentUser} currentUser - Authenticated caller.
   * @param {BulkGenerateVouchersDto} dto - Campus, optional class or section, period and options.
   * @returns {Promise<{message: string, data: object}>} Generated, skipped and failed students with totals.
   * @throws {ForbiddenException} If the caller cannot act at the campus, or the bank is from another campus.
   * @throws {ConflictException} If there is no current academic year, or vouchers need custom values this run cannot supply.
   * @throws {BadRequestException} If the run would cover too many students.
   */
  async generate(currentUser: CurrentUser, dto: BulkGenerateVouchersDto) {
    await this.moduleAccessService.assertModuleEnabledForUser(
      currentUser,
      ModuleKey.FINANCE,
    );
    await this.campusAccessService.assertCampusAccess(
      currentUser,
      dto.campusId,
    );
    const campus = await this.prisma.campus.findUnique({
      where: { id: dto.campusId },
      select: { institutionId: true },
    });
    if (!campus?.institutionId) {
      throw new ForbiddenException('You do not have access to this campus.');
    }
    const institutionId = campus.institutionId;

    await this.assertBankBelongsToCampus(dto.bankId, dto.campusId);
    await this.assertNoRequiredVoucherFields(institutionId);

    const academicYearId = await this.currentAcademicYearId(institutionId);
    const dueDate = dto.dueDate
      ? new Date(dto.dueDate)
      : await this.defaultDueDate(institutionId, dto.month, dto.year);

    const students = await this.selectStudents(dto, academicYearId);
    if (students.length > MAX_BULK_VOUCHER_STUDENTS) {
      throw new BadRequestException(
        `This would cover ${students.length} students. Choose a class or section so a run covers at most ${MAX_BULK_VOUCHER_STUDENTS}.`,
      );
    }

    const structures = await this.prisma.feeStructure.findMany({
      where: {
        campusId: dto.campusId,
        classId: { in: [...new Set(students.map((row) => row.classId))] },
      },
      select: { id: true, classId: true },
    });
    const structureByClass = new Map(
      structures.map((row) => [row.classId, row.id]),
    );
    const existing = await this.prisma.feeVoucher.findMany({
      where: {
        studentId: { in: students.map((row) => row.studentId) },
        month: dto.month,
        year: dto.year,
      },
      select: { studentId: true },
    });
    const hasVoucher = new Set(existing.map((row) => row.studentId));

    const generated: GeneratedVoucher[] = [];
    const skipped: SkippedVoucher[] = [];
    const failed: SkippedVoucher[] = [];

    for (const student of students) {
      if (hasVoucher.has(student.studentId)) {
        skipped.push({
          ...student,
          reason: 'A voucher already exists for this month.',
        });
        continue;
      }
      const feeStructureId = structureByClass.get(student.classId);
      if (!feeStructureId) {
        failed.push({
          ...student,
          reason: "No fee structure is set for this student's class.",
        });
        continue;
      }

      try {
        const created = await this.createOne(currentUser, {
          student,
          feeStructureId,
          dto,
          dueDate,
          preview: dto.preview === true,
        });
        generated.push({ ...student, ...created });
      } catch (error) {
        if (this.isDuplicate(error)) {
          skipped.push({
            ...student,
            reason: 'A voucher already exists for this month.',
          });
        } else {
          failed.push({ ...student, reason: this.reasonOf(error) });
        }
      }
    }

    const totalAmount = generated
      .reduce((sum, row) => sum.plus(row.amount), new Prisma.Decimal(0))
      .toFixed(2);

    if (!dto.preview) {
      // The vouchers are already created and each one audited on its own, so a
      // failure to write this summary must not turn a finished run into an
      // error that hides the report of what was created.
      try {
        await this.auditLogService.log(currentUser, {
          action: 'FEE_VOUCHERS_BULK_GENERATED',
          entity: 'FeeVoucher',
          institutionId,
          metadata: {
            campusId: dto.campusId,
            classId: dto.classId ?? null,
            sectionId: dto.sectionId ?? null,
            month: dto.month,
            year: dto.year,
            generated: generated.length,
            skipped: skipped.length,
            failed: failed.length,
            totalAmount,
          },
        });
      } catch (error) {
        this.logger.error(
          'Could not record the bulk voucher generation summary',
          error instanceof Error ? error.stack : String(error),
        );
      }
    }

    return {
      message: dto.preview
        ? 'Voucher generation previewed'
        : 'Fee vouchers generated successfully',
      data: {
        preview: dto.preview === true,
        month: dto.month,
        year: dto.year,
        dueDate,
        generated,
        skipped,
        failed,
        totals: {
          generated: generated.length,
          skipped: skipped.length,
          failed: failed.length,
          totalAmount,
        },
      },
    };
  }

  /**
   * One student's voucher, in its own serializable transaction. In preview
   * mode the amounts are calculated but nothing is written.
   */
  private async createOne(
    currentUser: CurrentUser,
    params: {
      student: StudentRef & { classId: string };
      feeStructureId: string;
      dto: BulkGenerateVouchersDto;
      dueDate: Date;
      preview: boolean;
    },
  ): Promise<{ voucherId: string | null; amount: string }> {
    const { student, feeStructureId, dto, dueDate, preview } = params;
    const amountsFor = (client: Prisma.TransactionClient) =>
      readVoucherAmounts(client, {
        studentId: student.studentId,
        feeStructureId,
        campusId: dto.campusId,
        month: dto.month,
        year: dto.year,
        lateFeeFine: 0,
        bankId: dto.bankId,
        oneTimeCharges: dto.oneTimeCharges,
      });

    if (preview) {
      const amounts = await amountsFor(this.prisma);
      return { voucherId: null, amount: amounts.finalAmountDue.toFixed(2) };
    }

    return runAuditedTransaction(
      this.prisma,
      this.requestContext,
      async (transaction) => {
        const amounts = await amountsFor(transaction);
        const voucher = await transaction.feeVoucher.create({
          data: {
            studentId: student.studentId,
            feeStructureId,
            month: dto.month,
            year: dto.year,
            ...amounts,
            bankId: dto.bankId ?? null,
            dueDate,
            createdBy: currentUser.sub,
          },
        });
        await reconcileFeeVoucher(transaction, voucher.id);
        return {
          voucherId: voucher.id,
          amount: amounts.finalAmountDue.toFixed(2),
        };
      },
      Prisma.TransactionIsolationLevel.Serializable,
    );
  }

  /**
   * Students with a current enrollment in the campus (and the chosen class or
   * section) who have not withdrawn.
   */
  private async selectStudents(
    dto: BulkGenerateVouchersDto,
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
          select: { id: true, regNo: true, user: { select: { name: true } } },
        },
      },
    });
    return enrollments
      .map((row) => ({
        studentId: row.student.id,
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
        'Set the current academic year before generating vouchers.',
      );
    }
    return institution.currentAcademicYearId;
  }

  /** The institution's `finance.dueDayOfMonth` (1 to 28, default 10) in the voucher month. */
  private async defaultDueDate(
    institutionId: string,
    month: number,
    year: number,
  ): Promise<Date> {
    const setting = await this.prisma.institutionSetting.findUnique({
      where: {
        institutionId_key_activeScopeKey: {
          institutionId,
          key: 'finance',
          activeScopeKey: 'ACTIVE',
        },
      },
      select: { value: true },
    });
    const raw =
      setting?.value && typeof setting.value === 'object'
        ? (setting.value as { dueDayOfMonth?: unknown }).dueDayOfMonth
        : undefined;
    const day =
      typeof raw === 'number' && Number.isInteger(raw) && raw >= 1 && raw <= 28
        ? raw
        : DEFAULT_DUE_DAY;
    return new Date(Date.UTC(year, month - 1, day));
  }

  private async assertBankBelongsToCampus(
    bankId: string | undefined,
    campusId: string,
  ) {
    if (!bankId) return;
    const bank = await this.prisma.bankAccount.findUnique({
      where: { id: bankId },
      select: { campusId: true },
    });
    if (!bank || bank.campusId !== campusId) {
      throw new ForbiddenException(
        'The bank account must be active and belong to this campus.',
      );
    }
  }

  /**
   * A bulk run cannot ask anyone for custom field values, so it refuses to
   * run while the institution requires some, rather than creating vouchers
   * that would bypass the requirement.
   */
  private async assertNoRequiredVoucherFields(institutionId: string) {
    const required = await this.prisma.customFieldDefinition.count({
      where: {
        institutionId,
        entityType: 'fee_voucher',
        isRequired: true,
        isActive: true,
      },
    });
    if (required > 0) {
      throw new ConflictException(
        'Fee vouchers have required custom fields, which a bulk run cannot fill in. Make them optional, or create vouchers one at a time.',
      );
    }
  }

  private isDuplicate(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    );
  }

  /** A short, user-safe reason for a failed student. */
  private reasonOf(error: unknown): string {
    if (error instanceof HttpException) return error.message;
    return 'This voucher could not be created.';
  }
}
